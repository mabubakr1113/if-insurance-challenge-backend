import type { ActorGrant, InviteMemberBody, JoinView, Member, MemberPatch } from '@/lib/contract';
import type { HomeAccess } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/catalog';
import { ApiError, forbidden, notFound } from '@/lib/errors';
import { exec, one, row, rows, type HomeRow, type MemberRow, type TaskRow, type VisitRow } from '@/lib/db';
import { mapMember, memberStats, sortMembers } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { firstName } from '@/lib/time';
import { logActivity } from './activity';
import { notify } from './notifications';
import { unassignMember } from './tasks';

async function statsInputs(homeId: string) {
  return Promise.all([
    rows<TaskRow>(db().from('tasks').select('*').eq('home_id', homeId)),
    rows<VisitRow>(db().from('visits').select('*').eq('home_id', homeId)),
  ]);
}

export async function memberView(m: MemberRow): Promise<Member> {
  const [tasks, visits] = await statsInputs(m.home_id);
  return mapMember(m, memberStats(m, tasks, visits));
}

/** Members of a home, removed ones excluded, coordinators first. */
export async function listMembers(homeId: string): Promise<Member[]> {
  const [members, [tasks, visits]] = await Promise.all([
    rows<MemberRow>(db().from('members').select('*').eq('home_id', homeId).neq('status', 'removed')),
    statsInputs(homeId),
  ]);
  return sortMembers(members).map((m) => mapMember(m, memberStats(m, tasks, visits)));
}

const article = (role: string) => (role === 'helper' ? 'a helper' : role === 'viewer' ? 'a viewer' : 'a coordinator');

export async function inviteMember({ home, me }: HomeAccess, body: InviteMemberBody): Promise<{ member: Member; joinPath: string }> {
  const member = await one<MemberRow>(
    db()
      .from('members')
      .insert({
        home_id: home.id,
        name: body.name,
        relation: body.relation,
        role: body.role,
        can_authorise: body.role === 'viewer' ? false : body.canAuthorise,
        email: body.email ?? null,
        phone: body.phone ?? null,
        city: body.city ?? null,
        status: 'invited',
        invited_by: me.id,
      })
      .select('*')
      .single(),
  );
  const joinPath = `/join/${member.join_token}`;
  await notify(
    { memberIds: [member.id] },
    {
      homeId: home.id,
      channel: member.phone ? 'sms' : 'email',
      title: `${firstName(me.name)} invited you to help look after ${home.estate_name ?? 'the family'}'s home`,
      body: `Join the family's Home Watch plan for ${home.address_line}, ${home.city}.`,
      link: joinPath,
    },
  );
  await logActivity({
    homeId: home.id,
    type: 'member_invited',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} invited ${firstName(member.name)} as ${article(member.role)}`,
  });
  return { member: await memberView(member), joinPath };
}

async function otherCoordinators(homeId: string, exceptId: string): Promise<number> {
  const { count, error } = await db()
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('home_id', homeId)
    .eq('role', 'coordinator')
    .neq('status', 'removed')
    .neq('id', exceptId);
  if (error) throw new Error(`Database error: ${error.message}`);
  return count ?? 0;
}

const lastCoordinator = () => new ApiError(409, 'last_coordinator', 'The home needs at least one coordinator');

export async function patchMember({ home, me }: HomeAccess, target: MemberRow, body: MemberPatch): Promise<Member> {
  const self = target.id === me.id;
  const isCoordinator = me.role === 'coordinator';
  if (!isCoordinator && !self) throw forbidden('Only a coordinator can change other people');
  if (!isCoordinator && (body.role !== undefined || body.canAuthorise !== undefined)) {
    throw forbidden('Only a coordinator can change roles and approval rights');
  }
  if (target.role === 'coordinator' && body.role && body.role !== 'coordinator' && (await otherCoordinators(home.id, target.id)) === 0) {
    throw lastCoordinator();
  }
  const role = body.role ?? target.role;
  const update: Partial<MemberRow> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.city !== undefined) update.city = body.city;
  if (body.role !== undefined) update.role = body.role;
  if (body.canAuthorise !== undefined || role === 'viewer') update.can_authorise = role === 'viewer' ? false : !!body.canAuthorise;
  const updated = await one<MemberRow>(db().from('members').update(update).eq('id', target.id).select('*').single());

  const changes: string[] = [];
  if (body.role !== undefined && body.role !== target.role) changes.push(`role to ${ROLE_LABELS[body.role].toLowerCase()}`);
  if (updated.can_authorise !== target.can_authorise) changes.push(updated.can_authorise ? 'can approve local visits' : "can't approve local visits");
  const who = self ? 'their' : `${firstName(target.name)}'s`;
  const message = changes.length
    ? self && changes.length === 1 && changes[0].startsWith('can')
      ? `${firstName(me.name)} ${changes[0]}`
      : `${firstName(me.name)} updated ${who} details: ${changes.join(', ')}`
    : `${firstName(me.name)} updated ${who} details`;
  await logActivity({ homeId: home.id, type: 'member_updated', actorLabel: me.name, actorMemberId: me.id, message });
  return memberView(updated);
}

export async function removeMember({ home, me }: HomeAccess, target: MemberRow): Promise<void> {
  if (target.role === 'coordinator' && (await otherCoordinators(home.id, target.id)) === 0) throw lastCoordinator();
  await exec(db().from('members').update({ status: 'removed' }).eq('id', target.id));
  await unassignMember(target.id);
  await logActivity({
    homeId: home.id,
    type: 'member_removed',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} removed ${firstName(target.name)} from the home`,
  });
}

/* ---------------- joining by link (8.9) ---------------- */

async function memberByToken(token: string): Promise<{ member: MemberRow; home: HomeRow }> {
  const member = await row<MemberRow>(db().from('members').select('*').eq('join_token', token).maybeSingle());
  if (!member) throw notFound('Invitation');
  const home = await one<HomeRow>(db().from('homes').select('*').eq('id', member.home_id).single());
  return { member, home };
}

export async function joinView(token: string): Promise<JoinView> {
  const { member, home } = await memberByToken(token);
  if (member.status === 'removed') throw new ApiError(403, 'removed', 'This invitation is no longer active');
  const inviter = member.invited_by
    ? await row<MemberRow>(db().from('members').select('*').eq('id', member.invited_by).maybeSingle())
    : null;
  return {
    member: await memberView(member),
    home: { id: home.id, addressLine: home.address_line, city: home.city, estateName: home.estate_name },
    invitedBy: inviter?.name ?? null,
  };
}

export async function joinByToken(token: string): Promise<ActorGrant> {
  const { member, home } = await memberByToken(token);
  if (member.status === 'removed') throw new ApiError(403, 'removed', 'This invitation is no longer active');
  if (member.status === 'invited') {
    await exec(db().from('members').update({ status: 'joined', joined_at: new Date().toISOString() }).eq('id', member.id));
    await logActivity({
      homeId: home.id,
      type: 'member_joined',
      actorLabel: member.name,
      actorMemberId: member.id,
      message: `${firstName(member.name)} joined the family's plan`,
    });
  }
  return { homeId: home.id, memberId: member.id, actor: `member:${member.id}` };
}

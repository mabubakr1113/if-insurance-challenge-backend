import type { AcceptInviteBody, ActorGrant, DeclineReason, InviteView } from '@/lib/contract';
import { ApiError, invalidState, notFound } from '@/lib/errors';
import { CLOSED_STATUSES, exec, one, row, type HomeRow, type MemberRow } from '@/lib/db';
import { db } from '@/lib/supabase';
import { firstName } from '@/lib/time';
import { logActivity } from './activity';

export const INVITE_FROM = 'If estate support';

async function homeByToken(token: string): Promise<HomeRow> {
  const home = await row<HomeRow>(db().from('homes').select('*').eq('invite_token', token).maybeSingle());
  if (!home) throw notFound('Invitation');
  return home;
}

async function firstCoordinator(homeId: string): Promise<MemberRow | null> {
  return row<MemberRow>(
    db().from('members').select('*').eq('home_id', homeId).eq('role', 'coordinator').neq('status', 'removed').order('created_at').limit(1).maybeSingle(),
  );
}

export async function getInvite(token: string): Promise<InviteView> {
  const home = await homeByToken(token);
  const coordinator = await firstCoordinator(home.id);
  const whose = home.estate_name ? `${home.estate_name}'s home` : 'the home';
  return {
    token,
    status: home.status,
    home: { id: home.id, addressLine: home.address_line, postalCode: home.postal_code, city: home.city, estateName: home.estate_name },
    fromLabel: INVITE_FROM,
    message: `We're sorry for your loss. If you're looking after ${whose} at ${home.address_line}, ${home.city}, Home Watch can help the family keep it safe while it's empty.`,
    alreadyAcceptedBy: coordinator ? { id: coordinator.id, name: coordinator.name } : null,
  };
}

/** invited → setup, with the accepting person as coordinator (8.1). */
export async function acceptInvite(token: string, body: AcceptInviteBody): Promise<ActorGrant> {
  const home = await homeByToken(token);
  if (CLOSED_STATUSES.includes(home.status)) throw new ApiError(409, 'home_closed', 'This invitation is closed');
  if (home.status !== 'invited' || (await firstCoordinator(home.id))) {
    throw new ApiError(409, 'already_accepted', 'This invitation was already accepted');
  }
  const member = await one<MemberRow>(
    db()
      .from('members')
      .insert({
        home_id: home.id,
        name: body.name,
        relation: body.relation,
        email: body.email ?? null,
        phone: body.phone ?? null,
        city: body.city ?? null,
        role: 'coordinator',
        status: 'joined',
        can_authorise: false,
        joined_at: new Date().toISOString(),
      })
      .select('*')
      .single(),
  );
  await exec(db().from('homes').update({ status: 'setup', setup_started_at: new Date().toISOString() }).eq('id', home.id));
  await logActivity({
    homeId: home.id,
    type: 'member_joined',
    actorLabel: member.name,
    actorMemberId: member.id,
    message: `${firstName(member.name)} accepted the invitation`,
  });
  return { homeId: home.id, memberId: member.id, actor: `member:${member.id}` };
}

const DECLINE_MESSAGES: Record<DeclineReason, string> = {
  someone_lives_there: 'The invitation was closed: someone still lives in the home',
  not_now: 'The invitation was put off for now',
  not_responsible: 'The invitation was forwarded to someone else in the family',
};

export async function declineInvite(token: string, reason: DeclineReason): Promise<void> {
  const home = await homeByToken(token);
  if (reason === 'someone_lives_there') {
    if (home.status !== 'invited' && home.status !== 'setup') throw invalidState('This plan is already active or closed');
    await exec(
      db()
        .from('homes')
        .update({ status: 'declined', close_reason: 'Someone still lives in the home', closed_at: new Date().toISOString() })
        .eq('id', home.id),
    );
  }
  await logActivity({ homeId: home.id, type: 'home_updated', actorLabel: 'Home Watch', message: DECLINE_MESSAGES[reason] });
}

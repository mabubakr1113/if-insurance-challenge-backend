import type { NextRequest } from 'next/server';
import {
  CLOSED_STATUSES,
  exec,
  isUuid,
  row,
  type BookingRow,
  type HomeRow,
  type MemberRow,
  type NoteRow,
  type PartnerRow,
  type PhotoRow,
  type TaskRow,
  type VisitRow,
} from './db';
import { ApiError, forbidden, notFound } from './errors';
import { logActivity } from './services/activity';
import { db, usesMemoryStore } from './supabase';
import { firstName } from './time';

export const STAFF_LABEL = 'If pilot team';
export const SYSTEM_LABEL = 'Home Watch';

export type MemberActor = { kind: 'member'; member: MemberRow; home: HomeRow; label: string };
export type PartnerActor = { kind: 'partner'; partner: PartnerRow; label: string };
export type StaffActor = { kind: 'staff'; label: string };
export type Actor = MemberActor | PartnerActor | StaffActor;

/* ---------------- loaders ---------------- */

export async function loadHome(id: string): Promise<HomeRow | null> {
  if (!isUuid(id)) return null;
  return row<HomeRow>(db().from('homes').select('*').eq('id', id).maybeSingle());
}

async function loadById<T>(table: string, id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  return row<T>(db().from(table).select('*').eq('id', id).maybeSingle());
}

/* ---------------- actor (6.2) ---------------- */

/** Parses X-Actor. Returns null when it's missing or unknown. Auto-joins invited members (demo persona switching). */
export async function resolveActor(header: string | null): Promise<Actor | null> {
  const value = header?.trim();
  if (!value) return null;
  if (value === 'staff') return { kind: 'staff', label: STAFF_LABEL };
  const match = /^(member|partner):(.+)$/.exec(value);
  if (!match || !isUuid(match[2])) return null;

  if (match[1] === 'partner') {
    const partner = await loadById<PartnerRow>('partners', match[2]);
    return partner ? { kind: 'partner', partner, label: partner.name } : null;
  }

  // Resolve membership and its home in one database round trip. Keep permissions request-local:
  // a removed member or a changed role must take effect on the very next request.
  const joined = usesMemoryStore()
    ? null
    : await row<MemberRow & { home: HomeRow | null }>(
        db().from('members').select('*,home:homes!members_home_id_fkey(*)').eq('id', match[2]).maybeSingle(),
      );
  const member = usesMemoryStore() ? await loadById<MemberRow>('members', match[2]) : joined;
  if (!member) return null;
  if (member.status === 'removed') throw new ApiError(403, 'removed', 'You are no longer part of this home');
  const home = usesMemoryStore() ? await loadHome(member.home_id) : joined?.home;
  if (!home) return null;
  if (member.status === 'invited') {
    const joinedAt = new Date().toISOString();
    await exec(db().from('members').update({ status: 'joined', joined_at: joinedAt }).eq('id', member.id));
    member.status = 'joined';
    member.joined_at = joinedAt;
    await logActivity({
      homeId: home.id,
      type: 'member_joined',
      actorLabel: member.name,
      actorMemberId: member.id,
      message: `${firstName(member.name)} joined the family's plan`,
    });
  }
  return { kind: 'member', member, home, label: member.name };
}

/* ---------------- permission codes (7.3) ---------------- */

export type HomePerm = 'M' | 'H' | 'C' | 'A';

export function hasPerm(m: MemberRow, perm: HomePerm): boolean {
  switch (perm) {
    case 'M':
      return m.status !== 'removed';
    case 'H':
      return m.role === 'helper' || m.role === 'coordinator';
    case 'C':
      return m.role === 'coordinator';
    case 'A':
      return m.can_authorise && m.role !== 'viewer';
  }
}

const PERM_MESSAGES: Record<HomePerm, string> = {
  M: "You're not part of this home",
  H: 'Viewers can read and comment only',
  C: 'Only a coordinator can do this',
  A: 'Only someone who can authorise access can do this',
};

const isWrite = (req: NextRequest) => req.method !== 'GET' && req.method !== 'HEAD';

export function assertOpen(home: HomeRow, req: NextRequest): void {
  if (isWrite(req) && CLOSED_STATUSES.includes(home.status)) {
    throw new ApiError(409, 'home_closed', 'This home plan is closed. Everything stays readable.');
  }
}

export interface HomeAccess {
  home: HomeRow;
  me: MemberRow;
  actor: MemberActor;
}

/** The actor must be a member of this home with the given permission. Writes on closed homes → 409. */
export async function homeAccess(actor: Actor | null, homeId: string, perm: HomePerm, req: NextRequest): Promise<HomeAccess> {
  const home = actor?.kind === 'member' && actor.home.id === homeId ? actor.home : await loadHome(homeId);
  if (!home) throw notFound('Home');
  if (actor?.kind !== 'member' || actor.member.home_id !== home.id) throw forbidden("You don't have access to this home");
  if (!hasPerm(actor.member, perm)) throw forbidden(PERM_MESSAGES[perm]);
  assertOpen(home, req);
  return { home, me: actor.member, actor };
}

export async function taskAccess(actor: Actor | null, taskId: string, perm: HomePerm, req: NextRequest) {
  const task = await loadById<TaskRow>('tasks', taskId);
  if (!task) throw notFound('Task');
  return { ...(await homeAccess(actor, task.home_id, perm, req)), task };
}

export async function noteAccess(actor: Actor | null, noteId: string, perm: HomePerm, req: NextRequest) {
  const note = await loadById<NoteRow>('house_notes', noteId);
  if (!note) throw notFound('Note');
  return { ...(await homeAccess(actor, note.home_id, perm, req)), note };
}

export async function photoAccess(actor: Actor | null, photoId: string, perm: HomePerm, req: NextRequest) {
  const photo = await loadById<PhotoRow>('photos', photoId);
  if (!photo) throw notFound('Photo');
  return { ...(await homeAccess(actor, photo.home_id, perm, req)), photo };
}

export async function bookingAccess(actor: Actor | null, bookingId: string, perm: HomePerm, req: NextRequest) {
  const booking = await loadById<BookingRow>('bookings', bookingId);
  if (!booking) throw notFound('Booking');
  return { ...(await homeAccess(actor, booking.home_id, perm, req)), booking };
}

export async function memberTargetAccess(actor: Actor | null, memberId: string, req: NextRequest) {
  const target = await loadById<MemberRow>('members', memberId);
  if (!target || target.status === 'removed') throw notFound('Member');
  return { ...(await homeAccess(actor, target.home_id, 'M', req)), target };
}

/* ---------------- partner access ---------------- */

export function requirePartner(actor: Actor | null): PartnerActor {
  if (actor?.kind !== 'partner') throw forbidden('This is for the visit partner');
  return actor;
}

export function requireStaff(actor: Actor | null): StaffActor {
  if (actor?.kind !== 'staff') throw forbidden("This is for If's pilot team");
  return actor;
}

/** P: the partner the booking is assigned to. */
export async function partnerJobAccess(actor: Actor | null, bookingId: string, req: NextRequest) {
  const partner = requirePartner(actor);
  const booking = await loadById<BookingRow>('bookings', bookingId);
  if (!booking) throw notFound('Visit request');
  if (booking.partner_id !== partner.partner.id) throw forbidden('This visit is assigned to another partner');
  const home = await loadHome(booking.home_id);
  if (!home) throw notFound('Home');
  assertOpen(home, req);
  return { partner, booking, home };
}

/** True when the partner has a booking at this home in one of the given statuses. */
async function partnerHasBooking(partnerId: string, homeId: string, statuses: string[]): Promise<boolean> {
  const { count, error } = await db()
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', partnerId)
    .eq('home_id', homeId)
    .in('status', statuses);
  if (error) throw new Error(`Database error: ${error.message}`);
  return (count ?? 0) > 0;
}

export type HomeOrPartnerAccess =
  | ({ kind: 'member' } & HomeAccess)
  | { kind: 'partner'; home: HomeRow; partner: PartnerActor };

/**
 * A member with `perm`, or a partner with a booking at this home. `activeOnly` limits partners to bookings
 * that are requested, confirmed or in progress (photo uploads).
 */
export async function homeOrPartnerAccess(
  actor: Actor | null,
  homeId: string,
  perm: HomePerm,
  req: NextRequest,
  activeOnly: boolean,
): Promise<HomeOrPartnerAccess> {
  if (actor?.kind === 'partner') {
    const home = await loadHome(homeId);
    if (!home) throw notFound('Home');
    const statuses = activeOnly
      ? ['requested', 'confirmed', 'in_progress']
      : ['requested', 'confirmed', 'in_progress', 'completed', 'declined', 'cancelled'];
    if (!(await partnerHasBooking(actor.partner.id, home.id, statuses))) throw forbidden('You have no visit at this home');
    assertOpen(home, req);
    return { kind: 'partner', home, partner: actor };
  }
  return { kind: 'member', ...(await homeAccess(actor, homeId, perm, req)) };
}

/** Visits: a member of the home, or the partner whose booking produced the visit. */
export async function visitAccess(actor: Actor | null, visitId: string, req: NextRequest) {
  const visit = await loadById<VisitRow>('visits', visitId);
  if (!visit) throw notFound('Visit');
  if (actor?.kind === 'partner') {
    if (!visit.booking_id || visit.partner_id !== actor.partner.id) throw forbidden('This visit belongs to another partner');
    const home = await loadHome(visit.home_id);
    if (!home) throw notFound('Home');
    return { visit, home };
  }
  const { home } = await homeAccess(actor, visit.home_id, 'M', req);
  return { visit, home };
}

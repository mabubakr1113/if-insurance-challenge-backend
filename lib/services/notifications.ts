import type { Notification, NotificationChannel, NotificationsResponse } from '@/lib/contract';
import { exec, rows, type MemberRow, type NotificationRow } from '@/lib/db';
import { db } from '@/lib/supabase';
import type { Actor } from '@/lib/auth';

export interface NotificationInput {
  homeId: string | null;
  channel: NotificationChannel;
  title: string;
  body: string;
  link?: string | null;
}

interface Recipients {
  memberIds?: string[];
  partnerIds?: string[];
  /** Never notify the actor about their own action. */
  exceptMemberId?: string | null;
}

/** Stores one row per recipient. SMS and email are simulated: they are only shown in the app. */
export async function notify(to: Recipients, n: NotificationInput): Promise<void> {
  const memberIds = [...new Set(to.memberIds ?? [])].filter((id) => id !== to.exceptMemberId);
  const partnerIds = [...new Set(to.partnerIds ?? [])];
  const base = { home_id: n.homeId, channel: n.channel, title: n.title, body: n.body, link: n.link ?? null };
  const payload = [
    ...memberIds.map((member_id) => ({ ...base, member_id })),
    ...partnerIds.map((partner_id) => ({ ...base, partner_id })),
  ];
  if (payload.length) await exec(db().from('notifications').insert(payload));
}

/* ---------------- recipient lists ---------------- */

export async function homeMembers(homeId: string): Promise<MemberRow[]> {
  return rows<MemberRow>(db().from('members').select('*').eq('home_id', homeId).neq('status', 'removed'));
}

export const joinedIds = (members: MemberRow[]) => members.filter((m) => m.status === 'joined').map((m) => m.id);
export const coordinatorIds = (members: MemberRow[]) =>
  members.filter((m) => m.status !== 'removed' && m.role === 'coordinator').map((m) => m.id);
export const authorisedIds = (members: MemberRow[]) =>
  members.filter((m) => m.status !== 'removed' && m.can_authorise && m.role !== 'viewer').map((m) => m.id);

/* ---------------- reading ---------------- */

export function mapNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    homeId: r.home_id,
    channel: r.channel,
    title: r.title,
    body: r.body,
    link: r.link,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

function scope(actor: Actor): { column: 'member_id' | 'partner_id'; id: string } | null {
  if (actor.kind === 'member') return { column: 'member_id', id: actor.member.id };
  if (actor.kind === 'partner') return { column: 'partner_id', id: actor.partner.id };
  return null;
}

export async function unreadCount(actor: Actor): Promise<number> {
  const s = scope(actor);
  if (!s) return 0;
  const { count, error } = await db()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq(s.column, s.id)
    .is('read_at', null);
  if (error) throw new Error(`Database error: ${error.message}`);
  return count ?? 0;
}

export async function listNotifications(actor: Actor): Promise<NotificationsResponse> {
  const s = scope(actor);
  if (!s) return { items: [], unread: 0 };
  const data = await rows<NotificationRow>(
    db().from('notifications').select('*').eq(s.column, s.id).order('created_at', { ascending: false }).limit(100),
  );
  return { items: data.map(mapNotification), unread: await unreadCount(actor) };
}

export async function markRead(actor: Actor, ids?: string[]): Promise<void> {
  const s = scope(actor);
  if (!s) return;
  let q = db().from('notifications').update({ read_at: new Date().toISOString() }).eq(s.column, s.id).is('read_at', null);
  if (ids?.length) q = q.in('id', ids);
  await exec(q);
}

import type { Activity, ActivityType } from '@/lib/contract';
import { exec, rows, type ActivityRow } from '@/lib/db';
import { db } from '@/lib/supabase';

export interface ActivityInput {
  homeId: string;
  type: ActivityType;
  actorLabel: string;
  actorMemberId?: string | null;
  message: string;
  taskId?: string | null;
  visitId?: string | null;
  bookingId?: string | null;
  createdAt?: string;
}

export function activityRow(a: ActivityInput) {
  return {
    home_id: a.homeId,
    type: a.type,
    actor_label: a.actorLabel,
    actor_member_id: a.actorMemberId ?? null,
    message: a.message,
    task_id: a.taskId ?? null,
    visit_id: a.visitId ?? null,
    booking_id: a.bookingId ?? null,
    ...(a.createdAt ? { created_at: a.createdAt } : {}),
  };
}

export async function logActivity(...items: ActivityInput[]): Promise<void> {
  if (items.length === 0) return;
  await exec(db().from('activity').insert(items.map(activityRow)));
}

export function mapActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    type: r.type as ActivityType,
    actorLabel: r.actor_label,
    message: r.message,
    taskId: r.task_id,
    visitId: r.visit_id,
    bookingId: r.booking_id,
    createdAt: r.created_at,
  };
}

/** Newest first. */
export async function listActivity(homeId: string, limit = 50): Promise<Activity[]> {
  const data = await rows<ActivityRow>(
    db().from('activity').select('*').eq('home_id', homeId).order('created_at', { ascending: false }).limit(limit),
  );
  return data.map(mapActivity);
}

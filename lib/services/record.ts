import type { HomeRecord } from '@/lib/contract';
import { rows, type HomeRow, type TaskRow, type VisitRow, type WeatherAlertRow } from '@/lib/db';
import { mapAlert, mapHome, sortPlan } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { listActivity } from './activity';
import { listBookings } from './bookings';
import { listMembers } from './members';
import { homeTaskRows, taskViews, visitViews } from './views';

export const RECORD_DISCLAIMER =
  'This record lists observations and actions entered by family members and visit partners. It is not an insurance decision. Claims are assessed under the policy terms, including cover, exclusions, limits and deductibles.';

export async function buildRecord(home: HomeRow): Promise<HomeRecord> {
  const [members, visitRows, taskRows, bookings, alerts, activity] = await Promise.all([
    listMembers(home.id),
    rows<VisitRow>(db().from('visits').select('*').eq('home_id', home.id).order('visited_at', { ascending: false })),
    homeTaskRows(home.id),
    listBookings(home.id),
    rows<WeatherAlertRow>(db().from('weather_alerts').select('*').eq('home_id', home.id).order('created_at', { ascending: false })),
    listActivity(home.id, 1000),
  ]);
  const tasks = sortPlan(await taskViews(taskRows));
  const byId = new Map<string, TaskRow>(taskRows.map((t) => [t.id, t]));
  return {
    home: mapHome(home),
    generatedAt: new Date().toISOString(),
    members,
    visits: await visitViews(visitRows),
    completedTasks: tasks.filter((t) => t.status === 'done'),
    openTasks: tasks.filter((t) => t.status === 'open' || t.status === 'accepted'),
    bookings,
    alerts: alerts.map((a) => mapAlert(a, a.task_id ? byId.get(a.task_id) : undefined)),
    activity,
    disclaimer: RECORD_DISCLAIMER,
  };
}

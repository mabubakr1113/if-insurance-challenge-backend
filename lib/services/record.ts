import type { HomeRecord } from '@/lib/contract';
import { rows, type BookingRow, type HomeRow, type PhotoRow, type TaskRow, type VisitRow, type WeatherAlertRow } from '@/lib/db';
import { mapAlert, mapHome, mapMember, memberStats, nameMap, sortMembers, sortPlan } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { listActivity } from './activity';
import { allMembers, bookingViews, homeTaskRows, taskViews, visitViews } from './views';

export const RECORD_DISCLAIMER =
  'This record lists observations and actions entered by family members and visit partners. It is not an insurance decision. Claims are assessed under the policy terms, including cover, exclusions, limits and deductibles.';

export async function buildRecord(home: HomeRow): Promise<HomeRecord> {
  const [memberRows, visitRows, taskRows, bookingRows, alerts, activity, photos] = await Promise.all([
    allMembers(home.id),
    rows<VisitRow>(db().from('visits').select('*').eq('home_id', home.id).order('visited_at', { ascending: false })),
    homeTaskRows(home.id),
    rows<BookingRow>(db().from('bookings').select('*').eq('home_id', home.id).order('created_at', { ascending: false })),
    rows<WeatherAlertRow>(db().from('weather_alerts').select('*').eq('home_id', home.id).order('created_at', { ascending: false })),
    listActivity(home.id, 1000),
    rows<PhotoRow>(db().from('photos').select('*').eq('home_id', home.id).not('visit_id', 'is', null).order('created_at')),
  ]);
  const names = nameMap(memberRows);
  const tasks = sortPlan(await taskViews(taskRows, names));
  const members = sortMembers(memberRows.filter((m) => m.status !== 'removed')).map((m) => mapMember(m, memberStats(m, taskRows, visitRows)));
  const [bookings, visits] = await Promise.all([
    bookingViews(bookingRows, { members: memberRows, tasks: taskRows, visits: visitRows }),
    visitViews(visitRows, { photos, tasks: [...taskRows].sort((a, b) => a.created_at.localeCompare(b.created_at)), names }),
  ]);
  const byId = new Map<string, TaskRow>(taskRows.map((t) => [t.id, t]));
  return {
    home: mapHome(home),
    generatedAt: new Date().toISOString(),
    members,
    visits,
    completedTasks: tasks.filter((t) => t.status === 'done'),
    openTasks: tasks.filter((t) => t.status === 'open' || t.status === 'accepted'),
    bookings,
    alerts: alerts.map((a) => mapAlert(a, a.task_id ? byId.get(a.task_id) : undefined)),
    activity,
    disclaimer: RECORD_DISCLAIMER,
  };
}

import type { HomeStatus, Insights, SupervisionState } from '@/lib/contract';
import {
  rows,
  type BookingRow,
  type HomeRow,
  type MemberRow,
  type TaskRow,
  type VisitRow,
  type WeatherAlertRow,
} from '@/lib/db';
import { isOverdue, needsOwner } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { DAY, HOUR, addDays, atHelsinki, daysBetween, today, ymd } from '@/lib/time';
import { supervisionFor } from './homes';

const CLOSED: HomeStatus[] = ['occupied', 'sold', 'transferred', 'closed'];
const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) / 100 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const ms = (iso: string) => new Date(iso).getTime();

const TABLE_ORDER: Record<HomeStatus, number> = {
  active: 0,
  setup: 1,
  invited: 2,
  occupied: 3,
  sold: 3,
  transferred: 3,
  closed: 3,
  declined: 4,
};

/** Pilot metrics, computed live from every home (12). The data is small, so it's plain queries + TypeScript. */
export async function insights(): Promise<Insights> {
  const [homes, members, tasks, visits, bookings, alerts] = await Promise.all([
    rows<HomeRow>(db().from('homes').select('*')),
    rows<MemberRow>(db().from('members').select('*')),
    rows<TaskRow>(db().from('tasks').select('*')),
    rows<VisitRow>(db().from('visits').select('*')),
    rows<BookingRow>(db().from('bookings').select('*')),
    rows<WeatherAlertRow>(db().from('weather_alerts').select('*')),
  ]);
  const now = Date.now();
  const monthAgo = now - 30 * DAY;
  const todayStr = today();

  const by = <T extends { home_id: string }>(list: T[], homeId: string) => list.filter((x) => x.home_id === homeId);
  const activated = homes.filter((h) => h.activated_at);
  const activeHomes = homes.filter((h) => h.status === 'active');
  const activatedIds = new Set(activated.map((h) => h.id));
  const activeIds = new Set(activeHomes.map((h) => h.id));
  const declined = homes.filter((h) => h.status === 'declined').length;

  // family
  const liveMembers = members.filter((m) => m.status !== 'removed');
  const membersInActivated = liveMembers.filter((m) => activatedIds.has(m.home_id));
  const joined = liveMembers.filter((m) => m.status === 'joined').length;
  const invitedOnly = liveMembers.filter((m) => m.status === 'invited').length;

  // responsibility
  const important = tasks.filter(
    (t) => activatedIds.has(t.home_id) && (t.priority === 'urgent' || t.priority === 'high') && ms(t.created_at) < now - 48 * HOUR,
  );
  const acceptedFast = important.filter((t) => t.accepted_at && ms(t.accepted_at) - ms(t.created_at) <= 48 * HOUR).length;
  const hoursToFirst = activated
    .map((h) => {
      const accepted = by(tasks, h.id)
        .map((t) => t.accepted_at)
        .filter((a): a is string => !!a)
        .sort();
      return accepted[0] ? Math.max(0, (ms(accepted[0]) - ms(h.activated_at as string)) / HOUR) : null;
    })
    .filter((n): n is number => n !== null);
  const activeTasks = tasks.filter((t) => activeIds.has(t.home_id));

  // supervision
  const supervision = new Map<string, SupervisionState>();
  for (const h of activeHomes) supervision.set(h.id, supervisionFor(h, by(visits, h.id)).state);
  const overdueHomes = activeHomes.filter((h) => {
    const state = supervision.get(h.id);
    return state === 'overdue' || (state === 'no_visit_yet' && ms(h.activated_at as string) < now - 7 * DAY);
  }).length;

  // weather
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const alertsWithTask = alerts.filter((a) => a.task_id && taskById.has(a.task_id));
  const actioned = alertsWithTask.filter((a) => {
    const t = taskById.get(a.task_id as string);
    return t?.status === 'done' && t.completed_at && ms(t.completed_at) < atHelsinki(addDays(a.for_date, 1), '00:00').getTime();
  }).length;

  // paid visits
  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const convertedHomes = new Set(
    bookings.filter((b) => ['confirmed', 'in_progress', 'completed'].includes(b.status) && activatedIds.has(b.home_id)).map((b) => b.home_id),
  );
  const revenue = completedBookings.reduce((sum, b) => sum + b.if_fee_cents, 0);

  const homesWith = (list: { home_id: string }[]) => new Set(list.map((x) => x.home_id)).size;
  const mainInvited = (h: HomeRow) => h.demo_group === 'main' && h.status === 'invited';

  return {
    generatedAt: new Date().toISOString(),
    dataNote: 'Demo data: 2 story homes and 12 generated background homes. Not real customers.',
    homes: {
      invited: homes.length,
      setupStarted: homes.filter((h) => h.setup_started_at).length,
      active: activeHomes.length,
      closed: homes.filter((h) => CLOSED.includes(h.status)).length,
      declined,
      setupCompletionRate: rate(activated.length, homes.length - declined),
    },
    family: {
      avgMembersPerHome: activated.length ? round1(membersInActivated.length / activated.length) : 0,
      joinedRate: rate(joined, joined + invitedOnly),
    },
    tasks: {
      acceptedWithin48hRate: rate(acceptedFast, important.length),
      avgHoursToFirstAccepted: hoursToFirst.length ? round1(hoursToFirst.reduce((a, b) => a + b, 0) / hoursToFirst.length) : null,
      overdueNow: activeTasks.filter((t) => isOverdue(t, now)).length,
      needsOwnerNow: activeTasks.filter((t) => needsOwner(t, now)).length,
      completedLast30d: tasks.filter((t) => t.completed_at && ms(t.completed_at) >= monthAgo).length,
    },
    supervision: {
      onTimeRate: rate([...supervision.values()].filter((s) => s === 'ok' || s === 'due_soon').length, activeHomes.length),
      overdueHomes,
    },
    weather: {
      alertsLast30d: alerts.filter((a) => ms(a.created_at) >= monthAgo).length,
      actionedBeforeDateRate: rate(actioned, alertsWithTask.length),
    },
    visits: {
      familyLast30d: visits.filter((v) => v.visitor_type === 'family' && ms(v.visited_at) >= monthAgo).length,
      partnerLast30d: visits.filter((v) => v.visitor_type === 'partner' && ms(v.visited_at) >= monthAgo).length,
    },
    paidVisits: {
      requested: bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'declined').length,
      completed: completedBookings.length,
      conversionRate: rate(convertedHomes.size, activated.length),
      serviceRevenueCents: revenue,
      avgIfFeeCents: completedBookings.length ? Math.round(revenue / completedBookings.length) : 0,
    },
    transitions: {
      occupied: homes.filter((h) => h.status === 'occupied').length,
      sold: homes.filter((h) => h.status === 'sold').length,
      transferred: homes.filter((h) => h.status === 'transferred').length,
      closed: homes.filter((h) => h.status === 'closed').length,
      coverHelpRequested: homes.filter((h) => h.new_owner_wants_cover_help === true).length,
    },
    funnel: [
      { stage: 'Invited', count: homes.length },
      { stage: 'Set up', count: activated.length },
      { stage: 'First task accepted', count: homesWith(tasks.filter((t) => t.accepted_at)) },
      { stage: 'First visit recorded', count: homesWith(visits) },
      { stage: 'Paid visit completed', count: homesWith(completedBookings) },
    ],
    homesTable: homes
      .filter((h) => !mainInvited(h))
      .map((h) => ({
        id: h.id,
        city: h.city,
        status: h.status,
        daysActive: h.activated_at ? daysBetween(ymd(h.activated_at), h.closed_at ? ymd(h.closed_at) : todayStr) : null,
        supervision: supervision.get(h.id) ?? null,
        openTasks: by(tasks, h.id).filter((t) => t.status === 'open' || t.status === 'accepted').length,
        paidVisits: by(completedBookings, h.id).length,
      }))
      .sort((a, b) => TABLE_ORDER[a.status] - TABLE_ORDER[b.status] || (b.daysActive ?? -1) - (a.daysActive ?? -1)),
    assumptions: [
      { label: 'If coordination fee', value: '€10–€20 per visit (placeholder)' },
      { label: 'Partner price', value: '€59–€99 per visit (placeholder)' },
      { label: 'Service revenue', value: "If's fee only; partner payments pass through" },
      { label: 'Avoided claims', value: 'Not estimated in the prototype' },
      { label: 'Weather thresholds', value: '−15 °C hard frost, −5 °C frost, 20 m/s gusts, 20 cm snow (demo assumptions)' },
    ],
  };
}

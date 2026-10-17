import type { Dashboard, Home, HomeSetupPatch, Supervision, Task, TransitionBody } from '@/lib/contract';
import type { HomeAccess } from '@/lib/auth';
import { BUILDING_LABELS, HEATING_LABELS, WATER_LABELS, YES_NO_LABELS } from '@/lib/catalog';
import { ApiError, invalidState } from '@/lib/errors';
import { exec, one, rows, type BookingRow, type HomeRow, type TaskRow, type VisitRow } from '@/lib/db';
import { compareActive, essentialsFor, mapHome, mapMember, memberStats, nameMap, sortMembers, sortPlan } from '@/lib/mappers';
import { generatePlan } from '@/lib/plan/generate';
import { terms } from '@/lib/plan/templates';
import { db } from '@/lib/supabase';
import { DAY, daysBetween, dueAfter, firstName, fmtDate, today, ymd } from '@/lib/time';
import { listActivity, logActivity } from './activity';
import { homeMembers, joinedIds, notify } from './notifications';
import { homeNoteRows } from './notes';
import { insertTasks } from './tasks';
import { allMembers, bookingView, homeTaskRows, taskViews } from './views';
import { getWeather, refetch, runRules } from './weather';

const isActive = (t: { status: string }) => t.status === 'open' || t.status === 'accepted';

/* ---------------- supervision (8.6) ---------------- */

export const SUPERVISION_RULE = "If's home terms describe supervision of an empty home as a visit at least monthly.";

export function supervisionFor(home: HomeRow, visits: VisitRow[]): Supervision {
  const last = [...visits].sort((a, b) => b.visited_at.localeCompare(a.visited_at))[0];
  const base = { ruleLabel: SUPERVISION_RULE, source: terms('§5') };
  if (!last) {
    return {
      ...base,
      state: 'no_visit_yet',
      lastVisitAt: null,
      lastVisitorName: null,
      daysSinceLastVisit: null,
      nextDueAt: dueAfter(home.activated_at ?? new Date(), 3).toISOString(),
    };
  }
  const days = daysBetween(ymd(last.visited_at), today());
  return {
    ...base,
    state: days <= 21 ? 'ok' : days <= 30 ? 'due_soon' : 'overdue',
    lastVisitAt: last.visited_at,
    lastVisitorName: last.visitor_name,
    daysSinceLastVisit: days,
    nextDueAt: new Date(new Date(last.visited_at).getTime() + 30 * DAY).toISOString(),
  };
}

/* ---------------- setup (8.1) ---------------- */

const FIELDS: { key: keyof HomeSetupPatch; column: keyof HomeRow; phrase: (v: unknown) => string }[] = [
  { key: 'occupancyConfirmed', column: 'occupancy_confirmed', phrase: (v) => (v ? 'confirmed nobody lives there' : 'occupancy not confirmed') },
  { key: 'vacantSince', column: 'vacant_since', phrase: (v) => (v ? `empty since ${fmtDate(String(v))}` : 'empty-since date cleared') },
  { key: 'lastKnownVisit', column: 'last_known_visit', phrase: (v) => (v ? `last visited ${fmtDate(String(v))}` : 'last visit cleared') },
  { key: 'authorityConfirmed', column: 'authority_confirmed', phrase: (v) => (v ? 'confirmed someone can authorise access' : 'authority not confirmed yet') },
  { key: 'keyHolder', column: 'key_holder', phrase: () => 'key holder updated' },
  { key: 'accessNotes', column: 'access_notes', phrase: () => 'access notes updated' },
  { key: 'buildingType', column: 'building_type', phrase: (v) => `building type: ${v ? BUILDING_LABELS[v as keyof typeof BUILDING_LABELS].toLowerCase() : 'not set'}` },
  { key: 'yearBuilt', column: 'year_built', phrase: (v) => (v ? `built in ${v}` : 'year built cleared') },
  { key: 'heatingType', column: 'heating_type', phrase: (v) => `heating set to ${v ? HEATING_LABELS[v as keyof typeof HEATING_LABELS].toLowerCase() : 'not set'}` },
  { key: 'heatingOn', column: 'heating_on', phrase: (v) => `heating on: ${v ? YES_NO_LABELS[v as keyof typeof YES_NO_LABELS].toLowerCase() : 'not set'}` },
  { key: 'waterSource', column: 'water_source', phrase: (v) => `water: ${v ? WATER_LABELS[v as keyof typeof WATER_LABELS].toLowerCase() : 'not set'}` },
  { key: 'waterMainClosed', column: 'water_main_closed', phrase: (v) => `water main closed: ${v ? YES_NO_LABELS[v as keyof typeof YES_NO_LABELS].toLowerCase() : 'not set'}` },
  { key: 'hasAlarm', column: 'has_alarm', phrase: (v) => `alarm: ${v ? YES_NO_LABELS[v as keyof typeof YES_NO_LABELS].toLowerCase() : 'not set'}` },
];

export async function patchHome({ home, me }: HomeAccess, patch: HomeSetupPatch): Promise<Home> {
  if (home.status !== 'setup' && home.status !== 'active') throw invalidState('The home can be edited during setup or while the plan is active');
  const update: Record<string, unknown> = {};
  const phrases: string[] = [];
  for (const f of FIELDS) {
    const value = patch[f.key];
    if (value === undefined) continue;
    if (home[f.column] === value) continue;
    update[f.column] = value;
    phrases.push(f.phrase(value));
  }
  if (phrases.length === 0) return mapHome(home);
  const updated = await one<HomeRow>(db().from('homes').update(update).eq('id', home.id).select('*').single());
  const summary = phrases.join(', ');
  await logActivity({
    homeId: home.id,
    type: 'home_updated',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} updated the home: ${summary}`,
  });
  return mapHome(updated);
}

export async function activateHome({ home, me }: HomeAccess): Promise<{ home: Home; tasks: Task[] }> {
  if (home.status === 'active') {
    return { home: mapHome(home), tasks: sortPlan(await taskViews(await homeTaskRows(home.id))) };
  }
  if (home.status !== 'setup') throw invalidState('Only a home in setup can be activated');
  if (!home.occupancy_confirmed) {
    throw new ApiError(400, 'occupancy_not_confirmed', 'Confirm that nobody lives in the home before creating the plan');
  }
  const activatedAt = new Date();
  const created = await insertTasks(generatePlan(home, activatedAt));
  let updated = await one<HomeRow>(
    db().from('homes').update({ status: 'active', activated_at: activatedAt.toISOString() }).eq('id', home.id).select('*').single(),
  );
  await logActivity({
    homeId: home.id,
    type: 'home_activated',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `Care plan created with ${created.length} tasks`,
  });
  try {
    updated = await refetch(updated);
    await runRules(updated);
  } catch (err) {
    console.error('Weather after activation failed', err);
  }
  return { home: mapHome(updated), tasks: sortPlan(await taskViews(await homeTaskRows(home.id))) };
}

/* ---------------- transition ---------------- */

const DEFAULT_REASONS = {
  occupied: 'Someone lives there again',
  sold: 'Sold',
  transferred: 'Passed to an heir',
  closed: 'Plan closed',
} as const;

export async function transitionHome({ home, me }: HomeAccess, body: TransitionBody): Promise<Home> {
  if (home.status !== 'active') throw invalidState('Only an active plan can be closed');
  const reason = body.note?.trim() || DEFAULT_REASONS[body.status];
  const wantsCover = body.status === 'sold' || body.status === 'transferred' ? (body.newOwnerWantsCoverHelp ?? false) : null;
  const now = new Date().toISOString();
  const updated = await one<HomeRow>(
    db()
      .from('homes')
      .update({ status: body.status, closed_at: now, close_reason: reason, new_owner_wants_cover_help: wantsCover })
      .eq('id', home.id)
      .select('*')
      .single(),
  );
  await exec(
    db().from('tasks').update({ status: 'cancelled', booking_id: null, updated_at: now }).eq('home_id', home.id).in('status', ['open', 'accepted']),
  );
  const bookings = await rows<BookingRow>(
    db().from('bookings').select('*').eq('home_id', home.id).in('status', ['pending_approval', 'requested', 'confirmed']),
  );
  if (bookings.length) {
    await exec(
      db()
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: now, cancel_reason: 'Home Watch plan closed' })
        .in(
          'id',
          bookings.map((b) => b.id),
        ),
    );
    await exec(db().from('tasks').update({ booking_id: null }).in('booking_id', bookings.map((b) => b.id)));
    for (const b of bookings.filter((x) => x.status !== 'pending_approval')) {
      await notify(
        { partnerIds: [b.partner_id] },
        { homeId: home.id, channel: 'email', title: `Visit cancelled: ${home.address_line}, ${home.city}`, body: 'Reason: Home Watch plan closed', link: `/partner/jobs/${b.id}` },
      );
    }
  }
  const members = await homeMembers(home.id);
  await notify(
    { memberIds: joinedIds(members), exceptMemberId: me.id },
    {
      homeId: home.id,
      channel: 'email',
      title: `The Home Watch plan for ${home.address_line} is closed`,
      body: `${reason}.${wantsCover ? ' If will contact the new owner about cover only if they ask.' : ''} Everything stays readable, and you can still download the record.`,
      link: `/homes/${home.id}`,
    },
  );
  await logActivity({
    homeId: home.id,
    type: 'home_transition',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} closed the plan: ${reason}`,
  });
  return mapHome(updated);
}

/* ---------------- dashboard ---------------- */

export async function dashboard({ home, me }: HomeAccess): Promise<Dashboard> {
  // Weather first: a refetch can run the rules, which may add or escalate tasks shown below.
  const weather = await getWeather(home);
  const [members, taskRows, visits, notes, bookings, recentActivity] = await Promise.all([
    allMembers(home.id),
    homeTaskRows(home.id),
    rows<VisitRow>(db().from('visits').select('*').eq('home_id', home.id)),
    homeNoteRows(home.id),
    rows<BookingRow>(db().from('bookings').select('*').eq('home_id', home.id).order('created_at', { ascending: false })),
    listActivity(home.id, 8),
  ]);
  const names = nameMap(members);
  const tasks = await taskViews(taskRows, names);
  const active = tasks.filter(isActive);
  const now = Date.now();
  const weekAhead = now + 7 * DAY;

  const attention = active
    .filter((t) => t.needsOwner || t.isOverdue || t.priority === 'urgent' || (t.dueAt && new Date(t.dueAt).getTime() <= weekAhead))
    .sort(compareActive)
    .slice(0, 6);
  const myTasks = active
    .filter((t) => t.assignee?.id === me.id)
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  const nextVisitTask =
    active
      .filter((t) => t.templateKey === 'monthly_visit' || t.templateKey === 'first_walkthrough')
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))[0] ?? null;

  const photoRows = notes.length
    ? await rows<{ note_id: string }>(db().from('photos').select('note_id').in('note_id', notes.map((n) => n.id)))
    : [];
  const photoCount = new Map<string, number>();
  for (const p of photoRows) photoCount.set(p.note_id, (photoCount.get(p.note_id) ?? 0) + 1);

  const live = members.filter((m) => m.status !== 'removed');
  const activeBookingRow = bookings.find((b) => !['completed', 'cancelled', 'declined'].includes(b.status));
  const me2 = live.find((m) => m.id === me.id) ?? me;

  return {
    home: mapHome(home),
    me: mapMember(me2, memberStats(me2, taskRows, visits)),
    supervision: supervisionFor(home, visits),
    weather,
    needsAttention: attention,
    myTasks,
    nextVisitTask,
    counts: {
      open: active.length,
      overdue: active.filter((t) => t.isOverdue).length,
      needsOwner: active.filter((t) => t.needsOwner).length,
      doneLast30d: taskRows.filter((t: TaskRow) => t.status === 'done' && t.completed_at && now - new Date(t.completed_at).getTime() <= 30 * DAY).length,
      openConcerns: active.filter((t) => t.origin === 'visit_concern').length,
    },
    members: sortMembers(live).map((m) => mapMember(m, memberStats(m, taskRows, visits))),
    essentialsMissing: essentialsFor(home, notes, photoCount).filter((e) => !e.confirmed),
    activeBooking: activeBookingRow ? await bookingView(activeBookingRow) : null,
    recentActivity,
  };
}

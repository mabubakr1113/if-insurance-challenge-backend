import type { CheckInput, CheckItem, Visit, VisitSummary } from '@/lib/contract';
import { CHECK_COMPLETES, checkByKey, checklistFor } from '@/lib/catalog';
import { ApiError } from '@/lib/errors';
import { exec, one, rows, type HomeRow, type MemberRow, type PartnerRow, type StoredCheck, type TaskRow, type VisitRow } from '@/lib/db';
import { mapVisitSummary } from '@/lib/mappers';
import { fromTemplate } from '@/lib/plan/generate';
import { templateByKey } from '@/lib/plan/templates';
import { db } from '@/lib/supabase';
import { dueAfter, firstName, fmtDay, fmtTemp, today, ymd } from '@/lib/time';
import { logActivity } from './activity';
import { coordinatorIds, homeMembers, joinedIds, notify } from './notifications';
import { linkPhotos } from './photos';
import { completeTaskRow, insertTasks } from './tasks';
import { visitView } from './views';

export function checklist(home: HomeRow): CheckItem[] {
  return checklistFor(home, today());
}

export type Visitor = { type: 'family'; member: MemberRow } | { type: 'partner'; partner: PartnerRow; bookingId: string };

export interface VisitInput {
  visitedAt: Date;
  indoorTempC: number | null;
  checks: CheckInput[];
  notes: string | null;
  photoIds: string[];
}

export function visitSummaryText(ok: number, concerns: number, temp: number | null): string {
  const parts = [`${ok} OK`];
  if (concerns) parts.push(`${concerns} concern${concerns === 1 ? '' : 's'}`);
  if (temp != null) parts.push(fmtTemp(temp));
  return parts.join(', ');
}

/** Fills each check's label from the catalog. Unknown keys → 400. Later duplicates win. */
export function normaliseChecks(input: CheckInput[]): StoredCheck[] {
  const byKey = new Map<string, StoredCheck>();
  input.forEach((c, index) => {
    const def = checkByKey(c.key);
    if (!def) {
      throw new ApiError(400, 'invalid_request', `Unknown check "${c.key}"`, [
        { code: 'custom', path: ['checks', index, 'key'], message: `Unknown check "${c.key}"` },
      ]);
    }
    byKey.set(c.key, { key: c.key, label: def.label, result: c.result, note: c.note?.trim() || null });
  });
  return [...byKey.values()];
}

/**
 * Records a visit (8.5): insert, link photos, complete covered tasks, turn concerns into follow-ups,
 * update the home's last visit, log and notify. The partner path skips the family notification;
 * the booking sends "Visit report ready" instead.
 */
export async function recordVisit(home: HomeRow, visitor: Visitor, input: VisitInput): Promise<Visit> {
  const checks = normaliseChecks(input.checks);
  const visitorName = visitor.type === 'family' ? visitor.member.name : visitor.partner.name;
  const shortName = visitor.type === 'family' ? firstName(visitorName) : visitorName;
  const actorMemberId = visitor.type === 'family' ? visitor.member.id : null;

  // 1. the visit
  const visit = await one<VisitRow>(
    db()
      .from('visits')
      .insert({
        home_id: home.id,
        booking_id: visitor.type === 'partner' ? visitor.bookingId : null,
        visitor_type: visitor.type,
        member_id: actorMemberId,
        partner_id: visitor.type === 'partner' ? visitor.partner.id : null,
        visitor_name: visitorName,
        visited_at: input.visitedAt.toISOString(),
        indoor_temp_c: input.indoorTempC,
        checks,
        notes: input.notes,
      })
      .select('*')
      .single(),
  );

  // 2. photos
  if (input.photoIds.length) await linkPhotos(home.id, input.photoIds, 'visit_id', visit.id);

  // 3. tasks this visit covers
  const keys = new Set(['monthly_visit', 'first_walkthrough']);
  for (const c of checks) if (c.result === 'ok' && CHECK_COMPLETES[c.key]) keys.add(CHECK_COMPLETES[c.key]);
  const covered = await rows<TaskRow>(
    db().from('tasks').select('*').eq('home_id', home.id).in('status', ['open', 'accepted']).in('template_key', [...keys]),
  );
  const completedAt = new Date(Math.min(input.visitedAt.getTime(), Date.now()));
  for (const task of covered) {
    await completeTaskRow(task, { byLabel: visitorName, visitId: visit.id, at: completedAt, nextBase: input.visitedAt });
  }
  const openMonthly = await rows<Pick<TaskRow, 'id'>>(
    db().from('tasks').select('id').eq('home_id', home.id).eq('template_key', 'monthly_visit').in('status', ['open', 'accepted']).limit(1),
  );
  if (openMonthly.length === 0) {
    const template = templateByKey('monthly_visit');
    if (template) await insertTasks([fromTemplate(home.id, template, { dueAt: dueAfter(input.visitedAt, 30) })]);
  }

  // 4. concerns → follow-up tasks
  const concerns = checks.filter((c) => c.result === 'concern');
  if (concerns.length) {
    const followUps = await insertTasks(
      concerns.map((c) => ({
        home_id: home.id,
        title: `Follow up: ${c.label}`,
        why: c.note ?? `Reported during the visit on ${fmtDay(input.visitedAt)}`,
        how: [],
        category: checkByKey(c.key)?.category ?? 'other',
        priority: 'high' as const,
        status: 'open' as const,
        due_at: dueAfter(input.visitedAt, 3).toISOString(),
        origin: 'visit_concern' as const,
        source_visit_id: visit.id,
        created_by_label: visitorName,
      })),
    );
    const members = await homeMembers(home.id);
    for (const task of followUps) {
      const label = task.title.replace(/^Follow up: /, '');
      await notify(
        { memberIds: coordinatorIds(members), exceptMemberId: actorMemberId },
        {
          homeId: home.id,
          channel: 'in_app',
          title: `New concern from ${shortName}: ${label}`,
          body: task.why ?? '',
          link: `/homes/${home.id}/tasks/${task.id}`,
        },
      );
    }
  }

  // 5. the home's last visit
  await exec(db().from('homes').update({ last_known_visit: ymd(input.visitedAt) }).eq('id', home.id));

  // 6. activity and notification
  const ok = checks.filter((c) => c.result === 'ok').length;
  const summary = visitSummaryText(ok, concerns.length, input.indoorTempC);
  await logActivity({
    homeId: home.id,
    type: 'visit_recorded',
    actorLabel: visitorName,
    actorMemberId,
    message: `${shortName} recorded a visit: ${summary}`,
    visitId: visit.id,
    bookingId: visitor.type === 'partner' ? visitor.bookingId : null,
  });
  if (visitor.type === 'family') {
    const members = await homeMembers(home.id);
    await notify(
      { memberIds: joinedIds(members), exceptMemberId: actorMemberId },
      {
        homeId: home.id,
        channel: 'in_app',
        title: `${shortName} recorded a visit`,
        body: summary,
        link: `/homes/${home.id}/visits/${visit.id}`,
      },
    );
  }

  // 7. the full visit
  return visitView(visit);
}

export async function listVisits(homeId: string): Promise<VisitSummary[]> {
  const visits = await rows<VisitRow>(
    db().from('visits').select('*').eq('home_id', homeId).order('visited_at', { ascending: false }),
  );
  if (visits.length === 0) return [];
  const photos = await rows<{ visit_id: string }>(
    db()
      .from('photos')
      .select('visit_id')
      .in(
        'visit_id',
        visits.map((v) => v.id),
      ),
  );
  return visits.map((v) => mapVisitSummary(v, photos.filter((p) => p.visit_id === v.id).length));
}

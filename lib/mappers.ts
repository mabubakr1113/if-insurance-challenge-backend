import type {
  Booking,
  EssentialStatus,
  Home,
  Member,
  MemberStats,
  Note,
  Partner,
  PersonRef,
  Photo,
  Task,
  Visit,
  VisitSummary,
  WeatherAlert,
} from './contract';
import { ESSENTIALS, packageByKey } from './catalog';
import type {
  BookingRow,
  HomeRow,
  MemberRow,
  NoteRow,
  PartnerRow,
  PhotoRow,
  TaskRow,
  VisitRow,
  WeatherAlertRow,
} from './db';
import { sortOrder } from './plan/templates';
import { PHOTO_BUCKET, db } from './supabase';
import { HOUR, atHelsinki, addDays } from './time';

/* ---------------- homes and partners ---------------- */

export function mapHome(h: HomeRow): Home {
  return {
    id: h.id,
    status: h.status,
    addressLine: h.address_line,
    postalCode: h.postal_code,
    city: h.city,
    lat: h.lat,
    lng: h.lng,
    estateName: h.estate_name,
    buildingType: h.building_type,
    yearBuilt: h.year_built,
    vacantSince: h.vacant_since,
    lastKnownVisit: h.last_known_visit,
    occupancyConfirmed: h.occupancy_confirmed,
    authorityConfirmed: h.authority_confirmed,
    keyHolder: h.key_holder,
    accessNotes: h.access_notes,
    heatingType: h.heating_type,
    heatingOn: h.heating_on,
    waterSource: h.water_source,
    waterMainClosed: h.water_main_closed,
    hasAlarm: h.has_alarm,
    activatedAt: h.activated_at,
    closedAt: h.closed_at,
    closeReason: h.close_reason,
    newOwnerWantsCoverHelp: h.new_owner_wants_cover_help,
  };
}

export const homeSummary = (h: HomeRow) => ({
  id: h.id,
  addressLine: h.address_line,
  postalCode: h.postal_code,
  city: h.city,
  estateName: h.estate_name,
});

export function mapPartner(p: PartnerRow): Partner {
  return { id: p.id, name: p.name, area: p.area, phone: p.phone, email: p.email, description: p.description };
}

/* ---------------- photos (signed URLs, batched per response) ---------------- */

export async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  const { data, error } = await db().storage.from(PHOTO_BUCKET).createSignedUrls(unique, 3600);
  if (error) throw new Error(`Storage error: ${error.message}`);
  for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  return urls;
}

export function mapPhoto(p: PhotoRow, urls: Map<string, string>): Photo {
  return {
    id: p.id,
    url: urls.get(p.storage_path) ?? '',
    caption: p.caption,
    uploadedByLabel: p.uploaded_by_label,
    createdAt: p.created_at,
  };
}

export async function mapPhotos(photos: PhotoRow[]): Promise<Photo[]> {
  const urls = await signPaths(photos.map((p) => p.storage_path));
  return photos.map((p) => mapPhoto(p, urls));
}

/* ---------------- tasks (8.3) ---------------- */

export type NameMap = Map<string, string>;

export const nameMap = (members: MemberRow[]): NameMap => new Map(members.map((m) => [m.id, m.name]));

const person = (id: string, names: NameMap): PersonRef => ({ id, name: names.get(id) ?? 'Former family member' });

export function isOverdue(t: TaskRow, now = Date.now()): boolean {
  return (t.status === 'open' || t.status === 'accepted') && !!t.due_at && new Date(t.due_at).getTime() < now;
}

export function needsOwner(t: TaskRow, now = Date.now()): boolean {
  if (t.status !== 'open' || t.assignee_id || t.booking_id) return false;
  if (t.priority === 'urgent') return true;
  return !!t.due_at && new Date(t.due_at).getTime() - now <= 48 * HOUR;
}

export function mapTask(t: TaskRow, names: NameMap, now = Date.now()): Task {
  return {
    id: t.id,
    homeId: t.home_id,
    templateKey: t.template_key,
    title: t.title,
    why: t.why,
    how: t.how ?? [],
    category: t.category,
    priority: t.priority,
    status: t.status,
    assignee: t.assignee_id ? person(t.assignee_id, names) : null,
    dueAt: t.due_at,
    isOverdue: isOverdue(t, now),
    needsOwner: needsOwner(t, now),
    recurrenceDays: t.recurrence_days,
    origin: t.origin,
    source: t.source_label ? { label: t.source_label, url: t.source_url } : null,
    needsInfo: t.needs_info,
    declinedBy: (t.declined_by ?? []).map((id) => person(id, names)),
    bookingId: t.booking_id,
    completedAt: t.completed_at,
    completedByLabel: t.completed_by_label,
    completionNote: t.completion_note,
    createdAt: t.created_at,
  };
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 } as const;
const time = (iso: string | null, fallback: number) => (iso ? new Date(iso).getTime() : fallback);

/** Open and accepted tasks: needs an owner, overdue, priority, due date, plan order. */
export function compareActive(a: Task, b: Task): number {
  return (
    Number(b.needsOwner) - Number(a.needsOwner) ||
    Number(b.isOverdue) - Number(a.isOverdue) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    time(a.dueAt, Infinity) - time(b.dueAt, Infinity) ||
    sortOrder(a.templateKey) - sortOrder(b.templateKey) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/** Plan ordering (8.3): active first, then done (newest first), then cancelled. */
export function sortPlan(tasks: Task[]): Task[] {
  const active = tasks.filter((t) => t.status === 'open' || t.status === 'accepted').sort(compareActive);
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => time(b.completedAt, 0) - time(a.completedAt, 0));
  const cancelled = tasks.filter((t) => t.status === 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...active, ...done, ...cancelled];
}

/* ---------------- members ---------------- */

export function memberStats(m: MemberRow, tasks: TaskRow[], visits: VisitRow[]): MemberStats {
  const mine = visits.filter((v) => v.member_id === m.id).sort((a, b) => b.visited_at.localeCompare(a.visited_at));
  return {
    openTasks: tasks.filter((t) => t.assignee_id === m.id && (t.status === 'open' || t.status === 'accepted')).length,
    doneTasks: tasks.filter((t) => t.status === 'done' && (t.completed_by_label === m.name || t.assignee_id === m.id)).length,
    visits: mine.length,
    lastVisitAt: mine[0]?.visited_at ?? null,
  };
}

export function mapMember(m: MemberRow, stats: MemberStats): Member {
  return {
    id: m.id,
    homeId: m.home_id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    city: m.city,
    relation: m.relation,
    role: m.role,
    canAuthorise: m.can_authorise,
    status: m.status,
    joinedAt: m.joined_at,
    stats,
  };
}

const ROLE_ORDER = { coordinator: 0, helper: 1, viewer: 2 } as const;

export function sortMembers<T extends { role: MemberRow['role']; created_at?: string; name: string }>(members: T[]): T[] {
  return [...members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

/* ---------------- notes and essentials ---------------- */

export function mapNote(n: NoteRow, photos: Photo[]): Note {
  return {
    id: n.id,
    homeId: n.home_id,
    category: n.category,
    title: n.title,
    body: n.body,
    essentialKey: n.essential_key,
    confirmed: n.confirmed,
    photos,
    updatedByLabel: n.updated_by_label,
    updatedAt: n.updated_at,
  };
}

export function essentialsFor(home: HomeRow, notes: NoteRow[], photoCount: Map<string, number>): EssentialStatus[] {
  return ESSENTIALS.filter((e) => e.appliesTo(home)).map((e) => {
    const note = notes.find((n) => n.essential_key === e.key);
    return {
      key: e.key,
      label: e.label,
      why: e.why,
      category: e.category,
      noteId: note?.id ?? null,
      confirmed: note?.confirmed ?? false,
      hasPhoto: note ? (photoCount.get(note.id) ?? 0) > 0 : false,
    };
  });
}

/* ---------------- weather alerts ---------------- */

export function mapAlert(a: WeatherAlertRow, task: TaskRow | undefined): WeatherAlert {
  const endOfDay = atHelsinki(addDays(a.for_date, 1), '00:00').getTime();
  return {
    id: a.id,
    rule: a.rule,
    forDate: a.for_date,
    message: a.message,
    taskId: a.task_id,
    taskStatus: task?.status ?? null,
    actionedBeforeDate: !!task && task.status === 'done' && !!task.completed_at && new Date(task.completed_at).getTime() < endOfDay,
    source: a.source,
    createdAt: a.created_at,
  };
}

/* ---------------- bookings ---------------- */

export function mapBooking(
  b: BookingRow,
  ctx: { partner: PartnerRow; names: NameMap; taskTitle: string | null; visitId: string | null },
): Booking {
  const pkg = packageByKey(b.package_key);
  return {
    id: b.id,
    homeId: b.home_id,
    status: b.status,
    package: {
      ...pkg,
      partnerPriceCents: b.partner_price_cents,
      ifFeeCents: b.if_fee_cents,
      totalCents: b.partner_price_cents + b.if_fee_cents,
    },
    partner: mapPartner(ctx.partner),
    slotStart: b.slot_start,
    slotEnd: b.slot_end,
    accessMethod: b.access_method,
    accessDetails: b.access_details,
    notes: b.notes,
    taskId: b.task_id,
    taskTitle: ctx.taskTitle,
    requestedBy: b.requested_by ? person(b.requested_by, ctx.names) : null,
    approvedBy: b.approved_by ? person(b.approved_by, ctx.names) : null,
    createdAt: b.created_at,
    approvedAt: b.approved_at,
    confirmedAt: b.confirmed_at,
    startedAt: b.started_at,
    completedAt: b.completed_at,
    cancelledAt: b.cancelled_at,
    cancelReason: b.cancel_reason,
    visitId: ctx.visitId,
  };
}

/* ---------------- visits ---------------- */

export function visitCounts(v: VisitRow) {
  return {
    okCount: v.checks.filter((c) => c.result === 'ok').length,
    concernCount: v.checks.filter((c) => c.result === 'concern').length,
  };
}

export function mapVisitSummary(v: VisitRow, photoCount: number): VisitSummary {
  return {
    id: v.id,
    visitorType: v.visitor_type,
    visitorName: v.visitor_name,
    visitedAt: v.visited_at,
    indoorTempC: v.indoor_temp_c == null ? null : Number(v.indoor_temp_c),
    ...visitCounts(v),
    photoCount,
    bookingId: v.booking_id,
  };
}

export function mapVisit(v: VisitRow, ctx: { photos: Photo[]; completed: TaskRow[]; followUps: Task[] }): Visit {
  return {
    id: v.id,
    homeId: v.home_id,
    visitorType: v.visitor_type,
    visitorName: v.visitor_name,
    memberId: v.member_id,
    partnerId: v.partner_id,
    bookingId: v.booking_id,
    visitedAt: v.visited_at,
    indoorTempC: v.indoor_temp_c == null ? null : Number(v.indoor_temp_c),
    checks: v.checks.map((c) => ({ key: c.key, label: c.label, result: c.result, note: c.note ?? null })),
    notes: v.notes,
    photos: ctx.photos,
    ...visitCounts(v),
    completedTasks: ctx.completed.map((t) => ({ id: t.id, name: t.title })),
    followUpTasks: ctx.followUps,
    createdAt: v.created_at,
  };
}

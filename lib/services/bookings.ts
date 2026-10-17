import type {
  Booking,
  BookingDetail,
  BookingOptions,
  BookingStatus,
  CheckInput,
  CreateBookingBody,
  PackageKey,
  PartnerJob,
  PartnerJobDetail,
  Slot,
  Visit,
} from '@/lib/contract';
import { hasPerm, type HomeAccess, type PartnerActor } from '@/lib/auth';
import { ACCESS_METHODS, CHECK_ITEMS, PACKAGES, PACKAGE_NOUNS, PACKAGE_SLOTS, checklistFor, packageByKey } from '@/lib/catalog';
import { ApiError, forbidden, invalidState, notFound } from '@/lib/errors';
import {
  exec,
  isUuid,
  one,
  row,
  rows,
  type BookingRow,
  type HomeRow,
  type MemberRow,
  type PartnerRow,
  type PhotoRow,
  type TaskRow,
  type VisitRow,
} from '@/lib/db';
import { homeSummary, mapPartner } from '@/lib/mappers';
import { uploadPlaceholder } from '@/lib/seed/placeholders';
import { db } from '@/lib/supabase';
import { addDays, atHelsinki, firstName, fmtSlot, helsinkiHour, today } from '@/lib/time';
import { logActivity, mapActivity } from './activity';
import { authorisedIds, coordinatorIds, homeMembers, joinedIds, notify } from './notifications';
import { essentialNotes } from './notes';
import { completeTaskRow, taskView } from './tasks';
import { recordVisit } from './visits';
import { bookingView, bookingViews, visitView } from './views';

const BUSY: BookingStatus[] = ['requested', 'confirmed', 'in_progress'];
const CANCELLABLE: BookingStatus[] = ['pending_approval', 'requested', 'confirmed'];
const bookingLink = (b: BookingRow) => `/homes/${b.home_id}/help/${b.id}`;
const partnerLink = (b: BookingRow) => `/partner/jobs/${b.id}`;

export async function thePartner(): Promise<PartnerRow> {
  const partner = await row<PartnerRow>(db().from('partners').select('*').order('created_at').limit(1).maybeSingle());
  if (!partner) throw notFound('Partner');
  return partner;
}

async function loadBooking(id: string): Promise<BookingRow> {
  return one<BookingRow>(db().from('bookings').select('*').eq('id', id).single());
}

async function updateBooking(id: string, patch: Partial<BookingRow>): Promise<BookingRow> {
  return one<BookingRow>(db().from('bookings').update(patch).eq('id', id).select('*').single());
}

async function releaseTask(bookingId: string): Promise<void> {
  await exec(db().from('tasks').update({ booking_id: null, updated_at: new Date().toISOString() }).eq('booking_id', bookingId));
}

/* ---------------- slots and options (8.8) ---------------- */

export async function availableSlots(partnerId: string): Promise<Record<PackageKey, Slot[]>> {
  const todayStr = today();
  const slot = (date: string, [start, end]: [string, string]): Slot => ({
    start: atHelsinki(date, start).toISOString(),
    end: atHelsinki(date, end).toISOString(),
  });
  const nextDays = [1, 2, 3].map((n) => addDays(todayStr, n));
  const all: Record<PackageKey, Slot[]> = {
    check: nextDays.flatMap((d) => PACKAGE_SLOTS.check.map((h) => slot(d, h))),
    winter: nextDays.flatMap((d) => PACKAGE_SLOTS.winter.map((h) => slot(d, h))),
    urgent: [
      ...(helsinkiHour() < 13 ? [slot(todayStr, ['15:00', '17:00'])] : []),
      slot(addDays(todayStr, 1), ['09:00', '11:00']),
    ],
  };
  const busy = await rows<Pick<BookingRow, 'slot_start' | 'slot_end'>>(
    db().from('bookings').select('slot_start,slot_end').eq('partner_id', partnerId).in('status', BUSY),
  );
  const free = (s: Slot) =>
    !busy.some((b) => new Date(s.start) < new Date(b.slot_end) && new Date(b.slot_start) < new Date(s.end));
  return { check: all.check.filter(free), winter: all.winter.filter(free), urgent: all.urgent.filter(free) };
}

const personRefs = (members: MemberRow[]) => members.map((m) => ({ id: m.id, name: m.name }));
const authorised = (members: MemberRow[]) => members.filter((m) => m.can_authorise && m.role !== 'viewer');

export async function bookingOptions({ home, me }: HomeAccess, taskId: string | undefined): Promise<BookingOptions> {
  const partner = await thePartner();
  const [slots, members] = await Promise.all([availableSlots(partner.id), homeMembers(home.id)]);
  let task = null;
  if (taskId && isUuid(taskId)) {
    const t = await row<TaskRow>(db().from('tasks').select('*').eq('id', taskId).eq('home_id', home.id).maybeSingle());
    if (t) task = await taskView(t);
  }
  return {
    packages: PACKAGES,
    partner: mapPartner(partner),
    slots,
    accessMethods: ACCESS_METHODS,
    canApprove: hasPerm(me, 'A'),
    authorisedMembers: personRefs(authorised(members)),
    task,
    keyHolder: home.key_holder,
  };
}

/* ---------------- family side ---------------- */

export async function listBookings(homeId: string): Promise<Booking[]> {
  return bookingViews(
    await rows<BookingRow>(db().from('bookings').select('*').eq('home_id', homeId).order('created_at', { ascending: false })),
  );
}

async function sendToPartner(b: BookingRow, home: HomeRow): Promise<void> {
  await notify(
    { partnerIds: [b.partner_id] },
    {
      homeId: home.id,
      channel: 'email',
      title: `New visit request: ${home.address_line}, ${home.city}`,
      body: `${packageByKey(b.package_key).name}, ${fmtSlot(b.slot_start, b.slot_end)}`,
      link: partnerLink(b),
    },
  );
}

export async function createBooking({ home, me }: HomeAccess, body: CreateBookingBody): Promise<Booking> {
  const pkg = packageByKey(body.packageKey);
  const partner = await thePartner();
  const offered = (await availableSlots(partner.id))[pkg.key];
  const slot = offered.find((s) => new Date(s.start).getTime() === new Date(body.slotStart).getTime());
  if (!slot) throw new ApiError(409, 'slot_unavailable', 'That time is no longer available');

  const canAuthorise = hasPerm(me, 'A');
  if (canAuthorise && body.confirmAuthority !== true) {
    throw new ApiError(400, 'authority_confirmation_required', 'Confirm that you can authorise access to this home for this visit');
  }
  let task: TaskRow | null = null;
  if (body.taskId) {
    task = isUuid(body.taskId)
      ? await row<TaskRow>(db().from('tasks').select('*').eq('id', body.taskId).eq('home_id', home.id).maybeSingle())
      : null;
    if (!task) throw new ApiError(400, 'invalid_request', "That task doesn't belong to this home");
  }

  const now = new Date().toISOString();
  const status: BookingStatus = canAuthorise ? 'requested' : 'pending_approval';
  const booking = await one<BookingRow>(
    db()
      .from('bookings')
      .insert({
        home_id: home.id,
        partner_id: partner.id,
        task_id: task?.id ?? null,
        package_key: pkg.key,
        status,
        slot_start: slot.start,
        slot_end: slot.end,
        access_method: body.accessMethod,
        access_details: body.accessDetails ?? null,
        notes: body.notes ?? null,
        partner_price_cents: pkg.partnerPriceCents,
        if_fee_cents: pkg.ifFeeCents,
        requested_by: me.id,
        approved_by: canAuthorise ? me.id : null,
        approved_at: canAuthorise ? now : null,
      })
      .select('*')
      .single(),
  );
  if (task) await exec(db().from('tasks').update({ booking_id: booking.id, updated_at: now }).eq('id', task.id));

  await logActivity({
    homeId: home.id,
    type: 'booking_requested',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} requested ${PACKAGE_NOUNS[pkg.key]} for ${fmtSlot(slot.start, slot.end)}`,
    bookingId: booking.id,
    taskId: task?.id ?? null,
  });
  if (status === 'pending_approval') {
    await notify(
      { memberIds: authorisedIds(await homeMembers(home.id)), exceptMemberId: me.id },
      { homeId: home.id, channel: 'sms', title: `${firstName(me.name)} asked for a local visit. Approve?`, body: `${pkg.name}, ${fmtSlot(slot.start, slot.end)}`, link: bookingLink(booking) },
    );
  } else {
    await logActivity({
      homeId: home.id,
      type: 'booking_approved',
      actorLabel: me.name,
      actorMemberId: me.id,
      message: `${firstName(me.name)} approved the visit and confirmed they can authorise access`,
      bookingId: booking.id,
    });
    await sendToPartner(booking, home);
  }
  return bookingView(booking);
}

export function canCancelBooking(me: MemberRow, b: BookingRow): boolean {
  return CANCELLABLE.includes(b.status) && (b.requested_by === me.id || hasPerm(me, 'A') || me.role === 'coordinator');
}

export async function bookingDetail({ home, me }: HomeAccess, b: BookingRow): Promise<BookingDetail> {
  const [timeline, visit] = await Promise.all([
    rows<Parameters<typeof mapActivity>[0]>(db().from('activity').select('*').eq('booking_id', b.id).order('created_at', { ascending: true })),
    row<VisitRow>(db().from('visits').select('*').eq('booking_id', b.id).maybeSingle()),
  ]);
  const open = !['occupied', 'sold', 'transferred', 'closed', 'declined'].includes(home.status);
  return {
    booking: await bookingView(b),
    timeline: timeline.map(mapActivity),
    visit: visit ? await visitView(visit) : null,
    canApprove: open && b.status === 'pending_approval' && hasPerm(me, 'A'),
    canCancel: open && canCancelBooking(me, b),
  };
}

export async function approveBooking(home: HomeRow, approver: MemberRow, b: BookingRow): Promise<Booking> {
  if (b.status !== 'pending_approval') throw invalidState('This visit is not waiting for approval');
  const updated = await updateBooking(b.id, { status: 'requested', approved_by: approver.id, approved_at: new Date().toISOString() });
  await logActivity({
    homeId: home.id,
    type: 'booking_approved',
    actorLabel: approver.name,
    actorMemberId: approver.id,
    message: `${firstName(approver.name)} approved the visit`,
    bookingId: b.id,
  });
  await sendToPartner(updated, home);
  if (b.requested_by && b.requested_by !== approver.id) {
    await notify(
      { memberIds: [b.requested_by] },
      { homeId: home.id, channel: 'in_app', title: `${firstName(approver.name)} approved your visit request`, body: fmtSlot(b.slot_start, b.slot_end), link: bookingLink(b) },
    );
  }
  return bookingView(updated);
}

export async function cancelBooking({ home, me }: HomeAccess, b: BookingRow, reason: string): Promise<Booking> {
  if (!CANCELLABLE.includes(b.status)) throw invalidState('This visit can no longer be cancelled');
  if (!canCancelBooking(me, b)) throw forbidden('Only the requester, someone who can authorise access or a coordinator can cancel');
  const updated = await updateBooking(b.id, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason });
  await releaseTask(b.id);
  await logActivity({
    homeId: home.id,
    type: 'booking_cancelled',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} cancelled the visit: ${reason}`,
    bookingId: b.id,
  });
  if (b.status === 'requested' || b.status === 'confirmed') {
    await notify(
      { partnerIds: [b.partner_id] },
      { homeId: home.id, channel: 'email', title: `Visit cancelled: ${home.address_line}, ${home.city}`, body: `${fmtSlot(b.slot_start, b.slot_end)}. Reason: ${reason}`, link: partnerLink(b) },
    );
  }
  return bookingView(updated);
}

/* ---------------- partner side ---------------- */

async function familyRecipients(b: BookingRow): Promise<string[]> {
  const members = await homeMembers(b.home_id);
  return [...coordinatorIds(members), ...(b.requested_by ? [b.requested_by] : [])];
}

async function jobViews(bookings: BookingRow[]): Promise<PartnerJob[]> {
  if (bookings.length === 0) return [];
  const homeIds = [...new Set(bookings.map((b) => b.home_id))];
  const [views, homes, members] = await Promise.all([
    bookingViews(bookings),
    rows<HomeRow>(db().from('homes').select('*').in('id', homeIds)),
    rows<MemberRow>(db().from('members').select('*').in('home_id', homeIds).eq('role', 'coordinator').neq('status', 'removed').order('created_at')),
  ]);
  return bookings.map((b, i) => {
    const home = homes.find((h) => h.id === b.home_id);
    if (!home) throw new Error(`Home ${b.home_id} missing`);
    const coordinator = members.find((m) => m.home_id === b.home_id);
    return {
      booking: views[i],
      home: homeSummary(home),
      coordinator: coordinator ? { name: coordinator.name, phone: coordinator.phone } : null,
    };
  });
}

const JOB_GROUPS: Record<'open' | 'scheduled' | 'done', BookingStatus[]> = {
  open: ['requested'],
  scheduled: ['confirmed', 'in_progress'],
  done: ['completed', 'declined', 'cancelled'],
};

export async function listJobs(partner: PartnerActor, group: 'open' | 'scheduled' | 'done'): Promise<PartnerJob[]> {
  let bookings = await rows<BookingRow>(
    db().from('bookings').select('*').eq('partner_id', partner.partner.id).in('status', JOB_GROUPS[group]),
  );
  // A request cancelled before approval never reached the partner.
  bookings = bookings.filter((b) => b.status !== 'cancelled' || b.approved_at);
  const doneAt = (b: BookingRow) => b.completed_at ?? b.cancelled_at ?? b.created_at;
  bookings.sort((a, b) => (group === 'done' ? doneAt(b).localeCompare(doneAt(a)) : a.slot_start.localeCompare(b.slot_start)));
  return jobViews(bookings);
}

export async function jobDetail(b: BookingRow, home: HomeRow): Promise<PartnerJobDetail> {
  const [[job], essentials] = await Promise.all([jobViews([b]), essentialNotes(home.id)]);
  return {
    ...job,
    checklist: checklistFor(home, today()),
    essentials,
    keyHolder: home.key_holder,
    accessNotes: home.access_notes,
  };
}

export async function partnerAccept(partner: PartnerRow, b: BookingRow, home: HomeRow): Promise<Booking> {
  if (b.status !== 'requested') throw invalidState('Only new requests can be accepted');
  const updated = await updateBooking(b.id, { status: 'confirmed', confirmed_at: new Date().toISOString() });
  const slot = fmtSlot(b.slot_start, b.slot_end);
  await logActivity({ homeId: home.id, type: 'booking_confirmed', actorLabel: partner.name, message: `${partner.name} confirmed the visit on ${slot}`, bookingId: b.id });
  await notify(
    { memberIds: await familyRecipients(b) },
    { homeId: home.id, channel: 'in_app', title: `${partner.name} confirmed the visit on ${slot}`, body: `${home.address_line}, ${home.city}`, link: bookingLink(b) },
  );
  return bookingView(updated);
}

export async function partnerDecline(partner: PartnerRow, b: BookingRow, home: HomeRow, reason: string): Promise<Booking> {
  if (b.status !== 'requested') throw invalidState('Only new requests can be declined');
  const updated = await updateBooking(b.id, { status: 'declined', cancel_reason: reason });
  await releaseTask(b.id);
  await logActivity({ homeId: home.id, type: 'booking_declined', actorLabel: partner.name, message: `${partner.name} couldn't take the visit: ${reason}`, bookingId: b.id });
  await notify(
    { memberIds: await familyRecipients(b) },
    { homeId: home.id, channel: 'in_app', title: `${partner.name} couldn't take the visit`, body: reason, link: bookingLink(b) },
  );
  return bookingView(updated);
}

export async function partnerStart(partner: PartnerRow, b: BookingRow, home: HomeRow): Promise<Booking> {
  if (b.status !== 'confirmed') throw invalidState('Only confirmed visits can be started');
  const updated = await updateBooking(b.id, { status: 'in_progress', started_at: new Date().toISOString() });
  await logActivity({ homeId: home.id, type: 'booking_started', actorLabel: partner.name, message: `${partner.name} started the visit`, bookingId: b.id });
  return bookingView(updated);
}

export interface PartnerReport {
  indoorTempC: number | null;
  checks: CheckInput[];
  notes?: string;
  photoIds?: string[];
}

export async function partnerComplete(partner: PartnerRow, b: BookingRow, home: HomeRow, report: PartnerReport): Promise<Visit> {
  if (b.status !== 'confirmed' && b.status !== 'in_progress') throw invalidState('Only confirmed or started visits can be completed');
  const now = new Date();
  await updateBooking(b.id, {
    status: 'completed',
    completed_at: now.toISOString(),
    ...(b.started_at ? {} : { started_at: now.toISOString() }),
  });
  const visit = await recordVisit(
    home,
    { type: 'partner', partner, bookingId: b.id },
    { visitedAt: now, indoorTempC: report.indoorTempC, checks: report.checks, notes: report.notes ?? null, photoIds: report.photoIds ?? [] },
  );
  if (b.task_id) {
    const task = await row<TaskRow>(db().from('tasks').select('*').eq('id', b.task_id).maybeSingle());
    if (task && (task.status === 'open' || task.status === 'accepted')) {
      await completeTaskRow(task, { byLabel: partner.name, visitId: visit.id, note: 'Checked during the local visit' });
    }
  }
  await releaseTask(b.id);
  await logActivity({
    homeId: home.id,
    type: 'booking_completed',
    actorLabel: partner.name,
    message: `${partner.name} completed the visit. The report is ready.`,
    bookingId: b.id,
    visitId: visit.id,
  });
  await notify(
    { memberIds: joinedIds(await homeMembers(home.id)) },
    { homeId: home.id, channel: 'sms', title: 'Visit report ready', body: `${partner.name} visited ${home.address_line}. Open the report to see what was checked.`, link: `/homes/${home.id}/visits/${visit.id}` },
  );
  return visitView(await one<VisitRow>(db().from('visits').select('*').eq('id', visit.id).single()));
}

/* ---------------- demo: the simulated partner does the visit now (11) ---------------- */

export async function demoCompleteBooking(bookingId: string): Promise<Visit> {
  if (!isUuid(bookingId)) throw notFound('Booking');
  let b = await row<BookingRow>(db().from('bookings').select('*').eq('id', bookingId).maybeSingle());
  if (!b) throw notFound('Booking');
  const home = await one<HomeRow>(db().from('homes').select('*').eq('id', b.home_id).single());
  const partner = await one<PartnerRow>(db().from('partners').select('*').eq('id', b.partner_id).single());

  if (b.status === 'pending_approval') {
    const members = await homeMembers(home.id);
    const approver = authorised(members)[0] ?? members.find((m) => m.role === 'coordinator');
    if (!approver) throw invalidState('Nobody in the family can approve this visit');
    await approveBooking(home, approver, b);
    b = await loadBooking(b.id);
  }
  if (b.status === 'requested') {
    await partnerAccept(partner, b, home);
    b = await loadBooking(b.id);
  }
  if (b.status === 'confirmed') {
    await partnerStart(partner, b, home);
    b = await loadBooking(b.id);
  }
  if (b.status !== 'in_progress') throw invalidState(`This visit is ${b.status.replace('_', ' ')} and can't be completed`);

  const photoIds: string[] = [];
  for (const title of ['Thermostat — 18 °C', 'Roof, north side']) {
    const path = await uploadPlaceholder(home.id, title);
    const photo = await one<PhotoRow>(
      db().from('photos').insert({ home_id: home.id, storage_path: path, caption: title, uploaded_by_label: partner.name }).select('*').single(),
    );
    photoIds.push(photo.id);
  }

  const notes: Record<string, string> = {
    heating: 'Radiators warm, thermostat at 18 °C',
    water_main: 'Closed, as instructed',
    mail: 'Collected 6 letters, left on the kitchen table',
  };
  const date = today();
  const checks: CheckInput[] = CHECK_ITEMS.filter((c) => c.key !== 'roof_snow' && c.appliesTo(home, date)).map((c) => ({
    key: c.key,
    result: 'ok' as const,
    ...(notes[c.key] ? { note: notes[c.key] } : {}),
  }));
  checks.push({ key: 'roof_snow', result: 'concern', note: 'Snow building up on the north side of the roof; looks heavy' });

  return partnerComplete(partner, b, home, {
    indoorTempC: 17,
    checks,
    notes: 'All rooms checked. One concern about snow on the roof — see the follow-up task.',
    photoIds,
  });
}

export { loadBooking };

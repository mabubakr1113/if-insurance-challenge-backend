import { randomUUID } from 'node:crypto';
import type { BookingStatus, CheckResult, HomeStatus, PackageKey, Relation, Role } from '../contract';
import { CHECK_ITEMS, PACKAGE_NOUNS, PARTNER, packageByKey } from '../catalog';
import type {
  ActivityRow,
  BookingRow,
  HomeRow,
  MemberRow,
  NoteRow,
  NotificationRow,
  PartnerRow,
  PhotoRow,
  StoredCheck,
  TaskRow,
  VisitRow,
  WeatherAlertRow,
} from '../db';
import { generatePlan } from '../plan/generate';
import { templateByKey } from '../plan/templates';
import { HOUR, addDays, atHelsinki, dueAfter, firstName, fmtDate, fmtSlot, fmtTemp, today, ymd } from '../time';

/* Builds every seed row in memory, with explicit ids and timestamps relative to now. */

type Row<T> = T;
type PhotoSpec = { row: Omit<PhotoRow, 'storage_path'>; title: string };

/** Deterministic PRNG so the background homes (and the insights) look the same after every reset. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const visitSummary = (checks: StoredCheck[], temp: number | null) => {
  const ok = checks.filter((c) => c.result === 'ok').length;
  const concerns = checks.filter((c) => c.result === 'concern').length;
  return [`${ok} OK`, ...(concerns ? [`${concerns} concern${concerns === 1 ? '' : 's'}`] : []), ...(temp != null ? [fmtTemp(temp)] : [])].join(', ');
};

export class SeedBuilder {
  readonly todayStr = today();
  readonly now = Date.now();
  partner: Row<PartnerRow>;
  homes: HomeRow[] = [];
  members: MemberRow[] = [];
  tasks: TaskRow[] = [];
  bookings: BookingRow[] = [];
  visits: VisitRow[] = [];
  notes: NoteRow[] = [];
  photos: PhotoSpec[] = [];
  activity: ActivityRow[] = [];
  notifications: NotificationRow[] = [];
  alerts: WeatherAlertRow[] = [];

  constructor() {
    const createdAt = this.at(120, '09:00');
    this.partner = { id: randomUUID(), ...PARTNER, created_at: createdAt };
  }

  /* ---------------- time ---------------- */

  /** A Helsinki wall-clock time `daysAgo` days before today (negative = in the future). */
  at(daysAgo: number, hhmm: string): string {
    return atHelsinki(addDays(this.todayStr, -daysAgo), hhmm).toISOString();
  }

  plus(iso: string, hours: number): string {
    return new Date(new Date(iso).getTime() + hours * HOUR).toISOString();
  }

  /** Never later than an hour ago. */
  past(iso: string): string {
    return new Date(Math.min(new Date(iso).getTime(), this.now - HOUR)).toISOString();
  }

  /* ---------------- rows ---------------- */

  home(fields: Partial<HomeRow> & Pick<HomeRow, 'address_line' | 'postal_code' | 'city' | 'lat' | 'lng' | 'status'>): HomeRow {
    const h: HomeRow = {
      id: randomUUID(),
      demo_group: 'background',
      invite_token: null,
      estate_name: null,
      building_type: null,
      year_built: null,
      vacant_since: null,
      last_known_visit: null,
      occupancy_confirmed: false,
      authority_confirmed: false,
      key_holder: null,
      access_notes: null,
      heating_type: null,
      heating_on: null,
      water_source: null,
      water_main_closed: null,
      has_alarm: null,
      forecast: null,
      forecast_source: null,
      forecast_fetched_at: null,
      invited_at: new Date(this.now).toISOString(),
      setup_started_at: null,
      activated_at: null,
      closed_at: null,
      close_reason: null,
      new_owner_wants_cover_help: null,
      created_at: fields.invited_at ?? new Date(this.now).toISOString(),
      ...fields,
    };
    this.homes.push(h);
    return h;
  }

  member(
    home: HomeRow,
    f: { name: string; role: Role; relation: Relation; city?: string | null; phone?: string | null; email?: string | null; canAuthorise?: boolean; joinedAt: string | null; createdAt: string; invitedBy?: string | null },
  ): MemberRow {
    const m: MemberRow = {
      id: randomUUID(),
      home_id: home.id,
      name: f.name,
      email: f.email ?? null,
      phone: f.phone ?? null,
      city: f.city ?? null,
      relation: f.relation,
      role: f.role,
      can_authorise: f.role === 'viewer' ? false : (f.canAuthorise ?? false),
      status: f.joinedAt ? 'joined' : 'invited',
      join_token: randomUUID().replace(/-/g, '').slice(0, 24),
      invited_by: f.invitedBy ?? null,
      joined_at: f.joinedAt,
      created_at: f.createdAt,
    };
    this.members.push(m);
    return m;
  }

  /** The care plan as if it were activated at `activatedAt`. */
  plan(home: HomeRow, activatedAt: string): TaskRow[] {
    const created = generatePlan(home, new Date(activatedAt)).map(
      (t) =>
        ({
          id: randomUUID(),
          template_key: null,
          why: null,
          how: [],
          priority: 'normal',
          status: 'open',
          assignee_id: null,
          due_at: null,
          recurrence_days: null,
          origin: 'plan',
          source_label: null,
          source_url: null,
          needs_info: null,
          declined_by: [],
          booking_id: null,
          source_visit_id: null,
          created_by_label: 'Home Watch',
          accepted_at: null,
          completed_at: null,
          completed_by_label: null,
          completion_note: null,
          completed_by_visit_id: null,
          created_at: activatedAt,
          updated_at: activatedAt,
          ...t,
        }) as TaskRow,
    );
    this.tasks.push(...created);
    return created;
  }

  task(home: HomeRow, key: string): TaskRow {
    const found = this.tasks.find((t) => t.home_id === home.id && t.template_key === key && (t.status === 'open' || t.status === 'accepted'));
    if (!found) throw new Error(`Seed: no open ${key} task`);
    return found;
  }

  accept(t: TaskRow, member: MemberRow, at: string): void {
    t.assignee_id = member.id;
    t.status = 'accepted';
    t.accepted_at = at;
  }

  complete(t: TaskRow, byLabel: string, at: string, opts: { visitId?: string; note?: string } = {}): void {
    t.status = 'done';
    t.completed_at = at;
    t.completed_by_label = byLabel;
    t.completion_note = opts.note ?? null;
    t.completed_by_visit_id = opts.visitId ?? null;
    t.accepted_at = t.accepted_at ?? at;
    t.updated_at = at;
  }

  /** The next occurrence of a recurring task, as 8.4 creates it. */
  next(t: TaskRow, base: string): TaskRow {
    const template = templateByKey(t.template_key);
    const assignee = this.members.find((m) => m.id === t.assignee_id && m.status === 'joined');
    const n: TaskRow = {
      ...t,
      id: randomUUID(),
      priority: template?.priority ?? t.priority,
      status: assignee ? 'accepted' : 'open',
      assignee_id: assignee?.id ?? null,
      accepted_at: assignee ? base : null,
      due_at: dueAfter(base, t.recurrence_days ?? 30).toISOString(),
      needs_info: null,
      declined_by: [],
      booking_id: null,
      completed_at: null,
      completed_by_label: null,
      completion_note: null,
      completed_by_visit_id: null,
      created_at: base,
      updated_at: base,
    };
    this.tasks.push(n);
    return n;
  }

  checks(home: HomeRow, at: string, overrides: Record<string, { result: CheckResult; note?: string }> = {}): StoredCheck[] {
    const date = ymd(at);
    return CHECK_ITEMS.filter((c) => c.appliesTo(home, date) || overrides[c.key]).map((c) => ({
      key: c.key,
      label: c.label,
      result: overrides[c.key]?.result ?? 'ok',
      note: overrides[c.key]?.note ?? null,
    }));
  }

  /**
   * A visit, with the 8.5 side effects the story needs: closes the first walkthrough and the monthly visit
   * (creating the next one), plus any extra task keys given, and logs the activity.
   */
  visit(
    home: HomeRow,
    f: { at: string; member?: MemberRow; partner?: boolean; bookingId?: string; temp: number | null; checks: StoredCheck[]; notes?: string; photos?: string[]; completes?: string[] },
  ): VisitRow {
    const name = f.partner ? this.partner.name : (f.member as MemberRow).name;
    const v: VisitRow = {
      id: randomUUID(),
      home_id: home.id,
      booking_id: f.bookingId ?? null,
      visitor_type: f.partner ? 'partner' : 'family',
      member_id: f.member?.id ?? null,
      partner_id: f.partner ? this.partner.id : null,
      visitor_name: name,
      visited_at: f.at,
      indoor_temp_c: f.temp,
      checks: f.checks,
      notes: f.notes ?? null,
      created_at: f.at,
    };
    this.visits.push(v);
    for (const title of f.photos ?? []) this.photo(home, title, name, f.at, { visit_id: v.id });

    const keys = new Set(['first_walkthrough', 'monthly_visit', ...(f.completes ?? [])]);
    const covered = this.tasks.filter(
      (t) => t.home_id === home.id && (t.status === 'open' || t.status === 'accepted') && t.template_key && keys.has(t.template_key),
    );
    for (const t of covered) {
      this.complete(t, name, f.at, { visitId: v.id });
      if (t.recurrence_days) this.next(t, f.at);
    }
    if (!home.last_known_visit || home.last_known_visit < ymd(f.at)) home.last_known_visit = ymd(f.at);
    this.log(home, {
      type: 'visit_recorded',
      at: f.at,
      actor: name,
      memberId: f.member?.id ?? null,
      message: `${f.partner ? name : firstName(name)} recorded a visit: ${visitSummary(f.checks, f.temp)}`,
      visitId: v.id,
      bookingId: f.bookingId ?? null,
    });
    return v;
  }

  booking(
    home: HomeRow,
    f: { pkg: PackageKey; status: BookingStatus; slotDaysAgo: number; slot: [string, string]; requestedBy: MemberRow; requestedAt: string; accessMethod: BookingRow['access_method']; accessDetails?: string; notes?: string; taskId?: string | null },
  ): BookingRow {
    const pkg = packageByKey(f.pkg);
    const slotStart = this.at(f.slotDaysAgo, f.slot[0]);
    const confirmed = ['confirmed', 'in_progress', 'completed'].includes(f.status);
    const b: BookingRow = {
      id: randomUUID(),
      home_id: home.id,
      partner_id: this.partner.id,
      task_id: f.taskId ?? null,
      package_key: f.pkg,
      status: f.status,
      slot_start: slotStart,
      slot_end: this.at(f.slotDaysAgo, f.slot[1]),
      access_method: f.accessMethod,
      access_details: f.accessDetails ?? null,
      notes: f.notes ?? null,
      partner_price_cents: pkg.partnerPriceCents,
      if_fee_cents: pkg.ifFeeCents,
      requested_by: f.requestedBy.id,
      approved_by: f.requestedBy.can_authorise ? f.requestedBy.id : null,
      approved_at: f.requestedBy.can_authorise ? f.requestedAt : null,
      confirmed_at: confirmed ? this.plus(f.requestedAt, 0.75) : null,
      started_at: f.status === 'completed' || f.status === 'in_progress' ? this.plus(slotStart, 0.15) : null,
      completed_at: f.status === 'completed' ? this.plus(slotStart, 0.9) : null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: f.requestedAt,
    };
    this.bookings.push(b);
    const slot = fmtSlot(b.slot_start, b.slot_end);
    const by = f.requestedBy;
    this.log(home, { type: 'booking_requested', at: f.requestedAt, actor: by.name, memberId: by.id, message: `${firstName(by.name)} requested ${PACKAGE_NOUNS[f.pkg]} for ${slot}`, bookingId: b.id });
    if (b.approved_at) {
      this.log(home, { type: 'booking_approved', at: f.requestedAt, actor: by.name, memberId: by.id, message: `${firstName(by.name)} approved the visit and confirmed they can authorise access`, bookingId: b.id });
    }
    if (b.confirmed_at) {
      this.log(home, { type: 'booking_confirmed', at: b.confirmed_at, actor: this.partner.name, message: `${this.partner.name} confirmed the visit on ${slot}`, bookingId: b.id });
    }
    if (b.started_at) {
      this.log(home, { type: 'booking_started', at: b.started_at, actor: this.partner.name, message: `${this.partner.name} started the visit`, bookingId: b.id });
    }
    return b;
  }

  /** Completes a seeded booking with a partner visit (all OK unless overridden). */
  partnerVisit(home: HomeRow, b: BookingRow, f: { temp: number; photos?: string[]; notes?: string }): VisitRow {
    const at = this.plus(b.slot_start, 0.6);
    const v = this.visit(home, { at, partner: true, bookingId: b.id, temp: f.temp, checks: this.checks(home, at), photos: f.photos, notes: f.notes, completes: ['heating_check'] });
    this.log(home, {
      type: 'booking_completed',
      at: b.completed_at ?? at,
      actor: this.partner.name,
      message: `${this.partner.name} completed the visit. The report is ready.`,
      bookingId: b.id,
      visitId: v.id,
    });
    return v;
  }

  note(home: HomeRow, f: { key?: NoteRow['essential_key']; category: NoteRow['category']; title: string; body: string; by: MemberRow; at: string; photo?: string }): NoteRow {
    const n: NoteRow = {
      id: randomUUID(),
      home_id: home.id,
      category: f.category,
      title: f.title,
      body: f.body,
      essential_key: f.key ?? null,
      confirmed: true,
      updated_by_label: f.by.name,
      created_at: f.at,
      updated_at: f.at,
    };
    this.notes.push(n);
    if (f.photo) this.photo(home, f.photo, f.by.name, f.at, { note_id: n.id });
    return n;
  }

  photo(home: HomeRow, title: string, by: string, at: string, link: Partial<Pick<PhotoRow, 'visit_id' | 'note_id' | 'task_id'>>): void {
    this.photos.push({
      title,
      row: { id: randomUUID(), home_id: home.id, caption: title, visit_id: null, note_id: null, task_id: null, uploaded_by_label: by, created_at: at, ...link },
    });
  }

  log(
    home: HomeRow,
    f: { type: string; at: string; actor: string; message: string; memberId?: string | null; taskId?: string | null; visitId?: string | null; bookingId?: string | null },
  ): void {
    this.activity.push({
      id: randomUUID(),
      home_id: home.id,
      type: f.type,
      actor_label: f.actor,
      actor_member_id: f.memberId ?? null,
      message: f.message,
      task_id: f.taskId ?? null,
      visit_id: f.visitId ?? null,
      booking_id: f.bookingId ?? null,
      created_at: f.at,
    });
  }

  notify(home: HomeRow, member: MemberRow, f: { channel: NotificationRow['channel']; title: string; body: string; link: string | null; at: string; read: boolean }): void {
    this.notifications.push({
      id: randomUUID(),
      home_id: home.id,
      member_id: member.id,
      partner_id: null,
      channel: f.channel,
      title: f.title,
      body: f.body,
      link: f.link,
      read_at: f.read ? this.plus(f.at, 2) : null,
      created_at: f.at,
    });
  }

  alert(home: HomeRow, f: { rule: WeatherAlertRow['rule']; forDaysAgo: number; minC?: number; task: TaskRow; createdAt: string }): void {
    const forDate = addDays(this.todayStr, -f.forDaysAgo);
    const message = `${fmtTemp(f.minC ?? 0)} forecast for ${fmtDate(forDate)}`;
    this.alerts.push({
      id: randomUUID(),
      home_id: home.id,
      rule: f.rule,
      for_date: forDate,
      message,
      min_temp_c: f.minC ?? null,
      gust_ms: null,
      snow_cm: null,
      task_id: f.task.id,
      source: 'open-meteo',
      created_at: f.createdAt,
    });
    this.log(home, { type: 'weather_alert', at: f.createdAt, actor: 'Home Watch', message, taskId: f.task.id });
  }

  /** A heating check created by a weather alert. */
  weatherTask(home: HomeRow, priority: 'urgent' | 'high', createdAt: string, dueAt: string): TaskRow {
    const template = templateByKey('heating_check');
    if (!template) throw new Error('heating_check template missing');
    const t: TaskRow = {
      id: randomUUID(),
      home_id: home.id,
      template_key: template.key,
      title: template.title,
      why: template.why,
      how: template.how,
      category: template.category,
      priority,
      status: 'open',
      assignee_id: null,
      due_at: dueAt,
      recurrence_days: null,
      origin: 'weather',
      source_label: template.source?.label ?? null,
      source_url: template.source?.url ?? null,
      needs_info: null,
      declined_by: [],
      booking_id: null,
      source_visit_id: null,
      created_by_label: 'Home Watch',
      accepted_at: null,
      completed_at: null,
      completed_by_label: null,
      completion_note: null,
      completed_by_visit_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.tasks.push(t);
    return t;
  }
}

/* ---------------- 10.1 the main home: the live demo, starts empty ---------------- */

export function seedMainHome(s: SeedBuilder): void {
  const invitedAt = s.at(0, '08:00');
  const home = s.home({
    demo_group: 'main',
    invite_token: 'demo-virtanen',
    status: 'invited',
    address_line: 'Esimerkkitie 12',
    postal_code: '20780',
    city: 'Kaarina',
    lat: 60.4072,
    lng: 22.3685,
    estate_name: 'Eila Virtanen',
    building_type: 'detached',
    year_built: 1978,
    invited_at: s.past(invitedAt),
  });
  s.log(home, { type: 'home_invited', at: home.invited_at, actor: 'If estate support', message: 'If estate support invited the family to Home Watch' });
}

/* ---------------- 10.2 the example home: five weeks in ---------------- */

export function seedExampleHome(s: SeedBuilder): void {
  const home = s.home({
    demo_group: 'example',
    invite_token: 'demo-lindqvist',
    status: 'active',
    address_line: 'Mallikatu 4',
    postal_code: '20540',
    city: 'Turku',
    lat: 60.4339,
    lng: 22.295,
    estate_name: 'Kaarlo Lindqvist',
    building_type: 'detached',
    year_built: 1965,
    vacant_since: addDays(s.todayStr, -40),
    occupancy_confirmed: true,
    authority_confirmed: true,
    key_holder: 'Jari Lindqvist (one spare key in the key box by the back door)',
    access_notes: 'Back door is easiest. The front door lock is stiff.',
    heating_type: 'district',
    heating_on: 'yes',
    water_source: 'municipal',
    water_main_closed: 'yes',
    has_alarm: 'no',
    invited_at: s.at(37, '10:15'),
    setup_started_at: s.at(36, '19:40'),
    activated_at: s.at(35, '20:05'),
  });
  const activated = home.activated_at as string;

  const sanna = s.member(home, { name: 'Sanna Lindqvist', role: 'coordinator', relation: 'child', city: 'Espoo', phone: '+358 40 000 0101', canAuthorise: true, createdAt: s.at(36, '19:40'), joinedAt: s.at(36, '19:40') });
  const jari = s.member(home, { name: 'Jari Lindqvist', role: 'helper', relation: 'child', city: 'Turku', phone: '+358 40 000 0102', canAuthorise: true, createdAt: s.at(36, '20:10'), joinedAt: s.at(35, '08:30'), invitedBy: sanna.id });
  const emma = s.member(home, { name: 'Emma Lindqvist', role: 'viewer', relation: 'grandchild', city: 'Helsinki', createdAt: s.at(36, '20:12'), joinedAt: s.at(34, '18:00'), invitedBy: sanna.id });

  s.log(home, { type: 'home_invited', at: home.invited_at, actor: 'If estate support', message: 'If estate support invited the family to Home Watch' });
  s.log(home, { type: 'member_joined', at: s.at(36, '19:40'), actor: sanna.name, memberId: sanna.id, message: 'Sanna accepted the invitation' });
  s.log(home, { type: 'home_updated', at: s.at(36, '19:52'), actor: sanna.name, memberId: sanna.id, message: 'Sanna updated the home: confirmed nobody lives there, heating set to district heating, water main closed: yes' });
  s.log(home, { type: 'member_invited', at: s.at(36, '20:10'), actor: sanna.name, memberId: sanna.id, message: 'Sanna invited Jari as a helper' });
  s.log(home, { type: 'member_invited', at: s.at(36, '20:12'), actor: sanna.name, memberId: sanna.id, message: 'Sanna invited Emma as a viewer' });
  s.log(home, { type: 'member_joined', at: s.at(35, '08:30'), actor: jari.name, memberId: jari.id, message: "Jari joined the family's plan" });

  const plan = s.plan(home, activated);
  s.log(home, { type: 'home_activated', at: activated, actor: sanna.name, memberId: sanna.id, message: `Care plan created with ${plan.length} tasks` });

  const t = (key: string) => s.task(home, key);
  // Who took what, the evening the plan was created.
  s.accept(t('key_access'), sanna, s.at(35, '20:30'));
  s.log(home, { type: 'task_accepted', at: s.at(35, '20:30'), actor: sanna.name, memberId: sanna.id, message: `Sanna is on “${t('key_access').title}”`, taskId: t('key_access').id });
  s.accept(t('first_walkthrough'), jari, s.at(35, '20:35'));
  s.log(home, { type: 'task_assigned', at: s.at(35, '20:35'), actor: sanna.name, memberId: sanna.id, message: `Sanna asked Jari to do “${t('first_walkthrough').title}”`, taskId: t('first_walkthrough').id });
  s.notify(home, jari, { channel: 'in_app', title: 'Sanna asked you to do this', body: t('first_walkthrough').title, link: `/homes/${home.id}/tasks/${t('first_walkthrough').id}`, at: s.at(35, '20:35'), read: true });
  for (const key of ['water_main_photo', 'heating_check', 'fuse_box', 'fridge_freezer', 'mail', 'monthly_visit']) {
    s.accept(t(key), jari, s.at(34, '07:50'));
    s.log(home, { type: 'task_accepted', at: s.at(34, '07:50'), actor: jari.name, memberId: jari.id, message: `Jari is on “${t(key).title}”`, taskId: t(key).id });
  }
  for (const key of ['electricity_contract', 'tell_if', 'valuables', 'decide_next']) s.accept(t(key), sanna, s.at(35, '20:40'));
  t('decide_next').status = 'open';
  t('decide_next').assignee_id = null;
  t('decide_next').accepted_at = null;
  s.log(home, { type: 'member_joined', at: s.at(34, '18:00'), actor: emma.name, memberId: emma.id, message: "Emma joined the family's plan" });

  // Keys sorted out the next evening.
  s.note(home, { key: 'key_location', category: 'access', title: 'Where the keys are', body: 'Jari has one key; a spare is in the key box by the back door. Ask Jari for the code.', by: sanna, at: s.at(34, '21:00') });
  s.log(home, { type: 'note_saved', at: s.at(34, '21:00'), actor: sanna.name, memberId: sanna.id, message: 'Sanna added where the keys are' });
  const keyTask = t('key_access');
  s.complete(keyTask, sanna.name, s.at(34, '21:00'), { note: 'Saved in House notes: Where the keys are' });
  s.log(home, { type: 'task_completed', at: s.at(34, '21:00'), actor: sanna.name, memberId: sanna.id, message: `Sanna completed “${keyTask.title}” with a house note`, taskId: keyTask.id });

  // Visit 1: Jari's first walkthrough.
  const v1At = s.at(33, '11:20');
  const fridge = t('fridge_freezer');
  const mail = t('mail');
  s.visit(home, { at: v1At, member: jari, temp: 19.5, checks: s.checks(home, v1At), notes: 'First walkthrough. Water main closed, valve, meter and fuse box photographed. Fridge emptied and left open.', photos: ['Hallway and front door', 'Basement utility room'], completes: ['heating_check'] });
  s.complete(fridge, jari.name, s.plus(v1At, 0.5), { note: 'Emptied, switched off, door left open.' });
  s.complete(mail, jari.name, s.plus(v1At, 0.6), { note: "Mail forwarded to Sanna's address." });
  for (const done of [fridge, mail]) {
    s.log(home, { type: 'task_completed', at: done.completed_at as string, actor: jari.name, memberId: jari.id, message: `Jari completed “${done.title}”`, taskId: done.id });
  }
  const notesAt = (min: number) => s.plus(v1At, 1 + min / 60);
  s.note(home, { key: 'water_main_valve', category: 'water', title: 'Water main valve', body: 'Under the stairs in the utility room, blue lever. Closed since the first visit.', by: jari, at: notesAt(5), photo: 'Water main valve' });
  s.log(home, { type: 'note_saved', at: notesAt(5), actor: jari.name, memberId: jari.id, message: 'Jari added the water main valve location with a photo' });
  const valveTask = t('water_main_photo');
  s.complete(valveTask, jari.name, notesAt(5), { note: 'Saved in House notes: Water main valve' });
  s.log(home, { type: 'task_completed', at: notesAt(5), actor: jari.name, memberId: jari.id, message: `Jari completed “${valveTask.title}” with a house note`, taskId: valveTask.id });
  s.note(home, { key: 'water_meter', category: 'water', title: 'Water meter', body: 'Next to the main valve under the stairs. The space has its own radiator, set to 2.', by: jari, at: notesAt(7), photo: 'Water meter' });
  s.log(home, { type: 'note_saved', at: notesAt(7), actor: jari.name, memberId: jari.id, message: 'Jari added the water meter location with a photo' });
  s.note(home, { key: 'fuse_box', category: 'electricity', title: 'Fuse box and main switch', body: 'Hallway cupboard; main switch top left', by: jari, at: notesAt(10), photo: 'Fuse box' });
  s.log(home, { type: 'note_saved', at: notesAt(10), actor: jari.name, memberId: jari.id, message: 'Jari added the fuse box location with a photo' });
  const fuseTask = t('fuse_box');
  s.complete(fuseTask, jari.name, notesAt(10), { note: 'Saved in House notes: Fuse box and main switch' });
  s.log(home, { type: 'task_completed', at: notesAt(10), actor: jari.name, memberId: jari.id, message: `Jari completed “${fuseTask.title}” with a house note`, taskId: fuseTask.id });
  s.note(home, { key: 'heating_controls', category: 'heating', title: 'Heating controls', body: 'District heating substation in the basement, set to 19 °C', by: jari, at: notesAt(12) });
  s.log(home, { type: 'note_saved', at: notesAt(12), actor: jari.name, memberId: jari.id, message: 'Jari added the heating controls' });

  // Paperwork done by Sanna.
  const elec = t('electricity_contract');
  s.complete(elec, sanna.name, s.at(31, '12:00'), { note: 'Kept active in the estate’s name.' });
  s.log(home, { type: 'task_completed', at: s.at(31, '12:00'), actor: sanna.name, memberId: sanna.id, message: `Sanna completed “${elec.title}”`, taskId: elec.id });
  s.note(home, { category: 'contacts', title: 'Electricity: contract kept active for the estate', body: "The electricity contract is kept active in the estate's name. Contract details are in the estate folder at Sanna's.", by: sanna, at: s.at(31, '12:05') });
  s.log(home, { type: 'note_saved', at: s.at(31, '12:05'), actor: sanna.name, memberId: sanna.id, message: 'Sanna added the note “Electricity: contract kept active for the estate”' });
  const tellIf = t('tell_if');
  s.complete(tellIf, sanna.name, s.at(30, '10:30'), { note: 'Called If. Policy number saved in the estate folder.' });
  s.log(home, { type: 'task_completed', at: s.at(30, '10:30'), actor: sanna.name, memberId: sanna.id, message: `Sanna completed “${tellIf.title}”`, taskId: tellIf.id });

  // Visit 2: Sanna notices a musty smell.
  const v2At = s.at(19, '15:05');
  const damp = 'Slight musty smell in the basement storage room';
  const v2 = s.visit(home, { at: v2At, member: sanna, temp: 19.0, checks: s.checks(home, v2At, { damp_smell: { result: 'concern', note: damp } }), notes: 'Collected valuables and papers. Basement smells a little musty.', photos: ['Basement storage room'] });
  const valuables = t('valuables');
  s.complete(valuables, sanna.name, s.plus(v2At, 0.3), { note: 'Papers and jewellery are at Sanna’s home in Espoo.' });
  s.log(home, { type: 'task_completed', at: s.plus(v2At, 0.3), actor: sanna.name, memberId: sanna.id, message: `Sanna completed “${valuables.title}”`, taskId: valuables.id });
  const followUp: TaskRow = {
    ...s.weatherTask(home, 'high', v2At, s.at(-2, '18:00')),
    template_key: null,
    title: 'Follow up: No damp or musty smell',
    why: damp,
    how: [],
    category: 'other',
    origin: 'visit_concern',
    source_label: null,
    source_url: null,
    source_visit_id: v2.id,
    created_by_label: sanna.name,
  };
  s.tasks[s.tasks.length - 1] = followUp;
  s.accept(followUp, sanna, s.plus(v2At, 1));
  s.log(home, { type: 'task_accepted', at: s.plus(v2At, 1), actor: sanna.name, memberId: sanna.id, message: `Sanna is on “${followUp.title}”`, taskId: followUp.id });

  // A check visit booked by Sanna, done by the partner.
  const monthly = t('monthly_visit');
  const booking = s.booking(home, {
    pkg: 'check',
    status: 'completed',
    slotDaysAgo: 12,
    slot: ['09:00', '11:00'],
    requestedBy: sanna,
    requestedAt: s.at(14, '18:20'),
    accessMethod: 'key_box',
    accessDetails: 'Key box by the back door; code sent separately',
    notes: 'Please check the basement storage room for any musty smell.',
    taskId: monthly.id,
  });
  s.notify(home, sanna, { channel: 'in_app', title: `${s.partner.name} confirmed the visit on ${fmtSlot(booking.slot_start, booking.slot_end)}`, body: `${home.address_line}, ${home.city}`, link: `/homes/${home.id}/help/${booking.id}`, at: booking.confirmed_at as string, read: true });
  const v3 = s.partnerVisit(home, booking, { temp: 18.5, photos: ['Thermostat — 19 °C', 'Front porch and mailbox'], notes: 'All rooms checked. The basement smell is faint; a dehumidifier would help.' });
  s.notify(home, sanna, { channel: 'sms', title: 'Visit report ready', body: `${s.partner.name} visited ${home.address_line}. Open the report to see what was checked.`, link: `/homes/${home.id}/visits/${v3.id}`, at: booking.completed_at as string, read: true });

  // Emma comments; Jari's latest visit.
  const commentAt = s.at(9, '20:15');
  const comment = 'Grandpa always kept a dehumidifier down there. It might still be in the garage.';
  s.log(home, { type: 'task_commented', at: commentAt, actor: emma.name, memberId: emma.id, message: comment, taskId: followUp.id });
  s.notify(home, sanna, { channel: 'in_app', title: `Emma commented on “${followUp.title}”`, body: comment, link: `/homes/${home.id}/tasks/${followUp.id}`, at: commentAt, read: false });

  const v4At = s.at(6, '16:30');
  const v4Checks = s.checks(home, v4At);
  const v4 = s.visit(home, { at: v4At, member: jari, temp: 18.0, checks: v4Checks, notes: 'Everything as before. Found the dehumidifier in the garage and left it running in the storage room.', photos: ['Kitchen, under the sink'] });
  s.notify(home, sanna, { channel: 'in_app', title: 'Jari recorded a visit', body: visitSummary(v4Checks, 18), link: `/homes/${home.id}/visits/${v4.id}`, at: v4At, read: false });

  // Still open: smoke alarms (due tomorrow), the next monthly visit and the decision about the home.
  const smoke = t('smoke_alarms');
  smoke.due_at = s.at(-1, '18:00');
}

/* ---------------- 10.3 background homes, for insights ---------------- */

const CITIES: { city: string; postal: string; lat: number; lng: number }[] = [
  { city: 'Turku', postal: '20300', lat: 60.4518, lng: 22.2666 },
  { city: 'Kaarina', postal: '20780', lat: 60.4072, lng: 22.3685 },
  { city: 'Raisio', postal: '21200', lat: 60.4859, lng: 22.1691 },
  { city: 'Lieto', postal: '21420', lat: 60.5033, lng: 22.4566 },
  { city: 'Naantali', postal: '21100', lat: 60.4675, lng: 22.0266 },
  { city: 'Parainen', postal: '21600', lat: 60.3033, lng: 22.3 },
  { city: 'Masku', postal: '21250', lat: 60.5714, lng: 22.1 },
  { city: 'Rusko', postal: '21290', lat: 60.5417, lng: 22.2208 },
];
const STREETS = ['Koetie', 'Mallitie', 'Esimerkkikatu', 'Demopolku', 'Harjoituskuja'];
const ESTATE_FIRST = ['Aila', 'Anneli', 'Eero', 'Juhani', 'Kaija', 'Leena', 'Markku', 'Pirjo', 'Raimo', 'Seppo', 'Tuula', 'Veikko'];
const MEMBER_FIRST = ['Anna', 'Elina', 'Heikki', 'Janne', 'Katja', 'Laura', 'Mikael', 'Niina', 'Olli', 'Petra', 'Riikka', 'Timo'];
const SURNAMES = ['Aalto', 'Heikkinen', 'Koskinen', 'Laine', 'Mäkinen', 'Nieminen', 'Salonen', 'Turunen'];

interface ActivePlan {
  status: HomeStatus;
  activatedDaysAgo: [number, number];
  closedDaysAgo?: number;
  /** Family visits, days ago (a function of the activation day). */
  visits: (a: number) => number[];
  paid?: { pkg: PackageKey; daysAgo: number; status: 'completed' | 'requested' };
  alert?: { rule: 'frost' | 'hard_frost'; forDaysAgo: number; minC: number; actioned: boolean };
  coverHelp?: boolean;
}

const ACTIVE_PLANS: ActivePlan[] = [
  { status: 'active', activatedDaysAgo: [72, 80], visits: (a) => [a - 3, 38, 10], paid: { pkg: 'check', daysAgo: 24, status: 'completed' }, alert: { rule: 'frost', forDaysAgo: 9, minC: -7, actioned: true } },
  { status: 'active', activatedDaysAgo: [50, 58], visits: (a) => [a - 2, 27, 5], paid: { pkg: 'winter', daysAgo: 15, status: 'completed' }, alert: { rule: 'hard_frost', forDaysAgo: 4, minC: -16, actioned: true } },
  { status: 'active', activatedDaysAgo: [45, 52], visits: () => [38], alert: { rule: 'frost', forDaysAgo: 2, minC: -6, actioned: false } },
  { status: 'active', activatedDaysAgo: [22, 28], visits: (a) => [a - 4], paid: { pkg: 'check', daysAgo: 8, status: 'completed' } },
  { status: 'active', activatedDaysAgo: [12, 18], visits: (a) => [a - 2, 3], paid: { pkg: 'check', daysAgo: -3, status: 'requested' } },
  { status: 'active', activatedDaysAgo: [8, 10], visits: () => [5] },
  { status: 'sold', activatedDaysAgo: [65, 65], closedDaysAgo: 5, visits: () => [62, 40], paid: { pkg: 'check', daysAgo: 20, status: 'completed' }, coverHelp: false },
  { status: 'transferred', activatedDaysAgo: [100, 100], closedDaysAgo: 10, visits: () => [97, 70, 45, 20], coverHelp: true },
];

export function seedBackgroundHomes(s: SeedBuilder): void {
  const rand = mulberry32(20261017);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p: number) => rand() < p;

  const newHome = (status: HomeStatus, invitedDaysAgo: number) => {
    const c = pick(CITIES);
    const surname = pick(SURNAMES);
    const home = s.home({
      status,
      address_line: `${pick(STREETS)} ${between(1, 60)}`,
      postal_code: c.postal,
      city: c.city,
      lat: Math.round((c.lat + (rand() - 0.5) * 0.02) * 10000) / 10000,
      lng: Math.round((c.lng + (rand() - 0.5) * 0.04) * 10000) / 10000,
      estate_name: `${pick(ESTATE_FIRST)} ${surname}`,
      building_type: pick(['detached', 'detached', 'semi_detached'] as const),
      year_built: between(1952, 1996),
      invited_at: s.at(invitedDaysAgo, `${String(between(8, 16)).padStart(2, '0')}:${pick(['05', '20', '35', '50'])}`),
    });
    s.log(home, { type: 'home_invited', at: home.invited_at, actor: 'If estate support', message: 'If estate support invited the family to Home Watch' });
    return { home, surname };
  };

  // 2 invited, 1 declined, 1 in setup
  for (let i = 0; i < 2; i++) newHome('invited', between(1, 4)).home.invite_token = `bg-invite-${i + 1}`;
  const declined = newHome('declined', 12).home;
  declined.closed_at = s.at(11, '18:30');
  declined.close_reason = 'Someone still lives in the home';
  s.log(declined, { type: 'home_updated', at: declined.closed_at, actor: 'Home Watch', message: 'The invitation was closed: someone still lives in the home' });

  const { home: setupHome, surname: setupSurname } = newHome('setup', 3);
  setupHome.setup_started_at = s.at(1, '19:10');
  setupHome.occupancy_confirmed = true;
  const setupCoordinator = s.member(setupHome, { name: `${pick(MEMBER_FIRST)} ${setupSurname}`, role: 'coordinator', relation: 'child', city: pick(CITIES).city, canAuthorise: false, createdAt: setupHome.setup_started_at, joinedAt: setupHome.setup_started_at });
  s.log(setupHome, { type: 'member_joined', at: setupHome.setup_started_at, actor: setupCoordinator.name, memberId: setupCoordinator.id, message: `${firstName(setupCoordinator.name)} accepted the invitation` });

  // 6 active, 1 sold, 1 transferred
  for (const p of ACTIVE_PLANS) {
    const a = between(p.activatedDaysAgo[0], p.activatedDaysAgo[1]);
    const { home, surname } = newHome(p.status, a + 2);
    home.setup_started_at = s.at(a + 1, '19:30');
    home.activated_at = s.at(a, '20:10');
    home.vacant_since = addDays(s.todayStr, -(a + between(5, 30)));
    home.occupancy_confirmed = true;
    home.authority_confirmed = true;
    home.heating_type = pick(['district', 'district', 'electric', 'oil', 'ground_heat_pump', 'air_heat_pump'] as const);
    home.heating_on = 'yes';
    home.water_source = pick(['municipal', 'municipal', 'well'] as const);
    home.water_main_closed = pick(['yes', 'yes', 'no', 'unknown'] as const);
    home.has_alarm = pick(['yes', 'no', 'no'] as const);

    const coordinator = s.member(home, { name: `${pick(MEMBER_FIRST)} ${surname}`, role: 'coordinator', relation: 'child', city: pick(CITIES).city, canAuthorise: true, phone: `+358 40 000 ${between(1000, 9999)}`, createdAt: home.setup_started_at, joinedAt: home.setup_started_at });
    home.key_holder = coordinator.name;
    const team = [coordinator];
    const extra = between(1, 3);
    for (let i = 0; i < extra; i++) {
      const role: Role = chance(0.7) ? 'helper' : 'viewer';
      const joined = chance(0.7);
      const used = new Set(s.members.filter((m) => m.home_id === home.id).map((m) => firstName(m.name)));
      const first = MEMBER_FIRST.find((n) => !used.has(n) && rand() < 0.5) ?? MEMBER_FIRST.find((n) => !used.has(n)) ?? 'Laura';
      const m = s.member(home, {
        name: `${first} ${surname}`,
        role,
        relation: pick(['child', 'child', 'grandchild', 'sibling', 'relative'] as const),
        city: pick(CITIES).city,
        canAuthorise: role === 'helper' && chance(0.5),
        createdAt: s.plus(home.setup_started_at, 0.5),
        joinedAt: joined ? s.plus(home.setup_started_at, between(2, 30)) : null,
        invitedBy: coordinator.id,
      });
      if (role === 'helper' && joined) team.push(m);
    }
    s.log(home, { type: 'member_joined', at: home.setup_started_at, actor: coordinator.name, memberId: coordinator.id, message: `${firstName(coordinator.name)} accepted the invitation` });

    const plan = s.plan(home, home.activated_at);
    s.log(home, { type: 'home_activated', at: home.activated_at, actor: coordinator.name, memberId: coordinator.id, message: `Care plan created with ${plan.length} tasks` });

    // Tasks due before today (or before closing): 60–95% done, with realistic acceptance times.
    const cutoff = p.closedDaysAgo ? new Date(s.at(p.closedDaysAgo, '12:00')).getTime() : s.now;
    const doneRate = 0.6 + rand() * 0.35;
    for (const t of plan) {
      if (t.template_key === 'monthly_visit' || t.template_key === 'first_walkthrough') {
        s.accept(t, pick(team), s.past(s.plus(home.activated_at, between(1, 20))));
        continue;
      }
      const due = new Date(t.due_at as string).getTime();
      const owner = pick(team);
      if (due < cutoff) {
        if (chance(doneRate)) {
          const acceptedAt = s.past(s.plus(t.created_at, between(2, 60)));
          s.accept(t, owner, acceptedAt);
          const doneAt = Math.min(new Date(s.plus(acceptedAt, between(4, 96))).getTime(), due + 48 * HOUR, cutoff - HOUR);
          s.complete(t, owner.name, s.past(new Date(Math.max(doneAt, new Date(acceptedAt).getTime() + HOUR)).toISOString()));
          if (t.recurrence_days) s.next(t, t.completed_at as string);
        } else if (chance(0.5)) {
          s.accept(t, owner, s.past(s.plus(t.created_at, between(30, 120))));
        }
      } else if (chance(0.3)) {
        s.accept(t, owner, s.past(s.plus(t.created_at, between(2, 72))));
      }
    }

    // Visits: family ones plus the paid partner visit, in date order.
    const events: { daysAgo: number; kind: 'family' | 'paid' }[] = p.visits(a).map((d) => ({ daysAgo: d, kind: 'family' as const }));
    if (p.paid?.status === 'completed') events.push({ daysAgo: p.paid.daysAgo, kind: 'paid' });
    events.sort((x, y) => y.daysAgo - x.daysAgo);
    for (const e of events) {
      if (e.kind === 'family') {
        const visitor = pick(team);
        const at = s.at(e.daysAgo, `${String(between(10, 17)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`);
        s.visit(home, { at, member: visitor, temp: Math.round((17.5 + rand() * 3) * 10) / 10, checks: s.checks(home, at) });
      } else if (p.paid) {
        const b = s.booking(home, { pkg: p.paid.pkg, status: 'completed', slotDaysAgo: e.daysAgo, slot: p.paid.pkg === 'winter' ? ['09:00', '12:00'] : ['13:00', '15:00'], requestedBy: coordinator, requestedAt: s.at(e.daysAgo + 2, '18:45'), accessMethod: pick(['key_holder_meets', 'key_box', 'partner_collects_key'] as const) });
        s.partnerVisit(home, b, { temp: Math.round((17.5 + rand() * 2.5) * 10) / 10 });
      }
    }
    if (p.paid?.status === 'requested') {
      s.booking(home, { pkg: p.paid.pkg, status: 'requested', slotDaysAgo: p.paid.daysAgo, slot: ['13:00', '15:00'], requestedBy: coordinator, requestedAt: s.at(1, '20:05'), accessMethod: 'key_holder_meets', accessDetails: `${coordinator.name} meets the partner at the door` });
    }

    // A weather alert: a heating check created the day before the cold day.
    if (p.alert) {
      const createdAt = s.at(p.alert.forDaysAgo + 1, '06:10');
      const task = s.weatherTask(home, p.alert.rule === 'hard_frost' ? 'urgent' : 'high', createdAt, s.at(p.alert.forDaysAgo + 1, '18:00'));
      if (p.alert.actioned) {
        const owner = pick(team);
        s.accept(task, owner, s.plus(createdAt, 1.5));
        s.complete(task, owner.name, s.at(p.alert.forDaysAgo + 1, '16:40'), { note: 'Heating running, 19 °C inside.' });
      }
      s.alert(home, { rule: p.alert.rule, forDaysAgo: p.alert.forDaysAgo, minC: p.alert.minC, task, createdAt });
    }

    if (p.closedDaysAgo) {
      const closedAt = s.at(p.closedDaysAgo, '12:00');
      home.closed_at = closedAt;
      home.close_reason = p.status === 'sold' ? 'Sold' : 'Passed to an heir';
      home.new_owner_wants_cover_help = p.coverHelp ?? false;
      for (const t of s.tasks.filter((x) => x.home_id === home.id && (x.status === 'open' || x.status === 'accepted'))) {
        t.status = 'cancelled';
        t.updated_at = closedAt;
      }
      s.log(home, { type: 'home_transition', at: closedAt, actor: coordinator.name, memberId: coordinator.id, message: `${firstName(coordinator.name)} closed the plan: ${home.close_reason}` });
    }
  }
}

export function buildSeed(): SeedBuilder {
  const s = new SeedBuilder();
  seedMainHome(s);
  seedExampleHome(s);
  seedBackgroundHomes(s);
  return s;
}

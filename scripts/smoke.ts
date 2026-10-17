import { config } from 'dotenv';
import type {
  ActorGrant,
  BookingOptions,
  Booking,
  CheckItem,
  Dashboard,
  HomeRecord,
  HomeWeather,
  Insights,
  InviteView,
  Member,
  Note,
  NotificationsResponse,
  PartnerJob,
  PersonasResponse,
  Photo,
  PlanResponse,
  Task,
  Visit,
} from '../lib/contract';

config({ path: '.env.local', quiet: true });

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const KEY = process.env.API_KEY;
if (!KEY) {
  console.error('API_KEY is missing in .env.local');
  process.exit(1);
}

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface CallOptions {
  actor?: string;
  body?: unknown;
  form?: FormData;
  key?: string | null;
}

async function call<T>(method: string, path: string, opts: CallOptions = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  const key = opts.key === undefined ? KEY : opts.key;
  if (key) headers.Authorization = `Bearer ${key}`;
  if (opts.actor) headers['X-Actor'] = opts.actor;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, data: data as T };
}

async function ok<T>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  const { status, data } = await call<T>(method, path, opts);
  if (status < 200 || status >= 300) throw new Error(`${method} ${path} → ${status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let failures = 0;
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failures++;
    console.log(`✘ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  let A = '';
  let mikko = '';
  let homeId = '';
  let exampleHomeId = '';
  let partnerActor = '';
  let tasks: Task[] = [];
  let heatingTaskId = '';
  let bookingId = '';

  const findTask = async (actor: string, key: string, filter = 'all') => {
    const plan = await ok<PlanResponse>('GET', `/api/homes/${homeId}/tasks?filter=${filter}`, { actor });
    return plan.tasks.filter((t) => t.templateKey === key);
  };

  await step('1. GET /api/health', async () => {
    const health = await ok<{ ok: boolean }>('GET', '/api/health');
    expect(health.ok === true, 'health.ok is not true');
  });

  await step('2. POST /api/demo/reset', async () => {
    const reset = await ok<{ ok: boolean }>('POST', '/api/demo/reset');
    expect(reset.ok, 'reset failed');
  });

  await step('3. GET /api/demo/personas: 4 groups, example has 3', async () => {
    const p = await ok<PersonasResponse>('GET', '/api/demo/personas');
    expect(p.groups.length === 4, `expected 4 groups, got ${p.groups.length}`);
    expect(p.groups[1].personas.length === 3, `expected 3 example personas, got ${p.groups[1].personas.length}`);
    exampleHomeId = p.groups[1].personas[0].homeId ?? '';
    partnerActor = p.groups[2].personas[0].actor;
  });

  await step('4. GET /api/invites/demo-virtanen: invited', async () => {
    const invite = await ok<InviteView>('GET', '/api/invites/demo-virtanen');
    expect(invite.status === 'invited', `status is ${invite.status}`);
  });

  await step('5. Accept the invitation as Aino', async () => {
    const grant = await ok<ActorGrant>('POST', '/api/invites/demo-virtanen/accept', {
      body: { name: 'Aino Virtanen', relation: 'child', city: 'Helsinki', phone: '+358 40 000 0201' },
    });
    A = grant.actor;
    homeId = grant.homeId ?? '';
    expect(A.startsWith('member:') && homeId, 'no actor in grant');
  });

  await step('6. PATCH the home setup as Aino', async () => {
    await ok('PATCH', `/api/homes/${homeId}`, {
      actor: A,
      body: {
        occupancyConfirmed: true,
        authorityConfirmed: true,
        heatingType: 'district',
        heatingOn: 'yes',
        waterSource: 'municipal',
        waterMainClosed: 'unknown',
        keyHolder: 'Aino',
      },
    });
  });

  await step('7. PATCH Aino: canAuthorise', async () => {
    const m = await ok<Member>('PATCH', `/api/members/${A.slice(7)}`, { actor: A, body: { canAuthorise: true } });
    expect(m.canAuthorise, 'canAuthorise not set');
  });

  await step('8. Activate: plan has water_main_close (needsInfo), heating_check, monthly_visit', async () => {
    const res = await ok<{ tasks: Task[] }>('POST', `/api/homes/${homeId}/activate`, { actor: A });
    tasks = res.tasks;
    const close = tasks.find((t) => t.templateKey === 'water_main_close');
    expect(close?.needsInfo, 'water_main_close missing or without needsInfo');
    expect(tasks.some((t) => t.templateKey === 'heating_check'), 'heating_check missing');
    expect(tasks.some((t) => t.templateKey === 'monthly_visit'), 'monthly_visit missing');
  });

  await step('9. Invite Mikko as a helper', async () => {
    const res = await ok<{ member: Member; joinPath: string }>('POST', `/api/homes/${homeId}/members`, {
      actor: A,
      body: { name: 'Mikko Virtanen', relation: 'child', role: 'helper', canAuthorise: false, phone: '+358 40 000 0202', city: 'Tampere' },
    });
    expect(res.joinPath.startsWith('/join/'), 'no joinPath');
    mikko = `member:${res.member.id}`;
  });

  await step('10. Assign the first visit to Mikko', async () => {
    const first = tasks.find((t) => t.templateKey === 'first_walkthrough');
    expect(first, 'first_walkthrough missing');
    const t = await ok<Task>('POST', `/api/tasks/${first.id}/assign`, { actor: A, body: { memberId: mikko.slice(7) } });
    expect(t.assignee?.id === mikko.slice(7) && t.status === 'accepted', 'not assigned');
  });

  await step('11. Mikko adds the water main valve photo and note → task done', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(PNG_1X1, 'base64')], { type: 'image/png' }), 'valve.png');
    form.append('caption', 'Water main valve');
    const photo = await ok<Photo>('POST', `/api/homes/${homeId}/photos`, { actor: mikko, form });
    expect(photo.url, 'photo has no url');
    const note = await ok<Note>('POST', `/api/homes/${homeId}/notes`, {
      actor: mikko,
      body: {
        category: 'water',
        title: 'Water main valve',
        body: 'Under the kitchen sink, red handle. Open for now.',
        essentialKey: 'water_main_valve',
        confirmed: true,
        photoIds: [photo.id],
      },
    });
    expect(note.photos.length === 1, 'note has no photo');
    const valve = await findTask(A, 'water_main_photo');
    expect(valve[0]?.status === 'done', `water_main_photo is ${valve[0]?.status}`);
  });

  await step('12. Mikko records a visit: first visit done, next monthly visit exists', async () => {
    const checklist = await ok<CheckItem[]>('GET', `/api/homes/${homeId}/visit-checklist`, { actor: mikko });
    const visit = await ok<Visit>('POST', `/api/homes/${homeId}/visits`, {
      actor: mikko,
      body: {
        visitedAt: new Date().toISOString(),
        indoorTempC: 18,
        checks: checklist.map((c) => ({ key: c.key, result: 'ok' })),
        notes: 'All fine.',
      },
    });
    expect(visit.okCount === checklist.length, 'not all checks OK');
    const first = await findTask(A, 'first_walkthrough');
    expect(first[0]?.status === 'done', `first_walkthrough is ${first[0]?.status}`);
    const monthly = await findTask(A, 'monthly_visit', 'open');
    expect(monthly.length === 1, `expected one open monthly visit, got ${monthly.length}`);
  });

  await step('13. Cold night: hard_frost alert, urgent heating check nobody owns, Aino told', async () => {
    const weather = await ok<HomeWeather>('POST', `/api/demo/homes/${homeId}/cold-night`);
    expect(weather.activeAlerts.some((a) => a.rule === 'hard_frost'), 'no hard_frost alert');
    const heating = (await findTask(A, 'heating_check', 'open'))[0];
    expect(heating?.priority === 'urgent' && heating.needsOwner, 'heating check not urgent / not needing an owner');
    heatingTaskId = heating.id;
    const inbox = await ok<NotificationsResponse>('GET', '/api/notifications', { actor: A });
    expect(inbox.items.some((n) => n.title.startsWith('Nobody has accepted')), 'no "Nobody has accepted" notification');
  });

  await step('14. Aino books a check visit for the heating check → requested', async () => {
    const options = await ok<BookingOptions>('GET', `/api/homes/${homeId}/booking-options?taskId=${heatingTaskId}`, { actor: A });
    expect(options.slots.check.length > 0, 'no check slots');
    expect(options.task?.id === heatingTaskId, 'task not returned');
    const booking = await ok<Booking>('POST', `/api/homes/${homeId}/bookings`, {
      actor: A,
      body: {
        packageKey: 'check',
        slotStart: options.slots.check[0].start,
        accessMethod: 'key_holder_meets',
        taskId: heatingTaskId,
        confirmAuthority: true,
      },
    });
    expect(booking.status === 'requested', `booking is ${booking.status}`);
    bookingId = booking.id;
    const task = await ok<{ task: Task }>('GET', `/api/tasks/${heatingTaskId}`, { actor: A });
    expect(task.task.bookingId === bookingId, 'task.bookingId not set');
  });

  await step('15. Simulated partner visit: 1 concern, booking done, heating done, roof follow-up', async () => {
    const visit = await ok<Visit>('POST', `/api/demo/bookings/${bookingId}/complete`);
    expect(visit.concernCount === 1, `concerns: ${visit.concernCount}`);
    const detail = await ok<{ booking: Booking }>('GET', `/api/bookings/${bookingId}`, { actor: A });
    expect(detail.booking.status === 'completed', `booking is ${detail.booking.status}`);
    const heating = await ok<{ task: Task }>('GET', `/api/tasks/${heatingTaskId}`, { actor: A });
    expect(heating.task.status === 'done', `heating check is ${heating.task.status}`);
    const plan = await ok<PlanResponse>('GET', `/api/homes/${homeId}/tasks?filter=open`, { actor: A });
    expect(plan.tasks.some((t) => t.title === 'Follow up: Snow on the roof looks manageable'), 'no roof follow-up');
  });

  await step('16. Dashboard as Aino: counts make sense, no active booking', async () => {
    const d = await ok<Dashboard>('GET', `/api/homes/${homeId}/dashboard`, { actor: A });
    expect(d.counts.open > 0 && d.counts.doneLast30d >= 4, `counts: ${JSON.stringify(d.counts)}`);
    expect(d.activeBooking === null, 'activeBooking is not null');
    expect(d.supervision.state === 'ok', `supervision is ${d.supervision.state}`);
  });

  await step('17. Home record: ≥ 2 visits and the disclaimer', async () => {
    const r = await ok<HomeRecord>('GET', `/api/homes/${homeId}/record`, { actor: A });
    expect(r.visits.length >= 2, `visits: ${r.visits.length}`);
    expect(r.disclaimer.startsWith('This record lists observations'), 'no disclaimer');
  });

  await step('18. Insights as staff: ≥ 14 homes, 5 funnel stages', async () => {
    const i = await ok<Insights>('GET', '/api/insights', { actor: 'staff' });
    expect(i.homes.invited >= 14, `homes.invited = ${i.homes.invited}`);
    expect(i.funnel.length === 5, `funnel stages: ${i.funnel.length}`);
  });

  await step('19. Partner done jobs include the completed booking', async () => {
    const jobs = await ok<PartnerJob[]>('GET', '/api/partner/jobs?status=done', { actor: partnerActor });
    expect(jobs.some((j) => j.booking.id === bookingId), 'booking not in done jobs');
  });

  await step('20. No API key → 401; Mikko on the example home → 403', async () => {
    const noKey = await call('GET', '/api/health', { key: null });
    expect(noKey.status === 401, `no key: ${noKey.status}`);
    const other = await call('GET', `/api/homes/${exampleHomeId}`, { actor: mikko });
    expect(other.status === 403, `other home: ${other.status}`);
  });

  await step('21. POST /api/demo/reset again', async () => {
    const reset = await ok<{ ok: boolean }>('POST', '/api/demo/reset');
    expect(reset.ok, 'reset failed');
  });

  if (failures) {
    console.log(`\n${failures} step(s) failed`);
    process.exit(1);
  }
  console.log('\nAll smoke steps passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

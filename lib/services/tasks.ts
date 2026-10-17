import type { Activity, CreateTaskBody, PlanResponse, Task, TaskDetail, TaskFilter, TaskPatch } from '@/lib/contract';
import type { HomeAccess } from '@/lib/auth';
import { ApiError, forbidden, invalidState } from '@/lib/errors';
import { exec, one, row, rows, type BookingRow, type MemberRow, type PhotoRow, type TaskRow } from '@/lib/db';
import { mapPhotos, sortPlan } from '@/lib/mappers';
import type { TaskInsert } from '@/lib/plan/generate';
import { templateByKey } from '@/lib/plan/templates';
import { db } from '@/lib/supabase';
import { dueAfter, firstName } from '@/lib/time';
import { logActivity, mapActivity } from './activity';
import { coordinatorIds, homeMembers, notify } from './notifications';
import { linkPhotos } from './photos';
import { allMembers, bookingView, homeTaskRows, namesFor, taskViews } from './views';

const isActive = (t: { status: string }) => t.status === 'open' || t.status === 'accepted';
const q = (title: string) => `“${title}”`;
const taskLink = (t: TaskRow) => `/homes/${t.home_id}/tasks/${t.id}`;

/* ---------------- low-level writes ---------------- */

export async function insertTasks(items: TaskInsert[]): Promise<TaskRow[]> {
  if (items.length === 0) return [];
  return rows<TaskRow>(db().from('tasks').insert(items).select('*'));
}

export async function updateTask(id: string, patch: Partial<TaskRow>): Promise<TaskRow> {
  return one<TaskRow>(
    db()
      .from('tasks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single(),
  );
}

async function nextOccurrence(task: TaskRow, base: Date): Promise<TaskRow> {
  const template = templateByKey(task.template_key);
  let assigneeId: string | null = null;
  if (task.assignee_id) {
    const m = await row<MemberRow>(db().from('members').select('*').eq('id', task.assignee_id).maybeSingle());
    if (m?.status === 'joined') assigneeId = m.id;
  }
  const [created] = await insertTasks([
    {
      home_id: task.home_id,
      template_key: task.template_key,
      title: task.title,
      why: task.why,
      how: task.how,
      category: task.category,
      priority: template?.priority ?? task.priority,
      status: assigneeId ? 'accepted' : 'open',
      assignee_id: assigneeId,
      accepted_at: assigneeId ? new Date().toISOString() : null,
      due_at: dueAfter(base, task.recurrence_days ?? 30).toISOString(),
      recurrence_days: task.recurrence_days,
      origin: 'plan',
      source_label: task.source_label,
      source_url: task.source_url,
      created_by_label: 'Home Watch',
    },
  ]);
  return created;
}

/**
 * Marks a task done. Recurring tasks get their next occurrence, due `recurrenceDays` after `nextBase`
 * (the completion time, or the visit date when a visit completed it).
 */
export async function completeTaskRow(
  task: TaskRow,
  opts: { byLabel: string; note?: string | null; visitId?: string | null; at?: Date; nextBase?: Date },
): Promise<{ done: TaskRow; next: TaskRow | null }> {
  const at = opts.at ?? new Date();
  const done = await updateTask(task.id, {
    status: 'done',
    completed_at: at.toISOString(),
    completed_by_label: opts.byLabel,
    completion_note: opts.note ?? null,
    completed_by_visit_id: opts.visitId ?? null,
    accepted_at: task.accepted_at ?? at.toISOString(),
  });
  const next = task.recurrence_days ? await nextOccurrence(task, opts.nextBase ?? at) : null;
  return { done, next };
}

/* ---------------- reading ---------------- */

export async function planResponse(homeId: string, me: MemberRow, filter: TaskFilter): Promise<PlanResponse> {
  const [taskRows, names] = await Promise.all([homeTaskRows(homeId), namesFor(homeId)]);
  const all = sortPlan(await taskViews(taskRows, names));
  const predicates: Record<TaskFilter, (t: Task) => boolean> = {
    all: () => true,
    mine: (t) => t.assignee?.id === me.id && isActive(t),
    open: isActive,
    needs_owner: (t) => t.needsOwner,
    overdue: (t) => t.isOverdue,
    done: (t) => t.status === 'done',
  };
  const count = (f: TaskFilter) => all.filter(predicates[f]).length;
  return {
    tasks: all.filter(predicates[filter]),
    counts: {
      all: all.length,
      mine: count('mine'),
      open: count('open'),
      needsOwner: count('needs_owner'),
      overdue: count('overdue'),
      done: count('done'),
    },
  };
}

export async function taskView(task: TaskRow): Promise<Task> {
  const [view] = await taskViews([task]);
  return view;
}

export async function taskDetail(access: HomeAccess, task: TaskRow): Promise<TaskDetail> {
  const [activity, photos, booking] = await Promise.all([
    rows<Parameters<typeof mapActivity>[0]>(
      db().from('activity').select('*').eq('task_id', task.id).order('created_at', { ascending: true }),
    ),
    rows<PhotoRow>(db().from('photos').select('*').eq('task_id', task.id).order('created_at')),
    task.booking_id
      ? row<BookingRow>(db().from('bookings').select('*').eq('id', task.booking_id).maybeSingle())
      : row<BookingRow>(
          db().from('bookings').select('*').eq('task_id', task.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ),
  ]);
  return {
    task: await taskView(task),
    activity: activity.map(mapActivity),
    photos: await mapPhotos(photos),
    booking: booking ? await bookingView(booking) : null,
    canEdit: access.me.role === 'coordinator',
  };
}

/* ---------------- actions (8.4) ---------------- */

async function assertAssignable(homeId: string, memberId: string): Promise<MemberRow> {
  const m = await row<MemberRow>(db().from('members').select('*').eq('id', memberId).eq('home_id', homeId).maybeSingle());
  if (!m || m.status === 'removed') throw new ApiError(400, 'invalid_request', 'That person is not part of this home');
  if (m.role === 'viewer') throw invalidState("Viewers can read and comment, but can't take tasks");
  return m;
}

export async function createTask({ home, me }: HomeAccess, body: CreateTaskBody): Promise<Task> {
  let assignee: MemberRow | null = null;
  if (body.assigneeId) {
    if (me.role !== 'coordinator' && body.assigneeId !== me.id) throw forbidden('Helpers can only take a task themselves');
    assignee = await assertAssignable(home.id, body.assigneeId);
  }
  const now = new Date().toISOString();
  const [task] = await insertTasks([
    {
      home_id: home.id,
      title: body.title,
      why: body.why ?? null,
      category: body.category,
      priority: body.priority,
      due_at: body.dueAt ?? null,
      status: assignee ? 'accepted' : 'open',
      assignee_id: assignee?.id ?? null,
      accepted_at: assignee ? now : null,
      origin: 'manual',
      created_by_label: me.name,
    },
  ]);
  await logActivity({
    homeId: home.id,
    type: 'task_created',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: assignee && assignee.id !== me.id
      ? `${firstName(me.name)} added ${q(task.title)} for ${firstName(assignee.name)}`
      : `${firstName(me.name)} added ${q(task.title)}`,
    taskId: task.id,
  });
  if (assignee && assignee.id !== me.id) {
    await notify(
      { memberIds: [assignee.id], exceptMemberId: me.id },
      { homeId: home.id, channel: 'in_app', title: `${firstName(me.name)} asked you to do this`, body: task.title, link: taskLink(task) },
    );
  }
  return taskView(task);
}

export async function acceptTask({ home, me }: HomeAccess, task: TaskRow): Promise<Task> {
  if (!isActive(task)) throw invalidState('Only open tasks can be accepted');
  const updated = await updateTask(task.id, {
    assignee_id: me.id,
    status: 'accepted',
    accepted_at: new Date().toISOString(),
    declined_by: (task.declined_by ?? []).filter((id) => id !== me.id),
  });
  await logActivity({
    homeId: home.id,
    type: 'task_accepted',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} is on ${q(task.title)}`,
    taskId: task.id,
  });
  await notify(
    { memberIds: coordinatorIds(await homeMembers(home.id)), exceptMemberId: me.id },
    { homeId: home.id, channel: 'in_app', title: `${firstName(me.name)} is on it`, body: task.title, link: taskLink(task) },
  );
  return taskView(updated);
}

export async function declineTask({ home, me }: HomeAccess, task: TaskRow, reason: string): Promise<Task> {
  if (!isActive(task)) throw invalidState('Only open tasks can be declined');
  const wasMine = task.assignee_id === me.id;
  const updated = await updateTask(task.id, {
    declined_by: [...new Set([...(task.declined_by ?? []), me.id])],
    ...(wasMine ? { assignee_id: null, status: 'open' as const } : {}),
  });
  await logActivity({
    homeId: home.id,
    type: 'task_declined',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} can't do ${q(task.title)}: ${reason}`,
    taskId: task.id,
  });
  await notify(
    { memberIds: coordinatorIds(await homeMembers(home.id)), exceptMemberId: me.id },
    { homeId: home.id, channel: 'in_app', title: `${firstName(me.name)} can't do this`, body: `${task.title}: ${reason}`, link: taskLink(task) },
  );
  return taskView(updated);
}

export async function assignTask({ home, me }: HomeAccess, task: TaskRow, memberId: string | null): Promise<Task> {
  if (!isActive(task)) throw invalidState('Only open tasks can be assigned');
  const isCoordinator = me.role === 'coordinator';
  if (!isCoordinator) {
    // Helpers can take a task themselves, or step back from one they hold.
    if (memberId !== null && memberId !== me.id) throw forbidden('Helpers can only assign a task to themselves');
    if (memberId === null && task.assignee_id !== me.id) throw forbidden('Only a coordinator can unassign someone else');
  }
  const assignee = memberId ? await assertAssignable(home.id, memberId) : null;
  const updated = await updateTask(
    task.id,
    assignee
      ? { assignee_id: assignee.id, status: 'accepted', accepted_at: new Date().toISOString() }
      : { assignee_id: null, status: 'open' },
  );
  const message = assignee
    ? assignee.id === me.id
      ? `${firstName(me.name)} took ${q(task.title)}`
      : `${firstName(me.name)} asked ${firstName(assignee.name)} to do ${q(task.title)}`
    : `${firstName(me.name)} unassigned ${q(task.title)}`;
  await logActivity({ homeId: home.id, type: 'task_assigned', actorLabel: me.name, actorMemberId: me.id, message, taskId: task.id });
  if (assignee && assignee.id !== me.id) {
    await notify(
      { memberIds: [assignee.id], exceptMemberId: me.id },
      { homeId: home.id, channel: 'in_app', title: `${firstName(me.name)} asked you to do this`, body: task.title, link: taskLink(task) },
    );
  }
  return taskView(updated);
}

export async function completeTask(
  { home, me }: HomeAccess,
  task: TaskRow,
  body: { note?: string; photoIds?: string[] },
): Promise<{ task: Task; nextTask: Task | null }> {
  if (!isActive(task)) throw invalidState('This task is already done or cancelled');
  if (body.photoIds?.length) await linkPhotos(home.id, body.photoIds, 'task_id', task.id);
  const { done, next } = await completeTaskRow(task, { byLabel: me.name, note: body.note ?? null });
  await logActivity({
    homeId: home.id,
    type: 'task_completed',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} completed ${q(task.title)}`,
    taskId: task.id,
  });
  await notify(
    { memberIds: coordinatorIds(await homeMembers(home.id)), exceptMemberId: me.id },
    { homeId: home.id, channel: 'in_app', title: `Done: ${task.title}`, body: `Completed by ${me.name}.`, link: taskLink(task) },
  );
  const names = await namesFor(home.id);
  const [doneView, nextView] = await taskViews(next ? [done, next] : [done], names);
  return { task: doneView, nextTask: nextView ?? null };
}

export async function reopenTask({ home, me }: HomeAccess, task: TaskRow): Promise<Task> {
  if (task.status !== 'done') throw invalidState('Only done tasks can be reopened');
  const updated = await updateTask(task.id, {
    status: task.assignee_id ? 'accepted' : 'open',
    completed_at: null,
    completed_by_label: null,
    completion_note: null,
    completed_by_visit_id: null,
  });
  await logActivity({
    homeId: home.id,
    type: 'task_reopened',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} reopened ${q(task.title)}`,
    taskId: task.id,
  });
  return taskView(updated);
}

export async function commentOnTask({ home, me }: HomeAccess, task: TaskRow, body: string): Promise<Activity> {
  const [created] = await rows<Parameters<typeof mapActivity>[0]>(
    db()
      .from('activity')
      .insert({
        home_id: home.id,
        type: 'task_commented',
        actor_label: me.name,
        actor_member_id: me.id,
        message: body,
        task_id: task.id,
      })
      .select('*'),
  );
  const members = await homeMembers(home.id);
  await notify(
    { memberIds: [...coordinatorIds(members), ...(task.assignee_id ? [task.assignee_id] : [])], exceptMemberId: me.id },
    { homeId: home.id, channel: 'in_app', title: `${firstName(me.name)} commented on ${q(task.title)}`, body, link: taskLink(task) },
  );
  return mapActivity(created);
}

export async function patchTask({ home, me }: HomeAccess, task: TaskRow, body: TaskPatch): Promise<Task> {
  const cancelling = body.status === 'cancelled';
  if (cancelling && !isActive(task)) throw invalidState('Only open tasks can be cancelled');
  const patch: Partial<TaskRow> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.why !== undefined) patch.why = body.why;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.dueAt !== undefined) patch.due_at = body.dueAt;
  if (cancelling) patch.status = 'cancelled';
  const updated = Object.keys(patch).length ? await updateTask(task.id, patch) : task;
  await logActivity({
    homeId: home.id,
    type: cancelling ? 'task_cancelled' : 'task_updated',
    actorLabel: me.name,
    actorMemberId: me.id,
    message: `${firstName(me.name)} ${cancelling ? 'cancelled' : 'updated'} ${q(updated.title)}`,
    taskId: task.id,
  });
  if (task.assignee_id && task.assignee_id !== me.id) {
    await notify(
      { memberIds: [task.assignee_id], exceptMemberId: me.id },
      {
        homeId: home.id,
        channel: 'in_app',
        title: `${firstName(me.name)} ${cancelling ? 'cancelled' : 'updated'} a task`,
        body: updated.title,
        link: taskLink(task),
      },
    );
  }
  return taskView(updated);
}

/** Members with open tasks get them back as "Nobody yet" (used when a member is removed). */
export async function unassignMember(memberId: string): Promise<void> {
  await exec(
    db()
      .from('tasks')
      .update({ assignee_id: null, status: 'open', updated_at: new Date().toISOString() })
      .eq('assignee_id', memberId)
      .in('status', ['open', 'accepted']),
  );
}

export { allMembers };

import type { Booking, Task, Visit } from '@/lib/contract';
import { rows, type BookingRow, type MemberRow, type PartnerRow, type PhotoRow, type TaskRow, type VisitRow } from '@/lib/db';
import { mapBooking, mapPhoto, mapTask, mapVisit, nameMap, signPaths, type NameMap } from '@/lib/mappers';
import { db } from '@/lib/supabase';

/* Read-side builders that join several tables. They only read, so every service can use them. */

/** Every member of a home, removed ones included, so old names still resolve. */
export async function allMembers(homeId: string): Promise<MemberRow[]> {
  return rows<MemberRow>(db().from('members').select('*').eq('home_id', homeId).order('created_at'));
}

export async function namesFor(homeId: string): Promise<NameMap> {
  return nameMap(await allMembers(homeId));
}

export async function homeTaskRows(homeId: string): Promise<TaskRow[]> {
  return rows<TaskRow>(db().from('tasks').select('*').eq('home_id', homeId));
}

export async function taskViews(tasks: TaskRow[], names?: NameMap): Promise<Task[]> {
  if (tasks.length === 0) return [];
  const map = names ?? (await namesFor(tasks[0].home_id));
  const now = Date.now();
  return tasks.map((t) => mapTask(t, map, now));
}

export async function bookingViews(bookings: BookingRow[]): Promise<Booking[]> {
  if (bookings.length === 0) return [];
  const ids = bookings.map((b) => b.id);
  const homeIds = [...new Set(bookings.map((b) => b.home_id))];
  const taskIds = bookings.map((b) => b.task_id).filter((id): id is string => !!id);
  const [partners, members, tasks, visits] = await Promise.all([
    rows<PartnerRow>(db().from('partners').select('*').in('id', [...new Set(bookings.map((b) => b.partner_id))])),
    rows<MemberRow>(db().from('members').select('*').in('home_id', homeIds)),
    taskIds.length ? rows<Pick<TaskRow, 'id' | 'title'>>(db().from('tasks').select('id,title').in('id', taskIds)) : [],
    rows<Pick<VisitRow, 'id' | 'booking_id'>>(db().from('visits').select('id,booking_id').in('booking_id', ids)),
  ]);
  const names = nameMap(members);
  return bookings.map((b) => {
    const partner = partners.find((p) => p.id === b.partner_id);
    if (!partner) throw new Error(`Partner ${b.partner_id} missing`);
    return mapBooking(b, {
      partner,
      names,
      taskTitle: tasks.find((t) => t.id === b.task_id)?.title ?? null,
      visitId: visits.find((v) => v.booking_id === b.id)?.id ?? null,
    });
  });
}

export async function bookingView(booking: BookingRow): Promise<Booking> {
  const [view] = await bookingViews([booking]);
  return view;
}

/** Full visits with signed photo URLs, the tasks they closed and the follow-ups they created. */
export async function visitViews(visits: VisitRow[]): Promise<Visit[]> {
  if (visits.length === 0) return [];
  const ids = visits.map((v) => v.id);
  const [photos, completed, followUps, names] = await Promise.all([
    rows<PhotoRow>(db().from('photos').select('*').in('visit_id', ids).order('created_at')),
    rows<TaskRow>(db().from('tasks').select('*').in('completed_by_visit_id', ids).order('created_at')),
    rows<TaskRow>(db().from('tasks').select('*').in('source_visit_id', ids).order('created_at')),
    namesFor(visits[0].home_id),
  ]);
  const urls = await signPaths(photos.map((p) => p.storage_path));
  const now = Date.now();
  return visits.map((v) =>
    mapVisit(v, {
      photos: photos.filter((p) => p.visit_id === v.id).map((p) => mapPhoto(p, urls)),
      completed: completed.filter((t) => t.completed_by_visit_id === v.id),
      followUps: followUps.filter((t) => t.source_visit_id === v.id).map((t) => mapTask(t, names, now)),
    }),
  );
}

export async function visitView(visit: VisitRow): Promise<Visit> {
  const [view] = await visitViews([visit]);
  return view;
}

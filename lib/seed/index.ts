import { exec, rows } from '../db';
import { store } from '../memory-db';
import { PHOTO_BUCKET, db, usesMemoryStore } from '../supabase';
import { buildSeed } from './data';
import { uploadPlaceholder } from './placeholders';

const chunk = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

async function insert(table: string, data: object[]): Promise<void> {
  for (const part of chunk(data, 500)) await exec(db().from(table).insert(part));
}

async function wipe(): Promise<void> {
  const paths: string[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rows<{ storage_path: string }>(db().from('photos').select('storage_path').range(from, from + 999));
    paths.push(...page.map((p) => p.storage_path));
    if (page.length < 1000) break;
  }
  for (const part of chunk(paths, 100)) {
    const { error } = await db().storage.from(PHOTO_BUCKET).remove(part);
    if (error) throw new Error(`Storage error: ${error.message}`);
  }
  await exec(db().from('homes').delete().not('id', 'is', null));
  await exec(db().from('partners').delete().not('id', 'is', null));
}

/** Deletes all demo data and seeds the story homes and background homes again (10). */
export async function resetAndSeed(): Promise<{ ok: true; inviteUrl: string }> {
  const started = Date.now();
  await wipe();
  const s = buildSeed();

  const storagePaths = await Promise.all(s.photos.map((p) => uploadPlaceholder(p.row.home_id, p.title)));

  // tasks ↔ bookings ↔ visits reference each other: insert tasks without those links first, then add them.
  const linked = s.tasks.filter((t) => t.booking_id || t.source_visit_id || t.completed_by_visit_id);
  await insert('partners', [s.partner]);
  await insert('homes', s.homes);
  await insert('members', s.members);
  await insert(
    'tasks',
    s.tasks.map((t) => ({ ...t, booking_id: null, source_visit_id: null, completed_by_visit_id: null })),
  );
  await insert('bookings', s.bookings);
  await insert('visits', s.visits);
  await insert('house_notes', s.notes);
  await insert(
    'photos',
    s.photos.map((p, i) => ({ ...p.row, storage_path: storagePaths[i] })),
  );
  await insert('weather_alerts', s.alerts);
  await insert('activity', s.activity);
  await insert('notifications', s.notifications);
  for (const part of chunk(linked, 500)) await exec(db().from('tasks').upsert(part, { onConflict: 'id' }));

  console.log(`Seeded ${s.homes.length} homes, ${s.tasks.length} tasks, ${s.visits.length} visits in ${Date.now() - started} ms`);
  return { ok: true, inviteUrl: '/invite/demo-virtanen' };
}

/** The in-memory store starts empty: seed it once per server process, before the first request is handled. */
export async function ensureSeeded(): Promise<void> {
  if (!usesMemoryStore()) return;
  store.ready ??= resetAndSeed().then(
    () => undefined,
    (err) => {
      store.ready = null;
      throw err;
    },
  );
  await store.ready;
}

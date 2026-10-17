import { randomUUID } from 'node:crypto';
import type { Photo } from '@/lib/contract';
import { ApiError } from '@/lib/errors';
import { exec, isUuid, one, row, type HomeRow, type PhotoRow } from '@/lib/db';
import { mapPhotos } from '@/lib/mappers';
import { PHOTO_BUCKET, db } from '@/lib/supabase';
import { firstName } from '@/lib/time';
import { logActivity } from './activity';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

type LinkColumn = 'visit_id' | 'note_id' | 'task_id';
const LINK_TABLES: Record<LinkColumn, string> = { visit_id: 'visits', note_id: 'house_notes', task_id: 'tasks' };

async function belongsToHome(table: string, id: string, homeId: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return !!(await row(db().from(table).select('id').eq('id', id).eq('home_id', homeId).maybeSingle()));
}

/** Points the given photos (of this home only) at a visit, note or task. */
export async function linkPhotos(homeId: string, ids: string[], column: LinkColumn, value: string): Promise<void> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return;
  await exec(db().from('photos').update({ [column]: value }).in('id', valid).eq('home_id', homeId));
}

export async function uploadPhoto(
  home: HomeRow,
  uploader: { label: string; memberId: string | null },
  form: FormData,
): Promise<Photo> {
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new ApiError(400, 'invalid_request', 'Attach the photo as "file"');
  const ext = TYPES[file.type];
  if (!ext) throw new ApiError(400, 'unsupported_file_type', 'Photos must be JPEG, PNG or WebP');
  if (file.size > MAX_BYTES) throw new ApiError(400, 'file_too_large', 'Photos can be at most 5 MB');

  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const caption = text('caption')?.slice(0, 200) ?? null;
  const links: Partial<Record<LinkColumn, string>> = {};
  for (const [field, column] of [
    ['visitId', 'visit_id'],
    ['noteId', 'note_id'],
    ['taskId', 'task_id'],
  ] as const) {
    const id = text(field);
    if (!id) continue;
    if (!(await belongsToHome(LINK_TABLES[column], id, home.id))) {
      throw new ApiError(400, 'invalid_request', `${field} doesn't belong to this home`);
    }
    links[column] = id;
  }

  const path = `homes/${home.id}/${randomUUID()}.${ext}`;
  const { error } = await db()
    .storage.from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new Error(`Storage error: ${error.message}`);

  const photo = await one<PhotoRow>(
    db()
      .from('photos')
      .insert({ home_id: home.id, storage_path: path, caption, uploaded_by_label: uploader.label, ...links })
      .select('*')
      .single(),
  );
  // Photos attached to a note or a visit show up through those; keep the feed quiet.
  if (!links.note_id && !links.visit_id) {
    await logActivity({
      homeId: home.id,
      type: 'photo_added',
      actorLabel: uploader.label,
      actorMemberId: uploader.memberId,
      message: `${uploader.memberId ? firstName(uploader.label) : uploader.label} added a photo${caption ? `: ${caption}` : ''}`,
      taskId: links.task_id ?? null,
    });
  }
  const [mapped] = await mapPhotos([photo]);
  return mapped;
}

export async function deletePhotos(photos: PhotoRow[]): Promise<void> {
  if (photos.length === 0) return;
  await db()
    .storage.from(PHOTO_BUCKET)
    .remove(photos.map((p) => p.storage_path));
  await exec(
    db()
      .from('photos')
      .delete()
      .in(
        'id',
        photos.map((p) => p.id),
      ),
  );
}

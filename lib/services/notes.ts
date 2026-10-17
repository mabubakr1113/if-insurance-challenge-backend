import type { EssentialKey, Note, NoteBody, NotesResponse } from '@/lib/contract';
import type { HomeAccess } from '@/lib/auth';
import { essentialByKey } from '@/lib/catalog';
import { invalidState } from '@/lib/errors';
import { exec, one, row, rows, type HomeRow, type NoteRow, type PhotoRow, type TaskRow } from '@/lib/db';
import { essentialsFor, mapNote, mapPhoto, signPaths } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { firstName } from '@/lib/time';
import { logActivity } from './activity';
import { deletePhotos, linkPhotos } from './photos';
import { completeTaskRow } from './tasks';

const ESSENTIAL_PHRASES: Record<EssentialKey, string> = {
  water_main_valve: 'the water main valve location',
  water_meter: 'the water meter location',
  fuse_box: 'the fuse box location',
  heating_controls: 'the heating controls',
  key_location: 'where the keys are',
  neighbour_contact: 'a neighbour who can help',
  well_pump: 'the well pump location',
};

async function notesWithPhotos(notes: NoteRow[]): Promise<{ mapped: Note[]; photoCount: Map<string, number> }> {
  const photos = notes.length
    ? await rows<PhotoRow>(
        db()
          .from('photos')
          .select('*')
          .in(
            'note_id',
            notes.map((n) => n.id),
          )
          .order('created_at'),
      )
    : [];
  const urls = await signPaths(photos.map((p) => p.storage_path));
  const photoCount = new Map<string, number>();
  for (const p of photos) if (p.note_id) photoCount.set(p.note_id, (photoCount.get(p.note_id) ?? 0) + 1);
  const mapped = notes.map((n) => mapNote(n, photos.filter((p) => p.note_id === n.id).map((p) => mapPhoto(p, urls))));
  return { mapped, photoCount };
}

export async function homeNoteRows(homeId: string): Promise<NoteRow[]> {
  return rows<NoteRow>(db().from('house_notes').select('*').eq('home_id', homeId).order('updated_at', { ascending: false }));
}

export async function notesResponse(home: HomeRow): Promise<NotesResponse> {
  const notes = await homeNoteRows(home.id);
  const { mapped, photoCount } = await notesWithPhotos(notes);
  return { notes: mapped, essentials: essentialsFor(home, notes, photoCount) };
}

export async function noteView(note: NoteRow): Promise<Note> {
  const { mapped } = await notesWithPhotos([note]);
  return mapped[0];
}

/** Notes with an essential key, with photos (what a visiting partner sees). */
export async function essentialNotes(homeId: string): Promise<Note[]> {
  const notes = (await homeNoteRows(homeId)).filter((n) => n.essential_key);
  return (await notesWithPhotos(notes)).mapped;
}

/**
 * Creates or updates a note (8.6). Notes with an essential key are upserted by (home, key).
 * A confirmed essential with a photo (or one that needs none) completes its matching open task.
 */
export async function saveNote({ home, me }: HomeAccess, input: Partial<NoteBody>, existing: NoteRow | null): Promise<Note> {
  let target = existing;
  if (input.essentialKey) {
    const sameKey = await row<NoteRow>(
      db().from('house_notes').select('*').eq('home_id', home.id).eq('essential_key', input.essentialKey).maybeSingle(),
    );
    if (sameKey && existing && sameKey.id !== existing.id) {
      throw invalidState(`There's already a note for ${essentialByKey(input.essentialKey).label.toLowerCase()}`);
    }
    target = target ?? sameKey;
  }

  const fields: Partial<NoteRow> = { updated_by_label: me.name, updated_at: new Date().toISOString() };
  if (input.category !== undefined) fields.category = input.category;
  if (input.title !== undefined) fields.title = input.title;
  if (input.body !== undefined) fields.body = input.body;
  if (input.essentialKey !== undefined) fields.essential_key = input.essentialKey;
  if (input.confirmed !== undefined) fields.confirmed = input.confirmed;

  const note = target
    ? await one<NoteRow>(db().from('house_notes').update(fields).eq('id', target.id).select('*').single())
    : await one<NoteRow>(
        db()
          .from('house_notes')
          .insert({ home_id: home.id, body: '', confirmed: false, ...fields })
          .select('*')
          .single(),
      );

  if (input.photoIds?.length) await linkPhotos(home.id, input.photoIds, 'note_id', note.id);
  const { count } = await db().from('photos').select('id', { count: 'exact', head: true }).eq('note_id', note.id);
  const hasPhoto = (count ?? 0) > 0;

  const message = note.essential_key
    ? `${firstName(me.name)} ${target ? 'updated' : 'added'} ${ESSENTIAL_PHRASES[note.essential_key]}${hasPhoto ? ' with a photo' : ''}`
    : `${firstName(me.name)} ${target ? 'updated' : 'added'} the note “${note.title}”`;
  await logActivity({ homeId: home.id, type: 'note_saved', actorLabel: me.name, actorMemberId: me.id, message });

  if (note.essential_key && note.confirmed) {
    const def = essentialByKey(note.essential_key);
    if (def.completesTask && (hasPhoto || !def.needsPhoto)) {
      const open = await rows<TaskRow>(
        db().from('tasks').select('*').eq('home_id', home.id).eq('template_key', def.completesTask).in('status', ['open', 'accepted']),
      );
      for (const task of open) {
        await completeTaskRow(task, { byLabel: me.name, note: `Saved in House notes: ${note.title}` });
        await logActivity({
          homeId: home.id,
          type: 'task_completed',
          actorLabel: me.name,
          actorMemberId: me.id,
          message: `${firstName(me.name)} completed “${task.title}” with a house note`,
          taskId: task.id,
        });
      }
    }
  }
  return noteView(note);
}

export async function deleteNote(note: NoteRow): Promise<void> {
  const photos = await rows<PhotoRow>(db().from('photos').select('*').eq('note_id', note.id));
  await deletePhotos(photos);
  await exec(db().from('house_notes').delete().eq('id', note.id));
}

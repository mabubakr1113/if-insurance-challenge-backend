import { noteAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { notePatch } from '@/lib/schemas';
import { deleteNote, noteView, saveNote } from '@/lib/services/notes';

export const GET = route({ access: (actor, p, req) => noteAccess(actor, p.noteId, 'M', req) }, async ({ access }) => noteView(access.note));

export const PATCH = route(
  { access: (actor, p, req) => noteAccess(actor, p.noteId, 'H', req), body: notePatch },
  async ({ access, body }) => saveNote(access, body, access.note),
);

export const DELETE = route({ access: (actor, p, req) => noteAccess(actor, p.noteId, 'H', req) }, async ({ access }) => {
  await deleteNote(access.note);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

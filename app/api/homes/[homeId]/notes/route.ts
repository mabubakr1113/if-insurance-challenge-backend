import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { noteBody } from '@/lib/schemas';
import { notesResponse, saveNote } from '@/lib/services/notes';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => notesResponse(access.home));

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'H', req), body: noteBody },
  async ({ access, body }) => saveNote(access, body, null),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

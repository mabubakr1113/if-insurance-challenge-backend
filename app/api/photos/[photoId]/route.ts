import { photoAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { deletePhotos } from '@/lib/services/photos';

export const DELETE = route({ access: (actor, p, req) => photoAccess(actor, p.photoId, 'H', req) }, async ({ access }) => {
  await deletePhotos([access.photo]);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

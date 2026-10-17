import type { Actor } from '@/lib/auth';
import { route } from '@/lib/http';
import { markReadBody } from '@/lib/schemas';
import { markRead } from '@/lib/services/notifications';

export const POST = route({ body: markReadBody }, async ({ actor, body }) => {
  await markRead(actor as Actor, body.ids);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

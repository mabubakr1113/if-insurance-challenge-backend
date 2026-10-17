import { route } from '@/lib/http';
import { declineInviteBody } from '@/lib/schemas';
import { declineInvite } from '@/lib/services/invites';

export const POST = route({ actor: 'none', body: declineInviteBody }, async ({ params, body }) => {
  await declineInvite(params.token, body.reason);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

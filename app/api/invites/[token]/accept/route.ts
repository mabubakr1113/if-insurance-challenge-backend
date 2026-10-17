import { route } from '@/lib/http';
import { acceptInviteBody } from '@/lib/schemas';
import { acceptInvite } from '@/lib/services/invites';

export const POST = route({ actor: 'none', body: acceptInviteBody }, async ({ params, body }) => acceptInvite(params.token, body));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

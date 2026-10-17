import { route } from '@/lib/http';
import { getInvite } from '@/lib/services/invites';

export const GET = route({ actor: 'none' }, async ({ params }) => getInvite(params.token));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

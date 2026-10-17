import { route } from '@/lib/http';
import { joinByToken, joinView } from '@/lib/services/members';

export const GET = route({ actor: 'none' }, async ({ params }) => joinView(params.token));

export const POST = route({ actor: 'none' }, async ({ params }) => joinByToken(params.token));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

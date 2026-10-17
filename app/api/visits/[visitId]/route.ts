import { visitAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { visitView } from '@/lib/services/views';

export const GET = route({ access: (actor, p, req) => visitAccess(actor, p.visitId, req) }, async ({ access }) => visitView(access.visit));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

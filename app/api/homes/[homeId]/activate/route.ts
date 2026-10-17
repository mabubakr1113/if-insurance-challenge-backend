import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { activateHome } from '@/lib/services/homes';

export const POST = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'C', req) }, async ({ access }) => activateHome(access));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

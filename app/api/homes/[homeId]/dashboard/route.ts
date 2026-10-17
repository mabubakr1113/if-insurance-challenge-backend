import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { dashboard } from '@/lib/services/homes';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => dashboard(access));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

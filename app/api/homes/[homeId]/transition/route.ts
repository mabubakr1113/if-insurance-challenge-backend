import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { transitionBody } from '@/lib/schemas';
import { transitionHome } from '@/lib/services/homes';

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'C', req), body: transitionBody },
  async ({ access, body }) => transitionHome(access, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

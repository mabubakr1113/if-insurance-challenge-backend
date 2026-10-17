import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { activityQuery } from '@/lib/schemas';
import { listActivity } from '@/lib/services/activity';

export const GET = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req), query: activityQuery },
  async ({ access, query }) => listActivity(access.home.id, query.limit),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { createTaskBody, taskFilterQuery } from '@/lib/schemas';
import { createTask, planResponse } from '@/lib/services/tasks';

export const GET = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req), query: taskFilterQuery },
  async ({ access, query }) => planResponse(access.home.id, access.me, query.filter),
);

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'H', req), body: createTaskBody },
  async ({ access, body }) => createTask(access, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

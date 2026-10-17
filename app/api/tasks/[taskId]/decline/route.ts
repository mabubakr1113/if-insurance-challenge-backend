import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { reasonBody } from '@/lib/schemas';
import { declineTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'H', req), body: reasonBody },
  async ({ access, body }) => declineTask(access, access.task, body.reason),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

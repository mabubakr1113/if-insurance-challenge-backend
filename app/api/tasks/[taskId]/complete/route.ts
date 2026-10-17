import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { completeTaskBody } from '@/lib/schemas';
import { completeTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'H', req), body: completeTaskBody },
  async ({ access, body }) => completeTask(access, access.task, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

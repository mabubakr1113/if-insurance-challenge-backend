import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { assignTaskBody } from '@/lib/schemas';
import { assignTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'H', req), body: assignTaskBody },
  async ({ access, body }) => assignTask(access, access.task, body.memberId),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

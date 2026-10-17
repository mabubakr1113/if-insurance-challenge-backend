import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { commentBody } from '@/lib/schemas';
import { commentOnTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'M', req), body: commentBody },
  async ({ access, body }) => commentOnTask(access, access.task, body.body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

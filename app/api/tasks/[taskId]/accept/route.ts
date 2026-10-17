import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { acceptTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'H', req) },
  async ({ access }) => acceptTask(access, access.task),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

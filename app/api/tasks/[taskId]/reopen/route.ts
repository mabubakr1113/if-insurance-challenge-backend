import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { reopenTask } from '@/lib/services/tasks';

export const POST = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'H', req) },
  async ({ access }) => reopenTask(access, access.task),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

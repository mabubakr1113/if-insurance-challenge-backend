import { taskAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { taskPatch } from '@/lib/schemas';
import { patchTask, taskDetail } from '@/lib/services/tasks';

export const GET = route({ access: (actor, p, req) => taskAccess(actor, p.taskId, 'M', req) }, async ({ access }) => taskDetail(access, access.task));

export const PATCH = route(
  { access: (actor, p, req) => taskAccess(actor, p.taskId, 'C', req), body: taskPatch },
  async ({ access, body }) => patchTask(access, access.task, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

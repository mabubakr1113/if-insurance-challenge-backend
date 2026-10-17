import { memberTargetAccess } from '@/lib/auth';
import { forbidden, route } from '@/lib/http';
import { memberPatch } from '@/lib/schemas';
import { patchMember, removeMember } from '@/lib/services/members';

export const PATCH = route(
  { access: (actor, p, req) => memberTargetAccess(actor, p.memberId, req), body: memberPatch },
  async ({ access, body }) => patchMember(access, access.target, body),
);

export const DELETE = route({ access: (actor, p, req) => memberTargetAccess(actor, p.memberId, req) }, async ({ access }) => {
  if (access.me.role !== 'coordinator') throw forbidden('Only a coordinator can remove people');
  await removeMember(access, access.target);
  return { ok: true };
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

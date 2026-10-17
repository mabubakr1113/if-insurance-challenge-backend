import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { inviteMemberBody } from '@/lib/schemas';
import { inviteMember, listMembers } from '@/lib/services/members';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => listMembers(access.home.id));

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'C', req), body: inviteMemberBody },
  async ({ access, body }) => inviteMember(access, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

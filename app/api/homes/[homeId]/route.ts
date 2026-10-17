import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { mapHome } from '@/lib/mappers';
import { homeSetupPatch } from '@/lib/schemas';
import { patchHome } from '@/lib/services/homes';

export const GET = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) },
  async ({ access }) => mapHome(access.home),
);

export const PATCH = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'C', req), body: homeSetupPatch },
  async ({ access, body }) => patchHome(access, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { buildRecord } from '@/lib/services/record';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => buildRecord(access.home));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

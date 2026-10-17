import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { recordVisitBody } from '@/lib/schemas';
import { listVisits, recordVisit } from '@/lib/services/visits';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => listVisits(access.home.id));

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'H', req), body: recordVisitBody },
  async ({ access, body }) =>
    recordVisit(
      access.home,
      { type: 'family', member: access.me },
      {
        visitedAt: new Date(body.visitedAt),
        indoorTempC: body.indoorTempC ?? null,
        checks: body.checks,
        notes: body.notes ?? null,
        photoIds: body.photoIds ?? [],
      },
    ),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

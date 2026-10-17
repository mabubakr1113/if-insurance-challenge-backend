import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { bookingOptionsQuery } from '@/lib/schemas';
import { bookingOptions } from '@/lib/services/bookings';

export const GET = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'H', req), query: bookingOptionsQuery },
  async ({ access, query }) => bookingOptions(access, query.taskId),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

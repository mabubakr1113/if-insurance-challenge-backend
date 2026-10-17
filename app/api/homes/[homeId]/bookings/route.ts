import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { createBookingBody } from '@/lib/schemas';
import { createBooking, listBookings } from '@/lib/services/bookings';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => listBookings(access.home.id));

export const POST = route(
  { access: (actor, p, req) => homeAccess(actor, p.homeId, 'H', req), body: createBookingBody },
  async ({ access, body }) => createBooking(access, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { bookingAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { reasonBody } from '@/lib/schemas';
import { cancelBooking } from '@/lib/services/bookings';

export const POST = route(
  { access: (actor, p, req) => bookingAccess(actor, p.bookingId, 'M', req), body: reasonBody },
  async ({ access, body }) => cancelBooking(access, access.booking, body.reason),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

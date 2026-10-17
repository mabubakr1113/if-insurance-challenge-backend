import { bookingAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { approveBooking } from '@/lib/services/bookings';

export const POST = route(
  { access: (actor, p, req) => bookingAccess(actor, p.bookingId, 'A', req) },
  async ({ access }) => approveBooking(access.home, access.me, access.booking),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

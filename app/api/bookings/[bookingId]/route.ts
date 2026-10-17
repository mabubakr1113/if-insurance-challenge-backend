import { bookingAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { bookingDetail } from '@/lib/services/bookings';

export const GET = route(
  { access: (actor, p, req) => bookingAccess(actor, p.bookingId, 'M', req) },
  async ({ access }) => bookingDetail(access, access.booking),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

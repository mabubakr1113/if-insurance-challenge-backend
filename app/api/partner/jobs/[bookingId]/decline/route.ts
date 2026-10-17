import { partnerJobAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { reasonBody } from '@/lib/schemas';
import { partnerDecline } from '@/lib/services/bookings';

export const POST = route(
  { access: (actor, p, req) => partnerJobAccess(actor, p.bookingId, req), body: reasonBody },
  async ({ access, body }) => partnerDecline(access.partner.partner, access.booking, access.home, body.reason),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

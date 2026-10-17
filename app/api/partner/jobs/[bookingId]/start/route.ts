import { partnerJobAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { partnerStart } from '@/lib/services/bookings';

export const POST = route(
  { access: (actor, p, req) => partnerJobAccess(actor, p.bookingId, req) },
  async ({ access }) => partnerStart(access.partner.partner, access.booking, access.home),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

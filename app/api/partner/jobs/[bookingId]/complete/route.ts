import { partnerJobAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { partnerReportBody } from '@/lib/schemas';
import { partnerComplete } from '@/lib/services/bookings';

export const POST = route(
  { access: (actor, p, req) => partnerJobAccess(actor, p.bookingId, req), body: partnerReportBody },
  async ({ access, body }) => partnerComplete(access.partner.partner, access.booking, access.home, body),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

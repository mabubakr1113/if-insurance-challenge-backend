import { partnerJobAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { jobDetail } from '@/lib/services/bookings';

export const GET = route(
  { access: (actor, p, req) => partnerJobAccess(actor, p.bookingId, req) },
  async ({ access }) => jobDetail(access.booking, access.home),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

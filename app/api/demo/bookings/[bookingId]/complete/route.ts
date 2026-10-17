import { route } from '@/lib/http';
import { demoCompleteBooking } from '@/lib/services/bookings';

export const POST = route({ actor: 'none' }, async ({ params }) => demoCompleteBooking(params.bookingId));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

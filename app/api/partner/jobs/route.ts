import { requirePartner } from '@/lib/auth';
import { route } from '@/lib/http';
import { partnerJobsQuery } from '@/lib/schemas';
import { listJobs } from '@/lib/services/bookings';

export const GET = route({ query: partnerJobsQuery }, async ({ actor, query }) => listJobs(requirePartner(actor), query.status));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

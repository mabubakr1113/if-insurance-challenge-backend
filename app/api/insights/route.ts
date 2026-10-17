import { requireStaff } from '@/lib/auth';
import { route } from '@/lib/http';
import { insights } from '@/lib/services/insights';

export const GET = route({}, async ({ actor }) => {
  requireStaff(actor);
  return insights();
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { Actor } from '@/lib/auth';
import { route } from '@/lib/http';
import { me } from '@/lib/services/me';

export const GET = route({}, async ({ actor }) => me(actor as Actor));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

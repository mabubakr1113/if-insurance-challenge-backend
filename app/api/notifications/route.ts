import type { Actor } from '@/lib/auth';
import { route } from '@/lib/http';
import { listNotifications } from '@/lib/services/notifications';

export const GET = route({}, async ({ actor }) => listNotifications(actor as Actor));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

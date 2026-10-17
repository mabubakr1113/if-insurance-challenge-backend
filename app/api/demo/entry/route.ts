import { route } from '@/lib/http';
import { demoEntry } from '@/lib/services/personas';

export const GET = route({ actor: 'none' }, async () => demoEntry());

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

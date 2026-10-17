import { route } from '@/lib/http';
import { resetAndSeed } from '@/lib/seed';

export const POST = route({ actor: 'none' }, async () => resetAndSeed());

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { route } from '@/lib/http';
import { demoState } from '@/lib/services/personas';

export const GET = route({ actor: 'none' }, async () => demoState());

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

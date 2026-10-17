import { route } from '@/lib/http';
import { personas } from '@/lib/services/personas';

export const GET = route({ actor: 'none' }, async () => personas());

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

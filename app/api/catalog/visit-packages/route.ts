import { PACKAGES } from '@/lib/catalog';
import { route } from '@/lib/http';

export const GET = route({ actor: 'none' }, async () => PACKAGES);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

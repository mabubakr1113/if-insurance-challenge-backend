import { route } from '@/lib/http';

export const GET = route({ actor: 'none' }, async () => ({ ok: true, time: new Date().toISOString(), version: '0.1.0' }));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

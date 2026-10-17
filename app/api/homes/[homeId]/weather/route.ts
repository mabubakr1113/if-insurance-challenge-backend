import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { getWeather } from '@/lib/services/weather';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => getWeather(access.home));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

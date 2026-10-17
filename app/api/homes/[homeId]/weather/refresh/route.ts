import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { refreshWeather } from '@/lib/services/weather';

export const POST = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => refreshWeather(access.home));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

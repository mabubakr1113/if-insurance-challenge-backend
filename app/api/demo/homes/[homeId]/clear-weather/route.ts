import { loadHome } from '@/lib/auth';
import { invalidState, notFound, route } from '@/lib/http';
import { backToRealForecast } from '@/lib/services/weather';

export const POST = route({ actor: 'none' }, async ({ params }) => {
  const home = await loadHome(params.homeId);
  if (!home) throw notFound('Home');
  if (home.status !== 'active') throw invalidState("The care plan isn't active yet");
  return backToRealForecast(home);
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

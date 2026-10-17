import { loadHome } from '@/lib/auth';
import { invalidState, notFound, route } from '@/lib/http';
import { simulateForecast } from '@/lib/services/weather';
import { coldNightForecast } from '@/lib/weather/simulated';
import { today } from '@/lib/time';

export const POST = route({ actor: 'none' }, async ({ params }) => {
  const home = await loadHome(params.homeId);
  if (!home) throw notFound('Home');
  if (home.status !== 'active') throw invalidState("The care plan isn't active yet");
  return simulateForecast(home, coldNightForecast(today()));
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

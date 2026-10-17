import { homeAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { buildRecord } from '@/lib/services/record';
import { today } from '@/lib/time';

export const GET = route({ access: (actor, p, req) => homeAccess(actor, p.homeId, 'M', req) }, async ({ access }) => {
  const record = await buildRecord(access.home);
  const city = access.home.city.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new Response(JSON.stringify(record, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="home-record-${city}-${today()}.json"`,
    },
  });
});

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

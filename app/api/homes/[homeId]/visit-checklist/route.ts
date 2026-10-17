import { homeOrPartnerAccess } from '@/lib/auth';
import { route } from '@/lib/http';
import { checklist } from '@/lib/services/visits';

export const GET = route(
  { access: (actor, p, req) => homeOrPartnerAccess(actor, p.homeId, 'M', req, false) },
  async ({ access }) => checklist(access.home),
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

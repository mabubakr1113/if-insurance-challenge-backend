import type { MeResponse } from '@/lib/contract';
import type { Actor } from '@/lib/auth';
import { mapPartner } from '@/lib/mappers';
import { memberView } from './members';
import { unreadCount } from './notifications';

export async function me(actor: Actor): Promise<MeResponse> {
  const unread = await unreadCount(actor);
  if (actor.kind === 'member') {
    const h = actor.home;
    return {
      kind: 'member',
      member: await memberView(actor.member),
      home: { id: h.id, addressLine: h.address_line, city: h.city, estateName: h.estate_name, status: h.status },
      unread,
    };
  }
  if (actor.kind === 'partner') return { kind: 'partner', partner: mapPartner(actor.partner), unread };
  return { kind: 'staff', label: actor.label, unread };
}

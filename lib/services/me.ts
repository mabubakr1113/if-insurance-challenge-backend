import type { MeResponse } from '@/lib/contract';
import type { Actor } from '@/lib/auth';
import { mapPartner } from '@/lib/mappers';
import { memberView } from './members';
import { unreadCount } from './notifications';

export async function me(actor: Actor): Promise<MeResponse> {
  if (actor.kind === 'member') {
    const [unread, member] = await Promise.all([unreadCount(actor), memberView(actor.member)]);
    const h = actor.home;
    return {
      kind: 'member',
      member,
      home: { id: h.id, addressLine: h.address_line, city: h.city, estateName: h.estate_name, status: h.status },
      unread,
    };
  }
  const unread = await unreadCount(actor);
  if (actor.kind === 'partner') return { kind: 'partner', partner: mapPartner(actor.partner), unread };
  return { kind: 'staff', label: actor.label, unread };
}

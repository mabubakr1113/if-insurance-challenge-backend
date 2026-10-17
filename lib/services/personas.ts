import type { ActorGrant, DemoState, Persona, PersonasResponse } from '@/lib/contract';
import { STAFF_LABEL } from '@/lib/auth';
import { RELATION_LABELS, ROLE_LABELS } from '@/lib/catalog';
import { notFound } from '@/lib/errors';
import { row, rows, type BookingRow, type HomeRow, type MemberRow } from '@/lib/db';
import { sortMembers } from '@/lib/mappers';
import { db } from '@/lib/supabase';
import { thePartner } from './bookings';

export const DEMO_INVITE_URL = '/invite/demo-virtanen';

async function demoHome(group: 'main' | 'example'): Promise<HomeRow> {
  const home = await row<HomeRow>(db().from('homes').select('*').eq('demo_group', group).limit(1).maybeSingle());
  if (!home) throw notFound(`Demo ${group} home (run the seed or reset the demo)`);
  return home;
}

/** Public demo entry: use an existing coordinator without creating an account or resetting shared data. */
export async function demoEntry(): Promise<ActorGrant> {
  const home = await demoHome('example');
  const member = await row<MemberRow>(
    db().from('members').select('*').eq('home_id', home.id).eq('role', 'coordinator').eq('status', 'joined')
      .order('created_at').limit(1).maybeSingle(),
  );
  if (!member) throw notFound('Demo coordinator (run the seed or reset the demo)');
  return { homeId: home.id, memberId: member.id, actor: `member:${member.id}` };
}

async function memberPersonas(home: HomeRow): Promise<Persona[]> {
  const members = await rows<MemberRow>(db().from('members').select('*').eq('home_id', home.id).neq('status', 'removed'));
  const landing = home.status === 'setup' ? `/setup/${home.id}` : `/homes/${home.id}`;
  return sortMembers(members).map((m) => ({
    actor: `member:${m.id}` as const,
    label: m.name,
    subtitle: [ROLE_LABELS[m.role], RELATION_LABELS[m.relation], m.city, m.status === 'invited' ? 'invited, not joined yet' : null]
      .filter(Boolean)
      .join(' · '),
    homeId: home.id,
    landing,
  }));
}

export async function personas(): Promise<PersonasResponse> {
  const [main, example, partner] = await Promise.all([demoHome('main'), demoHome('example'), thePartner()]);
  return {
    groups: [
      {
        title: 'Demo story: the Virtanen home, Kaarina',
        description: 'Start from the invitation, or continue as anyone already in the family.',
        personas: await memberPersonas(main),
      },
      {
        title: 'Example: the Lindqvist home, Turku (five weeks in)',
        description: 'A home with history: visits, notes, a completed partner visit.',
        personas: await memberPersonas(example),
      },
      {
        title: 'Visit partner',
        description: 'Accepts visit requests, follows the checklist and sends the report.',
        personas: [
          { actor: `partner:${partner.id}`, label: partner.name, subtitle: `Fictional partner · ${partner.area}`, homeId: null, landing: '/partner' },
        ],
      },
      {
        title: 'If',
        description: 'Sees adoption, prevention and visit economics across the pilot.',
        personas: [{ actor: 'staff', label: STAFF_LABEL, subtitle: 'Pilot dashboard', homeId: null, landing: '/insights' }],
      },
    ],
    inviteUrl: DEMO_INVITE_URL,
  };
}

export async function demoState(): Promise<DemoState> {
  const [main, example] = await Promise.all([demoHome('main'), demoHome('example')]);
  const latest = await row<BookingRow>(
    db().from('bookings').select('*').eq('home_id', main.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  );
  return {
    mainHomeId: main.id,
    mainHomeStatus: main.status,
    exampleHomeId: example.id,
    latestBooking: latest ? { id: latest.id, homeId: latest.home_id, status: latest.status } : null,
    forecastSource: main.forecast_source ?? 'open-meteo',
  };
}

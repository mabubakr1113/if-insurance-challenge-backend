import type { SourceRef, TaskCategory, TaskPriority } from '../contract';
import type { HomeRow } from '../db';

const TERMS_URL = 'https://www.if.fi/globalassets/fi/pdf/ehdot/kotivakuutusehdot.pdf';

export const terms = (section: string): SourceRef => ({
  label: `If home insurance terms ${section} (check the terms version on your own policy)`,
  url: TERMS_URL,
});

export const ESTATE: SourceRef = {
  label: 'If: estate insurance guidance',
  url: 'https://www.if.fi/henkiloasiakkaat/asiakaspalvelu/usein-kysyttya/kuolinpesan-vakuutukset',
};

export interface TaskTemplate {
  key: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  dueDays: number;
  condition: (home: HomeRow) => boolean;
  recurrenceDays: number | null;
  source: SourceRef | null;
  why: string;
  how: string[];
  needsInfo?: (home: HomeRow) => string | null;
}

const always = () => true;

/** The care plan, in plan order (8.2). */
export const PLAN_TEMPLATES: TaskTemplate[] = [
  {
    key: 'key_access',
    title: 'Agree who holds the keys and how access works',
    category: 'admin',
    priority: 'urgent',
    dueDays: 2,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'Every visit, yours or a partner\'s, depends on knowing who has the keys and who can let someone in.',
    how: [
      'List everyone who has a key.',
      'Decide where a spare key is kept: with a person or in a key box.',
      'Write it in House notes → Access. Never store alarm codes in the app.',
    ],
  },
  {
    key: 'first_walkthrough',
    title: 'First visit: walk through the home',
    category: 'visit',
    priority: 'urgent',
    dueDays: 3,
    condition: always,
    recurrenceDays: null,
    source: terms('§5'),
    why: "Nobody can plan well for a house they haven't seen since it became empty. The first visit finds the valves, the heating settings and any damage.",
    how: [
      'Walk through every room: look for leaks, damp smells or cold rooms.',
      'Find and photograph the water main valve, the water meter and the fuse box.',
      'Note the heating settings and the indoor temperature.',
      'Record the visit in the app.',
    ],
  },
  {
    key: 'water_main_photo',
    title: 'Find and photograph the water main valve',
    category: 'water',
    priority: 'high',
    dueDays: 3,
    condition: always,
    recurrenceDays: null,
    source: terms('§5.5'),
    why: 'In a leak, minutes matter. Everyone, including a visiting partner, needs to know where the valve is.',
    how: [
      'The valve is usually next to the water meter, often in a utility room, basement or under the kitchen sink.',
      'Take a clear photo and add it to House notes → Water.',
      "Say whether it's open or closed now.",
    ],
  },
  {
    key: 'water_main_close',
    title: 'Close the water main and switch off the water pump',
    category: 'water',
    priority: 'urgent',
    dueDays: 3,
    condition: (h) => h.water_main_closed !== 'yes',
    recurrenceDays: null,
    source: terms('§5.5'),
    why: "If's home terms say that when a home is unoccupied for more than a week, the main water valve should be closed and the domestic-water pump switched off.",
    how: [
      'Close the main valve fully.',
      'If the home has its own water pump, switch it off.',
      'Keep the space with the water meter heated.',
      'Record what you did and when.',
    ],
    needsInfo: (h) =>
      h.water_main_closed === 'unknown' ? 'Not known whether the water main is closed. Check it on the first visit.' : null,
  },
  {
    key: 'wood_backup',
    title: 'Arrange basic heat that runs without anyone there',
    category: 'heating',
    priority: 'urgent',
    dueDays: 2,
    condition: (h) => h.heating_type === 'wood',
    recurrenceDays: null,
    source: terms('§5.5'),
    why: 'Wood heating needs someone to keep it going. An empty home needs basic heat that runs on its own, or drained water systems.',
    how: [
      'Ask a heating professional which backup heat is safe for this house.',
      'Until then, agree who visits to keep the house warm.',
      'Record what was decided.',
    ],
  },
  {
    key: 'heating_check',
    title: 'Check the heating is on and the home stays warm',
    category: 'heating',
    priority: 'high',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: terms('§5.5'),
    why: 'A heating failure in winter can freeze pipes within days. Basic heat has to stay on, or the water systems must be drained.',
    how: [
      'Check the thermostat and that radiators or floor heating feel warm.',
      'Write down the indoor temperature.',
      "Check the electricity contract is still active. Heating stops if it's cancelled.",
      'Record the check.',
    ],
    needsInfo: (h) => (h.heating_on === 'unknown' ? 'Not known whether the heating is on. Check it on the first visit.' : null),
  },
  {
    key: 'electricity_contract',
    title: 'Keep the electricity contract active',
    category: 'admin',
    priority: 'high',
    dueDays: 5,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'Heating, pumps and frost protection need power. Cancelling the electricity contract too early can leave the house unheated.',
    how: [
      'Find out which company the electricity contract is with.',
      'Keep it active for the estate instead of cancelling it.',
      'Save the company and contract number in House notes → Contacts.',
    ],
  },
  {
    key: 'tell_if',
    title: "Tell If the home is empty and check the estate's cover",
    category: 'admin',
    priority: 'high',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: ESTATE,
    why: 'Cover for an empty home can depend on supervision and protection instructions. Confirm what applies to this policy.',
    how: [
      "Contact If about the estate's home insurance.",
      'Ask which terms version applies.',
      'Save the policy number in House notes → Contacts.',
    ],
  },
  {
    key: 'well_pump',
    title: 'Protect the well pump and pressure tank from frost',
    category: 'water',
    priority: 'high',
    dueDays: 7,
    condition: (h) => h.water_source === 'well',
    recurrenceDays: null,
    source: terms('§5.5'),
    why: 'A well pump and pressure tank in an unheated space can freeze and break.',
    how: [
      'Check where the pump and pressure tank are and that the space stays above freezing.',
      'Switch the pump off if the water main is closed.',
      'Photograph it for House notes → Water.',
    ],
  },
  {
    key: 'oil_level',
    title: 'Check the heating oil level',
    category: 'heating',
    priority: 'high',
    dueDays: 7,
    condition: (h) => h.heating_type === 'oil',
    recurrenceDays: 30,
    source: null,
    why: 'If the oil runs out, the heating stops.',
    how: ['Read the tank gauge.', 'Order a refill before it gets low.', 'Write the level in the task note.'],
  },
  {
    key: 'heat_pump_check',
    title: 'Check the heat pump is running and its outdoor unit is clear',
    category: 'heating',
    priority: 'normal',
    dueDays: 7,
    condition: (h) => h.heating_type === 'ground_heat_pump' || h.heating_type === 'air_heat_pump',
    recurrenceDays: null,
    source: null,
    why: 'Heat pumps stop or lose efficiency when the outdoor unit is blocked by snow or ice.',
    how: ['Check the indoor unit shows no error.', 'Clear snow away from the outdoor unit.', 'Note the set temperature.'],
  },
  {
    key: 'fuse_box',
    title: 'Find the fuse box and main switch',
    category: 'electricity',
    priority: 'normal',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: "You'll need it in an electrical fault or a leak, and so will any partner who visits.",
    how: ['Find the fuse box and the main switch.', 'Photograph it and add it to House notes → Electricity.'],
  },
  {
    key: 'alarm_contacts',
    title: "Update the alarm system's contact people",
    category: 'security',
    priority: 'normal',
    dueDays: 7,
    condition: (h) => h.has_alarm === 'yes',
    recurrenceDays: null,
    source: null,
    why: 'Alarm calls may still go to someone who can no longer respond.',
    how: ['Contact the alarm provider.', 'Update the contact people.', "Don't store codes in the app."],
  },
  {
    key: 'fridge_freezer',
    title: 'Empty the fridge and freezer, or decide to keep them on',
    category: 'appliances',
    priority: 'normal',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'A power cut or a forgotten fridge can cause smells, pests or water damage.',
    how: ['Empty and clean the fridge, or decide to keep it running.', 'If you switch it off, leave the door open.'],
  },
  {
    key: 'valuables',
    title: 'Secure valuables and important documents',
    category: 'security',
    priority: 'normal',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'An empty home is a target. Documents and valuables are also needed for the estate.',
    how: ['Collect valuables and important papers.', 'Note in the app where they are kept now (not what they are worth).'],
  },
  {
    key: 'mail',
    title: 'Arrange mail forwarding or collection',
    category: 'admin',
    priority: 'normal',
    dueDays: 7,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'A full mailbox shows the house is empty, and bills can be missed.',
    how: ['Arrange mail forwarding, or agree who collects it on visits.'],
  },
  {
    key: 'smoke_alarms',
    title: 'Test the smoke alarms',
    category: 'security',
    priority: 'normal',
    dueDays: 14,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'A working alarm matters even when visitors are only there for short visits.',
    how: ['Press the test button on each alarm.', 'Replace batteries if needed.'],
  },
  {
    key: 'monthly_visit',
    title: 'Monthly supervision visit',
    category: 'visit',
    priority: 'normal',
    dueDays: 30,
    condition: always,
    recurrenceDays: 30,
    source: terms('§5'),
    why: "If's home terms describe supervising an empty building as a visit at least once a month.",
    how: [
      'Walk through the home using the visit checklist.',
      "Record the visit with photos. That's your record of what was checked.",
    ],
  },
  {
    key: 'decide_next',
    title: 'Decide what happens to the home next',
    category: 'admin',
    priority: 'normal',
    dueDays: 60,
    condition: always,
    recurrenceDays: null,
    source: null,
    why: 'Selling, keeping or renting out the home changes the care it needs and the insurance it needs.',
    how: [
      'Agree on a direction with the other heirs.',
      "When it's decided, update the home's status under Settings.",
    ],
  },
];

/** Created only by the weather rules (8.7). */
export const WEATHER_TEMPLATES: Record<'storm_check' | 'roof_snow_check', Omit<TaskTemplate, 'dueDays' | 'condition'>> = {
  storm_check: {
    key: 'storm_check',
    title: 'Check the house after the storm',
    category: 'outside',
    priority: 'high',
    recurrenceDays: null,
    source: null,
    why: 'Fallen trees, loose roofing and power cuts often go unnoticed in an empty home.',
    how: [
      'Look for fallen trees, roof damage and broken windows.',
      'Check the power is on and the heating has restarted.',
      'Check the freezer if there was a power cut.',
    ],
  },
  roof_snow_check: {
    key: 'roof_snow_check',
    title: 'Check the snow load on the roof (from the ground)',
    category: 'outside',
    priority: 'high',
    recurrenceDays: null,
    source: null,
    why: 'Heavy snow can damage a roof, and nobody is there to notice.',
    how: [
      'Look at the roof from the ground. Never climb onto a snowy roof.',
      'If the snow looks heavy, book a professional to clear it.',
    ],
  },
};

export function templateByKey(key: string | null): TaskTemplate | undefined {
  return key ? PLAN_TEMPLATES.find((t) => t.key === key) : undefined;
}

/**
 * Plan order, used as the last tie-breaker when sorting tasks. The schema has no sort_order column,
 * so the order comes from the template list; weather templates and manual tasks sort after it.
 */
export function sortOrder(templateKey: string | null): number {
  if (!templateKey) return 1000;
  const index = PLAN_TEMPLATES.findIndex((t) => t.key === templateKey);
  if (index >= 0) return index;
  return templateKey === 'storm_check' ? 100 : templateKey === 'roof_snow_check' ? 101 : 1000;
}

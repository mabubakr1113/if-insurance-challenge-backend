import type {
  AccessMethod,
  BuildingType,
  CheckItem,
  EssentialKey,
  HeatingType,
  NoteCategory,
  PackageKey,
  Relation,
  Role,
  TaskCategory,
  VisitPackage,
  WaterSource,
  WeatherThresholds,
  YesNoUnknown,
} from './contract';
import type { HomeRow } from './db';

/* ---------------- partner (fictional, seeded) ---------------- */

export const PARTNER = {
  name: 'Talonvahti Demo Oy',
  area: 'Turku region (demo)',
  phone: '+358 40 000 0000',
  email: 'visits@talonvahti.example',
  description: 'Fictional local home-visit partner used in this prototype.',
};

/* ---------------- visit packages (placeholder prices, not quotes) ---------------- */

const CHECK_INCLUDES = [
  'Heating running and indoor temperature',
  'Signs of leaks under sinks, at the water heater and floor drains',
  'Water main in the agreed position',
  'Doors and windows locked',
  'Mail collected',
  'Photos and a written report',
];

export const PACKAGES: VisitPackage[] = [
  {
    key: 'check',
    name: 'Check visit',
    durationMin: 45,
    includes: CHECK_INCLUDES,
    partnerPriceCents: 5900,
    ifFeeCents: 1000,
    totalCents: 6900,
    leadTime: 'Next 3 days',
  },
  {
    key: 'winter',
    name: 'Winter-readiness visit',
    durationMin: 90,
    includes: [
      'Everything in the check visit',
      'Water main and pump set as the family instructs',
      'Outdoor taps checked',
      'Snow on the roof checked from the ground',
    ],
    partnerPriceCents: 9500,
    ifFeeCents: 1500,
    totalCents: 11000,
    leadTime: 'Next 3 days',
  },
  {
    key: 'urgent',
    name: 'Urgent check',
    durationMin: 45,
    includes: ['Everything in the check visit, within 24 hours where available'],
    partnerPriceCents: 9900,
    ifFeeCents: 2000,
    totalCents: 11900,
    leadTime: 'Within 24 hours',
  },
];

export function packageByKey(key: PackageKey): VisitPackage {
  const pkg = PACKAGES.find((p) => p.key === key);
  if (!pkg) throw new Error(`Unknown package ${key}`);
  return pkg;
}

/** Slot hours per package, Helsinki time. */
export const PACKAGE_SLOTS: Record<Exclude<PackageKey, 'urgent'>, [string, string][]> = {
  check: [
    ['09:00', '11:00'],
    ['13:00', '15:00'],
  ],
  winter: [
    ['09:00', '12:00'],
    ['13:00', '16:00'],
  ],
};

export const ACCESS_METHODS: { key: AccessMethod; label: string }[] = [
  { key: 'key_holder_meets', label: 'A family member or the key holder meets the partner' },
  { key: 'key_box', label: 'Key in a key box (code given to the partner)' },
  { key: 'partner_collects_key', label: 'Partner collects the key from someone nearby' },
  { key: 'other', label: 'Other arrangement' },
];

/* ---------------- visit checklist ---------------- */

export interface CheckDefinition extends CheckItem {
  category: TaskCategory;
  appliesTo: (home: HomeRow, date: string) => boolean;
}

const always = () => true;
const isHeatPump = (h: HomeRow) => h.heating_type === 'ground_heat_pump' || h.heating_type === 'air_heat_pump';

/** True from 1 October to 30 April (Helsinki date). */
export function isSnowSeason(date: string): boolean {
  const month = Number(date.slice(5, 7));
  return month >= 10 || month <= 4;
}

export const CHECK_ITEMS: CheckDefinition[] = [
  { key: 'heating', label: 'Heating is running', help: 'Radiators or floor heating feel warm; the thermostat is set as agreed', category: 'heating', appliesTo: always },
  { key: 'leaks', label: 'No signs of water leaks', help: 'Look under sinks, around the water heater, toilets and floor drains', category: 'water', appliesTo: always },
  { key: 'water_main', label: 'Water main in the agreed position', help: 'Open or closed as the family has decided', category: 'water', appliesTo: always },
  { key: 'water_pump', label: 'Water pump in the agreed state', help: 'Well pump and pressure tank space above freezing', category: 'water', appliesTo: (h) => h.water_source === 'well' },
  { key: 'damp_smell', label: 'No damp or musty smell', help: 'Check the basement, bathrooms and closets', category: 'other', appliesTo: always },
  { key: 'electricity', label: 'Electricity on, no tripped fuses', help: 'Lights work; the fuse box shows no tripped fuses', category: 'electricity', appliesTo: always },
  { key: 'windows_doors', label: 'Windows and doors closed and locked', help: 'Including the basement and outbuildings', category: 'security', appliesTo: always },
  { key: 'fridge_freezer', label: 'Fridge and freezer as agreed', help: 'Empty with doors open, or running normally', category: 'appliances', appliesTo: always },
  { key: 'mail', label: 'Mail and flyers collected', help: 'Bring important letters to the coordinator', category: 'admin', appliesTo: always },
  { key: 'heat_pump_unit', label: 'Heat pump outdoor unit clear', help: 'No snow or ice blocking it; no error on the indoor unit', category: 'heating', appliesTo: isHeatPump },
  { key: 'oil_level', label: 'Heating oil level noted', help: 'Write the level in the note', category: 'heating', appliesTo: (h) => h.heating_type === 'oil' },
  { key: 'outside', label: 'Outside looks fine', help: 'Roof, gutters, yard; no storm damage or fallen trees', category: 'outside', appliesTo: always },
  { key: 'roof_snow', label: 'Snow on the roof looks manageable', help: 'Seen from the ground only', category: 'outside', appliesTo: (_h, date) => isSnowSeason(date) },
];

export function checkByKey(key: string): CheckDefinition | undefined {
  return CHECK_ITEMS.find((c) => c.key === key);
}

/** The checklist for a home on a given Helsinki date, without the internal fields. */
export function checklistFor(home: HomeRow, date: string): CheckItem[] {
  return CHECK_ITEMS.filter((c) => c.appliesTo(home, date)).map(({ key, label, help }) => ({ key, label, help }));
}

/** Check result `ok` on these items completes the matching open task (8.5). */
export const CHECK_COMPLETES: Record<string, string> = {
  heating: 'heating_check',
  heat_pump_unit: 'heat_pump_check',
  oil_level: 'oil_level',
  roof_snow: 'roof_snow_check',
  outside: 'storm_check',
};

/* ---------------- house essentials ---------------- */

export interface EssentialDefinition {
  key: EssentialKey;
  label: string;
  category: NoteCategory;
  why: string;
  appliesTo: (home: HomeRow) => boolean;
  needsPhoto: boolean;
  completesTask: string | null;
}

export const ESSENTIALS: EssentialDefinition[] = [
  { key: 'water_main_valve', label: 'Water main valve', category: 'water', why: 'Needed within minutes if a pipe leaks', appliesTo: always, needsPhoto: true, completesTask: 'water_main_photo' },
  { key: 'water_meter', label: 'Water meter', category: 'water', why: 'Its space must stay heated, and the valve is usually next to it', appliesTo: always, needsPhoto: true, completesTask: null },
  { key: 'fuse_box', label: 'Fuse box and main switch', category: 'electricity', why: 'Needed in a fault, a leak or a storm', appliesTo: always, needsPhoto: true, completesTask: 'fuse_box' },
  { key: 'heating_controls', label: 'Heating controls', category: 'heating', why: 'Lets anyone check the heating is set right', appliesTo: always, needsPhoto: true, completesTask: null },
  { key: 'key_location', label: 'Where the keys are', category: 'access', why: 'Every visit depends on it', appliesTo: always, needsPhoto: false, completesTask: 'key_access' },
  { key: 'neighbour_contact', label: 'A neighbour who can help', category: 'contacts', why: 'Someone nearby can spot problems first', appliesTo: always, needsPhoto: false, completesTask: null },
  { key: 'well_pump', label: 'Well pump and pressure tank', category: 'water', why: 'Can freeze in an unheated space', appliesTo: (h) => h.water_source === 'well', needsPhoto: true, completesTask: null },
];

export function essentialByKey(key: EssentialKey): EssentialDefinition {
  const def = ESSENTIALS.find((e) => e.key === key);
  if (!def) throw new Error(`Unknown essential ${key}`);
  return def;
}

/* ---------------- weather ---------------- */

export const THRESHOLDS: WeatherThresholds = { hardFrostC: -15, frostC: -5, stormGustMs: 20, heavySnowCm: 20 };

/* ---------------- labels used in activity and notification text ---------------- */

export const ROLE_LABELS: Record<Role, string> = { coordinator: 'Coordinator', helper: 'Helper', viewer: 'Viewer' };

export const RELATION_LABELS: Record<Relation, string> = {
  child: 'Child',
  spouse: 'Spouse',
  sibling: 'Sibling',
  grandchild: 'Grandchild',
  relative: 'Relative',
  friend: 'Friend',
  other: 'Other',
};

export const HEATING_LABELS: Record<HeatingType, string> = {
  district: 'District heating',
  electric: 'Electric heating',
  oil: 'Oil heating',
  ground_heat_pump: 'Ground-source heat pump',
  air_heat_pump: 'Air heat pump',
  wood: 'Wood heating',
  unknown: 'Not sure',
};

export const BUILDING_LABELS: Record<BuildingType, string> = {
  detached: 'Detached house',
  semi_detached: 'Semi-detached',
  terraced: 'Terraced house',
  cottage: 'Cottage',
  other: 'Other',
};

export const WATER_LABELS: Record<WaterSource, string> = { municipal: 'Municipal water', well: 'Own well', unknown: 'Not sure' };

export const YES_NO_LABELS: Record<YesNoUnknown, string> = { yes: 'Yes', no: 'No', unknown: 'Not sure' };

export const PACKAGE_NOUNS: Record<PackageKey, string> = { check: 'a check visit', winter: 'a winter-readiness visit', urgent: 'an urgent check' };

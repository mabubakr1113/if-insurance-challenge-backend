import type {
  AccessMethod,
  BookingStatus,
  BuildingType,
  CheckResult,
  EssentialKey,
  ForecastDay,
  ForecastSource,
  HeatingType,
  HomeStatus,
  MemberStatus,
  NoteCategory,
  NotificationChannel,
  PackageKey,
  Relation,
  Role,
  TaskCategory,
  TaskOrigin,
  TaskPriority,
  TaskStatus,
  VisitorType,
  WaterSource,
  WeatherRule,
  YesNoUnknown,
} from './contract';

/* ---------------- query helpers ---------------- */

type Result = { data: unknown; error: { message: string } | null };

/** Awaits a query that returns many rows. Throws on a database error. */
export async function rows<T>(query: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);
  return (data ?? []) as T[];
}

/** Awaits a `.maybeSingle()` query. Returns null when nothing matched. */
export async function row<T>(query: PromiseLike<Result>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);
  return (data ?? null) as T | null;
}

/** Awaits a query that must return exactly one row (`.single()`). */
export async function one<T>(query: PromiseLike<Result>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);
  if (data == null) throw new Error('Database error: expected a row');
  return data as T;
}

/** Awaits a write that returns nothing useful. */
export async function exec(query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);
}

/* ---------------- row types (snake_case, as stored) ---------------- */

export interface PartnerRow {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  email: string | null;
  description: string | null;
  created_at: string;
}

export interface HomeRow {
  id: string;
  demo_group: 'main' | 'example' | 'background';
  invite_token: string | null;
  status: HomeStatus;
  address_line: string;
  postal_code: string;
  city: string;
  lat: number;
  lng: number;
  estate_name: string | null;
  building_type: BuildingType | null;
  year_built: number | null;
  vacant_since: string | null;
  last_known_visit: string | null;
  occupancy_confirmed: boolean;
  authority_confirmed: boolean;
  key_holder: string | null;
  access_notes: string | null;
  heating_type: HeatingType | null;
  heating_on: YesNoUnknown | null;
  water_source: WaterSource | null;
  water_main_closed: YesNoUnknown | null;
  has_alarm: YesNoUnknown | null;
  forecast: ForecastDay[] | null;
  forecast_source: ForecastSource | null;
  forecast_fetched_at: string | null;
  invited_at: string;
  setup_started_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  new_owner_wants_cover_help: boolean | null;
  created_at: string;
}

export interface MemberRow {
  id: string;
  home_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  relation: Relation;
  role: Role;
  can_authorise: boolean;
  status: MemberStatus;
  join_token: string;
  invited_by: string | null;
  joined_at: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  home_id: string;
  template_key: string | null;
  title: string;
  why: string | null;
  how: string[];
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  assignee_id: string | null;
  due_at: string | null;
  recurrence_days: number | null;
  origin: TaskOrigin;
  source_label: string | null;
  source_url: string | null;
  needs_info: string | null;
  declined_by: string[];
  booking_id: string | null;
  source_visit_id: string | null;
  created_by_label: string;
  accepted_at: string | null;
  completed_at: string | null;
  completed_by_label: string | null;
  completion_note: string | null;
  completed_by_visit_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingRow {
  id: string;
  home_id: string;
  partner_id: string;
  task_id: string | null;
  package_key: PackageKey;
  status: BookingStatus;
  slot_start: string;
  slot_end: string;
  access_method: AccessMethod;
  access_details: string | null;
  notes: string | null;
  partner_price_cents: number;
  if_fee_cents: number;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  confirmed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface StoredCheck {
  key: string;
  label: string;
  result: CheckResult;
  note: string | null;
}

export interface VisitRow {
  id: string;
  home_id: string;
  booking_id: string | null;
  visitor_type: VisitorType;
  member_id: string | null;
  partner_id: string | null;
  visitor_name: string;
  visited_at: string;
  indoor_temp_c: number | null;
  checks: StoredCheck[];
  notes: string | null;
  created_at: string;
}

export interface NoteRow {
  id: string;
  home_id: string;
  category: NoteCategory;
  title: string;
  body: string;
  essential_key: EssentialKey | null;
  confirmed: boolean;
  updated_by_label: string;
  created_at: string;
  updated_at: string;
}

export interface PhotoRow {
  id: string;
  home_id: string;
  storage_path: string;
  caption: string | null;
  visit_id: string | null;
  note_id: string | null;
  task_id: string | null;
  uploaded_by_label: string;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  home_id: string;
  type: string;
  actor_label: string;
  actor_member_id: string | null;
  message: string;
  task_id: string | null;
  visit_id: string | null;
  booking_id: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  home_id: string | null;
  member_id: string | null;
  partner_id: string | null;
  channel: NotificationChannel;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface WeatherAlertRow {
  id: string;
  home_id: string;
  rule: WeatherRule;
  for_date: string;
  message: string;
  min_temp_c: number | null;
  gust_ms: number | null;
  snow_cm: number | null;
  task_id: string | null;
  source: ForecastSource;
  created_at: string;
}

/* ---------------- misc ---------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export const CLOSED_STATUSES: HomeStatus[] = ['occupied', 'sold', 'transferred', 'closed', 'declined'];
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending_approval', 'requested', 'confirmed', 'in_progress'];

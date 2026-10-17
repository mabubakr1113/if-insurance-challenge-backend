import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * In-memory stand-in for the Supabase client, used when Supabase isn't configured (demo and hackathon deploys).
 * It implements only the query-builder and storage calls this app makes. Data lives in the server process and is
 * seeded on the first request (lib/seed), so a restart or a fresh serverless instance starts the demo over.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

const now = () => new Date().toISOString();

/** Columns per table with the non-null defaults from 0001_init.sql. Every other column defaults to null. */
const TABLES: Record<string, { columns: string[]; defaults: Record<string, () => unknown> }> = {};
const COMMON_DEFAULTS: Record<string, () => unknown> = { id: () => randomUUID(), created_at: now, updated_at: now };

function defineTable(name: string, columns: string, defaults: Record<string, () => unknown> = {}) {
  TABLES[name] = { columns: columns.split(/\s+/).filter(Boolean), defaults };
}

defineTable('partners', 'id name area phone email description created_at');
defineTable(
  'homes',
  `id demo_group invite_token status address_line postal_code city lat lng estate_name building_type year_built
   vacant_since last_known_visit occupancy_confirmed authority_confirmed key_holder access_notes heating_type heating_on
   water_source water_main_closed has_alarm forecast forecast_source forecast_fetched_at invited_at setup_started_at
   activated_at closed_at close_reason new_owner_wants_cover_help created_at`,
  {
    demo_group: () => 'background',
    status: () => 'invited',
    occupancy_confirmed: () => false,
    authority_confirmed: () => false,
    invited_at: now,
  },
);
defineTable('members', 'id home_id name email phone city relation role can_authorise status join_token invited_by joined_at created_at', {
  can_authorise: () => false,
  status: () => 'invited',
  join_token: () => randomBytes(12).toString('hex'),
});
defineTable(
  'tasks',
  `id home_id template_key title why how category priority status assignee_id due_at recurrence_days origin source_label
   source_url needs_info declined_by booking_id source_visit_id created_by_label accepted_at completed_at
   completed_by_label completion_note completed_by_visit_id created_at updated_at`,
  {
    how: () => [],
    priority: () => 'normal',
    status: () => 'open',
    origin: () => 'plan',
    declined_by: () => [],
    created_by_label: () => 'Home Watch',
  },
);
defineTable(
  'bookings',
  `id home_id partner_id task_id package_key status slot_start slot_end access_method access_details notes
   partner_price_cents if_fee_cents requested_by approved_by approved_at confirmed_at started_at completed_at
   cancelled_at cancel_reason created_at`,
);
defineTable(
  'visits',
  'id home_id booking_id visitor_type member_id partner_id visitor_name visited_at indoor_temp_c checks notes created_at',
  { checks: () => [] },
);
defineTable('house_notes', 'id home_id category title body essential_key confirmed updated_by_label created_at updated_at', {
  body: () => '',
  confirmed: () => false,
});
defineTable('photos', 'id home_id storage_path caption visit_id note_id task_id uploaded_by_label created_at');
defineTable('activity', 'id home_id type actor_label actor_member_id message task_id visit_id booking_id created_at');
defineTable('notifications', 'id home_id member_id partner_id channel title body link read_at created_at', {
  channel: () => 'in_app',
});
defineTable(
  'weather_alerts',
  'id home_id rule for_date message min_temp_c gust_ms snow_cm task_id source created_at',
);

/** [child table, column, parent table, on delete] */
const FOREIGN_KEYS: [string, string, string, 'cascade' | 'set null'][] = [
  ['members', 'home_id', 'homes', 'cascade'],
  ['members', 'invited_by', 'members', 'set null'],
  ['tasks', 'home_id', 'homes', 'cascade'],
  ['tasks', 'assignee_id', 'members', 'set null'],
  ['tasks', 'booking_id', 'bookings', 'set null'],
  ['tasks', 'source_visit_id', 'visits', 'set null'],
  ['tasks', 'completed_by_visit_id', 'visits', 'set null'],
  ['bookings', 'home_id', 'homes', 'cascade'],
  ['bookings', 'partner_id', 'partners', 'cascade'],
  ['bookings', 'task_id', 'tasks', 'set null'],
  ['bookings', 'requested_by', 'members', 'set null'],
  ['bookings', 'approved_by', 'members', 'set null'],
  ['visits', 'home_id', 'homes', 'cascade'],
  ['visits', 'booking_id', 'bookings', 'set null'],
  ['visits', 'member_id', 'members', 'set null'],
  ['visits', 'partner_id', 'partners', 'set null'],
  ['house_notes', 'home_id', 'homes', 'cascade'],
  ['photos', 'home_id', 'homes', 'cascade'],
  ['photos', 'visit_id', 'visits', 'set null'],
  ['photos', 'note_id', 'house_notes', 'set null'],
  ['photos', 'task_id', 'tasks', 'set null'],
  ['activity', 'home_id', 'homes', 'cascade'],
  ['activity', 'actor_member_id', 'members', 'set null'],
  ['activity', 'task_id', 'tasks', 'set null'],
  ['activity', 'visit_id', 'visits', 'set null'],
  ['activity', 'booking_id', 'bookings', 'set null'],
  ['notifications', 'home_id', 'homes', 'cascade'],
  ['notifications', 'member_id', 'members', 'cascade'],
  ['notifications', 'partner_id', 'partners', 'cascade'],
  ['weather_alerts', 'home_id', 'homes', 'cascade'],
  ['weather_alerts', 'task_id', 'tasks', 'set null'],
];

/* numeric(4,1) and numeric(5,1) columns */
const ONE_DECIMAL = new Set(['indoor_temp_c', 'min_temp_c', 'gust_ms', 'snow_cm']);

/* ---------------- the store (on globalThis, so every route bundle and dev reload shares it) ---------------- */

export interface MemoryStore {
  tables: Map<string, Row[]>;
  files: Map<string, { body: Buffer; contentType: string }>;
  /** Set while (or after) the demo is seeded for this process. */
  ready: Promise<void> | null;
}

const g = globalThis as typeof globalThis & { __homeWatchStore?: MemoryStore };
export const store: MemoryStore = (g.__homeWatchStore ??= { tables: new Map(), files: new Map(), ready: null });

function table(name: string): Row[] {
  if (!TABLES[name]) throw new Error(`relation "${name}" does not exist`);
  let rows = store.tables.get(name);
  if (!rows) store.tables.set(name, (rows = []));
  return rows;
}

function checkColumns(name: string, values: Row): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && !TABLES[name].columns.includes(key)) throw new Error(`column "${key}" of relation "${name}" does not exist`);
  }
}

/**
 * Mirrors what Postgres hands back: timestamps as ISO strings in UTC, numerics rounded to their scale.
 * Undefined values are dropped, as they are when supabase-js serialises a body to JSON.
 */
function normalize(values: Row): Row {
  const out = structuredClone(values);
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined) {
      delete out[key];
    } else if (typeof value === 'string' && (key.endsWith('_at') || key === 'slot_start' || key === 'slot_end')) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) out[key] = date.toISOString();
    } else if (typeof value === 'number' && ONE_DECIMAL.has(key)) {
      out[key] = Math.round(value * 10) / 10;
    }
  }
  return out;
}

function create(name: string, values: Row): Row {
  checkColumns(name, values);
  const { columns, defaults } = TABLES[name];
  const row: Row = {};
  for (const column of columns) {
    const make = defaults[column] ?? COMMON_DEFAULTS[column];
    row[column] = values[column] !== undefined ? values[column] : make ? make() : null;
  }
  return normalize(row);
}

function remove(name: string, victims: Row[]): void {
  if (victims.length === 0) return;
  const ids = new Set(victims.map((r) => r.id));
  store.tables.set(
    name,
    table(name).filter((r) => !ids.has(r.id)),
  );
  for (const [child, column, parent, action] of FOREIGN_KEYS) {
    if (parent !== name) continue;
    const refs = table(child).filter((r) => ids.has(r[column]));
    if (action === 'cascade') remove(child, refs);
    else for (const r of refs) r[column] = null;
  }
}

/* ---------------- query builder ---------------- */

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<Result> {
  private action: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private values: Row[] = [];
  private patch: Row = {};
  private conflict = ['id'];
  private ignoreDuplicates = false;
  private filters: Filter[] = [];
  private sorts: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private window: { from: number; to: number } | null = null;
  /** Columns to return; null means a write without `.select()`, which returns no rows. */
  private returning: string[] | '*' | null = null;
  private head = false;
  private expect: 'many' | 'single' | 'maybe' = 'many';

  constructor(private readonly name: string) {}

  select(columns = '*', opts: { count?: 'exact'; head?: boolean } = {}) {
    this.returning = columns.trim() === '*' ? '*' : columns.split(',').map((c) => c.trim());
    this.head = Boolean(opts.head);
    return this;
  }

  insert(values: Row | Row[]) {
    this.action = 'insert';
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.action = 'upsert';
    this.values = Array.isArray(values) ? values : [values];
    this.conflict = (opts.onConflict ?? 'id').split(',').map((c) => c.trim());
    this.ignoreDuplicates = Boolean(opts.ignoreDuplicates);
    return this;
  }

  update(patch: Row) {
    this.action = 'update';
    this.patch = patch;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  // SQL semantics: comparisons with NULL never match; use `.is()` for that.
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== null && r[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== null && r[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((r) => r[column] !== null && values.includes(r[column]));
    return this;
  }

  is(column: string, value: null | boolean) {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is' && operator !== 'eq') throw new Error(`not.${operator} is not supported by the memory store`);
    this.filters.push((r) => (operator === 'is' ? r[column] !== value : r[column] !== null && r[column] !== value));
    return this;
  }

  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const ascending = opts.ascending ?? true;
    this.sorts.push({ column, ascending, nullsFirst: opts.nullsFirst ?? !ascending });
    return this;
  }

  limit(count: number) {
    this.window = { from: 0, to: count - 1 };
    return this;
  }

  range(from: number, to: number) {
    this.window = { from, to };
    return this;
  }

  single() {
    this.expect = 'single';
    return this;
  }

  maybeSingle() {
    this.expect = 'maybe';
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private run(): Result {
    try {
      return this.execute();
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => f(row));
  }

  private execute(): Result {
    const rows = table(this.name);
    let affected: Row[] = [];

    if (this.action === 'select') {
      affected = rows.filter((r) => this.matches(r));
    } else if (this.action === 'insert') {
      affected = this.values.map((v) => create(this.name, v));
      rows.push(...affected);
    } else if (this.action === 'upsert') {
      for (const v of this.values) {
        const existing = rows.find((r) => this.conflict.every((c) => r[c] === v[c]));
        if (!existing) {
          const created = create(this.name, v);
          rows.push(created);
          affected.push(created);
        } else if (!this.ignoreDuplicates) {
          checkColumns(this.name, v);
          Object.assign(existing, normalize(v));
          affected.push(existing);
        }
      }
    } else if (this.action === 'update') {
      checkColumns(this.name, this.patch);
      const patch = normalize(this.patch);
      affected = rows.filter((r) => this.matches(r));
      for (const r of affected) Object.assign(r, structuredClone(patch));
    } else {
      affected = rows.filter((r) => this.matches(r));
      remove(this.name, affected);
    }

    const count = affected.length;
    if (this.head) return { data: null, error: null, count };
    if (this.returning === null) return { data: null, error: null, count: null };

    let list = this.sorted(affected);
    if (this.window) list = list.slice(this.window.from, this.window.to + 1);
    const columns = this.returning;
    const data = list.map((r) => {
      const copy = structuredClone(r);
      return columns === '*' ? copy : Object.fromEntries(columns.map((c) => [c, copy[c] ?? null]));
    });

    if (this.expect === 'many') return { data, error: null, count: null };
    if (data.length > 1 || (this.expect === 'single' && data.length === 0)) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: data[0] ?? null, error: null, count: null };
  }

  private sorted(list: Row[]): Row[] {
    if (this.sorts.length === 0) return list;
    return list
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        for (const s of this.sorts) {
          const x = a.row[s.column] as string | number | null;
          const y = b.row[s.column] as string | number | null;
          if (x === y) continue;
          if (x === null) return s.nullsFirst ? -1 : 1;
          if (y === null) return s.nullsFirst ? 1 : -1;
          return (x < y ? -1 : 1) * (s.ascending ? 1 : -1);
        }
        // Ties keep insertion order, newest first when sorting descending.
        return this.sorts[0].ascending ? a.i - b.i : b.i - a.i;
      })
      .map((e) => e.row);
  }
}

/* ---------------- storage ---------------- */

/** The URL the browser can reach this server on: the incoming request's host, or PUBLIC_URL outside a request. */
async function publicBaseUrl(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const host = (h.get('x-forwarded-host') ?? h.get('host'))?.split(',')[0].trim();
    if (host) return `${h.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'http'}://${host}`;
  } catch {
    // not inside a request (scripts)
  }
  return (process.env.PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

const storage = {
  from: () => ({
    async upload(path: string, body: Buffer, opts: { contentType?: string } = {}) {
      store.files.set(path, { body: Buffer.from(body), contentType: opts.contentType ?? 'application/octet-stream' });
      return { data: { path }, error: null };
    },
    async remove(paths: string[]) {
      for (const path of paths) store.files.delete(path);
      return { data: [], error: null };
    },
    /** Served by app/api/files. Paths are random UUIDs, which is as private as this demo needs. */
    async createSignedUrls(paths: string[]) {
      const base = await publicBaseUrl();
      return { data: paths.map((path) => ({ path, signedUrl: `${base}/api/files/${path}`, error: null })), error: null };
    },
  }),
};

export function memoryClient(): SupabaseClient {
  return { from: (name: string) => new Query(name), storage } as unknown as SupabaseClient;
}

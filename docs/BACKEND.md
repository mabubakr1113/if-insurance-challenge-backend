# If Home Watch — Backend spec

The backend for the If Home Watch prototype: a Next.js API on Vercel, with Supabase (Postgres and Storage) behind it. It owns the data, the care-plan rules, weather alerts, the booking flow, the demo data and the pilot metrics. The frontend (`if-insurance-challenge-frontend`) is a separate Next.js app that calls this API from its server only.

Product context: see `VENTURE_BRIEF.md`. The page-by-page UI is in `FRONTEND.md`.

---

## ▶ Claude Code prompt — paste this as one command

> Run Claude Code inside the `if-insurance-challenge-backend` repo, with this file saved as `docs/BACKEND.md`.

```text
You are in the if-insurance-challenge-backend repo. Read docs/BACKEND.md from top to bottom, then build everything it specifies end to end in this session. Don't ask me questions. Where the doc is silent, choose the simplest option consistent with it and list that choice in your final summary.

Do it in this order:
1. Create and switch to the branch feat/backend-mvp (never commit to main). Commit in small logical steps of about 3–4 files, with clear messages.
2. Scaffold a Next.js App Router + TypeScript + ESLint app in this folder (section 3). If create-next-app refuses because the folder isn't empty, scaffold into a temporary folder and move the files in, keeping README.md and docs/ and merging .gitignore.
3. Install the dependencies and add the npm scripts from section 3. Configure the dev server on port 3001.
4. Create .env.example and .env.local (section 4). Generate a random API_KEY. If .env.local has no real Supabase values, finish all the code anyway, then stop before step 7 and tell me exactly which values to paste and where to find them.
5. Add the SQL migration exactly as written in section 5 and the migrate script, then run npm run db:migrate.
6. Implement sections 6–13: copy section 7.2 byte for byte into lib/contract.ts, then build the auth wrapper, every endpoint in 7.4, every business rule in 8, the catalog in 9, the seed and demo reset in 10, the demo simulations in 11, the insights in 12 and the error handling in 13.
7. Run npm run db:seed, start the dev server, and run npm run smoke (section 14). Fix things until every smoke step passes. npm run lint and npx tsc --noEmit must finish with zero errors.
8. Deploy (section 15): if `vercel whoami` succeeds, link the project, add the env vars, deploy to production and check /api/health on the production URL. Otherwise print the exact manual steps.
9. Finish with a short summary: what was built, the local and production base URLs, where API_KEY is (the frontend needs the same value), how to reset the demo, and every decision you made that the doc didn't specify.
```

---

## 1. What you're building

- A JSON REST API under `/api/*` (section 7) that the frontend calls server-to-server with a shared API key.
- A Postgres schema in Supabase (section 5), plus a private Storage bucket for photos.
- Business logic: care-plan generation from the home's setup, task responsibility, visit records, house notes, weather alerts from a real forecast, local-visit booking with approval, notifications, the activity log and the home record.
- Demo tooling: a deterministic seed, a one-call reset, simulated weather and a simulated partner, so the 3-minute pitch demo works every time.
- Pilot metrics for If's dashboard (section 12).

**The demo story the backend must support** (from the venture brief):

1. Aino opens the invitation `/invite/demo-virtanen` and accepts → she becomes the coordinator of the Virtanen home in Kaarina.
2. She answers the setup questions and activates the home → the care plan is generated.
3. She invites her brother Mikko and assigns him the first visit.
4. As Mikko: he adds the water-main-valve photo and note (this closes the "photograph the valve" task) and records a visit.
5. Simulated cold night (−18 °C) → the heating check is escalated to urgent; nobody has accepted it → the coordinator is told.
6. Aino requests and approves a check visit with the fictional partner.
7. Simulated partner visit → a visit report with photos, indoor temperature 17 °C and one concern (snow on the roof) that becomes a follow-up task.
8. The family sees the updated plan and exports the home record.
9. The If pilot team sees the insights dashboard.

---

## 2. Stack and ground rules

| Thing | Choice |
| --- | --- |
| Framework | Next.js (latest stable), App Router, TypeScript strict, route handlers only (no pages) |
| Database | Supabase Postgres, accessed with `@supabase/supabase-js` using the **secret key**, server-side only |
| Files | Supabase Storage, private bucket `home-photos`, signed URLs (60 min) |
| Validation | `zod` on every request body and query |
| Dates | `date-fns` + `@date-fns/tz` (`TZDate`), app timezone `Europe/Helsinki` |
| Weather | Open-Meteo forecast API (free, no key) |
| Hosting | Vercel |
| Package manager | npm |

**Keep it simple:**

- No Supabase Auth, no ORM, no queues, no cron, no websockets, no Docker.
- One shared API key between frontend and backend. A demo "actor" header says who is acting (section 6).
- All tables have RLS enabled with **no policies**, so only the secret key (which bypasses RLS) can touch data. The browser never talks to Supabase or to this API.
- Everything shown to users is English. All people, partners and addresses are **fictional**. Never use real company names for the partner.
- Every route handler exports `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`. Follow the installed Next.js version's conventions (in Next.js 15+, route `params` is a Promise and must be awaited).

---

## 3. Project setup

```bash
npx create-next-app@latest . --ts --eslint --app --no-tailwind --no-src-dir --import-alias "@/*" --use-npm
npm i @supabase/supabase-js zod date-fns @date-fns/tz
npm i -D tsx dotenv postgres
```

`package.json` scripts:

```json
{
  "dev": "next dev -p 3001",
  "build": "next build",
  "start": "next start -p 3001",
  "lint": "next lint",
  "db:migrate": "tsx scripts/migrate.ts",
  "db:seed": "tsx scripts/seed.ts",
  "smoke": "tsx scripts/smoke.ts"
}
```

(If the installed Next.js has no `next lint`, use `eslint .`.)

Folder layout:

```text
app/
  page.tsx                          # tiny HTML status page: "If Home Watch API", link to /api/health
  api/...                           # one route.ts per endpoint in section 7.4 (folders mirror the paths)
lib/
  contract.ts                       # section 7.2, byte-identical to the frontend's copy
  env.ts                            # reads and validates env vars (zod)
  supabase.ts                       # admin client (secret key, persistSession: false); import 'server-only'
  http.ts                           # handler wrapper: API key, actor, zod, JSON, errors (section 6, 13)
  auth.ts                           # actor resolution + permission helpers (M/H/C/A/P/S)
  mappers.ts                        # DB rows → contract types (camelCase, computed fields, signed URLs)
  time.ts                           # Helsinki helpers: today(), atHelsinki(date, 'HH:mm'), addDays, formatting
  catalog.ts                        # section 9: packages, checklist, essentials, thresholds, partner, labels
  plan/templates.ts                 # section 8.2 templates
  plan/generate.ts                  # builds tasks from a Home
  weather/openMeteo.ts              # fetch + map forecast
  weather/simulated.ts              # cold night / storm forecasts
  weather/rules.ts                  # section 8.7
  services/                         # homes, members, tasks, visits, notes, photos, bookings,
                                    # notifications, activity, record, insights, personas
  seed/index.ts                     # resetAndSeed(): used by scripts/seed.ts and POST /api/demo/reset
  seed/data.ts                      # story homes, names, background generator (section 10)
  seed/placeholders.ts              # SVG "sample photo" generator
scripts/
  migrate.ts                        # applies supabase/migrations/*.sql in order (section 5)
  seed.ts                           # loads .env.local, calls resetAndSeed()
  smoke.ts                          # section 14
supabase/migrations/0001_init.sql   # section 5
vercel.json                         # section 15
```

---

## 4. Environment variables

`.env.example` (committed) and `.env.local` (git-ignored):

```bash
# Supabase → Project Settings → API
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=            # the secret key (sb_secret_...) or the legacy service_role key. Server only.
# Supabase → Connect → "Session pooler" connection string (works on IPv4). Used only by db:migrate.
SUPABASE_DB_URL=postgresql://postgres.YOUR-REF:PASSWORD@aws-0-eu-north-1.pooler.supabase.com:5432/postgres
# Shared secret: the frontend sends it as "Authorization: Bearer <API_KEY>". Generate 32+ random chars.
API_KEY=
# Optional
APP_TIMEZONE=Europe/Helsinki
```

`scripts/*.ts` load `.env.local` with `dotenv` (`config({ path: '.env.local' })`). `lib/env.ts` throws a clear error naming any missing variable.

**What a person does once (about 5 minutes):** create a free Supabase project (region North EU / Stockholm), copy the URL, the secret key and the Session pooler connection string into `.env.local`. Nothing else is needed in the Supabase dashboard: the migration creates the tables and the bucket.

---

## 5. Database

`scripts/migrate.ts`: connect with `postgres(SUPABASE_DB_URL, { ssl: 'require', max: 1 })` and create `_migrations(name text primary key, applied_at timestamptz default now())` if it doesn't exist. Apply every `supabase/migrations/*.sql` file not yet recorded, in filename order, each inside a transaction (`sql.begin(tx => tx.unsafe(fileText))`), then record it. Print what was applied.

`supabase/migrations/0001_init.sql`:

```sql
create extension if not exists pgcrypto;

create table partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  phone text,
  email text,
  description text,
  created_at timestamptz not null default now()
);

create table homes (
  id uuid primary key default gen_random_uuid(),
  demo_group text not null default 'background' check (demo_group in ('main','example','background')),
  invite_token text unique,
  status text not null default 'invited'
    check (status in ('invited','setup','active','occupied','sold','transferred','closed','declined')),
  address_line text not null,
  postal_code text not null,
  city text not null,
  lat double precision not null,
  lng double precision not null,
  estate_name text,
  building_type text check (building_type in ('detached','semi_detached','terraced','cottage','other')),
  year_built int,
  vacant_since date,
  last_known_visit date,
  occupancy_confirmed boolean not null default false,
  authority_confirmed boolean not null default false,
  key_holder text,
  access_notes text,
  heating_type text check (heating_type in ('district','electric','oil','ground_heat_pump','air_heat_pump','wood','unknown')),
  heating_on text check (heating_on in ('yes','no','unknown')),
  water_source text check (water_source in ('municipal','well','unknown')),
  water_main_closed text check (water_main_closed in ('yes','no','unknown')),
  has_alarm text check (has_alarm in ('yes','no','unknown')),
  forecast jsonb,
  forecast_source text check (forecast_source in ('open-meteo','simulated')),
  forecast_fetched_at timestamptz,
  invited_at timestamptz not null default now(),
  setup_started_at timestamptz,
  activated_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  new_owner_wants_cover_help boolean,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  city text,
  relation text not null check (relation in ('child','spouse','sibling','grandchild','relative','friend','other')),
  role text not null check (role in ('coordinator','helper','viewer')),
  can_authorise boolean not null default false,
  status text not null default 'invited' check (status in ('invited','joined','removed')),
  join_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  invited_by uuid references members(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);
create index members_home_idx on members(home_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  template_key text,
  title text not null,
  why text,
  how jsonb not null default '[]'::jsonb,
  category text not null check (category in ('water','heating','electricity','security','outside','admin','visit','appliances','other')),
  priority text not null default 'normal' check (priority in ('urgent','high','normal')),
  status text not null default 'open' check (status in ('open','accepted','done','cancelled')),
  assignee_id uuid references members(id) on delete set null,
  due_at timestamptz,
  recurrence_days int,
  origin text not null default 'plan' check (origin in ('plan','weather','visit_concern','manual')),
  source_label text,
  source_url text,
  needs_info text,
  declined_by uuid[] not null default '{}',
  booking_id uuid,
  source_visit_id uuid,
  created_by_label text not null default 'Home Watch',
  accepted_at timestamptz,
  completed_at timestamptz,
  completed_by_label text,
  completion_note text,
  completed_by_visit_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_home_idx on tasks(home_id);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  package_key text not null check (package_key in ('check','winter','urgent')),
  status text not null check (status in ('pending_approval','requested','confirmed','in_progress','completed','cancelled','declined')),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  access_method text not null check (access_method in ('key_holder_meets','key_box','partner_collects_key','other')),
  access_details text,
  notes text,
  partner_price_cents int not null,
  if_fee_cents int not null,
  requested_by uuid references members(id) on delete set null,
  approved_by uuid references members(id) on delete set null,
  approved_at timestamptz,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);
create index bookings_home_idx on bookings(home_id);
create index bookings_partner_idx on bookings(partner_id);

alter table tasks add constraint tasks_booking_fk foreign key (booking_id) references bookings(id) on delete set null;

create table visits (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  visitor_type text not null check (visitor_type in ('family','partner')),
  member_id uuid references members(id) on delete set null,
  partner_id uuid references partners(id) on delete set null,
  visitor_name text not null,
  visited_at timestamptz not null,
  indoor_temp_c numeric(4,1),
  checks jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);
create index visits_home_idx on visits(home_id, visited_at desc);

alter table tasks add constraint tasks_source_visit_fk foreign key (source_visit_id) references visits(id) on delete set null;
alter table tasks add constraint tasks_completed_visit_fk foreign key (completed_by_visit_id) references visits(id) on delete set null;

create table house_notes (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  category text not null check (category in ('water','heating','electricity','access','contacts','appliances','other')),
  title text not null,
  body text not null default '',
  essential_key text check (essential_key in ('water_main_valve','water_meter','fuse_box','heating_controls','key_location','neighbour_contact','well_pump')),
  confirmed boolean not null default false,
  updated_by_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (home_id, essential_key)
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  storage_path text not null,
  caption text,
  visit_id uuid references visits(id) on delete set null,
  note_id uuid references house_notes(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  uploaded_by_label text not null,
  created_at timestamptz not null default now()
);
create index photos_home_idx on photos(home_id);

create table activity (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  type text not null,
  actor_label text not null,
  actor_member_id uuid references members(id) on delete set null,
  message text not null,
  task_id uuid references tasks(id) on delete set null,
  visit_id uuid references visits(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now()
);
create index activity_home_idx on activity(home_id, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  partner_id uuid references partners(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','sms','email')),
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_member_idx on notifications(member_id, created_at desc);
create index notifications_partner_idx on notifications(partner_id, created_at desc);

create table weather_alerts (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references homes(id) on delete cascade,
  rule text not null check (rule in ('hard_frost','frost','storm','heavy_snow')),
  for_date date not null,
  message text not null,
  min_temp_c numeric(4,1),
  gust_ms numeric(4,1),
  snow_cm numeric(5,1),
  task_id uuid references tasks(id) on delete set null,
  source text not null check (source in ('open-meteo','simulated')),
  created_at timestamptz not null default now(),
  unique (home_id, rule, for_date)
);

-- Only the backend's secret key (which bypasses RLS) may read or write. No policies on purpose.
alter table partners enable row level security;
alter table homes enable row level security;
alter table members enable row level security;
alter table tasks enable row level security;
alter table bookings enable row level security;
alter table visits enable row level security;
alter table house_notes enable row level security;
alter table photos enable row level security;
alter table activity enable row level security;
alter table notifications enable row level security;
alter table weather_alerts enable row level security;

-- Private photo bucket
insert into storage.buckets (id, name, public)
values ('home-photos', 'home-photos', false)
on conflict (id) do nothing;
```

---

## 6. Auth model (demo-grade, deliberately simple)

`lib/http.ts` exports a wrapper used by every route:

```ts
export const GET = route({ actor: 'M' }, async ({ req, params, actor, query, body }) => { ... });
```

What the wrapper does, in order:

1. **API key:** `Authorization` must equal `Bearer ${API_KEY}`. Use a constant-time compare. Otherwise `401 unauthorized`.
2. **Actor:** parse `X-Actor`:
   - `member:<uuid>` → load the member and their home. Status `removed` → `403 removed`. Status `invited` → **auto-join**: set `status='joined'`, `joined_at=now()` and log `member_joined`. Demo persona switching relies on this.
   - `partner:<uuid>` → load the partner.
   - `staff` → staff actor.
   - Missing or unknown → `401 actor_required` when the route needs an actor.
3. **Permission:** check the route's code from 7.3 (`M`, `H`, `C`, `A`, `P`, `S`, `any`, `none`) against the resource's home or booking. A wrong home returns `403 forbidden`. A missing resource returns `404 not_found`.
4. **Closed homes:** for write methods on a home whose status is `occupied`, `sold`, `transferred`, `closed` or `declined`, return `409 home_closed`.
5. **Validation:** parse the body and query with the route's zod schema; on failure return `400 invalid_request` with the zod issues in `details`.
6. **Errors:** throw `new ApiError(status, code, message)` anywhere; the wrapper turns it into the error JSON. Unknown errors → `500 internal` (log the stack on the server; never leak it).

The actor label used in activity and notifications is the member's name, the partner's name, "If pilot team" (staff) or "Home Watch" (system).

---

## 7. API contract

Sections 7.1–7.4 appear word for word in `FRONTEND.md` as well. **Do not change one side without the other.**

<!-- CONTRACT:START (identical in BACKEND.md and FRONTEND.md) -->

### 7.1 Conventions

- **Base URL:** `BACKEND_URL` (local: `http://localhost:3001`). Every path starts with `/api`.
- **Server-to-server only.** Only the frontend's server code (server components, server actions, route handlers) calls the backend. The browser never calls it directly, so the API key never reaches the browser.
- **Every request** sends `Authorization: Bearer <API_KEY>`. A missing or wrong key returns `401`.
- **Who is acting** goes in the `X-Actor` header: `member:<uuid>`, `partner:<uuid>` or `staff`. Endpoints marked `none` in the Actor column ignore it.
- **JSON in, JSON out**, except photo upload (`multipart/form-data`) and export (a file download). Success responses return the object itself, with no wrapper.
- **Errors** always look like `{ "error": { "code": "not_found", "message": "Task not found", "details": ... } }` with status `400` (validation; `details` = zod issues), `401`, `403`, `404`, `409` (conflict, wrong state) or `500`.
- **Timestamps** are ISO 8601 strings in UTC (`2026-10-21T15:00:00.000Z`). **Dates** are `YYYY-MM-DD`. The UI shows everything in `Europe/Helsinki`.
- **Money** is integer euro cents (`6900` = €69).
- **Photo `url`s** are signed Supabase Storage URLs valid for 60 minutes. Never cache them longer.

### 7.2 Shared types — `lib/contract.ts` (byte-identical in both repos)

```ts
// lib/contract.ts — SHARED API CONTRACT for If Home Watch.
// Keep this file byte-identical in if-insurance-challenge-backend and if-insurance-challenge-frontend.

/* ---------------- enums ---------------- */
export type HomeStatus = 'invited' | 'setup' | 'active' | 'occupied' | 'sold' | 'transferred' | 'closed' | 'declined';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type BuildingType = 'detached' | 'semi_detached' | 'terraced' | 'cottage' | 'other';
export type HeatingType = 'district' | 'electric' | 'oil' | 'ground_heat_pump' | 'air_heat_pump' | 'wood' | 'unknown';
export type WaterSource = 'municipal' | 'well' | 'unknown';
export type Role = 'coordinator' | 'helper' | 'viewer';
export type Relation = 'child' | 'spouse' | 'sibling' | 'grandchild' | 'relative' | 'friend' | 'other';
export type MemberStatus = 'invited' | 'joined' | 'removed';
export type TaskStatus = 'open' | 'accepted' | 'done' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'normal';
export type TaskCategory = 'water' | 'heating' | 'electricity' | 'security' | 'outside' | 'admin' | 'visit' | 'appliances' | 'other';
export type TaskOrigin = 'plan' | 'weather' | 'visit_concern' | 'manual';
export type TaskFilter = 'all' | 'mine' | 'open' | 'needs_owner' | 'overdue' | 'done';
export type CheckResult = 'ok' | 'concern' | 'not_checked';
export type VisitorType = 'family' | 'partner';
export type NoteCategory = 'water' | 'heating' | 'electricity' | 'access' | 'contacts' | 'appliances' | 'other';
export type EssentialKey = 'water_main_valve' | 'water_meter' | 'fuse_box' | 'heating_controls' | 'key_location' | 'neighbour_contact' | 'well_pump';
export type PackageKey = 'check' | 'winter' | 'urgent';
export type BookingStatus = 'pending_approval' | 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'declined';
export type AccessMethod = 'key_holder_meets' | 'key_box' | 'partner_collects_key' | 'other';
export type WeatherRule = 'hard_frost' | 'frost' | 'storm' | 'heavy_snow';
export type ForecastSource = 'open-meteo' | 'simulated';
export type SupervisionState = 'no_visit_yet' | 'ok' | 'due_soon' | 'overdue';
export type NotificationChannel = 'in_app' | 'sms' | 'email';
export type TransitionStatus = 'occupied' | 'sold' | 'transferred' | 'closed';
export type DeclineReason = 'someone_lives_there' | 'not_now' | 'not_responsible';
export type ActorHeader = `member:${string}` | `partner:${string}` | 'staff';
export type ActivityType =
  | 'home_invited' | 'home_activated' | 'home_updated' | 'home_transition'
  | 'member_invited' | 'member_joined' | 'member_updated' | 'member_removed'
  | 'task_created' | 'task_accepted' | 'task_declined' | 'task_assigned' | 'task_completed'
  | 'task_reopened' | 'task_commented' | 'task_escalated' | 'task_updated' | 'task_cancelled'
  | 'visit_recorded' | 'note_saved' | 'photo_added' | 'weather_alert'
  | 'booking_requested' | 'booking_approved' | 'booking_confirmed' | 'booking_declined'
  | 'booking_started' | 'booking_completed' | 'booking_cancelled';

/* ---------------- core objects ---------------- */
export interface PersonRef { id: string; name: string }
export interface SourceRef { label: string; url: string | null }

export interface Home {
  id: string;
  status: HomeStatus;
  addressLine: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
  estateName: string | null;          // the person who died, e.g. "Eila Virtanen" (fictional)
  buildingType: BuildingType | null;
  yearBuilt: number | null;
  vacantSince: string | null;         // YYYY-MM-DD
  lastKnownVisit: string | null;      // YYYY-MM-DD, last visit before Home Watch
  occupancyConfirmed: boolean;        // "nobody lives here" confirmed
  authorityConfirmed: boolean;        // someone in the family can authorise access
  keyHolder: string | null;
  accessNotes: string | null;
  heatingType: HeatingType | null;
  heatingOn: YesNoUnknown | null;
  waterSource: WaterSource | null;
  waterMainClosed: YesNoUnknown | null;
  hasAlarm: YesNoUnknown | null;
  activatedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  newOwnerWantsCoverHelp: boolean | null;
}

export interface MemberStats { openTasks: number; doneTasks: number; visits: number; lastVisitAt: string | null }

export interface Member {
  id: string;
  homeId: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  relation: Relation;                 // relationship to the person who died (Home.estateName)
  role: Role;
  canAuthorise: boolean;
  status: MemberStatus;
  joinedAt: string | null;
  stats: MemberStats;
}

export interface Partner {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  email: string | null;
  description: string | null;
}

export interface Photo { id: string; url: string; caption: string | null; uploadedByLabel: string; createdAt: string }

export interface Task {
  id: string;
  homeId: string;
  templateKey: string | null;
  title: string;
  why: string | null;
  how: string[];
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  assignee: PersonRef | null;
  dueAt: string | null;
  isOverdue: boolean;                 // open/accepted and dueAt < now
  needsOwner: boolean;                // open, no assignee, no active booking, and urgent or due within 48 h
  recurrenceDays: number | null;
  origin: TaskOrigin;
  source: SourceRef | null;
  needsInfo: string | null;           // an unconfirmed detail, shown as "Not confirmed: ..."
  declinedBy: PersonRef[];
  bookingId: string | null;           // an active local visit covers this task
  completedAt: string | null;
  completedByLabel: string | null;
  completionNote: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  actorLabel: string;                 // "Aino Virtanen", "Talonvahti Demo Oy", "Home Watch"
  message: string;                    // ready-to-show sentence
  taskId: string | null;
  visitId: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface CheckItem { key: string; label: string; help: string }
export interface VisitCheck { key: string; label: string; result: CheckResult; note: string | null }

export interface Visit {
  id: string;
  homeId: string;
  visitorType: VisitorType;
  visitorName: string;
  memberId: string | null;
  partnerId: string | null;
  bookingId: string | null;
  visitedAt: string;
  indoorTempC: number | null;
  checks: VisitCheck[];
  notes: string | null;
  photos: Photo[];
  okCount: number;
  concernCount: number;
  completedTasks: PersonRef[];        // { id: taskId, name: task title } closed by this visit
  followUpTasks: Task[];              // tasks created from this visit's concerns
  createdAt: string;
}

export interface VisitSummary {
  id: string;
  visitorType: VisitorType;
  visitorName: string;
  visitedAt: string;
  indoorTempC: number | null;
  okCount: number;
  concernCount: number;
  photoCount: number;
  bookingId: string | null;
}

export interface Note {
  id: string;
  homeId: string;
  category: NoteCategory;
  title: string;
  body: string;
  essentialKey: EssentialKey | null;
  confirmed: boolean;
  photos: Photo[];
  updatedByLabel: string;
  updatedAt: string;
}

export interface EssentialStatus { key: EssentialKey; label: string; why: string; category: NoteCategory; noteId: string | null; confirmed: boolean; hasPhoto: boolean }

export interface ForecastDay { date: string; minC: number; maxC: number; gustMs: number; snowCm: number }

export interface WeatherAlert {
  id: string;
  rule: WeatherRule;
  forDate: string;                    // the day the weather is forecast for
  message: string;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  actionedBeforeDate: boolean;        // the linked task was done before forDate
  source: ForecastSource;
  createdAt: string;
}

export interface WeatherThresholds { hardFrostC: number; frostC: number; stormGustMs: number; heavySnowCm: number }

export interface HomeWeather {
  source: ForecastSource;
  fetchedAt: string | null;
  days: ForecastDay[];                // today + next 3 days, Europe/Helsinki dates
  activeAlerts: WeatherAlert[];       // alerts whose forDate is today or later
  recentAlerts: WeatherAlert[];       // last 30 days, newest first
  thresholds: WeatherThresholds;
}

export interface Supervision {
  state: SupervisionState;
  lastVisitAt: string | null;
  lastVisitorName: string | null;
  daysSinceLastVisit: number | null;
  nextDueAt: string;
  ruleLabel: string;                  // "If's home terms describe supervision of an empty home as a visit at least monthly."
  source: SourceRef;
}

export interface VisitPackage {
  key: PackageKey;
  name: string;
  durationMin: number;
  includes: string[];
  partnerPriceCents: number;
  ifFeeCents: number;
  totalCents: number;
  leadTime: string;                   // "Next 3 days" | "Within 24 hours"
}

export interface Slot { start: string; end: string }

export interface Booking {
  id: string;
  homeId: string;
  status: BookingStatus;
  package: VisitPackage;
  partner: Partner;
  slotStart: string;
  slotEnd: string;
  accessMethod: AccessMethod;
  accessDetails: string | null;
  notes: string | null;
  taskId: string | null;
  taskTitle: string | null;
  requestedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  createdAt: string;
  approvedAt: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  visitId: string | null;
}

export interface Notification {
  id: string;
  homeId: string | null;
  channel: NotificationChannel;       // sms/email are simulated: shown in-app only
  title: string;
  body: string;
  link: string | null;                // frontend path, e.g. "/homes/<id>/tasks/<id>"
  readAt: string | null;
  createdAt: string;
}

/* ---------------- composite responses ---------------- */
export interface Persona { actor: ActorHeader; label: string; subtitle: string; homeId: string | null; landing: string }
export interface PersonasResponse { groups: { title: string; description: string; personas: Persona[] }[]; inviteUrl: string }

export interface DemoState {
  mainHomeId: string;
  mainHomeStatus: HomeStatus;
  exampleHomeId: string;
  latestBooking: { id: string; homeId: string; status: BookingStatus } | null;
  forecastSource: ForecastSource;
}

export type MeResponse =
  | { kind: 'member'; member: Member; home: { id: string; addressLine: string; city: string; estateName: string | null; status: HomeStatus }; unread: number }
  | { kind: 'partner'; partner: Partner; unread: number }
  | { kind: 'staff'; label: string; unread: number };

export interface InviteView {
  token: string;
  status: HomeStatus;
  home: { id: string; addressLine: string; postalCode: string; city: string; estateName: string | null };
  fromLabel: string;                  // "If estate support"
  message: string;
  alreadyAcceptedBy: PersonRef | null;
}

export interface JoinView {
  member: Member;
  home: { id: string; addressLine: string; city: string; estateName: string | null };
  invitedBy: string | null;
}

export interface ActorGrant { homeId: string | null; memberId: string | null; actor: ActorHeader }

export interface Dashboard {
  home: Home;
  me: Member;
  supervision: Supervision;
  weather: HomeWeather;
  needsAttention: Task[];             // max 6: needsOwner, then overdue, then urgent, then soonest due
  myTasks: Task[];                    // my open/accepted tasks, soonest due first
  nextVisitTask: Task | null;         // open/accepted monthly_visit or first_walkthrough
  counts: { open: number; overdue: number; needsOwner: number; doneLast30d: number; openConcerns: number };
  members: Member[];
  essentialsMissing: EssentialStatus[];
  activeBooking: Booking | null;      // newest booking not completed/cancelled/declined
  recentActivity: Activity[];         // last 8
}

export interface PlanResponse {
  tasks: Task[];
  counts: { all: number; mine: number; open: number; needsOwner: number; overdue: number; done: number };
}

export interface TaskDetail { task: Task; activity: Activity[]; photos: Photo[]; booking: Booking | null; canEdit: boolean }

export interface NotesResponse { notes: Note[]; essentials: EssentialStatus[] }

export interface BookingOptions {
  packages: VisitPackage[];
  partner: Partner;
  slots: Record<PackageKey, Slot[]>;
  accessMethods: { key: AccessMethod; label: string }[];
  canApprove: boolean;                // the current member can approve (canAuthorise)
  authorisedMembers: PersonRef[];
  task: Task | null;                  // the task from ?taskId=, if any
  keyHolder: string | null;
}

export interface BookingDetail { booking: Booking; timeline: Activity[]; visit: Visit | null; canApprove: boolean; canCancel: boolean }

export interface PartnerJob {
  booking: Booking;
  home: { id: string; addressLine: string; postalCode: string; city: string; estateName: string | null };
  coordinator: { name: string; phone: string | null } | null;
}

export interface PartnerJobDetail extends PartnerJob {
  checklist: CheckItem[];
  essentials: Note[];                 // notes with an essentialKey
  keyHolder: string | null;
  accessNotes: string | null;
}

export interface NotificationsResponse { items: Notification[]; unread: number }

export interface HomeRecord {
  home: Home;
  generatedAt: string;
  members: Member[];
  visits: Visit[];
  completedTasks: Task[];
  openTasks: Task[];
  bookings: Booking[];
  alerts: WeatherAlert[];
  activity: Activity[];
  disclaimer: string;
}

export interface Insights {
  generatedAt: string;
  dataNote: string;                   // "Demo data: 2 story homes + 12 generated background homes"
  homes: { invited: number; setupStarted: number; active: number; closed: number; declined: number; setupCompletionRate: number };
  family: { avgMembersPerHome: number; joinedRate: number };
  tasks: { acceptedWithin48hRate: number; avgHoursToFirstAccepted: number | null; overdueNow: number; needsOwnerNow: number; completedLast30d: number };
  supervision: { onTimeRate: number; overdueHomes: number };
  weather: { alertsLast30d: number; actionedBeforeDateRate: number };
  visits: { familyLast30d: number; partnerLast30d: number };
  paidVisits: { requested: number; completed: number; conversionRate: number; serviceRevenueCents: number; avgIfFeeCents: number };
  transitions: { occupied: number; sold: number; transferred: number; closed: number; coverHelpRequested: number };
  funnel: { stage: string; count: number }[];
  homesTable: { id: string; city: string; status: HomeStatus; daysActive: number | null; supervision: SupervisionState | null; openTasks: number; paidVisits: number }[];
  assumptions: { label: string; value: string }[];
}

/* ---------------- request bodies ---------------- */
export interface AcceptInviteBody { name: string; relation: Relation; email?: string; phone?: string; city?: string }
export interface DeclineInviteBody { reason: DeclineReason }
export interface HomeSetupPatch {
  occupancyConfirmed?: boolean;
  vacantSince?: string | null;
  lastKnownVisit?: string | null;
  authorityConfirmed?: boolean;
  keyHolder?: string | null;
  accessNotes?: string | null;
  buildingType?: BuildingType | null;
  yearBuilt?: number | null;
  heatingType?: HeatingType | null;
  heatingOn?: YesNoUnknown | null;
  waterSource?: WaterSource | null;
  waterMainClosed?: YesNoUnknown | null;
  hasAlarm?: YesNoUnknown | null;
}
export interface TransitionBody { status: TransitionStatus; note?: string; newOwnerWantsCoverHelp?: boolean }
export interface InviteMemberBody { name: string; relation: Relation; role: Role; canAuthorise: boolean; email?: string; phone?: string; city?: string }
export interface MemberPatch { name?: string; email?: string | null; phone?: string | null; city?: string | null; role?: Role; canAuthorise?: boolean }
export interface CreateTaskBody { title: string; why?: string; category: TaskCategory; priority: TaskPriority; dueAt?: string | null; assigneeId?: string | null }
export interface TaskPatch { title?: string; why?: string | null; priority?: TaskPriority; dueAt?: string | null; status?: 'cancelled' }
export interface DeclineTaskBody { reason: string }
export interface AssignTaskBody { memberId: string | null }
export interface CompleteTaskBody { note?: string; photoIds?: string[] }
export interface CommentBody { body: string }
export interface CheckInput { key: string; result: CheckResult; note?: string }
export interface RecordVisitBody { visitedAt: string; indoorTempC?: number | null; checks: CheckInput[]; notes?: string; photoIds?: string[] }
export interface NoteBody { category: NoteCategory; title: string; body: string; essentialKey?: EssentialKey | null; confirmed: boolean; photoIds?: string[] }
export interface CreateBookingBody { packageKey: PackageKey; slotStart: string; accessMethod: AccessMethod; accessDetails?: string; notes?: string; taskId?: string | null; confirmAuthority?: boolean }
export interface CancelBookingBody { reason: string }
export interface PartnerDeclineBody { reason: string }
export interface PartnerReportBody { indoorTempC: number | null; checks: CheckInput[]; notes?: string; photoIds?: string[] }
export interface MarkReadBody { ids?: string[] }
```

### 7.3 Who may call what

| Code | Meaning |
| --- | --- |
| `none` | API key only; `X-Actor` ignored |
| `any` | any valid actor |
| `M` | a member of this home (any role, status not `removed`) |
| `H` | a member of this home with role `helper` or `coordinator` |
| `C` | a member of this home with role `coordinator` |
| `A` | a member of this home with `canAuthorise = true` (and not a viewer) |
| `P` | the partner the booking is assigned to |
| `S` | `staff` |

Actions on a home whose status is `occupied`, `sold`, `transferred`, `closed` or `declined` are read-only. Writes return `409 home_closed`.

### 7.4 Endpoints

**System and demo**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | none | – | `{ ok: true, time: string, version: string }` |
| GET | `/api/me` | any | – | `MeResponse` |
| GET | `/api/demo/personas` | none | – | `PersonasResponse` |
| GET | `/api/demo/state` | none | – | `DemoState` |
| POST | `/api/demo/reset` | none | – | `{ ok: true, inviteUrl: string }` |
| POST | `/api/demo/homes/:homeId/cold-night` | none | – | `HomeWeather` |
| POST | `/api/demo/homes/:homeId/storm` | none | – | `HomeWeather` |
| POST | `/api/demo/homes/:homeId/clear-weather` | none | – | `HomeWeather` |
| POST | `/api/demo/bookings/:bookingId/complete` | none | – | `Visit` |

**Invitations and joining**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/invites/:token` | none | – | `InviteView` |
| POST | `/api/invites/:token/accept` | none | `AcceptInviteBody` | `ActorGrant` (409 `already_accepted` if a coordinator exists) |
| POST | `/api/invites/:token/decline` | none | `DeclineInviteBody` | `{ ok: true }` |
| GET | `/api/join/:token` | none | – | `JoinView` |
| POST | `/api/join/:token` | none | – | `ActorGrant` |

**Homes**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/homes/:homeId` | M | – | `Home` |
| PATCH | `/api/homes/:homeId` | C | `HomeSetupPatch` | `Home` |
| POST | `/api/homes/:homeId/activate` | C | – | `{ home: Home, tasks: Task[] }` (400 `occupancy_not_confirmed` if not confirmed) |
| GET | `/api/homes/:homeId/dashboard` | M | – | `Dashboard` |
| POST | `/api/homes/:homeId/transition` | C | `TransitionBody` | `Home` |
| GET | `/api/homes/:homeId/record` | M | – | `HomeRecord` |
| GET | `/api/homes/:homeId/export` | M | – | `HomeRecord` as a JSON file download |
| GET | `/api/homes/:homeId/activity?limit=50` | M | – | `Activity[]` newest first |

**Family members**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/homes/:homeId/members` | M | – | `Member[]` (removed members excluded) |
| POST | `/api/homes/:homeId/members` | C | `InviteMemberBody` | `{ member: Member, joinPath: string }` |
| PATCH | `/api/members/:memberId` | C, or self for name/email/phone/city | `MemberPatch` | `Member` |
| DELETE | `/api/members/:memberId` | C | – | `{ ok: true }` (409 `last_coordinator`) |

**Tasks**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/homes/:homeId/tasks?filter=all` | M | – | `PlanResponse` |
| POST | `/api/homes/:homeId/tasks` | H | `CreateTaskBody` | `Task` |
| GET | `/api/tasks/:taskId` | M | – | `TaskDetail` |
| PATCH | `/api/tasks/:taskId` | C | `TaskPatch` | `Task` |
| POST | `/api/tasks/:taskId/accept` | H | – | `Task` |
| POST | `/api/tasks/:taskId/decline` | H | `DeclineTaskBody` | `Task` |
| POST | `/api/tasks/:taskId/assign` | C (anyone) or H (only self) | `AssignTaskBody` | `Task` |
| POST | `/api/tasks/:taskId/complete` | H | `CompleteTaskBody` | `{ task: Task, nextTask: Task \| null }` |
| POST | `/api/tasks/:taskId/reopen` | H | – | `Task` |
| POST | `/api/tasks/:taskId/comments` | M | `CommentBody` | `Activity` |

**Visits, photos, house notes**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/homes/:homeId/visit-checklist` | M or P | – | `CheckItem[]` |
| GET | `/api/homes/:homeId/visits` | M | – | `VisitSummary[]` newest first |
| POST | `/api/homes/:homeId/visits` | H | `RecordVisitBody` | `Visit` |
| GET | `/api/visits/:visitId` | M, or P for its own booking | – | `Visit` |
| POST | `/api/homes/:homeId/photos` | H, or P with an active booking at this home | multipart: `file` (jpeg/png/webp, max 5 MB), `caption?`, `visitId?`, `noteId?`, `taskId?` | `Photo` |
| DELETE | `/api/photos/:photoId` | H | – | `{ ok: true }` |
| GET | `/api/homes/:homeId/notes` | M | – | `NotesResponse` |
| POST | `/api/homes/:homeId/notes` | H | `NoteBody` | `Note` |
| GET | `/api/notes/:noteId` | M | – | `Note` |
| PATCH | `/api/notes/:noteId` | H | `Partial<NoteBody>` | `Note` |
| DELETE | `/api/notes/:noteId` | H | – | `{ ok: true }` |

**Weather**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/homes/:homeId/weather` | M | – | `HomeWeather` (refetches when older than 60 min and not simulated) |
| POST | `/api/homes/:homeId/weather/refresh` | M | – | `HomeWeather` (always refetches unless simulated; runs the rules) |

**Local visits (bookings)**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/catalog/visit-packages` | none | – | `VisitPackage[]` |
| GET | `/api/homes/:homeId/booking-options?taskId=` | H | – | `BookingOptions` |
| GET | `/api/homes/:homeId/bookings` | M | – | `Booking[]` newest first |
| POST | `/api/homes/:homeId/bookings` | H | `CreateBookingBody` | `Booking` |
| GET | `/api/bookings/:bookingId` | M | – | `BookingDetail` |
| POST | `/api/bookings/:bookingId/approve` | A | – | `Booking` |
| POST | `/api/bookings/:bookingId/cancel` | the requester, A or C | `CancelBookingBody` | `Booking` |

**Partner**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/partner/jobs?status=open\|scheduled\|done` | P (any partner) | – | `PartnerJob[]` (open = requested; scheduled = confirmed/in_progress; done = completed/declined/cancelled) |
| GET | `/api/partner/jobs/:bookingId` | P | – | `PartnerJobDetail` |
| POST | `/api/partner/jobs/:bookingId/accept` | P | – | `Booking` |
| POST | `/api/partner/jobs/:bookingId/decline` | P | `PartnerDeclineBody` | `Booking` |
| POST | `/api/partner/jobs/:bookingId/start` | P | – | `Booking` |
| POST | `/api/partner/jobs/:bookingId/complete` | P | `PartnerReportBody` | `Visit` |

**Messages and insights**

| Method | Path | Actor | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/notifications` | any | – | `NotificationsResponse` (newest first, max 100) |
| POST | `/api/notifications/read` | any | `MarkReadBody` (no ids = mark all) | `{ ok: true }` |
| GET | `/api/insights` | S | – | `Insights` |

<!-- CONTRACT:END -->

---

## 8. Business rules

### 8.1 Home lifecycle

```text
invited ──accept──▶ setup ──activate──▶ active ──transition──▶ occupied | sold | transferred | closed
   └──decline (someone lives there)──▶ declined
```

- **Accept invite** (`POST /api/invites/:token/accept`): allowed only when status is `invited` and the home has no coordinator; otherwise return `409 already_accepted` (the invite view shows `alreadyAcceptedBy`, so the frontend can offer "continue as Aino"). Create a member with `role='coordinator'`, `status='joined'`, `can_authorise=false` (set in setup) and the body's name/relation/contacts. Set the home's `status='setup'` and `setup_started_at=now()`. Log `member_joined` ("Aino Virtanen accepted the invitation"). Return `ActorGrant { homeId, memberId, actor: 'member:<id>' }`.
- **Decline invite:** `someone_lives_there` → `status='declined'`, `close_reason='Someone still lives in the home'`, `closed_at=now()`. `not_now` or `not_responsible` → no status change; log the activity only.
- **Setup PATCH** (`PATCH /api/homes/:homeId`): allowed while the status is `setup` or `active`. Save any provided field. Log `home_updated` with a short summary ("Heating set to district heating").
- **Activate:** requires `occupancy_confirmed = true` (otherwise `400 occupancy_not_confirmed`). Generate the plan (8.2), set `status='active'`, `activated_at=now()`, fetch the forecast and run the weather rules (8.7), and log `home_activated` ("Care plan created with 14 tasks"). Idempotent: if already active, return the current tasks.
- **Transition:** sets the status and `closed_at`, saves `close_reason` from the note, and sets `new_owner_wants_cover_help`. All open and accepted tasks become `cancelled`. Pending, requested and confirmed bookings become `cancelled` with the reason "Home Watch plan closed". Notify all joined members by email (simulated): "The Home Watch plan for {address} is closed". If `newOwnerWantsCoverHelp`, add a line to the notification: "If will contact the new owner about cover only if they ask." Log `home_transition`.

### 8.2 Care-plan templates

`lib/plan/templates.ts` holds the templates below. `generate(home, activatedAt)` creates one task per template whose condition matches, with:

- `due_at` = the activation date + `dueDays`, at **18:00 Helsinki**
- `status='open'`, `origin='plan'`
- `sort_order` = the list order
- `needs_info` filled in where stated

Source constants:

- `TERMS = { label: "If home insurance terms", url: "https://www.if.fi/globalassets/fi/pdf/ehdot/kotivakuutusehdot.pdf" }`. The label gets the section appended plus " (check the terms version on your own policy)", e.g. "If home insurance terms §5.5 (check the terms version on your own policy)".
- `ESTATE = { label: "If: estate insurance guidance", url: "https://www.if.fi/henkiloasiakkaat/asiakaspalvelu/usein-kysyttya/kuolinpesan-vakuutukset" }`

| # | key | title | category | priority | dueDays | condition | recurrence | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `key_access` | Agree who holds the keys and how access works | admin | urgent | 2 | always | – | – |
| 2 | `first_walkthrough` | First visit: walk through the home | visit | urgent | 3 | always | – | TERMS §5 |
| 3 | `water_main_photo` | Find and photograph the water main valve | water | high | 3 | always | – | TERMS §5.5 |
| 4 | `water_main_close` | Close the water main and switch off the water pump | water | urgent | 3 | `waterMainClosed !== 'yes'` | – | TERMS §5.5 |
| 5 | `wood_backup` | Arrange basic heat that runs without anyone there | heating | urgent | 2 | `heatingType === 'wood'` | – | TERMS §5.5 |
| 6 | `heating_check` | Check the heating is on and the home stays warm | heating | high | 7 | always | – | TERMS §5.5 |
| 7 | `electricity_contract` | Keep the electricity contract active | admin | high | 5 | always | – | – |
| 8 | `tell_if` | Tell If the home is empty and check the estate's cover | admin | high | 7 | always | – | ESTATE |
| 9 | `well_pump` | Protect the well pump and pressure tank from frost | water | high | 7 | `waterSource === 'well'` | – | TERMS §5.5 |
| 10 | `oil_level` | Check the heating oil level | heating | high | 7 | `heatingType === 'oil'` | 30 | – |
| 11 | `heat_pump_check` | Check the heat pump is running and its outdoor unit is clear | heating | normal | 7 | `heatingType` is a heat pump | – | – |
| 12 | `fuse_box` | Find the fuse box and main switch | electricity | normal | 7 | always | – | – |
| 13 | `alarm_contacts` | Update the alarm system's contact people | security | normal | 7 | `hasAlarm === 'yes'` | – | – |
| 14 | `fridge_freezer` | Empty the fridge and freezer, or decide to keep them on | appliances | normal | 7 | always | – | – |
| 15 | `valuables` | Secure valuables and important documents | security | normal | 7 | always | – | – |
| 16 | `mail` | Arrange mail forwarding or collection | admin | normal | 7 | always | – | – |
| 17 | `smoke_alarms` | Test the smoke alarms | security | normal | 14 | always | – | – |
| 18 | `monthly_visit` | Monthly supervision visit | visit | normal | 30 | always | 30 | TERMS §5 |
| 19 | `decide_next` | Decide what happens to the home next | admin | normal | 60 | always | – | – |

Texts (`why` and `how` steps). Keep them plain; never promise cover.

- **key_access** — why: "Every visit, yours or a partner's, depends on knowing who has the keys and who can let someone in." how: "List everyone who has a key." / "Decide where a spare key is kept: with a person or in a key box." / "Write it in House notes → Access. Never store alarm codes in the app."
- **first_walkthrough** — why: "Nobody can plan well for a house they haven't seen since it became empty. The first visit finds the valves, the heating settings and any damage." how: "Walk through every room: look for leaks, damp smells or cold rooms." / "Find and photograph the water main valve, the water meter and the fuse box." / "Note the heating settings and the indoor temperature." / "Record the visit in the app."
- **water_main_photo** — why: "In a leak, minutes matter. Everyone, including a visiting partner, needs to know where the valve is." how: "The valve is usually next to the water meter, often in a utility room, basement or under the kitchen sink." / "Take a clear photo and add it to House notes → Water." / "Say whether it's open or closed now."
- **water_main_close** — why: "If's home terms say that when a home is unoccupied for more than a week, the main water valve should be closed and the domestic-water pump switched off." how: "Close the main valve fully." / "If the home has its own water pump, switch it off." / "Keep the space with the water meter heated." / "Record what you did and when." `needs_info` when `waterMainClosed === 'unknown'`: "Not known whether the water main is closed. Check it on the first visit."
- **wood_backup** — why: "Wood heating needs someone to keep it going. An empty home needs basic heat that runs on its own, or drained water systems." how: "Ask a heating professional which backup heat is safe for this house." / "Until then, agree who visits to keep the house warm." / "Record what was decided."
- **heating_check** — why: "A heating failure in winter can freeze pipes within days. Basic heat has to stay on, or the water systems must be drained." how: "Check the thermostat and that radiators or floor heating feel warm." / "Write down the indoor temperature." / "Check the electricity contract is still active. Heating stops if it's cancelled." / "Record the check." `needs_info` when `heatingOn === 'unknown'`: "Not known whether the heating is on. Check it on the first visit."
- **electricity_contract** — why: "Heating, pumps and frost protection need power. Cancelling the electricity contract too early can leave the house unheated." how: "Find out which company the electricity contract is with." / "Keep it active for the estate instead of cancelling it." / "Save the company and contract number in House notes → Contacts."
- **tell_if** — why: "Cover for an empty home can depend on supervision and protection instructions. Confirm what applies to this policy." how: "Contact If about the estate's home insurance." / "Ask which terms version applies." / "Save the policy number in House notes → Contacts."
- **well_pump** — why: "A well pump and pressure tank in an unheated space can freeze and break." how: "Check where the pump and pressure tank are and that the space stays above freezing." / "Switch the pump off if the water main is closed." / "Photograph it for House notes → Water."
- **oil_level** — why: "If the oil runs out, the heating stops." how: "Read the tank gauge." / "Order a refill before it gets low." / "Write the level in the task note."
- **heat_pump_check** — why: "Heat pumps stop or lose efficiency when the outdoor unit is blocked by snow or ice." how: "Check the indoor unit shows no error." / "Clear snow away from the outdoor unit." / "Note the set temperature."
- **fuse_box** — why: "You'll need it in an electrical fault or a leak, and so will any partner who visits." how: "Find the fuse box and the main switch." / "Photograph it and add it to House notes → Electricity."
- **alarm_contacts** — why: "Alarm calls may still go to someone who can no longer respond." how: "Contact the alarm provider." / "Update the contact people." / "Don't store codes in the app."
- **fridge_freezer** — why: "A power cut or a forgotten fridge can cause smells, pests or water damage." how: "Empty and clean the fridge, or decide to keep it running." / "If you switch it off, leave the door open."
- **valuables** — why: "An empty home is a target. Documents and valuables are also needed for the estate." how: "Collect valuables and important papers." / "Note in the app where they are kept now (not what they are worth)."
- **mail** — why: "A full mailbox shows the house is empty, and bills can be missed." how: "Arrange mail forwarding, or agree who collects it on visits."
- **smoke_alarms** — why: "A working alarm matters even when visitors are only there for short visits." how: "Press the test button on each alarm." / "Replace batteries if needed."
- **monthly_visit** — why: "If's home terms describe supervising an empty building as a visit at least once a month." how: "Walk through the home using the visit checklist." / "Record the visit with photos. That's your record of what was checked."
- **decide_next** — why: "Selling, keeping or renting out the home changes the care it needs and the insurance it needs." how: "Agree on a direction with the other heirs." / "When it's decided, update the home's status under Settings."

**Weather templates** (created only by the rules in 8.7):

- **storm_check** — "Check the house after the storm" · outside · high · why: "Fallen trees, loose roofing and power cuts often go unnoticed in an empty home." how: "Look for fallen trees, roof damage and broken windows." / "Check the power is on and the heating has restarted." / "Check the freezer if there was a power cut."
- **roof_snow_check** — "Check the snow load on the roof (from the ground)" · outside · high · why: "Heavy snow can damage a roof, and nobody is there to notice." how: "Look at the roof from the ground. Never climb onto a snowy roof." / "If the snow looks heavy, book a professional to clear it."

**Visit follow-ups** (created from concerns, 8.5): title `Follow up: {check label}` · category from the check item · priority high · due in 3 days at 18:00 · `origin='visit_concern'` · why = the concern's note, or "Reported during the visit on {date}".

### 8.3 Task computed fields and ordering

- `isOverdue = status in ('open','accepted') && due_at < now`
- `needsOwner = status === 'open' && assignee_id is null && booking_id is null && (priority === 'urgent' || (due_at && due_at - now <= 48h))`
- **Plan ordering** (`GET .../tasks`): open and accepted tasks first, ordered by needsOwner, then overdue, then priority (urgent > high > normal), then `due_at` ascending, then `sort_order`. Done tasks follow, newest `completed_at` first. Cancelled tasks appear only under `filter=all`, at the end.
- **Filters:** `mine` = assignee is me and not done/cancelled · `open` = open or accepted · `needs_owner` · `overdue` · `done` · `all`.

### 8.4 Task actions

| Action | Who | Effect | Activity | Notify |
| --- | --- | --- | --- | --- |
| create | H | `origin='manual'`, `created_by_label`; if `assigneeId` is set, status `accepted` and set `accepted_at` | task_created | assignee (if someone else) |
| accept | H | assignee = me, status `accepted`, `accepted_at=now()`, remove me from `declined_by` | task_accepted | coordinators except me |
| decline | H | add me to `declined_by`; if I was the assignee → assignee null, status `open` | task_declined ("Mikko can't do this: {reason}") | coordinators except me |
| assign | C: anyone · H: only self | `memberId` → assignee, status `accepted`, `accepted_at=now()`; `null` → unassign, status `open` | task_assigned ("Aino asked Mikko to do this") | the new assignee (if not me) |
| complete | H | status `done`, `completed_at`, `completed_by_label`, `completion_note`; link `photoIds` (set `photos.task_id`); if `accepted_at` is null set it too; **recurring** → create the next occurrence (same template fields, due = completion + recurrence days at 18:00, same assignee with status `accepted` if they are still joined, otherwise `open`) | task_completed | coordinators except me |
| reopen | H | status `open` (keep assignee → `accepted` if one is set), clear completion fields | task_reopened | – |
| comment | M | activity only | task_commented (message = the comment) | assignee and coordinators except me |
| patch | C | update fields; `status:'cancelled'` cancels | task_updated / task_cancelled | assignee (if not me) |

Viewers can only comment. A task covered by an active booking (`booking_id` set) can still be accepted or completed by family; completing it does not cancel the booking.

### 8.5 Visits

**Checklist** (`GET .../visit-checklist`): built from `CHECK_ITEMS` (section 9), filtered by the home's setup and season: `water_pump` only for a well, `heat_pump_unit` only for heat pumps, `oil_level` only for oil, `roof_snow` only from 1 October to 30 April (Helsinki date).

**Record a visit** (`POST .../visits`, family) runs in this order:

1. Insert the visit (`visitor_type='family'`, `member_id` = me, `visitor_name` = my name). Fill in each check's `label` from the catalog. Unknown keys → `400`.
2. Link `photoIds` (set `photos.visit_id`).
3. **Complete tasks covered by the visit** (open or accepted only; set `completed_by_visit_id` and `completed_by_label` = the visitor's name):
   - always `monthly_visit` and `first_walkthrough`
   - by check result `ok`: `heating` → `heating_check` · `heat_pump_unit` → `heat_pump_check` · `oil_level` → `oil_level` · `roof_snow` → `roof_snow_check` · `outside` → `storm_check`
   - Recurring tasks completed this way create their next occurrence as in 8.4, with due = visit date + recurrence days.
   - If no `monthly_visit` task is open after this, create one due 30 days after the visit.
4. **Concerns → follow-up tasks** (8.2), with `source_visit_id` set. Notify coordinators: "New concern from {visitor}: {label}".
5. Set `homes.last_known_visit` to the visit date.
6. Log `visit_recorded` ("Mikko recorded a visit: 9 OK, 1 concern, 17 °C"). Notify other joined members.
7. Return the full `Visit` (with `completedTasks` and `followUpTasks`).

The partner path (8.8) reuses steps 2–7 with `visitor_type='partner'`.

### 8.6 Supervision, house notes and photos

**Supervision** (in `Dashboard` and the record):

- `lastVisitAt` = the newest visit
- `no_visit_yet` → `nextDueAt` = `activated_at` + 3 days
- otherwise `daysSince` = whole days since the last visit; `ok` if ≤ 21, `due_soon` if 22–30, `overdue` if > 30; `nextDueAt` = last visit + 30 days
- `ruleLabel`: "If's home terms describe supervision of an empty home as a visit at least monthly." `source` = TERMS §5

**Essentials** (`NotesResponse.essentials`, `Dashboard.essentialsMissing` = not confirmed):

| key | label | category | why | Shown when |
| --- | --- | --- | --- | --- |
| `water_main_valve` | Water main valve | water | Needed within minutes if a pipe leaks | always |
| `water_meter` | Water meter | water | Its space must stay heated, and the valve is usually next to it | always |
| `fuse_box` | Fuse box and main switch | electricity | Needed in a fault, a leak or a storm | always |
| `heating_controls` | Heating controls | heating | Lets anyone check the heating is set right | always |
| `key_location` | Where the keys are | access | Every visit depends on it | always |
| `neighbour_contact` | A neighbour who can help | contacts | Someone nearby can spot problems first | always |
| `well_pump` | Well pump and pressure tank | water | Can freeze in an unheated space | well only |

`hasPhoto` = the note has at least one photo.

**Saving a note** (create or patch) with an `essentialKey`: upsert by `(home_id, essential_key)`. Link `photoIds`. If `confirmed` is true and the note has a photo (or is `key_location` or `neighbour_contact`, which need no photo), complete the matching open task: `water_main_valve` → `water_main_photo` · `fuse_box` → `fuse_box` · `key_location` → `key_access`. Log `note_saved` ("Mikko added the water main valve location with a photo").

**Photos:** accept `image/jpeg`, `image/png` or `image/webp` up to 5 MB. Store at `homes/{homeId}/{uuid}.{ext}` in `home-photos`. Insert the row with `uploaded_by_label`. Link it to a visit, note or task if those ids are given and belong to the same home. Log `photo_added` (only when not attached to a note or visit, to keep the feed quiet). Every response maps photos to `{ id, url, caption, uploadedByLabel, createdAt }`, with `url` from `createSignedUrls(paths, 3600)`, batched per response.

### 8.7 Weather

**Fetch:** `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&daily=temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,snowfall_sum&wind_speed_unit=ms&timezone=Europe%2FHelsinki&forecast_days=4`. Map to `ForecastDay[]`, rounding to one decimal. Store it in `homes.forecast` with `forecast_source='open-meteo'` and `forecast_fetched_at`.

- **GET weather:** if the source is `simulated`, return the stored forecast as it is. If it's `open-meteo` and younger than 60 minutes, return it. Otherwise refetch and run the rules.
- **Refresh:** refetch (unless simulated) and run the rules.
- **Fetch failure:** keep whatever is stored. If nothing is stored, return `days: []`, `fetchedAt: null`. Never fail the request.
- Weather is fetched only for `active` homes.

**Thresholds** (demo assumptions; returned in `HomeWeather.thresholds`): `hardFrostC = -15`, `frostC = -5`, `stormGustMs = 20`, `heavySnowCm = 20` (sum over the forecast days).

**Rules** (`lib/weather/rules.ts`) run over each forecast day from today on, for active homes only. Each rule fires at most once per `(home, rule, forDate)`; insert into `weather_alerts` with `on conflict do nothing`, and skip the side effects if the row already existed.

| Rule | Condition | Effect |
| --- | --- | --- |
| `hard_frost` | `minC <= -15` | If an open or accepted `heating_check` exists: set priority `urgent` and due = the day before `forDate` at 18:00 Helsinki if that is earlier (never in the past: if it would be, use now + 2 h); log `task_escalated`. Otherwise create a `heating_check` with `origin='weather'`, priority `urgent` and that due time. Notify **all joined members** by SMS (simulated): "Cold night on {Tue 21 Oct}: {−18 °C} forecast. The heating check is urgent." If the task has no assignee and no booking, also notify **coordinators** in-app: "Nobody has accepted the heating check yet", body "The cold night is on {date}. Ask someone in the family, or request a local visit.", link `/homes/{id}/help?taskId={taskId}`. |
| `frost` | `-15 < minC <= -5` | Make sure an open or accepted `heating_check` exists (create one with priority high, due the day before at 18:00, `origin='weather'`). Notify all joined members in-app. |
| `storm` | `gustMs >= 20` | Create a `storm_check` due the day after `forDate` at 18:00. Notify all joined members by SMS (simulated). |
| `heavy_snow` | sum of `snowCm` ≥ 20 (`forDate` = the first day with snow) | Create a `roof_snow_check` due 2 days after `forDate` at 18:00. Notify all joined members in-app. |

Alert `message` examples: "−18 °C forecast for Tue 21 Oct", "Gusts of 26 m/s forecast for Wed 22 Oct", "32 cm of snow forecast by Thu 23 Oct". Log `weather_alert` with the same message. `actionedBeforeDate` = the linked task is done with `completed_at` before the end of `forDate` (Helsinki).

### 8.8 Bookings (local visits)

**Booking options** (`GET .../booking-options`):

- `packages` from the catalog; the single partner from the DB
- `slots` per package, in Helsinki time:
  - `check`: the next 3 days (starting tomorrow), 09:00–11:00 and 13:00–15:00
  - `winter`: the next 3 days, 09:00–12:00 and 13:00–16:00
  - `urgent`: today 15:00–17:00 if it is now before 13:00, plus tomorrow 09:00–11:00
  - Remove slots whose start overlaps a booking of this partner in `requested`, `confirmed` or `in_progress`.
- `accessMethods` with labels: key_holder_meets "A family member or the key holder meets the partner" · key_box "Key in a key box (code given to the partner)" · partner_collects_key "Partner collects the key from someone nearby" · other "Other arrangement"
- `canApprove` = me.canAuthorise · `authorisedMembers` · `task` from `?taskId` · `keyHolder` from the home

**Create** (`POST .../bookings`):

1. Validate the package, that `slotStart` is one of the offered slots (else `409 slot_unavailable`) and the access method.
2. Prices come from the catalog; store them on the booking.
3. Status:
   - If I can authorise **and** `confirmAuthority === true` → `requested`, `approved_by` = me, `approved_at` = now.
   - If I can authorise but `confirmAuthority` is missing → `400 authority_confirmation_required`.
   - If I can't authorise → `pending_approval`.
4. If `taskId` is set → `tasks.booking_id` = this booking.
5. Log `booking_requested` ("Aino requested a check visit for Tue 21 Oct, 09:00–11:00"). Notify:
   - `pending_approval` → all authorised members by SMS: "{name} asked for a local visit. Approve?" (link to the booking)
   - `requested` → the partner by email: "New visit request: {address}, {slot}" (link `/partner/jobs/{id}`), and log `booking_approved`

**Lifecycle:**

| Transition | Who | From | Side effects |
| --- | --- | --- | --- |
| approve | A | pending_approval | → requested; approved_by/at; notify the partner + the requester; activity booking_approved |
| partner accept | P | requested | → confirmed; confirmed_at; notify the requester + coordinators: "{partner} confirmed the visit on {slot}"; booking_confirmed |
| partner decline | P | requested | → declined; cancel_reason = reason; clear `tasks.booking_id`; notify the requester + coordinators; booking_declined |
| partner start | P | confirmed | → in_progress; started_at; booking_started |
| partner complete | P | confirmed or in_progress | → completed; completed_at; create the partner visit (8.5 steps 2–7, `visitor_name` = the partner's name, `booking_id`); complete the booking's task if it's open or accepted; clear its `booking_id`; notify all joined members by SMS: "Visit report ready" (link `/homes/{id}/visits/{visitId}`); booking_completed |
| cancel | requester, A or C | pending_approval, requested, confirmed | → cancelled; cancelled_at, cancel_reason; clear `tasks.booking_id`; notify the partner if it had been sent to them; booking_cancelled |

Wrong state → `409 invalid_state`. `BookingDetail.timeline` = the activity rows with this `booking_id`, oldest first. `canApprove` = status is pending_approval and I'm authorised. `canCancel` = the cancel rule above.

### 8.9 Members

- **Invite** (`POST .../members`): create a member with `status='invited'` and `invited_by` = me. `joinPath` = `/join/{join_token}`. Notify the invitee by SMS if a phone is given, otherwise by email (simulated): "{inviter} invited you to help look after {estateName}'s home" (link = joinPath). Log `member_invited`.
- **Join** (`POST /api/join/:token`): set joined (if not already) and log `member_joined`. Return an `ActorGrant`. A removed member → `403`.
- **Patch:** a coordinator can change role and canAuthorise; anyone can change their own name and contact details. Demoting the last coordinator → `409 last_coordinator`. Viewers can't have `canAuthorise` (force it to false).
- **Delete:** sets `status='removed'`, unassigns their open and accepted tasks (status → open) and logs `member_removed`. Removing the last coordinator → `409`.
- **Stats** in `Member.stats`: open (open/accepted assigned to them), done (completed by them, counted by `completed_by_label` = their name or `assignee_id`), visits (`member_id`), lastVisitAt.

### 8.10 Notifications, activity, record, me

- **Notifications:** one row per recipient. `sms` and `email` are **simulated**: they are only stored and shown in the app, never sent. Never notify the actor about their own action. `GET /api/notifications` returns the actor's rows (members by `member_id`, partners by `partner_id`, staff: none). `unread` = rows with `read_at` null.
- **Activity:** every write in this section logs one row with a ready-to-show `message` (examples above). `GET .../activity` returns newest first (`limit` default 50, max 200).
- **Record:** `HomeRecord` = the home, members, all visits (full), completed and open tasks, all bookings, all weather alerts, all activity, and `disclaimer`: "This record lists observations and actions entered by family members and visit partners. It is not an insurance decision. Claims are assessed under the policy terms, including cover, exclusions, limits and deductibles." **Export** returns the same JSON with `Content-Disposition: attachment; filename="home-record-{city}-{YYYY-MM-DD}.json"`.
- **Me:** `MeResponse` for the actor, with `unread`.
- **Links** in notifications are frontend paths: task `/homes/{h}/tasks/{t}`, visit `/homes/{h}/visits/{v}`, booking `/homes/{h}/help/{b}`, local-visit request `/homes/{h}/help?taskId={t}`, partner job `/partner/jobs/{b}`, join `/join/{token}`.

### 8.11 Personas and demo state

`GET /api/demo/personas` returns these groups, in this order:

1. "Demo story: the Virtanen home, Kaarina" — description "Start from the invitation, or continue as anyone already in the family." Personas: every non-removed member of the `main` home (subtitle "{Role} · {relation} · {city}"), landing `/homes/{homeId}` (or `/setup/{homeId}` while the status is `setup`).
2. "Example: the Lindqvist home, Turku (five weeks in)" — description "A home with history: visits, notes, a completed partner visit." Personas: the members of the `example` home.
3. "Visit partner" — the partner, landing `/partner`.
4. "If" — "If pilot team" (`staff`), landing `/insights`.

`inviteUrl` = `/invite/demo-virtanen`. `GET /api/demo/state` fills `DemoState` from the `main` and `example` homes; `latestBooking` = the newest booking of the main home.

---

## 9. Catalog constants (`lib/catalog.ts`)

**Partner (fictional, seeded):** name "Talonvahti Demo Oy", area "Turku region (demo)", phone "+358 40 000 0000", email "visits@talonvahti.example", description "Fictional local home-visit partner used in this prototype."

**Visit packages (placeholder prices, not quotes):**

| key | name | durationMin | partnerPriceCents | ifFeeCents | totalCents | leadTime | includes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `check` | Check visit | 45 | 5900 | 1000 | 6900 | Next 3 days | Heating running and indoor temperature · Signs of leaks under sinks, at the water heater and floor drains · Water main in the agreed position · Doors and windows locked · Mail collected · Photos and a written report |
| `winter` | Winter-readiness visit | 90 | 9500 | 1500 | 11000 | Next 3 days | Everything in the check visit · Water main and pump set as the family instructs · Outdoor taps checked · Snow on the roof checked from the ground |
| `urgent` | Urgent check | 45 | 9900 | 2000 | 11900 | Within 24 hours | Everything in the check visit, within 24 hours where available |

**Check items** (`CHECK_ITEMS`; `key` · label · help · category for follow-ups · condition):

| key | label | help | category | condition |
| --- | --- | --- | --- | --- |
| `heating` | Heating is running | Radiators or floor heating feel warm; the thermostat is set as agreed | heating | always |
| `leaks` | No signs of water leaks | Look under sinks, around the water heater, toilets and floor drains | water | always |
| `water_main` | Water main in the agreed position | Open or closed as the family has decided | water | always |
| `water_pump` | Water pump in the agreed state | Well pump and pressure tank space above freezing | water | well |
| `damp_smell` | No damp or musty smell | Check the basement, bathrooms and closets | other | always |
| `electricity` | Electricity on, no tripped fuses | Lights work; the fuse box shows no tripped fuses | electricity | always |
| `windows_doors` | Windows and doors closed and locked | Including the basement and outbuildings | security | always |
| `fridge_freezer` | Fridge and freezer as agreed | Empty with doors open, or running normally | appliances | always |
| `mail` | Mail and flyers collected | Bring important letters to the coordinator | admin | always |
| `heat_pump_unit` | Heat pump outdoor unit clear | No snow or ice blocking it; no error on the indoor unit | heating | heat pump |
| `oil_level` | Heating oil level noted | Write the level in the note | heating | oil |
| `outside` | Outside looks fine | Roof, gutters, yard; no storm damage or fallen trees | outside | always |
| `roof_snow` | Snow on the roof looks manageable | Seen from the ground only | outside | 1 Oct – 30 Apr |

Indoor temperature is a separate number field (`indoorTempC`), not a check item.

**Labels** used in activity and notification text, defined once here: roles (Coordinator, Helper, Viewer), relations (Child, Spouse, Sibling, Grandchild, Relative, Friend, Other), heating types ("District heating", "Electric heating", "Oil heating", "Ground-source heat pump", "Air heat pump", "Wood heating", "Not sure").

---

## 10. Seed data and demo reset

`resetAndSeed()` in `lib/seed/index.ts`:

1. Collect every `photos.storage_path` and remove those objects from the bucket in chunks of 100. Then `delete from homes` (cascades) and `delete from partners`.
2. Insert the partner (section 9).
3. Insert the **main** home, the **example** home and **12 background** homes, as below.
4. All dates are **relative to now**, so the demo always looks current. Use a deterministic PRNG (mulberry32, seed `20261017`) for the background homes so the insights look the same after every reset.
5. Return `{ ok: true, inviteUrl: '/invite/demo-virtanen' }`. It must finish in under 20 seconds. Use batched inserts and give the reset route `maxDuration = 60`.

**Placeholder photos** (`lib/seed/placeholders.ts`): generate an 800×600 SVG with a soft neutral background, a simple outline icon and two centred lines, "Sample photo" plus a title (e.g. "Water main valve"). Upload it as `image/svg+xml`. Photo upload *by users* still accepts only jpeg/png/webp; the SVGs are seed-only.

### 10.1 Main home — the live demo (starts empty)

| Field | Value |
| --- | --- |
| demo_group | main |
| invite_token | `demo-virtanen` |
| status | invited |
| address | Esimerkkitie 12, 20780 Kaarina |
| lat, lng | 60.4072, 22.3685 |
| estate_name | Eila Virtanen |
| building_type | detached · year_built 1978 |
| everything else | null / false (the setup questions fill these in) |

No members, tasks, visits, notes or bookings. Activity: one `home_invited` row, "If estate support invited the family to Home Watch".

### 10.2 Example home — five weeks in

| Field | Value |
| --- | --- |
| demo_group | example |
| status | active · activated 35 days ago · setup started 36 days ago · invited 37 days ago |
| address | Mallikatu 4, 20540 Turku · lat 60.4339, lng 22.2950 |
| estate_name | Kaarlo Lindqvist · detached · 1965 |
| setup | vacant_since 40 days ago · occupancy and authority confirmed · key holder "Jari Lindqvist (one spare key in the key box by the back door)" · heating district, on · water municipal · water main closed yes · alarm no |
| forecast | fetched live on the first read |

Members:

| name | role | relation | city | canAuthorise | phone |
| --- | --- | --- | --- | --- | --- |
| Sanna Lindqvist | coordinator | child | Espoo | yes | +358 40 000 0101 |
| Jari Lindqvist | helper | child | Turku | yes | +358 40 000 0102 |
| Emma Lindqvist | viewer | grandchild | Helsinki | no | – |

Generate the plan as if it were activated 35 days ago, then apply this history:

- **Visits:** 33 days ago (Jari, first walkthrough, 19.5 °C, all OK) · 19 days ago (Sanna, 19.0 °C, concern `damp_smell`: "Slight musty smell in the basement storage room") · 12 days ago (partner Talonvahti Demo Oy via a completed check booking, 18.5 °C, all OK, 2 photos) · 6 days ago (Jari, 18.0 °C, all OK). Attach 1–2 placeholder photos to each.
- **Tasks:** everything due before today is done, completed by the right person around the matching visit. Open: `monthly_visit` (accepted by Jari, due in 24 days) · `decide_next` (open, due in 25 days) · "Follow up: No damp or musty smell" (accepted by Sanna, high, due in 2 days, note "Slight musty smell in the basement storage room") · `smoke_alarms` (open, due tomorrow).
- **Notes:** water_main_valve (confirmed, photo, "Under the stairs in the utility room, blue lever. Closed since the first visit.") · water_meter (confirmed, photo) · fuse_box (confirmed, photo, "Hallway cupboard; main switch top left") · heating_controls (confirmed, "District heating substation in the basement, set to 19 °C") · key_location (confirmed, "Jari has one key; a spare is in the key box by the back door. Ask Jari for the code.") · a contacts note "Electricity: contract kept active for the estate" · **neighbour_contact missing**, so the essentials show one gap.
- **Booking:** one `completed` check booking 12 days ago, requested and approved by Sanna, access `key_box`.
- **Activity and notifications:** rows matching all of the above, with realistic timestamps. A few notifications for Sanna (two unread).

### 10.3 Background homes — for insights (12)

Turku-region cities: Turku, Kaarina, Raisio, Lieto, Naantali, Parainen, Masku, Rusko. Street names: fictional "Koetie", "Mallitie", "Esimerkkikatu", "Demopolku", "Harjoituskuja" plus a number. Estate and member names: random Finnish first names + surnames from short built-in lists (e.g. first: Aila, Anneli, Eero, Juhani, Kaija, Leena, Markku, Pirjo, Raimo, Seppo, Tuula, Veikko; family members: Anna, Elina, Heikki, Janne, Katja, Laura, Mikael, Niina, Olli, Petra, Riikka, Timo; surnames: Aalto, Heikkinen, Koskinen, Laine, Mäkinen, Nieminen, Salonen, Turunen).

| Count | Status | What to generate |
| --- | --- | --- |
| 2 | invited | invited 1–4 days ago; nothing else |
| 1 | declined | reason "Someone still lives in the home" |
| 1 | setup | setup started 1 day ago, coordinator only |
| 6 | active | activated 8–80 days ago; 2–4 members (1 coordinator, 70% joined); plan generated; tasks before today 60–95% done with realistic `accepted_at`; 0–3 family visits; 3 homes have a weather alert (2 actioned before the date); 3 homes have a completed paid visit, 1 has a `requested` booking; 1 home has supervision overdue |
| 1 | sold | was active 60 days, closed 5 days ago, 1 completed paid visit, `new_owner_wants_cover_help=false` |
| 1 | transferred | was active 90 days, closed 10 days ago, `new_owner_wants_cover_help=true` |

---

## 11. Demo simulation endpoints

All take the API key only (no actor). Never call them from user flows; only the frontend's demo hub uses them.

- **`POST /api/demo/homes/:homeId/cold-night`** — store a simulated forecast (`forecast_source='simulated'`) for today + 3 days: `[{min −6, max −2}, {min −18, max −11}, {min −15, max −9}, {min −8, max −3}]`, gusts 6 m/s, snow 0–2 cm. Run the rules (the `hard_frost` alert fires for tomorrow). Return `HomeWeather`.
- **`POST /api/demo/homes/:homeId/storm`** — simulated: tomorrow min 1, max 5, gusts 26 m/s; other days calm. Run the rules. Return `HomeWeather`.
- **`POST /api/demo/homes/:homeId/clear-weather`** — switch back to Open-Meteo (refetch now) and run the rules. Return `HomeWeather`.
- **`POST /api/demo/bookings/:bookingId/complete`** — make the simulated partner do the visit now:
  - auto-approve if `pending_approval` (approved_by = the first authorised member)
  - auto-confirm if `requested`, start it, then complete it with the canned report below
  - upload 2 placeholder photos: "Thermostat — 18 °C" and "Roof, north side"
  - return the `Visit`

  Canned report: indoor 17.0 °C · heating OK "Radiators warm, thermostat at 18 °C" · leaks OK · water_main OK "Closed, as instructed" · damp_smell OK · electricity OK · windows_doors OK · fridge_freezer OK · mail OK "Collected 6 letters, left on the kitchen table" · outside OK · roof_snow **concern** "Snow building up on the north side of the roof; looks heavy" (include it even if out of season) · water_pump/heat_pump_unit/oil_level only if they apply (OK). notes: "All rooms checked. One concern about snow on the roof — see the follow-up task."

---

## 12. Insights (`GET /api/insights`, staff)

Computed live from all homes. Rates are 0–1 (two decimals). Use one service, `services/insights.ts`, with plain queries and TypeScript aggregation (the data is small).

| Field | Definition |
| --- | --- |
| homes.invited | all homes |
| homes.setupStarted | `setup_started_at` not null |
| homes.active / closed / declined | status active / in (occupied, sold, transferred, closed) / declined |
| homes.setupCompletionRate | homes with `activated_at` ÷ (all − declined) |
| family.avgMembersPerHome | non-removed members per activated home |
| family.joinedRate | joined ÷ (joined + invited) members |
| tasks.acceptedWithin48hRate | among urgent and high tasks created more than 48 h ago in activated homes: share with `accepted_at − created_at ≤ 48 h` |
| tasks.avgHoursToFirstAccepted | mean over activated homes of hours from `activated_at` to the first `accepted_at` |
| tasks.overdueNow / needsOwnerNow | across active homes, by the rules in 8.3 |
| tasks.completedLast30d | `completed_at` within 30 days |
| supervision.onTimeRate | active homes in state `ok` or `due_soon` ÷ active homes |
| supervision.overdueHomes | active homes `overdue`, or `no_visit_yet` more than 7 days after activation |
| weather.alertsLast30d | alerts created within 30 days |
| weather.actionedBeforeDateRate | alerts with a task that was done before the end of `for_date` ÷ alerts with a task |
| visits.familyLast30d / partnerLast30d | visits within 30 days by type |
| paidVisits.requested | bookings not cancelled or declined |
| paidVisits.completed | completed bookings |
| paidVisits.conversionRate | homes with at least one confirmed, in_progress or completed booking ÷ activated homes |
| paidVisits.serviceRevenueCents | sum of `if_fee_cents` of completed bookings (If's retained fee only) |
| paidVisits.avgIfFeeCents | the mean of the same |
| transitions | counts by status; `coverHelpRequested` = `new_owner_wants_cover_help = true` |
| funnel | Invited (all) → Set up (activated) → First task accepted → First visit recorded → Paid visit completed (home counts) |
| homesTable | every home except `main` while it is still `invited`: city (no street), status, days active, supervision state (active only), open tasks, completed paid visits |
| dataNote | "Demo data: 2 story homes and 12 generated background homes. Not real customers." |
| assumptions | "If coordination fee" → "€10–€20 per visit (placeholder)" · "Partner price" → "€59–€99 per visit (placeholder)" · "Service revenue" → "If's fee only; partner payments pass through" · "Avoided claims" → "Not estimated in the prototype" · "Weather thresholds" → "−15 °C hard frost, −5 °C frost, 20 m/s gusts, 20 cm snow (demo assumptions)" |

---

## 13. Errors and validation

- Every route has a zod schema matching the contract body type. Strings are trimmed. Names are 1–80 characters, notes up to 2000, comments up to 1000. `dueAt`/`slotStart`/`visitedAt` must parse as ISO dates; `visitedAt` can't be more than 1 hour in the future. `indoorTempC` is between −30 and 40.
- IDs in paths must be UUIDs (except the invite and join tokens); otherwise `404`.
- Error codes used: `unauthorized`, `actor_required`, `forbidden`, `removed`, `not_found`, `invalid_request`, `home_closed`, `already_accepted`, `occupancy_not_confirmed`, `last_coordinator`, `invalid_state`, `slot_unavailable`, `authority_confirmation_required`, `file_too_large`, `unsupported_file_type`, `internal`.
- Log one line per request on the server: method, path, status, ms, actor kind.

---

## 14. Smoke test (`npm run smoke`)

`scripts/smoke.ts` runs against `BASE_URL` (default `http://localhost:3001`) with `API_KEY` from `.env.local`. It prints `✔ step` / `✘ step: reason` and exits with code 1 on any failure. Steps:

1. `GET /api/health` → ok
2. `POST /api/demo/reset` → ok
3. `GET /api/demo/personas` → 4 groups; the example group has 3 personas
4. `GET /api/invites/demo-virtanen` → status invited
5. `POST /api/invites/demo-virtanen/accept` (Aino Virtanen, child) → actor A
6. `PATCH /api/homes/:id` as A: occupancy confirmed, authority confirmed, heating district/yes, water municipal, water main `unknown`, key holder "Aino"
7. `PATCH /api/members/:A` → canAuthorise true
8. `POST /api/homes/:id/activate` → tasks include `water_main_close` (with needsInfo), `heating_check` and `monthly_visit`
9. `POST /api/homes/:id/members` (Mikko Virtanen, relation `child`, role helper, a phone number) → joinPath
10. `POST /api/tasks/:first_walkthrough/assign` → Mikko
11. As Mikko: upload a tiny PNG (a hard-coded 1×1 base64 image) to `/photos`, then `POST /notes` with water_main_valve, confirmed, photoIds → the `water_main_photo` task is now done
12. As Mikko: `POST /visits` with all checks OK and 18 °C → `first_walkthrough` done, a next `monthly_visit` exists
13. `POST /api/demo/homes/:id/cold-night` → `activeAlerts` has `hard_frost`; the heating check is urgent and `needsOwner` true; Aino has the "Nobody has accepted" notification
14. As Aino: `GET /booking-options?taskId=` → slots exist; `POST /bookings` (check, first slot, key_holder_meets, confirmAuthority) → `requested`; the task's `bookingId` is set
15. `POST /api/demo/bookings/:id/complete` → a visit with 1 concern; the booking is completed; the heating check is done; a "Follow up: Snow on the roof looks manageable" task exists
16. `GET /api/homes/:id/dashboard` as Aino → counts make sense; `activeBooking` null
17. `GET /api/homes/:id/record` → visits ≥ 2; disclaimer present
18. As staff: `GET /api/insights` → `homes.invited` ≥ 14; funnel has 5 stages
19. As partner: `GET /api/partner/jobs?status=done` → includes the completed booking
20. A call without the API key → 401; Mikko calling the example home → 403
21. `POST /api/demo/reset` again → ok (leave the database in a clean demo state)

---

## 15. Deploy to Vercel

`vercel.json`:

```json
{ "regions": ["arn1"] }
```

(Stockholm, close to a Supabase project in North EU. Remove it if the Supabase project is elsewhere.)

Steps (Claude Code runs them if `vercel whoami` works; otherwise print them):

1. `vercel link --yes` (project name `if-home-watch-api`).
2. For each of `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `API_KEY`: `printf "%s" "$VALUE" | vercel env add NAME production` (and `preview`). `SUPABASE_DB_URL` is not needed on Vercel.
3. `vercel deploy --prod`. Then `curl -H "Authorization: Bearer $API_KEY" https://<url>/api/health`.
4. Tell the user to set `BACKEND_URL=https://<url>` and the same `BACKEND_API_KEY` in the frontend's Vercel project.

The migration and seed run from a laptop (`npm run db:migrate && npm run db:seed`); production uses the same Supabase project.

---

## 16. Out of scope (do not build)

Real authentication or strong identification · real SMS or email sending · real partner integrations · payments · FMI warnings · sensors · multi-language · admin UI · cron jobs · rate limiting · Supabase Realtime. Each is mentioned in the venture brief as a later step.

create extension if not exists pgcrypto;

-- Hosted Supabase installs pgcrypto in extensions; local databases may use public.
set local search_path = public, extensions;

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

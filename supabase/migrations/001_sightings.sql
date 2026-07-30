-- Nuptial Radar: sightings table with row-level security
-- Run in Supabase Dashboard → SQL Editor (or via Supabase CLI)

create table if not exists public.sightings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('sighting', 'queen_capture')),
  latitude double precision not null,
  longitude double precision not null,
  observed_at timestamptz not null,
  species text,
  size_mm double precision,
  temp_c double precision,
  humidity_pct double precision,
  wind_ms double precision,
  pop double precision,
  cloud_pct double precision,
  pressure_hpa double precision,
  dew_point_c double precision,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sightings_user_observed
  on public.sightings (user_id, observed_at desc);

create index if not exists idx_sightings_geo
  on public.sightings (latitude, longitude);

alter table public.sightings enable row level security;

create policy "sightings_select_own"
  on public.sightings
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "sightings_insert_own"
  on public.sightings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "sightings_delete_own"
  on public.sightings
  for delete
  to authenticated
  using (auth.uid() = user_id);

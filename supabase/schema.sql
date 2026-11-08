-- Golf Coach — Supabase schema. Paste into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- Local-first: the app keeps working offline and syncs these tables when signed in.
-- Videos stay on the phone; only measurements, rounds, shots, courses and leagues sync.

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  handicap_index numeric,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

-- ---------- Personal data (settings, bag, swings, rounds, shots, coach plan) ----------
create table if not exists public.user_docs (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('settings','plan','swing','round','course','shot')),
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
alter table public.user_docs enable row level security;
drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists user_docs_updated on public.user_docs (user_id, updated_at);

-- ---------- Shared course library (scorecards anyone in the app can use) ----------
create table if not exists public.courses (
  id text primary key,
  name text not null,
  country text not null default 'AE',
  osm_id text,
  data jsonb not null,            -- tees, par, SI, yards, slope, rating
  created_by uuid references auth.users,
  updated_at timestamptz not null default now()
);
alter table public.courses enable row level security;
drop policy if exists "courses readable" on public.courses;
create policy "courses readable" on public.courses for select to authenticated using (true);
drop policy if exists "courses add" on public.courses;
create policy "courses add" on public.courses for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "courses edit by creator" on public.courses;
create policy "courses edit by creator" on public.courses for update to authenticated using (created_by = auth.uid());

-- ---------- Friends ----------
create table if not exists public.friends (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
alter table public.friends enable row level security;
drop policy if exists "own friends" on public.friends;
create policy "own friends" on public.friends for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Leagues (singles + doubles, stableford or stroke) ----------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (format in ('singles','doubles','both')) default 'both',
  scoring text not null check (scoring in ('stableford','stroke')) default 'stableford',
  allowance_singles numeric not null default 0.95,  -- WHS: 95% individual stableford
  allowance_fourball numeric not null default 0.85, -- WHS: 85% four-ball better ball
  invite_code text unique not null default upper(substr(md5(random()::text), 1, 6)),
  created_by uuid not null references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  handicap_index numeric,
  role text not null default 'player' check (role in ('admin','player')),
  primary key (league_id, user_id)
);
create table if not exists public.league_rounds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues on delete cascade,
  played_on date not null default current_date,
  course_id text,
  course jsonb,                    -- snapshot: par + SI per hole
  created_by uuid not null references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.league_scores (
  round_id uuid not null references public.league_rounds on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  team text,                       -- e.g. 'A' / 'B' for that day's 2v2
  playing_handicap int,
  strokes int[] not null,          -- gross per hole
  entered_by uuid not null references auth.users default auth.uid(),
  primary key (round_id, user_id)
);

-- membership helper (security definer avoids recursive RLS)
create or replace function public.is_member(l uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from public.league_members where league_id = l and user_id = auth.uid());
$$;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_rounds enable row level security;
alter table public.league_scores enable row level security;

drop policy if exists "see my leagues" on public.leagues;
create policy "see my leagues" on public.leagues for select to authenticated using (public.is_member(id) or created_by = auth.uid());
drop policy if exists "create league" on public.leagues;
create policy "create league" on public.leagues for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "admin edits league" on public.leagues;
create policy "admin edits league" on public.leagues for update to authenticated using (created_by = auth.uid());

drop policy if exists "see members" on public.league_members;
create policy "see members" on public.league_members for select to authenticated using (public.is_member(league_id));
drop policy if exists "creator adds self" on public.league_members;
create policy "creator adds self" on public.league_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "member edits self" on public.league_members;
create policy "member edits self" on public.league_members for update to authenticated using (user_id = auth.uid());

drop policy if exists "see rounds" on public.league_rounds;
create policy "see rounds" on public.league_rounds for select to authenticated using (public.is_member(league_id));
drop policy if exists "member adds round" on public.league_rounds;
create policy "member adds round" on public.league_rounds for insert to authenticated with check (public.is_member(league_id));

drop policy if exists "see scores" on public.league_scores;
create policy "see scores" on public.league_scores for select to authenticated using (exists (select 1 from public.league_rounds r where r.id = round_id and public.is_member(r.league_id)));
drop policy if exists "member enters scores" on public.league_scores;
create policy "member enters scores" on public.league_scores for insert to authenticated with check (exists (select 1 from public.league_rounds r where r.id = round_id and public.is_member(r.league_id)));
drop policy if exists "member fixes scores" on public.league_scores;
create policy "member fixes scores" on public.league_scores for update to authenticated using (exists (select 1 from public.league_rounds r where r.id = round_id and public.is_member(r.league_id)));

-- join with an invite code
create or replace function public.join_league(code text, name text, hcp numeric default null)
returns uuid language plpgsql security definer as $$
declare l uuid;
begin
  select id into l from public.leagues where invite_code = upper(code);
  if l is null then raise exception 'No league with that code'; end if;
  insert into public.league_members (league_id, user_id, display_name, handicap_index)
  values (l, auth.uid(), name, hcp) on conflict (league_id, user_id) do update set display_name = excluded.display_name;
  return l;
end $$;
grant execute on function public.join_league(text, text, numeric) to authenticated;

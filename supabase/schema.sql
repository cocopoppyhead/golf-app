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
-- mini profile (added later; safe to re-run)
alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists avatar text;          -- small square JPEG as a data URL
alter table public.profiles add column if not exists home_course text;
alter table public.profiles add column if not exists handed text check (handed in ('right','left'));
alter table public.profiles add column if not exists height_in numeric;
alter table public.profiles add column if not exists onboarded boolean not null default false;
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

-- ---------- Practice sessions sync (added 10 Nov 2026) ----------
alter table public.user_docs drop constraint if exists user_docs_kind_check;
alter table public.user_docs add constraint user_docs_kind_check check (kind in ('settings','plan','swing','round','course','shot','session','launch'));

-- ---------- Friends: codes, visibility, round summaries ----------
alter table public.profiles add column if not exists friend_code text unique;
update public.profiles set friend_code = upper(substr(md5(random()::text || id::text), 1, 6)) where friend_code is null;
alter table public.profiles alter column friend_code set default upper(substr(md5(random()::text), 1, 6));

create or replace function public.are_friends(a uuid, b uuid) returns boolean language sql security definer stable as $$
  select a = b or exists (select 1 from public.friends where (user_id = a and friend_id = b) or (user_id = b and friend_id = a));
$$;

-- what friends see of each other's golf: one row per finished round, no shot detail
create table if not exists public.round_summaries (
  user_id uuid not null references auth.users on delete cascade,
  round_id text not null,
  played_on date not null,
  course_name text not null,
  course_lib_id text,
  holes int not null default 18,
  score int not null,
  to_par int,
  diff numeric,
  putts int,
  updated_at timestamptz not null default now(),
  primary key (user_id, round_id)
);
alter table public.round_summaries enable row level security;
drop policy if exists "own summaries" on public.round_summaries;
create policy "own summaries" on public.round_summaries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "friends see summaries" on public.round_summaries;
create policy "friends see summaries" on public.round_summaries for select to authenticated using (public.are_friends(auth.uid(), user_id));
create index if not exists round_summaries_user on public.round_summaries (user_id, played_on desc);

-- befriend by code (both directions), returns the friend's profile
create or replace function public.add_friend(code text)
returns public.profiles language plpgsql security definer as $$
declare p public.profiles;
begin
  select * into p from public.profiles where friend_code = upper(code);
  if p.id is null then raise exception 'No one has that code'; end if;
  if p.id = auth.uid() then raise exception 'That is your own code'; end if;
  insert into public.friends (user_id, friend_id) values (auth.uid(), p.id) on conflict do nothing;
  insert into public.friends (user_id, friend_id) values (p.id, auth.uid()) on conflict do nothing;
  return p;
end $$;
grant execute on function public.add_friend(text) to authenticated;

-- ---------- Scheduled rounds with invites ----------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references auth.users on delete cascade default auth.uid(),
  course_name text not null,
  course_lib_id text,
  starts_at timestamptz not null,
  note text not null default '',
  invite_code text unique not null default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);
create table if not exists public.event_players (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  status text not null default 'yes' check (status in ('yes','maybe','no')),
  joined_at timestamptz not null default now()
);
create unique index if not exists event_players_user on public.event_players (event_id, user_id) where user_id is not null;
create unique index if not exists event_players_name on public.event_players (event_id, lower(name)) where user_id is null;

create or replace function public.in_event(e uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from public.events where id = e and host = auth.uid())
      or exists (select 1 from public.event_players where event_id = e and user_id = auth.uid());
$$;
alter table public.events enable row level security;
alter table public.event_players enable row level security;
drop policy if exists "see my events" on public.events;
create policy "see my events" on public.events for select to authenticated using (public.in_event(id));
drop policy if exists "host makes events" on public.events;
create policy "host makes events" on public.events for insert to authenticated with check (host = auth.uid());
drop policy if exists "host edits events" on public.events;
create policy "host edits events" on public.events for update to authenticated using (host = auth.uid());
drop policy if exists "host removes events" on public.events;
create policy "host removes events" on public.events for delete to authenticated using (host = auth.uid());
drop policy if exists "see players" on public.event_players;
create policy "see players" on public.event_players for select to authenticated using (public.in_event(event_id));
drop policy if exists "host adds players" on public.event_players;
create policy "host adds players" on public.event_players for insert to authenticated with check (exists (select 1 from public.events where id = event_id and host = auth.uid()));
drop policy if exists "player updates self" on public.event_players;
create policy "player updates self" on public.event_players for update to authenticated using (user_id = auth.uid() or exists (select 1 from public.events where id = event_id and host = auth.uid()));
drop policy if exists "host removes players" on public.event_players;
create policy "host removes players" on public.event_players for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.events where id = event_id and host = auth.uid()));

-- join with an invite code: added to the event and befriended with the host; returns the event
create or replace function public.join_event(code text, name text)
returns public.events language plpgsql security definer as $$
declare e public.events;
begin
  select * into e from public.events where invite_code = upper(code);
  if e.id is null then raise exception 'No round with that code'; end if;
  insert into public.event_players (event_id, user_id, name) values (e.id, auth.uid(), coalesce(nullif(name, ''), 'Player'))
    on conflict (event_id, user_id) where user_id is not null do update set status = 'yes';
  if e.host <> auth.uid() then
    insert into public.friends (user_id, friend_id) values (auth.uid(), e.host) on conflict do nothing;
    insert into public.friends (user_id, friend_id) values (e.host, auth.uid()) on conflict do nothing;
  end if;
  return e;
end $$;
grant execute on function public.join_event(text, text) to authenticated;

-- Delete my account: removes the auth user; every table above cascades from auth.users, so the
-- profile, synced data, friendships, summaries and event places go with it. Courses created by the
-- user stay (shared) with created_by cleared.
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.courses set created_by = null where created_by = auth.uid();
  delete from public.leagues where created_by = auth.uid();
  delete from public.league_scores where entered_by = auth.uid();
  delete from public.league_rounds where created_by = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

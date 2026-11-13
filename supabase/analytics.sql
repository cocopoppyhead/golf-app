-- osolo analytics: the golfer's data as proper tables to query, shot by shot.
--
-- The app syncs each round as one document (user_docs.data, jsonb): that keeps the phone fast and
-- offline-first, and a round can't half-save. Analysis wants the opposite shape: one row per hole,
-- per shot, per putt, so patterns are a GROUP BY away ("wedges from 50-100 by swing length", "putts
-- missed left by the read", "doubles after a penalty"). These views give that shape without a second
-- copy of the data: they read straight from user_docs, so they're always current, and they run with
-- the caller's rights (security_invoker), so row-level security still means each golfer sees only
-- their own rows. A coach's shared view later is a grant on these, not a new store.
--
-- Hierarchy: golfer (profile, bag, Range work, scheduled rounds, coach plan) -> round -> hole -> shot / putt;
-- course -> hole (par, yards, SI). Plus practice sessions, launch-monitor sessions, single logged shots and
-- swing analyses as their own documents. Every view is listed, with its fields, in docs/DATA.md. It's a tree with time, not a network,
-- so plain relational views fit; a graph database would add nothing here.
--
-- Par comes from the golfer's own copy of the course (synced as a course document when they play it);
-- a hole whose course never synced shows a null par.
--
-- Safe to re-run. Run after schema.sql, in the Supabase SQL editor.

-- ---------- courses ----------
create or replace view public.golf_courses with (security_invoker = on) as
select d.user_id, d.id as course_id, d.data->>'name' as name, d.data->>'tees' as tees,
       (d.data->>'rating')::numeric as rating, (d.data->>'slope')::numeric as slope,
       jsonb_array_length(coalesce(d.data->'holes', '[]')) as holes
from public.user_docs d
where d.kind = 'course' and not d.deleted;

create or replace view public.golf_course_holes with (security_invoker = on) as
select d.user_id, d.id as course_id, h.ord::int as hole_no,
       (h.v->>'par')::int as par, (h.v->>'yds')::int as yards, (h.v->>'si')::int as stroke_index
from public.user_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'holes', '[]')) with ordinality as h(v, ord)
where d.kind = 'course' and not d.deleted;

-- ---------- rounds ----------
create or replace view public.golf_rounds with (security_invoker = on) as
select d.user_id, d.id as round_id,
       to_timestamp((d.data->>'date')::double precision / 1000) as played_at,
       d.data->>'courseId' as course_id, d.data->>'courseName' as course_name, d.data->>'tees' as tees,
       coalesce(d.data->>'source', 'osolo') as source, d.data->>'kind' as kind,
       coalesce((d.data->>'finished')::boolean, false) as finished,
       coalesce((d.data->>'quick')::boolean, false) as score_only,
       (d.data->>'gross')::int as gross_posted,
       (d.data->'mood'->>'start')::int as mood_start, (d.data->'mood'->>'turn')::int as mood_turn, (d.data->'mood'->>'finish')::int as mood_finish,
       d.data->>'energy' as energy, d.data->>'warmup' as warmup, d.data->>'intention' as intention,
       (d.data->>'intentionKept')::int as intention_kept,
       d.data->'debrief'->>'again' as do_differently, d.data->'debrief'->>'notes' as notes,
       d.data->>'aim' as aim, d.data->>'swingThought' as swing_thought, d.data->>'expect' as good_round_is,
       (d.data->'process'->>'routine')::int as process_routine, (d.data->'process'->>'commit')::int as process_commit,
       (d.data->'process'->>'accept')::int as process_accept, (d.data->'process'->>'fun')::int as process_fun,
       d.data->'greens'->>'firm' as greens_firmness, d.data->'greens'->>'speed' as greens_speed,
       (d.data->'cond'->'start'->>'tempC')::numeric as temp_c, (d.data->'cond'->'start'->>'humidity')::numeric as humidity,
       (d.data->'cond'->'start'->>'windMph')::numeric as wind_mph, (d.data->'cond'->'start'->>'windFrom')::numeric as wind_from,
       (d.data->'hr'->>'avg')::int as heart_rate_avg
from public.user_docs d
where d.kind = 'round' and not d.deleted;

-- ---------- holes (with par from the course) ----------
create or replace view public.golf_holes with (security_invoker = on) as
select r.user_id, r.id as round_id, h.ord::int as hole_no, ch.par, ch.yards,
       (h.v->>'score')::int as score, (h.v->>'score')::int - ch.par as to_par,
       (h.v->>'putts')::int as putts, coalesce((h.v->>'puttsAuto')::boolean, false) as putts_assumed,
       (h.v->>'firstPutt')::numeric as first_putt_ft, h.v->>'firstPuttSrc' as first_putt_source,
       h.v->>'tee' as tee_result, (h.v->>'gir')::boolean as gir, h.v->>'miss' as approach_miss,
       coalesce((h.v->>'shortSided')::boolean, false) as short_sided, coalesce((h.v->>'bunker')::boolean, false) as greenside_bunker,
       h.v->>'fpLong' as first_putt_long_short, h.v->>'fpSide' as first_putt_side,
       (h.v->'hr'->>'avg')::int as heart_rate, to_timestamp((h.v->>'at')::double precision / 1000) as played_at
from public.user_docs r
cross join lateral jsonb_array_elements(coalesce(r.data->'holes', '[]')) with ordinality as h(v, ord)
left join public.golf_course_holes ch on ch.user_id = r.user_id and ch.course_id = r.data->>'courseId' and ch.hole_no = h.ord
where r.kind = 'round' and not r.deleted and jsonb_typeof(h.v) = 'object' and h.v ? 'score' and h.v->>'score' is not null;

-- ---------- shots: every stroke before the green ----------
create or replace view public.golf_shots with (security_invoker = on) as
select r.user_id, r.id as round_id, h.ord::int as hole_no, s.ord::int as shot_no,
       case when s.ord = 1 then 'tee' else coalesce(s.v->>'lie', s.v->>'lieAuto') end as lie,
       (s.v->>'dist')::numeric as from_yd,
       s.v->>'res' as result,          -- G green, HO holed, GS greenside, BK bunker, FW, RG, TR trouble, WT water, OB; tee: FW, LR/RR rough, LT/RT trouble
       s.v->>'res2' as result_detail,  -- tee extras: FB fairway bunker, WS waste, PN penalty area...
       s.v->>'dir' as miss_from_flag,  -- S short, L long, LF left, R right (missed greens)
       coalesce((s.v->>'ss')::boolean, false) as short_sided, coalesce((s.v->>'pen')::boolean, false) as penalty,
       s.v->>'sw' as swing,            -- full, 3q, half, pitch, chip, splash, punch, putter
       s.v->'d'->>'club' as club, s.v->'d'->>'strike' as strike, s.v->'d'->>'flight' as flight,
       s.v->'d'->>'cause' as cause, (s.v->'d'->>'plan')::boolean as as_planned, (s.v->'d'->>'sat')::int as satisfaction,
       coalesce(s.v->>'src', 'manual') as source,  -- manual, laser, garmin
       to_timestamp((s.v->>'t')::double precision / 1000) as hit_at
from public.user_docs r
cross join lateral jsonb_array_elements(coalesce(r.data->'holes', '[]')) with ordinality as h(v, ord)
cross join lateral jsonb_array_elements(case when jsonb_typeof(h.v->'shots') = 'array' then h.v->'shots' else '[]' end) with ordinality as s(v, ord)
where r.kind = 'round' and not r.deleted and jsonb_typeof(s.v) = 'object';

-- ---------- putts, one by one ----------
create or replace view public.golf_putts with (security_invoker = on) as
select r.user_id, r.id as round_id, h.ord::int as hole_no, p.ord::int as putt_no,
       (p.v->>'ft')::numeric as from_ft,
       p.v->>'brk' as read_break,  -- RL right-to-left, LR left-to-right, S straight, X double
       p.v->>'sl' as read_slope,   -- up, flat, dn
       coalesce((p.v->>'holed')::boolean, false) as holed,
       p.v->>'mside' as missed_side,  -- LF left, C on line, R right
       p.v->>'mlen' as missed_length  -- S short, L long
from public.user_docs r
cross join lateral jsonb_array_elements(coalesce(r.data->'holes', '[]')) with ordinality as h(v, ord)
cross join lateral jsonb_array_elements(case when jsonb_typeof(h.v->'puttList') = 'array' then h.v->'puttList' else '[]' end) with ordinality as p(v, ord)
where r.kind = 'round' and not r.deleted and jsonb_typeof(p.v) = 'object';

-- ---------- practice: sessions and what was done in them ----------
create or replace view public.golf_practice with (security_invoker = on) as
select d.user_id, d.id as session_id, to_timestamp((d.data->>'date')::double precision / 1000) as done_at,
       d.data->>'status' as status, (d.data->>'minutes')::int as minutes, d.data->'where' as places,
       (d.data->>'rating')::int as rating, d.data->>'note' as note,
       i.ord::int as item_no, i.v->>'mode' as mode, i.v->>'title' as item, i.v->>'drillId' as drill_id,
       (i.v->>'score')::numeric as score, (i.v->>'of')::numeric as score_of, (i.v->>'attempts')::int as attempts,
       (i.v->>'achieved')::boolean as achieved, (i.v->>'repsDone')::int as reps, (i.v->>'rating')::int as reps_rating, i.v->'fails' as misses
from public.user_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'items', '[]')) with ordinality as i(v, ord)
where d.kind = 'session' and not d.deleted;

-- ---------- launch monitor: one row per shot ----------
create or replace view public.golf_launch with (security_invoker = on) as
select d.user_id, d.id as session_id, to_timestamp((d.data->>'date')::double precision / 1000) as hit_on,
       d.data->>'club' as club, d.data->>'ball' as ball, d.data->>'source' as source,
       x.ord::int as shot_no, x.v as numbers  -- carry, total, club/ball speed, smash, launch, spin, ... as the device gave them
from public.user_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]')) with ordinality as x(v, ord)
where d.kind = 'launch' and not d.deleted;

-- ---------- swing analyses (the knowledge from each video; the video stays on the phone) ----------
create or replace view public.golf_swing_checks with (security_invoker = on) as
select d.user_id, d.id as swing_id, to_timestamp((d.data->>'date')::double precision / 1000) as recorded_at,
       d.data->>'club' as club, d.data->>'view' as camera, d.data->>'golfer' as friend,
       (d.data->'summary'->>'score10')::numeric as swing_score,
       c.v->>'key' as checkpoint, i.v->>'name' as item, i.v->>'status' as status,
       i.v->>'you' as you, i.v->>'pro' as reference, i.v->'value' as value
from public.user_docs d
cross join lateral jsonb_array_elements(coalesce(d.data->'checkpoints', '[]')) as c(v)
cross join lateral jsonb_array_elements(coalesce(c.v->'items', '[]')) as i(v)
where d.kind = 'swing' and not d.deleted;

-- ---------- the golfer (their settings doc: who they are, not the phone's preferences) ----------
create or replace view public.golf_profile with (security_invoker = on) as
select d.user_id, d.data->>'name' as name, d.data->>'nickname' as nickname,
       (d.data->>'handicap')::numeric as handicap, d.data->>'handicapMode' as handicap_mode, d.data->>'ageBand' as age_band,
       coalesce(d.data->>'hand', d.data->>'handedness') as hand, (d.data->>'heightIn')::numeric as height_in,
       d.data->>'homeCourse' as home_course, d.data->>'goToClub' as go_to_club, d.data->>'system' as units,
       d.data->>'keys' as swing_keys, d.data->'routine' as routine, d.data->'roundRules' as round_rules,
       d.data->'mindPicture' as coach_picture, d.updated_at
from public.user_docs d
where d.kind = 'settings' and d.id = 'me' and not d.deleted;

-- ---------- the bag: one row per club, carries by swing length (yards) ----------
create or replace view public.golf_bag with (security_invoker = on) as
select d.user_id, b.ord::int as slot, b.v->>'club' as club,
       (b.v->>'carry')::numeric as carry_full, (b.v->>'total')::numeric as total_full,
       (b.v->>'three')::numeric as carry_three_quarter, (b.v->>'threeTotal')::numeric as total_three_quarter,
       (b.v->>'half')::numeric as carry_half, (b.v->>'halfTotal')::numeric as total_half
from public.user_docs d
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.data->'bag') = 'array' then d.data->'bag' else '[]' end) with ordinality as b(v, ord)
where d.kind = 'settings' and d.id = 'me' and not d.deleted and jsonb_typeof(b.v) = 'object';

-- ---------- Range work: what they're working on (and what they fixed) ----------
create or replace view public.golf_working_on with (security_invoker = on) as
select d.user_id, w.v->>'id' as item_id, w.v->>'title' as title, w.v->>'text' as working_on, w.v->>'why' as why,
       w.v->>'from' as source, w.v->'drills' as drills,
       case when w.v ? 'done' and w.v->>'done' is not null then to_timestamp((w.v->>'done')::double precision / 1000) end as fixed_at
from public.user_docs d
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.data->'workingOn') = 'array' then d.data->'workingOn' else '[]' end) as w(v)
where d.kind = 'settings' and d.id = 'me' and not d.deleted and jsonb_typeof(w.v) = 'object';

-- ---------- rounds they've scheduled (tee time as entered) ----------
create or replace view public.golf_scheduled_rounds with (security_invoker = on) as
select d.user_id, e.v->>'id' as event_id, to_timestamp((e.v->>'when')::double precision / 1000) as tee_time,
       e.v->>'courseName' as course_name, e.v->>'courseId' as course_id, e.v->>'who' as playing_with, e.v->>'note' as note
from public.user_docs d
cross join lateral jsonb_array_elements(case when jsonb_typeof(d.data->'events') = 'array' then d.data->'events' else '[]' end) as e(v)
where d.kind = 'settings' and d.id = 'me' and not d.deleted and jsonb_typeof(e.v) = 'object' and e.v->>'when' is not null;

-- ---------- single shots logged off the course (range, rangefinder, launch-monitor carries) ----------
create or replace view public.golf_shot_log with (security_invoker = on) as
select d.user_id, d.id as shot_id, to_timestamp(coalesce(d.data->>'date', d.data->>'at')::double precision / 1000) as hit_at,
       d.data->>'club' as club, (d.data->>'target')::numeric as target_yd, (d.data->>'result')::numeric as result_yd,
       (d.data->>'result')::numeric - (d.data->>'target')::numeric as long_short_yd,
       d.data->>'swing' as swing, d.data->>'dir' as direction, d.data->>'contact' as contact, d.data->>'shape' as shape,
       coalesce(d.data->>'source', 'manual') as source, (d.data->>'factor')::numeric as weather_factor, (d.data->>'norm')::numeric as still_air_yd,
       d.data->'cond' as conditions
from public.user_docs d
where d.kind = 'shot' and not d.deleted;

-- ---------- the coach's plan for them (one document) ----------
create or replace view public.golf_coach_plan with (security_invoker = on) as
select d.user_id, d.data as plan, d.updated_at
from public.user_docs d
where d.kind = 'plan' and d.id = 'me' and not d.deleted;

grant select on public.golf_courses, public.golf_course_holes, public.golf_rounds, public.golf_holes, public.golf_shots, public.golf_putts, public.golf_practice, public.golf_launch, public.golf_swing_checks,
  public.golf_profile, public.golf_bag, public.golf_working_on, public.golf_scheduled_rounds, public.golf_shot_log, public.golf_coach_plan to authenticated;

-- Examples
--   wedges by swing length:   select swing, count(*), avg((result in ('G','HO'))::int) from golf_shots where from_yd between 30 and 139 and lie <> 'tee' and source <> 'garmin' group by swing;
--   putts missed by the read: select read_break, missed_side, count(*) from golf_putts where not holed and missed_side is not null group by 1, 2;
--   doubles after a penalty:  select count(*) from golf_holes h join golf_shots s using (user_id, round_id, hole_no) where s.penalty and h.to_par >= 2;
--   range misses by club:     select club, avg(long_short_yd), count(*) from golf_shot_log where source <> 'launch' group by club;
--   R10 vs the course:        select l.club, avg((l.numbers->>'carry')::numeric) as r10_carry, b.carry_full from golf_launch l join golf_bag b using (user_id, club) group by l.club, b.carry_full;

# osolo data dictionary

Everything osolo stores about a golfer, where it lives, whether it syncs, and who reads it. The code's single source is `src/datamap.js`; `test/unit/datamap.test.js` fails if the app saves something that isn't listed here.

## How it's stored

- **On the phone first.** Records live in IndexedDB (database `golf-app`), settings in localStorage. Everything works offline.
- **Synced when signed in.** Each record is one row in Supabase `public.user_docs`: `(user_id, kind, id, data jsonb, deleted, updated_at)`. The newest `updatedAt` wins, and deletions sync as tombstones. Row-level security means a golfer only ever sees their own rows.
- **Analysed as tables.** `supabase/analytics.sql` turns those documents into relational views: one row per round, hole, shot, putt, club and so on. The views read straight from `user_docs`, so they're always current. They run with the caller's rights (`security_invoker`), so the security rules still apply.
- **Never synced:**
  - swing videos (they stay on the phone)
  - AI keys
  - the coach chat itself (Share sends a copy)
  - this phone's screen preferences

The structure is a tree with time, not a network: golfer → round → hole → shot or putt, and course → hole. Relational views fit that shape, so a graph database would add nothing.

## Records (one IndexedDB store each, synced as `user_docs.kind`)

| kind | store | what it is | views |
|---|---|---|---|
| `round` | rounds | a round: holes, every shot and putt, check-ins, conditions, heart rate | golf_rounds, golf_holes, golf_shots, golf_putts |
| `course` | courses | a course as the golfer plays it: tees, rating, slope, and par, yards and SI per hole | golf_courses, golf_course_holes |
| `swing` | swings | one swing video's analysis: checkpoints and measurements (the video stays on the phone) | golf_swing_checks |
| `shot` | shots | a single shot logged off the course: club, target, finish, swing, direction, contact, shape, weather | golf_shot_log |
| `session` | sessions | a practice session: drills, scores, reps, ratings | golf_practice |
| `launch` | launch | a launch-monitor session, one row per shot (bay photo, file, or the Garmin R10 live over Bluetooth: `source` 'Garmin R10', `live` true, rows with `computed` carry) | golf_launch |
| `settings` | localStorage | the golfer's settings (one doc, id `me`) | golf_profile, golf_bag, golf_working_on, golf_scheduled_rounds |
| `plan` | localStorage | the coach's plan for the golfer (one doc, id `me`) | golf_coach_plan |

### Round fields (the parts the coach and the engine use)

- **Round:**
  - `date`, `courseId`, `courseName`, `tees`, `kind` (comp or casual), `source` (osolo or garmin), `finished`, `quick` (score only)
  - `mood.start/turn/finish`, `energy`, `warmup`, `intention`, `intentionKept`, `aim`, `swingThought`, `expect`
  - `process.routine/commit/accept/fun`, `greens.firm/speed`, `cond.start` (temperature, humidity, wind), `hr`, `debrief`
- **Hole** (`holes[i]`): `score`, `putts`, `firstPutt`, `tee`, `gir`, `miss`, `shortSided`, `bunker`, `fpLong`, `fpSide`, `hr`, `at`
- **Shot** (`holes[i].shots[k]`):
  - `dist` (yards to the flag), `lie` or `lieAuto`
  - `res` (result), `res2`, `dir` (where it missed, measured from the flag), `ss` (short-sided), `pen`
  - `sw` (swing length), `src` (manual, laser or garmin), `t`
  - `d`: `club`, `strike`, `flight`, `cause`, `plan`, `sat`
- **Putt** (`holes[i].puttList[j]`): `ft`, `brk` (the read), `sl` (slope), `holed`, `mside` (missed left, centre or right), `mlen` (missed short or long)

## Settings

**Account settings** sync to the golfer's account, go in exports and are read by the coach:

- **Who they are:** `name`, `nickname`, `avatar`, `golfer` (their own swing story), `heightIn`, `hand`, `handedness`, `handicap`, `handicapMode`, `ageBand`, `homeCourse`, `onboarded`
- **The game:** `bag` (carries by swing length), `partials`, `competition`, `goToClub`, `keys` (swing keys), `workingOn` (Range work), `practicePlan`, `favDrills`, `routine`, `roundRules`, `mindPicture` (what the coach has learned about them), `metronome`
- **Courses, rounds and people:** `starredCourses`, `events` (scheduled rounds with tee times), `partners`, `mapLeave`, `mapDist`, `mapFirm`
- **Devices:** `laserProfiles`, `laserPaired`, `launchPaired` (the R10's name)
- **Preferences:** `system`, `theme`, `club`, `view`, `aiProvider`, `checklistHidden`

**This phone only** (not synced or exported): `quality`, `keepVideos`, `learning`, `playRate`, `showLines`, `cpStop`, `offlineCourses`, `progressKind`, `r10Club` (the last club picked on the R10 screen), and the model names chosen per AI.

**Never leave the phone:** `apiKey`, `openaiKey`, `geminiKey`.

## Other keys on the phone (localStorage)

| key | what | syncs |
|---|---|---|
| golf.settings | the settings above | the account part, as `settings:me` |
| golf.plan | the coach's plan | yes, as `plan:me` |
| golf.mindChat | the coach chat | no (Share sends a copy) |
| golf.mindFlow | where the current coach conversation is up to | no |
| golf.deleted | deletions waiting to sync | sent as tombstones |
| golf.lastSync, golf.owner, golf.auth | sync state and the sign-in session | no |
| golf.elev, golf.wxBackfill | elevation and weather caches | no |
| golf.summariesAt, golf.pendingInvite | friends: summaries published, an invite opened before sign-in | no |
| golf.installDismissed | install prompt dismissed | no |

## Analysis views (`supabase/analytics.sql`)

| view | one row per | key columns |
|---|---|---|
| golf_profile | golfer | name, handicap, handicap_mode, age_band, hand, height_in, home_course, go_to_club, swing_keys, routine, round_rules, coach_picture |
| golf_bag | club | club, carry_full, total_full, carry_three_quarter, carry_half |
| golf_working_on | Range work item | title, working_on, why, drills, fixed_at |
| golf_scheduled_rounds | scheduled round | tee_time, course_name, playing_with, note |
| golf_coach_plan | golfer | plan (json) |
| golf_courses | course | name, tees, rating, slope, holes |
| golf_course_holes | course hole | hole_no, par, yards, stroke_index |
| golf_rounds | round | played_at, course, kind, finished, mood, energy, process ratings, greens, weather, heart rate |
| golf_holes | hole played | score, to_par, putts, first_putt_ft, tee_result, gir, approach_miss, short_sided |
| golf_shots | stroke before the green | lie, from_yd, result, miss_from_flag, swing, club, strike, cause, source |
| golf_putts | putt | from_ft, read_break, read_slope, holed, missed_side, missed_length |
| golf_shot_log | single logged shot | club, target_yd, result_yd, long_short_yd, swing, direction, contact, shape, source, still_air_yd |
| golf_practice | practice item | session, mode, item, drill_id, score, attempts, reps, rating |
| golf_launch | launch-monitor shot | club, ball, source, numbers (carry, speeds, spin, launch, face, path…) |
| golf_swing_checks | swing checkpoint item | club, camera, checkpoint, item, status, you vs reference |

## Who reads what

- **The app's analysis engine** (`src/coach/engine.js`, `leak.js`, `level.js`, `sg.js`, `tiger.js`, `stats.js`): finished rounds that count, every shot and putt with its context, the bag, and the benchmarks for their handicap and age band.
- **The AI coach chat** (`src/coach/mindchat.js`), all as text the app computes:
  - the analysis above
  - their profile, routine, round rules and what it has learned about them
  - Range work, drills and practice sessions
  - swing analyses and launch-monitor numbers
  - rounds scheduled in the app, with the tee time they entered
- **The swing coach** (video review): their swing keys and story, Range work, practice, drills, launch-monitor numbers.
- **A real coach, later:** a grant on these views (read-only), never a second copy of the data.

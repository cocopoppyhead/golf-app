# osolo

A golf app for people who like proper stats: swing coach, rounds logged shot by shot with strokes gained and the Tiger 5, hole maps, the Bushnell loop (laser lock-on → shot card), practice with purpose, a WHS handicap.

Live: https://cocopoppyhead.github.io/golf-app/ (private beta; noindex). Native shell for iPhone/Android in `native/`.

## Running it

```
npm ci
npm run dev            # Vite dev server
npm run lint           # ESLint
npm run test:unit      # vitest: maths and data checks (fast)
npm run test:e2e       # Playwright against the built app (needs `npx playwright install chromium` once)
npm run build          # dist/ — GitHub Pages deploys this on every push to main
```

CI (`.github/workflows/ci.yml`) runs lint, unit tests, the build and the end-to-end suite on every push and pull request; `deploy.yml` publishes `dist/` to GitHub Pages. The native app loads the published site, so a push to main updates the installed app too; `native/` changes need an EAS build.

Secrets: none in this repo. The Supabase publishable key is public by design; the secret key is never used. AI keys (Claude / OpenAI / Gemini) are typed by the user and stay on the phone. Personal data (yardages, swing story, scores) is imported from JSON files or synced per account, never committed.

## Architecture

Vanilla JS ES modules, no framework. One Vite PWA; state is local-first (localStorage for settings, IndexedDB for swings / rounds / courses / shots / sessions) with optional sync to Supabase (`src/cloud/`). Every screen is a function that renders into a root element and binds its own handlers.

```
index.html, src/main.js      tabs (Play · Practice · Progress · Bag · Settings), routing, AI coach panel
src/store.js                  settings + IndexedDB + change tracking for sync
src/cloud/                    Supabase auth, sync, account sheet
src/units.js                  yards/inches ⇄ metres/cm (everything is stored in yards)
src/geo.js                    lat/lon maths shared by the maps, the laser loop and the OSM build (tested)
src/weather.js                Open-Meteo conditions, wind components, carry factor, plays-like
src/bag.js, src/shots.js      the bag: typed carries blended with saved shots, club pick, range work
src/laser.js, src/laserlearn.js  rangefinder packets (Bushnell protocol, teach mode for others)
src/native.js                 bridge to the Expo shell (BLE, share, open URL, notifications)
src/rounds/
  ui.js                       Play tab, hole screen, summaries, post a score, scorecard import
  course.js                   course cards, course page, scheduling, tee picker, scorecard
  holemap.js                  hole map (tiles + OSM shapes + club arcs), mark-a-hole, course hero
  laserloop.js                the Bushnell loop: lock-on → shot card, GPS per read, hole advance
  library.js                  bundled UAE course library (public/courses/uae.json)
  stats.js, sg.js, tiger.js, handicap.js   pure maths (tested)
src/practice.js, src/drills.js, src/workingon.js   practice sessions, drill library, working-on points
src/progress.js               handicap, scoring history, putting, activity
src/coach/                    swing coach: pose (MediaPipe), checkpoints, rendering, AI review
public/courses/uae.json       scorecards: par, SI, tees with lengths, rating/slope, centre
public/courses/osm/<id>.json  per-course geometry built from OpenStreetMap (see below)
scripts/osm/                  pull.py (Overpass) + build.mjs → public/courses/osm
test/unit, test/e2e           vitest and Playwright
native/                       Expo SDK 58 WebView shell: BLE, background shot notifications, sharing
supabase/schema.sql           tables + policies, safe to re-run
```

### Data shapes worth knowing

- **Round**: `{ id, date, courseId, courseName, tees, holes: [hole|null], players: [{ name, scores[], putts[] }], cond: { start, finish }, mood, quick?, score?, finished }`.
- **Hole**: `{ score, putts, firstPutt, tee, miss, shots: [{ lie, dist, plays?, src: 'laser'|'manual'|'club'|'card', gps?, target?, d: { club, swing, … } }], tags, note }`. Shot 0 is the tee shot.
- **Course** (local): `{ id, libId?, name, tees, rating, slope, lat, lon, holes: [{ par, si, yds, green?, mark?: { tee, green } }] }`. One local course per tee set; `libId` groups them.
- **Course geometry** (`public/courses/osm/<id>.json`): `{ holes: [{ n, par, line: [[lat,lon]…], tees: [{ c, poly, m }], green: { c, f, b, poly, depth } }], bunkers / water / fairways: [{ h, c, poly }], extraGreens, outline }`.

### Course maps

OpenStreetMap is the free source. `scripts/osm/pull.py <raw-dir>` pulls everything tagged `golf=*` around each library course from Overpass (run it from a normal network; it is resumable and the public servers are often overloaded). `node scripts/osm/build.mjs <raw-dir>` assigns holes to courses (rules in the script for sites that share ground), attaches greens, tees, bunkers, water and fairways to hole lines and writes the compact per-course files. Imagery is Esri World Imagery (attribution shown in the app). Courses OSM hasn't mapped can be marked in the app: two taps per hole on the satellite image.

## Conventions

- Keep modules pure where possible; DOM only in the render functions. Maths goes in a module with a unit test.
- Distances are yards internally; convert at the edge with `src/units.js`.
- A new persisted field goes in three places: the IndexedDB store (`store.js`), sync (`cloud/sync.js` KINDS / SETTINGS_KEYS) and backup (`backup.js` KEEP).
- Commit messages say what changed for the golfer, not which files moved.

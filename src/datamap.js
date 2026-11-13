// Where every piece of a golfer's data lives, in one place. sync.js and backup.js read their lists from
// here, and test/unit/datamap.test.js fails if the app starts saving a setting that isn't listed below,
// so nothing new can quietly stay on one phone or, worse, leave it. The full data dictionary, with every
// field and the analysis views, is docs/DATA.md.

/** Settings that belong to the golfer: synced to their account, kept in exports, read by the coach. */
export const ACCOUNT_SETTINGS = [
  // who they are
  'name', 'nickname', 'avatar', 'golfer', 'heightIn', 'hand', 'handedness', 'handicap', 'handicapMode', 'ageBand', 'homeCourse', 'onboarded',
  // the game: bag, swing keys, what they're working on, practice, routine
  'bag', 'partials', 'competition', 'goToClub', 'keys', 'workingOn', 'practicePlan', 'favDrills', 'routine', 'roundRules', 'mindPicture', 'metronome',
  // courses, rounds and people
  'starredCourses', 'events', 'partners', 'mapLeave', 'mapDist', 'mapFirm',
  // devices they've paired and taught (the laser's sounds, the R10's name)
  'laserProfiles', 'laserPaired', 'launchPaired',
  // how they like the app
  'system', 'theme', 'club', 'view', 'aiProvider', 'checklistHidden',
];

/** Settings for this phone only: screen and video preferences, offline caches. Not synced, not exported. */
export const DEVICE_SETTINGS = ['quality', 'keepVideos', 'learning', 'playRate', 'showLines', 'cpStop', 'offlineCourses', 'progressKind', 'r10Club', 'model', 'openaiModel', 'geminiModel'];

/** Never leave the phone: not synced, not exported, not shared. */
export const SECRET_SETTINGS = ['apiKey', 'openaiKey', 'geminiKey'];

/** Records: one IndexedDB store each, synced as user_docs of that kind (videos excepted). */
export const RECORD_KINDS = {
  round: { store: 'rounds', what: 'a round: holes, every shot and putt, check-ins, conditions, heart rate', views: ['golf_rounds', 'golf_holes', 'golf_shots', 'golf_putts'] },
  course: { store: 'courses', what: 'a course as the golfer plays it: tees, rating, slope, par/yards/SI per hole', views: ['golf_courses', 'golf_course_holes'] },
  swing: { store: 'swings', what: 'one swing video\'s analysis: checkpoints and measurements (the video stays on the phone)', views: ['golf_swing_checks'] },
  shot: { store: 'shots', what: 'a single shot logged off the course: club, target, where it finished, swing, direction, contact, shape, weather', views: ['golf_shot_log'] },
  session: { store: 'sessions', what: 'a practice session: drills done, scores, reps, ratings', views: ['golf_practice'] },
  launch: { store: 'launch', what: 'a launch-monitor session: one row per shot (from a bay photo, a file or the R10)', views: ['golf_launch'] },
};

/** Local-only keys outside settings (localStorage): what they are and whether they sync. */
export const LOCAL_KEYS = {
  'golf.settings': 'the settings above (account part syncs as the settings:me doc)',
  'golf.plan': 'the coach\'s plan for the golfer: syncs as plan:me',
  'golf.mindChat': 'the coach chat itself: stays on the phone (Share sends a copy)',
  'golf.mindFlow': 'where the current coach conversation is up to',
  'golf.deleted': 'deletions waiting to sync',
  'golf.lastSync': 'when this phone last synced', 'golf.owner': 'whose data is on this phone', 'golf.auth': 'the sign-in session',
  'golf.elev': 'elevation cache', 'golf.wxBackfill': 'weather backfill done', 'golf.summariesAt': 'friends\' summaries published',
  'golf.pendingInvite': 'an invite link opened before signing in', 'golf.installDismissed': 'install prompt dismissed',
};

/** Pick the account settings out of a settings object (for sync and export). */
export const accountPart = (s) => Object.fromEntries(ACCOUNT_SETTINGS.filter((k) => s[k] != null).map((k) => [k, s[k]]));

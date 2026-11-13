// Export / import everything (except videos) as one JSON file. Also how a golfer's own
// numbers and notes are loaded without putting them in the app's public code.
import { getSettings, saveSettings, listSwings, putSwing, listRounds, putRound, listCourses, putCourse, listShots, putShot, putSession, listSessions, listLaunch, putLaunch } from './store.js';

import { ACCOUNT_SETTINGS } from './datamap.js';

const KEEP = ACCOUNT_SETTINGS; // the golfer's settings (src/datamap.js); keys and device preferences stay out

export async function exportData() {
  const s = getSettings();
  const data = {
    app: 'golf-coach', version: 1, exported: new Date().toISOString(),
    settings: Object.fromEntries(KEEP.filter((k) => s[k] != null).map((k) => [k, s[k]])),
    plan: JSON.parse(localStorage.getItem('golf.plan') || 'null'),
    swings: await listSwings(), rounds: await listRounds(), courses: await listCourses(), shots: await listShots(), sessions: await listSessions(), launch: await listLaunch(),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** Merges: settings from the file win; records are added or updated by id. */
export async function importData(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (d.app !== 'golf-coach') throw new Error('That isn\'t a Golf Coach data file.');
  const s = getSettings();
  for (const k of KEEP) if (d.settings?.[k] != null) s[k] = d.settings[k];
  saveSettings(s);
  if (d.plan && !localStorage.getItem('golf.plan')) localStorage.setItem('golf.plan', JSON.stringify(d.plan));
  let n = 0;
  for (const [list, put] of [[d.swings, putSwing], [d.rounds, putRound], [d.courses, putCourse], [d.shots, putShot], [d.sessions, putSession], [d.launch, putLaunch]]) for (const x of list || []) { await put(x); n++; }
  return { settings: Object.keys(d.settings || {}), records: n };
}

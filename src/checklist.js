// Getting started: the five things that make the app useful, ticked off as they happen.
// Shown on the Play tab until all are done or the golfer hides it.
import { getSettings, saveSettings, listCourses, listRounds, listSwings } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function checklistItems() {
  const s = getSettings();
  const [courses, rounds, swings] = await Promise.all([listCourses().catch(() => []), listRounds().catch(() => []), listSwings().catch(() => [])]);
  const bag = Array.isArray(s.bag) ? s.bag : [];
  return [
    { id: 'course', label: 'Add your course', detail: 'The scorecard, the map and your tees fill in from the library.', done: courses.length > 0, go: 'library' },
    { id: 'bag', label: 'Put carries in your bag', detail: 'Full-swing numbers for 4+ clubs. The hole map, the laser shot card and the club pick all use them.', done: bag.filter((c) => c.carry > 0).length >= 4, go: 'bag' },
    { id: 'laser', label: 'Connect the rangefinder', detail: 'Bushnell: pair once with the eyepiece PIN. Then every lock-on is a shot.', done: !!s.laserPaired || Object.keys(s.laserProfiles || {}).length > 0, go: 'settings' },
    { id: 'round', label: 'Log or post a round', detail: 'Hole by hole for strokes gained and the Tiger 5, or just the score for the handicap.', done: rounds.some((r) => r.finished), go: 'play' },
    { id: 'swing', label: 'Check a swing', detail: 'Film face-on, 3–4 m away, hip height. Takes a minute.', done: swings.length > 0, go: 'coach' },
  ];
}

/** Renders into el; onGo(where) navigates. Returns true when it drew something. */
export async function renderChecklist(el, { onGo = () => {} } = {}) {
  const s = getSettings();
  if (!el || s.checklistHidden) { if (el) el.innerHTML = ''; return false; }
  const items = await checklistItems();
  const done = items.filter((x) => x.done).length;
  if (done === items.length) { el.innerHTML = ''; return false; }
  el.innerHTML = `<div class="card gs"><div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Getting started</h2><span class="mute small">${done} of ${items.length}</span></div>
    <div class="gsbar"><i style="width:${(100 * done) / items.length}%"></i></div>
    ${items.map((x) => `<button class="gsrow ${x.done ? 'done' : ''}" data-go="${x.go}" ${x.done ? 'disabled' : ''}><span class="gsc">${x.done ? '✓' : ''}</span><span><b>${esc(x.label)}</b>${x.done ? '' : `<span class="mute small">${esc(x.detail)}</span>`}</span><span class="mute">${x.done ? '' : '›'}</span></button>`).join('')}
    <button class="link mute small" data-hide style="margin-top:6px">Hide this</button></div>`;
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => onGo(b.dataset.go));
  el.querySelector('[data-hide]').onclick = () => { const s2 = getSettings(); s2.checklistHidden = true; saveSettings(s2); el.innerHTML = ''; };
  return true;
}

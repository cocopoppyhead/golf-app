// Rounds module UI: courses, hole-by-hole logging (Conor's shot codes), scorecard photo import, summaries.
import { CODES, roundStats, aggregate, pct, played } from './stats.js';
import { openLibrary, loadLibrary } from './library.js';
import { getConditions, conditionsAt } from '../weather.js';
import { heroHtml, fillWeather, clubName, whereAmI, placeHero } from './hero.js';
import { getSettings as S0, saveSettings as S1 } from '../store.js';

import { putRound, getRound, deleteRound, listRounds, putCourse, getCourse, listCourses, deleteCourse, listSwings } from '../store.js';
import { readCard, aiFrom, aiReady } from '../coach/ai.js';

import { dist, toYards, du, duLong, puttBand } from '../units.js';

import { holeSG } from './sg.js';
import { initLaserLoop, syncLoopConfig } from './laserloop.js';
import { getBag, resolveClub } from '../bag.js';
import { listShots } from '../store.js';



import { loadGeo, geoHole, mountHoleMap, markedHole, markHoleSheet } from './holemap.js';
import { renderChecklist } from '../checklist.js';
import { icon } from '../icons.js';
import { approachBands } from './bands.js';
import { INTENTIONS, intentionLabel, WARMUP, ENERGY, MOOD_WORDS } from './intentions.js';
import { getRoutine, routineHtml } from './routine.js';
import { planSheet } from '../mygame.js';
import { lastBestHere } from './bestshots.js';
export { MOOD_WORDS, moodLine } from './intentions.js';
import { weeklyDigest } from '../digest.js';
import { listSessions } from '../store.js';
import { drillsLoaded } from '../drills.js';
import { LIE_DETAIL, PENALTY_RES, TROUBLE_OPTIONS, troubleCodes, ensurePutts, syncPutts, asPlanned, autoSwing, autoShotType, blankHole, ensureShots, defaultLie, derive, nextBogeyFrom, holeGaps } from './hole.js';
import { shotPanel, shotLine, puttPanel, holeDone, routeStrip, zoneOf, usualTeeClub, clubForDistance } from './shotpanel.js';
export { SWING_TYPES, INTENT, autoShotType } from './hole.js';
import { inviteSheet } from './friends.js';
import { checkinHtml, lastNote } from './checkin.js';
import { inviteLink, remoteEvents, removeSummary, takePendingInvite, joinEvent, addFriendByCode } from '../cloud/social.js';
import { currentUser } from '../cloud/supabase.js';
import { groupCourses, courseCardsHtml, bindCourseCards, coursePage, events, fmtWhen, scheduleSheet, eventCalendar } from './course.js';
import { initScoreImport, postScore, importCard, quickSummary, shrink } from './scoreimport.js';
import { initSummary, renderSummary, playersSheet } from './summary.js';
export { sgCard } from './summary.js';


const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const toParStr = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

let ctx = { settings: () => ({}), toast: () => {} };
let root;
let cur = null; // { round, course, hole, review }
let holeMap = null; // the mounted hole map (holemap.js), rebuilt with each hole render
const expandedShots = new Set(); // 'hole:shot' panels the golfer opened again after logging
const clubOpenSet = new Set(); // 'hole:shot' panels showing the whole bag
// the club you usually hit off each tee on this course (from earlier rounds), loaded once per round
let teeHist = { id: null, rounds: null };
function teeUsual(round, course, i) {
  if (teeHist.id !== round.id) { teeHist = { id: round.id, rounds: null }; listRounds().then((rs) => { if (teeHist.id === round.id) { teeHist.rounds = rs; if (cur?.round === round && root?.isConnected) renderHole(); } }).catch(() => {}); }
  return teeHist.rounds ? usualTeeClub(teeHist.rounds, course.id, i, { exclude: round.id }) : null;
}
let clubsCache = { t: 0, list: [] };
/** Your clubs with resolved carries (typed + learned), for the hole map arcs. Cached for a minute. */
async function effectiveClubs() {
  if (Date.now() - clubsCache.t < 60000) return clubsCache.list;
  const shots = await listShots().catch(() => []);
  clubsCache = { t: Date.now(), list: getBag().map((c) => resolveClub(c, shots)).filter((c) => c.carry > 0).map((c) => ({ club: c.club, carry: c.carry, total: c.total > 0 ? c.total : null })) };
  return clubsCache.list;
}

export function initRounds(el, opts) {
  root = el; ctx = { ...ctx, ...opts };
  initScoreImport({ get root() { return root; }, get ctx() { return ctx; }, home: roundsHome, summary: renderSummary, review: (r, c, hole) => { cur = { round: r, course: c, hole, review: true }; renderHole(); } });
  initSummary({ get root() { return root; }, get ctx() { return ctx; }, home: roundsHome, aggStats, setCur: (r, c) => { cur = { round: r, course: c, hole: 0, review: false }; }, reopen: (r, c, hole = 0) => { cur = { round: r, course: c, hole, review: false }; renderHole(); }, submit: (r, c) => endRound(r, c, { submit: true }) });
}

// ---------------- Rangefinder → shot card ----------------
// Each lock-on during an open round becomes a shot with distance, plays-like, suggested club and a GPS
// fix, shown on a card the moment it arrives (rounds/laserloop.js). GPS decides when you've moved on.
initLaserLoop({ getCur: () => cur, toast: (t) => ctx.toast?.(t), renderHole: () => { if (cur && root?.isConnected) renderHole(); }, blankHole: () => blankHole(), ensureShots });

// ---------------- Home ----------------
export async function roundsHome() {
  cur = null;
  const [rounds, allCourses] = await Promise.all([listRounds().catch(() => []), listCourses().catch(() => [])]);
  const open = rounds.find((r) => !r.finished);
  const done = rounds.filter((r) => r.finished);
  await aggStats(done); // attaches per-round stats for the list
  const groups = groupCourses(allCourses), upcoming = events().slice(0, 3);
  const lastOf = (g) => Math.max(0, ...g.variants.map((c) => c.lastPlayed || 0));
  const recent = [...groups].sort((a, b) => lastOf(b) - lastOf(a));
  const endOfDay = new Date().setHours(23, 59, 59, 999);
  const today = open ? null : upcoming.find((e) => e.when <= endOfDay && e.when >= Date.now() - 3 * 3600e3) || null;
  const me = (S0().nickname || S0().name || '').split(' ')[0];
  const gs = '<div id="gettingStarted"></div>';
  root.innerHTML = `
    ${open ? `<div class="card event-card"><b>Round in progress</b><p class="mute small">${esc(open.courseName)} · ${fmtD(open.date)} · ${played(open).length} holes logged</p><div class="row"><button class="btn primary" data-act="resume" data-id="${open.id}">Resume round</button><button class="btn" data-act="endopen" data-id="${open.id}">End / discard</button></div></div>` : ''}
    ${open ? '' : heroHtml({ name: me, groups: recent, today })}
    ${done.length ? '' : gs}
    ${upcoming.length ? `<div class="sechead"><h2>Upcoming</h2></div><div class="card upcoming">${upcoming.map(upcomingRow).join('')}</div>` : ''}
    ${checkinHtml(S0(), lastNote(done))}
    <div class="sechead"><h2>Your courses</h2><button class="link acc" data-act="library">+ Find a course</button></div>
    ${groups.length ? courseCardsHtml(groups, rounds) : `<div class="card"><p class="mute">Pick your course from the UAE list and the scorecard, map and tees fill in. Tap a course for its page: start or schedule a round, preview the holes, your record there.</p><button class="btn primary big" data-act="library">${icon('search')} Find a UAE course</button></div>`}
    <p class="small mute addhand">Course not in the list? <button class="link" data-act="newcourse">Add it by hand</button></p>
    <div class="row2 playacts"><button class="btn" data-act="post">${icon('plus')} Post a score</button><button class="btn" data-act="import">${icon('camera')} Scan a scorecard</button></div>
    ${await digestCard(done)}
    ${done.length ? `<div class="sechead"><h2>Previous rounds</h2>${done.length > SHOW_ROUNDS ? `<button class="link acc" data-act="allrounds">All ${done.length}</button>` : ''}</div>${done.slice(0, SHOW_ROUNDS).map(histRow).join('')}` : ''}
    ${done.length ? gs : ''}`;
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => homeAction(b.dataset.act, b.dataset.id)));
  bindCourseCards(root, groups, courseApi());
  if (!open) heroWeather(recent, me);
  handlePendingInvite();
  mergeRemoteEvents().then((changed) => { if (changed && root?.querySelector('.checkin') && !cur) roundsHome(); });
  renderChecklist(root.querySelector('#gettingStarted'), { onGo: (where) => (where === 'library' ? homeAction('library') : where === 'play' ? (groups.length ? coursePage(groups[0], courseApi()) : homeAction('library')) : ctx.showTab?.(where)) });
}
/**
 * The live sky and where you are. Location is only read when it's already allowed (never asked for from
 * Play): travelling, the tiles make way for "Find a course near you" and the weather is where you are;
 * at one of your courses, it goes first. Otherwise the weather is at your most recent course.
 */
async function heroWeather(recent, name) {
  try {
    const lib = await loadLibrary().catch(() => []);
    const coords = (g) => { const v = g.variants.find((c) => c.lat != null); const l = lib.find((x) => x.id === g.libId); return { group: g, lat: v?.lat ?? l?.lat ?? null, lon: v?.lon ?? l?.lon ?? null }; };
    const all = recent.map(coords);
    let here = null;
    if ((await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null))?.state === 'granted') {
      here = await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res([p.coords.latitude, p.coords.longitude]), () => res(null), { timeout: 6000, maximumAge: 10 * 60e3 }));
    }
    const where = whereAmI(here, all);
    if (!root?.isConnected) return;
    if (placeHero(root, where, recent)) bindCourseCards(root, recent, courseApi());
    const spot = where.mode === 'home' ? all.find((c) => c.lat != null) : where.mode === 'at' ? all.find((c) => c.group === where.at) : null;
    let cond = null, place = '';
    if (spot) { cond = await conditionsAt(spot.lat, spot.lon); place = clubName(spot.group.name); }
    else if (here) cond = await conditionsAt(here[0], here[1]);
    if (root?.isConnected) fillWeather(root, cond, { name, place });
  } catch { /* the line stays "Fancy a game?" */ }
}
/** One scheduled round: the course, when and who, Start, and the smaller actions underneath. */
function upcomingRow(e) {
  const when = new Date(e.when).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `<div class="evrow"><div class="evtx"><b>${esc(e.courseName)}</b><div class="mute small">${when}${e.who ? `, with ${esc(e.who)}` : ''}${e.note ? `. ${esc(e.note)}` : ''}</div>
    <div class="evlinks">${e.code ? `<button class="link" data-act="evinvite" data-id="${e.id}">Invite</button>` : ''}<button class="link" data-act="evcal" data-id="${e.id}">Add to calendar</button><button class="link" data-act="evedit" data-id="${e.id}">${e.joined ? 'Leave' : 'Edit'}</button></div></div>
    <button class="btn primary sm" data-act="evstart" data-id="${e.id}">Start</button></div>`;
}
/** Settings → Import data → Scorecard photo. */
export const openCardImport = () => importCard(null);
const SHOW_ROUNDS = 5;
/** One line in a rounds list: score, course, date, the round's numbers. */
function histRow(r) {
  const s = r._stats;
  return `<div class="hist" data-act="open" data-id="${r.id}"><div class="sc">${s ? s.score : '–'}</div><div><div class="t">${esc(r.courseName)} ${s ? `<span class="mute">${toParStr(s.toPar)}</span>` : ''}</div><div class="s">${fmtD(r.date)}${r.quick ? `${r.tees ? ` · ${esc(r.tees)}` : ''}${r.diff != null ? ` · diff ${r.diff.toFixed(1)}` : ''} · score only` : s ? `${s.puttsHoles ? ` · ${s.putts} putts` : ''}${s.firOpp ? ` · FIR ${pct(s.fir, s.firOpp)}%` : ''}${s.girOpp && s.puttsHoles ? ` · GIR ${pct(s.gir, s.girOpp)}%` : ''}${r.source === 'garmin' ? ' · Garmin' : ''}` : ''}${r.learning === false ? ' · not counted' : ''}${r.submitted === false ? ' · <span class="acc">details to finish</span>' : ''}</div></div><div class="mute">›</div></div>`;
}

/** Every finished round, filterable by course and by when. */
async function allRoundsSheet() {
  const done = (await listRounds().catch(() => [])).filter((r) => r.finished);
  await aggStats(done);
  const courses = [...new Map(done.map((r) => [r.courseName, r.courseName])).values()].sort((a, b) => a.localeCompare(b));
  const years = [...new Set(done.map((r) => new Date(r.date).getFullYear()))].sort((a, b) => b - a);
  const WHEN = [['all', 'Any time'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months'], ...years.map((y) => [`y${y}`, String(y)])];
  let course = '', when = 'all';
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet allrounds';
  const rows = () => done.filter((r) => (!course || r.courseName === course) && (when === 'all' || (when[0] === 'y' ? new Date(r.date).getFullYear() === +when.slice(1) : Date.now() - r.date <= +when * 864e5)));
  const list = () => { const L = rows(); return `<p class="mute small" style="margin:0 0 6px">${L.length} round${L.length === 1 ? '' : 's'}</p>${L.map(histRow).join('') || '<p class="mute">No rounds match.</p>'}`; };
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>All rounds</b><button class="link" data-close>Close</button></div>
    <div class="row2 arf"><label class="small">Course<select data-course><option value="">All courses</option>${courses.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="small">When<select data-when>${WHEN.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div>
    <div class="arlist">${list()}</div></div>`;
  const redraw = () => { sheet.querySelector('.arlist').innerHTML = list(); };
  sheet.querySelector('[data-course]').onchange = (e) => { course = e.target.value; redraw(); };
  sheet.querySelector('[data-when]').onchange = (e) => { when = e.target.value; redraw(); };
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.addEventListener('click', (e) => { const h = e.target.closest('.hist[data-id]'); if (h) { sheet.remove(); openRound(h.dataset.id); } });
  document.body.appendChild(sheet);
}

/** This week against last: rounds, where the strokes went, practice, intention. Hidden when the fortnight is empty. */
async function digestCard(done) {
  try {
    const withCourse = [];
    for (const r of done.filter((r) => Date.now() - r.date < 15 * 864e5 || (r.intention && r.intentionKept))) { const c = await getCourse(r.courseId).catch(() => null); if (c) withCourse.push({ r, c }); }
    const [sessions, swings] = await Promise.all([listSessions().catch(() => []), listSwings().catch(() => [])]);
    const d = weeklyDigest({ rounds: withCourse, sessions, swings, lib: drillsLoaded() });
    if (!d) return '';
    return `<div class="sechead"><h2>This week</h2><span class="mute small">against the week before</span></div><div class="card digest">
      ${d.lines.map((l) => `<p class="dl ${l.key}">${esc(l.text)}</p>`).join('')}
      ${d.carry.length ? `<div class="lbl">Carry into next week</div><ul class="carry">${d.carry.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
  } catch (e) { console.warn('digest', e); return ''; }
}
/** Rounds friends invited me to (and my own, for their codes) come from the server into the local list. */
async function mergeRemoteEvents() {
  const u = await currentUser().catch(() => null); if (!u) return false;
  const remote = await remoteEvents().catch(() => []);
  const s = S0(); const list = s.events || []; let changed = false;
  for (const e of remote) {
    const local = list.find((x) => x.remoteId === e.id);
    if (local) { if (local.when !== new Date(e.starts_at).getTime() || local.note !== e.note) { local.when = new Date(e.starts_at).getTime(); local.note = e.note; changed = true; } continue; }
    if (e.mine) continue; // my own events are already local (created there)
    list.push({ id: `ev_${e.id.slice(0, 8)}`, remoteId: e.id, code: e.invite_code, joined: true, libId: e.course_lib_id, courseId: null, courseName: e.course_name, when: new Date(e.starts_at).getTime(), who: '', note: e.note || '' }); changed = true;
  }
  if (changed) { s.events = list; S1(s); }
  return changed;
}
/** A ?join= or ?friend= link that arrived while signed out gets acted on here, once signed in. */
async function handlePendingInvite() {
  const u = await currentUser().catch(() => null); if (!u) return;
  const inv = takePendingInvite(); if (!inv) return;
  try {
    if (inv.kind === 'friend') { const p = await addFriendByCode(inv.code); ctx.toast(`You and ${p.nickname || p.name || 'your friend'} are friends now.`); }
    else { const ev = await joinEvent(inv.code, S0().nickname || S0().name || ''); ctx.toast(`You're in: ${ev.course_name}`); await mergeRemoteEvents(); }
    roundsHome();
  } catch (e) { ctx.toast(e.message || 'That invite didn\'t work.'); }
}
/** What the course page needs from here. */
const courseApi = () => ({ root, toast: ctx.toast, startRound, openRound, editCourse, back: roundsHome, clubs: effectiveClubs, bestBand: bestBandCached });
export async function openCoursePage(courseId) {
  const groups = groupCourses(await listCourses().catch(() => []));
  const g = groups.find((x) => x.variants.some((c) => c.id === courseId));
  return g ? coursePage(g, courseApi()) : roundsHome();
}

async function aggStats(rounds) {
  const list = [];
  for (const r of rounds) {
    const c = await getCourse(r.courseId).catch(() => null);
    if (!c) continue;
    r._stats = roundStats(r, c);
    list.push({ round: r, course: c, stats: r._stats });
  }
  const A = aggregate(list);
  if (A) A.debriefs = list.filter((x) => x.round.debrief?.notes || x.round.debrief?.tags?.length || x.round.debrief?.again).slice(0, 5)
    .map((x) => `${new Date(x.round.date).toDateString()} ${x.course.name} ${x.stats.score}: ${[...(x.round.debrief.tags || []), x.round.debrief.notes, x.round.debrief.again ? `would do differently: ${x.round.debrief.again}` : null, x.round.intention ? `intention “${intentionLabel(x.round.intention)}”${x.round.intentionKept ? ` kept ${x.round.intentionKept}/5` : ''}` : null].filter(Boolean).join('; ')}`);
  return A;
}

async function homeAction(act, id) {
  if (act === 'progress') return ctx.showTab?.('history');
  const sel = root.querySelector('#courseSel')?.value;
  if (act === 'endopen') { const r = await getRound(id); const c = await getCourse(r.courseId).catch(() => null); cur = { round: r, course: c, hole: 0, review: false }; return played(r).length && c ? endRoundSheet(r, c) : discardSheet(r); }
  if (act === 'resume' || act === 'open') return openRound(id);
  if (act === 'allrounds') return allRoundsSheet();
  if (act === 'plan') return planSheet({ done: roundsHome });
  if (act === 'mind') return import('../coach/mindchat.js').then((m) => m.openMindChat({ onSettings: () => ctx.showTab?.('settings') }));
  if (act === 'newcourse') return editCourse(null);
  if (act === 'library') return openLibrary({ toast: ctx.toast, onPicked: (c) => openCoursePage(c.id) });
  if (act === 'editcourse') return editCourse(sel);
  if (act === 'start') return startRound(await getCourse(sel));
  if (act === 'evstart') {
    const e = events().find((x) => x.id === id); let c = e?.courseId && (await getCourse(e.courseId).catch(() => null));
    if (!c && e?.libId) c = (await listCourses().catch(() => [])).find((x) => x.libId === e.libId) || null;
    if (!c && e?.libId) { const lib = (await loadLibrary()).find((x) => x.id === e.libId); if (lib) { const { importCourse } = await import('./library.js'); c = await importCourse(lib, lib.tees?.[0] || null); } }
    if (!c) return ctx.toast('Add the course first (Find a course), then start from here.');
    return startRound(c, e);
  }
  if (act === 'evcal') { const e = events().find((x) => x.id === id); if (e) eventCalendar(e); return; }
  if (act === 'evinvite') { const e = events().find((x) => x.id === id); if (e?.code) inviteSheet({ title: `${e.courseName} · ${fmtWhen(e.when)}`, link: inviteLink('join', e.code), code: e.code, blurb: 'Whoever opens this (signed in to osolo) joins the round and becomes your friend.' }); return; }
  if (act === 'evedit') { const e = events().find((x) => x.id === id); if (e?.joined) { const s = S0(); s.events = (s.events || []).filter((x) => x.id !== e.id); S1(s); return roundsHome(); } const groups = groupCourses(await listCourses().catch(() => [])); const g = groups.find((x) => (e.libId ? x.libId === e.libId : x.variants.some((c) => c.id === e.courseId))); if (g) scheduleSheet(g, { toast: ctx.toast, done: roundsHome, existing: e }); return; }
  if (act === 'import') return importCard(sel);
  if (act === 'post') return postScore(sel);
}

// ---------------- Previous plays of this hole ----------------
let histCache = { key: '', rows: null };
let histFilter = 'all';
const RES_WORD = { FW: 'fairway', G: 'green', HO: 'holed', L: 'left', R: 'right', LL: 'way left', RR: 'way right', S: 'short', LO: 'long', B: 'bunker', PN: 'penalty', FB: 'fairway bunker', W: 'water', OB: 'OB', T: 'trees', RF: 'rough' };
/** Every earlier play of hole i on any tee variant of this course, newest first, with the shots. */
async function holeHistory(el, course, i, round) {
  const key = `${course.libId || course.id}:${i}`;
  if (histCache.key !== key) {
    const [rounds, courses] = await Promise.all([listRounds().catch(() => []), listCourses().catch(() => [])]);
    const ids = new Set(courses.filter((c) => (course.libId ? c.libId === course.libId : c.id === course.id)).map((c) => c.id));
    const rows = rounds.filter((r) => r.id !== round.id && ids.has(r.courseId) && !r.quick && r.holes?.[i] && r.holes[i].score != null)
      .sort((a, b) => b.date - a.date).map((r) => ({ r, h: r.holes[i], par: course.holes[i].par }));
    histCache = { key, rows };
  }
  if (!el.isConnected) return;
  const all = histCache.rows;
  if (!all.length) { el.innerHTML = ''; return; }
  const rows = all.filter((x) => histFilter === 'all' || (histFilter === 'tees' ? x.r.tees === round.tees : (x.h.shots || []).some((s) => s.src === 'laser')));
  const sc = all.map((x) => x.h.score), par = course.holes[i].par;
  const avg = sc.reduce((a, b) => a + b, 0) / sc.length;
  const shotLine = (h) => (h.shots || []).map((x, k) => { const bits = [x.d?.club, x.dist != null && k > 0 ? `${dist(x.dist)}${x.src === 'laser' ? '📍' : ''}` : null, RES_WORD[x.res]].filter(Boolean).join(' '); return bits || (k === 0 ? 'tee' : '·'); }).join(' → ');
  el.innerHTML = `<details class="card hhist"><summary><b>This hole: ${all.length} played · avg ${avg.toFixed(1)} · best ${Math.min(...sc)} · worst ${Math.max(...sc)}</b><span class="mute small">${all.filter((x) => x.h.score < par).length} under · ${all.filter((x) => x.h.score === par).length} par · ${all.filter((x) => x.h.score > par).length} over</span></summary>
    <div class="chips3 hfilt">${[['all', 'All'], ['tees', 'Same tees'], ['laser', 'With laser']].map(([v, l]) => `<button class="${histFilter === v ? 'on' : ''}" data-hf="${v}">${l}</button>`).join('')}</div>
    ${rows.slice(0, 12).map(({ r, h }) => `<div class="hrow"><span class="hsc ${h.score < par ? 'b' : h.score === par ? 'p' : h.score >= par + 2 ? 'oo' : 'o'}">${h.score}</span><div><div class="small"><b>${fmtD(r.date)}</b> <span class="mute">· ${esc(r.tees || '')}${h.putts != null ? ` · ${h.putts} putt${h.putts === 1 ? '' : 's'}` : ''}</span></div><div class="mute small">${esc(shotLine(h))}</div>${h.note ? `<div class="small">“${esc(h.note)}”</div>` : ''}</div></div>`).join('') || '<p class="mute small">Nothing matches that filter.</p>'}
  </details>`;
  el.querySelectorAll('[data-hf]').forEach((b) => b.onclick = (e) => { e.preventDefault(); histFilter = b.dataset.hf; holeHistory(el, course, i, round).then(() => el.querySelector('details').open = true); });
}

/** Start logging a round on a saved course (optionally from a scheduled event: partners prefilled). */
async function startRound(c, ev = null) {
  const r = { id: uid('r'), date: Date.now(), courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: false, holes: c.holes.map(() => null) };
  if (ev?.who) r.players = ev.who.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name, scores: c.holes.map(() => null), putts: c.holes.map(() => null) }));
  if (ev) { r.eventId = ev.id; const s = S0(); s.events = (s.events || []).filter((x) => x.id !== ev.id); S1(s); }
  c.lastPlayed = Date.now(); await putCourse(c);
  await putRound(r);
  cur = { round: r, course: c, hole: 0, review: false };
  return playersSheet(r, () => moodSheet(r, 'start', renderHole)); // the weather is read when the check-in is done
}

// ---------------- Course editor ----------------
async function editCourse(id) {
  const c = id ? await getCourse(id) : { id: uid('c'), name: '', tees: '', holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, si: null, yds: null })) };
  const draw = () => {
    root.innerHTML = `
      <button class="btn" data-x="back">‹ Back</button>
      <div class="card form">
        <h2>${id ? 'Edit course' : 'New course'}</h2>
        <button class="btn" data-x="photo" style="width:100%;margin-bottom:12px">${icon('camera')} Fill from scorecard photo</button>
        <input type="file" accept="image/*" id="coursePhoto" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" />
        <label>Course name<input id="cName" value="${esc(c.name)}" placeholder="e.g. Emirates Majlis" /></label>
        <label>Tees<input id="cTees" value="${esc(c.tees)}" placeholder="e.g. Blue" /></label>
        <div class="row"><label style="flex:1">Course rating<input id="cRating" inputmode="decimal" value="${c.rating ?? ''}" placeholder="e.g. 72.0" /></label><label style="flex:1">Slope<input id="cSlope" inputmode="numeric" value="${c.slope ?? ''}" placeholder="e.g. 129" /></label></div>
        <p class="mute small" style="margin:-4px 0 8px">Rating and slope are on the scorecard (or GHIN). They're what turn a score into a handicap differential.</p>
        <div class="row" style="margin-bottom:8px"><button class="btn ${c.holes.length === 18 ? 'primary' : ''}" data-x="h18">18 holes</button><button class="btn ${c.holes.length === 9 ? 'primary' : ''}" data-x="h9">9 holes</button></div>
        <p class="mute small">Tap a par to cycle 3 → 4 → 5. Stroke index and ${duLong()} are optional.</p>
        <div class="cgrid"><span>Hole</span><span>Par</span><span>SI</span><span>${duLong()}</span>
          ${c.holes.map((h, i) => `<span class="hn">${i + 1}</span><button class="par p${h.par}" data-par="${i}">${h.par}</button><input inputmode="numeric" data-si="${i}" value="${h.si ?? ''}" /><input inputmode="numeric" data-yd="${i}" value="${dist(h.yds) ?? ''}" />`).join('')}
        </div>
        <p class="mute small" id="parTot">Par ${c.holes.reduce((a, h) => a + h.par, 0)}</p>
        <button class="btn primary big" data-x="save">Save course</button>
        ${id ? '<button class="btn" data-x="del" style="width:100%;margin-top:8px;color:var(--work)">Delete course</button>' : ''}
      </div>`;
    const sync = () => {
      c.name = root.querySelector('#cName').value.trim(); c.tees = root.querySelector('#cTees').value.trim();
      c.rating = parseFloat(root.querySelector('#cRating').value) || null; c.slope = parseInt(root.querySelector('#cSlope').value, 10) || null;
      root.querySelectorAll('[data-si]').forEach((el) => (c.holes[+el.dataset.si].si = +el.value || null));
      root.querySelectorAll('[data-yd]').forEach((el) => (c.holes[+el.dataset.yd].yds = toYards(el.value)));
    };
    root.querySelectorAll('[data-par]').forEach((b) => b.addEventListener('click', () => {
      const h = c.holes[+b.dataset.par]; h.par = h.par >= 5 ? 3 : h.par + 1;
      b.textContent = h.par; b.className = `par p${h.par}`;
      root.querySelector('#parTot').textContent = `Par ${c.holes.reduce((a, x) => a + x.par, 0)}`;
    }));
    root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
      const x = b.dataset.x;
      if (x === 'back') return id ? openCoursePage(id) : roundsHome();
      sync();
      if (x === 'h18' || x === 'h9') { const n = x === 'h18' ? 18 : 9; c.holes = Array.from({ length: n }, (_, i) => c.holes[i] || { par: 4, si: null, yds: null }); return draw(); }
      if (x === 'photo') return root.querySelector('#coursePhoto').click();
      if (x === 'save') {
        if (!c.name) return ctx.toast('Give the course a name.');
        await putCourse(c); ctx.toast('Course saved'); return openCoursePage(c.id);
      }
      if (x === 'del') { await deleteCourse(c.id); return roundsHome(); }
    }));
    root.querySelector('#coursePhoto').addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      sync();
      const s = ctx.settings();
      if (!aiReady(s)) return ctx.toast('Reading a card photo uses AI. Add a Claude, ChatGPT or Gemini key in Settings.', 5000);
      ctx.toast('Reading the card…', 8000);
      try {
        const data = await readCard({ ...aiFrom(s), images: [await shrink(f)], kind: 'course', holes: c.holes.length });
        if (data.name && !c.name) c.name = data.name;
        const tee = data.tees?.find((t) => c.tees && t.name?.toLowerCase().includes(c.tees.toLowerCase())) || data.tees?.[0];
        if (tee?.name && !c.tees) c.tees = tee.name;
        c.holes = c.holes.map((h, i) => ({ par: [3, 4, 5].includes(data.par?.[i]) ? data.par[i] : h.par, si: data.si?.[i] ?? h.si, yds: tee?.yards?.[i] ?? h.yds }));
        draw(); ctx.toast('Filled from the card. Check it, then save.', 4000);
      } catch (err) { ctx.toast(err.message, 6000); }
    });
  };
  draw();
}

// ---------------- Hole logger ----------------
async function openRound(id) {
  const r = await getRound(id);
  const c = await getCourse(r.courseId);
  if (!c) { ctx.toast('That round\'s course was deleted.'); return roundsHome(); }
  if (r.quick) return quickSummary(r, c);
  if (r.finished) return renderSummary(r, c);
  const next = r.holes.findIndex((h) => !h || h.score == null);
  cur = { round: r, course: c, hole: next < 0 ? r.holes.length - 1 : next, review: false };
  renderHole();
}

const save = () => putRound(cur.round).catch(() => {});

// ---------------- Hole: one panel per shot, in order ----------------
// A hole is a list of shots (tee shot first) then putts. We don't know how many shots there'll be,
// so it starts with the expected number for the par (par 3: 1, par 4: 2, par 5: 3) and you add more.
function renderHole() {
  const { round, course, hole: i, review } = cur;
  const ch = course.holes[i];
  const par = ch.par;
  const h = round.holes[i] || (round.holes[i] = blankHole());
  round.curHole = i;
  ensureShots(h, par, ch.yds);
  for (let k = 1; k < h.shots.length; k++) if (!h.shots[k].lie) h.shots[k].lieAuto = defaultLie(h, k);
  derive(h, par);
  const putts = h.putts;
  const score = h.score;
  const diff = score != null ? score - par : null;
  const sg = putts != null ? holeSG({ ...h, shots: h.shots.map((x) => ({ ...x, lie: x.lie || x.lieAuto })) }, par, ch.yds) : null;
  const tot = round.holes.reduce((a, x, k) => (x && x.score != null ? { s: a.s + x.score, p: a.p + course.holes[k].par } : a), { s: 0, p: 0 });
  const word = diff == null ? '' : diff <= -2 ? 'Eagle' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : diff === 2 ? 'Double' : `+${diff}`;
  const LIE_D = Object.fromEntries(LIE_DETAIL);
  const CAUSE = Object.fromEntries(CODES.cause), FLIGHT = Object.fromEntries(CODES.flight), STRIKE = Object.fromEntries([['PUR', 'Pure'], ...CODES.strike]);
  const detBadge = (x) => x.d ? [asPlanned(x) === true ? 'as planned ✓' : asPlanned(x) === false ? 'not the shot ✗' : null, x.d.sat ? `${'★'.repeat(x.d.sat)}` : null, ...(x.d.lies || []).map((l) => LIE_D[l]), FLIGHT[x.d.flight] || x.d.flight, STRIKE[x.d.strike] || x.d.strike, CAUSE[x.d.cause] || x.d.cause, x.d.cost ? `cost +${x.d.cost}` : x.d.cost === 0 ? 'saved it' : null].filter(Boolean).map(esc).join(' · ') : '';

  const cue = round.cuesOff || review ? '' : shotCue(h, par, ch.yds);
  const bag = getBag();
  const usual = teeUsual(round, course, i);
  // a par 4/5 tee shot starts with the Driver (or the club you usually hit here) already picked
  const t0 = h.shots[0];
  if (par >= 4 && !t0.d?.club && !t0.res) { t0.d = { ...(t0.d || {}), club: usual?.club || bag.find((c) => /driver/i.test(c.club))?.club || null, clubAuto: true }; if (!t0.d.club) delete t0.d; }
  // every other shot with a distance gets the club for that distance, recorded unless you pick another
  h.shots.forEach((x, k) => {
    const yd = k === 0 ? (par >= 4 ? null : x.dist ?? ch.yds) : (x.plays ?? x.dist);
    if (yd == null || (x.d?.club && !x.d.clubAuto)) return;
    const c = clubForDistance(bag, yd);
    if (c && x.d?.club !== c) x.d = { ...(x.d || {}), club: c, clubAuto: true };
  });
  ensurePutts(h);
  const panel = (x, k) => {
    // a shot that's been logged folds to one line; tap it to edit. The shot in hand stays open.
    const done = x.res === 'G' || x.res === 'HO';
    const open = expandedShots.has(`${i}:${k}`) || !x.res || (k === h.shots.length - 1 && !done);
    if (!open) return shotLine(x, k, { zone: zoneOf(h, k), dist, du });
    return shotPanel({ h, k, par, course, bag, usual, clubOpen: clubOpenSet.has(`${i}:${k}`), dist, du, holeYds: ch.yds, detLine: detBadge(x) });
  };
  const last = h.shots[h.shots.length - 1];
  const greenNow = last?.res === 'G' || (h.putts > 0 && !h.shots.some((x) => x.res));
  if (greenNow && !h.puttList.length) h.puttList.push({ ft: null });

  root.innerHTML = `
    <div class="holebar">
      <button class="btn icon" data-h="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      <div class="hinfo"><div class="hnum">Hole ${i + 1}</div><div class="mute small">Par ${par}${ch.si ? ` · SI ${ch.si}` : ''}${ch.yds ? ` · ${dist(ch.yds)} ${du()}` : ''}</div></div>
      <button class="btn icon" data-h="next">›</button>
    </div>
    <div class="holedots">${round.holes.map((x, k) => `<i class="${k === i ? 'on' : ''} ${x && x.score != null ? (x.score < course.holes[k].par ? 'b' : x.score === course.holes[k].par ? 'p' : 'o') : ''}" data-go="${k}"></i>`).join('')}</div>
    <p class="mute small center">${esc(round.courseName)} · ${tot.s ? `${tot.s} (${toParStr(tot.s - tot.p)}) thru ${played(round).length}` : 'not started'}${review ? ' · reviewing bogeys' : ''}</p>
    ${round.quick ? '' : '<div id="holeMap"></div><div id="holeHist"></div>'}
    ${cue ? `<div class="cue"><span>${cue}</span><button class="link" data-routine title="My routine">${icon('info', 14)}</button><button class="link" data-cue-off title="Hide cues for this round">✕</button></div>` : review ? '' : `<p class="small right"><button class="link" data-routine>${round.swingThought ? esc(round.swingThought) + ' · ' : ''}routine</button></p>`}

    <div class="scorebar"><div><span class="mute small">Score</span><b class="${diff < 0 ? 'under' : diff > 0 ? 'over' : ''}">${score ?? '–'}</b><span class="small">${word}</span></div>
      ${sg && sg.complete ? `<span class="sgpill ${sg.total >= 0 ? 'pos' : 'neg'}" style="float:none">SG ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(1)}</span>` : ''}</div>

    ${round.quick ? '' : routeStrip(h, ch.yds, ch.yds ? `${dist(ch.yds)} ${du()}` : '')}
    ${h.shots.map(panel).join('')}
    ${greenNow ? h.puttList.map((_, j) => puttPanel(h, j, { open: expandedShots.has(`${i}:p${j}`) })).join('') : last?.res === 'HO' ? '' : `<button class="btn addshot" data-add="1">+ Shot ${h.shots.length + 1}</button>`}
    ${holeDone(h, par)}

    ${(round.players || []).length ? `<div class="card partners"><div class="lbl">Playing partners <span class="mute">score · putts</span></div>
      ${round.players.map((p, pi) => { const sc = p.scores[i], pt = p.putts[i]; return `<div class="prow"><b>${esc(p.name)}</b>
        <div class="step"><button data-pp="${pi}" data-d="-1">−</button><span class="${sc == null ? 'mute' : sc < par ? 'under' : sc > par ? 'over' : ''}">${sc ?? '–'}</span><button data-pp="${pi}" data-d="1">+</button></div>
        <div class="step sm"><button data-pq="${pi}" data-d="-1">−</button><span class="mute">${pt ?? '–'}</span><button data-pq="${pi}" data-d="1">+</button></div></div>`; }).join('')}
      <button class="link" data-paddp>+ Partner</button></div>` : `<button class="link" data-paddp style="margin:-4px 0 8px">+ Add a playing partner's score</button>`}

    ${diff > 0 || h.note ? `<div class="card"><div class="lbl">${word}: what happened? <span class="mute">(optional)</span></div>
      <textarea class="hnote" data-note rows="2" placeholder="e.g. went for the green over water, should have laid up">${esc(h.note || '')}</textarea>
      <p class="mute small" style="margin:6px 0 0">Tap Details on the shot that cost you to log how it went (flight, strike, cause).</p></div>` : ''}

    <div class="row">
      ${review && nextBogey(i) < 0 ? '<button class="btn primary big" data-h="finish">Done</button>' : i === course.holes.length - 1 ? '<button class="btn big" data-h="save">Save — finish the details later</button><button class="btn primary big" data-h="submit">Submit round</button>' : `<button class="btn primary big" data-h="next">${review ? 'Next bogey ›' : `Hole ${i + 2} ›`}</button>`}
    </div>
    ${i === course.holes.length - 1 ? `<label class="check small" style="margin-top:12px"><input type="checkbox" data-learn ${round.learning !== false ? 'checked' : ''}/> Count this round toward my stats and coach</label>` : ''}
    <div class="exitrow"><button class="link" data-h="home">Save & exit</button><button class="link" data-h="endearly">End round here</button><button class="link mute" data-h="discard">Discard…</button></div>`;

  // hole map: satellite + OSM shapes (when the course is mapped) + your club arcs
  const mapEl = root.querySelector('#holeMap');
  if (mapEl) {
    holeMap?.destroy(); holeMap = null;
    Promise.all([loadGeo(course.libId), effectiveClubs(), bestBandCached()]).then(([geo, clubs, bestBand]) => {
      if (!mapEl.isConnected) return;
      const gh = geoHole(geo, i + 1) || markedHole(ch.mark, i + 1);
      if (!gh && !ch.yds && !course.lat) { mapEl.remove(); return; }
      holeMap = mountHoleMap(mapEl, { gh, geo, par, yds: ch.yds, teeName: course.tees, clubs, inGame: true, bestBand, cond: round.cond?.start || null, geoId: course.libId || course.id, canMark: !!course.lat, onMark: () => markHoleSheet({ course, start: i, geo, onSave: (k, mark) => { course.holes[k].mark = mark; putCourse(course); }, onClose: renderHole }) });
    });
  }
  const histEl = root.querySelector('#holeHist');
  if (histEl) holeHistory(histEl, course, i, round);
  syncLoopConfig();
  const redo = () => { derive(h, par); save(); renderHole(); };
  root.querySelectorAll('[data-expand]').forEach((b) => b.onclick = () => { expandedShots.add(`${i}:${b.dataset.expand}`); renderHole(); });
  const penOn = (x) => { if (PENALTY_RES.includes(x.res) || PENALTY_RES.includes(x.res2)) x.pen = true; };
  root.querySelectorAll('[data-res]').forEach((b) => b.onclick = () => {
    const k = +b.dataset.res, x = h.shots[k]; const was = x.res; x.res = x.res === b.dataset.v ? null : b.dataset.v;
    if (PENALTY_RES.includes(was) && !PENALTY_RES.includes(x.res) && !PENALTY_RES.includes(x.res2)) x.pen = false;
    penOn(x);
    if (x.res === 'HO') { h.putts = 0; h.firstPutt = null; h.puttList = []; h.shots.splice(k + 1); }
    else if (was === 'HO') h.putts = null;
    if (!x.res || !['GS', 'BK'].includes(x.res)) { x.dir = null; x.ss = false; }
    if (x.res === 'G') { h.shots.splice(k + 1); expandedShots.delete(`${i}:${k}`); setTimeout(() => root.querySelector('#greenPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); }
    else if (was === 'G' && k === h.shots.length - 1) { h.puttList = []; h.putts = null; h.firstPutt = null; delete h.puttsAuto; }
    redo();
  });
  root.querySelectorAll('[data-res2]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.res2]; const was = x.res2; x.res2 = x.res2 === b.dataset.v ? null : b.dataset.v; if (PENALTY_RES.includes(was) && !PENALTY_RES.includes(x.res2)) x.pen = false; penOn(x); redo(); });
  root.querySelectorAll('[data-dir]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.dir]; x.dir = x.dir === b.dataset.v ? null : b.dataset.v; redo(); });
  root.querySelectorAll('[data-ss]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.ss]; x.ss = !x.ss; redo(); });
  root.querySelectorAll('[data-lie]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.lie]; x.lie = x.lie === b.dataset.v ? null : b.dataset.v; redo(); });
  root.querySelectorAll('[data-slope]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.slope]; x.feet = b.dataset.feet || null; x.hill = b.dataset.hill || null; redo(); });
  root.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => {
    const x = h.shots[+b.dataset.club]; const same = x.d?.club === b.dataset.v && !x.d?.clubAuto;
    x.d = { ...(x.d || {}), club: same ? null : b.dataset.v, clubAuto: false, suggested: false };
    clubOpenSet.delete(`${i}:${b.dataset.club}`); redo();
  });
  root.querySelectorAll('[data-clubmore]').forEach((b) => b.onclick = () => { clubOpenSet.add(`${i}:${b.dataset.clubmore}`); renderHole(); });
  root.querySelectorAll('[data-sd]').forEach((el) => el.addEventListener('change', () => { const x = h.shots[+el.dataset.sd]; x.dist = toYards(el.value); x.src = el.value ? 'manual' : null; redo(); }));
  root.querySelectorAll('[data-pen]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.pen]; x.pen = !x.pen; redo(); });
  root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { h.shots.splice(+b.dataset.rm, 1); redo(); });
  root.querySelector('[data-add]')?.addEventListener('click', () => { h.shots.push({ lie: null, dist: null }); redo(); setTimeout(() => root.querySelectorAll('.shotpanel')[h.shots.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); });
  root.querySelectorAll('[data-det]').forEach((b) => b.onclick = () => shotDetails(h, +b.dataset.det, par, i, redo));
  root.querySelector('[data-cue-off]')?.addEventListener('click', () => { round.cuesOff = true; redo(); });
  root.querySelector('[data-routine]')?.addEventListener('click', () => routineSheet(round));
  // putts, one at a time
  const putt = (j) => h.puttList[j];
  const reputt = () => { syncPutts(h); redo(); };
  root.querySelectorAll('[data-pft]').forEach((b) => b.onclick = () => { const p = putt(+b.dataset.pft); p.ft = p.ft != null && puttBand(p.ft) === +b.dataset.v ? null : +b.dataset.v; reputt(); });
  root.querySelectorAll('[data-pread]').forEach((b) => b.onclick = () => {
    const p = putt(+b.dataset.pread); const brk = b.dataset.brk || null, sl = b.dataset.sl || null;
    const same = p.brk === brk && (p.sl || null) === sl; p.brk = same ? null : brk; p.sl = same ? null : sl; reputt();
  });
  root.querySelectorAll('[data-pholed]').forEach((b) => b.onclick = () => { const j = +b.dataset.pholed; h.puttList.forEach((p, n) => { p.holed = n === j ? !p.holed : false; }); h.puttList.splice(j + 1); delete h.puttsAuto; reputt(); });
  root.querySelectorAll('[data-pmiss]').forEach((b) => b.onclick = () => {
    const j = +b.dataset.pmiss; putt(j).holed = false; delete h.puttsAuto;
    if (j === h.puttList.length - 1) h.puttList.push({ ft: null });
    reputt(); setTimeout(() => root.querySelector('#greenPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  });
  root.querySelectorAll('[data-pexp]').forEach((b) => b.onclick = () => { expandedShots.add(`${i}:p${b.dataset.pexp}`); renderHole(); });
  root.querySelector('[data-trouble]')?.addEventListener('click', () => troubleSheet(course, renderHole));
  root.querySelector('[data-learn]')?.addEventListener('change', (e) => { round.learning = e.target.checked; save(); });
  root.querySelectorAll('[data-pp]').forEach((b) => b.onclick = () => { const p = round.players[+b.dataset.pp]; const v = p.scores[i]; p.scores[i] = v == null ? par : Math.max(1, v + +b.dataset.d); save(); renderHole(); });
  root.querySelectorAll('[data-pq]').forEach((b) => b.onclick = () => { const p = round.players[+b.dataset.pq]; const v = p.putts[i]; p.putts[i] = v == null ? 2 : Math.max(0, v + +b.dataset.d); save(); renderHole(); });
  root.querySelector('[data-paddp]')?.addEventListener('click', () => playersSheet(round, () => { save(); renderHole(); }));
  root.querySelector('[data-note]')?.addEventListener('input', (e) => { h.note = e.target.value; clearTimeout(window.__noteT); window.__noteT = setTimeout(save, 500); });
  // leaving a hole counts it as played: unpicked putts are taken as 2, unpicked lies as the suggested ones
  const commit = () => {
    // on the green and walked off without finishing the putts: two is the likely number, flagged so Submit asks.
    // Anywhere else we can't know (a chip and a putt? a chip-in?), so the hole stays unfinished.
    if (h.putts == null && h.shots[h.shots.length - 1]?.res === 'G') { const n = Math.max(2, h.puttList?.length || 0); h.putts = n; h.puttsAuto = true; }
    h.shots.forEach((x, k) => { if (!x.lie && x.lieAuto) x.lie = x.lieAuto; if (!x.sw) x.sw = autoSwing(x, k); delete x.lieAuto; });
    if (!review && h.score != null && !h.at) h.at = Date.now(); // when it was played, for the heat through the round
    derive(h, par);
  };
  root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { commit(); save(); cur.hole = +b.dataset.go; renderHole(); });
  root.querySelectorAll('[data-h]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.h;
    if (a !== 'home' && a !== 'prev') commit();
    await save();
    if (a === 'prev') { cur.hole = Math.max(0, i - 1); return renderHole(); }
    if (a === 'next') {
      const go = () => {
        if (review) { const n = nextBogey(i); cur.hole = n < 0 ? i : n; }
        else cur.hole = Math.min(course.holes.length - 1, i + 1);
        window.scrollTo(0, 0); renderHole();
      };
      // at the turn: how are you feeling?
      if (i === 8 && course.holes.length > 9 && !review && round.mood?.turn == null) return moodSheet(round, 'turn', go);
      return go();
    }
    if (a === 'save' || a === 'submit') return endRound(round, course, { submit: a === 'submit' });
    if (a === 'finish') {
      const done = async () => { round.finished = true; await save(); renderSummary(round, course); };
      if (round.mood?.finish == null) return moodSheet(round, 'finish', done);
      readWeather(round, 'finish'); return done();
    }
    if (a === 'home') return roundsHome();
    if (a === 'endearly') return endRoundSheet(round, course);
    if (a === 'discard') return discardSheet(round);
  });
}

/** Finish a round before 18: keep the holes played, mark it finished. */
function endRoundSheet(round, course) {
  const n = played(round).length;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>End the round here?</b><button class="link" data-close>Cancel</button></div>
    <p class="small">${n ? `${n} hole${n > 1 ? 's' : ''} logged: it becomes a ${n}-hole round${n < 9 ? ' (under 9 holes stays out of your stats unless you count it)' : ''}.` : 'No holes logged yet. Use Discard instead.'}</p>
    <button class="btn big" data-save ${n ? '' : 'disabled'}>Save — finish the details later</button>
    <button class="btn primary big" data-ok ${n ? '' : 'disabled'}>Submit round</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  const go = (submit) => { round.endedEarly = true; round.holes = round.holes.map((h) => (h && h.score != null ? h : null)); sheet.remove(); endRound(round, course, { submit }); };
  sheet.querySelector('[data-save]').onclick = () => go(false);
  sheet.querySelector('[data-ok]').onclick = () => go(true);
  document.body.appendChild(sheet);
}

/**
 * Coming off the course: Save keeps everything (it counts toward your stats where it can, and the round
 * stays open for details); Submit first checks every hole and lists what strokes gained still needs.
 */
export async function endRound(round, course, { submit = false } = {}) {
  const finish = async (submitted) => {
    round.finished = true; round.submitted = submitted; round.updatedAt = Date.now();
    if (cur?.round === round) { const h = round.holes[cur.hole]; if (h?.shots) h.shots.forEach((x) => { if (!x.lie && x.lieAuto) x.lie = x.lieAuto; delete x.lieAuto; }); }
    await putRound(round);
    if (round.mood?.finish == null) return moodSheet(round, 'finish', () => renderSummary(round, course));
    readWeather(round, 'finish'); renderSummary(round, course);
  };
  if (!submit) { await finish(false); ctx.toast?.('Saved. Finish the details from the round when you have time.'); return; }
  const gaps = round.holes.map((h, k) => ({ k, g: holeGaps(h, course.holes[k]?.par || 4) })).filter((x) => x.g.length);
  if (!gaps.length) return finish(true);
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${gaps.length} hole${gaps.length > 1 ? 's are' : ' is'} missing details</b><button class="link" data-close>Cancel</button></div>
    <p class="small mute" style="margin:0 0 8px">Scores are fine. These holes need a little more for strokes gained and the radar:</p>
    ${gaps.map(({ k, g }) => `<div class="todo"><span><b>Hole ${k + 1}</b> · ${esc(g.join(', '))}</span><button class="link acc" data-fix="${k}">Fix</button></div>`).join('')}
    <button class="btn primary big" data-fix="${gaps[0].k}">Fix now</button>
    <button class="btn big" data-anyway>Submit anyway (scores only)</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => { sheet.remove(); cur = { round, course, hole: +b.dataset.fix, review: false }; root.scrollIntoView?.(); renderHole(); });
  sheet.querySelector('[data-anyway]').onclick = () => { sheet.remove(); finish(true); };
  document.body.appendChild(sheet);
}

/** Which trouble this course has (two, shown in the lie row): saved on the course. */
function troubleSheet(course, done) {
  let pick = [...troubleCodes(course)];
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Trouble at ${esc(course.name)}</b><button class="link" data-close>Cancel</button></div>
      <p class="small mute" style="margin:0 0 8px">Pick the two you end up in most here. Water is always under "Ended up".</p>
      <div class="chips3">${TROUBLE_OPTIONS.map(([v, l]) => `<button class="${pick.includes(v) ? 'on' : ''}" data-t="${v}">${l}</button>`).join('')}</div>
      <button class="btn primary big" data-ok ${pick.length ? '' : 'disabled'} style="margin-top:12px">Save</button></div>`;
    sheet.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { const v = b.dataset.t; pick = pick.includes(v) ? pick.filter((x) => x !== v) : [...pick, v].slice(-2); draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-ok]').onclick = async () => { course.trouble = pick; await putCourse(course); sheet.remove(); done(); };
  };
  draw(); document.body.appendChild(sheet);
}

/** Throw the round away. */
function discardSheet(round) {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Discard this round?</b><button class="link" data-close>Cancel</button></div>
    <p class="small">Everything logged for it is deleted. This can't be undone.</p>
    <button class="btn big" data-ok style="color:var(--work)">Discard round</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-ok]').onclick = async () => { await deleteRound(round.id); removeSummary(round.id).catch(() => {}); sheet.remove(); cur = null; ctx.toast('Round discarded'); roundsHome(); };
  document.body.appendChild(sheet);
}

/** Optional per-shot details: club and Conor's codes, for practice. Not required. */
/**
 * One line of course management for the shot in hand, from the break-80 data (Arccos via Golf Digest):
 * 200+ from the fairway is a double one time in five for a 10-handicap, 150–200 is the zone, inside 100 it's under 5%.
 * Shown while a shot has a distance and no result yet; nothing to read once you're inside 100.
 */
export function shotCue(h, par, yds) {
  const shots = h.shots || [];
  const k = shots.findIndex((x, n) => x && x.res == null && (n > 0 || par === 3));
  if (k < 0) return '';
  const x = shots[k];
  const d = x.dist ?? (k === 0 ? yds : null);
  if (d == null) return '';
  const lie = x.lie || x.lieAuto;
  const rough = lie === 'rgh' || lie === 'wst' || lie === 'fbk';
  if (d >= 200) return `${Math.round(d)} out: one hole in five from here becomes a double, even from the fairway. Green in regulation +1 is the goal — ${par >= 5 || k >= 1 ? 'lay up to the distance you score from (★ on the map) rather than force it' : 'aim at the fat side of the green and take bogey off the table'}.`;
  if (d >= 150) return `150–200 is the double-bogey zone${rough ? ', more so from the rough: take enough club' : ''}. Aim at the fat side of the green, not the flag: a miss on the easy-chip side still leaves GIR+1.`;
  if (d >= 100) return 'Aim between the middle of the green and the pin. Short-siding yourself is the only bad miss from here.';
  return '';
}

// Details for one shot: how it went. Club and lie live on the shot panel; where it finished is "Ended up".
const FLIGHTS = [['STR', 'Straight'], ['DRW', 'Draw'], ['FAD', 'Fade'], ['PL', 'Pull'], ['PU', 'Push'], ['HK', 'Hook'], ['SL', 'Slice'], ['OTH', 'Other']];
const STRIKES = [['PUR', 'Pure'], ['THN', 'Thin'], ['FAT', 'Fat'], ['TOE', 'Toe'], ['HEL', 'Heel']];
const COSTS = [[null, 'No'], [1, '+1'], [2, '+2'], [0, 'Saved it']];
function shotDetails(h, k, par, holeIdx, done) {
  const x = h.shots[k];
  const d = { club: null, shot: null, cause: null, flight: null, strike: null, result: null, cost: null, plan: null, sat: null, lies: [], ...(x.d || {}) };
  d.lies = Array.isArray(d.lies) ? d.lies : [];
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const auto = autoShotType({ ...x, d }, k, par);
    const grid = (key, list, cls) => `<div class="${cls}">${list.map(([c, l]) => `<button class="${d[key] === c ? 'on' : ''}" data-k="${key}" data-v="${c}">${l}</button>`).join('')}</div>`;
    sheet.innerHTML = `<div class="sheet-in detsheet">
      <div class="sheet-h"><b>Hole ${holeIdx + 1} · ${k === 0 ? 'tee shot' : `shot ${k + 1}`}${d.club ? ` · ${esc(d.club)}` : ''}${x.dist != null && k > 0 ? `, ${dist(x.dist)} ${du()}` : ''}</b><button class="link" data-close>Cancel</button></div>
      <div class="row2"><div><div class="lbl">The shot you wanted?</div><div class="seg2">${[[true, 'Yes'], [false, 'No']].map(([v, l]) => `<button class="${d.plan === v ? 'on' : ''} ${d.plan == null && asPlanned({ ...x, d }) === v ? 'auto' : ''}" data-plan="${v}">${l}</button>`).join('')}</div></div>
        <div><div class="lbl">Happy with it?</div><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="${d.sat >= n ? 'on' : ''}" data-sat="${n}">★</button>`).join('')}</div></div></div>
      <div class="lbl">Ball flight</div>${grid('flight', FLIGHTS, 'g4')}
      <div class="lbl">Strike</div>${grid('strike', STRIKES, 'g5')}
      <div class="row2"><div><div class="lbl">What went wrong</div>${grid('cause', CODES.cause, 'g1')}</div>
        <div><div class="lbl">Did it cost you?</div><div class="g1">${COSTS.map(([v, l]) => `<button class="${d.cost === v ? 'on' : ''}" data-cost="${v}">${l}</button>`).join('')}</div></div></div>
      <button class="btn primary big" data-ok>Save</button>
      ${x.d && (x.d.flight || x.d.strike || x.d.cause || x.d.plan != null || x.d.sat || x.d.cost != null) ? '<button class="link" data-clear style="margin-top:10px">Clear details</button>' : ''}</div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { d[b.dataset.k] = d[b.dataset.k] === b.dataset.v ? null : b.dataset.v; draw(); });
    sheet.querySelectorAll('[data-cost]').forEach((b) => b.onclick = () => { d.cost = b.dataset.cost === 'null' ? null : +b.dataset.cost; draw(); });
    sheet.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => { const v = b.dataset.plan === 'true'; d.plan = d.plan === v ? null : v; draw(); });
    sheet.querySelectorAll('[data-sat]').forEach((b) => b.onclick = () => { d.sat = d.sat === +b.dataset.sat ? null : +b.dataset.sat; draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-clear]')?.addEventListener('click', () => { x.d = x.d?.club ? { club: x.d.club, clubAuto: x.d.clubAuto } : undefined; if (!x.d) delete x.d; sheet.remove(); done(); });
    sheet.querySelector('[data-ok]').onclick = async () => {
      x.d = { ...d, shot: d.shot || auto };
      // no distance logged for this shot: take the club's number from the bag (full swing), as an estimate
      if (d.club && (x.dist == null || x.src === 'club') && (x.sw || 'full') === 'full' && k > 0) {
        const c = getBag().find((b) => b.club === d.club);
        const shots = await listShots().catch(() => []);
        const e = c ? resolveClub(c, shots) : null;
        if (e?.carry) { x.dist = e.carry; x.src = 'club'; }
      }
      sheet.remove(); done();
    };
  };
  draw();
  document.body.appendChild(sheet);
}

export { INTENTIONS, intentionLabel };
/** The routine, one tap from the hole screen: read it, breathe, close it. */
function routineSheet(round) {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Before the shot</b><button class="link" data-x>Close</button></div>${routineHtml(getRoutine(S0()), { swingThought: round.swingThought, expect: round.expect })}</div>`;
  sheet.querySelector('[data-x]').onclick = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}
// end of round: how well the process held up, on a four-step scale (4 = always)
const PROCESS = [['routine', 'Followed my pre-shot routine'], ['commit', 'Committed to every shot'], ['accept', 'Let bad shots go']];
const FREQ = [[4, 'Always'], [3, 'Mostly'], [2, 'Sometimes'], [1, 'Rarely']];
/** The weather at the check-in (start) and at the finish. Offline? The startup backfill fills it in later. */
function readWeather(round, key) {
  if (key !== 'start' && key !== 'finish') return;
  getConditions({ force: true }).then((w) => { if (!w) return; round.cond = { ...(round.cond || {}), [key]: w }; putRound(round); }).catch(() => {});
}
const moodColor = (n) => `hsl(${n <= 5 ? 200 - (n - 1) * 20 : 120 - (n - 5) * 24}, 75%, 50%)`;
function moodSheet(round, key, done) {
  round.mood ||= {};
  let v = round.mood[key] ?? null, w = round.warmup ?? null, en = round.energy ?? null, it = round.intention ?? null, kept = round.intentionKept ?? null, kind = round.kind ?? null, kindInfo = false, aim = round.aim ?? null;
  const proc = { ...(round.process || {}) };
  const R = getRoutine(S0());
  let thought = round.swingThought ?? R.swingThought ?? '', expect = round.expect ?? '';
  let lastAgain = null; // what you said you'd do differently, last time on this course
  let bestHere = []; // your best shots, last time here
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const title = { start: 'Before you tee off', turn: 'At the turn', finish: 'Round done' }[key];
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in moodsheet">
      <div class="sheet-h"><b>${title}</b><button class="link" data-skip>Skip</button></div>
      ${key === 'start' ? `<div class="lbl">What kind of round? <button class="infob" data-kindinfo aria-label="What's the difference?">i</button></div>
      <div class="seg2">${[['comp', 'Competition'], ['casual', 'Casual']].map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
      <div class="lbl">Today's aim</div>
      <div class="seg3 aimseg">${[['low', 'Shoot low'], ['fun', 'Have fun'], ['both', 'Both']].map(([k, l]) => `<button class="${aim === k ? 'on' : ''}" data-aim="${k}">${l}</button>`).join('')}</div>
      ${kindInfo ? '<div class="infopop"><b>Competition</b> Medal or card in: your real game, under pressure.<br><b>Casual</b> A practice round: trying shots, no pressure. Both count in your stats; Progress can show them apart.</div>' : ''}` : ''}
      <div class="lbl">How do you feel right now?</div>
      <div class="moodscale">${Array.from({ length: 10 }, (_, n) => `<button class="${v === n + 1 ? 'on' : ''}" data-m="${n + 1}" style="--c:${moodColor(n + 1)}">${n + 1}</button>`).join('')}</div>
      <div class="moodlbl">${[['Low', MOOD_WORDS.low, 1], ['Ideal', MOOD_WORDS.mid, 5], ['High', MOOD_WORDS.high, 10]].map(([t, w, n]) => `<span style="color:${moodColor(n)}">${t}${w.split(' · ').map((x) => `<small>${x[0].toUpperCase() + x.slice(1)}</small>`).join('')}</span>`).join('')}</div>
      ${key === 'start' ? `<div class="lbl">Energy today? <span class="mute">(sleep, work, legs)</span></div><div class="seg3">${ENERGY.map(([k, l]) => `<button class="${en === k ? 'on' : ''}" data-en="${k}">${l}</button>`).join('')}</div>
      <div class="lbl">Any practice or warm-up before the round?</div><div class="seg4">${WARMUP.map(([k, l]) => `<button class="${w === k ? 'on' : ''}" data-w="${k}">${l}</button>`).join('')}</div>
      ${bestHere.length ? `<div class="again best"><b>Your best shots here last time:</b>${bestHere.map((b) => `<div class="small">Hole ${b.h + 1}${b.club ? `, ${esc(b.club)}` : ''}: ${esc(b.note)}</div>`).join('')}</div>` : ''}
      ${lastAgain ? `<div class="again"><b>Last time here you said you'd:</b> ${esc(lastAgain.text)} <span class="mute small">(${fmtD(lastAgain.date)}, ${lastAgain.score})</span></div>` : ''}
      <div class="lbl">One thing for today <span class="mute">(optional — you'll rate it at the end)</span></div><div class="chips3">${INTENTIONS.map(([k, l]) => `<button class="${it === k ? 'on' : ''}" data-it="${k}">${l}</button>`).join('')}</div>
      <div class="row2"><label class="small">Swing thought<input data-thought value="${esc(thought)}" placeholder="one, and only one" /></label><label class="small">A good round today is…<input data-expect value="${esc(expect)}" placeholder="e.g. no doubles" /></label></div>
      <details class="lminfo rtd"><summary>${icon('info', 14)} My routine</summary>${routineHtml(R)}</details>` : ''}
      ${key === 'finish' ? `<div class="lbl">Your process today</div>${PROCESS.map(([k, l]) => `<div class="procrow"><span>${l}</span><div class="seg4 sm">${FREQ.map(([v, w]) => `<button class="${proc[k] === v ? 'on' : ''}" data-proc="${k}" data-v="${v}">${w}</button>`).join('')}</div></div>`).join('')}
      ${round.aim === 'fun' || round.aim === 'both' ? `<div class="procrow"><span>Did you enjoy it?</span><div class="seg4 sm">${FREQ.map(([v, w]) => `<button class="${proc.fun === v ? 'on' : ''}" data-proc="fun" data-v="${v}">${['Loved it', 'Mostly', 'Some', 'No'][4 - v]}</button>`).join('')}</div></div>` : ''}` : ''}
      ${key === 'finish' && it ? `<div class="lbl">Did you keep to it: “${esc(intentionLabel(it))}”?</div><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="${kept >= n ? 'on' : ''}" data-kept="${n}">★</button>`).join('')}</div>` : ''}
      <button class="btn primary big" data-ok>${key === 'start' ? 'Start hole 1' : key === 'turn' ? 'On to the back nine' : 'See my round'}</button></div>`;
    sheet.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { v = +b.dataset.m; draw(); });
    sheet.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { w = b.dataset.w; draw(); });
    sheet.querySelectorAll('[data-en]').forEach((b) => b.onclick = () => { en = en === b.dataset.en ? null : b.dataset.en; draw(); });
    sheet.querySelectorAll('[data-aim]').forEach((b) => b.onclick = () => { aim = aim === b.dataset.aim ? null : b.dataset.aim; round.aim = aim; draw(); });
    sheet.querySelectorAll('[data-proc]').forEach((b) => b.onclick = () => { const k = b.dataset.proc, v = +b.dataset.v; proc[k] = proc[k] === v ? null : v; draw(); });
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => { kind = kind === b.dataset.kind ? null : b.dataset.kind; round.kind = kind; draw(); });
    sheet.querySelector('[data-kindinfo]')?.addEventListener('click', () => { kindInfo = !kindInfo; draw(); });
    sheet.querySelectorAll('[data-it]').forEach((b) => b.onclick = () => { it = it === b.dataset.it ? null : b.dataset.it; draw(); });
    sheet.querySelectorAll('[data-kept]').forEach((b) => b.onclick = () => { kept = kept === +b.dataset.kept ? null : +b.dataset.kept; draw(); });
    sheet.querySelector('[data-skip]').onclick = () => { round.mood[key] = round.mood[key] ?? 0; sheet.remove(); save(); readWeather(round, key); done(); };
    sheet.querySelector('[data-thought]')?.addEventListener('input', (e) => { thought = e.target.value; });
    sheet.querySelector('[data-expect]')?.addEventListener('input', (e) => { expect = e.target.value; });
    sheet.querySelector('[data-ok]').onclick = () => {
      round.mood[key] = v;
      if (key === 'finish') round.process = proc;
      if (key === 'start') { round.kind = kind; round.aim = aim; round.warmup = w; round.energy = en; round.intention = it; round.swingThought = thought.trim() || null; round.expect = expect.trim() || null; if (round.swingThought && round.swingThought !== R.swingThought) { const st = S0(); st.routine = { ...(st.routine || {}), swingThought: round.swingThought }; S1(st); } }
      if (key === 'finish') round.intentionKept = kept;
      sheet.remove(); save(); readWeather(round, key); done();
    };
  };
  draw();
  document.body.appendChild(sheet);
  if (key === 'start') listRounds().then((rs) => {
    const prev = rs.filter((r) => r.id !== round.id && r.courseId === round.courseId && r.finished && r.debrief?.again?.trim()).sort((a, b) => b.date - a.date)[0];
    if (prev && sheet.isConnected) { lastAgain = { text: prev.debrief.again.trim(), date: prev.date, score: prev.score ?? played(prev).reduce((a, h) => a + h.score, 0) }; }
    bestHere = lastBestHere(rs, round.courseId, round.id).slice(0, 3);
    if ((prev || bestHere.length) && sheet.isConnected) draw();
  }).catch(() => {});
}

const nextBogey = (i) => nextBogeyFrom(cur.round, cur.course, i);

// the distance band you score best from (Progress → Where you score from), for the ★ on the tee arcs
let bandCache = { t: 0, band: null };
export async function bestBandCached() {
  if (Date.now() - bandCache.t < 10 * 60e3) return bandCache.band;
  try {
    const rounds = (await listRounds()).filter((r) => r.finished && r.learning !== false && !r.quick).slice(0, 60);
    const withCourse = []; for (const r of rounds) { const c = await getCourse(r.courseId).catch(() => null); if (c) withCourse.push({ r, c }); }
    bandCache = { t: Date.now(), band: approachBands(withCourse).best?.band || null };
  } catch { bandCache = { t: Date.now(), band: null }; }
  return bandCache.band;
}


/** Aggregate of recent learning rounds, for the coach profile and the swing AI. */
export async function recentRoundAggregate(n = 10) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && r.learning !== false).slice(0, n);
  return aggStats(rounds);
}

// Downscale a photo to keep API calls small and fast.

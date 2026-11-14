// The Play tab's home: the check-in card, scheduled rounds, recent rounds, the digest and course pages.
// The hole logger (ui.js) hands it what it needs through initHome, so the two don't import each other.
import { roundStats, aggregate, pct, played } from './stats.js';
import { openLibrary, loadLibrary } from './library.js';
import { conditionsAt } from '../weather.js';
import { heroHtml, fillWeather, clubName, whereAmI, placeHero } from './hero.js';
import { badgeHtml } from './badge.js';
import { getSettings as S0, saveSettings as S1 } from '../store.js';
import { getRound, listRounds, getCourse, listCourses, listSwings } from '../store.js';
import { renderChecklist } from '../checklist.js';
import { icon } from '../icons.js';
import { intentionLabel } from './intentions.js';
import { planSheet } from '../mygame.js';
import { weeklyDigest } from '../digest.js';
import { listSessions } from '../store.js';
import { drillsLoaded } from '../drills.js';
import { inviteSheet } from './friends.js';
import { checkinHtml, lastNote } from './checkin.js';
import { inviteLink, remoteEvents, takePendingInvite, joinEvent, addFriendByCode } from '../cloud/social.js';
import { currentUser } from '../cloud/supabase.js';
import { groupCourses, courseCardsHtml, bindCourseCards, coursePage, events, fmtWhen, scheduleSheet, eventCalendar } from './course.js';
import { postScore, importCard } from './scoreimport.js';
import { esc, fmtD, toParStr } from './fmt.js';

let api = null;
/** api: { root, ctx, cur(), setCur(), startRound, openRound, editCourse, effectiveClubs, bestBandCached, endRoundSheet, discardSheet } */
export function initHome(a) { api = a; }

// ---------------- Home ----------------
export async function roundsHome() {
  api.setCur(null);
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
  api.root.innerHTML = `
    ${open ? `<div class="card event-card inprog"><div class="ip-h">${(() => { const g = groups.find((x) => x.variants.some((v) => v.id === open.courseId)); return badgeHtml(open.courseName, null, g ? { attrs: `data-thumb="${esc(g.key)}"` } : {}); })()}<div><span class="mute small">Round in progress</span><b>${esc(open.courseName)}</b><span class="mute small">${fmtD(open.date)} · ${played(open).length} of ${(open.holes || []).length} holes logged</span></div></div><div class="row"><button class="btn primary" data-act="resume" data-id="${open.id}">Resume round</button><button class="btn" data-act="endopen" data-id="${open.id}">End / discard</button></div></div>` : ''}
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
  api.root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => homeAction(b.dataset.act, b.dataset.id)));
  bindCourseCards(api.root, groups, courseApi());
  if (!open) heroWeather(recent, me);
  handlePendingInvite();
  mergeRemoteEvents().then((changed) => { if (changed && api.root?.querySelector('.checkin') && !api.cur()) roundsHome(); });
  renderChecklist(api.root.querySelector('#gettingStarted'), { onGo: (where) => (where === 'library' ? homeAction('library') : where === 'play' ? (groups.length ? coursePage(groups[0], courseApi()) : homeAction('library')) : api.ctx.showTab?.(where)) });
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
    if (!api.root?.isConnected) return;
    if (placeHero(api.root, where, recent)) bindCourseCards(api.root, recent, courseApi());
    const spot = where.mode === 'home' ? all.find((c) => c.lat != null) : where.mode === 'at' ? all.find((c) => c.group === where.at) : null;
    let cond = null, place = '';
    if (spot) { cond = await conditionsAt(spot.lat, spot.lon); place = clubName(spot.group.name); }
    else if (here) cond = await conditionsAt(here[0], here[1]);
    if (api.root?.isConnected) fillWeather(api.root, cond, { name, place });
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
  sheet.addEventListener('click', (e) => { const h = e.target.closest('.hist[data-id]'); if (h) { sheet.remove(); api.openRound(h.dataset.id); } });
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
    if (inv.kind === 'friend') { const p = await addFriendByCode(inv.code); api.ctx.toast(`You and ${p.nickname || p.name || 'your friend'} are friends now.`); }
    else { const ev = await joinEvent(inv.code, S0().nickname || S0().name || ''); api.ctx.toast(`You're in: ${ev.course_name}`); await mergeRemoteEvents(); }
    roundsHome();
  } catch (e) { api.ctx.toast(e.message || 'That invite didn\'t work.'); }
}
/** What the course page needs from here. */
const courseApi = () => ({ root: api.root, toast: api.ctx.toast, startRound: api.startRound, openRound: api.openRound, editCourse: api.editCourse, back: roundsHome, clubs: api.effectiveClubs, bestBand: api.bestBandCached });
export async function openCoursePage(courseId) {
  const groups = groupCourses(await listCourses().catch(() => []));
  const g = groups.find((x) => x.variants.some((c) => c.id === courseId));
  return g ? coursePage(g, courseApi()) : roundsHome();
}

export async function aggStats(rounds) {
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
  if (act === 'progress') return api.ctx.showTab?.('history');
  const sel = api.root.querySelector('#courseSel')?.value;
  if (act === 'endopen') { const r = await getRound(id); const c = await getCourse(r.courseId).catch(() => null); api.setCur({ round: r, course: c, hole: 0, review: false }); return played(r).length && c ? api.endRoundSheet(r, c) : api.discardSheet(r); }
  if (act === 'resume' || act === 'open') return api.openRound(id);
  if (act === 'allrounds') return allRoundsSheet();
  if (act === 'plan') return planSheet({ done: roundsHome });
  if (act === 'mind') return import('../coach/mindchat.js').then((m) => m.openMindChat({ onSettings: () => api.ctx.showTab?.('settings') }));
  if (act === 'newcourse') return api.editCourse(null);
  if (act === 'library') return openLibrary({ toast: api.ctx.toast, onPicked: (c) => openCoursePage(c.id) });
  if (act === 'editcourse') return api.editCourse(sel);
  if (act === 'start') return api.startRound(await getCourse(sel));
  if (act === 'evstart') {
    const e = events().find((x) => x.id === id); let c = e?.courseId && (await getCourse(e.courseId).catch(() => null));
    if (!c && e?.libId) c = (await listCourses().catch(() => [])).find((x) => x.libId === e.libId) || null;
    if (!c && e?.libId) { const lib = (await loadLibrary()).find((x) => x.id === e.libId); if (lib) { const { importCourse } = await import('./library.js'); c = await importCourse(lib, lib.tees?.[0] || null); } }
    if (!c) return api.ctx.toast('Add the course first (Find a course), then start from here.');
    return api.startRound(c, e);
  }
  if (act === 'evcal') { const e = events().find((x) => x.id === id); if (e) eventCalendar(e); return; }
  if (act === 'evinvite') { const e = events().find((x) => x.id === id); if (e?.code) inviteSheet({ title: `${e.courseName} · ${fmtWhen(e.when)}`, link: inviteLink('join', e.code), code: e.code, blurb: 'Whoever opens this (signed in to osolo) joins the round and becomes your friend.' }); return; }
  if (act === 'evedit') { const e = events().find((x) => x.id === id); if (e?.joined) { const s = S0(); s.events = (s.events || []).filter((x) => x.id !== e.id); S1(s); return roundsHome(); } const groups = groupCourses(await listCourses().catch(() => [])); const g = groups.find((x) => (e.libId ? x.libId === e.libId : x.variants.some((c) => c.id === e.courseId))); if (g) scheduleSheet(g, { toast: api.ctx.toast, done: roundsHome, existing: e }); return; }
  if (act === 'import') return importCard(sel);
  if (act === 'post') return postScore(sel);
}


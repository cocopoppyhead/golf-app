// Rounds module UI: courses, hole-by-hole logging (Conor's shot codes), scorecard photo import, summaries.
import { CODES, TEE_ZONES, MISS, isGir, roundStats, aggregate, roundTendencies, roundSummaryText, pct, top, played } from './stats.js';
import { openLibrary, isHome, starred } from './library.js';
import { differential, courseHandicap, adjustedGross, indexFrom } from './handicap.js';
import { getConditions, condText } from '../weather.js';
import { getSettings as S0, saveSettings as S1 } from '../store.js';
import { isMetric } from '../units.js';
import { putRound, getRound, deleteRound, listRounds, putCourse, getCourse, listCourses, deleteCourse, listSwings } from '../store.js';
import { readCard, reviewRound, md, aiFrom, aiReady } from '../coach/ai.js';
import { coachContext, addCoachNote } from '../coach/profile.js';
import { dist, toYards, du, duLong, PUTT_FT, puttLabel, puttUnit } from '../units.js';
import { checkRules, rulesCard, DEFAULT_RULES, tiger5, TIGER5_LABEL } from './tiger.js';
import { LIES, roundSG, holeSG, SG_LABELS } from './sg.js';
import { initLaserLoop } from './laserloop.js';
import { getBag, resolveClub } from '../bag.js';
import { listShots } from '../store.js';
import { workContext } from '../workingon.js';
import { practiceContext } from '../practice.js';
import { drillContext } from '../drills.js';
import { loadGeo, geoHole, mountHoleMap, markedHole, markHoleSheet } from './holemap.js';
import { groupCourses, courseCardsHtml, bindCourseCards, coursePage, events, fmtWhen, scheduleSheet, eventCalendar } from './course.js';

const DEBRIEF_TAGS = ['Driver into trouble', 'Risky shot choice', 'Approach misses', 'Short game', '3-putts', 'Lost focus', 'Back problem', 'Tired', 'Wind / conditions', 'Bad luck'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const toParStr = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

let ctx = { settings: () => ({}), toast: () => {} };
let root;
let cur = null; // { round, course, hole, review }
let holeMap = null; // the mounted hole map (holemap.js), rebuilt with each hole render
let clubsCache = { t: 0, list: [] };
/** Your clubs with resolved carries (typed + learned), for the hole map arcs. Cached for a minute. */
async function effectiveClubs() {
  if (Date.now() - clubsCache.t < 60000) return clubsCache.list;
  const shots = await listShots().catch(() => []);
  clubsCache = { t: Date.now(), list: getBag().map((c) => resolveClub(c, shots)).filter((c) => c.carry > 0).map((c) => ({ club: c.club, carry: c.carry })) };
  return clubsCache.list;
}

export function initRounds(el, opts) { root = el; ctx = { ...ctx, ...opts }; }

// ---------------- Rangefinder → shot card ----------------
// Each lock-on during an open round becomes a shot with distance, plays-like, suggested club and a GPS
// fix, shown on a card the moment it arrives (rounds/laserloop.js). GPS decides when you've moved on.
initLaserLoop({ getCur: () => cur, toast: (t) => ctx.toast?.(t), renderHole: () => { if (cur && root?.isConnected) renderHole(); }, blankHole: () => blankHole(), ensureShots });

// ---------------- Home ----------------
export async function roundsHome() {
  cur = null;
  const [rounds, allCourses] = await Promise.all([listRounds().catch(() => []), listCourses().catch(() => [])]);
  const st = starred();
  const rk = (c) => (isHome(c) ? 0 : st.has(c.libId) ? 1 : 2);
  const courses = allCourses.map((c, i) => ({ c, i })).sort((a, b) => rk(a.c) - rk(b.c) || a.i - b.i).map((x) => x.c);
  const open = rounds.find((r) => !r.finished);
  const done = rounds.filter((r) => r.finished);
  await aggStats(done); // attaches per-round stats for the list
  const A = await aggStats(done.filter((r) => r.learning !== false).slice(0, 10));
  const tend = roundTendencies(A);
  const groups = groupCourses(allCourses), upcoming = events().slice(0, 3);
  root.innerHTML = `
    ${open ? `<div class="card event-card"><b>Round in progress</b><p class="mute small">${esc(open.courseName)} · ${fmtD(open.date)} · ${played(open).length} holes logged</p><div class="row"><button class="btn primary" data-act="resume" data-id="${open.id}">Resume round</button><button class="btn" data-act="endopen" data-id="${open.id}">End / discard</button></div></div>` : ''}
    ${upcoming.length ? `<div class="card"><div class="lbl">Upcoming</div>${upcoming.map((e) => `<div class="evrow"><div><b>${esc(e.courseName)}</b><div class="mute small">${fmtWhen(e.when)}${e.who ? ` · with ${esc(e.who)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div></div><div class="row" style="gap:6px"><button class="btn sm" data-act="evstart" data-id="${e.id}">Start</button><button class="link" data-act="evcal" data-id="${e.id}">📅</button><button class="link" data-act="evedit" data-id="${e.id}">Edit</button></div></div>`).join('')}</div>` : ''}
    <div class="sechead"><h2>Your courses</h2><button class="link acc" data-act="library">+ Find a course</button></div>
    ${groups.length ? courseCardsHtml(groups, rounds) : '<div class="card"><p class="mute">Pick your course from the UAE list and the scorecard, map and tees fill in. Tap a course for its page: start or schedule a round, preview the holes, your record there.</p><button class="btn primary big" data-act="library">🇦🇪 Find a UAE course</button></div>'}
    <div class="row" style="margin-top:8px"><button class="btn" data-act="post">＋ Post a score</button><button class="btn" data-act="import">📷 Import a scorecard</button><button class="btn" data-act="newcourse">+ By hand</button></div>
    ${A ? statsCard(A, `Last ${A.rounds} round${A.rounds > 1 ? 's' : ''}`) : ''}
    ${await (async () => {
      const gs = [];
      for (const r of done.filter((x) => x.learning !== false).slice(0, 10)) { const c = await getCourse(r.courseId).catch(() => null); const G = c && roundSG(r, c); if (G && G.complete >= Math.min(9, G.holes)) gs.push(G); }
      if (!gs.length) return '';
      const avg = { ott: 0, app: 0, arg: 0, putt: 0, total: 0 };
      gs.forEach((G) => { for (const k in avg) avg[k] += G[k] / gs.length; });
      return sgCard(avg, `Average of your last ${gs.length} round${gs.length > 1 ? 's' : ''} with shot data`);
    })()}
    ${tend.length ? `<div class="card"><h2>On the course</h2>${tend.slice(0, 5).map((t) => `<div class="tend"><div><b>${esc(t.text)}</b><div class="mute small">${esc(t.detail)}</div></div></div>`).join('')}<p class="mute small">These feed your coach alongside your swing tendencies.</p></div>` : ''}
    ${done.length ? `<h2 style="margin:18px 0 8px">Rounds</h2>` + done.map((r) => {
      const s = r._stats;
      return `<div class="hist" data-act="open" data-id="${r.id}"><div class="sc">${s ? s.score : '–'}</div><div><div class="t">${esc(r.courseName)} ${s ? `<span class="mute">${toParStr(s.toPar)}</span>` : ''}</div><div class="s">${fmtD(r.date)}${r.quick ? `${r.tees ? ` · ${esc(r.tees)}` : ''}${r.diff != null ? ` · diff ${r.diff.toFixed(1)}` : ''} · score only` : s ? ` · ${s.putts} putts · FIR ${pct(s.fir, s.firOpp) ?? '–'}% · GIR ${pct(s.gir, s.girOpp) ?? '–'}%` : ''}${r.learning === false ? ' · not counted' : ''}</div></div><div class="mute">›</div></div>`;
    }).join('') : ''}`;
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => homeAction(b.dataset.act, b.dataset.id)));
  bindCourseCards(root, groups, courseApi());
}
/** What the course page needs from here. */
const courseApi = () => ({ root, toast: ctx.toast, startRound, openRound, editCourse, back: roundsHome, clubs: clubsCache.list });
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
  if (A) A.debriefs = list.filter((x) => x.round.debrief?.notes || x.round.debrief?.tags?.length).slice(0, 5)
    .map((x) => `${new Date(x.round.date).toDateString()} ${x.course.name} ${x.stats.score}: ${[...(x.round.debrief.tags || []), x.round.debrief.notes].filter(Boolean).join('; ')}`);
  return A;
}

async function homeAction(act, id) {
  const sel = root.querySelector('#courseSel')?.value;
  if (act === 'endopen') { const r = await getRound(id); const c = await getCourse(r.courseId).catch(() => null); cur = { round: r, course: c, hole: 0, review: false }; return played(r).length && c ? endRoundSheet(r, c) : discardSheet(r); }
  if (act === 'resume' || act === 'open') return openRound(id);
  if (act === 'newcourse') return editCourse(null);
  if (act === 'library') return openLibrary({ toast: ctx.toast, onPicked: (c) => openCoursePage(c.id) });
  if (act === 'editcourse') return editCourse(sel);
  if (act === 'start') return startRound(await getCourse(sel));
  if (act === 'evstart') { const e = events().find((x) => x.id === id); const c = e && (await getCourse(e.courseId).catch(() => null)); if (!c) return ctx.toast('That course is gone. Edit the event.'); return startRound(c, e); }
  if (act === 'evcal') { const e = events().find((x) => x.id === id); if (e) eventCalendar(e); return; }
  if (act === 'evedit') { const e = events().find((x) => x.id === id); const groups = groupCourses(await listCourses().catch(() => [])); const g = groups.find((x) => (e.libId ? x.libId === e.libId : x.variants.some((c) => c.id === e.courseId))); if (g) scheduleSheet(g, { toast: ctx.toast, done: roundsHome, existing: e }); return; }
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
  getConditions().then((w) => { r.cond = { ...(r.cond || {}), start: w }; save(); }).catch(() => {});
  return playersSheet(r, () => moodSheet(r, 'start', renderHole));
}

// ---------------- Course editor ----------------
async function editCourse(id) {
  const c = id ? await getCourse(id) : { id: uid('c'), name: '', tees: '', holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, si: null, yds: null })) };
  const draw = () => {
    root.innerHTML = `
      <button class="btn" data-x="back">‹ Back</button>
      <div class="card form">
        <h2>${id ? 'Edit course' : 'New course'}</h2>
        <button class="btn" data-x="photo" style="width:100%;margin-bottom:12px">📷 Fill from scorecard photo</button>
        <input type="file" accept="image/*" id="coursePhoto" hidden />
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
// Score, fairway, GIR, approach miss and green-side bunker are all worked out from the panels.
// Where a shot ended up, which side it missed, and what kind of swing it was
const ENDED = [['G', 'Green'], ['FR', 'Fringe'], ['RG', 'Rough'], ['BK', 'Green bunker'], ['FB', 'Fwy bunker'], ['WS', 'Waste'], ['FW', 'Fairway'], ['TR', 'Trees'], ['PN', 'OB / water'], ['HO', 'Holed']];
const TEE_EXTRA = [['FB', 'Fairway bunker'], ['WS', 'Waste'], ['PN', 'OB / water']];
const DIRS = [['S', 'Short'], ['L', 'Long'], ['LF', 'Left'], ['R', 'Right']];
export const SWING_TYPES = [['full', 'Full'], ['3q', '¾'], ['half', '½'], ['pitch', 'Pitch'], ['chip', 'Chip'], ['splash', 'Bunker'], ['punch', 'Punch'], ['putter', 'Putt']];
// what you meant to hit (tee shots and full swings); what actually happened goes in Details → ball flight
export const INTENT = [['D', 'Draw'], ['S', 'Straight'], ['F', 'Fade']];
const autoSwing = (x, k) => {
  if (k === 0) return 'full';
  const d = x.dist ?? null, lie = x.lie || x.lieAuto;
  if (lie === 'bnk' && d != null && d <= 50) return 'splash';
  if (lie === 'rec') return 'punch';
  if (d == null) return 'full';
  return d < 30 ? 'chip' : d < 80 ? 'pitch' : 'full';
};
// lie for the next shot from where this one ended
const LIE_FROM = { FW: 'fw', LR: 'rgh', RR: 'rgh', LT: 'wst', RT: 'wst', FB: 'fbk', FR: 'frg', RG: 'rgh', BK: 'bnk', WS: 'wst', TR: 'rec' };
const blankHole = () => ({ score: null, putts: null, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [], shots: null });

function upgradeShot(x) {
  if (['S', 'L', 'LF', 'R'].includes(x.res)) { x.dir = x.res; x.res = null; }
}
function ensureShots(h, par, yds) {
  if (!h.shots || !h.shots.length) {
    const n = h.score != null && h.putts != null ? Math.max(1, h.score - h.putts) : Math.max(1, par - 2);
    h.shots = Array.from({ length: n }, () => ({ lie: null, dist: null }));
    if (h.tee && par >= 4) h.shots[0].res = h.tee;
  }
  h.shots[0] = { ...h.shots[0], lie: 'tee', dist: h.shots[0].dist ?? yds ?? null };
  h.shots.forEach(upgradeShot);
}
function defaultLie(h, k) {
  const p = h.shots[k - 1] || {};
  const from = (k - 1 === 0 && p.res2) || p.res;
  if (from && LIE_FROM[from]) return LIE_FROM[from];
  return k === 1 ? 'fw' : 'rgh';
}
export const autoShotType = (s, k, par) => {
  const club = (s.d?.club || '').toLowerCase();
  if (k === 0 && par >= 4) return /driver/.test(club) || !club ? 'DRV' : 'TEE';
  const d = s.dist ?? 0;
  if (s.sw === 'splash' || (s.lie === 'bnk' && d <= 50)) return 'BKR';
  if (s.lie === 'fbk' && d > 50) return d > 150 ? 'IRN' : 'APP';
  if (s.sw === 'putter') return 'PT';
  if (s.sw === 'chip' || s.sw === 'pitch' || (d && d < 30)) return 'CHP';
  if (/wood|hybrid/.test(club)) return 'FWY';
  return d > 150 ? 'IRN' : 'APP';
};
/** Work out score, fairway, GIR miss, bunker and bogey tags from the panels. */
function derive(h, par) {
  const pens = h.shots.filter((x) => x.pen).length;
  if (h.putts != null) h.score = h.shots.length + pens + h.putts;
  h.tee = par >= 4 ? (h.shots[0].res || null) : null;
  h.gir = null;
  const a = Math.max(0, par - 3); // the shot that should find the green in regulation
  const as = h.shots[a];
  h.miss = as && as.res !== 'G' && as.res !== 'HO' && as.dir ? as.dir : null;
  h.shortSided = h.shots.some((x) => x.ss);
  h.bunker = h.shots.some((x, k) => k > 0 && (x.lie || '') === 'bnk');
  h.fwBunker = h.shots[0]?.res2 === 'FB' || h.shots.some((x, k) => k > 0 && x.lie === 'fbk');
  const det = h.shots.map((x, k) => (x.d ? { shot: x.d.shot || autoShotType(x, k, par), cause: x.d.cause || null, flight: x.d.flight || null, strike: x.d.strike || null, result: x.d.result || null, cost: x.d.cost } : null)).filter(Boolean);
  if (det.length) h.tags = det.filter((t) => t.cost != null).map((t) => ({ ...t, cost: t.cost || 0 }));
}

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
  const detBadge = (x) => x.d ? [x.d.club, x.d.flight, x.d.strike, x.d.cause, x.d.result, x.d.cost ? `+${x.d.cost}` : null].filter(Boolean).map(esc).join(' · ') : '';

  const panel = (x, k) => {
    const tee = k === 0;
    const lie = x.lie || x.lieAuto;
    const sw = x.sw || autoSwing(x, k);
    const missed = x.res && !['G', 'HO', 'FW'].includes(x.res);
    const res = tee && par >= 4
      ? `<div class="zones">${TEE_ZONES.map(([z, l]) => `<button class="${x.res === z ? 'on' : ''} z${z}" data-res="${k}" data-v="${z}">${z[0] === 'L' ? '◀ ' : ''}${l}${z[0] === 'R' ? ' ▶' : ''}</button>`).join('')}</div>
         <div class="chips3">${TEE_EXTRA.map(([v, l]) => `<button class="${x.res2 === v ? 'on' : ''}" data-res2="${k}" data-v="${v}">${l}</button>`).join('')}</div>`
      : `<div class="ended">${ENDED.filter(([v]) => v !== 'FW' || !tee).map(([v, l]) => `<button class="${x.res === v ? 'on' : ''}" data-res="${k}" data-v="${v}">${l}</button>`).join('')}</div>
         ${missed ? `<div class="lbl">Missed</div><div class="seg5 res">${DIRS.map(([v, l]) => `<button class="${x.dir === v ? 'on' : ''}" data-dir="${k}" data-v="${v}">${l}</button>`).join('')}<button class="${x.ss ? 'on warn' : ''}" data-ss="${k}">Short-sided</button></div>` : ''}`;
    return `<div class="card shotpanel">
      <div class="sp-h"><span class="sn">${k + 1}</span><b>${tee ? 'Tee shot' : `Shot ${k + 1}`}</b>
        <span class="mute small">${tee ? `${x.dist ? `${dist(x.dist)} ${du()}` : ''}${x.target ? ` · target ${dist(x.target)}${x.gps ? ' 📍' : ''}` : ''}` : ''}</span>
        <button class="btn sm" data-det="${k}">${x.d ? 'Details ✓' : 'Details'}</button></div>
      ${detBadge(x) ? `<div class="detline">${detBadge(x)}</div>` : ''}
      ${tee ? '' : `<div class="lbl">From</div>
        <div class="lies6">${LIES.map(([v, l]) => `<button class="${lie === v ? 'on' : ''} ${!x.lie && lie === v ? 'auto' : ''}" data-lie="${k}" data-v="${v}">${l}</button>`).join('')}</div>
        <div class="srow1"><input inputmode="numeric" data-sd="${k}" placeholder="to pin" value="${x.dist != null ? dist(x.dist) : ''}" /><span class="mute small">${du()} to the pin${x.src === 'laser' ? ` · laser${x.plays && x.plays !== x.dist ? `, plays ${dist(x.plays)}` : ''}${x.gps ? ' · 📍' : ''}` : x.src === 'club' ? ' · ≈ from club' : ''}</span></div>`}
      ${tee ? '' : `<div class="lbl">Swing</div>
      <div class="swings">${SWING_TYPES.map(([v, l]) => `<button class="${sw === v ? 'on' : ''} ${!x.sw && sw === v ? 'auto' : ''}" data-sw="${k}" data-v="${v}">${l}</button>`).join('')}</div>`}
      ${tee || sw === 'full' ? `<div class="lbl">Planned shape</div><div class="intent">${INTENT.map(([v, l]) => `<button class="${x.intent === v ? 'on' : ''}" data-int="${k}" data-v="${v}">${l}</button>`).join('')}</div>` : ''}
      <div class="lbl">Ended up</div>${res}
      <div class="sp-f"><button class="link" data-pen="${k}">${x.pen ? '<span class="pen">+1 penalty ✕</span>' : '+ penalty stroke'}</button>${k > 0 && k === h.shots.length - 1 ? `<button class="link" data-rm="${k}">Remove shot</button>` : ''}</div>
    </div>`;
  };

  root.innerHTML = `
    <div class="holebar">
      <button class="btn icon" data-h="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      <div class="hinfo"><div class="hnum">Hole ${i + 1}</div><div class="mute small">Par ${par}${ch.si ? ` · SI ${ch.si}` : ''}${ch.yds ? ` · ${dist(ch.yds)} ${du()}` : ''}</div></div>
      <button class="btn icon" data-h="next">›</button>
    </div>
    <div class="holedots">${round.holes.map((x, k) => `<i class="${k === i ? 'on' : ''} ${x && x.score != null ? (x.score < course.holes[k].par ? 'b' : x.score === course.holes[k].par ? 'p' : 'o') : ''}" data-go="${k}"></i>`).join('')}</div>
    <p class="mute small center">${esc(round.courseName)} · ${tot.s ? `${tot.s} (${toParStr(tot.s - tot.p)}) thru ${played(round).length}` : 'not started'}${review ? ' · reviewing bogeys' : ''}</p>
    ${round.quick ? '' : '<div id="holeMap"></div><div id="holeHist"></div>'}

    <div class="scorebar"><div><span class="mute small">Score</span><b class="${diff < 0 ? 'under' : diff > 0 ? 'over' : ''}">${score ?? '–'}</b><span class="small">${word}</span></div>
      ${sg && sg.complete ? `<span class="sgpill ${sg.total >= 0 ? 'pos' : 'neg'}" style="float:none">SG ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(1)}</span>` : ''}</div>

    ${h.shots.map(panel).join('')}
    <button class="btn addshot" data-add="1">+ Add shot ${h.shots.length + 1}</button>

    <div class="card">
      <div class="lbl">Putts</div>
      <div class="seg5">${[0, 1, 2, 3, 4].map((n) => `<button class="${putts === n ? 'on' : ''}" data-pt="${n}">${n}${n === 4 ? '+' : ''}</button>`).join('')}</div>
      ${putts ? `<div class="lbl">1st putt <span class="mute">(${puttUnit()})</span></div><div class="seg5 sm">${PUTT_FT.map((n) => `<button class="${h.firstPutt === n ? 'on' : ''}" data-fp="${n}">${puttLabel(n)}</button>`).join('')}</div>` : ''}
      ${putts === 0 ? '<p class="mute small">Holed from off the green. Nice.</p>' : ''}
    </div>

    ${(round.players || []).length ? `<div class="card partners"><div class="lbl">Playing partners <span class="mute">score · putts</span></div>
      ${round.players.map((p, pi) => { const sc = p.scores[i], pt = p.putts[i]; return `<div class="prow"><b>${esc(p.name)}</b>
        <div class="step"><button data-pp="${pi}" data-d="-1">−</button><span class="${sc == null ? 'mute' : sc < par ? 'under' : sc > par ? 'over' : ''}">${sc ?? '–'}</span><button data-pp="${pi}" data-d="1">+</button></div>
        <div class="step sm"><button data-pq="${pi}" data-d="-1">−</button><span class="mute">${pt ?? '–'}</span><button data-pq="${pi}" data-d="1">+</button></div></div>`; }).join('')}
      <button class="link" data-paddp>+ Partner</button></div>` : `<button class="link" data-paddp style="margin:-4px 0 8px">+ Add a playing partner's score</button>`}

    ${diff > 0 || h.note ? `<div class="card"><div class="lbl">${word}: what happened? <span class="mute">(optional)</span></div>
      <textarea class="hnote" data-note rows="2" placeholder="e.g. went for the green over water, should have laid up">${esc(h.note || '')}</textarea>
      <p class="mute small" style="margin:6px 0 0">Tap Details on the shot that cost you to log how it went (flight, strike, cause).</p></div>` : ''}

    <div class="row">
      ${i === course.holes.length - 1 || (review && nextBogey(i) < 0) ? '<button class="btn primary big" data-h="finish">Finish round</button>' : `<button class="btn primary big" data-h="next">${review ? 'Next bogey ›' : `Hole ${i + 2} ›`}</button>`}
    </div>
    <label class="check small" style="margin-top:12px"><input type="checkbox" data-learn ${round.learning !== false ? 'checked' : ''}/> Count this round toward my coach profile</label>
    <div class="exitrow"><button class="link" data-h="home">Save & exit</button><button class="link" data-h="endearly">End round here</button><button class="link" data-h="discard" style="color:var(--work)">Discard round</button></div>`;

  // hole map: satellite + OSM shapes (when the course is mapped) + your club arcs
  const mapEl = root.querySelector('#holeMap');
  if (mapEl) {
    holeMap?.destroy(); holeMap = null;
    Promise.all([loadGeo(course.libId), effectiveClubs()]).then(([geo, clubs]) => {
      if (!mapEl.isConnected) return;
      const gh = geoHole(geo, i + 1) || markedHole(ch.mark, i + 1);
      if (!gh && !ch.yds && !course.lat) { mapEl.remove(); return; }
      holeMap = mountHoleMap(mapEl, { gh, geo, par, yds: ch.yds, teeName: course.tees, clubs, canMark: !!course.lat, onMark: () => markHoleSheet({ course, start: i, geo, onSave: (k, mark) => { course.holes[k].mark = mark; putCourse(course); }, onClose: renderHole }) });
    });
  }
  const histEl = root.querySelector('#holeHist');
  if (histEl) holeHistory(histEl, course, i, round);
  const redo = () => { derive(h, par); save(); renderHole(); };
  root.querySelectorAll('[data-res]').forEach((b) => b.onclick = () => {
    const x = h.shots[+b.dataset.res]; x.res = x.res === b.dataset.v ? null : b.dataset.v;
    if (x.res === 'PN' && !x.pen) x.pen = true;
    if (x.res === 'HO') { h.putts = 0; h.firstPutt = null; }
    if (!x.res || ['G', 'HO', 'FW'].includes(x.res)) { x.dir = null; x.ss = false; }
    redo();
  });
  root.querySelectorAll('[data-res2]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.res2]; x.res2 = x.res2 === b.dataset.v ? null : b.dataset.v; if (x.res2 === 'PN' && !x.pen) x.pen = true; redo(); });
  root.querySelectorAll('[data-dir]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.dir]; x.dir = x.dir === b.dataset.v ? null : b.dataset.v; redo(); });
  root.querySelectorAll('[data-ss]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.ss]; x.ss = !x.ss; redo(); });
  root.querySelectorAll('[data-int]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.int]; x.intent = x.intent === b.dataset.v ? null : b.dataset.v; redo(); });
  root.querySelectorAll('[data-sw]').forEach((b) => b.onclick = () => { h.shots[+b.dataset.sw].sw = b.dataset.v; redo(); });
  root.querySelectorAll('[data-lie]').forEach((b) => b.onclick = () => { h.shots[+b.dataset.lie].lie = b.dataset.v; redo(); });
  root.querySelectorAll('[data-sd]').forEach((el) => el.addEventListener('change', () => { const x = h.shots[+el.dataset.sd]; x.dist = toYards(el.value); x.src = el.value ? 'manual' : null; redo(); }));
  root.querySelectorAll('[data-pen]').forEach((b) => b.onclick = () => { const x = h.shots[+b.dataset.pen]; x.pen = !x.pen; redo(); });
  root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { h.shots.splice(+b.dataset.rm, 1); redo(); });
  root.querySelector('[data-add]').onclick = () => { h.shots.push({ lie: null, dist: null }); redo(); setTimeout(() => root.querySelectorAll('.shotpanel')[h.shots.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  root.querySelectorAll('[data-det]').forEach((b) => b.onclick = () => shotDetails(h, +b.dataset.det, par, i, redo));
  root.querySelectorAll('[data-pt]').forEach((b) => b.onclick = () => { h.putts = +b.dataset.pt; if (!h.putts) h.firstPutt = null; redo(); });
  root.querySelectorAll('[data-fp]').forEach((b) => b.onclick = () => { h.firstPutt = h.firstPutt === +b.dataset.fp ? null : +b.dataset.fp; redo(); });
  root.querySelector('[data-learn]').onchange = (e) => { round.learning = e.target.checked; save(); };
  root.querySelectorAll('[data-pp]').forEach((b) => b.onclick = () => { const p = round.players[+b.dataset.pp]; const v = p.scores[i]; p.scores[i] = v == null ? par : Math.max(1, v + +b.dataset.d); save(); renderHole(); });
  root.querySelectorAll('[data-pq]').forEach((b) => b.onclick = () => { const p = round.players[+b.dataset.pq]; const v = p.putts[i]; p.putts[i] = v == null ? 2 : Math.max(0, v + +b.dataset.d); save(); renderHole(); });
  root.querySelector('[data-paddp]')?.addEventListener('click', () => playersSheet(round, () => { save(); renderHole(); }));
  root.querySelector('[data-note]')?.addEventListener('input', (e) => { h.note = e.target.value; clearTimeout(window.__noteT); window.__noteT = setTimeout(save, 500); });
  // leaving a hole counts it as played: unpicked putts are taken as 2, unpicked lies as the suggested ones
  const commit = () => {
    if (h.putts == null) h.putts = 2;
    h.shots.forEach((x, k) => { if (!x.lie && x.lieAuto) x.lie = x.lieAuto; if (!x.sw) x.sw = autoSwing(x, k); delete x.lieAuto; });
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
    if (a === 'finish') {
      const done = async () => { round.finished = true; await save(); renderSummary(round, course); getConditions().then((w) => { round.cond = { ...(round.cond || {}), finish: w }; save(); }).catch(() => {}); };
      return round.mood?.finish == null ? moodSheet(round, 'finish', done) : done();
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
    <p class="small">${n ? `${n} hole${n > 1 ? 's' : ''} logged. The round is saved as a ${n}-hole round and counts toward your stats${n < 9 ? ' (per-round numbers are scaled)' : ''}.` : 'No holes logged yet. Use Discard instead.'}</p>
    <button class="btn primary big" data-ok ${n ? '' : 'disabled'}>End round</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-ok]').onclick = async () => {
    round.finished = true; round.endedEarly = true; round.holes = round.holes.map((h) => (h && h.score != null ? h : null));
    await save(); sheet.remove();
    if (round.mood?.finish == null) return moodSheet(round, 'finish', () => renderSummary(round, course));
    renderSummary(round, course);
  };
  document.body.appendChild(sheet);
}

/** Throw the round away. */
function discardSheet(round) {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Discard this round?</b><button class="link" data-close>Cancel</button></div>
    <p class="small">Everything logged for it is deleted. This can't be undone.</p>
    <button class="btn big" data-ok style="color:var(--work)">Discard round</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-ok]').onclick = async () => { await deleteRound(round.id); sheet.remove(); cur = null; ctx.toast('Round discarded'); roundsHome(); };
  document.body.appendChild(sheet);
}

/** Optional per-shot details: club and Conor's codes, for practice. Not required. */
function shotDetails(h, k, par, holeIdx, done) {
  const x = h.shots[k];
  const d = { club: null, shot: null, cause: null, flight: null, strike: null, result: null, cost: null, ...(x.d || {}) };
  const clubs = getBag().map((c) => c.club).filter(Boolean);
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const auto = autoShotType({ ...x, d }, k, par);
    const row = (key, list, label) => `<div class="lbl">${label}</div><div class="codes">${list.map(([c, l]) => `<button class="${d[key] === c ? 'on' : ''} ${key === 'shot' && !d.shot && auto === c ? 'auto' : ''}" data-k="${key}" data-v="${c}">${c}${l ? `<small>${l}</small>` : ''}</button>`).join('')}</div>`;
    sheet.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Hole ${holeIdx + 1} · ${k === 0 ? 'tee shot' : `shot ${k + 1}`}</b><button class="link" data-close>Cancel</button></div>
      <div class="lbl">Club</div><div class="clubchips">${clubs.map((c) => `<button class="${d.club === c ? 'on' : ''}" data-club="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      ${row('flight', CODES.flight, 'Ball flight')}${row('strike', [['PUR', 'Pure'], ...CODES.strike], 'Strike')}
      ${row('cause', CODES.cause, 'Execution (if it went wrong)')}${row('result', CODES.result, 'Positioning')}
      ${row('shot', CODES.shot, 'Shot type')}
      <div class="lbl">Did it cost you?</div><div class="seg4">${[[null, 'No'], [1, '+1'], [2, '+2'], [0, 'Saved it']].map(([v, l]) => `<button class="${d.cost === v ? 'on' : ''}" data-cost="${v}">${l}</button>`).join('')}</div>
      <button class="btn primary big" data-ok>Save</button>
      ${x.d ? '<button class="link" data-clear style="margin-top:10px">Clear details</button>' : ''}</div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { d[b.dataset.k] = d[b.dataset.k] === b.dataset.v ? null : b.dataset.v; draw(); });
    sheet.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => { d.club = d.club === b.dataset.club ? null : b.dataset.club; draw(); });
    sheet.querySelectorAll('[data-cost]').forEach((b) => b.onclick = () => { d.cost = b.dataset.cost === 'null' ? null : +b.dataset.cost; draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-clear]')?.addEventListener('click', () => { delete x.d; sheet.remove(); done(); });
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

// Emotional state, 1–10 (5 = calm, focused, energised). Asked at the start, at the turn and at the end.
export const MOOD_WORDS = { low: 'Lethargic · uninterested · sluggish', mid: 'Calm · focused · energised', high: 'Agitated · erratic · jumpy' };
const WARMUP = [['none', 'None'], ['putt', 'Putting only'], ['range', 'Range balls'], ['full', 'Full warm-up']];
const moodColor = (n) => `hsl(${n <= 5 ? 200 - (n - 1) * 20 : 120 - (n - 5) * 24}, 75%, 50%)`;
function moodSheet(round, key, done) {
  round.mood ||= {};
  let v = round.mood[key] ?? null, w = round.warmup ?? null;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const title = { start: 'Before you tee off', turn: 'At the turn', finish: 'Round done' }[key];
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in moodsheet">
      <div class="sheet-h"><b>${title}</b><button class="link" data-skip>Skip</button></div>
      <div class="lbl">How do you feel right now?</div>
      <div class="moodscale">${Array.from({ length: 10 }, (_, n) => `<button class="${v === n + 1 ? 'on' : ''}" data-m="${n + 1}" style="--c:${moodColor(n + 1)}">${n + 1}</button>`).join('')}</div>
      <div class="moodlbl">${[['Low', MOOD_WORDS.low, 1], ['Ideal', MOOD_WORDS.mid, 5], ['High', MOOD_WORDS.high, 10]].map(([t, w, n]) => `<span style="color:${moodColor(n)}">${t}${w.split(' · ').map((x) => `<small>${x[0].toUpperCase() + x.slice(1)}</small>`).join('')}</span>`).join('')}</div>
      ${key === 'start' ? `<div class="lbl">Any practice or warm-up before the round?</div><div class="seg4">${WARMUP.map(([k, l]) => `<button class="${w === k ? 'on' : ''}" data-w="${k}">${l}</button>`).join('')}</div>` : ''}
      <button class="btn primary big" data-ok ${v ? '' : 'disabled'}>${key === 'start' ? 'Start hole 1' : key === 'turn' ? 'On to the back nine' : 'See my round'}</button></div>`;
    sheet.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { v = +b.dataset.m; draw(); });
    sheet.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { w = b.dataset.w; draw(); });
    sheet.querySelector('[data-skip]').onclick = () => { round.mood[key] = round.mood[key] ?? 0; sheet.remove(); save(); done(); };
    sheet.querySelector('[data-ok]').onclick = () => { round.mood[key] = v; if (key === 'start') round.warmup = w; sheet.remove(); save(); done(); };
  };
  draw();
  document.body.appendChild(sheet);
}
export const moodLine = (r) => {
  const m = r.mood || {}; const f = (x) => (x ? `${x}/10` : '–');
  if (!m.start && !m.turn && !m.finish) return '';
  return `Emotional state: start ${f(m.start)}, turn ${f(m.turn)}, finish ${f(m.finish)}${r.warmup ? ` · warm-up: ${(WARMUP.find((x) => x[0] === r.warmup) || [, r.warmup])[1].toLowerCase()}` : ''}`;
};

function nextBogey(i) {
  const { round, course } = cur;
  for (let k = i + 1; k < round.holes.length; k++) { const x = round.holes[k]; if (x && x.score > course.holes[k].par) return k; }
  return -1;
}

/** Bottom sheet for tagging one bad shot with Conor's codes. */
function tagSheet(h, par, i, unexplained) {
  const t = { shot: null, cause: null, flight: null, strike: null, result: null, cost: unexplained > 0 ? Math.min(2, unexplained) : 0 };
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const row = (k, list) => `<div class="lbl">${{ shot: 'Shot type', cause: 'Execution', flight: 'Ball flight', strike: 'Strike', result: 'Positioning' }[k]}</div><div class="codes">${list.map(([c, l]) => `<button class="${t[k] === c ? 'on' : ''}" data-k="${k}" data-v="${c}">${c}${l ? `<small>${l}</small>` : ''}</button>`).join('')}</div>`;
    sheet.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Tag a shot · hole ${i + 1}</b><button class="link" data-close>Cancel</button></div>
      ${row('shot', CODES.shot)}${row('cause', CODES.cause)}${row('flight', CODES.flight)}${row('strike', CODES.strike)}${row('result', CODES.result)}
      <div class="lbl">Cost</div><div class="seg4">${[[1, '+1'], [2, '+2'], [0, 'Saved it']].map(([v, l]) => `<button class="${t.cost === v ? 'on' : ''}" data-cost="${v}">${l}</button>`).join('')}</div>
      <button class="btn primary big" data-ok ${t.shot ? '' : 'disabled'}>Add</button></div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { t[b.dataset.k] = t[b.dataset.k] === b.dataset.v ? null : b.dataset.v; draw(); });
    sheet.querySelectorAll('[data-cost]').forEach((b) => b.onclick = () => { t.cost = +b.dataset.cost; draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-ok]').onclick = () => { (h.tags ||= []).push({ ...t }); save(); sheet.remove(); renderHole(); };
  };
  draw();
  document.body.appendChild(sheet);
}

// ---------------- Post a score (total only) ----------------
// For rounds you didn't log hole by hole: course, tees, date, gross score. Enough for the handicap
// trend and scoring average; nothing for strokes gained or Tiger 5.
async function postScore(courseId, pre = {}) {
  const allCourses = await listCourses().catch(() => []);
  const st = starred();
  const courses = allCourses.map((c, i) => ({ c, i })).sort((a, b) => ((isHome(a.c) ? 0 : st.has(a.c.libId) ? 1 : 2) - (isHome(b.c) ? 0 : st.has(b.c.libId) ? 1 : 2)) || a.i - b.i).map((x) => x.c);
  const sel = courses.find((c) => c.id === (pre.courseId || courseId)) || courses[0] || null;
  const x = { date: pre.date || dayStr(Date.now()), score: pre.score ?? '', putts: pre.putts ?? '', holesPlayed: pre.holesPlayed || 18 };
  root.innerHTML = `<button class="btn" data-x="back">‹ Back</button>
    <div class="card"><h2>${pre.id ? 'Edit score' : 'Post a score'}</h2>
      <p class="mute small">A round you didn't log hole by hole. Counts for your handicap and scoring average.</p>
      <label class="small mute">Course and tees${courses.length ? `<select id="psCourse">${courses.map((c) => `<option value="${c.id}" ${sel && c.id === sel.id ? 'selected' : ''}>${esc(c.name)}${c.tees ? ` · ${esc(c.tees)}` : ''}${c.rating ? ` (${c.rating}/${c.slope})` : ''}</option>`).join('')}</select>` : '<p class="mute" style="margin:4px 0">No courses yet.</p>'}</label>
      <button class="btn" data-x="library" style="width:100%;margin:6px 0 10px">🇦🇪 ${courses.length ? 'Another course or tee' : 'Find the course'}</button>
      ${sel && !(sel.rating && sel.slope) ? '<p class="small" style="color:var(--work);margin:-4px 0 8px">This course has no rating/slope, so the score won\'t count toward your handicap. Add them in Edit course.</p>' : ''}
      <label class="small mute">Date played<input type="date" id="psDate" value="${x.date}" max="${dayStr(Date.now())}" /></label>
      <div class="row"><label class="small mute" style="flex:1">Gross score<input id="psScore" inputmode="numeric" value="${x.score}" placeholder="e.g. 79" /></label><label class="small mute" style="flex:1">Putts (optional)<input id="psPutts" inputmode="numeric" value="${x.putts}" placeholder="e.g. 31" /></label></div>
      <div class="seg seg2 mini" style="margin:6px 0 10px"><button data-h="18" class="${x.holesPlayed === 18 ? 'on' : ''}">18 holes</button><button data-h="9" class="${x.holesPlayed === 9 ? 'on' : ''}">9 holes</button></div>
      <p class="mute small" id="psDiff"></p>
      ${sel ? '<button class="btn primary big" data-x="save">Save score</button>' : ''}
      ${pre.id ? '<button class="btn" data-x="del" style="width:100%;margin-top:8px;color:var(--work)">Delete</button>' : ''}
    </div>`;
  const q = (s) => root.querySelector(s);
  const showDiff = () => {
    const c = courses.find((k) => k.id === q('#psCourse')?.value) || sel; const sc = +q('#psScore').value;
    const d = c && x.holesPlayed === 18 ? differential(sc, c.rating, c.slope) : null;
    q('#psDiff').textContent = sc && c ? `${sc} on ${c.name}${c.tees ? ` (${c.tees})` : ''}${d != null ? ` · differential ${d.toFixed(1)}` : x.holesPlayed === 9 ? ' · 9-hole scores don\'t count toward the index here' : ''}` : '';
  };
  q('[data-x=back]').onclick = roundsHome;
  q('[data-x=library]').onclick = () => openLibrary({ toast: ctx.toast, onPicked: (c) => postScore(c?.id, { ...pre, ...read(), courseId: c?.id }) });
  const read = () => ({ courseId: q('#psCourse')?.value, date: q('#psDate').value, score: q('#psScore').value, putts: q('#psPutts').value, holesPlayed: x.holesPlayed });
  q('#psCourse')?.addEventListener('change', () => postScore(q('#psCourse').value, { ...pre, ...read() }));
  root.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { x.holesPlayed = +b.dataset.h; root.querySelectorAll('[data-h]').forEach((k) => k.classList.toggle('on', k === b)); showDiff(); });
  q('#psScore').addEventListener('input', showDiff); showDiff();
  q('[data-x=del]')?.addEventListener('click', async () => { await deleteRound(pre.id); ctx.toast('Deleted.'); roundsHome(); });
  q('[data-x=save]')?.addEventListener('click', async () => {
    const c = await getCourse(q('#psCourse').value);
    const score = +q('#psScore').value, putts = q('#psPutts').value === '' ? null : +q('#psPutts').value;
    const lo = x.holesPlayed === 9 ? 25 : 50, hi = x.holesPlayed === 9 ? 80 : 150;
    if (!(score >= lo && score <= hi)) return ctx.toast(`Score should be between ${lo} and ${hi}.`);
    const dv = q('#psDate').value; const when = dv ? new Date(`${dv}T12:00:00`).getTime() : Date.now();
    const r = { id: pre.id || uid('r'), date: when, courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: true, quick: true, source: 'post', holesPlayed: x.holesPlayed, score, putts, holes: [],
      diff: x.holesPlayed === 18 ? differential(score, c.rating, c.slope) : null };
    c.lastPlayed = Math.max(c.lastPlayed || 0, when); await putCourse(c); await putRound(r);
    ctx.toast(`Saved: ${score} at ${c.name}${r.diff != null ? ` · diff ${r.diff.toFixed(1)}` : ''}`);
    roundsHome();
  });
}

async function quickSummary(r, c) {
  const par = c.holes.slice(0, r.holesPlayed || 18).reduce((a, h) => a + h.par, 0);
  root.innerHTML = `<button class="btn" data-x="back">‹ Rounds</button>
    <div class="card"><h2>${esc(r.courseName)} <span class="mute small">${fmtD(r.date)}</span></h2>
      <div class="kpis"><div><b>${r.score}</b><span>${toParStr(r.score - par)} · ${r.holesPlayed || 18} holes</span></div><div><b>${r.diff != null ? r.diff.toFixed(1) : '–'}</b><span>differential</span></div><div><b>${r.putts ?? '–'}</b><span>putts</span></div></div>
      <p class="mute small">${esc(c.tees || '')}${c.rating ? ` · rating ${c.rating} / slope ${c.slope}` : ' · no rating/slope, so not in the handicap'}. Score only: no shot-by-shot stats for this round.</p>
      <div class="row"><button class="btn" data-x="edit">Edit</button></div></div>`;
  root.querySelector('[data-x=back]').onclick = roundsHome;
  root.querySelector('[data-x=edit]').onclick = () => postScore(r.courseId, { id: r.id, courseId: r.courseId, date: dayStr(r.date), score: r.score, putts: r.putts ?? '', holesPlayed: r.holesPlayed || 18 });
}

// ---------------- Scorecard photo import ----------------
// The scoring side of a card rarely shows the course or the date, so you declare both here first.
const dayStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function importCard(courseId, when = null) {
  const s = ctx.settings();
  if (!aiReady(s)) return ctx.toast('Reading a scorecard uses AI. Add a Claude, ChatGPT or Gemini key in Settings.', 5000);
  const allCourses = await listCourses().catch(() => []);
  const st = starred();
  const courses = allCourses.map((c, i) => ({ c, i })).sort((a, b) => ((isHome(a.c) ? 0 : st.has(a.c.libId) ? 1 : 2) - (isHome(b.c) ? 0 : st.has(b.c.libId) ? 1 : 2)) || a.i - b.i).map((x) => x.c);
  const sel = courses.find((c) => c.id === courseId) || courses[0] || null;
  const date = when || dayStr(Date.now());
  root.innerHTML = `<button class="btn" data-x="back">‹ Back</button>
    <div class="card"><h2>Import a scorecard</h2>
      <p class="mute small">The scoring side of a card doesn't say where or when, so set those first.</p>
      <label class="small mute">Course${courses.length ? `<select id="impCourse">${courses.map((c) => `<option value="${c.id}" ${sel && c.id === sel.id ? 'selected' : ''}>${esc(c.name)}${c.tees ? ` · ${esc(c.tees)}` : ''} (par ${c.holes.reduce((a, h) => a + h.par, 0)})</option>`).join('')}</select>` : '<p class="mute" style="margin:4px 0">No courses yet.</p>'}</label>
      <button class="btn" data-x="library" style="width:100%;margin:6px 0 10px">🇦🇪 ${courses.length ? 'Another course' : 'Find the course'}</button>
      <label class="small mute">Date played<input type="date" id="impDate" value="${date}" max="${dayStr(Date.now())}" /></label>
      <label class="small mute">Name or initials on your row (optional)<input id="pName" value="${esc(s.cardName || '')}" placeholder="e.g. CM" /></label>
      <p class="mute small" style="margin:8px 0 0">Photograph the scoring side flat and well lit. Tip: a small number next to each score (5²) is read as putts, a dot as a fairway hit.</p>
      ${sel ? '<button type="button" class="btn primary big" id="cardBtn" style="margin-top:10px">📷 Take or choose photo</button><input type="file" accept="image/*" id="cardPhoto" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" />' : ''}
    </div>`;
  root.querySelector('[data-x=back]').onclick = roundsHome;
  root.querySelector('[data-x=library]').onclick = () => openLibrary({ toast: ctx.toast, onPicked: (c) => importCard(c?.id, root.querySelector('#impDate')?.value) });
  root.querySelector('#impCourse')?.addEventListener('change', (e) => importCard(e.target.value, root.querySelector('#impDate').value));
  root.querySelector('#cardBtn')?.addEventListener('click', () => root.querySelector('#cardPhoto').click());
  root.querySelector('#cardPhoto')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const player = root.querySelector('#pName').value.trim();
    const d = root.querySelector('#impDate').value || dayStr(Date.now());
    ctx.saveSetting?.('cardName', player);
    const c = await getCourse(root.querySelector('#impCourse').value);
    root.innerHTML = `<div class="busy"><div class="spinner"></div><p>Reading your card…</p></div>`;
    try {
      const data = await readCard({ ...aiFrom(s), images: [await shrink(f)], kind: 'scores', player, holes: c.holes.length });
      confirmCard(c, data, d);
    } catch (err) { ctx.toast(err.message, 6000); importCard(c.id, d); }
  });
}

function confirmCard(c, data, day) {
  const n = c.holes.length;
  const sc = Array.from({ length: n }, (_, i) => data.scores?.[i] ?? null);
  const pt = Array.from({ length: n }, (_, i) => data.putts?.[i] ?? null);
  const fw = Array.from({ length: n }, (_, i) => data.fairway?.[i] ?? null);
  root.innerHTML = `<div class="card"><h2>Check the scores</h2>
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px"><b>${esc(c.name)}${c.tees ? ` <span class="mute">· ${esc(c.tees)}</span>` : ''}</b><input type="date" id="confDate" value="${day}" max="${dayStr(Date.now())}" style="width:auto" /></div>
    <p class="mute small">Read from ${esc(data.player || 'your row')} · confidence ${esc(data.confidence || '?')}${data.notes ? ` · ${esc(data.notes)}` : ''}. Fix anything wrong.</p>
    <div class="cgrid c4"><span>Hole</span><span>Par</span><span>Score</span><span>Putts</span>
    ${c.holes.map((h, i) => `<span class="hn">${i + 1}</span><span class="mute">${h.par}</span><input inputmode="numeric" data-s="${i}" value="${sc[i] ?? ''}" /><input inputmode="numeric" data-p="${i}" value="${pt[i] ?? ''}" />`).join('')}</div>
    <p id="cardTot" class="small"></p>
    <button class="btn primary big" data-ok>Looks right → review bogeys</button></div>`;
  const tot = () => {
    let s = 0, p = 0;
    root.querySelectorAll('[data-s]').forEach((el) => { if (+el.value) { s += +el.value; p += c.holes[+el.dataset.s].par; } });
    root.querySelector('#cardTot').textContent = `Total ${s} (${toParStr(s - p)})`;
  };
  root.querySelectorAll('input').forEach((el) => el.addEventListener('input', tot)); tot();
  root.querySelector('[data-ok]').onclick = async () => {
    const holes = c.holes.map((h, i) => {
      const s = +root.querySelector(`[data-s="${i}"]`).value || null;
      const p = root.querySelector(`[data-p="${i}"]`).value;
      return s == null ? null : { score: s, putts: p === '' ? null : +p, tee: fw[i] === true ? 'FW' : null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [] };
    });
    const dv = root.querySelector('#confDate').value;
    const when = dv ? new Date(`${dv}T12:00:00`).getTime() : Date.now();
    const r = { id: uid('r'), date: when, courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: false, source: 'photo', holes };
    c.lastPlayed = when; await putCourse(c); await putRound(r);
    const first = holes.findIndex((h, i) => h && h.score > c.holes[i].par);
    cur = { round: r, course: c, hole: first < 0 ? 0 : first, review: first >= 0 };
    if (first < 0) { r.finished = true; await putRound(r); return renderSummary(r, c); }
    ctx.toast('Now tag what caused each bogey. Add tee shot and miss direction if you remember.', 5000);
    renderHole();
  };
}

/** Weather saved with the round (start and finish), for the summary and the AI review. */
function wxLine(r) {
  const w = r.cond || {}; if (!w.start && !w.finish) return '';
  const m = isMetric();
  const a = w.start ? condText(w.start, null, m) : '', b = w.finish ? condText(w.finish, null, m) : '';
  return `<p class="mute small" style="margin:8px 0 0">☁ ${a}${b && b !== a ? ` → ${b}` : ''}</p>`;
}

/** Who else is on the card. Names are remembered for next time. */
function playersSheet(round, done) {
  const s = S0(); const known = s.partners || [];
  round.players = round.players || [];
  const n = round.holes.length;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const on = new Set(round.players.map((p) => p.name));
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Who's playing?</b><button class="link" data-close>${round.players.length ? 'Done' : 'Just me'}</button></div>
      <p class="mute small">Their scores go on your card, score and putts only. Your own shot detail stays separate.</p>
      <div class="clubchips">${[...new Set([...known, ...round.players.map((p) => p.name)])].map((k) => `<button class="${on.has(k) ? 'on' : ''}" data-pk="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input id="pNew" placeholder="Add a name" style="flex:1" /><button class="btn" data-padd>Add</button></div>
      <button class="btn primary big" data-ok style="margin-top:10px">${round.players.length ? `Start with ${round.players.map((p) => p.name.split(' ')[0]).join(', ')}` : 'Just me'}</button></div>`;
    const toggle = (name) => { const i = round.players.findIndex((p) => p.name === name); if (i >= 0) round.players.splice(i, 1); else round.players.push({ name, scores: Array(n).fill(null), putts: Array(n).fill(null) }); draw(); };
    sheet.querySelectorAll('[data-pk]').forEach((b) => b.onclick = () => toggle(b.dataset.pk));
    sheet.querySelector('[data-padd]').onclick = () => { const v = sheet.querySelector('#pNew').value.trim(); if (!v) return; if (!known.includes(v)) { known.push(v); s.partners = known; S1(s); } toggle(v); };
    sheet.querySelector('#pNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') sheet.querySelector('[data-padd]').click(); });
    const close = () => { sheet.remove(); done(); };
    sheet.querySelector('[data-close]').onclick = close; sheet.querySelector('[data-ok]').onclick = close;
  };
  draw(); document.body.appendChild(sheet);
}

// ---------------- Summary ----------------
/** What the shot details say to take to practice: flight and strike by shot type. */
function practiceCard(r, c) {
  const by = {};
  r.holes.forEach((h, i) => (h?.shots || []).forEach((x, k) => {
    if (!x.d) return;
    const t = x.d.shot || autoShotType(x, k, c.holes[i]?.par ?? 4);
    const b = (by[t] ||= { n: 0, codes: {} }); b.n++;
    for (const v of [x.d.flight, x.d.strike, x.d.cause]) if (v && v !== 'STR' && v !== 'PUR') b.codes[v] = (b.codes[v] || 0) + 1;
    if (x.ss) b.codes.SS = (b.codes.SS || 0) + 1;
  }));
  const rows = Object.entries(by).filter(([, b]) => Object.keys(b.codes).length);
  if (!rows.length) return '';
  const name = Object.fromEntries(CODES.shot);
  const lab = { ...Object.fromEntries([...CODES.flight, ...CODES.strike, ...CODES.cause]), SS: 'Short-sided' };
  return `<div class="card"><h2>Take to practice</h2>${rows.map(([t, b]) => `<div class="tend"><div><b>${esc(name[t] || t)}</b><div class="mute small">${Object.entries(b.codes).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${esc(lab[k] || k)} ×${v}`).join(' · ')} <span class="mute">(of ${b.n} logged)</span></div></div></div>`).join('')}</div>`;
}

/** Strokes gained card: one bar per category, centred on the tour baseline. */
export function sgCard(G, title, sub = '') {
  if (!G) return '';
  const keys = ['ott', 'app', 'arg', 'putt'];
  const max = Math.max(2, ...keys.map((k) => Math.abs(G[k])));
  const worst = keys.reduce((a, k) => (G[k] < G[a] ? k : a), 'ott');
  return `<div class="card"><div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Strokes gained</h2><span class="sgpill ${G.total >= 0 ? 'pos' : 'neg'}" style="float:none">${G.total >= 0 ? '+' : ''}${G.total.toFixed(1)}</span></div>
    <p class="mute small" style="margin:0 0 10px">${esc(title)}${sub ? ` · ${esc(sub)}` : ''}. Versus a tour-average player, so negative is normal; the biggest bar is where your shots go.</p>
    ${keys.map((k) => `<div class="sgrow"><span>${SG_LABELS[k]}</span><div class="sgbar"><i class="${G[k] >= 0 ? 'pos' : 'neg'}" style="${G[k] >= 0 ? 'left:50%' : `right:50%`};width:${(Math.abs(G[k]) / max) * 50}%"></i></div><b>${G[k] >= 0 ? '+' : ''}${G[k].toFixed(1)}</b></div>`).join('')}
    ${G[worst] < -0.5 ? `<p class="small" style="margin:10px 0 0">Practice priority: <b>${SG_LABELS[worst].toLowerCase()}</b> (${G[worst].toFixed(1)}).</p>` : ''}</div>`;
}

function statsCard(S, title) {
  const isAgg = S.rounds != null;
  const k = isAgg ? S.per18 : 1;
  const f = (x, d = 1) => (isAgg ? (x * k).toFixed(d) : x);
  const missTot = Object.values(S.miss).reduce((a, b) => a + b, 0);
  const costs = (m) => top(m).slice(0, 4).map(([c, v]) => `<span class="pill">${esc(c)} ${isAgg ? (v * k).toFixed(1) : v}</span>`).join('') || '<span class="mute small">none tagged</span>';
  return `<div class="card"><h2>${esc(title)}</h2>
    <div class="kpis">
      <div><b>${isAgg ? `${S.avgToPar >= 0 ? '+' : ''}${S.avgToPar.toFixed(1)}` : `${S.score} <small>${toParStr(S.toPar)}</small>`}</b><span>${isAgg ? 'avg to par' : 'score'}</span></div>
      <div><b>${pct(S.fir, S.firOpp) ?? '–'}%</b><span>fairways</span></div>
      <div><b>${pct(S.gir, S.girOpp) ?? '–'}%</b><span>greens</span></div>
      <div><b>${S.puttsHoles ? (isAgg ? (S.putts * (S.holes / S.puttsHoles) * k).toFixed(1) : S.putts) : '–'}</b><span>putts</span></div>
    </div>
    <div class="statrows">
      <div><span>Tee misses</span><span>${S.teeLeft} left · ${S.teeRight} right${S.teeTrouble ? ` · ${S.teeTrouble} in trouble` : ''}</span></div>
      <div><span>Missed greens</span><span>${missTot ? `${S.miss.S} short · ${S.miss.L} long · ${S.miss.LF} left · ${S.miss.R} right` : '–'}</span></div>
      <div><span>Up and down</span><span>${S.scrOpp ? `${S.scr}/${S.scrOpp} (${pct(S.scr, S.scrOpp)}%)` : '–'}${S.sandOpp ? ` · sand ${S.sand}/${S.sandOpp}` : ''}</span></div>
      <div><span>3-putts</span><span>${f(S.threePutts)}${isAgg ? ' per round' : ''}</span></div>
      <div><span>Birdies · pars · bogeys · doubles+</span><span>${[S.birdies, S.pars, S.bogeys, S.doubles].map((x) => f(x, isAgg ? 1 : 0)).join(' · ')}</span></div>
    </div>
    <div class="lbl" style="margin-top:12px">Strokes lost${isAgg ? ' per round' : ''} by cause</div><div>${costs(S.byCause)}</div>
    <div class="lbl">by shot</div><div>${costs(S.byShot)}</div>
    <div class="lbl">by flight / strike</div><div>${costs(S.byStrike)}</div>
    ${S.untagged ? `<p class="mute small">${f(S.untagged)} dropped stroke${S.untagged === 1 ? '' : 's'} not tagged.</p>` : ''}
  </div>`;
}

async function renderSummary(r, c) {
  const S = roundStats(r, c);
  cur = { round: r, course: c, hole: 0, review: false };
  const half = (from, to) => c.holes.slice(from, to).map((h, i) => {
    const x = r.holes[from + i]; const d = x?.score != null ? x.score - h.par : null;
    return `<td class="${d == null ? '' : d < 0 ? 'b' : d === 0 ? '' : d === 1 ? 'o' : 'oo'}">${x?.score ?? '–'}</td>`;
  }).join('');
  const nine = c.holes.length > 9;
  const prow = (from, to) => (r.players || []).map((p) => `<tr class="pr"><th>${esc(p.name.split(' ')[0])}</th>${c.holes.slice(from, to).map((h, i) => { const v = p.scores[from + i]; const d = v == null ? null : v - h.par; return `<td class="${d == null ? '' : d < 0 ? 'b' : d === 0 ? '' : d === 1 ? 'o' : 'oo'}">${v ?? '–'}</td>`; }).join('')}<td>${c.holes.slice(from, to).reduce((a, h, i) => a + (p.scores[from + i] || 0), 0) || '–'}</td></tr>`).join('');
  root.innerHTML = `
    <button class="btn" data-x="back">‹ Rounds</button>
    <div class="card"><h2>${esc(r.courseName)} <span class="mute small">${fmtD(r.date)}</span></h2>
      <div class="scroll"><table class="card-t"><tr><th>Hole</th>${c.holes.slice(0, 9).map((_, i) => `<th>${i + 1}</th>`).join('')}<th>Out</th></tr>
      <tr><th>Par</th>${c.holes.slice(0, 9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(0, 9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(0, 9)}<td><b>${S.front}</b></td></tr>
      ${prow(0, 9)}
      ${nine ? `<tr><th>Hole</th>${c.holes.slice(9).map((_, i) => `<th>${i + 10}</th>`).join('')}<th>In</th></tr>
      <tr><th>Par</th>${c.holes.slice(9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(9, 18)}<td><b>${S.back}</b></td></tr>
      ${prow(9, 18)}` : ''}</table></div>
      ${(r.players || []).length ? `<p class="mute small" style="margin:8px 0 0">${r.players.map((p) => `${esc(p.name)} ${p.scores.reduce((a, v) => a + (v || 0), 0) || '–'}`).join(' · ')}</p>` : ''}
      ${wxLine(r)}
    </div>
    ${moodLine(r) ? `<p class="mute small center">${esc(moodLine(r))}</p>` : ''}
    ${statsCard(S, `${S.score} (${toParStr(S.toPar)})`)}
    ${practiceCard(r, c)}
    ${(() => { const G = roundSG(r, c); return G && G.complete >= Math.min(9, G.holes) ? sgCard(G, 'This round', G.complete < G.holes ? `${G.complete} of ${G.holes} holes have full shot data` : '') : '<div class="card"><h2>Strokes gained</h2><p class="mute small">Log shot distances and lies (they fill in from the rangefinder) plus the first-putt distance, and strokes gained shows here.</p></div>'; })()}
    ${(() => { const T = tiger5(r, c); return `<div class="card"><div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Tiger 5</h2><span class="sgpill ${T.total <= 6 ? 'pos' : 'neg'}" style="float:none">${T.total}</span></div>
      <p class="mute small" style="margin:0 0 6px">${T.total <= 6 ? 'Six or fewer: a round you can win with.' : 'Over six: these cost the round.'}</p>
      ${T.res.map((x) => `<div class="rule"><span class="${x.holes.length ? 'x' : 'ok'}">${x.holes.length || '✓'}</span><div><b>${TIGER5_LABEL[x.id]}</b>${x.holes.length ? `<div class="mute small">Hole${x.holes.length > 1 ? 's' : ''} ${x.holes.join(', ')}</div>` : ''}</div></div>`).join('')}</div>`; })()}
    ${rulesCard(checkRules(r, c, ctx.settings().roundRules || DEFAULT_RULES), esc)}
    <div class="card debrief"><h2>Debrief</h2>
      <p class="mute small">What really decided this round? The coach reads this alongside the numbers.</p>
      ${c.holes.map((ch, i) => ({ h: r.holes[i], ch, i })).filter(({ h, ch }) => h && h.score - ch.par >= 2).map(({ h, ch, i }) => `<div class="dhole"><b>Hole ${i + 1}: ${h.score} on a par ${ch.par}</b>${(h.tags || []).length ? `<span class="mute small"> · ${esc(h.tags.map((t) => [t.shot, t.cause, t.flight, t.strike, t.result].filter(Boolean).join('/')).join(', '))}</span>` : ''}
        <textarea data-hn="${i}" rows="2" placeholder="What happened on ${i + 1}?">${esc(h.note || '')}</textarea></div>`).join('')}
      <div class="lbl">What cost you most today?</div>
      <div class="dtags">${DEBRIEF_TAGS.map((t) => `<button class="${r.debrief?.tags?.includes(t) ? 'on' : ''}" data-dt="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="lbl">Notes</div>
      <textarea id="debriefNotes" rows="4" placeholder="e.g. Two driver slices into water on 5 and 14. Went for 9 in two when I should have laid up. Putted well.">${esc(r.debrief?.notes || '')}</textarea>
      <p class="mute small" id="dbSaved"></p>
    </div>
    <div class="actions" style="grid-template-columns:1fr 1fr">
      <button class="btn primary" data-x="ai">AI round review</button>
      <button class="btn" data-x="edit">Edit holes</button>
    </div>
    <div id="roundAi" class="card ai" ${r.ai ? '' : 'hidden'}>${r.ai ? md(r.ai) : ''}</div>
    <label class="card check"><input type="checkbox" data-learn ${r.learning !== false ? 'checked' : ''}/> Count toward my coach profile (untick for scrambles, fun rounds)</label>
    <button class="btn" data-x="del" style="width:100%;color:var(--work)">Delete round</button>`;
  root.querySelector('[data-learn]').onchange = (e) => { r.learning = e.target.checked; putRound(r); };
  // debrief autosave
  let dbT = null;
  const saveDb = () => { clearTimeout(dbT); dbT = setTimeout(async () => { await putRound(r); const el = root.querySelector('#dbSaved'); if (el) el.textContent = 'Saved'; }, 600); };
  r.debrief ||= { notes: '', tags: [] };
  root.querySelector('#debriefNotes').addEventListener('input', (e) => { r.debrief.notes = e.target.value; saveDb(); });
  root.querySelectorAll('[data-hn]').forEach((t) => t.addEventListener('input', (e) => { r.holes[+t.dataset.hn].note = e.target.value; saveDb(); }));
  root.querySelectorAll('[data-dt]').forEach((b) => (b.onclick = () => {
    const t = b.dataset.dt, i = r.debrief.tags.indexOf(t);
    if (i >= 0) r.debrief.tags.splice(i, 1); else r.debrief.tags.push(t);
    b.classList.toggle('on'); saveDb();
  }));
  root.querySelectorAll('[data-x]').forEach((b) => b.onclick = async () => {
    const x = b.dataset.x;
    if (x === 'back') return roundsHome();
    if (x === 'edit') { r.finished = false; await putRound(r); cur = { round: r, course: c, hole: 0, review: false }; return renderHole(); }
    if (x === 'del') { await deleteRound(r.id); return roundsHome(); }
    if (x === 'ai') {
      const s = ctx.settings();
      if (!aiReady(s)) return ctx.toast('Add a Claude, ChatGPT or Gemini key in Settings to use the AI coach.', 5000);
      const out = root.querySelector('#roundAi'); out.hidden = false; out.innerHTML = '<p class="mute">Coach is going through your round…</p>';
      try {
        const recent = (await listRounds()).filter((x) => x.finished && x.id !== r.id && x.learning !== false).slice(0, 8);
        const A = await aggStats(recent);
        const swings = await listSwings().catch(() => []);
        const holeLog = r.holes.map((h, i) => h ? `H${i + 1} par ${c.holes[i].par}: ${h.score} (${h.putts ?? '?'} putts${h.tee ? `, tee ${h.tee}` : ''}${h.miss ? `, missed green ${h.miss}` : ''}${h.bunker ? ', bunker' : ''}${(h.tags || []).length ? `, tags: ${h.tags.map((t) => [t.shot, t.cause, t.flight, t.strike, t.result].filter(Boolean).join('/') + (t.cost ? ` +${t.cost}` : ' saved')).join('; ')}` : ''}${(h.shots || []).some((x) => x.d || x.res || x.dist) ? `, shots: ${h.shots.map((x, k) => `${k + 1}${x.lie && x.lie !== 'tee' ? ` from ${x.lie}` : ''}${x.dist ? ` ${Math.round(x.dist)}y` : ''}${x.sw ? ` ${x.sw}` : ''}${x.intent ? ` (planned ${({ D: 'draw', S: 'straight', F: 'fade' })[x.intent]})` : ''}${x.res ? ` → ${x.res}${x.dir ? ` missed ${x.dir}` : ''}${x.ss ? ' short-sided' : ''}` : ''}${x.d ? ` [${[x.d.club, x.d.flight, x.d.strike, x.d.cause, x.d.result].filter(Boolean).join('/')}]` : ''}`).join('; ')}` : ''}${h.note ? `, golfer's note: "${h.note}"` : ''})` : null).filter(Boolean).join('\n');
        const roundText = `${c.name}${c.tees ? ` (${c.tees})` : ''}: ${S.score} (${toParStr(S.toPar)}). ${moodLine(r) ? moodLine(r) + ' (1 = lethargic, 5 = calm/focused ideal, 10 = agitated). ' : ''}${roundSummaryText(aggregate([{ round: r, course: c, stats: S }]))}\nRules the golfer plays by: ${checkRules(r, c, ctx.settings().roundRules || DEFAULT_RULES).map((x) => `${x.label}: ${x.holes.length ? `broken on ${x.holes.join(',')}` : 'kept'}`).join('; ')}.\nHole by hole:\n${holeLog}${r.debrief?.tags?.length || r.debrief?.notes ? `\nGolfer's debrief: ${[...(r.debrief.tags || []), r.debrief.notes].filter(Boolean).join('; ')}` : ''}`;
        const { text, meta } = await reviewRound({ ...aiFrom(s), roundText: `${wxLine(r) ? `Conditions: ${wxLine(r).replace(/<[^>]+>/g, '').replace('☁ ', '')}\n` : ''}${roundText}`, recentText: A ? roundSummaryText(A) : '', history: coachContext(swings, recent.length ? A : null), golfer: [s.golfer, workContext(), await practiceContext().catch(() => ''), await drillContext().catch(() => '')].filter(Boolean).join(' ') });
        r.ai = text; await putRound(r);
        if (meta?.note && r.learning !== false) addCoachNote(`[round] ${String(meta.note).slice(0, 280)}`);
        out.innerHTML = md(text);
      } catch (err) { out.innerHTML = `<p style="color:var(--work)">${esc(err.message)}</p>`; }
    }
  });
  window.scrollTo(0, 0);
}

/** Aggregate of recent learning rounds, for the coach profile and the swing AI. */
export async function recentRoundAggregate(n = 10) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && r.learning !== false).slice(0, n);
  return aggStats(rounds);
}

// Downscale a photo to keep API calls small and fast.
async function shrink(file, max = 1800) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

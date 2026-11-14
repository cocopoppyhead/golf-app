// Rounds module UI: courses, hole-by-hole logging (Conor's shot codes), scorecard photo import, summaries.
import { CODES, played } from './stats.js';
import { getSettings as S0, saveSettings as S1 } from '../store.js';

import { putRound, getRound, deleteRound, listRounds, putCourse, getCourse, listCourses, deleteCourse } from '../store.js';
import { readCard, aiFrom, aiReady } from '../coach/ai.js';

import { dist, toYards, du, duLong, puttBand } from '../units.js';

import { holeSG } from './sg.js';
import { initLaserLoop, syncLoopConfig } from './laserloop.js';
import { getBag, resolveClub } from '../bag.js';
import { listShots } from '../store.js';



import { loadGeo, geoHole, mountHoleMap, markedHole, markHoleSheet } from './holemap.js';
import { icon } from '../icons.js';
import { approachBands } from './bands.js';
import { INTENTIONS, intentionLabel } from './intentions.js';
export { MOOD_WORDS, moodLine } from './intentions.js';
import { LIE_DETAIL, PENALTY_RES, TROUBLE_OPTIONS, troubleCodes, ensurePutts, syncPutts, asPlanned, autoSwing, autoShotType, blankHole, ensureShots, defaultLie, derive, nextBogeyFrom, holeGaps } from './hole.js';
import { shotPanel, shotLine, puttPanel, holeDone, routeStrip, zoneOf, usualTeeClub, clubForDistance } from './shotpanel.js';
export { SWING_TYPES, INTENT, autoShotType } from './hole.js';
import { removeSummary } from '../cloud/social.js';
import { initScoreImport, quickSummary, shrink } from './scoreimport.js';
import { initSummary, renderSummary, playersSheet } from './summary.js';
export { sgCard } from './summary.js';



import { esc, uid, fmtD } from './fmt.js';
import { ribbonHtml, cardHtml, courseHistory, historyLine } from './ribbon.js';
import { counts } from './quality.js';
import { initHome, roundsHome, openCardImport, openCoursePage, aggStats } from './home.js';
import { routineSheet, readWeather, moodSheet } from './checkinsheets.js';
export { roundsHome, openCardImport, openCoursePage };

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
  initHome({ get root() { return root; }, get ctx() { return ctx; }, cur: () => cur, setCur: (c) => { cur = c; }, startRound, openRound, editCourse, effectiveClubs, bestBandCached, endRoundSheet, discardSheet });
  initScoreImport({ get root() { return root; }, get ctx() { return ctx; }, home: roundsHome, summary: renderSummary, review: (r, c, hole) => { cur = { round: r, course: c, hole, review: true }; renderHole(); } });
  initSummary({ get root() { return root; }, get ctx() { return ctx; }, home: roundsHome, aggStats, setCur: (r, c) => { cur = { round: r, course: c, hole: 0, review: false }; }, reopen: (r, c, hole = 0) => { cur = { round: r, course: c, hole, review: false }; renderHole(); }, submit: (r, c) => endRound(r, c, { submit: true }) });
}

// ---------------- Rangefinder → shot card ----------------
// Each lock-on during an open round becomes a shot with distance, plays-like, suggested club and a GPS
// fix, shown on a card the moment it arrives (rounds/laserloop.js). GPS decides when you've moved on.
initLaserLoop({ getCur: () => cur, toast: (t) => ctx.toast?.(t), renderHole: () => { if (cur && root?.isConnected) renderHole(); }, blankHole: () => blankHole(), ensureShots });

// ---------------- Previous plays of this hole ----------------
let histCache = { key: '', rows: null };
// ---------------- The ribbon (ribbon.js): usual score per hole on this course, from rounds that count ----------------
let ribbonHist = { key: '', hists: [] };
const histKey = (course, round) => `${course.libId || course.id}:${round.id}`;
const golferName = () => { const st = ctx.settings() || {}; return st.nickname || (st.name || '').split(' ')[0] || 'You'; };
async function loadRibbonHistory(course, round) {
  const key = histKey(course, round);
  if (ribbonHist.key === key) return ribbonHist.hists;
  const [rounds, courses] = await Promise.all([listRounds().catch(() => []), listCourses().catch(() => [])]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const same = (c) => c && (course.libId ? c.libId === course.libId : c.id === course.id);
  const rows = rounds.filter((r) => r.id !== round.id && !r.quick && same(byId.get(r.courseId)) && counts(r, byId.get(r.courseId)))
    .sort((a, b) => b.date - a.date).map((r) => ({ r, c: byId.get(r.courseId) }));
  ribbonHist = { key, hists: courseHistory(rows, course.holes.map((x) => x.par)) };
  return ribbonHist.hists;
}
function openCard() {
  const { round, course, hole } = cur;
  const el = document.createElement('div');
  el.innerHTML = cardHtml({ i: hole, pars: course.holes.map((x) => x.par), scores: round.holes.map((x) => x?.score ?? null), name: golferName(), courseName: round.courseName, hists: ribbonHist.key === histKey(course, round) ? ribbonHist.hists : null });
  const sheet = el.firstElementChild; document.body.appendChild(sheet);
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  sheet.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { sheet.remove(); root.querySelector(`.rb-sc [data-go="${b.dataset.go}"]`)?.click() || goHole(+b.dataset.go); });
}
let goHole = () => {};
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
    <div class="holebar rb-bar">
      <button class="btn icon" data-h="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      ${ribbonHtml({ i, pars: course.holes.map((x) => x.par), scores: round.holes.map((x) => x?.score ?? null), name: golferName(), hist: ribbonHist.key === histKey(course, round) ? ribbonHist.hists[i] : null })}
      <button class="btn icon" data-h="next">›</button>
    </div>
    <p class="mute small center">${esc(round.courseName)}${ch.si ? ` · SI ${ch.si}` : ''}${review ? ' · reviewing bogeys' : ''}</p>
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
  root.querySelectorAll('[data-pmside]').forEach((b) => b.onclick = () => { const p = putt(+b.dataset.pmside); p.mside = p.mside === b.dataset.v ? null : b.dataset.v; reputt(); });
  root.querySelectorAll('[data-pmlen]').forEach((b) => b.onclick = () => { const p = putt(+b.dataset.pmlen); p.mlen = p.mlen === b.dataset.v ? null : b.dataset.v; reputt(); });
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
  goHole = (k) => { commit(); save(); cur.hole = k; renderHole(); };
  root.querySelectorAll('[data-go]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); goHole(+b.dataset.go); });
  root.querySelector('[data-card]')?.addEventListener('click', openCard);
  if (ribbonHist.key !== histKey(course, round)) {
    const at = { round: round.id, hole: i };
    loadRibbonHistory(course, round).then((hs) => { const el = root.querySelector('[data-hist]'); if (el && cur?.round.id === at.round && cur.hole === at.hole) el.innerHTML = historyLine(hs[i], par); }).catch(() => {});
  }
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

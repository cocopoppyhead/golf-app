// Rounds module UI: courses, hole-by-hole logging (Conor's shot codes), scorecard photo import, summaries.
import { CODES, TEE_ZONES, MISS, isGir, roundStats, aggregate, roundTendencies, roundSummaryText, pct, top, played } from './stats.js';
import { openLibrary } from './library.js';
import { putRound, getRound, deleteRound, listRounds, putCourse, getCourse, listCourses, deleteCourse, listSwings } from '../store.js';
import { readCard, reviewRound, md, aiFrom, aiReady } from '../coach/ai.js';
import { coachContext, addCoachNote } from '../coach/profile.js';
import { dist, toYards, du, duLong, PUTT_FT, puttLabel, puttUnit } from '../units.js';
import { checkRules, rulesCard, DEFAULT_RULES } from './tiger.js';

const DEBRIEF_TAGS = ['Driver into trouble', 'Risky shot choice', 'Approach misses', 'Short game', '3-putts', 'Lost focus', 'Back problem', 'Tired', 'Wind / conditions', 'Bad luck'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const toParStr = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

let ctx = { settings: () => ({}), toast: () => {} };
let root;
let cur = null; // { round, course, hole, review }

export function initRounds(el, opts) { root = el; ctx = { ...ctx, ...opts }; }

// ---------------- Home ----------------
export async function roundsHome() {
  cur = null;
  const [rounds, courses] = await Promise.all([listRounds().catch(() => []), listCourses().catch(() => [])]);
  const open = rounds.find((r) => !r.finished);
  const done = rounds.filter((r) => r.finished);
  await aggStats(done); // attaches per-round stats for the list
  const A = await aggStats(done.filter((r) => r.learning !== false).slice(0, 10));
  const tend = roundTendencies(A);
  root.innerHTML = `
    ${open ? `<div class="card event-card"><b>Round in progress</b><p class="mute small">${esc(open.courseName)} · ${fmtD(open.date)} · ${played(open).length} holes logged</p><button class="btn primary" data-act="resume" data-id="${open.id}">Resume round</button></div>` : ''}
    <div class="card">
      <h2>Play a round</h2>
      ${courses.length ? `<label class="small mute">Course</label><select id="courseSel">${courses.map((c) => `<option value="${c.id}">${esc(c.name)}${c.tees ? ` · ${esc(c.tees)}` : ''} (par ${c.holes.reduce((a, h) => a + h.par, 0)})</option>`).join('')}</select>` : '<p class="mute">Pick your course from the UAE list and the scorecard fills in.</p>'}
      <button class="btn ${courses.length ? '' : 'primary'}" data-act="library" style="width:100%;margin-top:10px">🇦🇪 Find a UAE course</button>
      <div class="row" style="margin-top:8px">
        <button class="btn" data-act="newcourse">+ Course by hand</button>
        ${courses.length ? '<button class="btn" data-act="editcourse">Edit course</button>' : ''}
      </div>
      ${courses.length ? `<button class="btn primary big" data-act="start" style="margin-top:10px">Start logging hole 1</button>
      <button class="btn" data-act="import" style="width:100%;margin-top:8px">📷 Already played? Import scorecard photo</button>` : ''}
    </div>
    ${A ? statsCard(A, `Last ${A.rounds} round${A.rounds > 1 ? 's' : ''}`) : ''}
    ${tend.length ? `<div class="card"><h2>On the course</h2>${tend.slice(0, 5).map((t) => `<div class="tend"><div><b>${esc(t.text)}</b><div class="mute small">${esc(t.detail)}</div></div></div>`).join('')}<p class="mute small">These feed your coach alongside your swing tendencies.</p></div>` : ''}
    ${done.length ? `<h2 style="margin:18px 0 8px">Rounds</h2>` + done.map((r) => {
      const s = r._stats;
      return `<div class="hist" data-act="open" data-id="${r.id}"><div class="sc">${s ? s.score : '–'}</div><div><div class="t">${esc(r.courseName)} ${s ? `<span class="mute">${toParStr(s.toPar)}</span>` : ''}</div><div class="s">${fmtD(r.date)}${s ? ` · ${s.putts} putts · FIR ${pct(s.fir, s.firOpp) ?? '–'}% · GIR ${pct(s.gir, s.girOpp) ?? '–'}%` : ''}${r.learning === false ? ' · not counted' : ''}</div></div><div class="mute">›</div></div>`;
    }).join('') : ''}`;
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => homeAction(b.dataset.act, b.dataset.id)));
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
  if (act === 'resume' || act === 'open') return openRound(id);
  if (act === 'newcourse') return editCourse(null);
  if (act === 'library') return openLibrary({ toast: ctx.toast, onPicked: () => roundsHome() });
  if (act === 'editcourse') return editCourse(sel);
  if (act === 'start') {
    const c = await getCourse(sel);
    const r = { id: uid('r'), date: Date.now(), courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: false, holes: c.holes.map(() => null) };
    c.lastPlayed = Date.now(); await putCourse(c);
    await putRound(r);
    cur = { round: r, course: c, hole: 0, review: false };
    return renderHole();
  }
  if (act === 'import') return importCard(sel);
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
      if (x === 'back') return roundsHome();
      sync();
      if (x === 'h18' || x === 'h9') { const n = x === 'h18' ? 18 : 9; c.holes = Array.from({ length: n }, (_, i) => c.holes[i] || { par: 4, si: null, yds: null }); return draw(); }
      if (x === 'photo') return root.querySelector('#coursePhoto').click();
      if (x === 'save') {
        if (!c.name) return ctx.toast('Give the course a name.');
        await putCourse(c); ctx.toast('Course saved'); return roundsHome();
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
  if (r.finished) return renderSummary(r, c);
  const next = r.holes.findIndex((h) => !h || h.score == null);
  cur = { round: r, course: c, hole: next < 0 ? r.holes.length - 1 : next, review: false };
  renderHole();
}

const save = () => putRound(cur.round).catch(() => {});

function renderHole() {
  const { round, course, hole: i, review } = cur;
  const ch = course.holes[i];
  const par = ch.par;
  const h = round.holes[i] || (round.holes[i] = { score: null, putts: null, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [] });
  const score = h.score ?? par;
  const putts = h.putts ?? 2;
  const g = isGir({ ...h, score, putts }, par);
  const diff = score - par;
  const tagCost = (h.tags || []).reduce((a, t) => a + (t.cost || 0), 0);
  const needTag = diff > 0 && tagCost < diff;
  const tot = round.holes.reduce((a, x, k) => (x && x.score != null ? { s: a.s + x.score, p: a.p + course.holes[k].par } : a), { s: 0, p: 0 });

  root.innerHTML = `
    <div class="holebar">
      <button class="btn icon" data-h="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      <div class="hinfo"><div class="hnum">Hole ${i + 1}</div><div class="mute small">Par ${par}${ch.si ? ` · SI ${ch.si}` : ''}${ch.yds ? ` · ${dist(ch.yds)} ${du()}` : ''}</div></div>
      <button class="btn icon" data-h="next">›</button>
    </div>
    <div class="holedots">${round.holes.map((x, k) => `<i class="${k === i ? 'on' : ''} ${x && x.score != null ? (x.score < course.holes[k].par ? 'b' : x.score === course.holes[k].par ? 'p' : 'o') : ''}" data-go="${k}"></i>`).join('')}</div>
    <p class="mute small center">${esc(round.courseName)} · ${tot.s ? `${tot.s} (${toParStr(tot.s - tot.p)}) thru ${played(round).length}` : 'not started'}${review ? ' · reviewing bogeys' : ''}</p>

    <div class="card">
      <div class="lbl">Score</div>
      <div class="stepper big"><button data-sc="-1">−</button><span class="${diff < 0 ? 'under' : diff > 0 ? 'over' : ''}">${score}</span><button data-sc="1">+</button></div>
      <div class="lbl">Putts</div>
      <div class="seg5">${[0, 1, 2, 3, 4].map((n) => `<button class="${putts === n ? 'on' : ''}" data-pt="${n}">${n}${n === 4 ? '+' : ''}</button>`).join('')}</div>
      ${putts >= 1 ? `<div class="lbl">1st putt <span class="mute">(${puttUnit()}, optional)</span></div><div class="seg5 sm">${PUTT_FT.map((n) => `<button class="${h.firstPutt === n ? 'on' : ''}" data-fp="${n}">${puttLabel(n)}</button>`).join('')}</div>` : ''}
    </div>

    ${par >= 4 ? `<div class="card"><div class="lbl">Tee shot</div>
      <div class="zones">${TEE_ZONES.map(([k, l]) => `<button class="${h.tee === k ? 'on' : ''} z${k}" data-tee="${k}">${k[0] === 'L' ? '◀ ' : ''}${l}${k[0] === 'R' ? ' ▶' : ''}</button>`).join('')}</div></div>` : ''}

    <div class="card">
      <div class="lbl">Green <span class="badge ${g ? 'good' : 'bad'}">${g ? 'GIR ✓' : 'Missed green'}</span> <button class="link" data-gir="1">${h.gir == null ? 'auto' : 'manual'} · change</button></div>
      ${!g ? `<div class="seg4">${MISS.map(([k, l]) => `<button class="${h.miss === k ? 'on' : ''}" data-miss="${k}">${l}</button>`).join('')}</div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-bunker ${h.bunker ? 'checked' : ''}/> Green-side bunker</label>
      <p class="mute small">${score <= par ? (h.bunker ? 'Sand save ✓' : 'Up and down ✓') : 'No up and down'}</p>` : ''}
    </div>

    <div class="card ${needTag ? 'needtag' : ''}">
      <div class="lbl">${diff > 0 ? `${diff === 1 ? 'Bogey' : diff === 2 ? 'Double' : `+${diff}`}: what caused it?` : 'Bad shot you got away with? (optional)'}</div>
      ${(h.tags || []).map((t, k) => `<div class="tagrow"><span>${esc([t.shot, t.cause, t.strike, t.result].filter(Boolean).join(' · '))} ${t.cost ? `<b>+${t.cost}</b>` : '<span class="mute">saved it</span>'}</span><button class="link" data-deltag="${k}">remove</button></div>`).join('')}
      ${needTag ? `<p class="mute small">${diff - tagCost} stroke${diff - tagCost > 1 ? 's' : ''} not explained yet.</p>` : ''}
      <button class="btn" data-addtag="1" style="width:100%">+ ${diff > 0 ? 'Tag the shot' : 'Tag a saved shot'}</button>
      ${diff > 0 || h.note ? `<textarea class="hnote" data-note rows="2" placeholder="What happened? e.g. went for the green over water, should have laid up">${esc(h.note || '')}</textarea>` : ''}
    </div>

    <div class="row">
      ${i === course.holes.length - 1 || (review && nextBogey(i) < 0) ? '<button class="btn primary big" data-h="finish">Finish round</button>' : `<button class="btn primary big" data-h="next">${review ? 'Next bogey ›' : `Hole ${i + 2} ›`}</button>`}
    </div>
    <label class="check small" style="margin-top:12px"><input type="checkbox" data-learn ${round.learning !== false ? 'checked' : ''}/> Count this round toward my coach profile</label>
    <button class="link" data-h="home" style="margin-top:10px">Save & exit</button>`;

  const commit = () => { h.score = score; h.putts = putts; };
  root.querySelectorAll('[data-sc]').forEach((b) => b.onclick = () => { h.score = Math.max(1, score + +b.dataset.sc); h.putts = putts; save(); renderHole(); });
  root.querySelectorAll('[data-pt]').forEach((b) => b.onclick = () => { h.putts = +b.dataset.pt; h.score = Math.max(score, h.putts + 1); save(); renderHole(); });
  root.querySelectorAll('[data-fp]').forEach((b) => b.onclick = () => { commit(); h.firstPutt = h.firstPutt === +b.dataset.fp ? null : +b.dataset.fp; save(); renderHole(); });
  root.querySelectorAll('[data-tee]').forEach((b) => b.onclick = () => { commit(); h.tee = h.tee === b.dataset.tee ? null : b.dataset.tee; save(); renderHole(); });
  root.querySelectorAll('[data-miss]').forEach((b) => b.onclick = () => { commit(); h.miss = h.miss === b.dataset.miss ? null : b.dataset.miss; save(); renderHole(); });
  root.querySelector('[data-bunker]')?.addEventListener('change', (e) => { commit(); h.bunker = e.target.checked; save(); renderHole(); });
  root.querySelector('[data-gir]').onclick = () => { commit(); h.gir = h.gir == null ? !g : null; save(); renderHole(); };
  root.querySelector('[data-learn]').onchange = (e) => { round.learning = e.target.checked; save(); };
  root.querySelector('[data-note]')?.addEventListener('input', (e) => { h.note = e.target.value; clearTimeout(window.__noteT); window.__noteT = setTimeout(save, 500); });
  root.querySelectorAll('[data-deltag]').forEach((b) => b.onclick = () => { h.tags.splice(+b.dataset.deltag, 1); save(); renderHole(); });
  root.querySelector('[data-addtag]').onclick = () => { commit(); tagSheet(h, par, i, diff - tagCost); };
  root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { commit(); save(); cur.hole = +b.dataset.go; renderHole(); });
  root.querySelectorAll('[data-h]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.h;
    commit(); await save();
    if (a === 'prev') { cur.hole = Math.max(0, i - 1); return renderHole(); }
    if (a === 'next') {
      if (review) { const n = nextBogey(i); cur.hole = n < 0 ? i : n; }
      else cur.hole = Math.min(course.holes.length - 1, i + 1);
      window.scrollTo(0, 0); return renderHole();
    }
    if (a === 'finish') { round.finished = true; await save(); return renderSummary(round, course); }
    if (a === 'home') return roundsHome();
  });
}

function nextBogey(i) {
  const { round, course } = cur;
  for (let k = i + 1; k < round.holes.length; k++) { const x = round.holes[k]; if (x && x.score > course.holes[k].par) return k; }
  return -1;
}

/** Bottom sheet for tagging one bad shot with Conor's codes. */
function tagSheet(h, par, i, unexplained) {
  const t = { shot: null, cause: null, strike: null, result: null, cost: unexplained > 0 ? Math.min(2, unexplained) : 0 };
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const row = (k, list) => `<div class="lbl">${{ shot: 'Shot', cause: 'Cause', strike: 'Flight / strike', result: 'Ended up' }[k]}</div><div class="codes">${list.map(([c, l]) => `<button class="${t[k] === c ? 'on' : ''}" data-k="${k}" data-v="${c}">${c}${l ? `<small>${l}</small>` : ''}</button>`).join('')}</div>`;
    sheet.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Tag a shot · hole ${i + 1}</b><button class="link" data-close>Cancel</button></div>
      ${row('shot', CODES.shot)}${row('cause', CODES.cause)}${row('strike', CODES.strike)}${row('result', CODES.result)}
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

// ---------------- Scorecard photo import ----------------
async function importCard(courseId) {
  const s = ctx.settings();
  if (!aiReady(s)) return ctx.toast('Reading a scorecard uses AI. Add a Claude, ChatGPT or Gemini key in Settings.', 5000);
  const c = await getCourse(courseId);
  root.innerHTML = `<button class="btn" data-x="back">‹ Back</button>
    <div class="card"><h2>Import scorecard</h2><p class="mute">${esc(c.name)}. Photograph the card flat and well lit. Tip: write putts as a small number next to each score (5²) and a dot for a fairway hit, and it reads those too.</p>
    <label class="small mute">Name or initials on your row (optional)<input id="pName" value="${esc(s.cardName || '')}" /></label>
    <label class="btn primary big" for="cardPhoto" style="margin-top:10px">📷 Take or choose photo</label><input type="file" accept="image/*" id="cardPhoto" hidden /></div>`;
  root.querySelector('[data-x]').onclick = roundsHome;
  root.querySelector('#cardPhoto').onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const player = root.querySelector('#pName').value.trim();
    ctx.saveSetting?.('cardName', player);
    root.innerHTML = `<div class="busy"><div class="spinner"></div><p>Reading your card…</p></div>`;
    try {
      const data = await readCard({ ...aiFrom(s), images: [await shrink(f)], kind: 'scores', player, holes: c.holes.length });
      confirmCard(c, data);
    } catch (err) { ctx.toast(err.message, 6000); importCard(courseId); }
  };
}

function confirmCard(c, data) {
  const n = c.holes.length;
  const sc = Array.from({ length: n }, (_, i) => data.scores?.[i] ?? null);
  const pt = Array.from({ length: n }, (_, i) => data.putts?.[i] ?? null);
  const fw = Array.from({ length: n }, (_, i) => data.fairway?.[i] ?? null);
  root.innerHTML = `<div class="card"><h2>Check the scores</h2>
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
    const r = { id: uid('r'), date: Date.now(), courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: false, source: 'photo', holes };
    c.lastPlayed = Date.now(); await putCourse(c); await putRound(r);
    const first = holes.findIndex((h, i) => h && h.score > c.holes[i].par);
    cur = { round: r, course: c, hole: first < 0 ? 0 : first, review: first >= 0 };
    if (first < 0) { r.finished = true; await putRound(r); return renderSummary(r, c); }
    ctx.toast('Now tag what caused each bogey. Add tee shot and miss direction if you remember.', 5000);
    renderHole();
  };
}

// ---------------- Summary ----------------
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
  root.innerHTML = `
    <button class="btn" data-x="back">‹ Rounds</button>
    <div class="card"><h2>${esc(r.courseName)} <span class="mute small">${fmtD(r.date)}</span></h2>
      <div class="scroll"><table class="card-t"><tr><th>Hole</th>${c.holes.slice(0, 9).map((_, i) => `<th>${i + 1}</th>`).join('')}<th>Out</th></tr>
      <tr><th>Par</th>${c.holes.slice(0, 9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(0, 9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(0, 9)}<td><b>${S.front}</b></td></tr>
      ${nine ? `<tr><th>Hole</th>${c.holes.slice(9).map((_, i) => `<th>${i + 10}</th>`).join('')}<th>In</th></tr>
      <tr><th>Par</th>${c.holes.slice(9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(9, 18)}<td><b>${S.back}</b></td></tr>` : ''}</table></div>
    </div>
    ${statsCard(S, `${S.score} (${toParStr(S.toPar)})`)}
    ${rulesCard(checkRules(r, c, ctx.settings().roundRules || DEFAULT_RULES), esc)}
    <div class="card debrief"><h2>Debrief</h2>
      <p class="mute small">What really decided this round? The coach reads this alongside the numbers.</p>
      ${c.holes.map((ch, i) => ({ h: r.holes[i], ch, i })).filter(({ h, ch }) => h && h.score - ch.par >= 2).map(({ h, ch, i }) => `<div class="dhole"><b>Hole ${i + 1}: ${h.score} on a par ${ch.par}</b>${(h.tags || []).length ? `<span class="mute small"> · ${esc(h.tags.map((t) => [t.shot, t.cause, t.strike, t.result].filter(Boolean).join('/')).join(', '))}</span>` : ''}
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
        const holeLog = r.holes.map((h, i) => h ? `H${i + 1} par ${c.holes[i].par}: ${h.score} (${h.putts ?? '?'} putts${h.tee ? `, tee ${h.tee}` : ''}${h.miss ? `, missed green ${h.miss}` : ''}${h.bunker ? ', bunker' : ''}${(h.tags || []).length ? `, tags: ${h.tags.map((t) => [t.shot, t.cause, t.strike, t.result].filter(Boolean).join('/') + (t.cost ? ` +${t.cost}` : ' saved')).join('; ')}` : ''}${h.note ? `, golfer's note: "${h.note}"` : ''})` : null).filter(Boolean).join('\n');
        const roundText = `${c.name}${c.tees ? ` (${c.tees})` : ''}: ${S.score} (${toParStr(S.toPar)}). ${roundSummaryText(aggregate([{ round: r, course: c, stats: S }]))}\nRules the golfer plays by: ${checkRules(r, c, ctx.settings().roundRules || DEFAULT_RULES).map((x) => `${x.label}: ${x.holes.length ? `broken on ${x.holes.join(',')}` : 'kept'}`).join('; ')}.\nHole by hole:\n${holeLog}${r.debrief?.tags?.length || r.debrief?.notes ? `\nGolfer's debrief: ${[...(r.debrief.tags || []), r.debrief.notes].filter(Boolean).join('; ')}` : ''}`;
        const { text, meta } = await reviewRound({ ...aiFrom(s), roundText, recentText: A ? roundSummaryText(A) : '', history: coachContext(swings, recent.length ? A : null), golfer: s.golfer });
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

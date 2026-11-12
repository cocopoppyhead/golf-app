// Rounds without hole data: post a total (course, tees, date, gross, putts) or import a photo of a
// scorecard (declare course and date, the AI reads your row, you check it, then tag the bogeys).
// Shares the Play root with rounds/ui.js through `api`: { root, ctx, home(), review(round, course, hole), summary(round, course) }.
import { openLibrary, isHome, starred } from './library.js';
import { differential } from './handicap.js';
import { putRound, deleteRound, putCourse, getCourse, listCourses } from '../store.js';
import { readCard, aiFrom, aiReady } from '../coach/ai.js';
import { icon } from '../icons.js';
import { removeSummary } from '../cloud/social.js';

// a posted or imported round: look up the weather on that day straight away
const wxSoon = () => import('../garmin/ui.js').then((m) => m.backfillWeather({ limit: 5 })).catch(() => {});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const toParStr = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

let api = null;
const dayStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function initScoreImport(a) { api = a; }

// ---------------- Post a score (total only) ----------------
// For rounds you didn't log hole by hole: course, tees, date, gross score. Enough for the handicap
// trend and scoring average; nothing for strokes gained or Tiger 5.
export async function postScore(courseId, pre = {}) {
  const allCourses = await listCourses().catch(() => []);
  const st = starred();
  const courses = allCourses.map((c, i) => ({ c, i })).sort((a, b) => ((isHome(a.c) ? 0 : st.has(a.c.libId) ? 1 : 2) - (isHome(b.c) ? 0 : st.has(b.c.libId) ? 1 : 2)) || a.i - b.i).map((x) => x.c);
  const sel = courses.find((c) => c.id === (pre.courseId || courseId)) || courses[0] || null;
  const x = { date: pre.date || dayStr(Date.now()), score: pre.score ?? '', putts: pre.putts ?? '', holesPlayed: pre.holesPlayed || 18 };
  api.root.innerHTML = `<button class="btn" data-x="back">‹ Back</button>
    <div class="card"><h2>${pre.id ? 'Edit score' : 'Post a score'}</h2>
      <p class="mute small">A round you didn't log hole by hole. Counts for your handicap and scoring average.</p>
      <label class="small mute">Course and tees${courses.length ? `<select id="psCourse">${courses.map((c) => `<option value="${c.id}" ${sel && c.id === sel.id ? 'selected' : ''}>${esc(c.name)}${c.tees ? ` · ${esc(c.tees)}` : ''}${c.rating ? ` (${c.rating}/${c.slope})` : ''}</option>`).join('')}</select>` : '<p class="mute" style="margin:4px 0">No courses yet.</p>'}</label>
      <button class="btn" data-x="library" style="width:100%;margin:6px 0 10px">${icon('search')} ${courses.length ? 'Another course or tee' : 'Find the course'}</button>
      ${sel && !(sel.rating && sel.slope) ? '<p class="small" style="color:var(--work);margin:-4px 0 8px">This course has no rating/slope, so the score won\'t count toward your handicap. Add them in Edit course.</p>' : ''}
      <label class="small mute">Date played<input type="date" id="psDate" value="${x.date}" max="${dayStr(Date.now())}" /></label>
      <div class="row"><label class="small mute" style="flex:1">Gross score<input id="psScore" inputmode="numeric" value="${x.score}" placeholder="e.g. 79" /></label><label class="small mute" style="flex:1">Putts (optional)<input id="psPutts" inputmode="numeric" value="${x.putts}" placeholder="e.g. 31" /></label></div>
      <div class="seg seg2 mini" style="margin:6px 0 10px"><button data-h="18" class="${x.holesPlayed === 18 ? 'on' : ''}">18 holes</button><button data-h="9" class="${x.holesPlayed === 9 ? 'on' : ''}">9 holes</button></div>
      <p class="mute small" id="psDiff"></p>
      ${sel ? '<button class="btn primary big" data-x="save">Save score</button>' : ''}
      ${pre.id ? '<button class="btn" data-x="del" style="width:100%;margin-top:8px;color:var(--work)">Delete</button>' : ''}
    </div>`;
  const q = (s) => api.root.querySelector(s);
  const showDiff = () => {
    const c = courses.find((k) => k.id === q('#psCourse')?.value) || sel; const sc = +q('#psScore').value;
    const d = c && x.holesPlayed === 18 ? differential(sc, c.rating, c.slope) : null;
    q('#psDiff').textContent = sc && c ? `${sc} on ${c.name}${c.tees ? ` (${c.tees})` : ''}${d != null ? ` · differential ${d.toFixed(1)}` : x.holesPlayed === 9 ? ' · 9-hole scores don\'t count toward the index here' : ''}` : '';
  };
  q('[data-x=back]').onclick = api.home;
  q('[data-x=library]').onclick = () => openLibrary({ pickTee: true, toast: api.ctx.toast, onPicked: (c) => postScore(c?.id, { ...pre, ...read(), courseId: c?.id }) });
  const read = () => ({ courseId: q('#psCourse')?.value, date: q('#psDate').value, score: q('#psScore').value, putts: q('#psPutts').value, holesPlayed: x.holesPlayed });
  q('#psCourse')?.addEventListener('change', () => postScore(q('#psCourse').value, { ...pre, ...read() }));
  api.root.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { x.holesPlayed = +b.dataset.h; api.root.querySelectorAll('[data-h]').forEach((k) => k.classList.toggle('on', k === b)); showDiff(); });
  q('#psScore').addEventListener('input', showDiff); showDiff();
  q('[data-x=del]')?.addEventListener('click', async () => { await deleteRound(pre.id); removeSummary(pre.id).catch(() => {}); api.ctx.toast('Deleted.'); api.home(); });
  q('[data-x=save]')?.addEventListener('click', async () => {
    const c = await getCourse(q('#psCourse').value);
    const score = +q('#psScore').value, putts = q('#psPutts').value === '' ? null : +q('#psPutts').value;
    const lo = x.holesPlayed === 9 ? 25 : 50, hi = x.holesPlayed === 9 ? 80 : 150;
    if (!(score >= lo && score <= hi)) return api.ctx.toast(`Score should be between ${lo} and ${hi}.`);
    const dv = q('#psDate').value; const when = dv ? new Date(`${dv}T12:00:00`).getTime() : Date.now();
    const r = { id: pre.id || uid('r'), date: when, courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: true, quick: true, source: 'post', holesPlayed: x.holesPlayed, score, putts, holes: [],
      diff: x.holesPlayed === 18 ? differential(score, c.rating, c.slope) : null };
    c.lastPlayed = Math.max(c.lastPlayed || 0, when); await putCourse(c); await putRound(r); wxSoon();
    api.ctx.toast(`Saved: ${score} at ${c.name}${r.diff != null ? ` · diff ${r.diff.toFixed(1)}` : ''}`);
    api.home();
  });
}

export async function quickSummary(r, c) {
  const par = c.holes.slice(0, r.holesPlayed || 18).reduce((a, h) => a + h.par, 0);
  api.root.innerHTML = `<button class="btn" data-x="back">‹ Rounds</button>
    <div class="card"><h2>${esc(r.courseName)} <span class="mute small">${fmtD(r.date)}</span></h2>
      <div class="kpis"><div><b>${r.score}</b><span>${toParStr(r.score - par)} · ${r.holesPlayed || 18} holes</span></div><div><b>${r.diff != null ? r.diff.toFixed(1) : '–'}</b><span>differential</span></div><div><b>${r.putts ?? '–'}</b><span>putts</span></div></div>
      <p class="mute small">${esc(c.tees || '')}${c.rating ? ` · rating ${c.rating} / slope ${c.slope}` : ' · no rating/slope, so not in the handicap'}. Score only: no shot-by-shot stats for this round.</p>
      <div class="row"><button class="btn" data-x="edit">Edit</button></div></div>`;
  api.root.querySelector('[data-x=back]').onclick = api.home;
  api.root.querySelector('[data-x=edit]').onclick = () => postScore(r.courseId, { id: r.id, courseId: r.courseId, date: dayStr(r.date), score: r.score, putts: r.putts ?? '', holesPlayed: r.holesPlayed || 18 });
}

// ---------------- Scorecard photo import ----------------
// The scoring side of a card rarely shows the course or the date, so you declare both here first.
export async function importCard(courseId, when = null) {
  const s = api.ctx.settings();
  if (!aiReady(s)) return api.ctx.toast('Reading a scorecard uses AI. Add a Claude, ChatGPT or Gemini key in Settings.', 5000);
  const allCourses = await listCourses().catch(() => []);
  const st = starred();
  const courses = allCourses.map((c, i) => ({ c, i })).sort((a, b) => ((isHome(a.c) ? 0 : st.has(a.c.libId) ? 1 : 2) - (isHome(b.c) ? 0 : st.has(b.c.libId) ? 1 : 2)) || a.i - b.i).map((x) => x.c);
  const sel = courses.find((c) => c.id === courseId) || courses[0] || null;
  const date = when || dayStr(Date.now());
  api.root.innerHTML = `<button class="btn" data-x="back">‹ Back</button>
    <div class="card"><h2>Import a scorecard</h2>
      <p class="mute small">The scoring side of a card doesn't say where or when, so set those first.</p>
      <label class="small mute">Course${courses.length ? `<select id="impCourse">${courses.map((c) => `<option value="${c.id}" ${sel && c.id === sel.id ? 'selected' : ''}>${esc(c.name)}${c.tees ? ` · ${esc(c.tees)}` : ''} (par ${c.holes.reduce((a, h) => a + h.par, 0)})</option>`).join('')}</select>` : '<p class="mute" style="margin:4px 0">No courses yet.</p>'}</label>
      <button class="btn" data-x="library" style="width:100%;margin:6px 0 10px">${icon('search')} ${courses.length ? 'Another course' : 'Find the course'}</button>
      <label class="small mute">Date played<input type="date" id="impDate" value="${date}" max="${dayStr(Date.now())}" /></label>
      <label class="small mute">Name or initials on your row (optional)<input id="pName" value="${esc(s.cardName || '')}" placeholder="e.g. CM" /></label>
      <p class="mute small" style="margin:8px 0 0">Photograph the scoring side flat and well lit. Tip: a small number next to each score (5²) is read as putts, a dot as a fairway hit.</p>
      ${sel ? `<button type="button" class="btn primary big" id="cardBtn" style="margin-top:10px">${icon('camera')} Take or choose photo</button><input type="file" accept="image/*" id="cardPhoto" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" />` : ''}
    </div>`;
  api.root.querySelector('[data-x=back]').onclick = api.home;
  api.root.querySelector('[data-x=library]').onclick = () => openLibrary({ pickTee: true, toast: api.ctx.toast, onPicked: (c) => importCard(c?.id, api.root.querySelector('#impDate')?.value) });
  api.root.querySelector('#impCourse')?.addEventListener('change', (e) => importCard(e.target.value, api.root.querySelector('#impDate').value));
  api.root.querySelector('#cardBtn')?.addEventListener('click', () => api.root.querySelector('#cardPhoto').click());
  api.root.querySelector('#cardPhoto')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const player = api.root.querySelector('#pName').value.trim();
    const d = api.root.querySelector('#impDate').value || dayStr(Date.now());
    api.ctx.saveSetting?.('cardName', player);
    const c = await getCourse(api.root.querySelector('#impCourse').value);
    api.root.innerHTML = `<div class="busy"><div class="spinner"></div><p>Reading your card…</p></div>`;
    try {
      const data = await readCard({ ...aiFrom(s), images: [await shrink(f)], kind: 'scores', player, holes: c.holes.length });
      confirmCard(c, data, d);
    } catch (err) { api.ctx.toast(err.message, 6000); importCard(c.id, d); }
  });
}

function confirmCard(c, data, day) {
  const n = c.holes.length;
  const sc = Array.from({ length: n }, (_, i) => data.scores?.[i] ?? null);
  const pt = Array.from({ length: n }, (_, i) => data.putts?.[i] ?? null);
  const fw = Array.from({ length: n }, (_, i) => data.fairway?.[i] ?? null);
  api.root.innerHTML = `<div class="card"><h2>Check the scores</h2>
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px"><b>${esc(c.name)}${c.tees ? ` <span class="mute">· ${esc(c.tees)}</span>` : ''}</b><input type="date" id="confDate" value="${day}" max="${dayStr(Date.now())}" style="width:auto" /></div>
    <p class="mute small">Read from ${esc(data.player || 'your row')} · confidence ${esc(data.confidence || '?')}${data.notes ? ` · ${esc(data.notes)}` : ''}. Fix anything wrong.</p>
    <div class="cgrid c4"><span>Hole</span><span>Par</span><span>Score</span><span>Putts</span>
    ${c.holes.map((h, i) => `<span class="hn">${i + 1}</span><span class="mute">${h.par}</span><input inputmode="numeric" data-s="${i}" value="${sc[i] ?? ''}" /><input inputmode="numeric" data-p="${i}" value="${pt[i] ?? ''}" />`).join('')}</div>
    <p id="cardTot" class="small"></p>
    <button class="btn primary big" data-ok>Looks right → review bogeys</button></div>`;
  const tot = () => {
    let s = 0, p = 0;
    api.root.querySelectorAll('[data-s]').forEach((el) => { if (+el.value) { s += +el.value; p += c.holes[+el.dataset.s].par; } });
    api.root.querySelector('#cardTot').textContent = `Total ${s} (${toParStr(s - p)})`;
  };
  api.root.querySelectorAll('input').forEach((el) => el.addEventListener('input', tot)); tot();
  api.root.querySelector('[data-ok]').onclick = async () => {
    const holes = c.holes.map((h, i) => {
      const s = +api.root.querySelector(`[data-s="${i}"]`).value || null;
      const p = api.root.querySelector(`[data-p="${i}"]`).value;
      return s == null ? null : { score: s, putts: p === '' ? null : +p, tee: fw[i] === true ? 'FW' : null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [] };
    });
    const dv = api.root.querySelector('#confDate').value;
    const when = dv ? new Date(`${dv}T12:00:00`).getTime() : Date.now();
    const r = { id: uid('r'), date: when, courseId: c.id, courseName: c.name, tees: c.tees || '', learning: true, finished: false, source: 'photo', holes };
    c.lastPlayed = when; await putCourse(c); await putRound(r); wxSoon();
    const first = holes.findIndex((h, i) => h && h.score > c.holes[i].par);
    if (first < 0) { r.finished = true; await putRound(r); return api.summary(r, c); }
    api.ctx.toast('Now tag what caused each bogey. Add tee shot and miss direction if you remember.', 5000);
    api.review(r, c, first);
  };
}

export async function shrink(file, max = 1800) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

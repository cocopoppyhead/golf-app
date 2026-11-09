// Drill library: practise with purpose. Each drill has one number you log (its "metric"), so a drill
// becomes a series over time and an area (putting, chipping…) becomes a trend. Data: public/drills/library.json.
import { listSessions, putSession } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let cache = null;
export async function loadDrills() {
  if (!cache) cache = fetch(`${import.meta.env.BASE_URL}drills/library.json`).then((r) => (r.ok ? r.json() : { areas: [], drills: [] })).catch(() => ({ areas: [], drills: [] }));
  return cache;
}
export const AREA_WHERE = { putting: 'putting', chipping: 'short', wedges: 'short', bunker: 'short', swing: 'range', irons: 'range', driver: 'range', games: 'range' };
const BAND_NAMES = ['High hcp', 'Mid hcp', 'Single digit', 'Scratch', 'Pro'];

/** Format one logged result. */
export function fmtScore(m, r) {
  if (r == null || r.score == null) return '–';
  if (m.type === 'count' || m.type === 'points') return `${r.score}${r.of || m.of ? `/${r.of || m.of}` : ''}`;
  if (m.type === 'strokes') return m.par ? `${r.score} (${r.score - m.par >= 0 ? '+' : ''}${r.score - m.par})` : String(r.score);
  if (m.type === 'feet') return `${r.score} ft`;
  if (m.type === 'yards') return `${r.score} yds`;
  return `${r.score}${m.unit ? ` ${m.unit}` : ''}`;
}
/** 0–1 "how good", so different drills can be averaged into an area trend. */
export function norm(m, r) {
  if (r?.score == null) return null;
  const of = r.of || m.of;
  if ((m.type === 'count' || m.type === 'points') && of) return Math.max(0, Math.min(1, r.score / of));
  if (m.type === 'strokes' && m.par) return Math.max(0, Math.min(1, 1 - (r.score - m.par) / m.par));
  return null; // streaks, feet, yards: compared to the golfer's own history instead
}

/** All logged drill results, newest first: [{ drillId, score, of, at, sessionId }]. */
export async function drillResults() {
  const S = await listSessions().catch(() => []);
  const out = [];
  for (const s of S) for (const it of s.items || []) if (it.drillId && it.score != null) out.push({ drillId: it.drillId, score: it.score, of: it.of ?? null, at: it.at || s.date, sessionId: s.id });
  return out.sort((a, b) => b.at - a.at);
}

/** Per drill: last, best, trend (last 3 vs previous 3), count. */
export function drillStats(d, results) {
  const R = results.filter((r) => r.drillId === d.id);
  if (!R.length) return null;
  const m = d.metric; const hi = m.higher !== false;
  const vals = R.map((r) => r.score);
  const best = hi ? Math.max(...vals) : Math.min(...vals);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  let trend = 0;
  if (R.length >= 4) { const a = avg(vals.slice(0, 3)), b = avg(vals.slice(3, 6)); trend = Math.sign((a - b) * (hi ? 1 : -1)) * (Math.abs(a - b) > 1e-9 ? 1 : 0); }
  return { last: R[0], best, n: R.length, trend, series: R.slice(0, 10).reverse() };
}

/** Area trend: average normalised score, last 5 results vs the 5 before. */
export function areaTrend(area, lib, results) {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const nows = [], deltas = []; let n = 0;
  for (const d of lib.drills.filter((x) => x.area === area)) {
    const R = results.filter((r) => r.drillId === d.id); if (!R.length) continue;
    n += R.length;
    const m = d.metric; const hi = m.higher !== false;
    // normalise against the drill's scale when it has one, else against the golfer's own best
    const vals = R.map((r) => r.score);
    const best = hi ? Math.max(...vals) : Math.min(...vals);
    const nz = (r) => { const v = norm(m, r); if (v != null) return v; if (!best) return null; return hi ? r.score / best : best / r.score; };
    const cur = nz(R[0]); if (cur == null) continue;
    nows.push(cur);
    if (R.length >= 2) { const prev = avg(R.slice(1, 4).map(nz).filter((v) => v != null)); deltas.push(cur - prev); }
  }
  if (!nows.length) return null;
  return { now: avg(nows), n, delta: deltas.length ? avg(deltas) : null };
}

const spark = (vals, hi) => {
  const v = vals.filter(Number.isFinite); if (v.length < 2) return '';
  const W = 90, H = 24, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * W},${H - 3 - ((x - min) / span) * (H - 6)}`).join(' ');
  const better = hi ? v.at(-1) >= v[0] : v.at(-1) <= v[0];
  return `<svg viewBox="0 0 ${W} ${H}" class="mspark"><polyline points="${pts}" fill="none" stroke="var(--${better ? 'good' : 'mute'})" stroke-width="2" stroke-linejoin="round"/></svg>`;
};

/** Card on the Practice tab: your drills' trends + the library button. */
export async function renderDrillsCard(el, { toast = () => {} } = {}) {
  const [lib, results] = await Promise.all([loadDrills(), drillResults()]);
  const logged = lib.drills.map((d) => ({ d, st: drillStats(d, results) })).filter((x) => x.st).sort((a, b) => b.st.last.at - a.st.last.at);
  const areas = lib.areas.map(([k, l]) => ({ k, l, t: areaTrend(k, lib, results) })).filter((a) => a.t);
  const arrow = (t) => (t > 0 ? '<span class="goodc">▲</span>' : t < 0 ? '<span class="workc">▼</span>' : '<span class="mute">▬</span>');
  el.innerHTML = `<div class="card">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Drills</h2><button class="link acc" data-lib>Library ›</button></div>
    <p class="mute small" style="margin:0 0 8px">${lib.drills.length} drills, each with one number to log, so you can see putting, chipping and the rest improving (or not).</p>
    ${areas.length ? `<div class="areatrend">${areas.map((a) => `<div><span class="small">${esc(a.l)}</span><b>${Math.round(a.t.now * 100)}%</b><span class="small ${a.t.delta == null ? 'mute' : a.t.delta >= 0 ? 'goodc' : 'workc'}">${a.t.delta == null ? `${a.t.n} logged` : `${a.t.delta >= 0 ? '+' : ''}${Math.round(a.t.delta * 100)} vs before`}</span></div>`).join('')}</div>` : ''}
    ${logged.length ? logged.slice(0, 6).map(({ d, st }) => `<button class="drow" data-open="${esc(d.id)}">
        <span class="dn"><b>${esc(d.name)}</b><span class="mute small">${esc(lib.areas.find((a) => a[0] === d.area)?.[1] || d.area)} · ${st.n} logged · best ${fmtScore(d.metric, { score: st.best, of: st.last.of })}</span></span>
        ${spark(st.series.map((r) => r.score), d.metric.higher !== false)}
        <span class="dl">${fmtScore(d.metric, st.last)} ${arrow(st.trend)}</span></button>`).join('')
      : '<p class="mute small">Nothing logged yet. Open the library, pick a drill, do it, log the number.</p>'}
    <button class="btn" data-lib2 style="width:100%;margin-top:8px">+ Log a drill</button>
  </div>`;
  const redraw = () => renderDrillsCard(el, { toast });
  el.querySelector('[data-lib]').onclick = () => openLibrary({ toast, onLogged: redraw });
  el.querySelector('[data-lib2]').onclick = () => openLibrary({ toast, onLogged: redraw });
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openLibrary({ toast, onLogged: redraw, drillId: b.dataset.open }));
}

/** Full-screen library: area tabs → drill list → drill sheet with "Log it". */
export async function openLibrary({ toast = () => {}, onLogged = () => {}, drillId = null, onPick = null } = {}) {
  const [lib, results] = await Promise.all([loadDrills(), drillResults()]);
  const el = document.createElement('div'); el.className = 'onb drilllib';
  let area = drillId ? lib.drills.find((d) => d.id === drillId)?.area : lib.areas[0]?.[0];
  let q = '';
  const draw = () => {
    const list = lib.drills.filter((d) => (q ? (d.name + d.purpose + d.sub).toLowerCase().includes(q.toLowerCase()) : d.area === area));
    el.innerHTML = `<div class="onb-in">
      <div class="onb-top"><h2 style="margin:0">Drill library</h2><button class="link" data-close>Close</button></div>
      <input class="libq" placeholder="Search drills" value="${esc(q)}" />
      ${q ? '' : `<div class="areatabs">${lib.areas.map(([k, l]) => `<button class="${k === area ? 'on' : ''}" data-area="${k}">${esc(l)}</button>`).join('')}</div>`}
      <div class="dlist">${list.map((d) => { const st = drillStats(d, results); return `<button class="ditem" data-d="${esc(d.id)}">
        <span><b>${esc(d.name)}</b><span class="mute small">${esc(d.sub)} · ${esc(d.level)}</span><span class="small">${esc(d.purpose)}</span></span>
        <span class="dl">${st ? `${fmtScore(d.metric, st.last)}<small>last</small>` : '<small class="mute">›</small>'}</span></button>`; }).join('') || '<p class="mute small">Nothing matches.</p>'}</div>
    </div>`;
    el.querySelector('[data-close]').onclick = () => el.remove();
    el.querySelector('.libq').addEventListener('input', (e) => { q = e.target.value; draw(); el.querySelector('.libq').focus(); });
    el.querySelectorAll('[data-area]').forEach((b) => b.onclick = () => { area = b.dataset.area; draw(); });
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => drillSheet(lib.drills.find((d) => d.id === b.dataset.d), lib, results, { toast, onPick, onLogged: async () => { results.splice(0, results.length, ...(await drillResults())); draw(); onLogged(); } }));
  };
  draw(); document.body.appendChild(el);
  if (drillId) { const d = lib.drills.find((x) => x.id === drillId); if (d) drillSheet(d, lib, results, { toast, onPick, onLogged: async () => { results.splice(0, results.length, ...(await drillResults())); draw(); onLogged(); } }); }
}

function drillSheet(d, lib, results, { toast, onLogged, onPick }) {
  const m = d.metric; const st = drillStats(d, results);
  const sheet = document.createElement('div'); sheet.className = 'sheet drillsheet';
  const scoreHint = m.type === 'count' ? `${m.label || 'how many'}${m.of ? ` out of ${m.of}` : ''}` : m.type === 'streak' ? 'longest streak' : m.type === 'strokes' ? `total strokes${m.par ? ` (par ${m.par})` : ''}` : m.type === 'points' ? `points${m.of ? ` out of ${m.of}` : ''}` : m.type === 'feet' ? 'feet' : m.type === 'yards' ? 'yards' : m.label || m.unit || 'number';
  sheet.innerHTML = `<div class="sheet-in">
    <div class="sheet-h"><b>${esc(d.name)}</b><button class="link" data-close>Close</button></div>
    <p class="small" style="margin:0 0 6px"><span class="tag">${esc(lib.areas.find((a) => a[0] === d.area)?.[1] || d.area)}</span> <span class="tag">${esc(d.sub)}</span> <span class="tag">${esc(d.level)}</span></p>
    <p style="margin:4px 0 8px">${esc(d.purpose)}</p>
    <div class="lbl">Setup</div><p class="small">${esc(d.setup)}</p>
    <div class="lbl">How</div><p class="small">${esc(d.how)}</p>
    <div class="lbl">Score it</div><p class="small">${esc(d.score)}</p>
    ${d.bands ? `<div class="lbl">Benchmarks</div><div class="bands">${d.bands.map((b, i) => `<span><small>${BAND_NAMES[i]}</small><b>${esc(b)}</b></span>`).join('')}</div>` : ''}
    <p class="mute small">${esc(d.reps)}</p>
    ${st ? `<div class="lbl">You</div><p class="small">Last ${fmtScore(m, st.last)} · best ${fmtScore(m, { score: st.best, of: st.last.of })} · ${st.n} logged</p>` : ''}
    ${onPick ? `<button class="btn primary big" data-pick>Add to this session</button>` : `
    <div class="lbl">Log it now <span class="mute">(${esc(scoreHint)})</span></div>
    <div class="row"><input inputmode="decimal" data-score placeholder="${m.type === 'count' && m.of ? `0–${m.of}` : 'score'}" style="flex:1" />${m.type === 'points' && !m.of ? '<input inputmode="numeric" data-of placeholder="out of" style="flex:1" />' : (m.type === 'count' || m.type === 'points') && m.of ? `<span class="mute" style="align-self:center">/ ${m.of}</span>` : ''}</div>
    <button class="btn primary big" data-log style="margin-top:8px">Save score</button>`}
    <p class="mute small" style="margin-top:8px">Source: ${d.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace('www.', ''))}</a>`).join(' · ')}</p>
  </div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-pick]')?.addEventListener('click', () => { onPick(d); sheet.remove(); });
  sheet.querySelector('[data-log]')?.addEventListener('click', async () => {
    const score = parseFloat(sheet.querySelector('[data-score]').value);
    if (!Number.isFinite(score)) return toast('Enter the number first.');
    const ofEl = sheet.querySelector('[data-of]'); const of = ofEl ? (+ofEl.value || null) : (m.of || null);
    if (of && score > of) return toast(`Can't be more than ${of}.`);
    await logDrill(d, { score, of });
    sheet.remove(); toast(`${d.name}: ${fmtScore(m, { score, of })} saved.`); onLogged();
  });
  document.body.appendChild(sheet);
}

/** Append a drill result to today's session for that area (creating one if needed). */
export async function logDrill(d, { score, of = null, sessionId = null }) {
  const S = await listSessions().catch(() => []);
  const where = AREA_WHERE[d.area] || 'range';
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let s = sessionId ? S.find((x) => x.id === sessionId) : S.find((x) => x.date >= dayStart.getTime() && x.where === where) || S.find((x) => x.date >= dayStart.getTime());
  if (!s) s = { id: uid('ps'), date: Date.now(), where, minutes: null, items: [], feel: null, note: '' };
  s.items = s.items || [];
  s.items.push({ drillId: d.id, title: d.name, score, of, at: Date.now(), drills: [] });
  await putSession(s);
  window.dispatchEvent(new CustomEvent('practice-changed'));
  return s;
}

/** For the AI coach: recent drill scores. */
export async function drillContext() {
  const [lib, results] = await Promise.all([loadDrills(), drillResults()]);
  const cut = Date.now() - 21 * 86400e3;
  const R = results.filter((r) => r.at >= cut);
  if (!R.length) return '';
  const byId = Object.fromEntries(lib.drills.map((d) => [d.id, d]));
  const lines = []; const seen = new Set();
  for (const r of R) { const d = byId[r.drillId]; if (!d || seen.has(d.id)) continue; seen.add(d.id); const st = drillStats(d, results); lines.push(`${d.name} (${d.area}): last ${fmtScore(d.metric, st.last)}, best ${fmtScore(d.metric, { score: st.best, of: st.last.of })}, ${st.n} logged${st.trend ? st.trend > 0 ? ', improving' : ', slipping' : ''}`); }
  return `Practice drill scores, last 3 weeks: ${lines.slice(0, 8).join('; ')}.`;
}

// Drill library: practise with purpose. Each drill has one number you log (its "metric"), so a drill
// becomes a series over time and an area (putting, chipping…) becomes a trend. Data: public/drills/library.json.
import { listSessions, putSession, getSettings, saveSettings } from './store.js';
import { openExternal } from './native.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let cache = null;
export async function loadDrills() {
  if (!cache) cache = fetch(`${import.meta.env.BASE_URL}drills/library.json`).then((r) => (r.ok ? r.json() : { areas: [], drills: [] })).catch(() => ({ areas: [], drills: [] })).then((l) => { libSync = l; return l; });
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
  const S = (await listSessions().catch(() => [])).filter((s) => s.status !== 'planned');
  const out = [];
  for (const s of S) for (const it of s.items || []) if (it.drillId && it.score != null) out.push({ drillId: it.drillId, score: it.score, of: it.of ?? null, at: it.at || s.date, sessionId: s.id });
  return out.sort((a, b) => b.at - a.at);
}
/** Goal items ("10 in a row at 150"): attempts it took, newest first, grouped by goal text. */
export async function goalResults() {
  const S = (await listSessions().catch(() => [])).filter((s) => s.status === 'done');
  const out = [];
  for (const s of S) for (const it of s.items || []) if (it.mode === 'attempts' && it.attempts != null) out.push({ key: `goal:${String(it.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: it.title, target: it.target, attempts: it.attempts, achieved: it.achieved !== false, fails: it.fails || [], at: it.at || s.date });
  return out.sort((a, b) => b.at - a.at);
}
export const favDrills = () => new Set(getSettings().favDrills || []);
export function toggleFav(id) { const s = getSettings(); const f = new Set(s.favDrills || []); f.has(id) ? f.delete(id) : f.add(id); s.favDrills = [...f]; saveSettings(s); return f.has(id); }
const FAIL_LABEL = { THN: 'thin', FAT: 'fat', TOE: 'toe', HEL: 'heel', PUL: 'pull', PUS: 'push', HK: 'hook', SL: 'slice', SHT: 'short', LNG: 'long', RSH: 'rushed', DEC: 'decision' };

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
  const [lib, results, goals] = await Promise.all([loadDrills(), drillResults(), goalResults()]);
  const logged = lib.drills.map((d) => ({ d, st: drillStats(d, results) })).filter((x) => x.st).sort((a, b) => b.st.last.at - a.st.last.at);
  const gkeys = [...new Set(goals.map((g) => g.key))].map((k) => { const G = goals.filter((g) => g.key === k); const best = Math.min(...G.filter((g) => g.achieved).map((g) => g.attempts).concat([Infinity])); const fails = {}; G.forEach((g) => g.fails.forEach((f) => { fails[f] = (fails[f] || 0) + 1; })); const top = Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => FAIL_LABEL[f] || f); let trend = 0; if (G.length >= 2) { const a = G[0].attempts, b = G.slice(1, 4).reduce((x, y) => x + y.attempts, 0) / Math.min(3, G.length - 1); trend = a < b ? 1 : a > b ? -1 : 0; } return { k, title: G[0].title, G, best, top, trend }; });
  const areas = lib.areas.map(([k, l]) => ({ k, l, t: areaTrend(k, lib, results) })).filter((a) => a.t);
  const arrow = (t) => (t > 0 ? '<span class="goodc">▲</span>' : t < 0 ? '<span class="workc">▼</span>' : '<span class="mute">▬</span>');
  el.innerHTML = `<div class="card">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Drills</h2><button class="link acc" data-lib>Library ›</button></div>
    <p class="mute small" style="margin:0 0 8px">${lib.drills.length} drills, each with one number to log, so you can see putting, chipping and the rest improving (or not).</p>
    ${areas.length ? `<div class="areatrend">${areas.map((a) => `<div><span class="small">${esc(a.l)}</span><b>${Math.round(a.t.now * 100)}%</b><span class="small ${a.t.delta == null ? 'mute' : a.t.delta >= 0 ? 'goodc' : 'workc'}">${a.t.delta == null ? `${a.t.n} logged` : `${a.t.delta >= 0 ? '+' : ''}${Math.round(a.t.delta * 100)} vs before`}</span></div>`).join('')}</div>` : ''}
    ${gkeys.length ? `<div class="lbl" style="margin:6px 0 2px">Goals · attempts it took</div>${gkeys.slice(0, 5).map((g) => `<div class="drow"><span class="dn"><b>${esc(g.title)}</b><span class="mute small">${g.G.length} tr${g.G.length === 1 ? 'y' : 'ies'}${Number.isFinite(g.best) ? ` · best ${g.best}` : ''}${g.top.length ? ` · misses: ${g.top.join(', ')}` : ''}</span></span>${spark(g.G.slice(0, 10).reverse().map((x) => x.attempts), false)}<span class="dl">${g.G[0].attempts}${g.G[0].achieved ? '' : '<small>✕</small>'} ${arrow(g.trend)}</span></div>`).join('')}<div class="lbl" style="margin:8px 0 2px">Drills</div>` : ''}
    ${logged.length ? logged.slice(0, 6).map(({ d, st }) => `<button class="drow" data-open="${esc(d.id)}">
        <span class="dn"><b>${esc(d.name)}</b><span class="mute small">${esc(lib.areas.find((a) => a[0] === d.area)?.[1] || d.area)} · ${st.n} logged · best ${fmtScore(d.metric, { score: st.best, of: st.last.of })}</span></span>
        ${spark(st.series.map((r) => r.score), d.metric.higher !== false)}
        <span class="dl">${fmtScore(d.metric, st.last)} ${arrow(st.trend)}</span></button>`).join('')
      : '<p class="mute small">Nothing logged yet. Open the library, pick a drill, do it, log the number.</p>'}
    <div class="row" style="margin-top:8px"><button class="btn" data-lib2 style="flex:1">+ Log a drill</button><button class="btn" data-tempo style="flex:1">${icon('tempo')} Tempo</button></div>
  </div>`;
  const redraw = () => renderDrillsCard(el, { toast });
  el.querySelector('[data-tempo]').onclick = () => import('./metronome.js').then((m) => m.openMetronome({ toast }));
  el.querySelector('[data-lib]').onclick = () => openLibrary({ toast, onLogged: redraw });
  el.querySelector('[data-lib2]').onclick = () => openLibrary({ toast, onLogged: redraw });
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openLibrary({ toast, onLogged: redraw, drillId: b.dataset.open }));
}

let libSync = null; // the library once loaded, for synchronous lookups from the swing screens
export const drillsLoaded = () => libSync;
/** Library drills that fix a measured fault key (e.g. 'impact:Hips'), via the drill's `fixes` list. */
export function faultDrills(key) {
  if (!libSync || !key) return [];
  const k = key.replace(/^dtl:/, ''); const alt = `dtl:${k}`;
  return libSync.drills.filter((d) => (d.fixes || []).some((f) => f === key || f === k || f === alt));
}
/** Compact drill card(s) for a swing screen; bind with bindDrillCards. */
export function drillCardsHtml(drills, { title = 'Drills for this' } = {}) {
  if (!drills.length) return '';
  return `<div class="dcards"><div class="lbl">${esc(title)}</div>${drills.map((d) => `<button class="dcard" data-drill="${esc(d.id)}">
    <span><b>${esc(d.name)}</b><span class="small">${esc(d.purpose)}</span><span class="chips">${drillChips(d)}</span></span><span class="mute">›</span></button>`).join('')}</div>`;
}
export function bindDrillCards(root, { toast = () => {} } = {}) {
  root.querySelectorAll('[data-drill]').forEach((b) => b.onclick = () => openLibrary({ toast, drillId: b.dataset.drill, onLogged: () => window.dispatchEvent(new Event('practice-changed')) }));
}
/** One line per drill for the AI coach, so it prescribes from the library by id. */
export function drillMenuForAi(keys = []) {
  if (!libSync) return '';
  const want = new Set(keys.flatMap((k) => [k, k.replace(/^dtl:/, ''), `dtl:${k.replace(/^dtl:/, '')}`]));
  const pick = libSync.drills.filter((d) => (d.fixes || []).some((f) => want.has(f)) || d.area === 'swing' || d.area === 'irons' || d.area === 'driver').slice(0, 40);
  return `Drill library you may prescribe (use the ids in the json block, up to 3, matched to the faults you name): ${pick.map((d) => `${d.id} — ${d.name}${d.fixes?.length ? ` [fixes ${d.fixes.join(', ')}]` : ''}`).join('; ')}.`;
}

/** Where a drill can be done, in the order the chips show. */
export const PLACES = [['home', '🏠 Home'], ['range', '🏌️ Range'], ['sim', '🖥 Sim'], ['green', '⛳ Green'], ['short game', '🌿 Short game'], ['bunker', '🏖 Bunker'], ['course', '🚩 Course']];
const PLACE_LABEL = Object.fromEntries(PLACES.map(([k, l]) => [k, l.replace(/^\S+\s/, '')]));
/** Time · level · places as small chips. */
export const drillChips = (d) => [d.minutes ? `<span class="tag t">${d.minutes} min</span>` : '', d.level && d.level !== 'all' ? `<span class="tag">${esc(d.level)}</span>` : '', ...(d.where || []).map((w) => `<span class="tag p">${esc(PLACE_LABEL[w] || w)}</span>`)].join(' ');

/** Full-screen library: area tabs → drill list → drill sheet with "Log it". */
export async function openLibrary({ toast = () => {}, onLogged = () => {}, drillId = null, onPick = null } = {}) {
  const [lib, results] = await Promise.all([loadDrills(), drillResults()]);
  const el = document.createElement('div'); el.className = 'onb drilllib';
  let fav = favDrills();
  let area = drillId ? lib.drills.find((d) => d.id === drillId)?.area : fav.size ? 'fav' : lib.areas[0]?.[0];
  let q = '', place = '';
  const draw = () => {
    fav = favDrills();
    const list = lib.drills.filter((d) => (q ? (d.name + d.purpose + d.sub).toLowerCase().includes(q.toLowerCase()) : area === 'fav' ? fav.has(d.id) : d.area === area)).filter((d) => !place || (d.where || []).includes(place));
    el.innerHTML = `<div class="onb-in">
      <div class="onb-top"><h2 style="margin:0">Drill library</h2><button class="link" data-close>${onPick ? 'Back to session' : 'Close'}</button></div>
      <input class="libq" placeholder="Search drills" value="${esc(q)}" />
      ${q ? '' : `<div class="areatabs"><button class="${area === 'fav' ? 'on' : ''}" data-area="fav">★ Favourites${fav.size ? ` ${fav.size}` : ''}</button>${lib.areas.map(([k, l]) => `<button class="${k === area ? 'on' : ''}" data-area="${k}">${esc(l)}</button>`).join('')}</div>`}
      <div class="placetabs">${PLACES.map(([k, l]) => `<button class="${place === k ? 'on' : ''}" data-place="${k}">${l}</button>`).join('')}</div>
      <div class="dlist">${list.map((d) => { const st = drillStats(d, results); return `<div class="ditem" data-d="${esc(d.id)}">
        <span><b>${esc(d.name)}</b><span class="chips">${drillChips(d)}</span><span class="small">${esc(d.purpose)}</span></span>
        <span class="dl">${st ? `${fmtScore(d.metric, st.last)}<small>last</small>` : ''}<button class="star ${fav.has(d.id) ? 'on' : ''}" data-fav="${esc(d.id)}" aria-label="Favourite">${fav.has(d.id) ? '★' : '☆'}</button></span></div>`; }).join('') || `<p class="mute small">${area === 'fav' ? 'No favourites yet. Tap ☆ on a drill.' : 'Nothing matches.'}</p>`}</div>
    </div>`;
    el.querySelector('[data-close]').onclick = () => el.remove();
    el.querySelector('.libq').addEventListener('input', (e) => { q = e.target.value; draw(); el.querySelector('.libq').focus(); });
    el.querySelectorAll('[data-area]').forEach((b) => b.onclick = () => { area = b.dataset.area; draw(); });
    el.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => { place = place === b.dataset.place ? '' : b.dataset.place; draw(); });
    el.querySelectorAll('[data-fav]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleFav(b.dataset.fav); draw(); });
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = (e) => { if (e.target.closest('[data-fav]')) return; drillSheet(lib.drills.find((d) => d.id === b.dataset.d), lib, results, { toast, onPick, onFav: draw, onLogged: async () => { results.splice(0, results.length, ...(await drillResults())); draw(); onLogged(); } }); });
  };
  draw(); document.body.appendChild(el);
  if (drillId) { const d = lib.drills.find((x) => x.id === drillId); if (d) drillSheet(d, lib, results, { toast, onPick, onLogged: async () => { results.splice(0, results.length, ...(await drillResults())); draw(); onLogged(); } }); }
}

function drillSheet(d, lib, results, { toast, onLogged, onPick, onFav }) {
  const m = d.metric; const st = drillStats(d, results);
  const sheet = document.createElement('div'); sheet.className = 'sheet drillsheet';
  const scoreHint = m.type === 'count' ? `${m.label || 'how many'}${m.of ? ` out of ${m.of}` : ''}` : m.type === 'streak' ? 'longest streak' : m.type === 'strokes' ? `total strokes${m.par ? ` (par ${m.par})` : ''}` : m.type === 'points' ? `points${m.of ? ` out of ${m.of}` : ''}` : m.type === 'feet' ? 'feet' : m.type === 'yards' ? 'yards' : m.label || m.unit || 'number';
  sheet.innerHTML = `<div class="sheet-in">
    <div class="sheet-h"><b>${esc(d.name)}</b><span class="row" style="gap:10px"><button class="star big ${favDrills().has(d.id) ? 'on' : ''}" data-fav>${favDrills().has(d.id) ? '★' : '☆'}</button><button class="link" data-close>Close</button></span></div>
    <p class="small chips" style="margin:0 0 6px"><span class="tag">${esc(lib.areas.find((a) => a[0] === d.area)?.[1] || d.area)}</span> <span class="tag">${esc(d.sub)}</span>${drillChips(d)}</p>
    <p style="margin:4px 0 8px">${esc(d.purpose)}</p>
    <div class="lbl">Setup</div><p class="small">${esc(d.setup)}</p>
    <div class="lbl">How</div><p class="small">${esc(d.how)}</p>
    <div class="lbl">Score it</div><p class="small">${esc(d.score)}</p>
    ${d.bands ? `<div class="lbl">Benchmarks</div><div class="bands">${d.bands.map((b, i) => `<span><small>${BAND_NAMES[i]}</small><b>${esc(b)}</b></span>`).join('')}</div>` : ''}
    <p class="mute small">${esc(d.reps)}${d.feel ? ` · Feel: “${esc(d.feel)}”` : ''}</p>
    ${st ? `<div class="lbl">You</div><p class="small">Last ${fmtScore(m, st.last)} · best ${fmtScore(m, { score: st.best, of: st.last.of })} · ${st.n} logged</p>` : ''}
    ${onPick ? `<button class="btn primary big" data-pick>Add to this session</button>` : `
    <button class="btn big" data-plan>${icon('calendar')} Put it in a practice session</button>
    <div class="lbl" style="margin-top:10px">Log it now <span class="mute">(${esc(scoreHint)})</span></div>
    <div class="row"><input inputmode="decimal" data-score placeholder="${m.type === 'count' && m.of ? `0–${m.of}` : 'score'}" style="flex:1" />${m.type === 'points' && !m.of ? '<input inputmode="numeric" data-of placeholder="out of" style="flex:1" />' : (m.type === 'count' || m.type === 'points') && m.of ? `<span class="mute" style="align-self:center">/ ${m.of}</span>` : ''}</div>
    <button class="btn primary big" data-log style="margin-top:8px">Save score</button>`}
    <p class="mute small" style="margin-top:8px">${d.sources?.length ? `Source: ${d.sources.map((u, i) => `<button class="link" data-src="${i}">${esc(new URL(u).hostname.replace('www.', ''))}</button>`).join(' · ')} · ` : ''}<button class="link" data-yt>${d.sources?.length ? 'YouTube' : 'Search YouTube for it'}</button></p>
  </div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-fav]').onclick = () => { const on = toggleFav(d.id); const b = sheet.querySelector('[data-fav]'); b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); onFav?.(); };
  sheet.querySelectorAll('[data-src]').forEach((b) => b.onclick = () => sourceSheet(d, d.sources[+b.dataset.src]));
  sheet.querySelector('[data-yt]').onclick = () => sourceSheet(d, null);
  sheet.querySelector('[data-pick]')?.addEventListener('click', () => { onPick(d); sheet.remove(); document.querySelector('.drilllib')?.remove(); });
  sheet.querySelector('[data-plan]')?.addEventListener('click', () => { sheet.remove(); document.querySelector('.drilllib')?.remove(); import('./practice.js').then((P) => P.planWithDrill(d, { toast })); });
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

/** A source link opens in a small modal first, so you can get back to the app: open in the browser, or search YouTube. */
function sourceSheet(d, url) {
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${d.name} golf drill`)}`;
  const sheet = document.createElement('div'); sheet.className = 'sheet drillsheet srcsheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${esc(d.name)}</b><button class="link" data-close>Back</button></div>
    ${url ? `<p class="small">${esc(url)}</p><button class="btn primary big" data-open>Open in browser</button>` : ''}
    <button class="btn big" data-yt style="margin-top:8px">${icon('play')} Search on YouTube</button>
    <p class="mute small" style="margin-top:8px">Opens outside osolo; come back with the app switcher.</p></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-open]')?.addEventListener('click', () => openExternal(url));
  sheet.querySelector('[data-yt]').onclick = () => openExternal(yt);
  document.body.appendChild(sheet);
}

/** Append a drill result to today's session for that area (creating one if needed). */
export async function logDrill(d, { score, of = null, sessionId = null }) {
  const S = await listSessions().catch(() => []);
  const where = AREA_WHERE[d.area] || 'range';
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = (x) => x.status !== 'planned' && x.date >= dayStart.getTime();
  let s = sessionId ? S.find((x) => x.id === sessionId) : S.find((x) => x.status === 'active') || S.find((x) => today(x) && (Array.isArray(x.where) ? x.where : [x.where]).includes(where)) || S.find(today);
  if (!s) s = { id: uid('ps'), status: 'done', date: Date.now(), where: [where], minutes: null, items: [], rating: null, note: '' };
  s.items = s.items || [];
  s.items.push({ id: uid('it'), mode: 'score', drillId: d.id, title: d.name, score, of, at: Date.now() });
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

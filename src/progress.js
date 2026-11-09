// Progress → Scoring: what your rounds say. Tiger 5, strokes gained, scoring by par and a DECADE-style
// comparison of each stat against golfers who shoot different scores.
// Progress → Practice (main.js) uses the shot details from rounds plus the swing coach.
import { listRounds, getCourse } from './store.js';
import { roundStats } from './rounds/stats.js';
import { roundSG, SG_LABELS } from './rounds/sg.js';
import { tiger5, TIGER5, TIGER5_LABEL, TIGER5_TOUR } from './rounds/tiger.js';
import { sgCard, autoShotType } from './rounds/ui.js';
import { CODES } from './rounds/stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(1));
const f2 = (v) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2));

// DECADE master key (men): what golfers in each scoring band average.
const BANDS = ['≤68', '69–71', '72–74', '75–77', '78–80', '81–83', '84+'];
const KEY = {
  avg: [66.87, 70.11, 72.99, 75.86, 78.82, 81.79, 86.98],
  sgPutt: [1.72, 0.13, -0.79, -1.85, -4.1, null, null],
  par3: [2.91, 3.06, 3.18, 3.31, 3.44, 3.56, 3.77],
  par4: [3.82, 3.99, 4.14, 4.3, 4.46, 4.64, 4.94],
  par5: [4.38, 4.6, 4.8, 4.99, 5.2, 5.39, 5.72],
};
/** Which band a value sits in (lower is better, except SG putting). */
function band(metric, v) {
  if (v == null || !Number.isFinite(v)) return null;
  const row = KEY[metric]; const higherBetter = metric === 'sgPutt';
  let best = 0, bd = Infinity;
  row.forEach((x, i) => { if (x != null && Math.abs(x - v) < bd) { bd = Math.abs(x - v); best = i; } });
  if (higherBetter) { if (v < row.filter((x) => x != null).at(-1)) best = row.filter((x) => x != null).length; }
  return Math.min(best, BANDS.length - 1);
}

export async function loadRounds(n = 20) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && r.learning !== false).slice(0, n);
  const out = [];
  for (const r of rounds) {
    const c = await getCourse(r.courseId).catch(() => null);
    if (!c) continue;
    out.push({ r, c, S: roundStats(r, c), G: roundSG(r, c), T: tiger5(r, c) });
  }
  return out;
}

function spark(vals, { good = 'down' } = {}) {
  const v = vals.filter(Number.isFinite);
  if (v.length < 2) return '';
  const W = 280, H = 44, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * W},${H - 4 - ((x - min) / span) * (H - 8)}`).join(' ');
  const last = v.at(-1), first = v[0];
  const better = good === 'down' ? last < first : last > first;
  return `<svg viewBox="0 0 ${W} ${H}" class="spark"><polyline points="${pts}" fill="none" stroke="var(--${better ? 'good' : 'mute'})" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}

export async function renderScoring(el) {
  const R = await loadRounds();
  if (!R.length) { el.innerHTML = '<div class="card"><h2>No rounds yet</h2><p class="mute">Log a round in Play. Your scoring, Tiger 5 and strokes gained build up here.</p></div>'; return; }
  const full = R.filter((x) => x.S.holes >= 18);
  const n = R.length;
  const sum = (f) => R.reduce((a, x) => a + (f(x) || 0), 0);
  const per = (f) => sum(f) / n;
  // scoring by par (all holes)
  const byPar = { 3: [0, 0], 4: [0, 0], 5: [0, 0] };
  R.forEach(({ S }) => { for (const p of [3, 4, 5]) { byPar[p][0] += S.byPar[p][0]; byPar[p][1] += S.byPar[p][1]; } });
  const parAvg = (p) => (byPar[p][1] ? byPar[p][0] / byPar[p][1] : null);
  const avg = full.length ? full.reduce((a, x) => a + x.S.score, 0) / full.length : null;
  const G = R.filter((x) => x.G && x.G.complete >= Math.min(9, x.G.holes));
  const sgAvg = G.length ? Object.fromEntries(['ott', 'app', 'arg', 'putt', 'total'].map((k) => [k, G.reduce((a, x) => a + x.G[k] * (18 / x.G.holes), 0) / G.length])) : null;
  // per-18 scaling for counts from 9-hole rounds
  const p18 = (x, v) => v * (18 / Math.max(9, x.S.holes));
  const t5 = Object.fromEntries(TIGER5.map((id) => [id, R.reduce((a, x) => a + p18(x, x.T.by[id] || 0), 0) / n]));
  const t5tot = Object.values(t5).reduce((a, b) => a + b, 0);
  const recent = [...R].reverse(); // oldest → newest for charts

  const myBand = band('avg', avg);
  const mark = (metric, v) => {
    const b = band(metric, v); if (b == null || myBand == null) return '';
    return b < myBand ? '<span class="mk good">✓</span>' : b > myBand ? '<span class="mk bad">✕</span>' : '<span class="mk">○</span>';
  };
  const row = (label, metric, v, fmt = f2) => `<tr><td>${label}</td><td><b>${fmt(v)}</b></td><td>${v == null ? '' : BANDS[band(metric, v)]}</td><td>${mark(metric, v)}</td></tr>`;

  el.innerHTML = `
    <div class="card scorehead">
      <div><span class="mute small">Scoring average${full.length ? ` · last ${full.length} full round${full.length > 1 ? 's' : ''}` : ''}</span><div class="big">${f1(avg)}</div></div>
      ${spark(recent.filter((x) => x.S.holes >= 18).map((x) => x.S.score))}
    </div>

    <div class="card">
      <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Tiger 5</h2><span class="sgpill ${t5tot <= 6 ? 'pos' : 'neg'}" style="float:none">${f1(t5tot)} / round</span></div>
      <p class="mute small" style="margin:0 0 10px">Scott Fawcett's rule: six or fewer of these a round and you're playing to win. Tour top-5 finishers average about 1.6, missed cuts 3.7 (not counting blown saves).</p>
      <table class="t5"><tr><th></th><th>You</th><th>Top 5</th><th>Missed cut</th></tr>
        ${TIGER5.map((id) => `<tr><td>${TIGER5_LABEL[id]}</td><td><b>${f2(t5[id])}</b></td><td>${TIGER5_TOUR[id] ? TIGER5_TOUR[id][0] : '–'}</td><td>${TIGER5_TOUR[id] ? TIGER5_TOUR[id][1] : '–'}</td></tr>`).join('')}
      </table>
      <div class="t5bars">${recent.map((x) => `<i title="${esc(x.r.courseName)}: ${x.T.total}" style="height:${Math.min(100, x.T.total * 8)}%;background:var(--${x.T.total <= 6 ? 'good' : 'work'})"></i>`).join('')}<span class="goal" style="bottom:48%">6</span></div>
      <p class="mute small" style="margin:6px 0 0">Bars: each round, oldest to newest. Bogeys inside 150 and blown saves need shot distances in the hole log.</p>
    </div>

    ${sgAvg ? sgCard(sgAvg, `Per 18 holes, average of ${G.length} round${G.length > 1 ? 's' : ''} with shot data`) : '<div class="card"><h2>Strokes gained</h2><p class="mute small">Shows once rounds have shot distances (from the rangefinder) and first-putt distances.</p></div>'}

    <div class="card">
      <h2>How you score, against other golfers</h2>
      <p class="mute small" style="margin:0 0 8px">Each stat placed in the scoring band of golfers who average it (DECADE key). ✓ better than your scoring average band, ○ the same, ✕ worse: the ✕s are where shots go.</p>
      <table class="dk"><tr><th>Stat</th><th>You</th><th>Plays like</th><th></th></tr>
        ${row('Scoring average', 'avg', avg, f1)}
        ${row('Strokes gained putting', 'sgPutt', sgAvg ? sgAvg.putt : null)}
        ${row('Par 3 scoring', 'par3', parAvg(3))}
        ${row('Par 4 scoring', 'par4', parAvg(4))}
        ${row('Par 5 scoring', 'par5', parAvg(5))}
      </table>
    </div>

    <div class="card">
      <h2>Per round</h2>
      <div class="kpis">
        <div><b>${f1(per((x) => p18(x, x.S.birdies)))}</b><span>birdies</span></div>
        <div><b>${f1(per((x) => p18(x, x.S.bogeys)))}</b><span>bogeys</span></div>
        <div><b>${f1(per((x) => p18(x, x.S.doubles)))}</b><span>doubles+</span></div>
        <div><b>${f1(per((x) => p18(x, x.S.putts)))}</b><span>putts</span></div>
      </div>
      <div class="kpis" style="margin-top:8px">
        <div><b>${pct(sum((x) => x.S.fir), sum((x) => x.S.firOpp))}</b><span>fairways</span></div>
        <div><b>${pct(sum((x) => x.S.gir), sum((x) => x.S.girOpp))}</b><span>greens</span></div>
        <div><b>${pct(sum((x) => x.S.scr), sum((x) => x.S.scrOpp))}</b><span>up & down</span></div>
        <div><b>${f1(per((x) => p18(x, x.S.threePutts)))}</b><span>3-putts</span></div>
      </div>
      <p class="mute small" style="margin:8px 0 0">${n} round${n > 1 ? 's' : ''}; 9-hole rounds scaled to 18.</p>
    </div>`;
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** Practice notes from the shot details of recent rounds: faults by shot type, and planned vs actual shape. */
export async function practiceFromRounds() {
  const R = await loadRounds(10);
  const by = {}; const shape = {};
  const name = Object.fromEntries(CODES.shot);
  const lab = { ...Object.fromEntries([...CODES.flight, ...CODES.strike, ...CODES.cause]), SS: 'Short-sided' };
  const planned = { D: 'draw', S: 'straight', F: 'fade' };
  R.forEach(({ r, c }) => r.holes.forEach((h, i) => (h?.shots || []).forEach((x, k) => {
    const par = c.holes[i]?.par ?? 4;
    if (x.d) {
      const t = x.d.shot || autoShotType(x, k, par);
      const b = (by[t] ||= { n: 0, codes: {} }); b.n++;
      for (const v of [x.d.flight, x.d.strike, x.d.cause]) if (v && !['STR', 'PUR', 'DRW', 'FAD'].includes(v)) b.codes[v] = (b.codes[v] || 0) + 1;
    }
    if (x.intent && x.d?.flight) {
      const got = x.d.flight;
      const ok = (x.intent === 'D' && got === 'DRW') || (x.intent === 'F' && got === 'FAD') || (x.intent === 'S' && got === 'STR');
      const key = planned[x.intent];
      const s = (shape[key] ||= { n: 0, ok: 0, got: {} }); s.n++; if (ok) s.ok++; else s.got[got] = (s.got[got] || 0) + 1;
    }
  })));
  const rows = Object.entries(by).filter(([, b]) => Object.keys(b.codes).length).sort((a, b) => b[1].n - a[1].n);
  let html = '';
  if (rows.length) html += `<div class="card"><h2>From your rounds</h2><p class="mute small" style="margin:0 0 6px">Faults logged in shot details, last ${R.length} round${R.length > 1 ? 's' : ''}.</p>${rows.map(([t, b]) => `<div class="tend"><div><b>${esc(name[t] || t)}</b><div class="mute small">${Object.entries(b.codes).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${esc(lab[k] || k)} ×${v}`).join(' · ')} <span class="mute">(of ${b.n})</span></div></div></div>`).join('')}</div>`;
  const sh = Object.entries(shape);
  if (sh.length) html += `<div class="card"><h2>Planned vs actual shape</h2>${sh.map(([k, s]) => `<div class="tend"><div><b>Planned ${k}: ${Math.round((s.ok / s.n) * 100)}% came off</b><div class="mute small">${s.n} shot${s.n > 1 ? 's' : ''}${Object.keys(s.got).length ? ` · instead: ${Object.entries(s.got).sort((a, z) => z[1] - a[1]).map(([g, v]) => `${esc(lab[g] || g)} ×${v}`).join(', ')}` : ''}</div></div></div>`).join('')}</div>`;
  const G = R.filter((x) => x.G && x.G.complete >= Math.min(9, x.G.holes));
  if (G.length) {
    const avg = Object.fromEntries(['ott', 'app', 'arg', 'putt'].map((k) => [k, G.reduce((a, x) => a + x.G[k] * (18 / x.G.holes), 0) / G.length]));
    const order = Object.entries(avg).sort((a, b) => a[1] - b[1]);
    html = `<div class="card"><h2>Practice priority</h2><p class="mute small" style="margin:0 0 8px">From strokes gained, per 18 holes. Spend practice time in this order.</p>${order.map(([k, v], i) => `<div class="prio"><span class="pn">${i + 1}</span><b>${SG_LABELS[k]}</b><span class="${v < 0 ? 'bad' : 'goodc'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}</span></div>`).join('')}</div>` + html;
  }
  return html;
}

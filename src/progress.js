// Progress → Scoring: what your rounds say. Tiger 5, strokes gained, scoring by par and a DECADE-style
// comparison of each stat against golfers who shoot different scores.
// Progress → Practice (main.js) uses the shot details from rounds plus the swing coach.
import { listRounds, getCourse } from './store.js';
import { roundStats } from './rounds/stats.js';
import { roundSG, SG_LABELS } from './rounds/sg.js';
import { approachBands, executionSummary, bandLabel } from './rounds/bands.js';
import { puttLabel, puttUnit, du, dist as D } from './units.js';
import { tiger5, TIGER5, TIGER5_LABEL, TIGER5_TOUR } from './rounds/tiger.js';
import { sgCard } from './rounds/ui.js';
import { autoShotType } from './rounds/hole.js';
import { CODES } from './rounds/stats.js';
import { differential, adjustedGross, indexFrom, indexHistory } from './rounds/handicap.js';
import { getSettings } from './store.js';

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

/**
 * Handicap trend from every 18-hole round on a rated course. Two passes: gross differentials give a
 * first index, then hole-by-hole rounds are capped at net double bogey with it (WHS adjusted gross).
 */
function handicap(ALL) {
  const rated = ALL.filter((x) => x.S.holes >= 18 && x.c.rating && x.c.slope);
  if (!rated.length) return null;
  let entries = rated.map((x) => ({ date: x.r.date, diff: x.r.quick && x.r.diff != null ? x.r.diff : differential(x.S.score, x.c.rating, x.c.slope), x }));
  const first = indexHistory(entries).current;
  if (first) entries = entries.map((e) => (e.x.r.quick ? e : { ...e, diff: differential(adjustedGross(e.x.r, e.x.c, first.index), e.x.c.rating, e.x.c.slope) }));
  const H = indexHistory(entries);
  const newest = [...entries].sort((a, b) => b.date - a.date).slice(0, 20);
  const cur = indexFrom(newest.map((e) => e.diff));
  return { ...H, newest, counted: new Set((cur?.counted || []).map((i) => newest[i].x.r.id)), current: cur };
}

const bars = (vals, { hi = null, lo = null, cls = () => '' } = {}) => {
  const v = vals.map((x) => x.v).filter(Number.isFinite);
  if (!v.length) return '';
  const max = hi ?? Math.max(...v), min = lo ?? Math.min(...v); const span = max - min || 1;
  return `<div class="hbars">${vals.map((x) => `<i class="${cls(x)}" title="${esc(x.t || '')}" style="height:${x.v == null ? 0 : 12 + ((x.v - min) / span) * 88}%"></i>`).join('')}</div>`;
};
const ym = (t) => new Date(t).getFullYear();

function handicapCard(Hc) {
  const S = getSettings();
  if (S.handicapMode === 'manual' || (!S.handicapMode && S.handicap != null)) {
    return `<div class="card"><div class="scorehead"><div><span class="mute small">Handicap index · yours</span><div class="big">${S.handicap != null ? f1(S.handicap) : '–'}</div>
      <span class="mute small">${S.handicap != null ? 'Kept by you (GHIN or your club). Update it in your profile.' : 'Add your index in your profile, or switch to "work it out from my rounds".'}</span></div></div></div>`;
  }
  if (!Hc || !Hc.current) return `<div class="card"><h2>Handicap index</h2><p class="mute small">Shows after 3 rounds of 18 holes on courses with a rating and slope (every UAE library course has them). Post past scores from Play to build it faster.</p></div>`;
  const hist = Hc.history.filter((h) => h.index != null);
  const prev5 = hist.length > 5 ? hist[hist.length - 6].index : null;
  const delta = prev5 != null ? Hc.current.index - prev5 : null;
  const line = hist.length > 1 ? spark(hist.slice(-20).map((h) => h.index), { good: 'down' }) : '';
  return `<div class="card">
    <div class="scorehead"><div><span class="mute small">Handicap index · from your rounds</span><div class="big">${f1(Hc.current.index)}</div>
      <span class="small ${delta == null ? 'mute' : delta <= 0 ? 'goodc' : 'workc'}">${delta == null ? `${Hc.current.of} of 20 rounds` : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} over last 5 rounds`}${Hc.low ? ` · low ${f1(Hc.low.index)}` : ''}</span></div>${line}</div>
    <p class="mute small" style="margin:8px 0 0">Best ${Hc.current.counted.length} of your last ${Hc.current.of} differentials, WHS maths. Tracks GHIN closely; the official number is on GHIN.</p>
  </div>`;
}

function scoringHistoryCard(R, Hc) {
  const full = [...R].filter((x) => x.S.holes >= 18).sort((a, b) => a.r.date - b.r.date).slice(-20);
  if (!full.length) return '';
  const sc = full.map((x) => x.S.score);
  const avg = sc.reduce((a, b) => a + b, 0) / sc.length;
  const last5 = sc.slice(-5), prior5 = sc.slice(-10, -5);
  const a5 = last5.reduce((a, b) => a + b, 0) / last5.length, p5 = prior5.length ? prior5.reduce((a, b) => a + b, 0) / prior5.length : null;
  return `<div class="card">
    <div class="scorehead"><div><span class="mute small">Average score · last ${sc.length} round${sc.length > 1 ? 's' : ''}</span><div class="big">${f1(avg)}</div>
      ${p5 != null ? `<span class="small ${a5 <= p5 ? 'goodc' : 'workc'}">last 5: ${f1(a5)} · ${a5 <= p5 ? '↓' : '↑'} ${Math.abs(a5 - p5).toFixed(1)} vs the 5 before</span>` : ''}</div>
      <div class="hilo"><span><b>${Math.min(...sc)}</b>low</span><span><b>${Math.max(...sc)}</b>high</span></div></div>
    ${bars(full.map((x) => ({ v: x.S.score, t: `${x.r.courseName} ${x.S.score}`, counted: Hc?.counted.has(x.r.id) })), { lo: Math.min(...sc) - 8, cls: (x) => (x.counted ? 'on' : '') })}
    <p class="mute small" style="margin:6px 0 0">Oldest to newest. ${Hc?.current ? 'Green bars are the differentials counting toward your index.' : ''}</p>
  </div>`;
}

function distributionCard(R) {
  const H = R.filter((x) => !x.S.quick && x.S.holes);
  if (!H.length) return '';
  const tot = H.reduce((a, x) => a + x.S.holes, 0);
  const rows = [['Birdies or better', H.reduce((a, x) => a + x.S.birdies, 0)], ['Pars', H.reduce((a, x) => a + x.S.pars, 0)], ['Bogeys', H.reduce((a, x) => a + x.S.bogeys, 0)], ['Double bogeys', H.reduce((a, x) => a + x.S.doubles - x.S.triples, 0)], ['Triples or worse', H.reduce((a, x) => a + x.S.triples, 0)]];
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="card"><h2>Scoring distribution</h2>
    <div class="bars">${rows.map(([l, n]) => `<div><span>${l}</span><div class="meter"><div style="width:${(100 * n) / max}%;background:var(--acc)"></div></div><span>${Math.round((100 * n) / tot)}%</span></div>`).join('')}</div>
    <p class="mute small" style="margin:6px 0 0">${tot} holes from ${H.length} hole-by-hole round${H.length > 1 ? 's' : ''}.</p></div>`;
}

/** Putting: putts a round, 1-putts and 3-putts, make % and 3-putt % by first-putt length. */
function puttingCard(R) {
  const H = R.filter((x) => !x.S.quick && x.S.puttsHoles);
  if (!H.length) return '';
  const holes = H.flatMap((x) => (x.r.holes || []).filter((h) => h && h.putts != null));
  const n = holes.length;
  const per18 = (f) => (n ? (holes.reduce((a, h) => a + f(h), 0) / n) * 18 : null);
  const B = [[3, '≤3 ft'], [6, '4–6'], [10, '7–10'], [20, '11–20'], [30, '21–30'], [50, '30+']];
  const withFp = holes.filter((h) => h.firstPutt != null);
  const rows = B.map(([ft, l]) => { const hs = withFp.filter((h) => h.firstPutt === ft); return { l, n: hs.length, made: hs.filter((h) => h.putts === 1).length, three: hs.filter((h) => h.putts >= 3).length }; }).filter((r) => r.n);
  const pc = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  return `<div class="card"><h2>Putting</h2>
    <div class="kpis"><div><b>${f1(per18((h) => h.putts))}</b><span>putts / round</span></div><div><b>${f1(per18((h) => (h.putts === 1 ? 1 : 0)))}</b><span>1-putts</span></div><div><b>${f1(per18((h) => (h.putts >= 3 ? 1 : 0)))}</b><span>3-putts</span></div><div><b>${pc(holes.filter((h) => h.putts === 0).length, n)}</b><span>holed out</span></div></div>
    ${rows.length ? `<table class="dk"><tr><th>First putt</th><th>Made</th><th>3-putt</th><th>Holes</th></tr>${rows.map((r) => `<tr><td>${r.l}</td><td><b>${pc(r.made, r.n)}</b></td><td class="${r.three ? 'workc' : ''}">${pc(r.three, r.n)}</td><td class="mute">${r.n}</td></tr>`).join('')}</table>
    <p class="mute small" style="margin:6px 0 0">Tour makes about 99% from 3 ft, 70% from 6, 40% from 10, 15% from 20. 3-putts from 30+ are speed, not line.</p>` : '<p class="mute small">Tap the first-putt length on each hole and make % by distance shows here.</p>'}
  </div>`;
}

function activityCard(ALL) {
  const y = new Date().getFullYear();
  const Y = ALL.filter((x) => ym(x.r.date) === y);
  if (!Y.length) return '';
  const by = {}; Y.forEach((x) => { by[x.r.courseName] = (by[x.r.courseName] || 0) + 1; });
  const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  return `<div class="card"><h2>${y}</h2>
    <div class="kpis k2"><div><b>${Y.length}</b><span>rounds</span></div><div><b>${list.length}</b><span>courses</span></div></div>
    <details><summary class="mute small">Courses played</summary>${list.map(([n, k]) => `<div class="tagrow"><span>${esc(n)}</span><b>${k}</b></div>`).join('')}</details></div>`;
}

export async function renderScoring(el) {
  const ALL = await loadRounds(200);
  const R = ALL.slice(0, 20);
  if (!R.length) { el.innerHTML = '<div class="card"><h2>No rounds yet</h2><p class="mute">Log a round in Play. Your scoring, Tiger 5 and strokes gained build up here.</p></div>'; return; }
  const full = R.filter((x) => x.S.holes >= 18);
  const n = R.length;
  const sum = (f) => R.reduce((a, x) => a + (f(x) || 0), 0);
  const L = R.filter((x) => !x.S.quick); // hole-by-hole rounds, for stats that need holes
  const per = (f) => (L.length ? L.reduce((a, x) => a + (f(x) || 0), 0) / L.length : null);
  // scoring by par (all holes)
  const byPar = { 3: [0, 0], 4: [0, 0], 5: [0, 0] };
  R.forEach(({ S }) => { for (const p of [3, 4, 5]) { byPar[p][0] += S.byPar[p][0]; byPar[p][1] += S.byPar[p][1]; } });
  const parAvg = (p) => (byPar[p][1] ? byPar[p][0] / byPar[p][1] : null);
  const avg = full.length ? full.reduce((a, x) => a + x.S.score, 0) / full.length : null;
  const G = R.filter((x) => x.G && x.G.complete >= Math.min(9, x.G.holes));
  const sgAvg = G.length ? Object.fromEntries(['ott', 'app', 'arg', 'putt', 'total'].map((k) => [k, G.reduce((a, x) => a + x.G[k] * (18 / x.G.holes), 0) / G.length])) : null;
  const AB = approachBands(ALL); const EX = executionSummary(ALL);
  const proxTxt = (ft) => (ft == null ? '–' : ft === 0 ? 'in' : `${puttLabel([3, 6, 10, 20, 30, 50].reduce((a, b) => (Math.abs(b - ft) < Math.abs(a - ft) ? b : a)))} ${puttUnit() === 'feet' ? 'ft' : 'm'}`);
  // the break-80 plan numbers (Golf Digest "The Game Plan": 7 bogeys + 11 pars, no doubles; GIR+1 16–17 of 18; recovery drives; the 150–200 zone; lag speed)
  const T = (k) => L.reduce((a, x) => a + (x.S[k] || 0), 0);
  const holesL = T('holes');
  const planCard = holesL >= 18 ? (() => {
    const p18 = 18 / holesL;
    const rows = [
      ['Doubles or worse', `${(T('doubles') * p18).toFixed(1)} / round`, 'under 1', T('doubles') * p18 <= 1],
      ['GIR+1 (on in par−1)', T('gir1Opp') ? `${Math.round((100 * T('gir1')) / T('gir1Opp'))}%` : '–', '85%+ (16 of 18)', T('gir1Opp') ? T('gir1') / T('gir1Opp') >= 0.85 : null],
      ['Recovery drives', `${(T('dirt') * p18).toFixed(1)} / round`, 'under 1.5', T('dirt') * p18 < 1.5],
      ['Doubles from 150–200', T('zone') ? `${Math.round((100 * T('zoneDbl')) / T('zone'))}% of ${T('zone')}` : '–', 'under 10%', T('zone') ? T('zoneDbl') / T('zone') < 0.1 : null],
      ['3-putts from 20 ft+', T('lagOpp') ? `${Math.round((100 * T('lag3')) / T('lagOpp'))}% of ${T('lagOpp')}` : '–', 'under 15%', T('lagOpp') ? T('lag3') / T('lagOpp') < 0.15 : null],
    ];
    return `<div class="card"><h2>The scoring plan</h2>
      <p class="mute small" style="margin:0 0 8px">Scores drop by avoiding bogeys and doubles, not by chasing birdies: a 10-handicap makes one fewer birdie than scratch but 2½ more doubles. The five numbers that decide it, from your hole-by-hole rounds.</p>
      <table class="bands"><tr><th>Number</th><th>You</th><th>Breaking 80</th></tr>
        ${rows.map(([l, v, t, ok]) => `<tr class="${ok === true ? 'best' : ok === false ? 'worst' : 'thin'}"><td>${l}</td><td>${v}</td><td class="mute">${t}</td></tr>`).join('')}</table>
      <p class="mute small" style="margin:8px 0 0">Par 3s ${parAvg(3) != null ? (parAvg(3) - 3).toFixed(2) : '–'} · par 4s ${parAvg(4) != null ? (parAvg(4) - 4).toFixed(2) : '–'} · par 5s ${parAvg(5) != null ? (parAvg(5) - 5).toFixed(2) : '–'} over par per hole. For 80-shooters the 3s and 5s are the par chances.</p></div>`;
  })() : '';
  const bandsCard = AB.total >= 10 ? `<div class="card"><h2>Where you score from</h2>
    <p class="mute small" style="margin:0 0 8px">Approach shots by the distance you hit them from, all your rounds. Strokes to finish = the approach plus what it left you (tour baseline in grey). ${AB.best ? `You score best from <b>${bandLabel(AB.best.band, D)}</b>${AB.worst && AB.worst !== AB.best ? `, worst from <b>${bandLabel(AB.worst.band, D)}</b>` : ''}: when you can't reach, lay up to ${bandLabel(AB.best.band, D)}.` : 'Needs 5+ shots in a band.'}</p>
    <table class="bands"><tr><th>From (${du()})</th><th>Shots</th><th>Green</th><th>1st putt</th><th>To finish</th></tr>
      ${AB.bands.filter((b) => b.n).map((b) => `<tr class="${AB.best === b ? 'best' : AB.worst === b ? 'worst' : ''} ${b.enough ? '' : 'thin'}"><td>${bandLabel(b.band, D)}</td><td>${b.n}</td><td>${b.gir != null ? Math.round(b.gir * 100) + '%' : '–'}</td><td>${proxTxt(b.prox)}</td><td>${b.finish != null ? b.finish.toFixed(2) : '–'} <span class="mute small">${b.tour.toFixed(2)}</span></td></tr>`).join('')}</table>
    ${EX.n >= 10 ? `<p class="mute small" style="margin:8px 0 0">Shots that came off as planned: <b>${EX.planned != null ? Math.round(EX.planned * 100) + '%' : '–'}</b>${EX.sat != null ? ` · average satisfaction <b>${EX.sat.toFixed(1)}★</b>` : ''} (from shot Details).</p>` : ''}
  </div>` : '';
  // per-18 scaling for counts from 9-hole rounds
  const p18 = (x, v) => v * (18 / Math.max(9, x.S.holes));
  const t5 = Object.fromEntries(TIGER5.map((id) => [id, L.length ? L.reduce((a, x) => a + p18(x, x.T.by[id] || 0), 0) / L.length : 0]));
  const t5tot = Object.values(t5).reduce((a, b) => a + b, 0);
  const recent = [...R].reverse(); // oldest → newest for charts

  const myBand = band('avg', avg);
  const mark = (metric, v) => {
    const b = band(metric, v); if (b == null || myBand == null) return '';
    return b < myBand ? '<span class="mk good">✓</span>' : b > myBand ? '<span class="mk bad">✕</span>' : '<span class="mk">○</span>';
  };
  const row = (label, metric, v, fmt = f2) => `<tr><td>${label}</td><td><b>${fmt(v)}</b></td><td>${v == null ? '' : BANDS[band(metric, v)]}</td><td>${mark(metric, v)}</td></tr>`;

  const auto = getSettings().handicapMode !== 'manual' && !(!getSettings().handicapMode && getSettings().handicap != null);
  const Hc = auto ? handicap(ALL) : null;
  el.innerHTML = `
    ${handicapCard(Hc)}
    ${scoringHistoryCard(ALL, Hc)}
    ${distributionCard(R)}
    ${puttingCard(R)}

    ${L.length ? `    <div class="card">
      <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Tiger 5</h2><span class="sgpill ${t5tot <= 6 ? 'pos' : 'neg'}" style="float:none">${f1(t5tot)} / round</span></div>
      <p class="mute small" style="margin:0 0 10px">Scott Fawcett's rule: six or fewer of these a round and you're playing to win. Tour top-5 finishers average about 1.6, missed cuts 3.7 (not counting blown saves).</p>
      <table class="t5"><tr><th></th><th>You</th><th>Top 5</th><th>Missed cut</th></tr>
        ${TIGER5.map((id) => `<tr><td>${TIGER5_LABEL[id]}</td><td><b>${f2(t5[id])}</b></td><td>${TIGER5_TOUR[id] ? TIGER5_TOUR[id][0] : '–'}</td><td>${TIGER5_TOUR[id] ? TIGER5_TOUR[id][1] : '–'}</td></tr>`).join('')}
      </table>
      <div class="t5bars">${recent.filter((x) => !x.S.quick).map((x) => `<i title="${esc(x.r.courseName)}: ${x.T.total}" style="height:${Math.min(100, x.T.total * 8)}%;background:var(--${x.T.total <= 6 ? 'good' : 'work'})"></i>`).join('')}<span class="goal" style="bottom:48%">6</span></div>
      <p class="mute small" style="margin:6px 0 0">Bars: each round, oldest to newest. Bogeys inside 150 and blown saves need shot distances in the hole log.</p>
    </div>` : '<div class="card"><h2>Tiger 5</h2><p class="mute small">Needs hole-by-hole rounds. Posted totals only feed the handicap and scoring average.</p></div>'}

    ${sgAvg ? sgCard(sgAvg, `Per 18 holes, average of ${G.length} round${G.length > 1 ? 's' : ''} with shot data`) : '<div class="card"><h2>Strokes gained</h2><p class="mute small">Shows once rounds have shot distances (from the rangefinder) and first-putt distances.</p></div>'}
    ${planCard}
    ${bandsCard}

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

    ${L.length ? `    <div class="card">
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
      <p class="mute small" style="margin:8px 0 0">${L.length} hole-by-hole round${L.length > 1 ? 's' : ''}; 9-hole rounds scaled to 18.</p>
    </div>` : ''}
    ${activityCard(ALL)}`;
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

// Progress → Scoring: what your rounds say. Tiger 5, strokes gained, scoring by par and a DECADE-style
// comparison of each stat against golfers who shoot different scores.
// Progress → Practice (main.js) uses the shot details from rounds plus the swing coach.
import { listRounds, getCourse } from './store.js';
import { roundStats } from './rounds/stats.js';
import { roundSG } from './rounds/sg.js';
import { approachBands, bandLabel } from './rounds/bands.js';
import { puttLabel, puttBand, PUTT_FT, du, dist as D } from './units.js';
import { tiger5, TIGER5, TIGER5_LABEL } from './rounds/tiger.js';
import { autoShotType } from './rounds/hole.js';
import { CODES } from './rounds/stats.js';
import { differential, adjustedGross, indexFrom, indexHistory } from './rounds/handicap.js';
import { getSettings, saveSettings } from './store.js';
import { heatByHole } from './heat.js';
import { skillRadar, radarSvg, radarRead, radarRound, radarUses, radarShots, LONG_FROM } from './rounds/radar.js';
import { levelLabel, benchFor, targetHcp } from './benchmarks.js';
import { ART, CONTOUR } from './art.js';
import { counts, roundIssues, roundNotes } from './rounds/quality.js';
import { bodyStats } from './rounds/body.js';
import { putRound } from './store.js';

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

/** The rounds that feed Progress (see rounds/quality.js), newest first. `all: true` returns every candidate with its verdict. */
export async function loadRounds(n = 20, { all = false } = {}) {
  const rounds = await listRounds().catch(() => []);
  const out = [];
  for (const r of rounds) {
    if (!all && out.length >= n) break;
    if (!r.finished && r.countPick !== true && !all) continue;
    const c = await getCourse(r.courseId).catch(() => null);
    if (!c) continue;
    const ok = counts(r, c);
    if (!ok && !all) continue;
    out.push(all ? { r, c, ok, issues: roundIssues(r, c), notes: roundNotes(r, c), rad: radarRound({ ...r, radarPick: undefined }, c) } : { r, c, S: roundStats(r, c), G: roundSG(r, c), T: tiger5(r, c) });
  }
  return out;
}

const fmtShort = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

/** Choose which rounds count: every round, a tick each, with what looks wrong spelled out. */
async function roundsSheet(onDone) {
  const list = await loadRounds(0, { all: true });
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet pickrounds';
  const chip = (r, rad) => {
    const S = radarShots({ ...r, radarPick: undefined }, list.find((x) => x.r === r)?.c);
    const n = S.shots.length, p = S.putts.length;
    if (!n && !p) return '<span class="rchip none">Scores only</span>';
    const on = r.radarPick !== false;
    const what = rad && rad.holes && rad.complete === rad.holes ? `all ${rad.holes} holes tracked` : `${n} shot${n === 1 ? '' : 's'}${p ? `, ${p} putting holes` : ''}`;
    return `<button class="rchip ${on ? 'on' : ''}" data-radar-rid="${esc(r.id)}">${on ? `In radar · ${what}` : 'Left out of radar'}</button>`;
  };
  const row = ({ r, c, ok, issues, notes, rad }) => {
    const sc = (r.holes || []).reduce((a, h) => a + (h?.score || 0), 0) || r.score || null;
    const played = (r.holes || []).filter((h) => h?.score != null).length;
    const shots = r.shotsTracked || (r.holes || []).reduce((a, h) => a + (h?.shots?.length || 0), 0);
    const why = r.countPick != null ? [r.countPick ? 'counted by you' : 'left out by you', ...(issues.length ? issues : notes)].join(' · ') : issues.length ? issues.join(' · ') : notes.join(' · ');
    return `<label class="prow ${ok ? '' : 'off'}"><input type="checkbox" data-rid="${esc(r.id)}" ${ok ? 'checked' : ''}/>
      <span class="pmain"><b>${esc(r.courseName || c.name)}</b><span class="mute small">${new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${r.quick ? 'score only' : `${played}/${c.holes.length} holes`}${shots ? ` · ${shots} shots` : ''}${r.source === 'garmin' ? ' · Garmin' : ''}</span>
      ${why ? `<span class="pwhy ${r.countPick == null && issues.length ? 'warn' : ''}">${esc(why)}</span>` : ''}${chip(r, rad)}</span><span class="psc">${sc ?? '–'}</span></label>`;
  };
  const n = list.filter((x) => x.ok).length;
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Rounds in your stats</b><button class="link" data-close>Done</button></div>
    <p class="small mute" style="margin:0 0 10px">${n} of ${list.length} count. Rounds that look unfinished (under 9 holes, holes skipped in the middle, impossible scores, or most tracked holes missing shots) are left out until you tick them. A hole missing shots never counts toward strokes gained; its score and putts still do.</p>
    <p class="small mute" style="margin:0 0 10px">The radar only uses rounds where every hole's logged shots and putts add up to its score. Tap a round's radar tag to keep it out of the radar but in your scores.</p>
    <div class="plist">${list.map(row).join('') || '<p class="mute">No rounds yet.</p>'}</div>
    <button class="btn" data-auto style="width:100%;margin-top:12px">Back to automatic for every round</button></div>`;
  const byId = new Map(list.map((x) => [x.r.id, x]));
  let changed = false;
  sheet.addEventListener('change', async (e) => {
    const x = byId.get(e.target.dataset.rid); if (!x) return;
    x.r.countPick = e.target.checked; x.r.updatedAt = Date.now(); changed = true;
    await putRound(x.r);
    e.target.closest('.prow').classList.toggle('off', !e.target.checked);
    const w = e.target.closest('.prow').querySelector('.pwhy') || e.target.closest('.prow').querySelector('.pmain').appendChild(Object.assign(document.createElement('span'), { className: 'pwhy' }));
    w.className = 'pwhy'; w.textContent = e.target.checked ? 'counted by you' : 'left out by you';
  });
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-radar-rid]'); if (!b) return;
    e.preventDefault();
    const x = byId.get(b.dataset.radarRid); if (!x) return;
    if (x.r.radarPick === false) delete x.r.radarPick; else x.r.radarPick = false;
    x.r.updatedAt = Date.now(); changed = true; await putRound(x.r);
    b.outerHTML = chip(x.r, x.rad);
  });
  sheet.querySelector('[data-auto]').onclick = async () => {
    for (const x of list) if (x.r.countPick != null || x.r.radarPick != null) { delete x.r.countPick; delete x.r.radarPick; x.r.updatedAt = Date.now(); await putRound(x.r); }
    sheet.remove(); onDone(); roundsSheet(onDone);
  };
  sheet.querySelector('[data-close]').onclick = () => { sheet.remove(); if (changed) onDone(); };
  document.body.appendChild(sheet);
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






// ---- the page: a hero band (radar + three numbers), then one section per part of the game ----
const sgn = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : +Math.abs(v).toFixed(d) === 0 ? (0).toFixed(d) : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);
const mark = (ok) => (ok == null ? '' : `<span class="mk ${ok ? 'c' : 's'}" aria-label="${ok ? 'on target' : 'not yet'}"></span>`);
const pctN = (a, b) => (b ? Math.round((100 * a) / b) : null);
const tile = (v, label, ok) => `<div><b>${v ?? '–'}${ok != null ? mark(ok) : ''}</b><small>${label}</small></div>`;

/** Section header: drawing, title, one sentence. */
function area(id, art, title, line, body) {
  if (!body) return '';
  return `<section class="area" id="pg-${id}"><div class="ah">${ART[art]}<div><h2>${title}</h2>${line ? `<p>${line}</p>` : ''}</div></div>${body}</section>`;
}

/** The verdict line for a radar axis. */
function verdict(radar, key, read, hcp) {
  const a = radar.axes.find((x) => x.key === key);
  if (!a || !a.enough || a.value == null) return a && a.n ? `Needs a few more rounds with shot detail (${a.n} so far).` : '';
  const who = `a ${levelLabel(hcp)} golfer`;
  const pre = read?.worst?.key === key ? 'Your biggest gap: ' : read?.best?.key === key ? 'Your strength: ' : '';
  if (Math.abs(a.value) < 0.3) return `${pre}about level with ${who}.`;
  return `${pre}${mark(a.value > 0).replace('mk ', 'mk inline ')} ${Math.abs(a.value).toFixed(1)} strokes a round ${a.value > 0 ? 'better' : 'worse'} than ${who}.`;
}

function hero0Detail(ALL, hcp) {
  const r = skillRadar(ALL.filter((x) => radarUses(x.r, x.c)).slice(0, 10), { hcp });
  return r.axes.map((a) => `<div><b>${esc(a.label)}</b><span>${a.detail ? esc(a.detail) : 'Not enough rounds yet.'}</span></div>`).join('');
}

function heroBand(ALL, Hc, hcp, OUT = 0, KINDS = null) {
  // the radar looks at rounds with any shot it can score on its own: "Last 10" is the last 10 of those
  const L = ALL.filter((x) => radarUses(x.r, x.c));
  const basis = (list) => {
    if (!list.length) return 'No round yet has a shot with a known start and finish, so the radar is empty. Log your shots in osolo (watch-recorded shots don\'t count: the watch can\'t see lies or penalties).';
    const S = list.map((x) => radarShots(x.r, x.c));
    const shots = S.flatMap((s) => s.shots), putts = S.reduce((a, s) => a + s.putts.length, 0);
    const n = (k) => shots.filter((s) => s.cat === k).length;
    const full = list.map((x) => radarRound(x.r, x.c)).filter((R) => R && R.holes && R.complete === R.holes).length;
    const span = `${fmtShort(list[list.length - 1].r.date)} – ${fmtShort(list[0].r.date)}`;
    return `${list.length} round${list.length === 1 ? '' : 's'} (${span}), ${full} with every shot logged: ${n('ott')} drives, ${n('appL') + n('appW')} approaches, ${n('arg')} short-game shots, ${putts} putting holes. Each shot counts only when its start and finish are known; shots a watch recorded are left out.`;
  };
  const windows = [10, 50, 100].map((n) => ({ n, radar: skillRadar(L.slice(0, n), { hcp }), ghost: L.length > n ? skillRadar(L.slice(n, 2 * n), { hcp }) : null }));
  const views = Object.fromEntries(windows.map((w) => [w.n, `${radarSvg(w.radar, w.ghost)}<p class="hbasis">${esc(basis(L.slice(0, w.n)))}</p>${w.radar.ready ? '' : `<p class="hnote">Each spoke fills in once it has 3 rounds and enough shots (10, or 18 holes for putting).</p>`}`]));
  const full = ALL.filter((x) => x.S.holes >= 18).sort((a, b) => a.r.date - b.r.date).slice(-20);
  const sc = full.map((x) => x.S.score);
  const avg = sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
  const l5 = sc.slice(-5), p5 = sc.slice(-10, -5);
  const trend = p5.length ? l5.reduce((a, b) => a + b, 0) / l5.length - p5.reduce((a, b) => a + b, 0) / p5.length : null;
  const idx = Hc?.current ? Hc.current.index : getSettings().handicap;
  return { windows, html: `<section class="hero radarcard" data-radar-views='${esc(JSON.stringify(views))}'><div class="contour" style="--mask:${CONTOUR}"></div>
    <h1>Your game</h1><p class="hsub">The handicap each part of your game plays like. Tap an area to jump to it.</p>
    <p class="hused">Scores from ${ALL.length} round${ALL.length === 1 ? '' : 's'}${OUT ? ` (${OUT} left out)` : ''}, radar from ${L.length} <button class="link" data-pickrounds>Choose rounds</button></p>
    ${KINDS ? `<div class="kindf" role="group" aria-label="Which rounds">${[['all', 'All'], ['comp', 'Competition'], ['casual', 'Casual']].map(([k, l]) => `<button data-kindf="${k}" class="${KINDS === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div class="rwin" role="group" aria-label="Rounds">${windows.map((w, i) => { const prev = i ? windows[i - 1].n : 0; const off = i > 0 && L.length <= prev; return `<button data-radar-n="${w.n}" class="${w.n === 10 ? 'on' : ''}" ${off ? 'disabled' : ''}>${L.length > prev && L.length < w.n && i > 0 ? `All ${L.length}` : `Last ${w.n}`}</button>`; }).join('')}</div>
    <div class="radarbox">${views[10]}</div>
    <div class="legend"><span><i class="lg-you"></i>You</span><span><i class="lg-gh"></i>Rounds before</span><span><i class="lg-scr"></i>Your target: ${targetHcp(hcp) ? `${targetHcp(hcp)} handicap` : 'scratch'}</span></div>
    <div class="hstats">${tile(idx != null ? f1(idx) : '–', Hc?.current ? 'Handicap index' : 'Handicap (yours)')}${tile(avg != null ? f1(avg) : '–', `Average, last ${sc.length || 0}`)}${tile(trend != null ? sgn(trend) : '–', 'Last 5 vs the 5 before')}</div>
    <details class="hexplain"><summary>How the shape is scored</summary><div class="radarinfo"><p>Each area is strokes gained per 18 holes against the tour, turned into a handicap. Broadie's split: an h-handicap gives up about h+3 strokes a round, 28% driving, 40% approach (60/40 long vs wedges at ${LONG_FROM} yd), 17% short game, 15% putting. Mind is penalties and recovery drives against your level's rate, plus how often rated shots went to plan. Each spoke sits at the handicap that part of your game plays like: the rings are what a scratch (outer), 5, 10, 15 and 20 handicap do there. The stronger ring is your target, five shots better than you in steps of five (scratch from a 6, a 5 from a 10).</p>
      ${hero0Detail(ALL, hcp)}</div></details>
  </section>` };
}

export async function renderScoring(el) {
  const EVERY = await loadRounds(200);
  const kindSel = getSettings().progressKind || 'all';
  const hasKinds = EVERY.some((x) => x.r.kind);
  const ALL = !hasKinds || kindSel === 'all' ? EVERY : EVERY.filter((x) => x.r.kind === kindSel);
  const OUT = (await loadRounds(0, { all: true })).filter((x) => !x.ok).length;
  const R = ALL.slice(0, 20);
  if (!R.length && hasKinds && kindSel !== 'all') {
    el.innerHTML = `<section class="hero empty"><h1>Your game</h1><p class="hsub">No ${kindSel === 'comp' ? 'competition' : 'casual'} rounds yet.</p><div class="kindf">${[['all', 'All'], ['comp', 'Competition'], ['casual', 'Casual']].map(([k, l]) => `<button data-kindf="${k}" class="${kindSel === k ? 'on' : ''}">${l}</button>`).join('')}</div></section>`;
    el.onclick = (e) => { const kf = e.target.closest('[data-kindf]'); if (kf) { const st = getSettings(); st.progressKind = kf.dataset.kindf; saveSettings(st); renderScoring(el); } };
    return;
  }
  if (!R.length) {
    el.innerHTML = `<section class="hero empty"><h1>Your game</h1><p class="hsub">${OUT ? `None of your ${OUT} rounds count yet: they look unfinished. Choose the ones that should.` : 'Play or post a round and your game takes shape here: driving, approach, short game, putting and the mental side, against golfers at your level.'}</p>${OUT ? '<button class="btn" data-pickrounds>Choose rounds</button>' : ''}</section>`;
    el.onclick = (e) => { if (e.target.closest('[data-pickrounds]')) roundsSheet(() => renderScoring(el)); };
    return;
  }
  const L = R.filter((x) => !x.S.quick);
  const T = (k) => L.reduce((a, x) => a + (x.S[k] || 0), 0);
  const holesL = T('holes'); const p18 = holesL ? 18 / holesL : 0;
  const auto = getSettings().handicapMode !== 'manual' && !(!getSettings().handicapMode && getSettings().handicap != null);
  const Hc = auto ? handicap(ALL) : null;
  const hcp = (auto ? Hc?.current?.index : getSettings().handicap) ?? 15;
  const hero = heroBand(ALL, Hc, hcp, OUT, hasKinds ? kindSel : null);
  const radar = hero.windows[0].radar, read = radarRead(radar);
  const G = R.filter((x) => x.G && x.G.complete >= Math.min(9, x.G.holes));
  const sg = G.length ? Object.fromEntries(['ott', 'app', 'arg', 'putt', 'total'].map((k) => [k, G.reduce((a, x) => a + x.G[k] * (18 / x.G.holes), 0) / G.length])) : null;
  const sgLine = (k) => (sg ? `<p class="note">Strokes gained against a tour player: <b>${sgn(sg[k])}</b> a round, over ${G.length} round${G.length > 1 ? 's' : ''} with shot data.</p>` : '');

  // --- scoring ---
  const dist = (() => {
    if (!holesL) return '';
    const rows = [['Birdies', T('birdies'), 'var(--birdie)'], ['Pars', T('pars'), 'var(--par)'], ['Bogeys', T('bogeys'), 'var(--bogey)'], ['Doubles+', T('doubles'), 'var(--double)']];
    const tg = targetHcp(hcp), TB = benchFor(tg), who = tg ? `A ${tg} handicap` : 'Scratch';
    const per = (n) => (n * 18) / holesL;
    const toParYou = L.length ? L.reduce((a, x) => a + (x.S.toPar * 18) / Math.max(9, x.S.holes), 0) / L.length : null;
    const cmp = [['Over par a round', toParYou, TB.avgScore - 72, false], ['Birdies', per(T('birdies')), TB.birdies, true], ['Pars', per(T('pars')), TB.pars, true], ['Bogeys', per(T('bogeys')), TB.bogeys, false], ['Doubles+', per(T('doubles')), TB.doubles, false]];
    const tStrip = [['b', TB.birdies, 'var(--birdie)'], ['p', TB.pars, 'var(--par)'], ['o', TB.bogeys, 'var(--bogey)'], ['d', TB.doubles, 'var(--double)']];
    return `<div class="card"><h3>Every hole, last ${L.length} round${L.length > 1 ? 's' : ''}</h3>
      <div class="dlab">You</div><div class="dstrip">${rows.filter((r) => r[1]).map(([, n, c]) => `<i style="flex:${n};background:${c}"></i>`).join('')}</div>
      <div class="dlab">${who}</div><div class="dstrip tgt">${tStrip.map(([, n, c]) => `<i style="flex:${n};background:${c}"></i>`).join('')}</div>
      <div class="dstrip-l">${rows.map(([l, n, c]) => `<span><i style="background:${c}"></i>${l} <b>${Math.round((100 * n) / holesL)}%</b></span>`).join('')}</div>
      <table class="dcmp"><thead><tr><th></th><th>You</th><th>${who}</th></tr></thead><tbody>${cmp.filter(([, you]) => you != null).map(([l, you, them, more]) => `<tr><td>${l === 'Over par a round' ? l : `${l} a round`}</td><td class="${(more ? you >= them : you <= them) ? 'ok' : 'gap'}">${you.toFixed(1)}</td><td>${them.toFixed(1)}</td></tr>`).join('')}</tbody></table>
      <p class="note">${who}: the level five shots better than you, in steps of five. Their numbers are Shot Scope's averages for that handicap (over par: a typical round on a par 72 of average difficulty).</p></div>`;
  })();
  const full = [...R].filter((x) => x.S.holes >= 18).sort((a, b) => a.r.date - b.r.date).slice(-20);
  const sc = full.map((x) => x.S.score);
  const hist = sc.length > 1 ? `<div class="card"><h3>Scores, oldest to newest</h3>${bars(full.map((x) => ({ v: x.S.score, t: `${x.r.courseName} ${x.S.score}`, counted: Hc?.counted.has(x.r.id) })), { lo: Math.min(...sc) - 8, cls: (x) => (x.counted ? 'on' : '') })}
    <div class="hilo2"><span>Best <b>${Math.min(...sc)}</b></span><span>Worst <b>${Math.max(...sc)}</b></span>${Hc?.current ? '<span class="mute">Highlighted rounds count toward your index</span>' : ''}</div></div>` : '';
  const plan = holesL >= 18 ? (() => {
    const rows = [
      ['Doubles or worse', `${(T('doubles') * p18).toFixed(1)} a round`, 'under 1', T('doubles') * p18 <= 1],
      ['On the green in par − 1', T('gir1Opp') ? `${pctN(T('gir1'), T('gir1Opp'))}%` : '–', '85%', T('gir1Opp') ? T('gir1') / T('gir1Opp') >= 0.85 : null],
      ['Drives needing a recovery', `${(T('dirt') * p18).toFixed(1)} a round`, 'under 1.5', T('dirt') * p18 < 1.5],
      ['Doubles from 150–200', T('zone') ? `${pctN(T('zoneDbl'), T('zone'))}%` : '–', 'under 10%', T('zone') ? T('zoneDbl') / T('zone') < 0.1 : null],
      ['Three-putts from 20 ft+', T('lagOpp') ? `${pctN(T('lag3'), T('lagOpp'))}%` : '–', 'under 15%', T('lagOpp') ? T('lag3') / T('lagOpp') < 0.15 : null],
    ];
    return `<div class="card" id="pg-plan"><h3>The plan for breaking 80</h3>${rows.map(([l, v, t, ok]) => `<div class="plrow">${ok == null ? '<span class="mk n"></span>' : mark(ok)}<div><b>${l}</b><small>target ${t}</small></div><span class="pv">${v}</span></div>`).join('')}
      <p class="note">${mark(true).replace('mk ', 'mk inline ')} on target &nbsp; ${mark(false).replace('mk ', 'mk inline ')} not yet. Scores drop by cutting doubles, not by chasing birdies.</p></div>`;
  })() : '';
  const t5 = Object.fromEntries(TIGER5.map((id) => [id, L.length ? L.reduce((a, x) => a + x.T.by[id] * (18 / Math.max(9, x.S.holes)), 0) / L.length || 0 : 0]));
  const t5tot = Object.values(t5).reduce((a, b) => a + b, 0);
  const t5has = L.some((x) => x.T.total > 0) || holesL >= 18 && T('doubles') + T('bogeys') > 0;
  const pips = (v) => Array.from({ length: 6 }, (_, k) => `<i class="${k < Math.round(v * 2) ? 'on' : ''}"></i>`).join('');
  const tiger = L.length ? `<div class="card"><div class="t5h"><h3>Tiger 5</h3>${t5has ? `<span class="badge ${t5tot <= 6 ? 'ok' : ''}">${f1(t5tot)} a round</span>` : ''}</div>
    ${t5has ? TIGER5.map((id) => `<div class="t5r"><span>${TIGER5_LABEL[id]}</span><span class="pips" aria-hidden="true">${pips(t5[id])}</span><b>${f1(t5[id])}</b></div>`).join('') + '<p class="note">Each dot is half a stroke a round. Six or fewer a round and you\'re playing to win; tour top-5 finishers average about 1.6.</p>'
      : '<p class="note">Nothing to count yet: these rounds have no hole-by-hole scores. Enter scores per hole (or import a scorecard) and Tiger 5 fills in.</p>'}</div>` : '';
  const parAvg = (p) => { let s = 0, n = 0; R.forEach(({ S }) => { s += S.byPar[p][0]; n += S.byPar[p][1]; }); return n ? s / n : null; };
  const avg = full.length ? full.reduce((a, x) => a + x.S.score, 0) / full.length : null;
  const myBand = band('avg', avg);
  const dk = avg != null ? (() => {
    const rows = [['Strokes gained putting', 'sgPutt', sg ? sg.putt : null], ['Par 3s', 'par3', parAvg(3)], ['Par 4s', 'par4', parAvg(4)], ['Par 5s', 'par5', parAvg(5)]].filter((r) => r[2] != null);
    return `<div class="card"><h3>Which golfer each part plays like</h3><p class="note" style="margin:-4px 0 10px">You average ${f1(avg)}. Each stat placed among golfers who average it (DECADE key).</p>
      ${rows.map(([l, k, v]) => { const b = band(k, v); return `<div class="plrow">${b == null || myBand == null || b === myBand ? '<span class="mk n"></span>' : mark(b < myBand)}<div><b>${l}</b><small>${k === 'sgPutt' ? f2(v) : f2(v)}</small></div><span class="pv">${BANDS[b]}</span></div>`; }).join('')}</div>`;
  })() : '';
  const doublesTxt = holesL >= 18 ? `${(T('doubles') * p18).toFixed(1)} doubles or worse a round. Bogeys are fine; doubles are what cost you.` : 'Hole-by-hole rounds fill this in.';
  const scoring = area('scoring', 'scoring', 'Scoring', doublesTxt, [hist, dist, plan, tiger, dk, auto && Hc?.current ? handicapCard(Hc) : ''].join(''));

  // --- driving ---
  const teeMiss = T('teeLeft') + T('teeRight');
  const driving = T('firOpp') ? `<div class="card"><div class="fwy"><div><b>${teeMiss ? pctN(T('teeLeft'), teeMiss) : 0}%</b><small>of misses left</small></div><div class="mid"><b>${pctN(T('fir'), T('firOpp'))}%</b><small>fairways</small></div><div><b>${teeMiss ? pctN(T('teeRight'), teeMiss) : 0}%</b><small>of misses right</small></div></div>
    <div class="trio">${tile((T('teeTrouble') * p18).toFixed(1), 'in trouble a round')}${tile((T('dirt') * p18).toFixed(1), 'needing a recovery')}${tile(T('firOpp'), 'tee shots')}</div>${sgLine('ott')}</div>` : '';
  // --- approach ---
  const AB = approachBands(ALL);
  const bandsHtml = AB.total >= 10 ? `<h3 style="margin-top:18px">On the green, by distance</h3>${AB.bands.filter((b) => b.n).map((b) => `<div class="lrow"><span class="ld">${bandLabel(b.band, D)}</span><div class="lbar"><i style="width:${Math.round((b.gir || 0) * 100)}%"></i></div><span class="lp">${b.gir != null ? Math.round(b.gir * 100) + '%' : '–'}</span></div>`).join('')}
    ${AB.best ? `<p class="note">You score best from <b>${bandLabel(AB.best.band, D)} ${du()}</b>${AB.worst && AB.worst !== AB.best ? `, worst from ${bandLabel(AB.worst.band, D)}` : ''}. When you can't reach, lay up to ${bandLabel(AB.best.band, D)}.</p>` : ''}` : '';
  const approach = T('girOpp') ? `<div class="card" id="pg-bands"><div class="trio">${tile(`${pctN(T('gir'), T('girOpp'))}%`, 'greens in regulation')}${tile(T('gir1Opp') ? `${pctN(T('gir1'), T('gir1Opp'))}%` : '–', 'on in par − 1')}${tile(T('zone') ? `${pctN(T('zoneDbl'), T('zone'))}%` : '–', 'doubles from 150–200')}</div>${bandsHtml}${sgLine('app')}</div>` : '';
  // --- short game ---
  const short = T('scrOpp') ? `<div class="card"><div class="trio">${tile(`${pctN(T('scr'), T('scrOpp'))}%`, 'up and down')}${tile(T('sandOpp') ? `${pctN(T('sand'), T('sandOpp'))}%` : '–', 'sand saves')}${tile(T('scrOpp'), 'missed greens')}</div>${sgLine('arg')}</div>` : '';
  // --- putting ---
  const putting = (() => {
    const H = L.filter((x) => x.S.puttsHoles);
    if (!H.length) return '';
    const holes = H.flatMap((x) => (x.r.holes || []).filter((h) => h && h.putts != null));
    const n = holes.length; const per = (f) => ((holes.reduce((a, h) => a + f(h), 0) / n) * 18).toFixed(1);
    // tour make rates by band (Broadie's PGA Tour one-putt percentages, averaged across each band)
    const TOUR = { 2: 99, 4: 87, 7: 57, 12: 31, 18: 17, 25: 10, 35: 5, 50: 3 };
    const rows = PUTT_FT.map((ft) => { const hs = holes.filter((h) => puttBand(h.firstPutt) === ft); return { ft, n: hs.length, made: hs.filter((h) => h.putts === 1).length }; }).filter((r) => r.n);
    return `<div class="card"><div class="trio">${tile(per((h) => h.putts), 'putts a round')}${tile(per((h) => (h.putts >= 3 ? 1 : 0)), 'three-putts')}${tile(per((h) => (h.putts === 1 ? 1 : 0)), 'one-putts')}</div>
      ${rows.length ? `<h3>Holed, by first-putt length</h3>${rows.map((r) => `<div class="lrow"><span class="ld">${puttLabel(r.ft)}</span><div class="lbar"><i style="width:${Math.round((100 * r.made) / r.n)}%"></i><b style="left:${TOUR[r.ft]}%"></b></div><span class="lp">${Math.round((100 * r.made) / r.n)}%</span></div>`).join('')}
        <p class="note">The tick is a tour player. ${T('lagOpp') ? `From 20 ft and beyond you three-putt ${pctN(T('lag3'), T('lagOpp'))}% of the time — that's speed, not line.` : ''}</p>` : '<p class="note">Tap the first-putt length on each hole and how often you hole out by distance appears here.</p>'}${sgLine('putt')}</div>`;
  })();
  // --- mind ---
  const mind = (() => {
    const planN = T('planN'), planned = T('planned');
    const kept = L.map((x) => x.r.intentionKept).filter(Boolean);
    const pens = L.reduce((a, x) => a + (x.r.holes || []).reduce((b, h) => b + (h?.shots || []).filter((s) => s?.pen).length, 0), 0);
    if (!planN && !kept.length && !holesL) return '';
    return `<div class="card"><div class="trio">${tile(planN ? `${pctN(planned, planN)}%` : '–', 'shots to plan')}${tile(kept.length ? `${(kept.reduce((a, b) => a + b, 0) / kept.length).toFixed(1)}★` : '–', 'intention kept')}${tile((pens * p18).toFixed(1), 'penalties a round')}</div>
      <p class="note">${planN ? `From ${planN} shots you rated in Details.` : 'Rate shots in Details (went to plan, or not) and set an intention at the first tee, and this fills in.'}</p></div>`;
  })();
  // --- body: heart rate and heat ---
  const B = bodyStats(ALL);
  const HB = heatByHole(ALL).filter((b) => b.n >= 18); // at least a round's worth of holes in a band
  const tpH = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
  const tp = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
  const row = (label, sub, v) => `<div class="brow"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="bv">${tp(v)}</span></div>`;
  const body = B.hr || B.heat || B.years || B.closing || HB.length >= 2 ? `<div class="card bodycard">
      ${HB.length >= 2 ? `<h3>Heat stress, hole by hole</h3>${HB.map((b) => `<div class="brow"><span><b>${b.label}</b><small>${b.n} holes${b.key === 'extreme' ? ' · WBGT 30+' : b.key === 'high' ? ' · WBGT 26–29' : b.key === 'moderate' ? ' · WBGT 21–25' : ' · under 21'}</small></span><span class="bv">${tpH(b.toPar)}</span></div>`).join('')}<p class="note">Average to par on each hole, by the heat stress in the hour you played it (estimated WBGT: temperature and humidity together). Rounds with a real start time only.</p>` : ''}
      ${B.hr ? `<h3>Heart rate</h3>${row(`Calmer rounds`, `${B.hr.low.n} rounds · ${Math.round(B.hr.low.bpm)} bpm average`, B.hr.low.toPar)}${row(`Higher heart rate`, `${B.hr.high.n} rounds · ${Math.round(B.hr.high.bpm)} bpm average`, B.hr.high.toPar)}` : ''}
      ${B.heat ? `<h3>Heat</h3>${B.heat.map((b) => row(b.label, `${b.n} rounds`, b.toPar)).join('')}` : ''}
      ${B.closing ? `<h3>Closing holes</h3>${row('Holes 1–14', `${Math.round(B.closing.early.bpm)} bpm at your shots`, B.closing.early.toPar)}${row('Holes 15–18', `${Math.round(B.closing.late.bpm)} bpm at your shots`, B.closing.late.toPar)}<p class="note">Per hole to par, ${B.closing.n} rounds with heart rate on every hole.</p>` : ''}
      ${B.years ? `<h3>Year by year</h3>${B.years.map((y) => row(String(y.year), `${y.n} rounds · ${Math.round(y.bpm)} bpm average`, y.toPar)).join('')}<p class="note">A falling round heart rate at the same effort is a sign of fitness.</p>` : ''}
      <p class="note">Score per 18 holes to par. Heart rate from your Garmin; weather on the day from the round or Open-Meteo's archive.</p></div>`
    : (B.n ? '' : '<div class="card"><p class="note">Import your Garmin data (Settings → Import data → Garmin, with the activities zip) and your heart rate through each round, and the heat on the day, show here against your score.</p></div>');
  const bodyLine = B.hr && Math.abs(B.hr.high.toPar - B.hr.low.toPar) >= 1 ? `On higher-heart-rate days you score ${Math.abs(B.hr.high.toPar - B.hr.low.toPar).toFixed(1)} a round ${B.hr.high.toPar > B.hr.low.toPar ? 'worse' : 'better'}.` : B.hr ? 'Your heart rate on the day makes little difference to your score so far.' : '';
  const y = new Date().getFullYear(); const Y = ALL.filter((x) => ym(x.r.date) === y);
  const year = Y.length ? `<div class="card yearcard"><h3>${y}</h3><div class="trio">${tile(Y.length, 'rounds')}${tile(new Set(Y.map((x) => x.r.courseName)).size, 'courses')}${tile(Y.reduce((a, x) => a + (x.S.holes || 0), 0), 'holes')}</div></div>` : '';

  el.innerHTML = hero.html + [
    scoring,
    area('driving', 'driving', 'Driving', verdict(radar, 'ott', read, hcp), driving),
    area('approach', 'approach', 'Approach', [verdict(radar, 'appL', read, hcp).replace(/^/, '<b>Long:</b> '), verdict(radar, 'appW', read, hcp).replace(/^/, '<b>Wedges:</b> ')].filter((x) => !/<\/b> $/.test(x)).join('<br>'), approach),
    area('short', 'short', 'Short game', verdict(radar, 'arg', read, hcp), short),
    area('putting', 'putting', 'Putting', verdict(radar, 'putt', read, hcp), putting),
    area('mind', 'mind', 'Mind', verdict(radar, 'head', read, hcp), mind),
    area('body', 'mind', 'Body', bodyLine, body),
    year,
  ].join('');
  el.onclick = (e) => {
    if (e.target.closest('[data-pickrounds]')) { roundsSheet(() => renderScoring(el)); return; }
    const kf = e.target.closest('[data-kindf]');
    if (kf) { const st = getSettings(); st.progressKind = kf.dataset.kindf; saveSettings(st); renderScoring(el); return; }
    const b = e.target.closest('[data-radar-n]');
    if (b) {
      const card = b.closest('.radarcard'); const views = JSON.parse(card.dataset.radarViews);
      card.querySelectorAll('[data-radar-n]').forEach((x) => x.classList.toggle('on', x === b));
      card.querySelector('.radarbox').innerHTML = views[b.dataset.radarN];
      return;
    }
    const ax = e.target.closest('[data-goto]');
    if (ax) document.getElementById(`pg-${ax.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}


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
  const hcp = getSettings().handicap ?? 15;
  const radar = skillRadar(R.filter((x) => radarUses(x.r, x.c)), { hcp });
  const ok = radar.axes.filter((a) => a.enough && a.value != null).sort((a, b) => a.value - b.value);
  if (ok.length >= 2) {
    const ART_FOR = { ott: 'driving', appL: 'approach', appW: 'approach', arg: 'short', putt: 'putting', head: 'mind' };
    const first = ok[0];
    html = `<div class="card prio1"><div class="ah">${ART[ART_FOR[first.key]]}<div><small class="mute">Practise first</small><h2>${first.label}</h2><p>${Math.abs(first.value).toFixed(1)} strokes a round ${first.value < 0 ? 'worse' : 'better'} than a ${levelLabel(hcp)} golfer, your biggest gap in the last ${radar.n} rounds.</p></div></div>
      <ol class="prio-list">${ok.slice(1).map((a) => `<li><b>${a.label}</b><span class="${a.value < -0.3 ? 'workc' : a.value > 0.3 ? 'goodc' : 'mute'}">${sgn(a.value)}</span></li>`).join('')}</ol>
      <p class="mute small" style="margin:10px 0 0">Strokes a round against your level, from Your game in Progress. Practise in this order.</p></div>` + html;
  }
  return html;
}

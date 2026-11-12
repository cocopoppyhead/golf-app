// The skills radar: six axes, each showing the handicap that part of your game plays like, on fixed
// rings for scratch, 5, 10, 15 and 20 (value, in strokes against your own level, drives the verdicts). Axes: Driving, Long approach (140+), Wedges (30–139), Short game (chips, pitches, bunkers),
// Putting, Mind (penalties, recovery drives, shots that went to plan).
//
// Strokes gained in sg.js is measured against the tour baseline, so a club golfer is negative in every
// category; to turn that into "vs your level" we need what a golfer at handicap h loses to tour in each
// category. Broadie (Every Shot Counts): an h-handicap gives up roughly h + 3 strokes a round to the tour
// average, split about 28% driving, 40% approach, 17% short game, 15% putting (the long game is two
// thirds of the gap, at every level). Approach is split 60/40 between the long shots and the wedges —
// osolo's own split, since Broadie doesn't publish one by distance. Everything is clipped to ±2
// strokes so one axis can't flatten the rest, and scratch is drawn as the faint outer shape.
import { holeSG, expected } from './sg.js';
import { benchFor, targetHcp } from '../benchmarks.js';

export const AXES = [
  { key: 'ott', label: 'Driving', share: 0.28, goto: 'driving' },
  { key: 'appL', label: 'Long approach', sub: '140+', share: 0.40 * 0.6, goto: 'approach' },
  { key: 'appW', label: 'Wedges', sub: 'inside 140', share: 0.40 * 0.4, goto: 'approach' },
  { key: 'arg', label: 'Short game', sub: 'chips, pitches, bunkers', share: 0.17, goto: 'short' },
  { key: 'putt', label: 'Putting', share: 0.15, goto: 'putting' },
  { key: 'head', label: 'Mind', sub: 'decisions', share: 0, goto: 'mind' },
];
export const LONG_FROM = 140; // yards: long approach from here, wedges inside
const CLIP = 2;
const TOUR_GAP = (h) => h + 3; // strokes per round an h-handicap gives up to the tour average
const RECOVERY_COST = 0.7; // a drive that needs a recovery costs about this much vs one in play (sg tables, 150 yd: trees 3.80 vs rough 3.15)
const MIN_SHOTS = 10; // an axis needs this many scored shots (or putting holes) before it is drawn
const PLAN_BASE = 0.55; // "shots that came off as planned" that we treat as par for the course

/** Per-round raw material: strokes gained by axis (tour baseline, 18-hole scaled) plus the head inputs. */
export function radarRound(round, course) {
  if (!round || round.quick || !course || round.radarPick === false) return null;
  // A hole counts as complete when every stroke is accounted for; skillRadar only takes rounds where
  // every hole is (see fullyTracked). Garmin scorecards say nothing about penalties or tee-shot trouble, so they stay out of Mind.
  const R = { ott: 0, appL: 0, appW: 0, arg: 0, putt: 0, holes: 0, complete: 0, mind: !(round.source === 'garmin' && (round.garmin?.scorecard || 'durationMin' in (round.garmin || {}))), pen: 0, dirt: 0, firOpp: 0, planN: 0, planned: 0, shots: { ott: 0, appL: 0, appW: 0, arg: 0, putt: 0 } };
  round.holes.forEach((h, i) => {
    const ch = course.holes[i]; if (!h || h.score == null || !ch) return;
    R.holes++;
    const sg = fromWatch(h) ? null : holeSG(h, ch.par, ch.yds);
    if (sg?.complete) {
      R.complete++;
      R.ott += sg.ott; R.arg += sg.arg; R.putt += sg.putt;
      if (h.putts != null && h.firstPutt != null) R.shots.putt++;
      sg.shots.forEach((s, k) => {
        if (!s) return;
        if (s.cat !== 'app') { R.shots[s.cat]++; return; }
        const d = h.shots?.[k]?.dist;
        const key = d != null && d < LONG_FROM ? 'appW' : 'appL';
        R[key] += s.sg; R.shots[key]++;
      });
    }
    for (const x of h.shots || []) {
      if (x?.pen) R.pen++;
      if (x?.d?.plan === true || x?.d?.plan === false) { R.planN++; if (x.d.plan) R.planned++; }
    }
    if (ch.par >= 4) {
      R.firOpp++;
      const t = h.shots?.[0];
      if (t && (t.res === 'LT' || t.res === 'RT' || ['FB', 'WS', 'PN', 'WT', 'OB'].includes(t.res2) || t.pen)) R.dirt++;
      else if (!t && (h.tee === 'LT' || h.tee === 'RT')) R.dirt++;
    }
  });
  // Mind needs shot detail (penalties and tee results are logged per shot); a score-only round has nothing to say
  if (!round.holes.some((h) => h?.shots?.length)) R.mind = false;
  return R.holes ? R : null;
}

/**
 * Only a fully tracked round feeds the radar: on every hole scored, the logged shots (plus penalties)
 * and putts add up to the score. One missed shot anywhere and the round is left out.
 */
export const fullyTracked = (R) => !!R && R.holes > 0 && R.complete === R.holes;
export function feedsRadar(round, course) { return fullyTracked(radarRound(round, course)); }

export { MIN_SHOTS };

// ---- shot by shot ----
// A shot can be scored on its own whenever its start and its finish are both known (Broadie: SG = E(start) −
// E(finish) − 1), whether or not the rest of the hole was logged. So a round that doesn't add up still
// gives the radar every drive and approach it can vouch for:
//   - every shot on a hole that adds up (as before)
//   - on a hole that doesn't, the shots whose finish is known: the next logged shot when the off-green
//     strokes match the score less the putts (so none is missing in between)
//   - putting only from a hole that adds up, with entered (not assumed) putts and a first-putt distance
// Nothing is guessed: a shot whose finish isn't known is left out.
// Shots a watch recorded never feed the radar: it knows how far, not where the ball finished (fairway, waste,
// bunker, water), misses penalties, and measures the green to its centre, not the pin. Checked against real
// cards it flattered driving. Garmin rounds still count for scores, heat and heart rate.
const fromWatch = (h) => h.firstPuttSrc === 'garmin-green' || !!h.shots?.some((s) => s?.src === 'garmin');
const PER18 = { ott: 14, appL: 7, appW: 7, arg: 5 }; // shots a round in each category when the golfer's own holes can't say

/** Every shot in a round that can be scored on its own: [{ cat, sg, src }], plus putting holes [{ sg }]. */
export function radarShots(round, course) {
  const out = { shots: [], putts: [] };
  if (!round || round.quick || !course || round.radarPick === false) return out;
  round.holes.forEach((h, i) => {
    const ch = course.holes[i]; if (!h || h.score == null || !ch) return;
    const sg = holeSG(h, ch.par, ch.yds);
    if (fromWatch(h)) return;
    // the hole adds up: every stroke before the green logged, and those plus the putts make the score
    const chain = h.shots?.length && h.putts != null && !h.puttsAuto && h.shots.length + h.shots.filter((s) => s.pen).length === h.score - h.putts;
    // putting only from a hole that adds up, with putts actually entered (not assumed) and a first-putt distance:
    // a missing putt would otherwise look like a good day on the greens
    if (chain && h.putts > 0 && h.firstPutt != null) out.putts.push({ sg: expected('grn', h.firstPutt) - h.putts });
    if (sg && (sg.complete || chain)) {
      sg.shots.forEach((s, k) => {
        if (!s) return;
        const d = k === 0 ? (h.shots?.[0]?.dist ?? ch.yds) : h.shots?.[k]?.dist;
        out.shots.push({ cat: s.cat === 'app' ? (d != null && d < LONG_FROM ? 'appW' : 'appL') : s.cat, sg: s.sg, src: sg.complete ? 'hole' : 'chain' });
      });
    }
  });
  return out;
}

/** Does this round give the radar anything? */
export function radarUses(round, course) { const s = radarShots(round, course); return s.shots.length + s.putts.length > 0; }
const clip = (v) => Math.max(-CLIP, Math.min(CLIP, v));

/**
 * The radar for a list of rounds ([{ r, c }] newest first, already limited to the window).
 * Returns { hcp, n, axes: [{ key, label, sub, value, level, scratch, n, enough, detail }], ready }.
 * value = strokes per round vs your level (clipped ±2); scratch = where scratch sits on the same scale.
 */
export function skillRadar(list, { hcp = 15 } = {}) {
  const pool = list.map((x) => ({ x, s: radarShots(x.r, x.c) }));
  const all = list.map((x) => radarRound(x.r, x.c)).filter(fullyTracked);
  const rows = all.filter((R) => R.mind); // rounds that know about penalties and drives in trouble
  const sgRows = all;
  const per18 = (R, k) => R[k] * (18 / R.holes);
  const sgHoles = sgRows.reduce((s, R) => s + R.complete, 0);
  const mean = (arr, f) => (arr.length ? arr.reduce((a, R) => a + f(R), 0) / arr.length : null);
  const h = Math.max(0, Math.min(25, Number.isFinite(hcp) ? hcp : 15));
  const target = targetHcp(h);
  const gap = TOUR_GAP(h), B = benchFor(h), B0 = benchFor(target); // B0: the level you're aiming at (the outer ring)
  const axes = AXES.map((a) => {
    if (a.key === 'head') {
      const n = rows.length;
      if (!n) return { ...a, value: null, n: 0, enough: false };
      const pen = mean(rows, (R) => per18(R, 'pen'));
      const dirt = mean(rows, (R) => per18(R, 'dirt')), firOpp = mean(rows, (R) => per18(R, 'firOpp')) || 14;
      const planN = rows.reduce((s, R) => s + R.planN, 0), planned = rows.reduce((s, R) => s + R.planned, 0);
      const penPart = B.penalties - pen; // strokes: each penalty is one
      const dirtPart = (B.teeTrouble * firOpp - dirt) * RECOVERY_COST;
      const planPart = planN >= 15 ? (planned / planN - PLAN_BASE) * 2 : 0;
      const value = clip(penPart + dirtPart + planPart);
      const scratch = clip((B.penalties - B0.penalties) + (B.teeTrouble - B0.teeTrouble) * firOpp * RECOVERY_COST);
      // the handicap this plays like: strokes per handicap on this axis from the gap between your level and the target
      // the handicap this plays like: strokes per handicap from the benchmark slope between your level and five worse
      const B5 = benchFor(h + 5), perHcp = Math.max(0.05, ((B5.penalties - B.penalties) + (B5.teeTrouble - B.teeTrouble) * firOpp * RECOVERY_COST) / 5);
      const eq = Math.max(-4, Math.min(36, h - (penPart + dirtPart + planPart) / perHcp));
      return { ...a, value, scratch, eq, n, enough: n >= 3, detail: `${pen.toFixed(1)} penalties and ${dirt.toFixed(1)} recovery drives a round (your level: ${B.penalties.toFixed(1)} and ${(B.teeTrouble * firOpp).toFixed(1)})${planN >= 15 ? `; ${Math.round((100 * planned) / planN)}% of rated shots went to plan` : ''}.`, parts: { penPart, dirtPart, planPart } };
    }
    // shot by shot from every round in the window (see radarShots); putting by hole
    const samples = a.key === 'putt' ? pool.flatMap((p) => p.s.putts) : pool.flatMap((p) => p.s.shots.filter((s) => s.cat === a.key));
    const n = pool.filter((p) => (a.key === 'putt' ? p.s.putts.length : p.s.shots.some((s) => s.cat === a.key))).length, shots = samples.length;
    if (!n || !shots) return { ...a, value: null, n, shots, enough: false };
    // shots a round in this category: from the golfer's own complete holes when there are two rounds' worth, else typical
    const perRound = a.key === 'putt' ? 18 : sgHoles >= 36 ? (sgRows.reduce((s2, R) => s2 + R.shots[a.key], 0) / sgHoles) * 18 : PER18[a.key];
    const sg = (samples.reduce((s2, x) => s2 + x.sg, 0) / shots) * perRound; // vs tour, a round
    const level = -gap * a.share; // what your level loses to tour on this axis
    const value = clip(sg - level);
    const scratch = clip(-TOUR_GAP(target) * a.share - level);
    const eq = Math.max(-4, Math.min(36, -sg / a.share - 3)); // the handicap whose golfers lose this much to tour here (Broadie: h + 3 a round, by share)
    const min = a.key === 'putt' ? 18 : MIN_SHOTS;
    return { ...a, value, raw: sg, level, scratch, eq, n, shots, enough: n >= 3 && shots >= min, detail: `${sg >= 0 ? '+' : ''}${sg.toFixed(1)} strokes a round against the tour baseline (${shots} ${a.key === 'putt' ? 'holes' : 'shots'}, ${n} rounds); a ${h <= 1 ? 'scratch' : Math.round(h) + '-handicap'} golfer is about ${level.toFixed(1)}.` };
  });
  const ready = axes.filter((a) => a.enough).length >= 4;
  return { hcp: h, target, n: pool.filter((p) => p.s.shots.length + p.s.putts.length).length, nSg: sgRows.length, axes, ready };
}

/** The strongest and weakest axes, for the one-line read and the practice link. */
export function radarRead(radar) {
  const ok = radar.axes.filter((a) => a.enough && a.value != null);
  if (ok.length < 2) return null;
  const s = [...ok].sort((a, b) => b.value - a.value);
  return { best: s[0], worst: s[s.length - 1] };
}

// --- drawing ---
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const RINGS = [0, 5, 10, 15, 20]; // the handicaps drawn as rings, scratch outermost
const FLOOR = 25; // the centre: a 25 handicap
/** "Plays like" for a spoke label: 7, Scratch, or +2 for better than scratch. */
export const eqLabel = (eq) => { const r = Math.round(eq); return r === 0 ? 'Scratch' : r < 0 ? `+${-r}` : r > FLOOR ? `${FLOOR}+` : `${r}`; };

/**
 * SVG radar on a fixed scale: rings at what a scratch, 5, 10, 15 and 20 handicap do in each part of the game,
 * scratch outermost, the ring you're aiming at drawn stronger. Each spoke sits at the handicap that part of
 * your game plays like (Broadie: an h-handicap loses h + 3 strokes a round to tour, split by share); better
 * than scratch pokes slightly past the ring. `ghost` is an earlier radar, drawn faded.
 */
export function radarSvg(radar, ghost = null, { size = 300 } = {}) {
  const N = radar.axes.length, W = size * 1.22, C = size / 2, CX = W / 2, R = size * 0.34;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const frac = (eq) => (eq == null ? 0 : Math.max(0, Math.min(1.12, (FLOOR - eq) / FLOOR))); // scratch → 1, 25 → centre
  const ptF = (i, f) => [CX + Math.cos(ang(i)) * R * f, C + Math.sin(ang(i)) * R * f];
  const pt = (i, eq) => ptF(i, frac(eq));
  const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const ring = (f) => radar.axes.map((_, i) => ptF(i, f).map((x) => x.toFixed(1)).join(',')).join(' ');
  const shape = radar.axes.map((a) => (a.enough ? a.eq : null));
  const anyShape = shape.some((v) => v != null);
  const h = radar.hcp ?? 15;
  const labels = radar.axes.map((a, i) => {
    const [x, y] = ptF(i, 1.35);
    const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
    const v = a.enough ? a.eq : null;
    const cls = v == null ? 'none' : v <= h - 1.5 ? 'good' : v >= h + 1.5 ? 'work' : 'even';
    const hx = anchor === 'middle' ? x - 50 : anchor === 'start' ? x - 4 : x - 96;
    return `<g class="rax ${cls}" data-goto="${a.goto}" style="cursor:pointer"><rect x="${hx.toFixed(1)}" y="${(y - 16).toFixed(1)}" width="100" height="34" fill="transparent"/><text x="${x.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="${anchor}" class="rl">${esc(a.label)}</text><text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="${anchor}" class="rv">${a.enough ? eqLabel(a.eq) : a.n < 3 ? `${a.n}/3 rounds` : a.shots != null ? `${a.shots}/${MIN_SHOTS} shots` : '–'}</text></g>`;
  }).join('');
  const rings = RINGS.map((k) => `<polygon points="${ring(frac(k))}" class="rr${k === 0 ? ' outer' : ''}${k === radar.target ? ' target' : ''}"/>`).join('');
  const ringLabels = RINGS.map((k) => `<text x="${CX + 4}" y="${(C - R * frac(k) + 10).toFixed(1)}" class="rring${k === radar.target ? ' target' : ''}">${k ? k : 'Scratch'}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${size}" class="radar" role="img" aria-label="Skills radar: the handicap each part of your game plays like">
    ${rings}
    ${radar.axes.map((_, i) => { const [x, y] = ptF(i, 1); return `<line x1="${CX}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rs"/>`; }).join('')}
    ${ringLabels}
    ${ghost && ghost.axes.some((a) => a.enough) ? `<polygon points="${poly(ghost.axes.map((a) => (a.enough ? a.eq : FLOOR)))}" class="rghost"/>` : ''}
    ${anyShape ? `<polygon points="${poly(shape.map((v) => v ?? FLOOR))}" class="ryou"/>${shape.map((v, i) => (v == null ? '' : `<circle cx="${pt(i, v)[0].toFixed(1)}" cy="${pt(i, v)[1].toFixed(1)}" r="3.5" class="rdot"/>`)).join('')}` : ''}
    ${labels}
  </svg>`;
}

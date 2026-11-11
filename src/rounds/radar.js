// The skills radar: six axes, each in strokes per round against golfers at your handicap, so the
// dashed ring is "what someone at your level does" and the shape says where you are better or worse
// than that. Axes: Driving, Long approach (140+), Wedges (30–139), Short game (chips, pitches, bunkers),
// Putting, Mind (penalties, recovery drives, shots that went to plan).
//
// Strokes gained in sg.js is measured against the tour baseline, so a club golfer is negative in every
// category; to turn that into "vs your level" we need what a golfer at handicap h loses to tour in each
// category. Broadie (Every Shot Counts): an h-handicap gives up roughly h + 3 strokes a round to the tour
// average, split about 28% driving, 40% approach, 17% short game, 15% putting (the long game is two
// thirds of the gap, at every level). Approach is split 60/40 between the long shots and the wedges —
// osolo's own split, since Broadie doesn't publish one by distance. Everything is clipped to ±2
// strokes so one axis can't flatten the rest, and scratch is drawn as the faint outer shape.
import { holeSG } from './sg.js';
import { benchFor } from '../benchmarks.js';

export const AXES = [
  { key: 'ott', label: 'Driving', share: 0.28, goto: 'sg' },
  { key: 'appL', label: 'Long approach', sub: '140+', share: 0.40 * 0.6, goto: 'bands' },
  { key: 'appW', label: 'Wedges', sub: 'inside 140', share: 0.40 * 0.4, goto: 'bands' },
  { key: 'arg', label: 'Short game', sub: 'chips, pitches, bunkers', share: 0.17, goto: 'sg' },
  { key: 'putt', label: 'Putting', share: 0.15, goto: 'putting' },
  { key: 'head', label: 'Mind', sub: 'decisions', share: 0, goto: 'plan' },
];
export const LONG_FROM = 140; // yards: long approach from here, wedges inside
const CLIP = 2;
const TOUR_GAP = (h) => h + 3; // strokes per round an h-handicap gives up to the tour average
const RECOVERY_COST = 0.7; // a drive that needs a recovery costs about this much vs one in play (sg tables, 150 yd: trees 3.80 vs rough 3.15)
const MIN_SHOTS = 10; // an axis needs this many scored shots (or putting holes) before it is drawn
const PLAN_BASE = 0.55; // "shots that came off as planned" that we treat as par for the course

/** Per-round raw material: strokes gained by axis (tour baseline, 18-hole scaled) plus the head inputs. */
export function radarRound(round, course) {
  if (!round || round.quick || !course) return null;
  const R = { ott: 0, appL: 0, appW: 0, arg: 0, putt: 0, holes: 0, complete: 0, pen: 0, dirt: 0, firOpp: 0, planN: 0, planned: 0, shots: { ott: 0, appL: 0, appW: 0, arg: 0, putt: 0 } };
  round.holes.forEach((h, i) => {
    const ch = course.holes[i]; if (!h || h.score == null || !ch) return;
    R.holes++;
    const sg = holeSG(h, ch.par, ch.yds);
    if (sg) {
      if (sg.complete) R.complete++;
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
      if (t && (t.res === 'LT' || t.res === 'RT' || ['FB', 'WS', 'PN'].includes(t.res2) || t.pen)) R.dirt++;
      else if (!t && (h.tee === 'LT' || h.tee === 'RT')) R.dirt++;
    }
  });
  return R.holes ? R : null;
}

export { MIN_SHOTS };
const clip = (v) => Math.max(-CLIP, Math.min(CLIP, v));

/**
 * The radar for a list of rounds ([{ r, c }] newest first, already limited to the window).
 * Returns { hcp, n, axes: [{ key, label, sub, value, level, scratch, n, enough, detail }], ready }.
 * value = strokes per round vs your level (clipped ±2); scratch = where scratch sits on the same scale.
 */
export function skillRadar(list, { hcp = 15 } = {}) {
  const rows = list.map((x) => radarRound(x.r, x.c)).filter(Boolean);
  const sgRows = rows.filter((R) => R.complete >= Math.min(9, R.holes)); // rounds with the shot data for SG
  const per18 = (R, k) => R[k] * (18 / R.holes);
  const mean = (arr, f) => (arr.length ? arr.reduce((a, R) => a + f(R), 0) / arr.length : null);
  const h = Math.max(0, Math.min(25, Number.isFinite(hcp) ? hcp : 15));
  const gap = TOUR_GAP(h), B = benchFor(h), B0 = benchFor(0);
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
      return { ...a, value, scratch, n, enough: n >= 3, detail: `${pen.toFixed(1)} penalties and ${dirt.toFixed(1)} recovery drives a round (your level: ${B.penalties.toFixed(1)} and ${(B.teeTrouble * firOpp).toFixed(1)})${planN >= 15 ? `; ${Math.round((100 * planned) / planN)}% of rated shots went to plan` : ''}.`, parts: { penPart, dirtPart, planPart } };
    }
    const n = sgRows.length, shots = sgRows.reduce((s, R) => s + R.shots[a.key], 0);
    if (!n || !shots) return { ...a, value: null, n, shots, enough: false };
    const sg = mean(sgRows, (R) => per18(R, a.key)); // vs tour
    const level = -gap * a.share; // what your level loses to tour on this axis
    const value = clip(sg - level);
    const scratch = clip(-TOUR_GAP(0) * a.share - level);
    return { ...a, value, raw: sg, level, scratch, n, shots, enough: n >= 3 && shots >= MIN_SHOTS, detail: `${sg >= 0 ? '+' : ''}${sg.toFixed(1)} strokes a round against the tour baseline; a ${h <= 1 ? 'scratch' : Math.round(h) + '-handicap'} golfer is about ${level.toFixed(1)}.` };
  });
  const ready = axes.filter((a) => a.enough).length >= 4;
  return { hcp: h, n: rows.length, nSg: sgRows.length, axes, ready };
}

/** The strongest and weakest axes, for the one-line read and the practice link. */
export function radarRead(radar) {
  const ok = radar.axes.filter((a) => a.enough && a.value != null);
  if (ok.length < 2) return null;
  const s = [...ok].sort((a, b) => b.value - a.value);
  return { best: s[0], worst: s[s.length - 1] };
}

// --- drawing ---
const fmt = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * SVG radar. Rings: dashed = your level (0), faint outer = +2 (inner = −2); scratch drawn dotted.
 * `ghost` is an earlier radar (same axes) drawn faded behind the current shape.
 */
export function radarSvg(radar, ghost = null, { size = 300 } = {}) {
  const N = radar.axes.length, W = size * 1.3, C = size / 2, CX = W / 2, R = size * 0.31;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const rOf = (v) => R * (0.5 + (v == null ? -CLIP : v) / (2 * CLIP)); // −2 → 0, 0 → R/2, +2 → R
  const pt = (i, v) => [CX + Math.cos(ang(i)) * rOf(v), C + Math.sin(ang(i)) * rOf(v)];
  const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const ring = (v) => poly(radar.axes.map(() => v));
  const shape = radar.axes.map((a) => (a.enough ? a.value : null));
  const anyShape = shape.some((v) => v != null);
  const scratch = radar.axes.map((a) => (a.enough ? a.scratch : null));
  const labels = radar.axes.map((a, i) => {
    const [x, y] = pt(i, CLIP + 0.7);
    const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
    const v = a.enough ? a.value : null;
    const cls = v == null ? 'none' : v >= 0.3 ? 'good' : v <= -0.3 ? 'work' : 'even';
    const hx = anchor === 'middle' ? x - 50 : anchor === 'start' ? x - 4 : x - 96;
    return `<g class="rax ${cls}" data-goto="${a.goto}" style="cursor:pointer"><rect x="${hx.toFixed(1)}" y="${(y - 16).toFixed(1)}" width="100" height="34" fill="transparent"/><text x="${x.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="${anchor}" class="rl">${esc(a.label)}</text><text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="${anchor}" class="rv">${a.enough ? fmt(a.value) : a.n < 3 ? `${a.n}/3 rounds` : a.shots != null ? `${a.shots}/${MIN_SHOTS} shots` : '–'}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${size}" class="radar" role="img" aria-label="Skills radar">
    <polygon points="${ring(CLIP)}" class="rr outer"/>
    <polygon points="${ring(CLIP / 2)}" class="rr"/>
    <polygon points="${ring(0)}" class="rr level"/>
    <polygon points="${ring(-CLIP / 2)}" class="rr"/>
    ${radar.axes.map((_, i) => { const [x, y] = pt(i, CLIP); return `<line x1="${CX}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rs"/>`; }).join('')}
    ${scratch.some((v) => v != null) ? `<polygon points="${poly(scratch.map((v) => v ?? 0))}" class="rscratch"/>` : ''}
    ${ghost && ghost.axes.some((a) => a.enough) ? `<polygon points="${poly(ghost.axes.map((a) => (a.enough ? a.value : 0)))}" class="rghost"/>` : ''}
    ${anyShape ? `<polygon points="${poly(shape.map((v) => v ?? 0))}" class="ryou"/>${shape.map((v, i) => (v == null ? '' : `<circle cx="${pt(i, v)[0].toFixed(1)}" cy="${pt(i, v)[1].toFixed(1)}" r="3.5" class="rdot"/>`)).join('')}` : ''}
    ${labels}
  </svg>`;
}

// Strokes gained (Mark Broadie, "Every Shot Counts"). Every shot is scored against the average number
// of strokes a tour player needs to hole out from where it started, versus from where it finished:
//   SG(shot) = E(start) − E(finish) − 1        (a penalty stroke counts as one more)
// Putting for a hole = E(first putt) − putts. Baseline = PGA Tour averages, so club golfers are
// usually negative; what matters is which category loses the most, and the trend.

// Expected strokes to hole out. Off the green: yards. On the green: feet.
const T = {
  tee: [[100, 2.92], [120, 2.99], [140, 2.97], [160, 2.99], [180, 3.05], [200, 3.12], [220, 3.17], [240, 3.25], [260, 3.45], [280, 3.65], [300, 3.71], [320, 3.79], [340, 3.86], [360, 3.92], [380, 3.96], [400, 3.99], [420, 4.02], [440, 4.08], [460, 4.17], [480, 4.28], [500, 4.41], [520, 4.54], [540, 4.65], [560, 4.74], [580, 4.79], [600, 4.82]],
  fw: [[5, 2.10], [10, 2.18], [20, 2.40], [30, 2.52], [40, 2.60], [60, 2.70], [80, 2.75], [100, 2.80], [120, 2.85], [140, 2.91], [160, 2.98], [180, 3.08], [200, 3.19], [220, 3.32], [240, 3.45], [260, 3.58], [280, 3.69], [300, 3.78], [350, 3.95], [400, 4.11], [450, 4.32], [500, 4.54], [550, 4.69], [600, 4.79]],
  rgh: [[5, 2.26], [10, 2.34], [20, 2.59], [30, 2.70], [40, 2.78], [60, 2.91], [80, 2.96], [100, 3.02], [120, 3.08], [140, 3.15], [160, 3.23], [180, 3.31], [200, 3.42], [220, 3.53], [240, 3.64], [260, 3.74], [280, 3.83], [300, 3.90], [350, 4.08], [400, 4.25], [450, 4.45], [500, 4.66], [550, 4.82], [600, 4.92]],
  bnk: [[5, 2.38], [10, 2.43], [20, 2.53], [30, 2.66], [40, 2.82], [60, 3.15], [80, 3.24], [100, 3.23], [120, 3.21], [140, 3.22], [160, 3.28], [180, 3.40], [200, 3.55], [220, 3.70], [240, 3.84], [260, 3.93], [280, 4.00], [300, 4.04], [400, 4.41], [500, 4.73], [600, 5.01]],
  rec: [[20, 3.32], [40, 3.45], [60, 3.65], [80, 3.73], [100, 3.80], [120, 3.78], [140, 3.80], [160, 3.81], [180, 3.82], [200, 3.87], [220, 3.92], [240, 3.97], [260, 4.03], [280, 4.10], [300, 4.20], [400, 4.55], [500, 4.88], [600, 5.07]],
  grn: [[1, 1.00], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.34], [7, 1.42], [8, 1.50], [9, 1.56], [10, 1.61], [15, 1.78], [20, 1.87], [30, 1.98], [40, 2.06], [50, 2.14], [60, 2.21], [90, 2.40]],
};
// Dubai waste areas / scruff play somewhere between rough and sand
const WASTE = (d) => (expected('rgh', d) + expected('bnk', d)) / 2;

export const LIES = [['fw', 'Fairway'], ['rgh', 'Rough'], ['bnk', 'Bunker'], ['wst', 'Waste'], ['rec', 'Trees / recovery']];

export function expected(lie, d) {
  if (d == null || !Number.isFinite(d)) return null;
  if (lie === 'wst') return WASTE(d);
  const t = T[lie] || T.rgh;
  if (d <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (d <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((d - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return t[t.length - 1][1];
}

/**
 * One hole. shots = non-putt strokes in order: [{ lie, dist (yards), pen }], shots[0] is the tee shot.
 * Returns { ott, app, arg, putt, total, complete } in strokes (positive = better than baseline).
 * Categories: tee shots on par 4/5 = off the tee; other shots over 30 yds = approach; inside 30 = around the green.
 */
export function holeSG(h, par, holeYds) {
  const out = { ott: 0, app: 0, arg: 0, putt: 0, total: 0, complete: true, shots: [] };
  if (!h || h.score == null) return null;
  const putts = h.putts ?? null;
  const shots = (h.shots || []).map((s, i) => (i === 0 ? { ...s, lie: 'tee', dist: s.dist ?? holeYds } : s));
  if (!shots.length && holeYds) shots.push({ lie: 'tee', dist: holeYds });
  const startE = (s) => expected(s.lie === 'tee' ? 'tee' : s.lie, s.dist);
  const greenE = putts === 0 ? 0 : h.firstPutt != null ? expected('grn', h.firstPutt) : null;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const a = startE(s);
    const b = i + 1 < shots.length ? startE(shots[i + 1]) : greenE;
    if (a == null || b == null) { out.complete = false; out.shots.push(null); continue; }
    const sg = a - b - 1 - (s.pen ? 1 : 0);
    const cat = s.lie === 'tee' && par >= 4 ? 'ott' : (s.dist ?? 0) > 30 ? 'app' : 'arg';
    out[cat] += sg; out.shots.push({ cat, sg });
  }
  if (putts != null && putts > 0) {
    if (h.firstPutt != null) out.putt = expected('grn', h.firstPutt) - putts;
    else out.complete = false;
  }
  // non-putt strokes must match the score for the hole to be fully accounted for
  const strokes = shots.length + shots.filter((s) => s.pen).length;
  if (putts != null && strokes !== h.score - putts) out.complete = false;
  out.total = out.ott + out.app + out.arg + out.putt;
  return out;
}

/** Whole round: sums over holes with data. */
export function roundSG(round, course) {
  const S = { ott: 0, app: 0, arg: 0, putt: 0, total: 0, holes: 0, complete: 0 };
  round.holes.forEach((h, i) => {
    const ch = course.holes[i]; if (!h || h.score == null || !ch) return;
    const r = holeSG(h, ch.par, ch.yds);
    if (!r) return;
    S.holes++; if (r.complete) S.complete++;
    for (const k of ['ott', 'app', 'arg', 'putt', 'total']) S[k] += r[k];
  });
  return S.holes ? S : null;
}

export const SG_LABELS = { ott: 'Off the tee', app: 'Approach', arg: 'Around the green', putt: 'Putting' };

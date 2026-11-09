// World Handicap System, the parts that matter for a golfer's own trend:
//   score differential = 113 / slope × (adjusted gross − course rating)
//   handicap index     = average of the best differentials from the last 20 (8 of 20 once you have 20)
// This is the same maths GHIN runs; it will track the official index closely but not exactly
// (no playing-conditions adjustment, no committee reviews). The official number lives on GHIN.

/** How many of the last n differentials count, and the adjustment (WHS Rule 5.2a). */
function rule(n) {
  if (n < 3) return null;
  if (n === 3) return { use: 1, adj: -2 };
  if (n === 4) return { use: 1, adj: -1 };
  if (n === 5) return { use: 1, adj: 0 };
  if (n === 6) return { use: 2, adj: -1 };
  if (n <= 8) return { use: 2, adj: 0 };
  if (n <= 11) return { use: 3, adj: 0 };
  if (n <= 14) return { use: 4, adj: 0 };
  if (n <= 16) return { use: 5, adj: 0 };
  if (n <= 18) return { use: 6, adj: 0 };
  if (n === 19) return { use: 7, adj: 0 };
  return { use: 8, adj: 0 };
}

export const differential = (ags, rating, slope) =>
  (ags == null || !rating || !slope ? null : Math.round(((113 / slope) * (ags - rating)) * 10) / 10);

/** Strokes you get on this course: index × slope / 113 + (rating − par). */
export const courseHandicap = (index, rating, slope, par) =>
  (index == null || !rating || !slope ? null : Math.round(index * (slope / 113) + (rating - par)));

/**
 * Adjusted gross score: each hole capped at net double bogey (par + 2 + strokes received on the hole).
 * Needs hole scores and a course handicap; otherwise the gross score stands.
 */
export function adjustedGross(round, course, index) {
  if (round.quick) return round.score ?? null;
  const holes = round.holes || [];
  const par = course.holes.reduce((a, h) => a + h.par, 0);
  const ch = courseHandicap(index, course.rating, course.slope, par);
  let total = 0, n = 0;
  holes.forEach((h, i) => {
    if (!h || h.score == null) return;
    const H = course.holes[i]; n++;
    if (ch == null || !H.si) { total += h.score; return; }
    const strokes = Math.floor(ch / 18) + (H.si <= ch % 18 ? 1 : 0) + (ch < 0 && H.si > 18 + (ch % 18) ? -1 : 0);
    total += Math.min(h.score, H.par + 2 + strokes);
  });
  return n ? total : null;
}

/**
 * Index from differentials, newest first. Returns { index, counted: [positions of the ones used] }
 * or null with fewer than 3.
 */
export function indexFrom(diffs) {
  const d = diffs.filter((x) => x != null).slice(0, 20);
  const R = rule(d.length); if (!R) return null;
  const order = d.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).slice(0, R.use);
  const avg = order.reduce((a, x) => a + x.v, 0) / R.use + R.adj;
  return { index: Math.round(avg * 10) / 10, counted: order.map((x) => x.i), of: d.length };
}

/**
 * Index after each round. entries = [{ date, diff }] in any order; 18-hole rounds with a rating and
 * slope only. Returns oldest → newest [{ date, index, diff }], plus the current index and the low.
 */
export function indexHistory(entries) {
  const list = [...entries].filter((e) => e.diff != null).sort((a, b) => a.date - b.date);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const window = list.slice(Math.max(0, i - 19), i + 1).reverse().map((e) => e.diff);
    const r = indexFrom(window);
    out.push({ date: list[i].date, diff: list[i].diff, index: r ? r.index : null });
  }
  const cur = out.length ? indexFrom(list.slice(-20).reverse().map((e) => e.diff)) : null;
  const lows = out.filter((x) => x.index != null);
  const low = lows.length ? lows.reduce((a, x) => (x.index < a.index ? x : a)) : null;
  return { history: out, current: cur, low };
}

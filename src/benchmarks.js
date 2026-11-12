// What golfers at each handicap average, for "against your level" comparisons. Figures are
// published amateur averages, not tour baselines: fairways, greens, greens from 100 yards,
// up-and-down, putts and penalties per round from Shot Scope's handicap pages (via their
// Strokes Gained ebook and golfity's compilation, Nov 2026); driver "performance average"
// distance from Shot Scope (outliers excluded; the 15 figure is approximate); approach proximity
// (scratch 41.7 ft, 15-handicap 68 ft) and the 10-handicap tee miss rate from Arccos. Values are
// interpolated between the published bands.
export const HCP_BANDS = [0, 5, 10, 15, 20, 25];
export const BENCH = {
  driveYd: [285, 261, 259, 239, 225, 204],
  fir: [0.50, 0.48, 0.49, 0.48, 0.46, 0.46],
  gir: [0.61, 0.44, 0.36, 0.24, 0.17, 0.10],
  girFrom100: [0.74, 0.65, 0.57, 0.49, 0.42, 0.36],
  upDown: [0.47, 0.41, 0.31, 0.21, 0.20, 0.18],
  putts: [29.4, 30.2, 31.2, 33.1, 33.1, 33.8],
  penalties: [0.56, 0.91, 1.62, 2.45, 3.03, 4.67],
  proximityFt: [41.7, 50.5, 59.2, 68, 76, 84], // Arccos scratch and 15; the rest a straight line through them
  teeTrouble: [0.12, 0.17, 0.23, 0.28, 0.33, 0.40], // tee shots needing a recovery or lost (Arccos: scratch 12%, 10 23%, 20 33%)
  // a round's holes by result (Shot Scope via Golf Monthly; pars are what's left of 18)
  birdies: [2.34, 1.26, 0.72, 0.36, 0.36, 0.18],
  pars: [11.52, 9.18, 7.20, 4.86, 3.60, 2.52],
  bogeys: [3.87, 6.12, 7.20, 8.10, 7.38, 6.12],
  doubles: [0.27, 1.44, 2.88, 4.68, 6.66, 9.18],
  avgScore: [75, 80, 85.5, 91, 96.5, 101.5], // typical 18-hole average on a par 72 of average difficulty (golfity)
};
export const SOURCES = ['Shot Scope handicap benchmarks (fairways, greens, up & down, putts, penalties, driver distance, birdies, bogeys, doubles)', 'Arccos Golf (approach proximity, tee-shot miss rate)'];

/**
 * The level to aim at: five shots better than you are now, in steps of five, and never past scratch.
 * 6 → scratch, 10 → 5, 12 → 5, 15 → 10, 20 → 15.
 */
export const targetHcp = (h) => Math.max(0, 5 * Math.floor(((Number.isFinite(h) ? h : 15) - 5) / 5));

/** The benchmark row for a handicap index, interpolated; clamps to 0 and 25. */
export function benchFor(hcp) {
  const h = Math.max(0, Math.min(25, Number.isFinite(hcp) ? hcp : 15));
  let i = HCP_BANDS.findIndex((b, k) => h >= b && h <= (HCP_BANDS[k + 1] ?? 25)); if (i < 0) i = HCP_BANDS.length - 2;
  const a = HCP_BANDS[i], b = HCP_BANDS[i + 1] ?? a, t = b === a ? 0 : (h - a) / (b - a);
  const out = { hcp: h };
  for (const [k, row] of Object.entries(BENCH)) out[k] = row[i] + (row[Math.min(i + 1, row.length - 1)] - row[i]) * t;
  return out;
}
export const scratch = () => benchFor(0);
/** A handicap band label for the tables: "10-handicap", "scratch". */
export const levelLabel = (hcp) => (hcp == null ? 'your level' : hcp <= 1 ? 'scratch' : `${Math.round(hcp)}-handicap`);

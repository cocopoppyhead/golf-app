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
  gir: [0.59, 0.41, 0.32, 0.21, 0.14, 0.09], // Shot Scope 2026 (Golf Monthly, Sep 2026)
  girFrom100: [0.74, 0.65, 0.57, 0.49, 0.42, 0.36],
  upDown: [0.54, 0.47, 0.39, 0.34, 0.31, 0.25], // from inside 50 yards (Shot Scope via MyGolfSpy)
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
  // scoring by par (Shot Scope via MyGolfSpy)
  par3: [3.2, 3.4, 3.7, 3.9, 4.0, 4.2],
  par4: [4.2, 4.5, 4.8, 5.1, 5.4, 5.9],
  par5: [4.8, 5.3, 5.6, 6.0, 6.3, 7.0],
  // short game (Shot Scope via MyGolfSpy): up and down from under 25 and 25-50 yards, sand saves, proximity inside 50 yards
  upDownIn25: [0.63, 0.56, 0.47, 0.43, 0.41, 0.35],
  upDown25to50: [0.32, 0.25, 0.20, 0.16, 0.14, 0.09],
  sandSave: [0.37, 0.23, 0.20, 0.18, 0.15, 0.10],
  proxIn50Ft: [11, 14, 15, 18, 20, 22],
  greensideBunkers: [0.68, 1.06, 1.12, 1.18, 1.22, 1.26], // a round
  // approach proximity to the pin in feet by distance, and approaches finishing inside 30 ft (Shot Scope via Golf Monthly, 2025)
  prox50to100: [26, 36, 41, 48, 49, 57],
  prox100to150: [38, 50, 57, 72, 81, 91],
  prox150to200: [54, 82, 92, 122, 132, 168],
  prox200plus: [92, 150, 190, 264, 291, 362],
  inside30ft: [0.42, 0.29, 0.25, 0.17, 0.15, 0.13],
  // putting (Shot Scope via MyGolfSpy and Golf Monthly): make % by length, putts per green hit, 3-putts per hole putted, share of misses long
  make0to3: [0.98, 0.96, 0.96, 0.93, 0.90, 0.88],
  make3to6: [0.76, 0.67, 0.65, 0.59, 0.55, 0.48],
  make6to9: [0.49, 0.44, 0.39, 0.36, 0.33, 0.30],
  make9to12: [0.34, 0.34, 0.26, 0.22, 0.18, 0.17],
  make12to18: [0.19, 0.19, 0.18, 0.16, 0.14, 0.12],
  make18to24: [0.12, 0.13, 0.10, 0.09, 0.07, 0.06],
  make24to30: [0.07, 0.07, 0.07, 0.07, 0.05, 0.04],
  make30plus: [0.04, 0.03, 0.03, 0.02, 0.02, 0.02],
  puttsPerGir: [1.85, 1.93, 2.01, 2.09, 2.16, 2.18], // 5 and 15 interpolated
  threePuttRate: [0.03, 0.048, 0.07, 0.10, 0.13, 0.14], // 5 from "a 3-putt every 20.7 holes"; 15 interpolated
  missLong: [0.58, 0.54, 0.52, 0.45, 0.45, 0.41], // of missed putts, the share that finish long
};
// What each step down in handicap is made of (Arccos, 329,000 rounds, 2026): approach 38-40% of the gap,
// tee shots 24-29% (more as you get better), putting 14-20% (less as you get better), short game the rest.
export const GAP_SHARE = 'approach 38-40%, tee shots 24-29% (the share grows nearer scratch), putting 14-20% (shrinks nearer scratch), short game the rest';
// Age (men, Arccos and Shot Scope). Driving distance at the same handicap falls with age, and accuracy rises:
// Arccos 2022, golfers around a 14 index: 20s 237, 30s 234, 40s 225, 50s 216, 60s 205, 70s 194 yards. Shot Scope
// (all handicaps): 30s 256, 40s 252, 50s 243, 60s 230. Fairways (Arccos 2026, men): 20s 38% rising to 70s 56%.
// 7-iron (Arccos): 21-30 164, 51-60 151, 60+ 140 yards. Used as a ratio against the 20s at the same handicap.
export const AGE_BANDS = [['u30', 'Under 30'], ['30s', '30s'], ['40s', '40s'], ['50s', '50s'], ['60s', '60s'], ['70p', '70+']];
const AGE_DRIVE = { u30: 1, '30s': 0.987, '40s': 0.949, '50s': 0.911, '60s': 0.865, '70p': 0.819 };
const AGE_FIR = { u30: 0.38, '30s': 0.42, '40s': 0.45, '50s': 0.49, '60s': 0.52, '70p': 0.56 };
/** Driving at a handicap, adjusted for age: { driveYd, firShare, note }; null without an age. The table's driver figures are for all ages, taken as a golfer in their 40s. */
export function ageAdjust(hcp, ageBand) {
  if (!AGE_DRIVE[ageBand]) return null;
  const all = benchFor(hcp).driveYd, drive = Math.round((all / AGE_DRIVE['40s']) * AGE_DRIVE[ageBand]);
  return { driveYd: drive, fir: AGE_FIR[ageBand], label: AGE_BANDS.find(([v]) => v === ageBand)[1] };
}

export const SOURCES = ['Shot Scope handicap benchmarks (fairways, greens, up & down by distance, sand saves, putts, putt make % by distance, 3-putts, penalties, driver distance, birdies, bogeys, doubles, scoring by par, approach proximity by distance), via MyGolfSpy and Golf Monthly, 2024-2026', 'Arccos Golf (approach proximity, tee-shot miss rate, what each handicap step is made of)'];

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

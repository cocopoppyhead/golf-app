// Body: heart rate and heat against score. Heart rate comes from Garmin (per shot from the scorecard,
// once a minute from the activity), the weather from the round itself or the archive for the day.
// Scores are compared per 18 holes to par, and only where a group has at least MIN rounds.
const MIN = 3;
const p18 = (x) => (x.S.holes ? (x.S.toPar * 18) / x.S.holes : null);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const roundHrAvg = (r) => r.hrAct?.avg ?? r.hr?.avg ?? null;
export const roundTemp = (r) => r.cond?.start?.tempC ?? null;

/** list: [{ r, S }] (any order). Returns { hr: {...}|null, heat: [...]|null, years: [...]|null, closing: {...}|null }. */
export function bodyStats(list) {
  const L = list.filter((x) => !x.S.quick && x.S.holes >= 9 && p18(x) != null);
  const out = { n: 0, hr: null, heat: null, years: null, closing: null };
  // heart rate: rounds split at your own median
  const H = L.filter((x) => roundHrAvg(x.r)).sort((a, b) => roundHrAvg(a.r) - roundHrAvg(b.r));
  out.n = H.length;
  if (H.length >= 2 * MIN) {
    const mid = Math.floor(H.length / 2), lo = H.slice(0, mid), hi = H.slice(H.length - mid);
    out.hr = { median: roundHrAvg(H[mid].r), low: { n: lo.length, bpm: mean(lo.map((x) => roundHrAvg(x.r))), toPar: mean(lo.map(p18)) }, high: { n: hi.length, bpm: mean(hi.map((x) => roundHrAvg(x.r))), toPar: mean(hi.map(p18)) } };
  }
  // heat bands
  const BANDS = [[-99, 24, 'Under 24°C'], [24, 30, '24–30°C'], [30, 35, '30–35°C'], [35, 99, '35°C and up']];
  const T = L.filter((x) => roundTemp(x.r) != null);
  const heat = BANDS.map(([a, b, label]) => { const g = T.filter((x) => roundTemp(x.r) >= a && roundTemp(x.r) < b); return { label, n: g.length, toPar: mean(g.map(p18)) }; }).filter((b) => b.n >= MIN);
  if (heat.length >= 2) out.heat = heat;
  // year by year: average round heart rate (a fitness hint) beside the score
  const years = {};
  for (const x of H) { const y = new Date(x.r.date).getFullYear(); (years[y] ||= []).push(x); }
  const Y = Object.entries(years).map(([y, g]) => ({ year: +y, n: g.length, bpm: mean(g.map((x) => roundHrAvg(x.r))), toPar: mean(g.map(p18)) })).filter((y) => y.n >= MIN).sort((a, b) => a.year - b.year);
  if (Y.length >= 2) out.years = Y;
  // closing holes (15–18) against the rest, in rounds with heart rate per hole
  const C = L.filter((x) => (x.r.holes || []).length >= 18 && x.r.holes.filter((h) => h?.hr?.avg).length >= 12);
  if (C.length >= MIN) {
    const part = (x, from, to) => { const hs = x.r.holes.slice(from, to).map((h, i) => ({ h, par: x.c.holes[from + i]?.par || 4 })).filter(({ h }) => h?.hr?.avg && h.score != null); return { bpm: mean(hs.map(({ h }) => h.hr.avg)), toPar: mean(hs.map(({ h, par }) => h.score - par)) }; };
    const a = C.map((x) => part(x, 0, 14)), b = C.map((x) => part(x, 14, 18));
    out.closing = { n: C.length, early: { bpm: mean(a.map((v) => v.bpm)), toPar: mean(a.map((v) => v.toPar)) }, late: { bpm: mean(b.map((v) => v.bpm)), toPar: mean(b.map((v) => v.toPar)) } };
  }
  return out;
}

// Where you score from: approach shots grouped by the distance they were hit from. Molinari found
// he was 3.5 ft closer from 80–100 than from 40–60 and laid up accordingly; this is the same table
// for the golfer's own rounds. Start distance = the shot's logged distance (laser or ≈ from the club);
// how it finished = green hit or not, and the first-putt distance when it was. Pure functions.
import { expected } from './sg.js';
import { LIE_FROM } from './hole.js';

export const BANDS = [[30, 50], [50, 75], [75, 100], [100, 125], [125, 150], [150, 175], [175, 200], [200, 250]];
const MIN_SHOTS = 5;
const GREEN = new Set(['G', 'HO']);
const MISS_YD = 15; // a missed green is taken as a 15-yard shot from whatever lie it found

export const bandLabel = ([lo, hi], conv = (x) => x) => (hi >= 250 ? `${conv(lo)}+` : `${conv(lo)}–${conv(hi)}`);
const bandOf = (d) => BANDS.find(([lo, hi]) => d >= lo && d < hi) || null;

/** The approach shots of one hole: the shot that was played at the green, however it ended. */
function approaches(h, par) {
  if (!h?.shots?.length || h.score == null) return [];
  const out = [];
  h.shots.forEach((x, k) => {
    if (!x || x.dist == null) return;
    if (k === 0 && par !== 3) return; // a tee shot on a par 4/5 is not an approach
    if (x.res === 'FW' || x.pen) return; // a lay-up, or a ball that went out, says nothing about proximity
    if (x.dist < BANDS[0][0] || x.dist >= 250) return;
    const hit = GREEN.has(x.res);
    const last = k === h.shots.length - 1;
    const prox = hit && last && h.firstPutt != null ? h.firstPutt : null; // feet
    if (!hit && !x.res) return; // not logged yet
    out.push({ from: x.dist, lie: x.lie || x.lieAuto || 'fw', hit, prox, res: x.res, holed: x.res === 'HO', plan: x.d?.plan ?? null, sat: x.d?.sat ?? null });
  });
  return out;
}

/**
 * Band table over rounds: [{ band, n, gir, prox (median ft of first putts), looks (≤15 ft %), finish
 * (average strokes to hole out from where the approach left you, incl. the approach) }], plus
 * `best` (lowest finish with enough shots) and `worst`. `rounds` = [{ r, c }].
 */
export function approachBands(rounds) {
  const rows = BANDS.map((band) => ({ band, n: 0, hits: 0, prox: [], looks: 0, finish: [] }));
  for (const { r, c } of rounds) {
    if (!r?.holes || !c?.holes) continue;
    r.holes.forEach((h, i) => {
      const par = c.holes[i]?.par ?? 4;
      for (const a of approaches(h, par)) {
        const row = rows[BANDS.indexOf(bandOf(a.from))]; if (!row) continue;
        row.n++;
        if (a.holed) { row.hits++; row.prox.push(0); row.looks++; row.finish.push(1); continue; }
        if (a.hit) {
          row.hits++;
          if (a.prox != null) { row.prox.push(a.prox); if (a.prox <= 15) row.looks++; row.finish.push(1 + expected('grn', a.prox)); }
          else row.finish.push(1 + expected('grn', 25));
        } else {
          const lie = LIE_FROM[a.res] || 'rgh';
          row.finish.push(1 + expected(lie === 'fbk' ? 'bnk' : lie, MISS_YD));
        }
      }
    });
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = rows.map((r) => ({
    band: r.band, label: bandLabel(r.band), n: r.n,
    gir: r.n ? r.hits / r.n : null,
    prox: med(r.prox),
    looks: r.n ? r.looks / r.n : null,
    finish: r.finish.length ? r.finish.reduce((a, b) => a + b, 0) / r.finish.length : null,
    tour: expected('fw', (r.band[0] + r.band[1]) / 2),
    enough: r.n >= MIN_SHOTS,
  }));
  const ok = out.filter((b) => b.enough && b.finish != null);
  const best = ok.length ? ok.reduce((a, b) => (b.finish < a.finish ? b : a)) : null;
  const worst = ok.length > 1 ? ok.reduce((a, b) => (b.finish > a.finish ? b : a)) : null;
  return { bands: out, best, worst, total: out.reduce((a, b) => a + b.n, 0) };
}

/** Is a distance inside the band you score best from? */
export const inBand = (d, band) => !!band && d >= band[0] && d < band[1];

/** Shots as planned / satisfaction, over rounds: { planned: 0..1 | null, sat: avg 1–5 | null, n }. */
export function executionSummary(rounds) {
  let plan = 0, planN = 0, sat = 0, satN = 0;
  for (const { r } of rounds) for (const h of r?.holes || []) for (const x of h?.shots || []) {
    if (x?.d?.plan === true || x?.d?.plan === false) { planN++; if (x.d.plan) plan++; }
    if (x?.d?.sat) { satN++; sat += x.d.sat; }
  }
  return { planned: planN ? plan / planN : null, sat: satN ? sat / satN : null, n: Math.max(planN, satN) };
}

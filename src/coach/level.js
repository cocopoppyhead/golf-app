// The golfer against golfers at their level and at the level they're aiming for, stat by stat, from
// published amateur data (benchmarks.js: Shot Scope and Arccos). Without this the coach could only
// compare them with tour players, which says little to a 6-handicap. Every number is worked out here.
import { roundStats, aggregate } from '../rounds/stats.js';
import { benchFor, targetHcp, GAP_SHARE, ageAdjust } from '../benchmarks.js';

const pc = (x) => `${Math.round(100 * x)}%`;
const BANDS = [[0, 3, 'make0to3'], [3, 6, 'make3to6'], [6, 9, 'make6to9'], [9, 12, 'make9to12'], [12, 18, 'make12to18'], [18, 24, 'make18to24'], [24, 30, 'make24to30'], [30, 999, 'make30plus']];

/** Their own numbers where the data allows: { par3, par4, par5, gir, scr, sand, threePutt, make: { key: {n, pct} } }. */
export function ownNumbers(rcs) {
  const list = rcs.filter((x) => x.c && !x.r.quick);
  const byPar = { 3: [0, 0], 4: [0, 0], 5: [0, 0] }, make = {};
  for (const { r, c } of list) (r.holes || []).forEach((h, i) => {
    const par = c.holes?.[i]?.par; if (!h || h.score == null || !byPar[par]) return;
    byPar[par][0] += h.score; byPar[par][1]++;
    for (const p of h.puttList || []) { if (p?.ft == null) continue; const b = BANDS.find(([lo, hi]) => p.ft >= lo && p.ft < hi); if (!b) continue; const m = (make[b[2]] ||= { n: 0, made: 0 }); m.n++; if (p.holed) m.made++; }
  });
  const A = aggregate(list.map((x) => ({ round: x.r, course: x.c, stats: roundStats(x.r, x.c) })));
  const avg = (p) => (byPar[p][1] >= 8 ? byPar[p][0] / byPar[p][1] : null);
  return {
    holes: A?.holes || 0, par3: avg(3), par4: avg(4), par5: avg(5),
    gir: A?.girOpp >= 36 ? A.gir / A.girOpp : null, fir: A?.firOpp >= 28 ? A.fir / A.firOpp : null,
    scr: A?.scrOpp >= 10 ? A.scr / A.scrOpp : null, sand: A?.sandOpp >= 5 ? A.sand / A.sandOpp : null,
    threePutt: A?.puttsHoles >= 36 ? A.threePutts / A.puttsHoles : null,
    make: Object.fromEntries(Object.entries(make).filter(([, m]) => m.n >= 8).map(([k, m]) => [k, { n: m.n, pct: m.made / m.n }])),
  };
}

/** The block the coach reads: them, their level, their target, per stat; plus the benchmarks alone when their own data is thin. */
export function levelText(rcs, hcp, { ageBand = null } = {}) {
  if (hcp == null || !Number.isFinite(+hcp)) return '';
  const h = +hcp, tg = targetHcp(h), B = benchFor(h), T = benchFor(tg), me = ownNumbers(rcs);
  const lvl = `a ${Math.round(h)}-handicap`, tgt = tg ? `a ${tg}-handicap` : 'scratch';
  const row = (label, mine, b, t, fmt) => `${label}: ${mine == null ? 'not enough of their own data yet' : `them ${fmt(mine)}`}; ${lvl} ${fmt(b)}; ${tgt} ${fmt(t)}.`;
  const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
  const lines = [`THEIR LEVEL AND THEIR TARGET (published amateur averages: Shot Scope and Arccos; use these to say where they stand, not the tour)`,
    row('Par 3s, average score', me.par3, B.par3, T.par3, f1),
    row('Par 4s', me.par4, B.par4, T.par4, f1),
    row('Par 5s', me.par5, B.par5, T.par5, f1),
    row('Greens in regulation', me.gir, B.gir, T.gir, pc),
    row('Fairways', me.fir, B.fir, T.fir, pc),
    row('Up and down after missing the green', me.scr, B.upDown, T.upDown, pc),
    row('Sand saves', me.sand, B.sandSave, T.sandSave, pc),
    row('3-putts per hole', me.threePutt, B.threePuttRate, T.threePuttRate, pc),
    `Putts holed by length (${lvl} / ${tgt}${Object.keys(me.make).length ? ' / them' : ''}): ${BANDS.map(([lo, hi, k]) => `${hi > 99 ? `${lo}+` : `${lo}-${hi}`} ft ${pc(B[k])} / ${pc(T[k])}${me.make[k] ? ` / ${pc(me.make[k].pct)} (${me.make[k].n})` : ''}`).join(', ')}.`,
    `Approach proximity to the pin in feet (${lvl} / ${tgt}): 50-100 yd ${B.prox50to100.toFixed(0)} / ${T.prox50to100.toFixed(0)}, 100-150 ${B.prox100to150.toFixed(0)} / ${T.prox100to150.toFixed(0)}, 150-200 ${B.prox150to200.toFixed(0)} / ${T.prox150to200.toFixed(0)}, 200+ ${B.prox200plus.toFixed(0)} / ${T.prox200plus.toFixed(0)}; inside 30 ft ${pc(B.inside30ft)} / ${pc(T.inside30ft)} of approaches.`,
    `Short game (${lvl} / ${tgt}): up and down from under 25 yd ${pc(B.upDownIn25)} / ${pc(T.upDownIn25)}, from 25-50 yd ${pc(B.upDown25to50)} / ${pc(T.upDown25to50)}; inside 50 yd they finish ${f1(B.proxIn50Ft)} / ${f1(T.proxIn50Ft)} ft away.`,
    `Per round (${lvl} / ${tgt}): penalties ${f1(B.penalties)} / ${f1(T.penalties)}, doubles or worse ${f1(B.doubles)} / ${f1(T.doubles)}, birdies ${f1(B.birdies)} / ${f1(T.birdies)}, putts ${f1(B.putts)} / ${f1(T.putts)}, putts per green hit ${f2(B.puttsPerGir)} / ${f2(T.puttsPerGir)}.`,
    `What a step down in handicap is made of (Arccos): ${GAP_SHARE}.`];
  const age = ageAdjust(h, ageBand);
  if (age) lines.push(`Age: they're in their ${age.label.toLowerCase()}. Golfers of their handicap and age drive about ${age.driveYd} yards and hit about ${pc(age.fir)} of fairways (Arccos: distance falls and accuracy rises with age at the same handicap). Judge their driving against that, not against younger players.`);
  return lines.join('\n');
}

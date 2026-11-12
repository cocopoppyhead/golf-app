// Round stats, built from the per-hole log. Pure functions — no DOM.
//
// Hole record:
// { score, putts, tee: 'LT'|'LR'|'FW'|'RR'|'RT'|null, gir: true|false|null (null = work it out),
//   miss: 'S'|'L'|'LF'|'R'|null (approach miss when green missed: short/long/left/right),
//   bunker: bool (green-side bunker), firstPutt: ft|null,
//   tags: [{ shot, cause, strike, result, cost: 1|2|0 (0 = "saved it") }] }

// Conor's codes. Labels only where the meaning is unambiguous.
export const CODES = {
  // shot type
  shot: [['DRV', 'Driver'], ['TEE', 'Non-driver off tee'], ['FWY', 'Wood/hybrid off turf'], ['IRN', 'Mid-long iron'], ['APP', 'Wedge, inside 100–150'], ['CHP', 'Chip/pitch'], ['BKR', 'Greenside bunker'], ['PT', 'Putt']],
  // execution
  cause: [['TAC', 'Decision'], ['SWE', 'Swing'], ['FOC', 'Focus / routine'], ['BAC', 'Body (back…)']],
  // ball flight
  flight: [['STR', 'Straight'], ['DRW', 'Draw'], ['FAD', 'Fade'], ['HK', 'Hook'], ['SL', 'Slice'], ['PL', 'Pull'], ['PU', 'Push'], ['OTH', 'Other']],
  // strike
  strike: [['THN', 'Thin'], ['FAT', 'Chunk / fat'], ['TOE', 'Toe'], ['HEL', 'Heel']],
  // positioning
  result: [['BNK', 'Bunker'], ['OBS', 'Out of bounds'], ['WDS', 'Woods'], ['RGH', 'Heavy rough'], ['SS', 'Short sided'], ['UNUD', 'Up & down made'], ['3P', '3-putt'], ['LNG', 'Long'], ['SHT', 'Short']],
};
export const TEE_ZONES = [['LT', 'Trouble'], ['LR', 'Rough'], ['FW', 'Fairway'], ['RR', 'Rough'], ['RT', 'Trouble']];
export const MISS = [['S', 'Short'], ['LF', 'Left'], ['R', 'Right'], ['L', 'Long']];

export const isGir = (h, par) => (h.gir != null ? h.gir : h.score != null && h.putts != null ? h.score - h.putts <= par - 2 : null);
export const played = (r) => r.holes.filter((h) => h && h.score != null);

export function roundStats(round, course) {
  const pars = course.holes.map((x) => x.par);
  const S = {
    holes: 0, score: 0, par: 0, putts: 0, puttsHoles: 0,
    firOpp: 0, fir: 0, teeLeft: 0, teeRight: 0, teeTrouble: 0,
    girOpp: 0, gir: 0, miss: { S: 0, L: 0, LF: 0, R: 0 },
    threePutts: 0, onePutts: 0, scrOpp: 0, scr: 0, sandOpp: 0, sand: 0,
    byPar: { 3: [0, 0], 4: [0, 0], 5: [0, 0] }, // [strokes, holes]
    birdies: 0, pars: 0, bogeys: 0, doubles: 0, triples: 0, quick: !!round.quick,
    cost: 0, saved: 0, byCause: {}, byShot: {}, byStrike: {}, byResult: {}, untagged: 0,
    front: 0, back: 0,
    planN: 0, planned: 0, satN: 0, satSum: 0, byLie: {}, fp: { L: 0, P: 0, S: 0, LF: 0, C: 0, R: 0 }, fpN: 0, // shot Details: as planned / stars / lie detail; first putt from the flag
    // the break-80 numbers (Golf Digest / Lou Stagner / Arccos): GIR+1, recovery ("dirt") drives, the 150–200 zone, lag 3-putts
    gir1: 0, gir1Opp: 0, dirt: 0, zone: 0, zoneDbl: 0, lagOpp: 0, lag3: 0,
  };
  if (round.quick) {
    // posted total only: score and par, nothing hole-by-hole
    const n = round.holesPlayed || 18;
    S.holes = n; S.score = round.score ?? 0; S.par = pars.slice(0, n).reduce((a, p) => a + p, 0);
    if (round.putts != null) { S.putts = round.putts; S.puttsHoles = n; }
    S.toPar = S.score - S.par;
    return S;
  }
  round.holes.forEach((h, i) => {
    if (!h || h.score == null) return;
    const par = pars[i] ?? 4;
    S.holes++; S.score += h.score; S.par += par;
    if (i < 9) S.front += h.score; else S.back += h.score;
    const d = h.score - par;
    if (d <= -1) S.birdies++; else if (d === 0) S.pars++; else if (d === 1) S.bogeys++; else { S.doubles++; if (d >= 3) S.triples++; }
    if (S.byPar[par]) { S.byPar[par][0] += h.score; S.byPar[par][1]++; }
    if (h.putts != null) {
      S.putts += h.putts; S.puttsHoles++;
      if (h.putts >= 3) S.threePutts++; if (h.putts === 1) S.onePutts++;
    }
    if (h.putts != null) { S.gir1Opp++; if (h.score - h.putts <= par - 1) S.gir1++; }
    if (h.putts != null && h.firstPutt != null && h.firstPutt >= 20) { S.lagOpp++; if (h.putts >= 3) S.lag3++; }
    if (par >= 4 && h.shots?.[0]) { const t = h.shots[0]; if (t.res === 'LT' || t.res === 'RT' || ['FB', 'WS', 'PN', 'WT', 'OB'].includes(t.res2) || t.pen) S.dirt++; }
    if (h.shots) { const a = h.shots[Math.max(0, par - 3)]; if (a && a.dist != null && a.dist >= 150 && a.dist < 200 && !(par >= 4 && a.res === 'FW')) { S.zone++; if (d >= 2) S.zoneDbl++; } }
    if (par >= 4 && h.tee) {
      S.firOpp++;
      if (h.tee === 'FW') S.fir++;
      if (h.tee === 'LR' || h.tee === 'LT') S.teeLeft++;
      if (h.tee === 'RR' || h.tee === 'RT') S.teeRight++;
      if (h.tee === 'LT' || h.tee === 'RT') S.teeTrouble++;
    }
    const g = isGir(h, par);
    if (g != null) {
      S.girOpp++;
      if (g) S.gir++;
      else {
        if (h.miss && S.miss[h.miss] != null) S.miss[h.miss]++;
        S.scrOpp++; if (h.score <= par) S.scr++;
        if (h.bunker) { S.sandOpp++; if (h.score <= par) S.sand++; }
      }
    }
    let tagged = 0;
    for (const t of h.tags || []) {
      if (!t.cost) { S.saved++; continue; }
      tagged += t.cost; S.cost += t.cost;
      for (const [k, m] of [['cause', S.byCause], ['shot', S.byShot], ['flight', S.byStrike], ['strike', S.byStrike], ['result', S.byResult]]) if (t[k]) m[t[k]] = (m[t[k]] || 0) + t.cost;
    }
    if (d > 0 && tagged < d) S.untagged += d - tagged;
    for (const x of h.shots || []) {
      if (!x?.d) continue;
      if (x.d.plan === true || x.d.plan === false) { S.planN++; if (x.d.plan) S.planned++; }
      if (x.d.sat) { S.satN++; S.satSum += x.d.sat; }
      // a lie detail counts against the lie when the shot wasn't what you wanted, cost a stroke, or rated ≤2
      const bad = x.d.plan === false || (x.d.cost > 0) || (x.d.sat && x.d.sat <= 2);
      for (const l of x.d.lies || []) { const m = (S.byLie[l] ||= { n: 0, bad: 0 }); m.n++; if (bad) m.bad++; }
    }
    if (h.fpLong && h.fpSide) { S.fpN++; S.fp[h.fpLong]++; S.fp[h.fpSide]++; }
  });
  S.toPar = S.score - S.par;
  return S;
}

/** Sum stats across rounds and express per 18 holes. */
export function aggregate(list) {
  // list: [{round, course, stats}]
  const n = list.length;
  if (!n) return null;
  const A = { rounds: n, holes: 0 };
  const sum = (k) => list.reduce((a, x) => a + (x.stats[k] || 0), 0);
  for (const k of ['holes', 'score', 'par', 'putts', 'puttsHoles', 'firOpp', 'fir', 'teeLeft', 'teeRight', 'teeTrouble', 'girOpp', 'gir', 'threePutts', 'onePutts', 'scrOpp', 'scr', 'sandOpp', 'sand', 'cost', 'saved', 'untagged', 'birdies', 'pars', 'bogeys', 'doubles']) A[k] = sum(k);
  A.miss = { S: 0, L: 0, LF: 0, R: 0 };
  list.forEach((x) => Object.keys(A.miss).forEach((m) => (A.miss[m] += x.stats.miss[m])));
  for (const k of ['byCause', 'byShot', 'byStrike', 'byResult']) {
    A[k] = {};
    list.forEach((x) => Object.entries(x.stats[k]).forEach(([c, v]) => (A[k][c] = (A[k][c] || 0) + v)));
  }
  for (const k of ['planN', 'planned', 'satN', 'satSum', 'fpN', 'gir1', 'gir1Opp', 'dirt', 'zone', 'zoneDbl', 'lagOpp', 'lag3']) A[k] = list.reduce((a, x) => a + (x.stats[k] || 0), 0);
  A.fp = { L: 0, P: 0, S: 0, LF: 0, C: 0, R: 0 }; list.forEach((x) => Object.keys(A.fp).forEach((m) => (A.fp[m] += x.stats.fp?.[m] || 0)));
  A.byLie = {}; list.forEach((x) => Object.entries(x.stats.byLie || {}).forEach(([l, m]) => { const t = (A.byLie[l] ||= { n: 0, bad: 0 }); t.n += m.n; t.bad += m.bad; }));
  const per18 = 18 / (A.holes || 1);
  A.per18 = per18;
  A.avgToPar = ((A.score - A.par) * per18);
  return A;
}

const LABEL = Object.fromEntries(Object.values(CODES).flat().filter(([, l]) => l).map(([c, l]) => [c, l.toLowerCase()]));
const LIE_WORD = { abv: 'Ball-above-feet', blw: 'Ball-below-feet', up: 'Uphill-lie', dn: 'Downhill-lie', fc: 'First-cut', hvy: 'Heavy-rough', fly: 'Flyer-lie', div: 'Divot', hp: 'Hardpan', wet: 'Wet-lie' };
const nm = (c) => (LABEL[c] ? `${c} (${LABEL[c]})` : c);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);

/**
 * Plain-English on-course tendencies, strongest first.
 * Each: { key, text, detail, weight }
 */
export function roundTendencies(A) {
  if (!A || A.holes < 9) return [];
  const out = [];
  const p18 = A.per18;
  const teeMiss = A.teeLeft + A.teeRight;
  if (teeMiss >= 4) {
    const side = A.teeRight >= A.teeLeft ? 'right' : 'left';
    const n = Math.max(A.teeLeft, A.teeRight);
    if (n / teeMiss >= 0.65) out.push({ key: 'tee-' + side, text: `Tee shots miss ${side}`, detail: `${n} of ${teeMiss} missed fairways went ${side}`, weight: 2 + n / teeMiss });
  }
  if (A.teeTrouble * p18 >= 2) out.push({ key: 'tee-trouble', text: 'Tee shots finding trouble', detail: `${(A.teeTrouble * p18).toFixed(1)} per round in trees/OB/hazard`, weight: 2.5 });
  if (A.dirt * p18 >= 2.5) out.push({ key: 'dirt', text: 'Drives that need a recovery shot', detail: `${(A.dirt * p18).toFixed(1)} per round in trouble, fairway bunkers or waste — pick the safe side, treat bunkers like water`, weight: 2.3 });
  if (A.zone >= 6 && A.zoneDbl / A.zone >= 0.2) out.push({ key: 'zone', text: 'Doubles from 150–200', detail: `${Math.round((100 * A.zoneDbl) / A.zone)}% of holes with a 150–200 approach became a double — aim at the fat side, GIR+1 is the goal`, weight: 2.2 });
  if (A.lagOpp >= 6 && A.lag3 / A.lagOpp >= 0.3) out.push({ key: 'lag', text: 'Three-putting from 20 ft and beyond', detail: `${Math.round((100 * A.lag3) / A.lagOpp)}% of first putts from 20+ became three putts — speed, not line`, weight: 2 });
  const greenMiss = Object.values(A.miss).reduce((a, b) => a + b, 0);
  if (greenMiss >= 4) {
    const [m, c] = top(A.miss)[0];
    const name = { S: 'short', L: 'long', LF: 'left', R: 'right' }[m];
    if (c / greenMiss >= 0.45) out.push({ key: 'app-' + name, text: `Approaches miss ${name}`, detail: `${c} of ${greenMiss} missed greens were ${name}`, weight: 2 + c / greenMiss });
  }
  if (A.threePutts * p18 >= 1.5) out.push({ key: '3putt', text: 'Three-putts', detail: `${(A.threePutts * p18).toFixed(1)} per round`, weight: 1.5 + A.threePutts * p18 * 0.3 });
  if (A.scrOpp >= 5 && A.scr / A.scrOpp < 0.4) out.push({ key: 'scramble', text: 'Not getting up and down', detail: `${pct(A.scr, A.scrOpp)}% scrambling`, weight: 1.8 });
  const causes = top(A.byCause);
  if (causes.length && causes[0][1] * p18 >= 1.5) out.push({ key: 'cause-' + causes[0][0], text: `Most shots lost to ${nm(causes[0][0])}`, detail: `${(causes[0][1] * p18).toFixed(1)} strokes per round`, weight: 2 + causes[0][1] * p18 * 0.2 });
  const strikes = top(A.byStrike);
  if (strikes.length && strikes[0][1] >= 3) out.push({ key: 'strike-' + strikes[0][0], text: `Costliest bad shot: ${nm(strikes[0][0])}`, detail: `${strikes[0][1]} strokes across ${A.rounds} round${A.rounds > 1 ? 's' : ''}`, weight: 1.6 });
  const shots = top(A.byShot);
  if (shots.length && shots[0][1] >= 3) out.push({ key: 'shot-' + shots[0][0], text: `Most strokes lost on ${nm(shots[0][0])}`, detail: `${(shots[0][1] * p18).toFixed(1)} per round`, weight: 1.7 });
  // first putts: where approaches finish relative to the flag
  if (A.fpN >= 8) {
    const ld = [['S', 'short of the flag'], ['L', 'past the flag']].map(([k, w]) => [k, w, A.fp[k] / A.fpN]).sort((a, b) => b[2] - a[2])[0];
    if (ld[2] >= 0.55) out.push({ key: 'fp-' + ld[0], text: `Approaches finish ${ld[1]}`, detail: `${Math.round(ld[2] * 100)}% of first putts were ${ld[1]}${ld[0] === 'S' ? ' — take one more club' : ''}`, weight: 1.6 + ld[2] });
    const side = [['LF', 'left'], ['R', 'right']].map(([k, w]) => [k, w, A.fp[k] / A.fpN]).sort((a, b) => b[2] - a[2])[0];
    if (side[2] >= 0.5) out.push({ key: 'fpside-' + side[0], text: `Approaches finish ${side[1]} of the flag`, detail: `${Math.round(side[2] * 100)}% of first putts were ${side[1]}`, weight: 1.5 + side[2] });
  }
  // lies that go wrong more often than not
  for (const [l, m] of Object.entries(A.byLie)) if (m.n >= 4 && m.bad / m.n >= 0.5) out.push({ key: 'lie-' + l, text: `${LIE_WORD[l] || l} shots go wrong`, detail: `${m.bad} of ${m.n} weren't the shot you wanted — practise that lie`, weight: 1.4 + m.bad / m.n });
  if (A.planN >= 15 && A.planned / A.planN < 0.5) out.push({ key: 'plan', text: 'Fewer than half your shots come off as planned', detail: `${Math.round((100 * A.planned) / A.planN)}% as planned across ${A.planN} rated shots`, weight: 1.6 });
  return out.sort((a, b) => b.weight - a.weight);
}

/** Compact text for the AI coach. */
export function roundSummaryText(A) {
  if (!A) return '';
  const p18 = A.per18;
  const f = (x) => (x * p18).toFixed(1);
  const parts = [
    `${A.rounds} round${A.rounds > 1 ? 's' : ''} (${A.holes} holes), avg ${A.avgToPar >= 0 ? '+' : ''}${A.avgToPar.toFixed(1)} per 18`,
    `FIR ${pct(A.fir, A.firOpp) ?? '–'}% (misses: ${A.teeLeft} left, ${A.teeRight} right, ${A.teeTrouble} in trouble)`,
    `GIR ${pct(A.gir, A.girOpp) ?? '–'}% (missed greens: ${A.miss.S} short, ${A.miss.L} long, ${A.miss.LF} left, ${A.miss.R} right)`,
    `putts ${A.puttsHoles ? f(A.putts * (A.holes / A.puttsHoles)) : '–'}/18, 3-putts ${f(A.threePutts)}/18`,
    `scrambling ${pct(A.scr, A.scrOpp) ?? '–'}%, sand saves ${pct(A.sand, A.sandOpp) ?? '–'}%`,
    `tagged strokes lost per 18 by cause: ${top(A.byCause).map(([k, v]) => `${k} ${f(v)}`).join(', ') || 'none'}`,
    `by shot: ${top(A.byShot).map(([k, v]) => `${k} ${f(v)}`).join(', ') || 'none'}`,
    `by strike: ${top(A.byStrike).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `by result: ${top(A.byResult).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `GIR+1 (on the green with a shot to spare) ${pct(A.gir1, A.gir1Opp) ?? '–'}%, recovery drives ${f(A.dirt)}/18, doubles+ ${f(A.doubles)}/18, 150–200 approaches ${A.zone} with ${A.zoneDbl} doubles, 3-putts from 20+ ft ${A.lag3}/${A.lagOpp}`,
    A.planN ? `shots as planned ${pct(A.planned, A.planN)}% of ${A.planN} rated${A.satN ? `, satisfaction ${(A.satSum / A.satN).toFixed(1)}/5` : ''}` : null,
    A.fpN ? `first putts vs flag: ${A.fp.S} short, ${A.fp.P} pin high, ${A.fp.L} long; ${A.fp.LF} left, ${A.fp.C} on line, ${A.fp.R} right` : null,
    Object.keys(A.byLie).length ? `lies (shots that went wrong/total): ${Object.entries(A.byLie).map(([l, m]) => `${LIE_WORD[l] || l} ${m.bad}/${m.n}`).join(', ')}` : null,
  ].filter(Boolean);
  return parts.join('; ') + '.';
}

export { pct, top };

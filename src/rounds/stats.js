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
  cause: [['TAC', 'Tactical'], ['SWE', 'Swing error'], ['FOC', 'Focus / prep'], ['BAC', 'Back problem']],
  // ball flight
  flight: [['STR', 'Straight'], ['DRW', 'Draw'], ['FAD', 'Fade'], ['HK', 'Hook'], ['SL', 'Slice'], ['PL', 'Pull'], ['PU', 'Push']],
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
  const per18 = 18 / (A.holes || 1);
  A.per18 = per18;
  A.avgToPar = ((A.score - A.par) * per18);
  return A;
}

const LABEL = Object.fromEntries(Object.values(CODES).flat().filter(([, l]) => l).map(([c, l]) => [c, l.toLowerCase()]));
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
  ];
  return parts.join('; ') + '.';
}

export { pct, top };

// "Tiger 5" style round rules, checked automatically from the hole log.
// Each rule returns the holes that broke it. Some rules rely on your tags (noted in `how`).
const isBogeyPlus = (h, par) => h && h.score != null && h.score > par;
const tagged = (h, pred) => (h?.tags || []).some((t) => t.cost && pred(t));
const hasShots = (h) => Array.isArray(h?.shots) && h.shots.some((x) => x && x.dist != null);
// the shot meant to find the green in regulation started inside 150 yards
const scoringChance = (h, par, yds) => {
  if (par === 3) return (yds ?? h.shots?.[0]?.dist ?? 999) <= 150;
  const a = h.shots?.[par - 3];
  return a?.dist != null && a.dist <= 150;
};
// missed green, an easy chip (fairway/fringe/light rough inside 30 yds, not short-sided), and didn't get up and down
const blownSave = (h) => {
  if (!hasShots(h) || h.putts == null) return false;
  const k = h.shots.findIndex((x, n) => n > 0 && x.dist != null && x.dist <= 30 && ['fw', 'frg', 'rgh'].includes(x.lie) && !h.shots[n - 1]?.ss);
  if (k < 0) return false;
  const left = h.shots.length - k + h.shots.slice(k).filter((x) => x.pen).length + h.putts;
  return left > 2;
};

export const RULES = {
  noDoubles:   { label: 'No double bogeys', check: (h, par) => h?.score - par >= 2 },
  noBogeyPar5: { label: 'No bogeys on par 5s', check: (h, par) => par === 5 && isBogeyPlus(h, par) },
  noShortBogey:{ label: 'No bogeys inside 150 yards', how: 'bogey or worse when your approach was from 150 or closer', check: (h, par, yds) => isBogeyPlus(h, par) && (hasShots(h) ? scoringChance(h, par, yds) : tagged(h, (t) => ['APP', 'CHP', 'BNK', 'BKR', 'PT'].includes(t.shot))) },
  blownSave:   { label: 'No blown easy saves', how: 'an easy chip (not short-sided, inside 30 yds) that didn\'t get up and down', check: (h) => blownSave(h) },
  no3Putts:    { label: 'No 3-putts', check: (h) => h?.putts >= 3 },
  noDoubleChip:{ label: 'No double chips (1 chip, 1 putt)', how: 'missed green and 2+ shots to get on', check: (h, par) => {
    if (!h || h.score == null || h.putts == null) return false;
    const toGreen = h.score - h.putts; // strokes before first putt
    return toGreen - (par - 2) >= 2;
  } },
  noFwBunker:  { label: 'No fairway bunkers off the tee (use 3 wood)', check: (h) => h?.shots?.[0]?.res2 === 'FB' || tagged(h, (t) => ['DRV', 'TEE'].includes(t.shot) && t.result === 'BNK') },
  noTeeErrors: { label: 'No unforced errors from tee shots', how: 'tee shot into trouble, or a TAC/FOC tag on DRV/TEE', check: (h, par) => par >= 4 && (h?.tee === 'LT' || h?.tee === 'RT' || tagged(h, (t) => ['DRV', 'TEE'].includes(t.shot) && ['TAC', 'FOC'].includes(t.cause))) },
};

export const DEFAULT_RULES = ['noDoubles', 'noBogeyPar5', 'noShortBogey', 'no3Putts', 'noDoubleChip'];

// Scott Fawcett's Tiger 5 (DECADE): six or fewer per round to win. Tour top-5 finishers average about 1.6
// (excluding blown saves); missed cuts about 3.7.
export const TIGER5 = ['noDoubles', 'noBogeyPar5', 'no3Putts', 'noShortBogey', 'blownSave'];
export const TIGER5_LABEL = { noDoubles: 'Double bogeys', noBogeyPar5: 'Bogeys on par 5s', no3Putts: 'Three putts', noShortBogey: 'Bogeys inside 150', blownSave: 'Blown easy saves' };
export const TIGER5_TOUR = { noDoubles: [0.14, 0.56], noBogeyPar5: [0.13, 0.36], no3Putts: [0.36, 0.65], noShortBogey: [0.98, 2.11] }; // [top 5, missed cut] per round
export function tiger5(round, course) {
  const res = checkRules(round, course, TIGER5);
  const by = Object.fromEntries(res.map((r) => [r.id, r.holes.length]));
  return { by, total: res.reduce((a, r) => a + r.holes.length, 0), res };
}

/** [{id, label, how, holes:[1-based]}] for one round. */
export function checkRules(round, course, ids = DEFAULT_RULES) {
  return ids.filter((id) => RULES[id]).map((id) => {
    const r = RULES[id];
    const holes = [];
    round.holes.forEach((h, i) => { if (h && h.score != null && r.check(h, course.holes[i]?.par ?? 4, course.holes[i]?.yds)) holes.push(i + 1); });
    return { id, label: r.label, how: r.how, holes };
  });
}

export function rulesCard(results, esc) {
  const broken = results.reduce((a, r) => a + r.holes.length, 0);
  return `<div class="card"><div class="sechead" style="margin:0 0 8px"><h2 style="margin:0">Your round rules</h2><span class="${broken ? 'bad' : 'goodc'}">${broken ? `${broken} broken` : 'All kept ✓'}</span></div>
    ${results.map((r) => `<div class="rule"><span class="${r.holes.length ? 'x' : 'ok'}">${r.holes.length ? '✕' : '✓'}</span><div><b>${esc(r.label)}</b>${r.holes.length ? `<div class="mute small">Hole${r.holes.length > 1 ? 's' : ''} ${r.holes.join(', ')}</div>` : ''}${r.how ? `<div class="mute small">${esc(r.how)}</div>` : ''}</div></div>`).join('')}</div>`;
}

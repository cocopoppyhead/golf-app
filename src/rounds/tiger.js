// "Tiger 5" style round rules, checked automatically from the hole log.
// Each rule returns the holes that broke it. Some rules rely on your tags (noted in `how`).
const isBogeyPlus = (h, par) => h && h.score != null && h.score > par;
const tagged = (h, pred) => (h?.tags || []).some((t) => t.cost && pred(t));

export const RULES = {
  noDoubles:   { label: 'No double bogeys', check: (h, par) => h?.score - par >= 2 },
  noBogeyPar5: { label: 'No bogeys on par 5s', check: (h, par) => par === 5 && isBogeyPlus(h, par) },
  noShortBogey:{ label: 'No bogeys inside 150 yards', how: 'from your tags (APP/CHP/BNK/PT shot)', check: (h, par) => isBogeyPlus(h, par) && tagged(h, (t) => ['APP', 'CHP', 'BNK', 'PT'].includes(t.shot)) },
  no3Putts:    { label: 'No 3-putts', check: (h) => h?.putts >= 3 },
  noDoubleChip:{ label: 'No double chips (1 chip, 1 putt)', how: 'missed green and 2+ shots to get on', check: (h, par) => {
    if (!h || h.score == null || h.putts == null) return false;
    const toGreen = h.score - h.putts; // strokes before first putt
    return toGreen - (par - 2) >= 2;
  } },
  noFwBunker:  { label: 'No fairway bunkers off the tee (use 3 wood)', how: 'from your tags (DRV/TEE → BNK)', check: (h) => tagged(h, (t) => ['DRV', 'TEE'].includes(t.shot) && t.result === 'BNK') },
  noTeeErrors: { label: 'No unforced errors from tee shots', how: 'tee shot into trouble, or a TAC/FOC tag on DRV/TEE', check: (h, par) => par >= 4 && (h?.tee === 'LT' || h?.tee === 'RT' || tagged(h, (t) => ['DRV', 'TEE'].includes(t.shot) && ['TAC', 'FOC'].includes(t.cause))) },
};

export const DEFAULT_RULES = ['noDoubles', 'noBogeyPar5', 'noShortBogey', 'no3Putts', 'noDoubleChip'];

/** [{id, label, how, holes:[1-based]}] for one round. */
export function checkRules(round, course, ids = DEFAULT_RULES) {
  return ids.filter((id) => RULES[id]).map((id) => {
    const r = RULES[id];
    const holes = [];
    round.holes.forEach((h, i) => { if (h && h.score != null && r.check(h, course.holes[i]?.par ?? 4)) holes.push(i + 1); });
    return { id, label: r.label, how: r.how, holes };
  });
}

export function rulesCard(results, esc) {
  const broken = results.reduce((a, r) => a + r.holes.length, 0);
  return `<div class="card"><div class="sechead" style="margin:0 0 8px"><h2 style="margin:0">Your round rules</h2><span class="${broken ? 'bad' : 'goodc'}">${broken ? `${broken} broken` : 'All kept ✓'}</span></div>
    ${results.map((r) => `<div class="rule"><span class="${r.holes.length ? 'x' : 'ok'}">${r.holes.length ? '✕' : '✓'}</span><div><b>${esc(r.label)}</b>${r.holes.length ? `<div class="mute small">Hole${r.holes.length > 1 ? 's' : ''} ${r.holes.join(', ')}</div>` : ''}${r.how ? `<div class="mute small">${esc(r.how)}</div>` : ''}</div></div>`).join('')}</div>`;
}

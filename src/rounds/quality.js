// Which rounds feed Progress (the radar, averages, every section). A round counts automatically when it
// was finished, wasn't marked "don't count" and looks whole: at least 9 holes scored, no holes skipped
// in the middle, no impossible hole scores. Anything else is left out until the golfer says otherwise;
// round.countPick (true / false) is the golfer's own call and always wins over the automatic check.

const MIN_HOLES = 9;

/** What looks wrong with a round, as short phrases. Empty = looks whole. */
export function roundIssues(r, c) {
  if (!r || r.quick) return []; // a posted total: nothing hole-by-hole to check
  const out = [];
  if (!r.finished) out.push('never finished');
  const holes = r.holes || [];
  const scored = holes.map((h, i) => (h?.score != null ? i : -1)).filter((i) => i >= 0);
  if (scored.length < MIN_HOLES) out.push(`${scored.length} hole${scored.length === 1 ? '' : 's'} scored`);
  if (scored.length) {
    const first = scored[0], last = scored[scored.length - 1];
    const gaps = [];
    for (let i = first; i <= last; i++) if (holes[i]?.score == null) gaps.push(i + 1);
    if (gaps.length) out.push(`hole${gaps.length > 1 ? 's' : ''} ${listHoles(gaps)} not scored`);
  }
  const odd = [];
  holes.forEach((h, i) => {
    if (h?.score == null) return;
    const par = c?.holes?.[i]?.par || 4;
    if (h.score < 1 || (h.putts > 0 && h.score <= h.putts) || h.score > par + 6) odd.push(i + 1); // more putts than strokes, or a snowman-plus
  });
  if (odd.length) out.push(`odd score on ${listHoles(odd)}`);
  return out;
}

const listHoles = (a) => (a.length > 4 ? `${a.slice(0, 3).join(', ')} and ${a.length - 3} more` : a.join(', '));

/** Does this round feed Progress? */
export function counts(r, c) {
  if (r?.countPick === true || r?.countPick === false) return r.countPick;
  return !!r?.finished && r.learning !== false && roundIssues(r, c).length === 0;
}

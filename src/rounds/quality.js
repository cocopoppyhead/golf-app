// Which rounds feed Progress (the radar, averages, every section). A round counts automatically when it
// was finished, wasn't marked "don't count" and looks whole: at least 9 holes scored, no holes skipped
// in the middle, no impossible hole scores. Anything else is left out until the golfer says otherwise;
// round.countPick (true / false) is the golfer's own call and always wins over the automatic check.

import { holeSG } from './sg.js';

const MIN_HOLES = 9;

/** Holes where shots were logged but they don't add up to the score with the putts (a shot missed, or putts not entered). */
export function missingShots(r, c) {
  let tracked = 0, missing = 0;
  (r?.holes || []).forEach((h, i) => {
    if (h?.score == null || !h.shots?.length) return;
    tracked++;
    const ch = c?.holes?.[i] || {};
    if (!holeSG(h, ch.par || 4, ch.yds)?.complete) missing++;
  });
  return { tracked, missing };
}

/** A note on a round that still counts: holes with shots missing (left out of strokes gained only). */
export function roundNotes(r, c) {
  const { missing } = missingShots(r, c);
  return missing ? [`${missing} hole${missing > 1 ? 's' : ''} missing shots`] : [];
}

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
  // most of the tracked holes don't add up: the tracking went wrong, so the round's shots can't be trusted
  const { tracked, missing } = missingShots(r, c);
  if (tracked >= 3 && missing > tracked / 2) out.push(`${missing} of ${tracked} tracked holes missing shots`);
  return out;
}

const listHoles = (a) => (a.length > 4 ? `${a.slice(0, 3).join(', ')} and ${a.length - 3} more` : a.join(', '));

/** Does this round feed Progress? */
export function counts(r, c) {
  if (r?.countPick === true || r?.countPick === false) return r.countPick;
  return !!r?.finished && r.learning !== false && roundIssues(r, c).length === 0;
}

import { describe, it, expect } from 'vitest';
import { roundIssues, counts, roundNotes, missingShots } from '../../src/rounds/quality.js';

const c = { holes: Array.from({ length: 18 }, () => ({ par: 4 })) };
const r = (scores, extra = {}) => ({ finished: true, holes: c.holes.map((_, i) => (scores[i] == null ? null : { score: scores[i], putts: 2 })), ...extra });
const full = Array(18).fill(5);

describe('which rounds count', () => {
  it('counts a whole round, and a front or back nine', () => {
    expect(roundIssues(r(full), c)).toEqual([]); expect(counts(r(full), c)).toBe(true);
    expect(counts(r([...Array(9).fill(5)]), c)).toBe(true);
    expect(counts(r([...Array(9).fill(null), ...Array(9).fill(5)]), c)).toBe(true);
  });
  it('leaves out short, gappy, odd and unfinished rounds', () => {
    expect(roundIssues(r([5, 5, 5]), c)).toEqual(['3 holes scored']);
    const gap = [...full]; gap[4] = null; gap[11] = null;
    expect(roundIssues(r(gap), c)).toEqual(['holes 5, 12 not scored']);
    const odd = [...full]; odd[2] = 2; odd[7] = 11; // 2 strokes with 2 putts; 11 on a par 4
    expect(roundIssues(r(odd), c)).toEqual(['odd score on 3, 8']);
    expect(roundIssues(r(full, { finished: false }), c)).toEqual(['never finished']);
    expect(counts(r(gap), c)).toBe(false);
  });
  it("follows the golfer's own call either way", () => {
    expect(counts(r([5, 5, 5], { countPick: true }), c)).toBe(true);
    expect(counts(r(full, { countPick: false }), c)).toBe(false);
    expect(counts(r(full, { learning: false }), c)).toBe(false);
    expect(counts({ quick: true, finished: true, holes: [] }, c)).toBe(true);
  });
  it('spots holes whose shots do not add up to the score', () => {
    // score 4, 2 putts: two full shots add up; one shot means a shot was missed
    const ok = { score: 4, putts: 2, firstPutt: 10, shots: [{ lie: 'tee', dist: 400 }, { lie: 'fw', dist: 150 }] };
    const short = { score: 4, putts: 2, firstPutt: 10, shots: [{ lie: 'tee', dist: 400 }] };
    const some = r(full); some.holes[0] = ok; some.holes[1] = short;
    expect(missingShots(some, c)).toEqual({ tracked: 2, missing: 1 });
    expect(roundNotes(some, c)).toEqual(['1 hole missing shots']);
    expect(counts(some, c)).toBe(true); // still counts: one bad hole
    const most = r(full); most.holes[0] = ok; [1, 2, 3].forEach((i) => { most.holes[i] = short; });
    expect(roundIssues(most, c)).toEqual(['3 of 4 tracked holes missing shots']);
    expect(counts(most, c)).toBe(false);
    expect(missingShots(r(full), c)).toEqual({ tracked: 0, missing: 0 }); // score-only holes are not 'missing'
  });
});

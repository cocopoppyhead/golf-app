import { describe, it, expect } from 'vitest';
import { differential, courseHandicap, adjustedGross, indexFrom, indexHistory } from '../../src/rounds/handicap.js';

describe('handicap (WHS)', () => {
  it('score differential = 113/slope × (AGS − CR), to 0.1', () => {
    expect(differential(90, 72.0, 130)).toBeCloseTo(15.6, 5);
    expect(differential(85, 73.1, 138)).toBeCloseTo(9.7, 5);
    expect(differential(null, 72, 130)).toBeNull();
    expect(differential(90, 72, 0)).toBeNull();
  });
  it('course handicap = index × slope/113 + (CR − par), rounded', () => {
    expect(courseHandicap(12.4, 73.1, 138, 72)).toBe(16);
    expect(courseHandicap(0, 70.0, 113, 72)).toBe(-2);
  });
  it('index uses the best-of table (Rule 5.2a)', () => {
    expect(indexFrom([10, 12])).toBeNull();
    expect(indexFrom([10, 12, 14]).index).toBeCloseTo(8.0); // lowest 1 − 2
    expect(indexFrom([10, 12, 14, 16]).index).toBeCloseTo(9.0); // lowest 1 − 1
    expect(indexFrom([10, 12, 14, 16, 18]).index).toBeCloseTo(10.0); // lowest 1
    expect(indexFrom([10, 12, 14, 16, 18, 20]).index).toBeCloseTo(10.0); // avg lowest 2 − 1
    const twenty = Array.from({ length: 20 }, (_, i) => 20 - i * 0.5); // 20 … 10.5
    const r = indexFrom(twenty);
    expect(r.of).toBe(20); expect(r.counted.length).toBe(8);
    expect(r.index).toBe(12.3); // mean of the best 8 is 12.25, shown to a tenth
    expect(indexFrom([...twenty, 1, 1, 1]).index).toBe(r.index); // only the last 20 count
  });
  it('adjusted gross caps each hole at net double bogey', () => {
    const course = { rating: 72, slope: 113, holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 })) };
    const round = { holes: course.holes.map(() => ({ score: 4 })) };
    round.holes[0].score = 10; // SI 1: with an 18 index you get 1 stroke → cap at 4 + 2 + 1 = 7
    round.holes[17].score = 9; // SI 18: also 1 stroke at index 18 → cap 7
    expect(adjustedGross(round, course, 18)).toBe(16 * 4 + 7 + 7);
    expect(adjustedGross(round, course, 0)).toBe(16 * 4 + 6 + 6); // scratch: cap at double bogey
    expect(adjustedGross({ quick: true, score: 88 }, course, 10)).toBe(88);
  });
  it('index history walks forward through the rounds', () => {
    const entries = [1, 2, 3, 4, 5].map((d) => ({ date: d, diff: 10 + d }));
    const h = indexHistory(entries);
    expect(h.history.map((x) => x.index)).toEqual([null, null, 9.0, 10.0, 11.0]);
    expect(h.current.index).toBe(11.0);
    expect(h.low.index).toBe(9.0);
  });
});

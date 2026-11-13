import { describe, it, expect } from 'vitest';
import { levelText, ownNumbers } from '../../src/coach/level.js';
import { benchFor, targetHcp } from '../../src/benchmarks.js';

const course = { holes: Array.from({ length: 18 }, (_, i) => ({ par: [4, 4, 3, 5][i % 4], yds: 400 })) };
const rcs = Array.from({ length: 4 }, (_, k) => ({ r: { id: `r${k}`, holes: course.holes.map((ch) => ({ score: ch.par + 1, putts: 2, puttList: [{ ft: 7, holed: false }, { ft: 1, holed: true }] })) }, c: course }));

describe('the golfer against their level and target', () => {
  it('a 6 aims at scratch and is compared with both', () => {
    expect(targetHcp(6)).toBe(0);
    const t = levelText(rcs, 6);
    expect(t).toMatch(/Par 5s: them 6\.0; a 6-handicap [\d.]+; scratch 4\.8\./);
    expect(t).toMatch(/Putts holed by length \(a 6-handicap \/ scratch \/ them\): 0-3 ft 96% \/ 98% \/ 100% \(\d+\)/);
    expect(t).toMatch(/6-9 ft [\d]+% \/ 49% \/ 0% \(\d+\)/);
    expect(t).toMatch(/Arccos/);
  });
  it('says when their own data is thin instead of inventing it', () => {
    expect(levelText(rcs.slice(0, 0), 10)).toMatch(/Par 3s, average score: not enough of their own data yet; a 10-handicap 3\.7; a 5-handicap 3\.4\./);
  });
  it('no handicap, no comparison', () => { expect(levelText(rcs, null)).toBe(''); });
  it('the dataset covers the new rows at every level', () => {
    for (const h of [0, 5, 10, 15, 20, 25]) for (const k of ['par3', 'par5', 'sandSave', 'make3to6', 'prox100to150', 'threePuttRate']) expect(benchFor(h)[k]).toBeGreaterThan(0);
    expect(ownNumbers(rcs).par5).toBe(6);
  });
});

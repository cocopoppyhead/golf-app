import { describe, it, expect } from 'vitest';
import { bestCandidates, lastBestHere } from '../../src/rounds/bestshots.js';

const c = { holes: [{ par: 4, yds: 400 }, { par: 3, yds: 160 }] };
const round = { holes: [
  { score: 4, putts: 2, firstPutt: 12, shots: [{ lie: 'tee', dist: 400, res: 'FW', d: { club: 'Driver', sat: 5 } }, { lie: 'fw', dist: 150, res: 'G', d: { club: '7 iron', sat: 3 } }] },
  { score: 2, putts: 0, shots: [{ lie: 'tee', dist: 160, res: 'HO', d: { club: '6 iron' } }] },
] };

describe('three best shots', () => {
  it('offers the shots you starred, holed shots, then strokes gained', () => {
    const C = bestCandidates(round, c);
    expect(C[0]).toMatchObject({ h: 0, k: 0, stars: 5, club: 'Driver' });
    expect(C.some((x) => x.h === 1 && x.res === 'HO')).toBe(true);
    expect(C.some((x) => x.h === 0 && x.k === 1 && x.stars === 3 && !(x.sg > 0.15))).toBe(false);
  });
  it('brings back the latest best shots with notes on the same course', () => {
    const rs = [
      { id: 'a', courseId: 'c', date: 1, best: [{ h: 0, k: 0, note: 'old' }] },
      { id: 'b', courseId: 'c', date: 2, best: [{ h: 3, k: 1, note: 'smooth, saw it fade' }, { h: 5, k: 0, note: '' }] },
      { id: 'x', courseId: 'other', date: 3, best: [{ h: 1, k: 0, note: 'elsewhere' }] },
    ];
    expect(lastBestHere(rs, 'c', 'now').map((b) => b.note)).toEqual(['smooth, saw it fade']);
  });
});

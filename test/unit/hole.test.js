import { describe, it, expect } from 'vitest';
import { blankHole, ensureShots, defaultLie, derive, autoSwing, autoShotType, nextBogeyFrom } from '../../src/rounds/hole.js';

describe('hole model', () => {
  it('builds the shot panels from par, or from score − putts', () => {
    const h = blankHole(); ensureShots(h, 4, 410);
    expect(h.shots.length).toBe(2); expect(h.shots[0]).toMatchObject({ lie: 'tee', dist: 410 });
    const g = { ...blankHole(), score: 6, putts: 2 }; ensureShots(g, 4, 410);
    expect(g.shots.length).toBe(4);
    const p3 = blankHole(); ensureShots(p3, 3, 160); expect(p3.shots.length).toBe(1);
  });
  it('suggests the next lie from where the last shot ended', () => {
    const h = blankHole(); ensureShots(h, 4, 400); h.shots[0].res = 'LR';
    expect(defaultLie(h, 1)).toBe('rgh');
    h.shots[0].res = 'FW'; expect(defaultLie(h, 1)).toBe('fw');
    h.shots[0].res2 = 'FB'; expect(defaultLie(h, 1)).toBe('fbk');
    h.shots[1].res = 'BK'; expect(defaultLie(h, 2)).toBe('bnk');
  });
  it('derives score, fairway, approach miss, bunkers and tags', () => {
    const h = blankHole(); ensureShots(h, 4, 400);
    h.shots[0].res = 'FW'; h.shots[1] = { lie: 'fw', dist: 150, res: 'BK', dir: 'R', d: { club: '7 iron', cause: 'SWE', cost: 1 } }; h.shots.push({ lie: 'bnk', dist: 20, res: 'G' }); h.putts = 2;
    derive(h, 4);
    expect(h.score).toBe(5); expect(h.tee).toBe('FW'); expect(h.miss).toBe('R'); expect(h.bunker).toBe(true);
    expect(h.tags).toEqual([{ shot: 'APP', cause: 'SWE', flight: null, strike: null, result: null, cost: 1 }]);
    h.shots[1].pen = true; derive(h, 4); expect(h.score).toBe(6);
  });
  it('guesses swing and shot type', () => {
    expect(autoSwing({ dist: 20, lie: 'fw' }, 1)).toBe('chip');
    expect(autoSwing({ dist: 60, lie: 'fw' }, 1)).toBe('pitch');
    expect(autoSwing({ dist: 40, lie: 'bnk' }, 1)).toBe('splash');
    expect(autoSwing({ dist: 150, lie: 'rec' }, 1)).toBe('punch');
    expect(autoShotType({ d: { club: 'Driver' } }, 0, 4)).toBe('DRV');
    expect(autoShotType({ d: { club: '3 wood' } }, 0, 5)).toBe('TEE');
    expect(autoShotType({ dist: 180, lie: 'fw' }, 1, 4)).toBe('IRN');
    expect(autoShotType({ dist: 120, lie: 'fw' }, 1, 4)).toBe('APP');
    expect(autoShotType({ dist: 15, lie: 'bnk' }, 2, 4)).toBe('BKR');
  });
  it('finds the next bogey', () => {
    const course = { holes: [{ par: 4 }, { par: 4 }, { par: 3 }, { par: 5 }] };
    const round = { holes: [{ score: 5 }, { score: 4 }, { score: 4 }, { score: 5 }] };
    expect(nextBogeyFrom(round, course, 0)).toBe(2);
    expect(nextBogeyFrom(round, course, 2)).toBe(-1);
  });
});

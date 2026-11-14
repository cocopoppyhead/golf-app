import { describe, it, expect } from 'vitest';
import { needsCheck, scoreGuess, applyScore, applyNoScore } from '../../src/rounds/scorecheck.js';

describe('score check', () => {
  it('asks unless the putts are logged to the hole or the score was confirmed', () => {
    expect(needsCheck(null)).toBe(true);
    expect(needsCheck({ shots: [{}], score: null })).toBe(true);
    expect(needsCheck({ shots: [{}, {}], score: 4, putts: 2, puttsAuto: true })).toBe(true); // assumed 2 putts
    expect(needsCheck({ shots: [{}, {}], score: 4, putts: 2 })).toBe(false);
    expect(needsCheck({ shots: [{}], score: 5, scoreConfirmed: true })).toBe(false);
  });
  it('starts from what is known', () => {
    expect(scoreGuess({ shots: [{ res: 'FW' }, { res: 'G' }] }, 4)).toBe(4); // on the green in 2: two putts
    expect(scoreGuess({ shots: [{ res: 'FW' }, { res: 'HO' }] }, 4)).toBe(2);
    expect(scoreGuess({ shots: [{ res: 'FW' }] }, 4)).toBe(4); // still playing: par
    expect(scoreGuess({ shots: [{ res: 'RR' }, { res: 'TR' }, { res: 'RR' }, { res: 'GS' }] }, 4)).toBe(5);
    expect(scoreGuess({ shots: [{}], score: 6 }, 4)).toBe(6);
  });
  it('on the green the putts follow from the score; off it the score stands alone', () => {
    const a = { shots: [{ res: 'FW' }, { res: 'G' }], putts: 2, puttsAuto: true };
    applyScore(a, 5); expect(a).toMatchObject({ score: 5, putts: 3, scoreConfirmed: true }); expect(a.puttsAuto).toBeUndefined();
    const b = { shots: [{ res: 'FW' }] };
    applyScore(b, 4); expect(b.score).toBe(4); expect(b.putts).toBeUndefined();
  });
  it('no score (n/a): the hole is played, shown as a hyphen, and not asked about again', () => {
    const h = { shots: [{ res: 'FW' }, { res: 'G' }], putts: 2, puttsAuto: true, score: 4 };
    applyNoScore(h); expect(h).toMatchObject({ score: null, putts: null, pickup: true }); expect(needsCheck(h)).toBe(false);
    applyScore(h, 5); expect(h.pickup).toBeUndefined();
  });
});

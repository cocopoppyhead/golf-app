import { describe, it, expect } from 'vitest';
import { expected, holeSG } from '../../src/rounds/sg.js';
import { roundStats, isGir } from '../../src/rounds/stats.js';

describe('strokes gained', () => {
  it('expected strokes interpolate the Broadie tables', () => {
    expect(expected('fw', 100)).toBeCloseTo(2.8, 5);
    expect(expected('fw', 110)).toBeCloseTo(2.825, 5);
    expect(expected('grn', 8)).toBeCloseTo(1.5, 5);
    expect(expected('tee', 1000)).toBeCloseTo(4.82, 5); // beyond the table: last value
    expect(expected('fw', null)).toBeNull();
  });
  it('a hole is scored shot by shot against the baseline', () => {
    // 400-yd par 4: drive to 150 fairway, approach to 8 ft, one putt = birdie 3
    const h = { score: 3, putts: 1, firstPutt: 8, shots: [{ lie: 'tee' }, { lie: 'fw', dist: 150 }] };
    const r = holeSG(h, 4, 400);
    expect(r.complete).toBe(true);
    expect(r.ott).toBeCloseTo(expected('tee', 400) - expected('fw', 150) - 1, 5);
    expect(r.app).toBeCloseTo(expected('fw', 150) - expected('grn', 8) - 1, 5);
    expect(r.putt).toBeCloseTo(expected('grn', 8) - 1, 5);
    expect(r.total).toBeCloseTo(expected('tee', 400) - 3, 5); // all of it: baseline minus strokes taken
  });
  it('a penalty costs one more, and a missing putt distance leaves the hole incomplete', () => {
    const r = holeSG({ score: 5, putts: 2, firstPutt: 20, shots: [{ lie: 'tee', pen: true }, { lie: 'fw', dist: 150 }] }, 4, 400);
    expect(r.complete).toBe(true);
    expect(r.ott).toBeCloseTo(expected('tee', 400) - expected('fw', 150) - 2, 5);
    expect(holeSG({ score: 4, putts: 2, shots: [{ lie: 'tee' }, { lie: 'fw', dist: 150 }] }, 4, 400).complete).toBe(false);
  });
});

describe('round stats', () => {
  const course = { holes: [{ par: 4 }, { par: 3 }, { par: 5 }, { par: 4 }] };
  it('adds up scores, putts, GIR and the scoring mix', () => {
    const round = { holes: [
      { score: 4, putts: 2, tee: 'FW' }, // par, GIR (2 to the green on a par 3? no: par 4, 4−2 = 2 ≤ 2 ✓)
      { score: 4, putts: 2, miss: 'S' }, // bogey, missed green short
      { score: 4, putts: 1, tee: 'LR' }, // birdie
      null,
    ] };
    const S = roundStats(round, course);
    expect(S.holes).toBe(3); expect(S.score).toBe(12); expect(S.par).toBe(12); expect(S.toPar).toBe(0);
    expect(S.putts).toBe(5); expect(S.birdies).toBe(1); expect(S.pars).toBe(1); expect(S.bogeys).toBe(1);
    expect(S.firOpp).toBe(2); expect(S.fir).toBe(1);
    expect(S.gir).toBe(2); expect(S.girOpp).toBe(3); expect(S.miss.S).toBe(1);
  });
  it('posted scores carry only totals', () => {
    const S = roundStats({ quick: true, score: 80, putts: 30, holesPlayed: 4 }, course);
    expect(S.quick).toBe(true); expect(S.score).toBe(80); expect(S.par).toBe(16); expect(S.putts).toBe(30); expect(S.holes).toBe(4);
  });
  it('GIR from score and putts when not logged', () => {
    expect(isGir({ score: 4, putts: 2 }, 4)).toBe(true);
    expect(isGir({ score: 4, putts: 1 }, 4)).toBe(false);
    expect(isGir({ gir: false, score: 4, putts: 2 }, 4)).toBe(false);
    expect(isGir({ score: 4 }, 4)).toBeNull();
  });
});

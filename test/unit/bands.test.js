import { describe, it, expect } from 'vitest';
import { approachBands, executionSummary, inBand, bandLabel } from '../../src/rounds/bands.js';
import { asPlanned } from '../../src/rounds/hole.js';
import { roundStats, aggregate, roundTendencies, roundSummaryText } from '../../src/rounds/stats.js';

const course = { holes: Array.from({ length: 18 }, (_, i) => ({ par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, yds: 400 })) };
// a hole with one approach from `from` yards: hit → first putt `fp` ft; miss → ends in `res`
const hole = (par, from, { fp = null, res = 'G', putts = 2, plan = null, sat = null, lies = [], fpLong = null, fpSide = null } = {}) => {
  const shots = par === 3 ? [{ lie: 'tee', dist: from, res, d: { plan, sat, lies } }] : [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: from, res, d: { plan, sat, lies } }];
  if (res !== 'G') shots.push({ lie: 'rgh', dist: 15, res: 'G' });
  return { score: shots.length + putts, putts, firstPutt: fp, shots, tags: [], fpLong, fpSide };
};

describe('approachBands', () => {
  it('ranks bands by strokes to finish and names the best lay-up band', () => {
    const holes = [];
    for (let i = 0; i < 18; i++) {
      const par = course.holes[i].par;
      // 75–100: always on, close. 125–150: half missed. 50–75: on but far away.
      if (i % 3 === 0) holes.push(hole(par, 90, { fp: 6 }));
      else if (i % 3 === 1) holes.push(hole(par, 140, i % 2 ? { fp: 20 } : { res: 'RG' }));
      else holes.push(hole(par, 60, { fp: 30 }));
    }
    const B = approachBands([{ r: { holes }, c: course }]);
    expect(B.total).toBe(18);
    expect(bandLabel(B.best.band)).toBe('75–100');
    expect(B.best.gir).toBe(1);
    expect(B.best.prox).toBe(6);
    const b140 = B.bands.find((b) => b.label === '125–150');
    expect(b140.gir).toBeCloseTo(0.5, 1);
    expect(b140.finish).toBeGreaterThan(B.best.finish);
    expect(B.worst.label === '125–150' || B.worst.label === '50–75').toBe(true);
    expect(inBand(85, B.best.band)).toBe(true);
    expect(inBand(100, B.best.band)).toBe(false);
  });

  it('ignores lay-ups, penalties and par-4 tee shots; needs 5 shots to count a band', () => {
    const holes = [
      { score: 5, putts: 2, firstPutt: 10, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 230, res: 'FW' }, { lie: 'fw', dist: 95, res: 'G' }], tags: [] },
      { score: 6, putts: 2, firstPutt: 10, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 160, res: 'PN', pen: true }, { lie: 'rgh', dist: 60, res: 'G' }], tags: [] },
    ];
    const B = approachBands([{ r: { holes }, c: course }]);
    expect(B.total).toBe(2); // 95 and 60; the 230 lay-up, the penalty shot and the tee shots don't count
    expect(B.best).toBeNull();
    expect(B.bands.every((b) => !b.enough)).toBe(true);
  });

  it('asPlanned reads Details, else planned shape vs logged flight', () => {
    expect(asPlanned({ intent: 'D', d: { flight: 'DRW' } })).toBe(true);
    expect(asPlanned({ intent: 'D', d: { flight: 'STR' } })).toBe(false);
    expect(asPlanned({ intent: 'D', d: { flight: 'STR', plan: true } })).toBe(true);
    expect(asPlanned({ intent: 'D' })).toBeNull();
  });

  it('execution summary and tendencies from Details and first-putt position', () => {
    const holes = Array.from({ length: 18 }, (_, i) => hole(course.holes[i].par, 150, { fp: 20, plan: i % 4 === 0, sat: 2, lies: i % 2 ? ['blw'] : [], fpLong: 'S', fpSide: i % 2 ? 'LF' : 'C' }));
    const r = { holes };
    const E = executionSummary([{ r, c: course }]);
    expect(E.planned).toBeCloseTo(5 / 18, 2);
    expect(E.sat).toBe(2);
    const S = roundStats(r, course);
    expect(S.planN).toBe(18); expect(S.fpN).toBe(18); expect(S.fp.S).toBe(18); expect(S.byLie.blw.n).toBe(9);
    const A = aggregate([{ round: r, course, stats: S }]);
    const T = roundTendencies(A);
    expect(T.find((t) => t.key === 'fp-S')).toBeTruthy();
    expect(T.find((t) => t.key === 'lie-blw')).toBeTruthy();
    expect(T.find((t) => t.key === 'plan')).toBeTruthy();
    expect(roundSummaryText(A)).toMatch(/first putts vs flag: 18 short/);
    expect(roundSummaryText(A)).toMatch(/Ball-below-feet/);
  });
});

import { shotCue } from '../../src/rounds/ui.js';
describe('break-80 numbers and cues', () => {
  it('counts GIR+1, recovery drives, the 150–200 zone and lag three-putts', () => {
    const holes = [
      { score: 5, putts: 2, firstPutt: 25, shots: [{ lie: 'tee', dist: 400, res: 'RT' }, { lie: 'rgh', dist: 170, res: 'RG' }, { lie: 'rgh', dist: 20, res: 'G' }], tags: [] }, // bogey: dirt drive, zone approach, GIR+1 yes
      { score: 6, putts: 3, firstPutt: 30, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 180, res: 'BK' }, { lie: 'bnk', dist: 15, res: 'G' }], tags: [] }, // double from the zone; lag 3-putt
      { score: 4, putts: 2, firstPutt: 10, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 140, res: 'G' }], tags: [] },
    ];
    const S = roundStats({ holes }, course);
    expect(S.gir1Opp).toBe(3); expect(S.gir1).toBe(3);
    expect(S.dirt).toBe(1);
    expect(S.zone).toBe(2); expect(S.zoneDbl).toBe(1);
    expect(S.lagOpp).toBe(2); expect(S.lag3).toBe(1);
  });
  it('gives a cue for the shot in hand by distance, none inside 100', () => {
    expect(shotCue({ shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 210 }] }, 4, 400)).toMatch(/double/);
    expect(shotCue({ shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'rgh', dist: 175 }] }, 4, 400)).toMatch(/rough: take enough club/);
    expect(shotCue({ shots: [{ lie: 'tee', dist: 165 }] }, 3, 165)).toMatch(/fat side/);
    expect(shotCue({ shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 90 }] }, 4, 400)).toBe('');
    expect(shotCue({ shots: [{ lie: 'tee', dist: 400 }] }, 4, 400)).toBe(''); // tee shot on a par 4: the map does the talking
  });
});

import { describe, it, expect } from 'vitest';
import { wbgt, heatBand, holeTimes, holeHeat, heatByHole, realStart } from '../../src/heat.js';

const t0 = Date.parse('2026-06-20T01:30:00Z');
const trace = [0, 1, 2, 3, 4, 5].map((k) => ({ t: Date.parse('2026-06-20T01:00:00Z') + k * 3600e3, tempC: 30 + k * 2, rh: 30, wbgt: wbgt(30 + k * 2, 30) }));
const c = { holes: Array.from({ length: 18 }, () => ({ par: 4 })) };
describe('heat through the round', () => {
  it('estimates WBGT and bands it like the sport heat policies', () => {
    expect(wbgt(39, 37)).toBeCloseTo(36.2, 0);
    expect(heatBand(19).key).toBe('low'); expect(heatBand(24).key).toBe('moderate'); expect(heatBand(28).key).toBe('high'); expect(heatBand(31).key).toBe('extreme');
  });
  it('never invents hole times for a posted score', () => {
    const r = { source: 'ghin', date: t0, holes: c.holes.map(() => ({ score: 4 })) };
    expect(realStart(r)).toBe(false);
    expect(holeTimes(r).every((x) => x == null)).toBe(true);
  });
  it('spreads holes between a real start and finish, marked as estimates, and uses logged times first', () => {
    const r = { source: 'garmin', date: t0, garmin: { durationMin: 270 }, holes: c.holes.map((_, i) => ({ score: 4, ...(i === 0 ? { at: t0 + 5 * 60e3 } : {}) })) };
    const T = holeTimes(r);
    expect(T[0]).toEqual({ t: t0 + 5 * 60e3, est: false });
    expect(T[17].est).toBe(true); expect(T[17].t).toBeGreaterThan(T[9].t);
  });
  it('scores each hole in the heat it was played in', () => {
    const r = { source: 'garmin', date: t0, garmin: { durationMin: 270 }, holes: c.holes.map((_, i) => ({ score: i < 12 ? 4 : 6 })), heat: { trace } };
    const hh = holeHeat(r);
    expect(hh[17].wbgt).toBeGreaterThan(hh[0].wbgt);
    const B = heatByHole([{ r, c }]);
    const hot = B.find((b) => b.key === 'extreme'), cool = B.find((b) => b.key !== 'extreme');
    expect(hot.toPar).toBeGreaterThan(cool.toPar);
  });
});

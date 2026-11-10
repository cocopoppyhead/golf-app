import { describe, it, expect } from 'vitest';
import { detectHole, playsFrom, shotSlot } from '../../src/rounds/laserloop.js';

describe('laser loop', () => {
  const geo = null;
  // two holes marked by hand: hole 1 tee → green north; hole 2 tee 60 m east of green 1
  const course = { holes: [
    { mark: { tee: [25.0000, 55.0000], green: [25.0036, 55.0000] } },
    { mark: { tee: [25.0036, 55.0006], green: [25.0072, 55.0006] } },
  ] };
  it('advances the hole when you are at the next tee and off the current line', () => {
    expect(detectHole({ lat: 25.0018, lon: 55.0000, acc: 8 }, course, geo, 0)).toBe(0); // mid hole 1
    expect(detectHole({ lat: 25.0036, lon: 55.0006, acc: 8 }, course, geo, 0)).toBe(1); // on hole 2's tee
    expect(detectHole({ lat: 25.0036, lon: 55.0006, acc: 80 }, course, geo, 0)).toBe(0); // poor fix: stay
    expect(detectHole({ lat: 25.0072, lon: 55.0006, acc: 8 }, course, geo, 1)).toBe(1); // last hole: nowhere to go
  });
  it('plays-like uses the laser slope figure when it differs, then wind and temperature', () => {
    const flat = playsFrom({ raw: 150, playsAs: 150 }, null);
    expect(flat.plays).toBe(150); expect(flat.slope).toBe(150);
    const up = playsFrom({ raw: 150, playsAs: 158 }, null);
    expect(up.slope).toBe(158); expect(up.plays).toBe(158);
    const hot = playsFrom({ raw: 150, playsAs: 150 }, { tempC: 40, humidity: 30, pressure: 1010, windMph: 0, windDeg: 0 });
    expect(hot.plays).toBeLessThan(150);
  });
  it('files a read to the right shot', () => {
    const now = Date.now();
    const h = { shots: [{ lie: 'tee', dist: 400 }, { lie: 'fw', dist: null }] };
    expect(shotSlot(h, { par: 4, yds: 400, raw: 395, now })).toEqual({ k: 0, target: false }); // pin from the tee ≈ card
    expect(shotSlot(h, { par: 4, yds: 400, raw: 230, onTee: true, now })).toEqual({ k: 0, target: true }); // a lay-up target
    expect(shotSlot(h, { par: 4, yds: 400, raw: 160, now })).toEqual({ k: 1, target: false }); // the approach
    expect(shotSlot({ shots: [{ lie: 'tee', dist: 165 }] }, { par: 3, yds: 165, raw: 158, now })).toEqual({ k: 0, target: false });
    const re = { shots: [{ lie: 'tee', dist: 400 }, { lie: 'fw', dist: 160, src: 'laser', t: now - 10000 }] };
    expect(shotSlot(re, { par: 4, yds: 400, raw: 155, now })).toEqual({ k: 1, target: false }); // re-laser within 45 s: same shot
    const next = { shots: [{ lie: 'tee', dist: 400 }, { lie: 'fw', dist: 160, src: 'laser', t: now - 120000 }] };
    expect(shotSlot(next, { par: 4, yds: 400, raw: 40, now })).toEqual({ k: 2, target: false }); // a new shot
  });
});

import { describe, it, expect } from 'vitest';
import { launchTakes, driverWindow } from '../../src/launchtakes.js';
import { clubSummary } from '../../src/launch.js';

// Conor's indoor-sim driver session, 8 drives kept (range balls)
const session = {
  id: 'lm1', date: Date.parse('2026-11-10'), club: 'Driver', ball: 'range', cols: ['clubSpeed', 'ballSpeed', 'smash', 'launch', 'backSpin'],
  rows: [
    { clubSpeed: 101.2, ballSpeed: 146.5, smash: 1.45, launch: 11.8, backSpin: 3620 },
    { clubSpeed: 99.4, ballSpeed: 134.2, smash: 1.35, launch: 13.1, backSpin: 3310 },
    { clubSpeed: 102.8, ballSpeed: 148.9, smash: 1.45, launch: 12.0, backSpin: 3490 },
    { clubSpeed: 98.7, ballSpeed: 138.1, smash: 1.40, launch: 12.9, backSpin: 3280 },
    { clubSpeed: 100.1, ballSpeed: 141.6, smash: 1.41, launch: 11.5, backSpin: 3710 },
    { clubSpeed: 103.6, ballSpeed: 154.4, smash: 1.49, launch: 12.4, backSpin: 3150 },
    { clubSpeed: 99.0, ballSpeed: 136.5, smash: 1.38, launch: 12.6, backSpin: 3400 },
    { clubSpeed: 100.9, ballSpeed: 132.6, smash: 1.31, launch: 12.2, backSpin: 3560 },
  ],
};

describe('launchTakes', () => {
  it('driver ~100 mph, smash 1.40 with a 1.31–1.49 spread → strike drills first', () => {
    const q = clubSummary([session], 'Driver');
    expect(q.range).toBe(true);
    const takes = launchTakes(q, 'Driver');
    expect(takes.length).toBeGreaterThan(0);
    expect(takes[0].key).toBe('smash-low');
    expect(takes[0].drills).toEqual(['foot-spray-strike-check', 'tee-height-strike-test']);
    expect(takes[0].text).toMatch(/strike, not speed/);
    // launch in the window but 3,400 spin at ~100 mph → strike, then tee height / attack angle
    const flight = takes.find((t) => t.key === 'spinny');
    expect(flight).toBeTruthy();
    expect(flight.drills).toContain('tee-height-strike-test');
    expect(flight.drills).toContain('headcover-upswing-driver');
    expect(flight.text).toMatch(/Range balls/);
  });

  it('a flush driver in the window gets the speed take, not a strike take', () => {
    const q = { n: 6, range: false, clubSpeed: { avg: 100, sd: 1, n: 6 }, smash: { avg: 1.48, sd: 0.01, n: 6 }, launch: { avg: 13.5, sd: 1, n: 6 }, backSpin: { avg: 2600, sd: 200, n: 6 } };
    const takes = launchTakes(q, 'Driver');
    expect(takes.map((t) => t.key)).toEqual(['smash-good', 'window']);
    expect(takes[0].drills).toEqual(['smooth-swing-balanced-finish-driver']);
  });

  it('spread with a decent average → repeatability, not a low-smash take', () => {
    const q = { n: 8, range: true, clubSpeed: { avg: 100, sd: 1, n: 8 }, smash: { avg: 1.44, sd: 0.06, n: 8 } };
    expect(launchTakes(q, 'Driver')[0].key).toBe('smash-spread');
  });

  it('hitting down on the driver → upswing drills', () => {
    const q = { n: 5, range: true, clubSpeed: { avg: 100, sd: 1, n: 5 }, smash: { avg: 1.47, sd: 0.01, n: 5 }, attack: { avg: -2.5, sd: 1, n: 5 } };
    const t = launchTakes(q, 'Driver').find((x) => x.key === 'down');
    expect(t.drills).toEqual(['headcover-upswing-driver', 'fix-trail-shoulder-low']);
  });

  it('irons use iron benchmarks and iron drills', () => {
    const q = { n: 6, range: false, clubSpeed: { avg: 82, sd: 1, n: 6 }, smash: { avg: 1.26, sd: 0.02, n: 6 }, launch: { avg: 9.5, sd: 1, n: 6 }, backSpin: { avg: 3500, sd: 300, n: 6 } };
    const keys = launchTakes(q, '7 iron').map((t) => t.key);
    expect(keys).toContain('smash-low');
    expect(keys).toContain('iron-low');
    expect(keys).toContain('iron-lowspin');
    expect(launchTakes(q, '7 iron')[0].drills).toEqual(['foot-spray-strike-check', 'tee-in-front-low-point-drill']);
  });

  it('too few shots or nothing measured → no takes', () => {
    expect(launchTakes(null, 'Driver')).toEqual([]);
    expect(launchTakes({ n: 2, smash: { avg: 1.2, sd: 0, n: 2 } }, 'Driver')).toEqual([]);
  });

  it('driver window shifts with club speed', () => {
    expect(driverWindow(90).launch[0]).toBeGreaterThan(driverWindow(110).launch[0]);
    expect(driverWindow(90).spin[1]).toBeGreaterThan(driverWindow(110).spin[1]);
  });
});

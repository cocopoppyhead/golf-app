import { describe, it, expect } from 'vitest';
import { simulate, predictedCarry, airDensity } from '../../src/flight.js';
import { launchTakes } from '../../src/launchtakes.js';

// TrackMan published averages (sea level, still air): ball mph, launch °, spin rpm → carry yd
const REF = [
  ['PGA driver', 167, 10.4, 2686, 275], ['LPGA driver', 140, 13.2, 2611, 218], ['male amateur driver', 132.6, 12.6, 3275, 204],
  ['PGA 7-iron', 120, 16.3, 7097, 172], ['LPGA 7-iron', 104, 19.0, 6699, 141], ['PGA 6-iron', 127, 14.1, 6231, 183], ['PGA PW', 102, 24.2, 9304, 136],
];
describe('flight model', () => {
  it.each(REF)('%s carries within 3.5%% of TrackMan', (_, bs, la, sp, carry) => {
    const r = simulate({ ballSpeed: bs, launch: la, spin: sp });
    expect(Math.abs(r.carry - carry) / carry).toBeLessThan(0.035);
    expect(r.apex).toBeGreaterThan(15); expect(r.descent).toBeGreaterThan(30); expect(r.time).toBeGreaterThan(4);
  });
  it('thin air carries further: Dubai summer and altitude both add yards', () => {
    const base = simulate({ ballSpeed: 141.6, launch: 12.3, spin: 3440 }).carry;
    expect(simulate({ ballSpeed: 141.6, launch: 12.3, spin: 3440, tempC: 40 }).carry).toBeGreaterThan(base + 4);
    expect(simulate({ ballSpeed: 141.6, launch: 12.3, spin: 3440, altitudeM: 1500 }).carry).toBeGreaterThan(base + 8);
    expect(airDensity({ tempC: 15 })).toBeCloseTo(1.225, 2);
  });
  it('rejects nonsense and predicts from a club summary', () => {
    expect(simulate({ ballSpeed: 0, launch: 12, spin: 3000 })).toBeNull();
    expect(predictedCarry({ ballSpeed: { avg: 141.6 }, launch: { avg: 12.3 }, backSpin: { avg: 3440 } })).toBeGreaterThan(205);
    expect(predictedCarry({ ballSpeed: { avg: 141.6 } })).toBeNull();
  });
  it("the take flags a bay whose carries read short of what the numbers should fly", () => {
    const q = { n: 8, range: true, clubSpeed: { avg: 100.7, sd: 1.8, n: 8 }, ballSpeed: { avg: 141.6, sd: 7, n: 8 }, smash: { avg: 1.41, sd: 0.06, n: 8 }, launch: { avg: 12.3, sd: 0.5, n: 8 }, backSpin: { avg: 3440, sd: 190, n: 8 }, carry: { avg: 185, sd: 10, n: 8 } };
    const t = launchTakes(q, 'Driver').find((x) => x.key === 'carry-short');
    expect(t).toBeTruthy(); expect(t.text).toMatch(/should carry about 2\d\d yd; the bay said 185/);
    const q2 = { ...q, carry: undefined };
    expect(launchTakes(q2, 'Driver').find((x) => x.key === 'carry-pred').text).toMatch(/premium ball carries about 2\d\d yd/);
  });
});

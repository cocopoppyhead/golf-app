import { describe, it, expect } from 'vitest';
import { readActivity, activityStamp, matchActivity } from '../../src/garmin/activity.js';
import { fitDate } from '../../src/garmin/fit.js';
import { bodyStats } from '../../src/rounds/body.js';
import { fit } from '../fixtures/garminfit.js';

const t0 = 1023966693; // 2022-06-12 11:11:33 UTC
const S = 2 ** 31 / 180;
// an activity: file_id (activity, created), a record a minute for 3 minutes, then the golf session
const act = (sport) => fit([
  [0, [[0, 'u8', 4], [4, 'u32', t0]]],
  ...[0, 30, 60, 90, 120, 150].map((s, i) => [20, [[253, 'u32', t0 + s], [0, 's32', Math.round(37.0445 * S)], [1, 's32', Math.round(-8.0164 * S)], [3, 'u8', [90, 94, 100, 104, 110, 114][i]]]]),
  [18, [[2, 'u32', t0], [7, 'u32', 180000], [5, 'u8', sport], [16, 'u8', 102], [17, 'u8', 152]]],
]);

describe('Garmin activities', () => {
  it('reads a golf activity: heart rate a minute, average, peak, where it started', () => {
    const b = act(25);
    expect(activityStamp(b)).toBe(fitDate(t0));
    const a = readActivity(b);
    expect(a).toMatchObject({ start: fitDate(t0), durationMin: 3, avgHr: 102, maxHr: 152 });
    expect(a.trace).toEqual([[0, 92], [1, 102], [2, 112]]);
    expect(a.lat).toBeCloseTo(37.0445, 3); expect(a.lon).toBeCloseTo(-8.0164, 3);
    expect(readActivity(act(1))).toBeNull(); // a run is not a round
  });
  it('matches an activity to the round that started within three hours', () => {
    const a = { start: Date.parse('2022-06-12T11:11:33Z') };
    const rounds = [{ id: 'x', date: Date.parse('2022-06-12T06:00:00Z') }, { id: 'y', date: Date.parse('2022-06-12T11:00:00Z') }];
    expect(matchActivity(a, rounds).id).toBe('y');
    expect(matchActivity({ start: Date.parse('2022-06-13T11:00:00Z') }, rounds)).toBeNull();
  });
});

describe('Body: heart rate and heat against score', () => {
  const R = (k, hr, temp, toPar) => ({ r: { date: Date.parse(`20${22 + (k % 2)}-03-0${(k % 9) + 1}`), hrAct: { avg: hr }, cond: { start: { tempC: temp } }, holes: [] }, c: { holes: [] }, S: { holes: 18, toPar } });
  const list = [R(0, 95, 22, 4), R(1, 97, 23, 5), R(2, 99, 22, 3), R(3, 110, 33, 9), R(4, 114, 34, 10), R(5, 118, 33, 11)];
  it('splits rounds at the median heart rate and by heat band', () => {
    const B = bodyStats(list);
    expect(B.hr.low).toMatchObject({ n: 3, toPar: 4 }); expect(B.hr.high).toMatchObject({ n: 3, toPar: 10 });
    expect(B.heat.map((b) => [b.label, b.n, b.toPar])).toEqual([['Under 24°C', 3, 4], ['30–35°C', 3, 10]]);
    expect(B.years.map((y) => y.year)).toEqual([2022, 2023]);
  });
  it('stays quiet without enough rounds', () => {
    expect(bodyStats(list.slice(0, 4)).hr).toBeNull();
  });
});

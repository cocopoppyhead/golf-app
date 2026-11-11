import { describe, it, expect } from 'vitest';
import { clubOnCourse, clubVerdicts, levelRows, clubArea } from '../../src/clubstats.js';
import { benchFor, scratch, levelLabel } from '../../src/benchmarks.js';

const course = { holes: Array.from({ length: 18 }, (_, i) => ({ par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, yds: i % 6 === 2 ? 170 : 400 })) };
// 10 rounds: driver finds the fairway on 7 of 10 par-4/5 tee shots, misses right otherwise; 7 iron approaches from 160: on the green 6 of 10, short 4 of 10
const round = (k) => ({ id: `r${k}`, finished: true, date: Date.parse('2026-10-01') + k * 864e5, courseId: 'c', holes: course.holes.map((h, i) => {
  if (h.par === 3) return { score: 3, putts: 2, firstPutt: 20, shots: [{ lie: 'tee', dist: 170, res: 'G', d: { club: '7 iron' } }] };
  const teeOk = (i + k) % 10 < 7, onG = (i + k) % 10 < 6;
  return { score: onG ? 4 : 5, putts: 2, firstPutt: onG ? 20 : 6, shots: [{ lie: 'tee', dist: 400, res: teeOk ? 'FW' : 'RR', d: { club: 'Driver', plan: teeOk, sat: teeOk ? 4 : 2 } }, { lie: teeOk ? 'fw' : 'rgh', dist: 160, res: onG ? 'G' : 'RG', dir: onG ? null : 'S', d: { club: '7 iron' } }, ...(onG ? [] : [{ lie: 'rgh', dist: 15, res: 'G', d: { club: 'SW' } }])] };
}) });
const rounds = Array.from({ length: 10 }, (_, k) => ({ r: round(k), c: course }));

describe('club stats', () => {
  it('benchmarks interpolate and clamp', () => {
    expect(benchFor(0).gir).toBeCloseTo(0.61, 2); expect(benchFor(10).fir).toBeCloseTo(0.49, 2);
    expect(benchFor(12.5).gir).toBeCloseTo((0.36 + 0.24) / 2, 3); expect(benchFor(40).hcp).toBe(25); expect(scratch().driveYd).toBe(285);
    expect(levelLabel(5.6)).toBe('6-handicap'); expect(levelLabel(0.4)).toBe('scratch');
    expect(clubArea('Driver')).toBe('driver'); expect(clubArea('7 iron')).toBe('irons'); expect(clubArea('56°')).toBe('wedges');
  });
  it('reads the driver off the tee: fairways, misses, typical drive, as-planned', () => {
    const S = clubOnCourse(rounds, 'Driver');
    expect(S.tee.n).toBe(150); expect(S.fir).toBeCloseTo(0.7, 1); expect(S.tee.right).toBe(45); expect(S.tee.left).toBe(0);
    expect(S.drive).toBe(240); // 400 − 160 to go
    expect(S.planned).toBeCloseTo(0.7, 1); expect(S.satisfaction).toBeCloseTo(3.4, 1);
    const V = clubVerdicts(S, { hcp: 10 });
    expect(V.find((v) => v.kind === 'strength' && /fairways/.test(v.text))).toBeTruthy();
    expect(V.find((v) => /Every miss went right/.test(v.text))).toBeTruthy();
    const rows = levelRows(S, 10);
    expect(rows.map((r) => r.label)).toEqual(['Fairways', 'Tee shots in trouble', 'Typical drive']);
    expect(rows[0].better).toBe(1); expect(rows[2].better).toBe(-1); // 240 vs 259 for a 10
  });
  it('reads the 7 iron into greens: GIR, short misses, proximity, SG', () => {
    const S = clubOnCourse(rounds, '7 iron');
    expect(S.app.n).toBe(180); expect(S.gir).toBeCloseTo((30 + 90) / 180, 2); expect(S.app.short).toBe(60);
    expect(S.proximity).toBe(20); expect(S.sg.n).toBe(180);
    const V = clubVerdicts(S, { hcp: 10, practice: { area: 'irons', sessions30: 0, trend: null, results: 0 } });
    expect(V.find((v) => /greens with it/.test(v.text) && v.kind === 'strength')).toBeTruthy();
    expect(V.find((v) => /misses are short/.test(v.text))).toBeTruthy();
    expect(V.find((v) => /No practice logged on irons/.test(v.text))).toBeTruthy();
  });
  it('says nothing on thin samples', () => {
    const S = clubOnCourse(rounds.slice(0, 1), 'SW');
    expect(clubVerdicts(S, { hcp: 10 })).toEqual([]);
    expect(clubOnCourse([], 'Driver').n).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { radarRound, skillRadar, radarRead, radarSvg, AXES } from '../../src/rounds/radar.js';

const course = { holes: Array.from({ length: 18 }, (_, i) => ({ par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, yds: i % 6 === 2 ? 170 : 400 })) };
// a tidy golfer: every drive in play, approaches from 160 (long) or 100 (wedge), two putts from 20 ft; penalties on request
const round = (k, { pen = 0, wedge = false } = {}) => ({ id: `r${k}`, finished: true, date: Date.parse('2026-10-01') + k * 864e5, courseId: 'c', holes: course.holes.map((h, i) => {
  if (h.par === 3) return { score: 3, putts: 2, firstPutt: 20, shots: [{ lie: 'tee', dist: 170, res: 'G' }] };
  const p = pen && i < pen;
  if (p) return { score: 6, putts: 2, firstPutt: 20, shots: [{ lie: 'tee', dist: 400, res: 'RT', res2: 'PN', pen: true }, { lie: 'rgh', dist: 200, res: 'RG' }, { lie: 'rgh', dist: 20, res: 'G' }] };
  const app = wedge ? [{ lie: 'fw', dist: 300, res: 'FW', d: { plan: true } }, { lie: 'fw', dist: 100, res: 'G' }] : [{ lie: 'fw', dist: 160, res: 'G', d: { plan: true } }];
  return { score: wedge ? 5 : 4, putts: 2, firstPutt: 20, shots: [{ lie: 'tee', dist: 400, res: 'FW', d: { plan: true } }, ...app] };
}) });
const list = (n, o) => Array.from({ length: n }, (_, k) => ({ r: round(k, o), c: course }));

describe('skills radar', () => {
  it('splits approach strokes gained at 140 yards and counts the head inputs', () => {
    const R = radarRound(round(0), course);
    expect(R.holes).toBe(18); expect(R.complete).toBe(18);
    expect(R.appL).not.toBe(0); expect(R.appW).toBe(0); // all approaches from 160
    const W = radarRound(round(0, { wedge: true }), course);
    expect(W.appW).not.toBe(0);
    expect(R.pen).toBe(0); expect(R.dirt).toBe(0); expect(R.firOpp).toBe(15); expect(R.planN).toBe(30); expect(R.planned).toBe(30);
    const P = radarRound(round(0, { pen: 4 }), course);
    expect(P.pen).toBe(3); expect(P.dirt).toBe(3); // hole 3 is a par 3 in the fixture
    expect(R.shots).toEqual({ ott: 15, appL: 18, appW: 0, arg: 0, putt: 18 });
    expect(radarRound({ quick: true, holes: [] }, course)).toBeNull();
  });
  it('scores every axis against the level and clips at ±2', () => {
    const S = skillRadar(list(10), { hcp: 15 });
    expect(S.ready).toBe(true); expect(S.n).toBe(10); expect(S.nSg).toBe(10);
    expect(S.axes.map((a) => a.key)).toEqual(AXES.map((a) => a.key));
    for (const a of S.axes) expect(a.value == null || Math.abs(a.value) <= 2).toBe(true);
    // no wedge shots and nothing around the green in these rounds: those axes stay empty rather than reading +2
    expect(S.axes.find((a) => a.key === 'appW').enough).toBe(false); expect(S.axes.find((a) => a.key === 'arg').enough).toBe(false);
    expect(skillRadar(list(10, { wedge: true }), { hcp: 15 }).axes.find((a) => a.key === 'appW').enough).toBe(true);
    // a golfer who never drops a shot off the tee beats a 15-handicap's driving by the full clip
    expect(S.axes.find((a) => a.key === 'ott').value).toBe(2);
    // no penalties, no recovery drives, every shot to plan: head is positive
    expect(S.axes.find((a) => a.key === 'head').value).toBeGreaterThan(0.5);
    // the same rounds against scratch score lower on every strokes-gained axis
    const Z = skillRadar(list(10), { hcp: 0 });
    expect(Z.axes.find((a) => a.key === 'putt').value).toBeLessThan(S.axes.find((a) => a.key === 'putt').value);
    // scratch sits above the level ring for a 15, on the ring for a scratch golfer
    expect(S.axes.find((a) => a.key === 'ott').scratch).toBeGreaterThan(0);
    expect(Z.axes.find((a) => a.key === 'ott').scratch).toBe(0);
  });
  it('head drops with penalties and recovery drives', () => {
    const clean = skillRadar(list(5), { hcp: 10 }).axes.find((a) => a.key === 'head').value;
    const messy = skillRadar(list(5, { pen: 4 }), { hcp: 10 }).axes.find((a) => a.key === 'head').value;
    expect(messy).toBeLessThan(clean); expect(messy).toBeLessThan(0);
    expect(skillRadar(list(5, { pen: 9 }), { hcp: 10 }).axes.find((a) => a.key === 'head').value).toBe(-2);
  });
  it('counts only fully tracked holes for strokes gained, and keeps Garmin scorecards out of Mind', () => {
    const r = round(0, { pen: 4 });
    r.holes[5] = { ...r.holes[5], shots: [r.holes[5].shots[0]] }; // a hole with a missing shot
    const R = radarRound(r, course);
    expect(R.holes).toBe(18); expect(R.complete).toBe(17); expect(R.mind).toBe(true);
    // one hole short of a shot keeps the whole round out of the radar
    expect(skillRadar([{ r, c: course }], { hcp: 15 }).n).toBe(0);
    expect(skillRadar([{ r: round(0), c: course }], { hcp: 15 }).n).toBe(1);
    const g = radarRound({ ...round(1), source: 'garmin', garmin: { durationMin: 240 } }, course);
    expect(g.mind).toBe(false);
    const S = skillRadar(list(5).map((x) => ({ ...x, r: { ...x.r, source: 'garmin', garmin: { scorecard: true } } })), { hcp: 15 });
    expect(S.axes.find((a) => a.key === 'head').enough).toBe(false);
    expect(S.axes.find((a) => a.key === 'putt').enough).toBe(true);
  });
  it('is not ready under three rounds and says so per axis', () => {
    const S = skillRadar(list(2), { hcp: 12 });
    expect(S.ready).toBe(false); expect(S.axes.every((a) => !a.enough)).toBe(true);
    expect(radarRead(S)).toBeNull();
    expect(skillRadar([], { hcp: 12 }).axes.every((a) => a.value == null)).toBe(true);
  });
  it('reads the strongest and weakest axes and draws the svg', () => {
    const S = skillRadar(list(10, { pen: 9 }), { hcp: 15 });
    const read = radarRead(S);
    expect(read.worst.key).toBe('head');
    const svg = radarSvg(S, skillRadar(list(10), { hcp: 15 }));
    expect(svg).toContain('class="ryou"'); expect(svg).toContain('class="rghost"'); expect(svg).toContain('class="rscratch"');
    expect((svg.match(/data-goto=/g) || []).length).toBe(6);
    expect(svg).toContain('Short game'); expect(svg).toContain('Mind');
    expect(radarSvg(skillRadar([], { hcp: 15 }))).not.toContain('class="ryou"');
  });
});

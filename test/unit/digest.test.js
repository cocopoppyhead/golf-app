import { describe, it, expect } from 'vitest';
import { weeklyDigest, digestText, practiceByArea } from '../../src/digest.js';

const DAY = 864e5, now = Date.parse('2026-11-11T08:00:00Z');
const course = { name: 'Test', holes: Array.from({ length: 18 }, (_, i) => ({ par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, yds: 400 })) };
// a round of all bogeys, three-putting everything from 30 ft (putting is where the strokes go)
const round = (daysAgo, { intention = null, kept = null, toPar = 18, again = '' } = {}) => ({
  id: `r${daysAgo}`, finished: true, date: now - daysAgo * DAY, courseId: 'c', intention, intentionKept: kept, debrief: { again },
  holes: course.holes.map((h, i) => ({ score: h.par + (i < toPar ? 1 : 0), putts: i < toPar ? 3 : 2, firstPutt: 30, tags: [], shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 150, res: 'G' }] })),
});
const lib = { drills: [{ id: 'p1', area: 'putting' }, { id: 'd1', area: 'driver' }] };
const session = (daysAgo, drillId, minutes = 30) => ({ id: `s${daysAgo}${drillId}`, status: 'done', date: now - daysAgo * DAY, minutes, items: [{ drillId, score: 1 }] });

describe('weekly digest', () => {
  it('is empty for an empty fortnight', () => { expect(weeklyDigest({ now })).toBeNull(); });
  it('names where the strokes went and whether practice matched', () => {
    const d = weeklyDigest({ rounds: [{ r: round(2), c: course }, { r: round(9, { toPar: 10 }), c: course }], sessions: [session(3, 'd1', 40)], lib, now });
    expect(d.rounds).toBe(1);
    expect(d.lines.find((l) => l.key === 'rounds').text).toMatch(/1 round, averaging 90.0 \(\+8.0 on the week before\)/);
    expect(d.weakest).toBe('putt');
    expect(d.lines.find((l) => l.key === 'practice').text).toMatch(/None of it on putting/);
    expect(d.carry.length).toBeGreaterThan(0);
    const d2 = weeklyDigest({ rounds: [{ r: round(2), c: course }], sessions: [session(3, 'p1', 40)], lib, now });
    expect(d2.lines.find((l) => l.key === 'practice').text).toMatch(/matches where the strokes went/);
  });
  it('measures the mental game: intention kept vs slipped, once there are enough rounds', () => {
    const rounds = [
      round(1, { intention: 'safe', kept: 5, toPar: 6 }), round(3, { intention: 'safe', kept: 4, toPar: 8 }),
      round(20, { intention: 'commit', kept: 2, toPar: 14 }), round(30, { intention: 'commit', kept: 1, toPar: 16 }),
    ].map((r) => ({ r, c: course }));
    const d = weeklyDigest({ rounds, now });
    const t = d.lines.find((l) => l.key === 'intention').text;
    expect(t).toMatch(/kept your one thing \(2\): \+7.0/); expect(t).toMatch(/slipped \(2\): \+15.0/); expect(t).toMatch(/mental game, measured/);
    expect(d.lines.find((l) => l.key === 'intent-week').text).toMatch(/Play the safe side — kept 4.5\/5/);
    expect(digestText(d)).toMatch(/^This week:/);
  });
  it('carries the latest "do differently" into next week', () => {
    const d = weeklyDigest({ rounds: [{ r: round(1, { again: 'Lay up on 9' }), c: course }], now });
    expect(d.carry.some((x) => /You said: “Lay up on 9”/.test(x))).toBe(true);
  });
  it('splits practice minutes by area', () => {
    const P = practiceByArea([session(1, 'p1', 30), session(2, 'd1', 60), { ...session(3, 'p1'), status: 'planned' }], lib, now - 7 * DAY, now + DAY);
    expect(P.n).toBe(2); expect(P.minutes).toBe(90); expect(P.byArea).toEqual({ putting: 30, driver: 60 });
  });
});

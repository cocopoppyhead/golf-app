import { describe, it, expect } from 'vitest';
import { convertHole, convertExport, matchCourse, clubNames, sideOf } from '../../src/garmin/import.js';
import { BOOKMARKLET } from '../../src/garmin/bookmarklet.js';

// Hole 1 at a made-up course: tee at (25.0000, 55.0000), pin 400 m north
const tee = { lat: 25.0, lon: 55.0 }, pin = { lat: 25.0036, lon: 55.0 };
const pt = (dN, dE, lie) => ({ lat: 25.0 + dN / 111320, lon: 55.0 + dE / (111320 * Math.cos((25 * Math.PI) / 180)), lie });
const names = { 101: 'Driver', 107: '7 iron', 190: 'PW', 123: 'Putter' };
const shots = [
  { shotOrder: 1, clubId: 101, meters: 240, shotType: 'TEE', startLoc: { ...tee, lie: 'TeeBox' }, endLoc: pt(240, 12, 'Rough'), shotTime: '2026-11-01T06:10:00Z' },
  { shotOrder: 2, clubId: 107, meters: 150, shotType: 'APPROACH', startLoc: pt(240, 12, 'Rough'), endLoc: pt(385, -6, 'Green') },
  { shotOrder: 3, clubId: 123, meters: 15, shotType: 'PUTT', startLoc: pt(385, -6, 'Green'), endLoc: pt(399, 0, 'Green') },
  { shotOrder: 4, clubId: 123, meters: 1, shotType: 'PUTT', startLoc: pt(399, 0, 'Green'), endLoc: pt(400, 0, 'Green') },
];

describe('Garmin import', () => {
  it('converts a tracked hole: tee side from geometry, approach distance to the pin, first putt, clubs', () => {
    const h = convertHole({ number: 1, strokes: 4, putts: 2 }, shots, pin, 4, names);
    expect(h.score).toBe(4); expect(h.putts).toBe(2);
    expect(h.shots.length).toBe(2); // putts are not panels
    expect(h.shots[0]).toMatchObject({ lie: 'tee', res: 'RR', d: { club: 'Driver' }, src: 'garmin' }); // missed right into the rough
    expect(h.shots[0].dist).toBeCloseTo(437, -1); // 400 m to the pin in yards
    expect(h.shots[1]).toMatchObject({ lie: 'rgh', res: 'G', d: { club: '7 iron' } });
    expect(h.shots[1].dist).toBeCloseTo(175, -1);
    expect(h.tee).toBe('RR');
    expect(h.firstPutt).toBe(50); // ~16 m ≈ 53 ft → the 40+ bucket
  });
  it('a scored hole without shots keeps score, putts and the fairway outcome', () => {
    const h = convertHole({ number: 2, strokes: 5, putts: 2, fairwayShotOutcome: 'LEFT' }, [], null, 4, names);
    expect(h).toMatchObject({ score: 5, putts: 2, tee: 'LR', shots: null });
    expect(convertHole({ number: 3, strokes: null }, [], null, 3, names)).toBeNull();
  });
  it('an approach that misses is marked long / short / left / right; water is a penalty', () => {
    const sh = [{ shotOrder: 1, clubId: 107, meters: 160, startLoc: pt(250, 0, 'Fairway'), endLoc: pt(392, 25, 'Rough') }, { shotOrder: 2, clubId: 190, meters: 20, startLoc: pt(392, 25, 'Rough'), endLoc: pt(399, 1, 'Green') }];
    const h = convertHole({ number: 4, strokes: 4, putts: 1 }, sh, pin, 3, names);
    expect(h.shots[0].dir).toBe('R');
    const w = convertHole({ number: 5, strokes: 6, putts: 2 }, [{ shotOrder: 1, clubId: 101, meters: 200, startLoc: { ...tee, lie: 'TeeBox' }, endLoc: pt(200, -40, 'Water') }], pin, 4, names);
    expect(w.shots[0]).toMatchObject({ res: 'LT', res2: 'PN', pen: true });
  });
  it('matches courses: own, then library, else a new manual course from the pars', () => {
    const own = [{ id: 'c1', name: 'Emirates Golf Club – Majlis', holes: [] }];
    const lib = [{ id: 'emirates-golf-club-majlis', name: 'Emirates Golf Club – Majlis', par: [4, 4] }, { id: 'x', name: 'Trump International Golf Club Dubai', par: [4] }];
    expect(matchCourse({ name: 'Emirates GC - Majlis' }, { courses: own, library: lib }).kind).toBe('course');
    expect(matchCourse({ name: 'Trump International Golf Club, Dubai' }, { courses: own, library: lib })).toMatchObject({ kind: 'library', lib: { id: 'x' } });
    const n = matchCourse({ name: 'Castleknock Golf Club', holePars: '454344534' }, { courses: own, library: lib });
    expect(n.kind).toBe('new'); expect(n.spec.holes.map((h) => h.par)).toEqual([4, 5, 4, 3, 4, 4, 5, 3, 4]);
  });
  it('club names come from the export clubs and the type table', () => {
    const n = clubNames({ clubs: [{ id: 1, clubTypeId: 16 }, { id: 2, clubTypeId: 19 }, { id: 3, name: 'Lob Wedge', clubTypeId: 22 }], clubTypes: [{ value: 16, name: '7 Iron' }] });
    expect(n).toEqual({ 1: '7 iron', 2: 'PW', 3: 'LW' });
    expect(sideOf([25, 55], [25.01, 55], [25.005, 54.999])).toBe(-1);
  });
  it('a whole export becomes rounds with stable ids, newest first', () => {
    const exp = { app: 'osolo-garmin', clubs: [{ id: 101, clubTypeId: 1 }], clubTypes: [], rounds: [
      { id: 500, scorecard: { startTime: '2026-10-01T06:00:00', holes: [{ number: 1, strokes: 5, putts: 2 }, { number: 2, strokes: 4, putts: 2 }] }, course: { name: 'Castleknock', holePars: '44' }, holeShots: [] },
      { id: 501, scorecard: { startTime: '2026-11-01T06:00:00', holes: [{ number: 1, strokes: 4, putts: 2 }] }, course: { name: 'Castleknock', holePars: '44' }, holeShots: [{ holeNumber: 1, pinPosition: pin, shots }] },
      { id: 502, error: '500' },
    ] };
    const rounds = convertExport(exp, () => ({ id: 'c9', name: 'Castleknock', holes: [{ par: 4 }, { par: 4 }] }));
    expect(rounds.map((r) => r.id)).toEqual(['r_g501', 'r_g500']);
    expect(rounds[0]).toMatchObject({ source: 'garmin', finished: true, shotsTracked: 2, courseId: 'c9' });
    expect(rounds[1].holes[1].score).toBe(4);
    expect(() => convertExport({ app: 'other' }, () => null)).toThrow(/Garmin bookmarklet/);
  });
  it('the bookmarklet is a self-contained javascript: URL', () => {
    expect(BOOKMARKLET.startsWith('javascript:(function')).toBe(true);
    expect(BOOKMARKLET).toMatch(/gcs-golfcommunity\/api\/v2/); expect(BOOKMARKLET).toMatch(/osolo-garmin/);
    expect(BOOKMARKLET).not.toMatch(/import |export /);
  });
});

import { describe, it, expect } from 'vitest';
import { parseFit, fitDate } from '../../src/garmin/fit.js';
import { readScorecard, scorecardId, convertScorecards, bagNames } from '../../src/garmin/scorecard.js';
import { holeSG, expected } from '../../src/rounds/sg.js';
import { readZipEntries } from '../../src/garmin/zip.js';
import { matchCourse } from '../../src/garmin/import.js';

import { fit } from '../fixtures/garminfit.js';

const t0 = 1011189463; // 2022-01-15 13:57:43 UTC
const card = fit([
  [0, [[0, 'u8', 38]]],
  [190, [[1, 'str', 'Test Links Golf Club'], [3, 'u32', t0], [4, 'u32', t0 + 3 * 3600], [11, 'str', 'Yellow'], [21, 'f32', 30.5], [12, 'u8', 104]]],
  [191, [[0, 'str', 'Me'], [1, 'u8', 0], [2, 'u8', 13]]],
  [191, [[0, 'str', 'Pal'], [1, 'u8', 1], [2, 'u8', 15]]],
  [192, [[0, 'u8', 0], [1, 'u8', 1], [2, 'u8', 5], [5, 's8', 2]]],
  [192, [[0, 'u8', 0], [1, 'u8', 2], [2, 'u8', 3], [5, 's8', -1]]],
  [192, [[0, 'u8', 0], [1, 'u8', 3], [2, 'u8', 5], [5, 's8', 1]]],
  [192, [[0, 'u8', 1], [1, 'u8', 1], [2, 'u8', 6]]],
  [193, [[0, 'u8', 1], [1, 'u32', 36576], [2, 'u8', 4], [3, 'u8', 7], [4, 's32', 442525136], [5, 's32', -97498960]]],
  [193, [[0, 'u8', 2], [1, 'u32', 13716], [2, 'u8', 3], [3, 'u8', 9]]],
  [193, [[0, 'u8', 3], [1, 'u32', 45720], [2, 'u8', 5], [3, 'u8', 1]]],
]);

describe('Garmin account export', () => {
  it('reads FIT messages and dates', () => {
    const m = parseFit(card);
    expect(m.map((x) => x.num)).toEqual([0, 190, 191, 191, 192, 192, 192, 192, 193, 193, 193]);
    expect(new Date(fitDate(t0)).toISOString()).toBe('2022-01-15T13:57:43.000Z');
    expect(() => parseFit(new Uint8Array(20))).toThrow();
  });
  it('turns a scorecard into course, players and hole scores', () => {
    const sc = readScorecard(card, scorecardId('Golf-SCORECARD_RAWDATA-199043740.fit'));
    expect(sc.id).toBe('199043740');
    expect(sc.course).toMatchObject({ name: 'Test Links Golf Club', tee: 'Yellow', slope: 104 });
    expect(sc.course.holes.map((h) => [h.par, h.si, h.yds])).toEqual([[4, 7, 400], [3, 9, 150], [5, 1, 500]]);
    expect(sc.course.holes[0].green.lat).toBeCloseTo(37.09, 2);
    expect(sc.players.map((p) => p.name)).toEqual(['Me', 'Pal']);
    expect(sc.players[0].holes.get(1)).toEqual({ score: 5, putts: 2 });
    expect(sc.players[0].holes.get(2)).toEqual({ score: 3, putts: null }); // −1 = not entered
    const R = convertScorecards([sc], (snap) => ({ id: 'c1', name: snap.name, holes: snap.holes.map((h) => ({ par: h.par })) }));
    expect(R).toHaveLength(1);
    expect(R[0]).toMatchObject({ id: 'r_g199043740', courseId: 'c1', tees: 'Yellow', holesPlayed: 3, source: 'garmin' });
    expect(R[0].holes.map((h) => h.score)).toEqual([5, 3, 5]);
    expect(R[0].players).toEqual([{ name: 'Pal', scores: [6, null, null] }]);
    expect(R[0].garmin.durationMin).toBe(180);
  });
  it('matches a library course, or describes a new one from the card', () => {
    const sc = readScorecard(card, '1');
    const snap = { name: sc.course.name, holes: sc.course.holes, tee: 'Yellow' };
    expect(matchCourse(snap, { library: [{ id: 'tl', name: 'Test Links' }] })).toMatchObject({ kind: 'library' });
    const m = matchCourse({ ...snap, name: 'Elsewhere GC' }, { library: [] });
    expect(m.kind).toBe('new'); expect(m.spec.tees).toBe('Yellow'); expect(m.spec.holes.map((h) => h.yds)).toEqual([400, 150, 500]);
  });
  it('pulls the golf files out of a zip', async () => {
    // a stored (uncompressed) zip with one scorecard and one unrelated file
    const files = [['DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-7.fit', card], ['DI_CONNECT/other.json', new TextEncoder().encode('{}')]];
    const parts = []; const cds = []; let off = 0;
    for (const [name, data] of files) {
      const n = new TextEncoder().encode(name);
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true);
      parts.push(new Uint8Array(lh.buffer), n, data);
      const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
      cds.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + data.length;
    }
    const cdLen = cds.reduce((a, b) => a + b.length, 0);
    const eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, 2, true); eo.setUint16(10, 2, true); eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
    const zip = new Blob([...parts, ...cds, new Uint8Array(eo.buffer)]);
    const got = await readZipEntries(zip, (n) => /SCORECARD_RAWDATA/.test(n));
    expect(got.map((e) => e.name)).toEqual(['DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-7.fit']);
    expect(readScorecard(got[0].bytes, '7').players[0].total).toBe(13);
  });
});

describe('Garmin scorecard shots', () => {
  const S = 2 ** 31 / 180;
  const pin = { lat: 37.05, lon: -8.02 };
  const north = (m) => ({ lat: +(pin.lat + m / 111320).toFixed(6), lon: pin.lon }); // m metres north of the pin
  const shot = (from, to, club, t, hr = 100) => [194, [[253, 'u32', t], [1, 'u8', 1], [2, 's32', Math.round(north(from).lat * S)], [3, 's32', Math.round(pin.lon * S)], [4, 's32', Math.round(north(to).lat * S)], [5, 's32', Math.round(pin.lon * S)], [7, 'u32', club], [11, 'u8', hr]]];
  const build = (putts, shots) => fit([
    [190, [[1, 'str', 'Shot Links'], [3, 'u32', t0], [4, 'u32', t0 + 3600]]],
    [191, [[0, 'str', 'Me'], [1, 'u8', 0], [2, 'u8', 5]]],
    [192, [[0, 'u8', 0], [1, 'u8', 1], [2, 'u8', 5], [5, 's8', putts]]],
    [193, [[0, 'u8', 1], [1, 'u32', 36576], [2, 'u8', 4], [3, 'u8', 1], [4, 's32', Math.round(pin.lat * S)], [5, 's32', Math.round(pin.lon * S)]]],
    ...shots,
  ]);
  // drive 360 → 150, 7 iron 150 → 30, chip 30 → 9, then two putts; a practice stroke with the putter
  // from the same spot as the first putt, which the watch also logged
  const shots = [shot(360, 150, 11, t0 + 10, 92), shot(150, 30, 12, t0 + 200, 118), shot(30, 9, 0, t0 + 400), shot(9.5, 9, 13, t0 + 500), shot(9, 1, 13, t0 + 520), shot(1, 0, 13, t0 + 560)];
  const names = bagNames([{ id: 11, clubTypeId: 1, name: 'Big Stick' }, { id: 12, clubTypeId: 16 }, { id: 13, clubTypeId: 23 }], [{ value: 16, name: '7 Iron' }]);

  it('names clubs by type from the bag files', () => {
    expect(names).toEqual({ 11: 'Driver', 12: '7 iron', 13: 'Putter' });
  });
  it('reads shots, drops repeat strokes from the same spot and reconciles them with the score', () => {
    const sc = readScorecard(build(2, shots), '9');
    expect(sc.shots.get(1)).toHaveLength(6);
    const [r] = convertScorecards([sc], (snap) => ({ id: 'c', name: snap.name, holes: [{ par: 4, yds: 400 }] }), { names });
    const h = r.holes[0];
    expect(h.shots.map((x) => [x.lie, x.dist, x.d?.club])).toEqual([['tee', 393, 'Driver'], ['unk', 164, '7 iron'], ['unk', 33, undefined]]);
    expect(h.firstPutt).toBe(30); // 9 m = 29.5 ft
    expect(h.shots[0].flew).toBeCloseTo(230, -1);
    expect(r.shotsTracked).toBe(3);
    expect(h.shots[0].hr).toBe(92); expect(h.shots[1].hr).toBe(118);
    expect(h.hr).toEqual({ avg: 102, max: 118, n: 6 }); // the mean of every shot's heart rate on the hole
    expect(r.hr).toMatchObject({ max: 118, n: 6 });
    expect(holeSG(h, 4, 400).complete).toBe(true);
  });
  it('keeps only the score when the shots do not add up', () => {
    const sc = readScorecard(build(1, shots), '9'); // 1 putt entered but 3 strokes off the green + 1 putt ≠ 5
    const [r] = convertScorecards([sc], (snap) => ({ id: 'c', name: snap.name, holes: [{ par: 4, yds: 400 }] }), { names });
    expect(r.holes[0]).toMatchObject({ score: 5, putts: 1, shots: null, firstPutt: null });
    expect(r.holes[0].hr.n).toBe(6); // heart rate kept even when the shots don't reconcile
    const none = readScorecard(build(-1, shots), '9'); // putts not entered
    expect(convertScorecards([none], () => ({ id: 'c', name: 'x', holes: [{ par: 4 }] }))[0].holes[0].shots).toBeNull();
  });
  it('treats an unknown lie as halfway between fairway and rough', () => {
    expect(expected('unk', 150)).toBeCloseTo((expected('fw', 150) + expected('rgh', 150)) / 2, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { parseFit, fitDate } from '../../src/garmin/fit.js';
import { readScorecard, scorecardId, convertScorecards } from '../../src/garmin/scorecard.js';
import { readZipEntries } from '../../src/garmin/zip.js';
import { matchCourse } from '../../src/garmin/import.js';

// A tiny FIT writer for tests: messages as [globalNum, [[fieldNum, type, value], ...]]; types: 'u8','u16','u32','s32','f32','str'.
const SIZE = { u8: 1, u16: 2, u32: 4, s32: 4, s8: 1, f32: 4 };
const BASE = { u8: 0x02, u16: 0x84, u32: 0x86, s32: 0x85, s8: 0x01, f32: 0x88, str: 0x07 };
function fit(messages) {
  const body = []; const push = (...b) => body.push(...b);
  messages.forEach(([num, fields], k) => {
    const local = k % 16;
    push(0x40 | local, 0, 0, num & 0xff, num >> 8, fields.length);
    const sizes = fields.map(([, t, v]) => (t === 'str' ? new TextEncoder().encode(v).length + 1 : SIZE[t]));
    fields.forEach(([fn, t], i) => push(fn, sizes[i], BASE[t]));
    push(local);
    fields.forEach(([, t, v], i) => {
      const dv = new DataView(new ArrayBuffer(sizes[i]));
      if (t === 'str') new TextEncoder().encode(v).forEach((c, j) => dv.setUint8(j, c));
      else if (t === 'u8') dv.setUint8(0, v); else if (t === 's8') dv.setInt8(0, v); else if (t === 'u16') dv.setUint16(0, v, true);
      else if (t === 'u32') dv.setUint32(0, v, true); else if (t === 's32') dv.setInt32(0, v, true); else if (t === 'f32') dv.setFloat32(0, v, true);
      push(...new Uint8Array(dv.buffer));
    });
  });
  const head = new Uint8Array(14); const hv = new DataView(head.buffer);
  hv.setUint8(0, 14); hv.setUint8(1, 0x10); hv.setUint32(4, body.length, true); [...'.FIT'].forEach((c, i) => hv.setUint8(8 + i, c.charCodeAt(0)));
  return new Uint8Array([...head, ...body, 0, 0]);
}
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

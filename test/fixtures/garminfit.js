// Builders for Garmin export fixtures: FIT files and zips, for unit and e2e tests.
// A tiny FIT writer for tests: messages as [globalNum, [[fieldNum, type, value], ...]]; types: 'u8','u16','u32','s32','f32','str'.
const SIZE = { u8: 1, u16: 2, u32: 4, s32: 4, s8: 1, f32: 4 };
const BASE = { u8: 0x02, u16: 0x84, u32: 0x86, s32: 0x85, s8: 0x01, f32: 0x88, str: 0x07 };
export function fit(messages) {
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

/** A stored (uncompressed) zip of [name, bytes] pairs. */
export function storedZip(files) {
  const parts = []; const cds = []; let off = 0;
  for (const [name, data] of files) {
    const n = new TextEncoder().encode(name);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true);
    parts.push(new Uint8Array(lh.buffer), n, data);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
    cds.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + data.length;
  }
  const cdLen = cds.reduce((x, y) => x + y.length, 0);
  const eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true); eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
  const all = [...parts, ...cds, new Uint8Array(eo.buffer)]; const out = new Uint8Array(all.reduce((x, y) => x + y.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

/** A Garmin golf scorecard FIT: course name, tee, start (FIT seconds), pars and my scores per hole. */
export function scorecardFit({ course, tee = 'White', start = 1011189463, pars, scores, putts = [] }) {
  return fit([
    [0, [[0, 'u8', 38]]],
    [190, [[1, 'str', course], [3, 'u32', start], [4, 'u32', start + 4 * 3600], [11, 'str', tee]]],
    [191, [[0, 'str', 'Me'], [1, 'u8', 0], [2, 'u8', scores.reduce((a, b) => a + b, 0)]]],
    ...scores.map((s, i) => [192, [[0, 'u8', 0], [1, 'u8', i + 1], [2, 'u8', s], [5, 's8', putts[i] ?? -1]]]),
    ...pars.map((p, i) => [193, [[0, 'u8', i + 1], [1, 'u32', 36576], [2, 'u8', p], [3, 'u8', i + 1]]]),
  ]);
}

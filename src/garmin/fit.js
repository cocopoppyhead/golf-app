// A small reader for Garmin FIT files (the binary format of Garmin's account export): enough to walk
// definition and data messages, including Garmin's undocumented golf messages, by message and field
// number. No dependencies. Returns [{ num, fields: { [fieldNum]: value } }] in file order.
const FIT_EPOCH = Date.UTC(1989, 11, 31); // FIT timestamps are seconds since 1989-12-31 00:00 UTC
export const fitDate = (s) => (s == null ? null : FIT_EPOCH + s * 1000);

// base type id → [byte size, reader(view, offset, littleEndian), invalid value]
const T = {
  0x00: [1, (v, o) => v.getUint8(o), 0xff], 0x01: [1, (v, o) => v.getInt8(o), 0x7f], 0x02: [1, (v, o) => v.getUint8(o), 0xff],
  0x83: [2, (v, o, le) => v.getInt16(o, le), 0x7fff], 0x84: [2, (v, o, le) => v.getUint16(o, le), 0xffff],
  0x85: [4, (v, o, le) => v.getInt32(o, le), 0x7fffffff], 0x86: [4, (v, o, le) => v.getUint32(o, le), 0xffffffff],
  0x88: [4, (v, o, le) => v.getFloat32(o, le), null], 0x89: [8, (v, o, le) => v.getFloat64(o, le), null],
  0x0a: [1, (v, o) => v.getUint8(o), 0x00], 0x8b: [2, (v, o, le) => v.getUint16(o, le), 0x0000], 0x8c: [4, (v, o, le) => v.getUint32(o, le), 0x00000000],
  0x0d: [1, (v, o) => v.getUint8(o), 0xff],
  0x8e: [8, (v, o, le) => Number(v.getBigInt64(o, le)), null], 0x8f: [8, (v, o, le) => Number(v.getBigUint64(o, le)), null], 0x90: [8, (v, o, le) => Number(v.getBigUint64(o, le)), null],
};

/**
 * opts.only: a Set of message numbers to keep (others are skipped without decoding: fast for activity
 * files with thousands of records). opts.stop(msg): return true to stop after that message.
 * Records with a compressed timestamp header get their timestamp (field 253) filled in.
 */
export function parseFit(buf, opts = {}) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const headerSize = v.getUint8(0);
  if (String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11)) !== '.FIT') throw new Error('Not a FIT file');
  const end = Math.min(v.byteLength, headerSize + v.getUint32(4, true));
  const defs = {}; const out = []; const only = opts.only || null; const ts = { last: null };
  let o = headerSize;
  const take = (def, oo, cts) => {
    if (only && !only.has(def.num)) return oo + def.size + def.devSize;
    const n = out.length; const next = readData(v, oo, def, out);
    const m = out[n];
    if (cts != null && ts.last != null) { const off = cts & 0x1f; m.fields[253] = ts.last + ((off - (ts.last & 0x1f)) & 0x1f); }
    if (m.fields[253] != null) ts.last = m.fields[253];
    return next;
  };
  while (o < end) {
    const h = v.getUint8(o); o += 1;
    if (h & 0x80) { // compressed timestamp header: a data message for local type in bits 5–6, time offset in bits 0–4
      const def = defs[(h >> 5) & 0x03]; if (!def) throw new Error('FIT: data before its definition');
      o = take(def, o, h);
      if (opts.stop && out.length && opts.stop(out[out.length - 1])) break;
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) { // definition message
      const hasDev = !!(h & 0x20);
      const le = v.getUint8(o + 1) === 0; const num = v.getUint16(o + 2, le); const n = v.getUint8(o + 4); o += 5;
      const fields = [];
      for (let i = 0; i < n; i++) { fields.push({ num: v.getUint8(o), size: v.getUint8(o + 1), type: v.getUint8(o + 2) }); o += 3; }
      let devSize = 0;
      if (hasDev) { const nd = v.getUint8(o); o += 1; for (let i = 0; i < nd; i++) { devSize += v.getUint8(o + 1); o += 3; } }
      defs[local] = { num, le, fields, devSize, size: fields.reduce((a, f) => a + f.size, 0) };
    } else {
      const def = defs[local]; if (!def) throw new Error('FIT: data before its definition');
      const before = out.length;
      o = take(def, o, null);
      if (opts.stop && out.length > before && opts.stop(out[out.length - 1])) break;
    }
  }
  return out;
}

/** The file_id message only (type 4 = activity, time created), reading no further than it. */
export function fitFileId(buf) {
  const m = parseFit(buf, { only: new Set([0]), stop: (x) => x.num === 0 })[0];
  return m ? { type: m.fields[0], manufacturer: m.fields[1], created: fitDate(m.fields[4]) } : null;
}

function readData(v, o, def, out) {
  const fields = {};
  for (const f of def.fields) {
    const t = T[f.type] || T[0x0d];
    if (f.type === 0x07) { // string
      let s = ''; for (let i = 0; i < f.size; i++) { const c = v.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); }
      try { s = decodeURIComponent(escape(s)); } catch { /* not UTF-8: keep the bytes as read */ }
      fields[f.num] = s || null;
    } else if (f.size > t[0] && t[0] && f.size % t[0] === 0) {
      const arr = []; for (let i = 0; i < f.size; i += t[0]) { const x = t[1](v, o + i, def.le); arr.push(x === t[2] ? null : x); }
      fields[f.num] = arr;
    } else if (f.size === t[0]) {
      const x = t[1](v, o, def.le); fields[f.num] = x === t[2] || Number.isNaN(x) ? null : x;
    }
    o += f.size;
  }
  out.push({ num: def.num, fields });
  return o + def.devSize;
}

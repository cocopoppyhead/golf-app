// Pure helpers for the native picker: base64 and reading zip entries through a seekable file handle.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(u8) {
  let out = ''; let i = 0;
  for (; i + 2 < u8.length; i += 3) { const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2]; out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]; }
  if (i < u8.length) { const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8); out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + '='; }
  return out;
}

const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
export async function readAt(h, at, n) { h.offset = at; return h.readBytes(n); }

/** Entries of a zip whose names pass `want`: [{ name, method, size, data(compressed bytes) }]. */
export async function zipEntries(h, size, want) {
  const tailLen = Math.min(size, 66000);
  const tail = await readAt(h, size - tailLen, tailLen); const t = dv(tail);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (t.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a zip');
  let count = t.getUint16(e + 10, true), cdSize = t.getUint32(e + 12, true), cdOff = t.getUint32(e + 16, true);
  if ((cdOff === 0xffffffff || count === 0xffff) && e >= 20 && t.getUint32(e - 20, true) === 0x07064b50) {
    const z = dv(await readAt(h, Number(t.getBigUint64(e - 12, true)), 56));
    count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
  }
  const cdb = await readAt(h, cdOff, cdSize); const cd = dv(cdb);
  const out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cdb.length; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true), local = cd.getUint32(p + 42, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    let name = ''; for (let i = 0; i < nl; i++) name += String.fromCharCode(cdb[p + 46 + i]);
    if (comp === 0xffffffff || local === 0xffffffff) {
      for (let q = p + 46 + nl; q + 4 <= p + 46 + nl + xl;) {
        const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
        if (id === 1) { let r = q + 4; if (cd.getUint32(p + 24, true) === 0xffffffff) r += 8; if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(r, true)); r += 8; } if (local === 0xffffffff) local = Number(cd.getBigUint64(r, true)); }
        q += 4 + len;
      }
    }
    p += 46 + nl + xl + cl;
    if (name.endsWith('/') || !want(name) || comp > 50e6) continue;
    const lh = dv(await readAt(h, local, 30));
    const data = await readAt(h, local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), comp);
    out.push({ name, method, data });
  }
  return out;
}


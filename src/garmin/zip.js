// Read chosen entries out of a zip without loading the whole archive: the central directory says where
// each file sits, so a multi-gigabyte Garmin export costs only the bytes of the golf files. Stored and
// deflated entries (all Garmin uses); zip64 offsets for archives over 4 GB.
/** each(entry): optional; called as each entry is read, and an entry it returns false for isn't kept (so thousands of files can stream through). */
export async function readZipEntries(file, want = () => true, each = null) {
  const size = file.size;
  const tail = new DataView(await file.slice(Math.max(0, size - 66000), size).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) { // zip64: the locator sits just before the EOCD
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(tail.getBigUint64(loc + 8, true));
      const r = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
      count = Number(r.getBigUint64(32, true)); cdSize = Number(r.getBigUint64(40, true)); cdOff = Number(r.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true), local = cd.getUint32(p + 42, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (comp === 0xffffffff || local === 0xffffffff) { // zip64 extra field
      let e = p + 46 + nameLen; const ee = e + extraLen;
      while (e + 4 <= ee) {
        const id = cd.getUint16(e, true), len = cd.getUint16(e + 2, true);
        if (id === 1) { let q = e + 4; if (cd.getUint32(p + 24, true) === 0xffffffff) q += 8; if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(q, true)); q += 8; } if (local === 0xffffffff) local = Number(cd.getBigUint64(q, true)); }
        e += 4 + len;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !want(name)) continue;
    const lh = new DataView(await file.slice(local, local + 30).arrayBuffer());
    const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = file.slice(start, start + comp);
    const bytes = method === 0 ? await raw.arrayBuffer() : method === 8 ? await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer() : null;
    if (bytes && (!each || (await each({ name, bytes })) !== false)) out.push({ name, bytes });
  }
  return out;
}

import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { zipEntries, toBase64 } from '../../native/zipread.js';

// a file handle over a buffer, like expo-file-system's FileHandle (offset + readBytes)
const handle = (u8) => ({ offset: 0, async readBytes(n) { const out = u8.slice(this.offset, this.offset + n); this.offset += out.length; return out; } });
function zip(entries) {
  const parts = []; const cds = []; let off = 0;
  for (const [name, data, deflate] of entries) {
    const body = deflate ? new Uint8Array(deflateRawSync(data)) : data; const n = new TextEncoder().encode(name);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, deflate ? 8 : 0, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true);
    parts.push(new Uint8Array(lh.buffer), n, body);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(10, deflate ? 8 : 0, true); cd.setUint32(20, body.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
    cds.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + body.length;
  }
  const cdLen = cds.reduce((a, b) => a + b.length, 0);
  const eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true); eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
  const all = [...parts, ...cds, new Uint8Array(eo.buffer)]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

describe('native picker (Android shell)', () => {
  it('finds only the wanted entries in a zip by seeking, and hands them over still compressed', async () => {
    const fitBytes = new Uint8Array(500).map((_, i) => i % 7);
    const z = zip([['DI_CONNECT/DI-Connect-Fitness/big.json', new Uint8Array(20000).fill(1), true], ['DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-1.fit', fitBytes, true], ['x/readme.txt', new TextEncoder().encode('hi'), false]]);
    const got = await zipEntries(handle(z), z.length, (n) => /SCORECARD_RAWDATA/.test(n));
    expect(got.map((e) => [e.name, e.method])).toEqual([['DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-1.fit', 8]]);
    const { inflateRawSync } = await import('node:zlib');
    expect([...inflateRawSync(got[0].data)]).toEqual([...fitBytes]);
  });
  it('base64 matches the standard encoding', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'osolo golf']) expect(toBase64(new TextEncoder().encode(s))).toBe(Buffer.from(s).toString('base64'));
  });
});

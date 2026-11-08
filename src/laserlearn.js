// Teach the app an unknown rangefinder: you laser a target and type what the screen showed;
// we look through the Bluetooth packets for every way that number could be encoded
// (integers, floats, tenths, metres vs yards, plain text) and keep the encodings that fit
// every reading. One left after 2+ different readings = learned.

const YD_PER_M = 1.0936133;

const READERS = {
  u8: { size: 1, get: (dv, o) => dv.getUint8(o) },
  u16le: { size: 2, get: (dv, o) => dv.getUint16(o, true) },
  u16be: { size: 2, get: (dv, o) => dv.getUint16(o, false) },
  u32le: { size: 4, get: (dv, o) => dv.getUint32(o, true) },
  u32be: { size: 4, get: (dv, o) => dv.getUint32(o, false) },
  f32le: { size: 4, get: (dv, o) => dv.getFloat32(o, true) },
  f32be: { size: 4, get: (dv, o) => dv.getFloat32(o, false) },
};
const SCALES = [1, 0.1, 0.01];
const UNITS = ['y', 'm']; // what the device sends

/** Every candidate number in a packet: [{key, value}] where value is converted to the unit `want`. */
function candidates(char, bytes, want) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (const [type, r] of Object.entries(READERS)) {
    for (let o = 0; o + r.size <= bytes.length; o++) {
      const raw = r.get(dv, o);
      if (!Number.isFinite(raw)) continue;
      for (const scale of type.startsWith('f') ? [1] : SCALES) {
        for (const unit of UNITS) {
          out.push({ key: `${char}|${type}|${o}|${scale}|${unit}`, value: convert(raw * scale, unit, want) });
        }
      }
    }
  }
  // ASCII digits, e.g. "152Y" or "139.5"
  const text = String.fromCharCode(...bytes);
  const m = text.match(/(\d{1,4}(?:\.\d)?)/);
  if (m) for (const unit of UNITS) out.push({ key: `${char}|ascii|0|1|${unit}`, value: convert(+m[1], unit, want) });
  return out;
}
const convert = (v, from, to) => (from === to ? v : from === 'm' ? v * YD_PER_M : v / YD_PER_M);

/**
 * state: previous result (or null). packets: [{char, bytes}] from the last few seconds.
 * value: what the screen showed. unit: 'y' or 'm' (the rangefinder's display unit).
 * Returns { keys:Set, values:[...], left, profile? }.
 */
export function learnFrom(state, packets, value, unit = 'y') {
  if (!(value > 0)) return state || { keys: null, values: [], left: 0 };
  const tol = Math.max(0.6, value * 0.004);
  const hits = new Set();
  for (const p of packets) for (const c of candidates(p.char, p.bytes, unit)) if (Math.abs(c.value - value) <= tol) hits.add(c.key);
  const prev = state?.keys?.size ? state.keys : null;
  const same = state?.values?.some((v) => Math.abs(v - value) < 1);
  const keys = prev ? new Set([...prev].filter((k) => hits.has(k))) : hits;
  const values = [...(state?.values || []), value];
  const res = { keys: keys.size || !prev ? keys : prev, values, left: keys.size, unit };
  if (!keys.size && prev) { res.left = 0; res.keys = prev; return res; }
  // decide: one pattern, or several that always agree (e.g. u16le and u32le at the same offset)
  if (values.length >= 2 && !same && keys.size >= 1) {
    const best = pick([...keys]);
    if (best && (keys.size === 1 || agreeing([...keys], packets, unit))) res.profile = toProfile(best, unit);
  }
  return res;
}

// prefer simple encodings: floats, then 16-bit, then 8/32-bit; unscaled before tenths
const RANK = { f32le: 0, f32be: 1, u16le: 2, u16be: 3, u32le: 4, u32be: 5, u8: 6, ascii: 7 };
function pick(keys) {
  return keys.map((k) => k.split('|')).sort((a, b) => RANK[a[1]] - RANK[b[1]] || +b[3] - +a[3] || +a[2] - +b[2])[0];
}
function agreeing(keys, packets, unit) {
  // all remaining candidates decode the latest packet on their channel to (nearly) the same number
  const vals = keys.map((k) => {
    const [char] = k.split('|');
    const p = [...packets].reverse().find((x) => x.char === char);
    return p ? applyProfile(toProfile(k.split('|'), unit), p.bytes)?.raw : null;
  }).filter((v) => v != null);
  return vals.length === keys.length && Math.max(...vals) - Math.min(...vals) < 1;
}
function toProfile([char, type, offset, scale, sends], display) {
  return { char, type, offset: +offset, scale: +scale, sends, display };
}

/** Decode a packet with a learned profile → { raw (yards), slope:null, playsAs } or null. */
export function applyProfile(p, bytes) {
  let v;
  if (p.type === 'ascii') { const m = String.fromCharCode(...bytes).match(/(\d{1,4}(?:\.\d)?)/); v = m ? +m[1] : NaN; }
  else {
    const r = READERS[p.type]; if (!r || p.offset + r.size > bytes.length) return null;
    v = r.get(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), p.offset) * p.scale;
  }
  const yards = convert(v, p.sends, 'y');
  return Number.isFinite(yards) && yards > 1 && yards < 1500 ? { raw: yards, slope: null, playsAs: yards, heading: null, incline: null } : null;
}

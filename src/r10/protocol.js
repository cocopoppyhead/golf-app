// Garmin Approach R10 wire protocol: pure functions, no Bluetooth. Ported from the open-source 10over
// project (github.com/divotmaker/10over, MIT/Apache-2.0, docs/WIRE.md and docs/SEQUENCE.md); see NOTICE.
//
// Layers, outside in: BLE GATT (MultiLink service) -> MultiLink handle byte on every chunk -> COBS frames
// delimited by 0x00 -> GFDI frame (length, type, payload, CRC-16/ARC) -> for 5043/5044, a 14-byte
// fragmentation header and one protobuf Envelope. All integers little-endian.

const UUID = (s) => `6a4e${s}-667b-11e3-949a-0800200c9a66`;
export const ML_SERVICE = UUID('2800');
export const CH_RW = UUID('2810');   // notify (everything inbound) + write (REGISTER)
export const CH_WRITE = UUID('2820'); // write (outbound GFDI, handle byte first)
export const R10_NAME = 'Approach R10';
export const GARMIN_COMPANY = 0x0087;

export const MSG = { ACK: 5000, FIT_DEF: 5011, FIT_DATA: 5012, DEVICE_INFO: 5024, PB_REQUEST: 5043, PB_RESPONSE: 5044, CONFIG: 5050 };
const CAP_SWING_SENSOR = 30;

// ---------- bytes ----------
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const rd16 = (b, i) => b[i] | (b[i + 1] << 8);
const rd32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const lp = (s) => { const e = new TextEncoder().encode(s); return [e.length, ...e]; };

// ---------- CRC-16/ARC (nibble table) ----------
const T = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function crc16(data) {
  let c = 0;
  for (const b of data) {
    const t = ((c >> 4) & 0x0fff) ^ T[c & 0xf] ^ T[b & 0xf];
    c = ((t >> 4) & 0x0fff) ^ T[t & 0xf] ^ T[(b >> 4) & 0xf];
  }
  return c;
}

// ---------- COBS (standard, Cheshire & Baker) ----------
export function cobsEncode(data) {
  const out = []; let codeAt = 0, code = 1; out.push(0);
  for (const b of data) {
    if (b === 0) { out[codeAt] = code; codeAt = out.length; out.push(0); code = 1; continue; }
    out.push(b); code++;
    if (code === 0xff) { out[codeAt] = code; codeAt = out.length; out.push(0); code = 1; }
  }
  out[codeAt] = code;
  return Uint8Array.from(out);
}
export function cobsDecode(data) {
  const out = []; let i = 0;
  while (i < data.length) {
    const code = data[i++]; if (code === 0) break;
    for (let k = 1; k < code; k++) { if (i >= data.length) throw new Error('COBS: truncated'); out.push(data[i++]); }
    if (code < 0xff && i < data.length) out.push(0);
  }
  return Uint8Array.from(out);
}

// ---------- GFDI frames ----------
export function buildFrame(type, payload = []) {
  const body = [...u16(2 + 2 + payload.length + 2), ...u16(type), ...payload];
  return Uint8Array.from([...body, ...u16(crc16(body))]);
}
export const buildAck = (origType, status = 0, payload = []) => buildFrame(MSG.ACK, [...u16(origType), status, ...payload]);
export const wrap = (frame) => Uint8Array.from([0, ...cobsEncode(frame), 0]);

/** A decoded (post-COBS) frame -> { type, txn, payload } or throws. Handles the compressed header too. */
export function parseFrame(f) {
  if (f.length < 6) throw new Error('GFDI: frame too short');
  if (rd16(f, f.length - 2) !== crc16(f.subarray(0, f.length - 2))) throw new Error('GFDI: bad CRC');
  const compressed = (f[3] & 0x80) !== 0;
  return { type: compressed ? f[2] + 5000 : rd16(f, 2), txn: compressed ? f[3] & 0x7f : null, payload: f.slice(4, f.length - 2) };
}
/** COBS bytes between delimiters -> frame. Accepts both trailing-zero conventions seen in COBS encoders. */
export function parseCobs(bytes) {
  const d = cobsDecode(bytes);
  try { return parseFrame(d); } catch (e) {
    if (d.length && d[d.length - 1] === 0) return parseFrame(d.subarray(0, d.length - 1));
    throw e;
  }
}

/** Collects notification bytes (handle already stripped) and yields whole frames. */
export class StreamBuffer {
  constructor() { this.buf = []; }
  push(bytes) { for (const b of bytes) this.buf.push(b); if (this.buf.length > 65536) this.buf = []; }
  *frames() {
    for (;;) {
      const s = this.buf.indexOf(0); if (s < 0) return;
      const e = this.buf.indexOf(0, s + 1); if (e < 0) { if (s > 0) this.buf.splice(0, s); return; }
      const cobs = this.buf.slice(s + 1, e); this.buf.splice(0, e); // keep the closing 0: it can open the next frame
      if (!cobs.length) continue;
      try { yield parseCobs(Uint8Array.from(cobs)); } catch (err) { yield { error: err.message }; }
    }
  }
}

// ---------- MultiLink ----------
export const buildRegister = (txn = 1, service = 1) => Uint8Array.from([0, 0, ...u32(txn), 0, 0, 0, 0, ...u16(service), 0]);
/** -> { status, handle } for a REGISTER_RESPONSE, else null. */
export function parseRegisterResponse(b) {
  if (!b || b.length < 15 || b[1] !== 0x01) return null;
  return { status: b[12], handle: b[13] };
}
/** Split bytes into BLE writes, each starting with the handle (MTU 23 -> 20 bytes a write). */
export function chunk(bytes, handle, size = 20) {
  const out = [], n = size - 1;
  for (let i = 0; i < bytes.length; i += n) out.push(Uint8Array.from([handle, ...bytes.slice(i, i + n)]));
  return out;
}

// ---------- handshake ----------
export function parseDeviceInfo(p) {
  if (p.length < 12) return null;
  let i = 12; const str = () => { const n = p[i++] ?? 0; const s = new TextDecoder().decode(p.slice(i, i + n)); i += n; return s; };
  return { protocol: rd16(p, 0), product: rd16(p, 2), unit: rd32(p, 4), software: rd16(p, 8), maxPacket: rd16(p, 10), friendly: str(), device: str(), model: str() };
}
/** ACK of the device's 5024 with our host info (protocol 150 enables compressed headers). */
export const deviceInfoReply = () => buildAck(MSG.DEVICE_INFO, 0, [...u16(150), ...u16(0xffff), ...u32(0xffffffff), ...u16(100), ...u16(0xffff), ...lp('osolo'), ...lp('osolo'), ...lp('Phone'), 1]);
/** Our capabilities: a 13-byte bitmap with SwingSensor (bit 30), which the R10 requires. */
export function hostCapabilities() {
  const bm = new Array(13).fill(0); bm[CAP_SWING_SENSOR >> 3] |= 1 << (CAP_SWING_SENSOR & 7);
  return buildFrame(MSG.CONFIG, [bm.length, ...bm]);
}

// ---------- protobuf (just what the R10 uses) ----------
const varint = (v) => { const o = []; v = Math.floor(v); while (v > 127) { o.push((v & 127) | 128); v = Math.floor(v / 128); } o.push(v); return o; };
const field = (n, bytes) => [...varint((n << 3) | 2), ...varint(bytes.length), ...bytes];
const f32 = (n, v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return [...varint((n << 3) | 5), ...b]; };
const vfield = (n, v) => [...varint(n << 3), ...varint(v)];

/** One message -> Map(field -> [values]). Values: numbers (varint), {f32} (fixed32), Uint8Array (bytes). */
export function pbDecode(b) {
  const m = new Map(); let i = 0;
  const rv = () => { let r = 0, mul = 1, x; do { x = b[i++]; if (x === undefined) throw new Error('protobuf: truncated'); r += (x & 127) * mul; mul *= 128; } while (x & 128); return r; };
  while (i < b.length) {
    const tag = rv(), n = Math.floor(tag / 8), wt = tag & 7; let v;
    if (wt === 0) v = rv();
    else if (wt === 5) { v = { f32: new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true) }; i += 4; }
    else if (wt === 1) { i += 8; continue; }
    else if (wt === 2) { const len = rv(); v = b.subarray(i, i + len); i += len; }
    else throw new Error(`protobuf: wire type ${wt}`);
    if (!m.has(n)) m.set(n, []); m.get(n).push(v);
  }
  return m;
}
const one = (m, n) => m.get(n)?.[0];
const sub = (m, n) => { const v = one(m, n); return v instanceof Uint8Array ? pbDecode(v) : null; };
const flt = (m, n) => { const v = one(m, n); return v && typeof v === 'object' && 'f32' in v ? Math.round(v.f32 * 1000) / 1000 : null; };
const num = (m, n) => { const v = one(m, n); return typeof v === 'number' ? v : null; };

export const pbSubscribe = () => Uint8Array.from(field(30, field(1, field(1, vfield(1, 8)))));
export const pbWake = () => Uint8Array.from(field(38, field(3, [])));
/** Environment for the R10's flight model: { tempC, humidity (0-1), elevationM, airDensity, teeYd }. */
export function pbEnvironment(e = {}) {
  const inner = [];
  [[1, e.tempC], [2, e.humidity], [3, e.elevationM], [4, e.airDensity], [5, e.teeYd]].forEach(([n, v]) => { if (Number.isFinite(v)) inner.push(...f32(n, v)); });
  return Uint8Array.from(field(38, field(11, inner)));
}
/** A 5043 request carrying one protobuf message (the R10's are always one fragment). */
export const pbRequest = (reqId, pb) => buildFrame(MSG.PB_REQUEST, [...u16(reqId), ...u32(0), ...u32(pb.length), ...u32(pb.length), ...pb]);

export const PHASES = ['idle', 'noise check', 'armed', 'capturing', 'analysing', 'faulted'];
const FAULTS = { 0: 'Something went wrong on the R10', 1: 'The R10 is too hot. Let it cool down', 2: 'Radar overloaded: move it away from metal or reflective surfaces', 3: 'The R10 isn\'t level. Re-level it' };

/** A 5043/5044 payload -> one event: shot, state, fault, level, subscribed, woke, environment or null. */
export function decodeMessage(payload) {
  if (payload.length < 14) return null;
  const size = rd32(payload, 10), env = pbDecode(payload.subarray(14, 14 + size));
  const alerts = sub(env, 30), mon = sub(env, 38);
  if (alerts) {
    const res = sub(alerts, 2);
    if (res) return { type: 'subscribed', ok: (res.get(1) || []).every((o) => num(pbDecode(o), 1) === 0) };
    const note = sub(alerts, 3), rep = note && sub(note, 1001);
    if (!rep) return null;
    const status = sub(rep, 1), shot = sub(rep, 2), fault = sub(rep, 3), level = sub(rep, 4);
    if (shot) return { type: 'shot', shot: readShot(shot) };
    if (status) return { type: 'state', phase: num(status, 1) ?? 0 };
    if (fault) { const c = num(fault, 1) ?? 0, o = sub(fault, 3); return { type: 'fault', cause: c, text: FAULTS[c] || FAULTS[0], urgency: num(fault, 2) ?? 0, tilt: o ? { roll: flt(o, 1), pitch: flt(o, 2) } : null }; }
    if (level) return { type: 'level', verdict: num(level, 1), attempt: num(level, 2) };
    return null;
  }
  if (mon) {
    const wake = sub(mon, 4); if (wake) return { type: 'woke', outcome: num(wake, 1) ?? 0 };
    const envr = sub(mon, 12); if (envr) return { type: 'environment', ok: num(envr, 1) === 1 };
    const st = sub(mon, 2), s2 = st && sub(st, 1); if (s2) return { type: 'state', phase: num(s2, 1) ?? 0 };
  }
  return null;
}

/** The raw shot as the R10 sends it (metres per second, degrees, rpm; spin tilt + = left). */
function readShot(s) {
  const ball = sub(s, 3), club = sub(s, 4), t = sub(s, 5);
  return {
    number: num(s, 1), kind: num(s, 2), // 0 warm-up, 1 regular, null not sent
    ball: ball && { vla: flt(ball, 1), hla: flt(ball, 2), speed: flt(ball, 3), tilt: flt(ball, 4), spin: flt(ball, 5), spinSource: num(ball, 6), marking: num(ball, 7) },
    club: club && { speed: flt(club, 1), face: flt(club, 2), path: flt(club, 3), attack: flt(club, 4) },
    timing: t && { takeaway: num(t, 1), transition: num(t, 2), impact: num(t, 3), finish: num(t, 4) },
  };
}

const MPH = 2.236936;
const r1 = (v) => (v == null ? undefined : Math.round(v * 10) / 10);
/**
 * A shot as an osolo launch row (mph, degrees, rpm; direction and spin axis + = right, so a slice is +).
 * carry/apex/descent come from osolo's flight model (`simulate`), because the R10 doesn't send a result
 * over Bluetooth; they're marked computed.
 */
export function shotRow(shot, simulate = null, air = {}) {
  const b = shot.ball || {}, c = shot.club || {}, row = { shot: shot.number };
  if (b.speed > 0) row.ballSpeed = r1(b.speed * MPH);
  if (c.speed > 0) row.clubSpeed = r1(c.speed * MPH);
  if (row.ballSpeed && row.clubSpeed) row.smash = Math.round((row.ballSpeed / row.clubSpeed) * 100) / 100;
  if (b.vla != null) row.launch = r1(b.vla);
  if (b.hla != null) row.azimuth = r1(b.hla);
  if (b.spin > 0) {
    const axis = -(b.tilt || 0), rad = (axis * Math.PI) / 180;
    row.spin = Math.round(b.spin); row.spinAxis = r1(axis);
    row.backSpin = Math.round(b.spin * Math.cos(rad)); row.sideSpin = Math.round(b.spin * Math.sin(rad));
    row.spinMeasured = b.spinSource === 3;
  }
  // a slow swing sends club angles of exactly 0: not measured
  if (c.speed > 0 && !(c.face === 0 && c.path === 0 && c.attack === 0)) { row.face = r1(c.face); row.path = r1(c.path); row.attack = r1(c.attack); }
  if (simulate && row.ballSpeed && row.launch != null && row.backSpin != null) {
    const f = simulate({ ballSpeed: row.ballSpeed, launch: row.launch, spin: row.backSpin, ...air });
    if (f) { row.carry = f.carry; row.apex = f.apex; row.descent = f.descent; row.computed = true; }
  }
  if (shot.kind === 0) row.warmup = true;
  return row;
}

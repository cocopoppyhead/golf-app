// Garmin R10 protocol and session. The envelope fixtures are byte-exact protobuf payloads from the 10over
// project's golden tests (github.com/divotmaker/10over, MIT/Apache-2.0), recorded against a real R10; the
// device side of the handshake is simulated from its wire documentation.
import { describe, it, expect } from 'vitest';
import { crc16, cobsEncode, cobsDecode, buildFrame, buildAck, parseFrame, parseCobs, wrap, chunk, StreamBuffer, buildRegister, pbSubscribe, pbWake, pbEnvironment, pbRequest, decodeMessage, shotRow, MSG, CH_RW, CH_WRITE } from '../../src/r10/protocol.js';
import { R10Session } from '../../src/r10/session.js';
import { simulate } from '../../src/flight.js';

const B = (a) => Uint8Array.from(a);
const SUBSCRIBE = B([0xf2, 0x01, 0x06, 0x0a, 0x04, 0x0a, 0x02, 0x08, 0x08]);
const WAKEUP = B([0xb2, 0x02, 0x02, 0x1a, 0x00]);
const ENV_TEE = B([0xb2, 0x02, 0x07, 0x5a, 0x05, 0x2d, 0x33, 0x33, 0x13, 0x40]);
const ENV_ALL = B([0xb2, 0x02, 0x1b, 0x5a, 0x19, 0x0d, 0x00, 0x00, 0xa8, 0x41, 0x15, 0x66, 0x66, 0xe6, 0x3e, 0x1d, 0x00, 0x00, 0xf0, 0x42, 0x25, 0x9a, 0x99, 0x99, 0x3f, 0x2d, 0x00, 0x00, 0xc0, 0x40]);
const SHOT_FULL = B([
  0xf2, 0x01, 0x53, 0x1a, 0x51, 0x08, 0x08, 0xca, 0x3e, 0x4c, 0x12, 0x4a, 0x08, 0x2a, 0x10, 0x01,
  0x1a, 0x1d, 0x0d, 0x00, 0x00, 0x48, 0x41, 0x15, 0x9a, 0x99, 0x99, 0xbf, 0x1d, 0x00, 0x00, 0x86,
  0x42, 0x25, 0x00, 0x00, 0xa0, 0x40, 0x2d, 0x00, 0x00, 0x2f, 0x45, 0x30, 0x00, 0x38, 0x01, 0x22,
  0x14, 0x0d, 0x00, 0x00, 0x30, 0x42, 0x15, 0x00, 0x00, 0xc0, 0x3f, 0x1d, 0x00, 0x00, 0x00, 0xc0,
  0x25, 0x00, 0x00, 0x60, 0xc0, 0x2a, 0x0f, 0x08, 0xe8, 0x07, 0x10, 0xdc, 0x0b, 0x18, 0x88, 0x0e,
  0x20, 0x98, 0x11, 0x28, 0xc4, 0x13]);
const SHOT_WARMUP_MEASURED = B([
  0xf2, 0x01, 0x2c, 0x1a, 0x2a, 0x08, 0x08, 0xca, 0x3e, 0x25, 0x12, 0x23, 0x08, 0x07, 0x10, 0x00,
  0x1a, 0x1d, 0x0d, 0x00, 0x00, 0xf2, 0x41, 0x15, 0x00, 0x00, 0x20, 0x40, 0x1d, 0x00, 0x00, 0xcc,
  0x41, 0x25, 0x00, 0x00, 0x20, 0xc1, 0x2d, 0x00, 0x80, 0xbb, 0x45, 0x30, 0x03, 0x38, 0x02]);
const ERROR_NOT_LEVEL = B([0xf2, 0x01, 0x19, 0x1a, 0x17, 0x08, 0x08, 0xca, 0x3e, 0x12, 0x1a, 0x10, 0x08, 0x03, 0x10, 0x02, 0x1a, 0x0a, 0x0d, 0x00, 0x00, 0x90, 0x40, 0x15, 0x00, 0x00, 0xc8, 0xc0]);
const SUBSCRIBE_OK = B([0xf2, 0x01, 0x0a, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x00, 0x12, 0x02, 0x08, 0x08]);
const SUBSCRIBE_FAIL = B([0xf2, 0x01, 0x0a, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x01, 0x12, 0x02, 0x08, 0x08]);
const state = (s) => B([0xf2, 0x01, 0x0b, 0x1a, 0x09, 0x08, 0x08, 0xca, 0x3e, 0x04, 0x0a, 0x02, 0x08, s]);
const wakeResult = (s) => B([0xb2, 0x02, 0x04, 0x22, 0x02, 0x08, s]);
const frag = (pb) => B([...pbRequest(0, pb).slice(4, -2)]); // the 5043 payload: 14-byte header + protobuf

describe('R10 wire basics', () => {
  it('CRC-16/ARC check value', () => expect(crc16(new TextEncoder().encode('123456789'))).toBe(0xbb3d));

  it('COBS round-trips, zeros included, and never emits a zero', () => {
    for (const d of [[], [1, 2, 3], [0], [5, 0], [0, 0, 7], Array.from({ length: 300 }, (_, i) => i % 256)]) {
      const e = cobsEncode(B(d)); expect([...e].includes(0)).toBe(false); expect([...cobsDecode(e)]).toEqual(d);
    }
  });

  it('frames, ACKs and the compressed header', () => {
    const f = buildFrame(5024, [1, 2, 3]); expect(parseFrame(f)).toEqual({ type: 5024, txn: null, payload: B([1, 2, 3]) });
    const a = parseFrame(buildAck(5050, 0, [])); expect(a.type).toBe(MSG.ACK); expect([...a.payload]).toEqual([0xba, 0x13, 0]);
    const ok = [8, 0, 43, 0x85, 9, 9]; const crc = crc16(B(ok)); expect(parseFrame(B([...ok, crc & 0xff, crc >> 8]))).toMatchObject({ type: 5043, txn: 5 });
    expect(() => parseFrame(B([8, 0, 1, 2, 3, 4, 0, 0]))).toThrow(/CRC/);
  });

  it('accepts a frame whose encoder added a trailing zero', () => {
    const f = buildFrame(5050, [1]); const withZero = cobsEncode(B([...f, 0]));
    expect(parseCobs(withZero).type).toBe(5050);
  });

  it('reassembles frames split across notifications', () => {
    const sb = new StreamBuffer(), w = [...wrap(buildFrame(5024, [7])), ...wrap(buildFrame(5050, [8]))];
    sb.push(B(w.slice(0, 5))); expect([...sb.frames()]).toEqual([]);
    sb.push(B(w.slice(5))); expect([...sb.frames()].map((f) => f.type)).toEqual([5024, 5050]);
  });

  it('puts the handle on every chunk', () => {
    const c = chunk(B(Array.from({ length: 45 }, (_, i) => i)), 3);
    expect(c.length).toBe(3); expect(c.every((x) => x[0] === 3 && x.length <= 20)).toBe(true);
  });

  it('builds the exact protobuf the R10 expects', () => {
    expect([...pbSubscribe()]).toEqual([...SUBSCRIBE]);
    expect([...pbWake()]).toEqual([...WAKEUP]);
    expect([...pbEnvironment({ teeYd: 2.3 })]).toEqual([...ENV_TEE]);
    expect([...pbEnvironment({ tempC: 21, humidity: 0.45, elevationM: 120, airDensity: 1.2, teeYd: 6 })]).toEqual([...ENV_ALL]);
    expect([...buildRegister(1, 1)]).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
  });
});

describe('R10 messages', () => {
  it('decodes a full shot', () => {
    const { shot } = decodeMessage(frag(SHOT_FULL));
    expect(shot.number).toBe(42); expect(shot.kind).toBe(1);
    expect(shot.ball).toMatchObject({ vla: 12.5, hla: -1.2, speed: 67, tilt: 5, spin: 2800, spinSource: 0 });
    expect(shot.club).toMatchObject({ speed: 44, face: 1.5, path: -2, attack: -3.5 });
    expect(shot.timing).toMatchObject({ takeaway: 1000, transition: 1500, impact: 1800, finish: 2200 });
  });

  it('turns it into an osolo row: mph, + = right, carry computed', () => {
    const row = shotRow(decodeMessage(frag(SHOT_FULL)).shot, simulate);
    expect(row.ballSpeed).toBeCloseTo(149.9, 1); expect(row.clubSpeed).toBeCloseTo(98.4, 1); expect(row.smash).toBeCloseTo(1.52, 2);
    expect(row.launch).toBe(12.5); expect(row.azimuth).toBe(-1.2);
    expect(row.spinAxis).toBe(-5); expect(row.backSpin).toBe(2789); expect(row.sideSpin).toBe(-244); // tilted left: curving left
    expect(row.face).toBe(1.5); expect(row.path).toBe(-2); expect(row.attack).toBe(-3.5);
    expect(row.computed).toBe(true); expect(row.carry).toBeGreaterThan(200); expect(row.carry).toBeLessThan(290);
  });

  it('marks warm-ups and measured spin', () => {
    const row = shotRow(decodeMessage(frag(SHOT_WARMUP_MEASURED)).shot);
    expect(row.warmup).toBe(true); expect(row.spinMeasured).toBe(true); expect(row.spin).toBe(6000);
  });

  it('decodes state, faults, subscribe and wake replies', () => {
    expect(decodeMessage(frag(state(2)))).toEqual({ type: 'state', phase: 2 });
    expect(decodeMessage(frag(ERROR_NOT_LEVEL))).toMatchObject({ type: 'fault', cause: 3, tilt: { roll: 4.5, pitch: -6.25 } });
    expect(decodeMessage(frag(SUBSCRIBE_OK))).toEqual({ type: 'subscribed', ok: true });
    expect(decodeMessage(frag(SUBSCRIBE_FAIL))).toEqual({ type: 'subscribed', ok: false });
    expect(decodeMessage(frag(wakeResult(1)))).toEqual({ type: 'woke', outcome: 1 });
  });
});

describe('R10 session (simulated device)', () => {
  const setup = () => {
    const writes = [], events = [];
    const s = new R10Session({ write: async (ch, b) => { writes.push({ ch, b }); }, onEvent: (e) => events.push(e) });
    const dev = (frame) => { for (const c of chunk(wrap(frame), 1)) s.feed(c); };
    const host = () => { const sb = new StreamBuffer(); for (const w of writes.filter((x) => x.ch === CH_WRITE)) sb.push(w.b.subarray(1)); return [...sb.frames()]; };
    const flush = () => s.queue;
    return { s, writes, events, dev, host, flush };
  };
  const info = () => { const p = [150, 0, 0x26, 0x0e, 1, 2, 3, 4, 10, 0, 0xff, 0xff]; for (const t of ['R10', 'Approach R10', 'R10']) p.push(t.length, ...new TextEncoder().encode(t)); return buildFrame(5024, p); };

  it('handshakes, subscribes, wakes, and reports each shot once', async () => {
    const { s, writes, events, dev, host, flush } = setup();
    await s.start();
    expect(writes[0]).toEqual({ ch: CH_RW, b: buildRegister(1, 1) });
    s.feed(B([0x00, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00]));
    expect(s.handle).toBe(1);

    dev(info()); await flush();
    let h = host(); expect(h[0].type).toBe(MSG.ACK); expect(h[0].payload[0] | (h[0].payload[1] << 8)).toBe(5024);
    expect(s.device.product).toBe(3622);

    dev(buildFrame(5050, [2, 0xff, 0xff])); await flush();
    h = host(); const caps = h.find((f) => f.type === 5050); expect(caps.payload[0]).toBe(13); expect(caps.payload[1 + 3] & 0x40).toBe(0x40); // bit 30

    dev(buildAck(5050, 0, [])); await flush();
    h = host(); const sub = h.filter((f) => f.type === MSG.PB_REQUEST).pop(); expect([...sub.payload.slice(14)]).toEqual([...SUBSCRIBE]);

    dev(buildFrame(MSG.PB_RESPONSE, frag(SUBSCRIBE_OK))); await flush();
    h = host(); expect([...h.filter((f) => f.type === MSG.PB_REQUEST).pop().payload.slice(14)]).toEqual([...WAKEUP]);

    dev(buildFrame(MSG.PB_RESPONSE, frag(wakeResult(0))));
    dev(buildFrame(MSG.PB_REQUEST, frag(state(2))));
    expect(events.some((e) => e.type === 'ready')).toBe(true);

    dev(buildFrame(MSG.PB_REQUEST, frag(SHOT_FULL)));
    dev(buildFrame(MSG.PB_REQUEST, frag(SHOT_FULL))); // the R10 resends alerts it thinks weren't ACKed
    await flush();
    expect(events.filter((e) => e.type === 'shot').length).toBe(1);
    // every device message was acknowledged
    expect(host().filter((f) => f.type === MSG.ACK).length).toBeGreaterThanOrEqual(6);
  });

  it('wakes the radar again if it dozes off, and reports faults', async () => {
    const { s, events, dev, host, flush } = setup();
    await s.start(); s.feed(B([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]));
    s.phase = 'active'; s.lastState = 2;
    dev(buildFrame(MSG.PB_REQUEST, frag(state(0)))); await flush();
    expect([...host().filter((f) => f.type === MSG.PB_REQUEST).pop().payload.slice(14)]).toEqual([...WAKEUP]);
    dev(buildFrame(MSG.PB_REQUEST, frag(ERROR_NOT_LEVEL)));
    expect(events.find((e) => e.type === 'fault').text).toMatch(/level/);
  });

  it('explains a refused registration', async () => {
    const { s, events } = setup(); await s.start();
    s.feed(B([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0]));
    expect(events.find((e) => e.type === 'error').text).toMatch(/Garmin Golf/);
  });
});

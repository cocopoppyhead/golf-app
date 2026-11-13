// One R10 session: MultiLink registration, the GFDI handshake, subscribe to shots, wake the radar, then
// shots arrive by themselves. Transport-agnostic: give it write(char, bytes) and feed it every notification
// from the 2810 characteristic. Events: { type: 'status' | 'ready' | 'state' | 'shot' | 'fault' | 'error', ... }.
import { CH_RW, CH_WRITE, MSG, buildRegister, parseRegisterResponse, StreamBuffer, wrap, chunk, buildAck, deviceInfoReply, parseDeviceInfo, hostCapabilities, pbRequest, pbSubscribe, pbWake, pbEnvironment, decodeMessage, PHASES } from './protocol.js';

const DEDUP_MS = 60000;

export class R10Session {
  constructor({ write, onEvent = () => {}, chunkSize = 20, environment = null }) {
    this.write = write; this.emit = onEvent; this.size = chunkSize; this.env = environment;
    this.phase = 'registering'; this.handle = null; this.buf = new StreamBuffer(); this.req = 1;
    this.queue = Promise.resolve(); this.seen = new Map(); this.lastState = null; this.device = null;
  }

  /** Writes go one after another (BLE can't take two at once). */
  send(char, bytes) { this.queue = this.queue.then(() => this.write(char, bytes)).catch((e) => this.emit({ type: 'error', text: e.message || String(e) })); return this.queue; }
  sendFrame(frame) { for (const c of chunk(wrap(frame), this.handle, this.size)) this.send(CH_WRITE, c); }
  request(pb) { this.sendFrame(pbRequest(this.req++ & 0xffff, pb)); }

  start() { this.emit({ type: 'status', text: 'Connecting to the R10…' }); return this.send(CH_RW, buildRegister(1, 1)); }

  /** Every notification from 2810. */
  feed(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this.handle == null) {
      const r = parseRegisterResponse(bytes);
      if (!r) return;
      if (r.status !== 0) return this.emit({ type: 'error', text: `The R10 refused the connection (code ${r.status}). Close the Garmin Golf app and try again.` });
      this.handle = r.handle; this.phase = 'device-info';
      return;
    }
    if (bytes[0] !== this.handle) return; // another MultiLink channel
    this.buf.push(bytes.subarray(1));
    for (const f of this.buf.frames()) { if (f.error) this.emit({ type: 'log', text: f.error }); else this.frame(f); }
  }

  frame(f) {
    switch (f.type) {
      case MSG.DEVICE_INFO:
        this.device = parseDeviceInfo(f.payload);
        this.sendFrame(deviceInfoReply()); this.phase = 'capabilities';
        this.emit({ type: 'status', text: 'Handshake…' });
        break;
      case MSG.FIT_DEF: case MSG.FIT_DATA:
        this.sendFrame(buildAck(f.type, 0, [0]));
        break;
      case MSG.CONFIG:
        this.sendFrame(buildAck(MSG.CONFIG, 0, [])); this.sendFrame(hostCapabilities()); this.phase = 'capabilities-ack';
        break;
      case MSG.ACK: {
        const p = f.payload; if (p.length < 3) break;
        const orig = p[0] | (p[1] << 8), status = p[2];
        if (status !== 0) { this.emit({ type: 'error', text: `The R10 rejected message ${orig} (status ${status}).` }); break; }
        if (orig === MSG.CONFIG && this.phase === 'capabilities-ack') { this.phase = 'subscribing'; this.request(pbSubscribe()); }
        break;
      }
      case MSG.PB_REQUEST: case MSG.PB_RESPONSE: {
        let ev = null;
        try { ev = decodeMessage(f.payload); } catch (e) { this.emit({ type: 'log', text: e.message }); }
        this.sendFrame(buildAck(f.type, 0, [])); // unacknowledged alerts are sent again
        if (ev) this.message(ev);
        break;
      }
      default: break;
    }
  }

  message(ev) {
    if (ev.type === 'subscribed') {
      if (!ev.ok) this.emit({ type: 'error', text: 'The R10 wouldn\'t send shot data.' });
      if (this.phase === 'subscribing') { this.phase = 'waking'; this.request(pbWake()); this.emit({ type: 'status', text: 'Waking the radar…' }); }
    } else if (ev.type === 'woke') {
      if (this.phase === 'waking') { this.phase = 'active'; if (this.env) this.request(pbEnvironment(this.env)); }
      if (ev.outcome === 1) { this.lastState = 2; this.emit({ type: 'ready' }); } // already armed: no state change will come
      if (ev.outcome === 2) this.emit({ type: 'error', text: 'The R10 didn\'t wake. Press its power button and connect again.' });
    } else if (ev.type === 'state') {
      if (ev.phase === this.lastState) return;
      this.lastState = ev.phase;
      if (ev.phase === 2) this.emit({ type: 'ready' });
      else if (ev.phase === 0 && this.phase === 'active') this.request(pbWake()); // dozed off: wake it again
      this.emit({ type: 'state', phase: ev.phase, name: PHASES[ev.phase] || String(ev.phase) });
    } else if (ev.type === 'shot') {
      const now = Date.now(), n = ev.shot.number;
      for (const [k, t] of this.seen) if (now - t > DEDUP_MS) this.seen.delete(k);
      if (n != null && this.seen.has(n)) return; // retransmitted
      if (n != null) this.seen.set(n, now);
      this.emit({ type: 'shot', shot: ev.shot });
    } else this.emit(ev);
  }

  /** Air and tee distance for the R10's own model (optional). */
  setEnvironment(env) { this.env = env; if (this.phase === 'active') this.request(pbEnvironment(env)); }
}

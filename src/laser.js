// Bushnell Pro X3 / X3+ over Web Bluetooth.
// Protocol from a friend's working Android app (tested on a Pro X3+ LINK; unconfirmed on the X3):
//   characteristic 3dd92622-b3cc-458b-9093-0e842dd41bcd, indications,
//   20 bytes = 5 little-endian float32: raw yards, slope %, heading °, plays-as yards, incline.
// Web Bluetooth works in Chrome on Android (and desktop). iPhone Safari has none.

import { isNative, nativeSend, onNative } from './native.js';
import { getSettings, saveSettings } from './store.js';
import { learnFrom, applyProfile } from './laserlearn.js';

const CHAR = '3dd92622-b3cc-458b-9093-0e842dd41bcd';
// Parent service, confirmed on Conor's Pro X3 (9 Nov 2026 log). Older guess kept as a fallback.
const SERVICE = '9f3f46a7-fcc2-4562-83a3-716e06a38bc5';
const SERVICES = [SERVICE, ...Array.from({ length: 256 }, (_, i) => `3dd926${i.toString(16).padStart(2, '0')}-b3cc-458b-9093-0e842dd41bcd`)];

export const laserSupported = () => isNative() || !!navigator.bluetooth;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

let dev = null;
const listeners = new Set();
const logLines = [];
const log = (s) => { logLines.push(`${new Date().toLocaleTimeString()} ${s}`); if (logLines.length > 60) logLines.shift(); };
export const laserLog = () => logLines.join('\n');
export const onLaser = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
let nativeState = { connected: false, name: '' };
export const laserConnected = () => (isNative() ? nativeState.connected : !!dev?.gatt?.connected);
export const laserName = () => (isNative() ? nativeState.name : dev?.name || '');

// ---- Native app (Expo shell) path: works on iPhone and Android ----
let nativeStatus = () => {};
const b64ToView = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new DataView(u.buffer); };
onNative('laser.status', (m) => nativeStatus(m.text));
onNative('laser.log', (m) => log(m.text));
onNative('laser.error', (m) => { log(`error: ${m.text}`); nativeStatus(m.text); });
onNative('laser.connected', (m) => {
  nativeState = { connected: true, name: m.name, known: !!m.known };
  log(`listening (${m.name}) on ${(m.chars || []).length} channel(s)`);
  const prof = profileFor(m.name);
  nativeStatus(m.known ? `Connected to ${m.name}. Lock on to a target.` : prof ? `Connected to ${m.name} (learned). Lock on to a target.` : `Connected to ${m.name}. This one needs teaching: laser a target and type the number you see.`);
});
onNative('laser.disconnected', () => { nativeState = { connected: false, name: '' }; log('disconnected'); nativeStatus('Disconnected'); listeners.forEach((fn) => fn(null)); });
onNative('laser.found', (m) => foundCb(m.devices || []));
onNative('laser.scanDone', () => foundCb(null));
const recent = []; // packets from unknown devices, kept briefly for teaching
onNative('laser.packet', (m) => {
  const v = b64ToView(m.b64);
  const bytes = new Uint8Array(v.buffer);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const char = m.char || CHAR;
  let r = null;
  if (char === CHAR) r = decode(v);
  else {
    const prof = profileFor(nativeState.name);
    if (prof && prof.char === char) r = applyProfile(prof, bytes);
    recent.push({ t: Date.now(), char, bytes });
    while (recent.length > 40 || (recent.length && Date.now() - recent[0].t > 20000)) recent.shift();
  }
  log(`packet ${char.slice(0, 8)} ${hex}${r ? ` → ${r.raw.toFixed(1)} y` : ''}${m.accepted ? ' (✓ from notification)' : ''}`);
  if (r) listeners.forEach((fn) => fn(r, { accepted: !!m.accepted, other: !!m.other, t: m.t || Date.now() }));
});

// ---- learned rangefinders (Blue Tees, Shot Scope, anything that sends the number) ----
const profiles = () => getSettings().laserProfiles || {};
const profileFor = (name) => (name ? profiles()[name] : null);
export const laserKnown = () => isNative() ? (nativeState.known || !!profileFor(nativeState.name)) : laserConnected();
export const laserNeedsTeaching = () => isNative() && nativeState.connected && !laserKnown();
let teachState = null;
/**
 * You lasered something and the screen showed `value` (in the units shown on the rangefinder).
 * Narrows down which bytes carry the distance; saves the device once one reading pattern fits 2+ times.
 */
export function teachLaser(value, unit = 'y') {
  const name = nativeState.name;
  if (!name) return { done: false, msg: 'Connect the rangefinder first.' };
  const win = recent.filter((p) => Date.now() - p.t < 12000);
  if (!win.length) return { done: false, msg: 'No signal from the rangefinder in the last few seconds. Laser the target again, then type the number straight away.' };
  teachState = learnFrom(teachState, win, +value, unit);
  if (teachState.profile) {
    const s = getSettings(); s.laserProfiles = { ...profiles(), [name]: teachState.profile }; saveSettings(s);
    teachState = null;
    log(`learned ${name}: ${JSON.stringify(s.laserProfiles[name])}`);
    return { done: true, msg: `Learned. ${name} now feeds distances straight in.` };
  }
  return { done: false, msg: teachState.left ? `Got it. ${teachState.left} possible patterns left. Laser a different distance and type it again.` : 'That number wasn\'t found in what the rangefinder sent. Copy the log and send it to Claude.' };
}
export function forgetLaser(name = nativeState.name) { const s = getSettings(); const p = { ...profiles() }; delete p[name]; s.laserProfiles = p; saveSettings(s); }

let foundCb = () => {};
/** Native app only: list nearby Bluetooth devices. cb(list) repeatedly, cb(null) when the scan ends. */
export function scanLasers(cb) { foundCb = cb; nativeSend({ type: 'laser.scan' }); }

export function decode(dv) {
  if (dv.byteLength < 20) return null;
  const f = (i) => dv.getFloat32(i * 4, true);
  const r = { raw: f(0), slope: f(1), heading: f(2), playsAs: f(3), incline: f(4) };
  return Number.isFinite(r.raw) && r.raw > 0 && r.raw < 2000 ? r : null;
}

export async function connectLaser(onStatus = () => {}, { id } = {}) {
  if (isNative()) { nativeStatus = onStatus; onStatus('Starting…'); nativeSend({ type: 'laser.connect', id }); return true; }
  if (!navigator.bluetooth) throw new Error(isIOS() ? 'iPhone browsers can\'t use Bluetooth. Use Chrome on Android, or the free Bluefy browser on iPhone.' : 'This browser has no Bluetooth. Use Chrome.');
  onStatus('Pick your Bushnell…');
  dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  log(`device ${dev.name || '(no name)'}`);
  dev.addEventListener('gattserverdisconnected', () => { log('disconnected'); onStatus('Disconnected'); listeners.forEach((fn) => fn(null)); });
  onStatus('Connecting…');
  const gatt = await dev.gatt.connect();
  const services = await gatt.getPrimaryServices().catch(() => []);
  log(`services visible: ${services.map((s) => s.uuid).join(', ') || 'none'}`);
  for (const s of services) {
    try {
      const c = await s.getCharacteristic(CHAR);
      await c.startNotifications();
      c.addEventListener('characteristicvaluechanged', (e) => {
        const v = e.target.value;
        const hex = [...new Uint8Array(v.buffer)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
        const r = decode(new DataView(v.buffer.slice(0)));
        log(`packet ${hex}${r ? ` → ${r.raw.toFixed(1)} y, plays ${r.playsAs.toFixed(1)}` : ''}`);
        if (r) listeners.forEach((fn) => fn(r));
      });
      log(`listening on ${s.uuid}`);
      onStatus(`Connected to ${dev.name || 'laser'}. Lock on to a target.`);
      return true;
    } catch { /* not in this service */ }
  }
  onStatus('Connected, but the distance signal wasn\'t found. Copy the log and send it to Claude.');
  return false;
}

export function disconnectLaser() {
  if (isNative()) return nativeSend({ type: 'laser.disconnect' });
  try { dev?.gatt?.disconnect(); } catch {}
}

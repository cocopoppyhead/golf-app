// Bushnell Pro X3 / X3+ over Web Bluetooth.
// Protocol from a friend's working Android app (tested on a Pro X3+ LINK; unconfirmed on the X3):
//   characteristic 3dd92622-b3cc-458b-9093-0e842dd41bcd, indications,
//   20 bytes = 5 little-endian float32: raw yards, slope %, heading °, plays-as yards, incline.
// Web Bluetooth works in Chrome on Android (and desktop). iPhone Safari has none.

const CHAR = '3dd92622-b3cc-458b-9093-0e842dd41bcd';
// The parent service UUID isn't in his code. Vendors share the suffix, so ask for the whole block.
const SERVICES = Array.from({ length: 256 }, (_, i) => `3dd926${i.toString(16).padStart(2, '0')}-b3cc-458b-9093-0e842dd41bcd`);

export const laserSupported = () => !!navigator.bluetooth;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

let dev = null;
const listeners = new Set();
const logLines = [];
const log = (s) => { logLines.push(`${new Date().toLocaleTimeString()} ${s}`); if (logLines.length > 60) logLines.shift(); };
export const laserLog = () => logLines.join('\n');
export const onLaser = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const laserConnected = () => !!dev?.gatt?.connected;
export const laserName = () => dev?.name || '';

export function decode(dv) {
  if (dv.byteLength < 20) return null;
  const f = (i) => dv.getFloat32(i * 4, true);
  const r = { raw: f(0), slope: f(1), heading: f(2), playsAs: f(3), incline: f(4) };
  return Number.isFinite(r.raw) && r.raw > 0 && r.raw < 2000 ? r : null;
}

export async function connectLaser(onStatus = () => {}) {
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

export function disconnectLaser() { try { dev?.gatt?.disconnect(); } catch {} }

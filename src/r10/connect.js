// Connecting to the R10: Web Bluetooth in Chrome (Android, desktop), or the osolo app's native Bluetooth.
// Both just move bytes; R10Session (session.js) speaks the protocol.
import { ML_SERVICE, CH_RW, CH_WRITE, R10_NAME, GARMIN_COMPANY } from './protocol.js';
import { R10Session } from './session.js';
import { isNative, nativeSend, onNative, blobToBase64 } from '../native.js';

export const r10Supported = () => isNative() || !!navigator.bluetooth;
const b64 = (bytes) => blobToBase64(new Blob([bytes]));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Connect and start a session. onEvent gets session events plus { type: 'connected', name } and
 * { type: 'disconnected' }. Resolves with { session, disconnect }.
 */
export async function connectR10({ onEvent = () => {}, environment = null } = {}) {
  if (isNative()) return connectNative(onEvent, environment);
  if (!navigator.bluetooth) throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone browsers can\'t use Bluetooth. Use the osolo app.' : 'This browser has no Bluetooth. Use Chrome, or the osolo app.');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: R10_NAME }, { manufacturerData: [{ companyIdentifier: GARMIN_COMPANY }] }], optionalServices: [ML_SERVICE] });
  onEvent({ type: 'status', text: 'Connecting…' });
  const gatt = await device.gatt.connect();
  const svc = await gatt.getPrimaryService(ML_SERVICE);
  const rw = await svc.getCharacteristic(CH_RW), wr = await svc.getCharacteristic(CH_WRITE);
  const write = (char, bytes) => {
    const c = char === CH_RW ? rw : wr;
    return c.properties.write ? c.writeValueWithResponse(bytes) : c.writeValueWithoutResponse(bytes);
  };
  const session = new R10Session({ write, onEvent, environment });
  rw.addEventListener('characteristicvaluechanged', (e) => session.feed(new Uint8Array(e.target.value.buffer.slice(e.target.value.byteOffset, e.target.value.byteOffset + e.target.value.byteLength))));
  device.addEventListener('gattserverdisconnected', () => onEvent({ type: 'disconnected' }));
  await rw.startNotifications();
  onEvent({ type: 'connected', name: device.name || 'Approach R10' });
  await session.start();
  return { session, name: device.name, disconnect: () => { try { device.gatt.disconnect(); } catch {} } };
}

function connectNative(onEvent, environment) {
  return new Promise((resolve, reject) => {
    const offs = [];
    const done = () => offs.forEach((f) => f());
    const session = new R10Session({ write: async (char, bytes) => nativeSend({ type: 'r10.write', char, b64: await b64(bytes) }), onEvent, environment });
    offs.push(onNative('r10.status', (m) => onEvent({ type: 'status', text: m.text })));
    offs.push(onNative('r10.log', (m) => onEvent({ type: 'log', text: m.text })));
    offs.push(onNative('r10.data', (m) => session.feed(fromB64(m.b64))));
    offs.push(onNative('r10.connected', async (m) => {
      onEvent({ type: 'connected', name: m.name });
      await session.start();
      resolve({ session, name: m.name, disconnect: () => { nativeSend({ type: 'r10.disconnect' }); } });
    }));
    offs.push(onNative('r10.error', (m) => { onEvent({ type: 'error', text: m.text }); done(); reject(new Error(m.text)); }));
    offs.push(onNative('r10.disconnected', () => { onEvent({ type: 'disconnected' }); done(); }));
    nativeSend({ type: 'r10.connect' });
  });
}

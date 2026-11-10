// Bridge to the Expo native shell (native/App.js). In a normal browser none of this is active.
const handlers = new Map();
export const isNative = () => !!window.GolfNative;
export const nativeSend = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
export function onNative(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}
window.__golfNativeEvent = (msg) => handlers.get(msg?.type)?.forEach((fn) => fn(msg));

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Open a link outside the app: the native shell hands it to the system browser; the web opens a tab. */
export function openExternal(url) {
  if (isNative()) return nativeSend({ type: 'open.url', url });
  window.open(url, '_blank', 'noopener');
}

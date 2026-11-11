// Native file picking for imports (Garmin export). The WebView's own file chooser on Android opens zips
// as folders and can't multi-select, so the shell picks with the system document picker and hands the
// web app only what it needs. For a zip, only the matching entries are read (by seeking with a file
// handle, so a multi-gigabyte export costs a few kilobytes) and sent still compressed: the web app
// inflates them. Other files are sent whole when small.
import { File } from 'expo-file-system';
import { toBase64, zipEntries, readAt } from './zipread';
export { toBase64, zipEntries };

/** Pick files and return what the web app needs: [{ name, method?, b64 }] (method 8 = still deflated). */
export async function pickForImport(want) {
  const res = await File.pickFileAsync({ multipleFiles: true });
  if (!res || res.canceled) return { canceled: true, files: [] };
  const picked = Array.isArray(res.result) ? res.result : [res.result];
  const files = []; const skipped = [];
  for (const f of picked) {
    const h = f.open();
    try {
      const size = h.size ?? f.size;
      const head = await readAt(h, 0, 4);
      if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) {
        for (const e of await zipEntries(h, size, want)) files.push({ name: e.name, method: e.method, b64: toBase64(e.data) });
      } else if (size <= 20e6) {
        files.push({ name: f.name, b64: toBase64(await readAt(h, 0, size)) });
      } else skipped.push(f.name);
    } finally { h.close(); }
  }
  return { canceled: false, files, skipped };
}

// Local storage: settings in localStorage, swing history in IndexedDB. Nothing leaves the phone.

const DEFAULTS = {
  heightIn: 70, units: 'in', handedness: 'auto', quality: 'full',
  apiKey: '', model: 'claude-sonnet-5-5', golfer: '', club: 'iron', keepVideos: true,
};

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('golf.settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem('golf.settings', JSON.stringify(s)); } catch {}
}

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('golf-app', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('swings')) d.createObjectStore('swings', { keyPath: 'id' });
      // future modules: rounds, shots, clubs
      if (!d.objectStoreNames.contains('rounds')) d.createObjectStore('rounds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'id' });
      // swing video + tracking data, kept apart so lists stay fast
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
};

export const putSwing = (s) => tx('swings', 'readwrite', (st) => st.put(s));
export const deleteSwing = async (id) => { await tx('swings', 'readwrite', (st) => st.delete(id)); await tx('media', 'readwrite', (st) => st.delete(id)).catch(() => {}); };
export const putMedia = (m) => tx('media', 'readwrite', (st) => st.put(m));
export const getMedia = (id) => tx('media', 'readonly', (st) => st.get(id));
export const mediaKeys = () => tx('media', 'readonly', (st) => st.getAllKeys());
export const getSwing = (id) => tx('swings', 'readonly', (st) => st.get(id));
export async function listSwings() {
  const all = await tx('swings', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}

export const putRound = (r) => tx('rounds', 'readwrite', (st) => st.put(r));
export const getRound = (id) => tx('rounds', 'readonly', (st) => st.get(id));
export const deleteRound = (id) => tx('rounds', 'readwrite', (st) => st.delete(id));
export async function listRounds() {
  const all = await tx('rounds', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}
export const putCourse = (c) => tx('courses', 'readwrite', (st) => st.put(c));
export const getCourse = (id) => tx('courses', 'readonly', (st) => st.get(id));
export const deleteCourse = (id) => tx('courses', 'readwrite', (st) => st.delete(id));
export async function listCourses() {
  const all = await tx('courses', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
}

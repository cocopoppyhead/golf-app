// Local storage: settings in localStorage, swing history in IndexedDB. Nothing leaves the phone.

// ---- change tracking for cloud sync ----
const listeners = new Set();
export const onLocalChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = (kind) => listeners.forEach((fn) => { try { fn(kind); } catch {} });
const stamp = (x, keepTime) => { if (x && !keepTime) x.updatedAt = Date.now(); return x; };
export function tombstone(kind, id) {
  try { const t = JSON.parse(localStorage.getItem('golf.deleted') || '[]'); t.push({ kind, id, at: Date.now() }); localStorage.setItem('golf.deleted', JSON.stringify(t)); } catch {}
}

const DEFAULTS = {
  heightIn: 70, system: 'imperial', handedness: 'auto', quality: 'full',
  apiKey: '', model: 'claude-sonnet-5-5', golfer: '', club: 'iron', keepVideos: true,
};

export function getSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('golf.settings') || '{}') };
    // old format: height stored in cm with units:'cm'
    if (s.units === 'cm') { s.heightIn = s.heightIn / 2.54; s.system = 'metric'; }
    delete s.units;
    return s;
  }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(s, { fromSync = false } = {}) {
  try { s.updatedAt = fromSync ? s.updatedAt : Date.now(); localStorage.setItem('golf.settings', JSON.stringify(s)); } catch {}
  if (!fromSync) changed('settings');
}

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('golf-app', 4);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('swings')) d.createObjectStore('swings', { keyPath: 'id' });
      // future modules: rounds, shots, clubs
      if (!d.objectStoreNames.contains('rounds')) d.createObjectStore('rounds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'id' });
      // swing video + tracking data, kept apart so lists stay fast
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('shots')) d.createObjectStore('shots', { keyPath: 'id' });
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

export const putSwing = (s, o = {}) => tx('swings', 'readwrite', (st) => st.put(stamp(s, o.fromSync))).then((r) => (o.fromSync || changed('swing'), r));
export const deleteSwing = async (id, o = {}) => { if (!o.fromSync) { tombstone('swing', id); changed('swing'); } await tx('swings', 'readwrite', (st) => st.delete(id)); await tx('media', 'readwrite', (st) => st.delete(id)).catch(() => {}); };
export const putMedia = (m) => tx('media', 'readwrite', (st) => st.put(m));
export const getMedia = (id) => tx('media', 'readonly', (st) => st.get(id));
export const mediaKeys = () => tx('media', 'readonly', (st) => st.getAllKeys());
export const getSwing = (id) => tx('swings', 'readonly', (st) => st.get(id));
export async function listSwings() {
  const all = await tx('swings', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}

export const putRound = (x, o = {}) => tx('rounds', 'readwrite', (st) => st.put(stamp(x, o.fromSync))).then((r) => (o.fromSync || changed('round'), r));
export const getRound = (id) => tx('rounds', 'readonly', (st) => st.get(id));
export const deleteRound = (id, o = {}) => { if (!o.fromSync) { tombstone('round', id); changed('round'); } return tx('rounds', 'readwrite', (st) => st.delete(id)); };
export async function listRounds() {
  const all = await tx('rounds', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}
export const putCourse = (x, o = {}) => tx('courses', 'readwrite', (st) => st.put(stamp(x, o.fromSync))).then((r) => (o.fromSync || changed('course'), r));
export const getCourse = (id) => tx('courses', 'readonly', (st) => st.get(id));
export const deleteCourse = (id, o = {}) => { if (!o.fromSync) { tombstone('course', id); changed('course'); } return tx('courses', 'readwrite', (st) => st.delete(id)); };
export async function listCourses() {
  const all = await tx('courses', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
}

export const putShot = (x, o = {}) => tx('shots', 'readwrite', (st) => st.put(stamp(x, o.fromSync))).then((r) => (o.fromSync || changed('shot'), r));
export const deleteShot = (id, o = {}) => { if (!o.fromSync) { tombstone('shot', id); changed('shot'); } return tx('shots', 'readwrite', (st) => st.delete(id)); };
export async function listShots() {
  const all = await tx('shots', 'readonly', (st) => st.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}

/** Wipe all local data (used when a different person signs in on this phone). Videos too. */
export async function clearLocal() {
  const d = await db();
  for (const name of ['swings', 'media', 'rounds', 'courses', 'shots']) await new Promise((res) => { const t = d.transaction(name, 'readwrite'); t.objectStore(name).clear(); t.oncomplete = res; t.onerror = res; });
  for (const k of ['golf.plan', 'golf.deleted']) localStorage.removeItem(k);
  const keep = getSettings(); const fresh = { theme: keep.theme, system: keep.system, apiKey: keep.apiKey, model: keep.model, openaiKey: keep.openaiKey, openaiModel: keep.openaiModel, geminiKey: keep.geminiKey, geminiModel: keep.geminiModel, aiProvider: keep.aiProvider, keepVideos: keep.keepVideos };
  localStorage.setItem('golf.settings', JSON.stringify(fresh));
}

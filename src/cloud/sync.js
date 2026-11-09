// Local-first sync. Everything works offline in IndexedDB/localStorage; when signed in,
// records are mirrored to Supabase (user_docs) and pulled down on other devices.
// Rule: the newest updatedAt wins. Videos never leave the phone.
import { sb, currentUser } from './supabase.js';
import {
  getSettings, saveSettings, onLocalChange, clearLocal,
  listSwings, putSwing, deleteSwing, listRounds, putRound, deleteRound,
  listCourses, putCourse, deleteCourse, listShots, putShot, deleteShot,
} from '../store.js';
import { getPlan, savePlan } from '../coach/profile.js';

const SETTINGS_KEYS = ['name', 'bag', 'keys', 'roundRules', 'golfer', 'heightIn', 'system', 'handedness', 'club', 'view', 'nickname', 'avatar', 'homeCourse', 'hand', 'handicap', 'onboarded', 'partials', 'laserProfiles', 'aiProvider'];
const KINDS = {
  swing: { list: listSwings, put: putSwing, del: deleteSwing },
  round: { list: listRounds, put: putRound, del: deleteRound },
  course: { list: listCourses, put: putCourse, del: deleteCourse },
  shot: { list: listShots, put: putShot, del: deleteShot },
};
const clean = (x) => { const { _stats, ...rest } = x; return rest; };

let status = { state: 'idle', last: Number(localStorage.getItem('golf.lastSync') || 0), error: null };
const subs = new Set();
export const onSyncStatus = (fn) => { subs.add(fn); fn(status); return () => subs.delete(fn); };
const set = (s) => { status = { ...status, ...s }; subs.forEach((f) => f(status)); };

let running = null, again = false;
export function syncSoon(delay = 2500) {
  clearTimeout(syncSoon.t);
  syncSoon.t = setTimeout(() => syncNow().catch(() => {}), delay);
}

export async function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    const user = await currentUser();
    if (!user) { set({ state: 'signed-out' }); return; }
    set({ state: 'syncing', error: null });
    try {
      const uid = user.id;
      // ---- pull everything (data is small: no videos) ----
      const remote = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('user_docs').select('kind,id,data,deleted,updated_at').eq('user_id', uid).range(from, from + 999);
        if (error) throw error;
        remote.push(...data);
        if (data.length < 1000) break;
      }
      const rmap = new Map(remote.map((r) => [`${r.kind}:${r.id}`, r]));
      const up = [];
      const ts = (iso) => new Date(iso).getTime();

      // settings (one doc)
      const ls = getSettings(), rs = rmap.get('settings:me');
      if (rs && ts(rs.updated_at) > (ls.updatedAt || 0)) {
        const merged = { ...ls, ...rs.data, updatedAt: ts(rs.updated_at) };
        saveSettings(merged, { fromSync: true });
      } else if (!rs || (ls.updatedAt || 0) > ts(rs.updated_at)) {
        up.push({ kind: 'settings', id: 'me', data: Object.fromEntries(SETTINGS_KEYS.filter((k) => ls[k] != null).map((k) => [k, ls[k]])), t: ls.updatedAt || Date.now() });
      }
      // coach plan (one doc)
      const lp = getPlan(), rp = rmap.get('plan:me');
      if (rp && ts(rp.updated_at) > (lp.updatedAt || 0)) savePlan({ ...rp.data, updatedAt: ts(rp.updated_at) }, { fromSync: true });
      else if (lp.updatedAt && (!rp || lp.updatedAt > ts(rp.updated_at))) up.push({ kind: 'plan', id: 'me', data: lp, t: lp.updatedAt });

      // deletions made on this phone
      const dead = JSON.parse(localStorage.getItem('golf.deleted') || '[]');
      for (const d of dead) up.push({ kind: d.kind, id: d.id, data: {}, deleted: true, t: d.at });
      const deadSet = new Set(dead.map((d) => `${d.kind}:${d.id}`));

      // records
      for (const [kind, k] of Object.entries(KINDS)) {
        const local = await k.list();
        const lmap = new Map(local.map((x) => [x.id, x]));
        for (const x of local) {
          const r = rmap.get(`${kind}:${x.id}`);
          const lt = x.updatedAt || x.date || 0;
          if (!r || lt > ts(r.updated_at)) up.push({ kind, id: x.id, data: clean(x), t: lt || Date.now() });
        }
        for (const r of remote.filter((r) => r.kind === kind)) {
          if (deadSet.has(`${kind}:${r.id}`)) continue;
          const l = lmap.get(r.id);
          if (r.deleted) { if (l && (l.updatedAt || 0) <= ts(r.updated_at)) await k.del(r.id, { fromSync: true }); continue; }
          if (!l || ts(r.updated_at) > (l.updatedAt || l.date || 0)) await k.put({ ...r.data, updatedAt: ts(r.updated_at) }, { fromSync: true });
        }
      }

      // ---- push ----
      for (let i = 0; i < up.length; i += 200) {
        const rows = up.slice(i, i + 200).map((u) => ({ user_id: uid, kind: u.kind, id: u.id, data: u.data, deleted: !!u.deleted, updated_at: new Date(u.t).toISOString() }));
        const { error } = await sb.from('user_docs').upsert(rows, { onConflict: 'user_id,kind,id' });
        if (error) throw error;
      }
      localStorage.setItem('golf.deleted', '[]');
      const now = Date.now(); localStorage.setItem('golf.lastSync', String(now));
      set({ state: 'ok', last: now, pushed: up.length });
      window.dispatchEvent(new Event('golf-synced'));
    } catch (e) {
      console.warn('sync failed', e);
      set({ state: 'error', error: e.message || String(e) });
    }
  })();
  try { await running; } finally { running = null; if (again) { again = false; syncSoon(500); } }
}

/** Call once at start-up. */
export function startSync() {
  onLocalChange(() => syncSoon());
  window.addEventListener('golf-plan', () => syncSoon());
  window.addEventListener('online', () => syncSoon(500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(800); });
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED') syncSoon(300); if (ev === 'SIGNED_OUT') set({ state: 'signed-out' }); });
  syncSoon(1000);
}

/**
 * Before the first sync for a user: if this phone holds someone else's data, wipe it first.
 * Returns 'same' | 'claimed' | 'switched'.
 */
export async function claimDevice(uid) {
  const owner = localStorage.getItem('golf.owner');
  if (owner === uid) return 'same';
  if (owner && owner !== uid) { await clearLocal(); localStorage.setItem('golf.owner', uid); return 'switched'; }
  localStorage.setItem('golf.owner', uid); // first sign-in: this phone's data becomes this account's
  return 'claimed';
}

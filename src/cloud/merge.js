// The merge rule for one kind of record, as a pure function so it can be tested without a
// database: newest updatedAt wins; a remote tombstone deletes a local copy that is not newer;
// a local deletion (deadSet) is never resurrected by the remote copy.
const ts = (iso) => new Date(iso).getTime();
const localTime = (x) => x.updatedAt || x.date || 0;
export const clean = (x) => { const { _stats, ...rest } = x; return rest; };

/**
 * local: records on this device; remote: rows for this kind ({ id, data, deleted, updated_at });
 * deadSet: `kind:id` keys deleted here since the last sync.
 * Returns { up: [{ kind, id, data, t }], puts: [record], dels: [id] }.
 */
export function planMerge(kind, local, remote, deadSet = new Set()) {
  const rmap = new Map(remote.map((r) => [r.id, r]));
  const lmap = new Map(local.map((x) => [x.id, x]));
  const up = [], puts = [], dels = [];
  for (const x of local) {
    const r = rmap.get(x.id);
    const lt = localTime(x);
    if (!r || lt > ts(r.updated_at)) up.push({ kind, id: x.id, data: clean(x), t: lt || Date.now() });
  }
  for (const r of remote) {
    if (deadSet.has(`${kind}:${r.id}`)) continue;
    const l = lmap.get(r.id);
    if (r.deleted) { if (l && (l.updatedAt || 0) <= ts(r.updated_at)) dels.push(r.id); continue; }
    if (!l || ts(r.updated_at) > localTime(l)) puts.push({ ...r.data, updatedAt: ts(r.updated_at) });
  }
  return { up, puts, dels };
}

/** The settings doc: pull when the remote is newer, push (the synced keys only) when local is. */
export function planSettings(local, remoteRow, keys) {
  if (remoteRow && ts(remoteRow.updated_at) > (local.updatedAt || 0)) return { pull: { ...local, ...remoteRow.data, updatedAt: ts(remoteRow.updated_at) } };
  if (!remoteRow || (local.updatedAt || 0) > ts(remoteRow.updated_at)) return { push: { kind: 'settings', id: 'me', data: Object.fromEntries(keys.filter((k) => local[k] != null).map((k) => [k, local[k]])), t: local.updatedAt || Date.now() } };
  return {};
}

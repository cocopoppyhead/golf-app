// Friends and invites on Supabase (tables in supabase/schema.sql). Everything here is a no-op
// when signed out. What friends see of each other: a profile and round summaries (date, course,
// score, to par, differential, putts) — never shot detail.
import { sb, currentUser, getProfile, saveProfile } from './supabase.js';
import { listRounds, getCourse } from '../store.js';
import { roundStats } from '../rounds/stats.js';
import { differential } from '../rounds/handicap.js';

export const APP_URL = 'https://cocopoppyhead.github.io/golf-app/';
export const inviteLink = (kind, code) => `${APP_URL}?${kind}=${encodeURIComponent(code)}`;

// ---------- my code ----------
export async function myFriendCode() {
  const u = await currentUser(); if (!u) return null;
  let p = await getProfile(u.id);
  if (!p?.friend_code) { await saveProfile(u.id, { name: p?.name || '' }).catch(() => {}); p = await getProfile(u.id); }
  return p?.friend_code || null;
}
export async function addFriendByCode(code) {
  const { data, error } = await sb.rpc('add_friend', { code: String(code).trim().toUpperCase() });
  if (error) throw new Error(error.message);
  return data;
}

// ---------- friends + their golf ----------
export async function listFriends() {
  const u = await currentUser(); if (!u) return [];
  const { data: f } = await sb.from('friends').select('friend_id').eq('user_id', u.id);
  const ids = (f || []).map((x) => x.friend_id);
  if (!ids.length) return [];
  const { data: profiles } = await sb.from('profiles').select('id,name,nickname,avatar,handicap_index,home_course').in('id', ids);
  return profiles || [];
}
/** Friends table: games, average, best, last played — from everyone's summaries, me included. */
export async function friendsTable() {
  const u = await currentUser(); if (!u) return null;
  const friends = await listFriends();
  const me = await getProfile(u.id);
  const people = [{ id: u.id, name: me?.nickname || me?.name || 'Me', avatar: me?.avatar, handicap_index: me?.handicap_index, me: true }, ...friends.map((p) => ({ ...p, name: p.nickname || p.name || 'Friend' }))];
  const { data: rows } = await sb.from('round_summaries').select('user_id,played_on,course_name,holes,score,to_par,diff,putts').in('user_id', people.map((p) => p.id)).order('played_on', { ascending: false }).limit(2000);
  const by = new Map(people.map((p) => [p.id, { ...p, games: 0, scores: [], toPar: [], last: null, diffs: [] }]));
  for (const r of rows || []) {
    const p = by.get(r.user_id); if (!p) continue;
    p.games++; if (r.holes >= 18) { p.scores.push(r.score); if (r.to_par != null) p.toPar.push(r.to_par); if (r.diff != null) p.diffs.push(r.diff); }
    if (!p.last) p.last = r;
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return [...by.values()].map((p) => ({ ...p, avg: mean(p.scores), avgToPar: mean(p.toPar), best: p.scores.length ? Math.min(...p.scores) : null, total: p.scores.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => (b.games - a.games) || ((a.avgToPar ?? 99) - (b.avgToPar ?? 99)));
}

// ---------- round summaries ----------
let lastPublish = Number(localStorage.getItem('golf.summariesAt') || 0);
/** Push a summary for every finished round changed since the last push. Called from sync. */
export async function publishSummaries({ all = false } = {}) {
  const u = await currentUser(); if (!u) return 0;
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && (all || (r.updatedAt || r.date || 0) > lastPublish));
  if (!rounds.length) return 0;
  const rows = [];
  for (const r of rounds) {
    const c = await getCourse(r.courseId).catch(() => null); if (!c) continue;
    const S = roundStats(r, c); if (!S || !S.holes) continue;
    const full = S.holes >= c.holes.length;
    const diff = r.quick ? r.diff ?? null : full && c.rating && c.slope ? differential(S.score, c.rating, c.slope) : null;
    rows.push({ user_id: u.id, round_id: r.id, played_on: new Date(r.date).toISOString().slice(0, 10), course_name: r.courseName || c.name, course_lib_id: c.libId || null, holes: S.holes, score: S.score, to_par: full ? S.score - S.par : null, diff, putts: S.puttsHoles ? S.putts : null, updated_at: new Date().toISOString() });
  }
  if (rows.length) { const { error } = await sb.from('round_summaries').upsert(rows, { onConflict: 'user_id,round_id' }); if (error) throw new Error(error.message); }
  lastPublish = Date.now(); localStorage.setItem('golf.summariesAt', String(lastPublish));
  return rows.length;
}
export async function removeSummary(roundId) {
  const u = await currentUser(); if (!u) return;
  await sb.from('round_summaries').delete().eq('user_id', u.id).eq('round_id', roundId);
}

// ---------- events (scheduled rounds) ----------
export async function createEvent(ev) {
  const u = await currentUser(); if (!u) return null;
  const { data, error } = await sb.from('events').insert({ host: u.id, course_name: ev.courseName, course_lib_id: ev.libId || null, starts_at: new Date(ev.when).toISOString(), note: ev.note || '' }).select().single();
  if (error) throw new Error(error.message);
  const names = (ev.who || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (names.length) await sb.from('event_players').insert(names.map((name) => ({ event_id: data.id, name }))).catch(() => {});
  return data;
}
export async function updateEvent(id, ev) {
  const { error } = await sb.from('events').update({ starts_at: new Date(ev.when).toISOString(), note: ev.note || '' }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function deleteEvent(id) { await sb.from('events').delete().eq('id', id); }
export async function joinEvent(code, name) {
  const { data, error } = await sb.rpc('join_event', { code: String(code).trim().toUpperCase(), name: name || '' });
  if (error) throw new Error(error.message);
  return data;
}
export async function eventPlayers(id) {
  const { data } = await sb.from('event_players').select('user_id,name,status').eq('event_id', id).order('joined_at');
  return data || [];
}
/** Events I host or have joined, from now on. */
export async function remoteEvents() {
  const u = await currentUser(); if (!u) return [];
  const { data } = await sb.from('events').select('*').gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('starts_at');
  return (data || []).map((e) => ({ ...e, mine: e.host === u.id }));
}

// ---------- invite links arriving in the URL ----------
/** ?join=CODE or ?friend=CODE: act now if signed in, else keep it for after sign-in. */
export function pendingInviteFromUrl() {
  const q = new URLSearchParams(location.search);
  const join = q.get('join'), friend = q.get('friend');
  if (!join && !friend) return null;
  const inv = join ? { kind: 'join', code: join } : { kind: 'friend', code: friend };
  try { localStorage.setItem('golf.pendingInvite', JSON.stringify(inv)); } catch {}
  history.replaceState(null, '', location.pathname);
  return inv;
}
export function takePendingInvite() {
  try { const v = JSON.parse(localStorage.getItem('golf.pendingInvite') || 'null'); if (v) localStorage.removeItem('golf.pendingInvite'); return v; } catch { return null; }
}

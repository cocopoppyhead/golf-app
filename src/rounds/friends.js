// Friends on the Play tab: the table (games, average, best, last round), invite a friend with a
// link or QR code, join by code. Invites for scheduled rounds use the same sheet.
import qrcode from 'qrcode-generator';
import { currentUser } from '../cloud/supabase.js';
import { friendsTable, myFriendCode, addFriendByCode, joinEvent, inviteLink } from '../cloud/social.js';
import { isNative, nativeSend } from '../native.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toPar = (d) => (d == null ? '–' : d === 0 ? 'E' : d > 0 ? `+${Math.round(d)}` : String(Math.round(d)));
const fmtD = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function qrSvg(text, px = 180) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: Math.max(2, Math.floor(px / q.getModuleCount())), margin: 2, scalable: true });
}

/** Link + QR + copy/share. */
export function inviteSheet({ title, link, code, blurb = '' }) {
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet invite';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${esc(title)}</b><button class="link" data-close>Close</button></div>
    ${blurb ? `<p class="small mute" style="margin:0 0 8px">${esc(blurb)}</p>` : ''}
    <div class="qrwrap">${qrSvg(link)}</div>
    <p class="center" style="margin:6px 0 2px"><b class="code">${esc(code)}</b></p>
    <p class="mute small center" style="margin:0 0 10px">Scan, or type the code in osolo → Play → Friends.</p>
    <div class="row"><button class="btn primary" data-share style="flex:1">Share link</button><button class="btn" data-copy style="flex:1">Copy</button></div>
    <p class="mute small" style="margin-top:8px;word-break:break-all">${esc(link)}</p></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(link); sheet.querySelector('[data-copy]').textContent = 'Copied'; } catch { prompt('Copy this link', link); } };
  sheet.querySelector('[data-share]').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title, text: `${title} on osolo`, url: link }); } catch {} }
    else if (isNative()) nativeSend({ type: 'share.text', text: `${title} on osolo: ${link}` });
    else sheet.querySelector('[data-copy]').click();
  };
  document.body.appendChild(sheet);
}

export async function renderFriendsCard(el, { toast = () => {}, onJoined = () => {} } = {}) {
  if (!el) return;
  const u = await currentUser();
  if (!u) { el.innerHTML = `<div class="card"><div class="sechead" style="margin:0"><h2 style="margin:0">Friends</h2></div><p class="mute small" style="margin:6px 0 0">Sign in (Settings) to invite friends, schedule rounds together and see each other's scores.</p></div>`; return; }
  el.innerHTML = `<div class="card"><div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Friends</h2><span class="mute small">loading…</span></div></div>`;
  let table;
  try { table = (await friendsTable()) || []; } catch (e) { el.innerHTML = `<div class="card"><h2 style="margin:0 0 6px">Friends</h2><p class="mute small">${esc(e.message)}. Re-run supabase/schema.sql if the tables are missing.</p></div>`; return; }
  const friends = table.filter((p) => !p.me);
  el.innerHTML = `<div class="card friends">
    <div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Friends</h2><button class="link acc" data-invite>+ Invite</button></div>
    ${friends.length ? `<table class="card-t ft"><thead><tr><th style="text-align:left">Player</th><th>Games</th><th>Avg</th><th>Best</th><th>Last</th></tr></thead>
      ${table.map((p) => `<tr class="${p.me ? 'me' : ''}"><td style="text-align:left"><span class="pname">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" />` : ''}<b>${esc(p.name)}</b>${p.handicap_index != null ? `<span class="mute small"> ${p.handicap_index}</span>` : ''}</span></td><td>${p.games}</td><td>${p.avg != null ? `${p.avg.toFixed(1)} <span class="mute small">${toPar(p.avgToPar)}</span>` : '–'}</td><td>${p.best ?? '–'}</td><td class="small">${p.last ? `${p.last.score} <span class="mute">${fmtD(p.last.played_on)}</span>` : '–'}</td></tr>`).join('')}</table>
      <p class="mute small" style="margin:6px 0 0">Scores from everyone's finished rounds, 18-hole averages. Shot detail stays private.</p>`
      : '<p class="mute small">No friends yet. Send your code or scan theirs; scheduling a round and sharing the link does it too.</p>'}
    <div class="row" style="margin-top:8px"><input data-code placeholder="Friend or round code" maxlength="6" style="flex:1;text-transform:uppercase" /><button class="btn" data-join>Join</button></div>
  </div>`;
  el.querySelector('[data-invite]').onclick = async () => {
    const code = await myFriendCode(); if (!code) return toast('Could not get your code. Check your connection.');
    inviteSheet({ title: 'Add me on osolo', link: inviteLink('friend', code), code, blurb: 'A friend who opens this link (signed in) is added both ways. Then you can see each other\'s scores and invite each other to rounds.' });
  };
  el.querySelector('[data-join]').onclick = async () => {
    const code = el.querySelector('[data-code]').value.trim().toUpperCase(); if (code.length < 4) return toast('Enter the 6-character code.');
    try {
      const p = await addFriendByCode(code).catch(() => null);
      if (p) { toast(`You and ${p.nickname || p.name || 'your friend'} are friends now.`); return renderFriendsCard(el, { toast, onJoined }); }
      const ev = await joinEvent(code, '');
      toast(`You're in: ${ev.course_name}, ${new Date(ev.starts_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
      onJoined(ev);
    } catch (e) { toast(e.message || 'That code didn\'t work.'); }
  };
}

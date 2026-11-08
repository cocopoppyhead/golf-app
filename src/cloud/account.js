// Account card (Settings): email code sign-in, profile name + handicap, sync status.
import { sb, currentUser, sendCode, verifyCode, signOut, getProfile, saveProfile } from './supabase.js';
import { syncNow, onSyncStatus, claimDevice } from './sync.js';
import { getSettings, saveSettings } from '../store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };

let unsub = null;
export async function renderAccount(el, { toast = () => {}, onChange = () => {} } = {}) {
  if (!el) return;
  const user = await currentUser();
  unsub?.();
  if (!user) return signedOut(el, { toast, onChange });
  const prof = (await getProfile(user.id).catch(() => null)) || {};
  el.innerHTML = `<div class="acct">
    <div class="acct-h"><div class="av">${esc((prof.name || user.email)[0].toUpperCase())}</div>
      <div><b>${esc(prof.name || 'Add your name')}</b><div class="mute small">${esc(user.email)}</div></div></div>
    <div class="row" style="margin-top:10px"><input id="pName" placeholder="Your name" value="${esc(prof.name || '')}" /><input id="pHcp" inputmode="decimal" placeholder="Handicap index" value="${prof.handicap_index ?? ''}" style="flex:0 0 120px" /></div>
    <p class="small" id="syncLine" style="margin:8px 0"></p>
    <div class="row"><button class="btn" type="button" id="syncBtn">Sync now</button><button class="btn" type="button" id="outBtn">Sign out</button></div>
  </div>`;
  unsub = onSyncStatus((s) => {
    const l = el.querySelector('#syncLine'); if (!l) return;
    l.innerHTML = s.state === 'syncing' ? '⟳ Syncing…' : s.state === 'error' ? `<span style="color:var(--work)">Sync problem: ${esc(s.error)}</span>` : `<span class="mute">☁︎ Backed up · last sync ${ago(s.last)}</span>`;
  });
  let saveT = null;
  const saveP = () => { clearTimeout(saveT); saveT = setTimeout(async () => {
    const name = el.querySelector('#pName').value.trim(), h = parseFloat(el.querySelector('#pHcp').value);
    try { await saveProfile(user.id, { name, handicap_index: Number.isFinite(h) ? h : null }); const s = getSettings(); s.name = name; saveSettings(s); el.querySelector('.acct-h b').textContent = name || 'Add your name'; } catch (e) { toast(e.message); }
  }, 700); };
  el.querySelector('#pName').addEventListener('input', saveP);
  el.querySelector('#pHcp').addEventListener('input', saveP);
  el.querySelector('#syncBtn').onclick = () => syncNow();
  el.querySelector('#outBtn').onclick = async () => { await signOut(); toast('Signed out. Your data stays on this phone.'); renderAccount(el, { toast, onChange }); };
}

function signedOut(el, { toast, onChange }) {
  const owner = localStorage.getItem('golf.owner');
  el.innerHTML = `<div class="acct">
    <b>Sign in</b>
    <p class="mute small" style="margin:4px 0 10px">Backs up your swings, rounds, bag and notes, puts them on any phone, and lets you join leagues with friends. We'll email you a 6-digit code.</p>
    <div id="step1"><div class="row"><input id="aEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" /><button class="btn primary" type="button" id="aSend" style="flex:0 0 auto">Send code</button></div></div>
    <div id="step2" hidden><p class="small" id="aSent"></p><div class="row"><input id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" /><button class="btn primary" type="button" id="aVerify" style="flex:0 0 auto">Sign in</button></div>
      <button class="link" type="button" id="aBack" style="margin-top:8px">Use a different email</button></div>
    ${owner ? '<p class="mute small" style="margin-top:8px">This phone already has a signed-in owner\'s data. Signing in with a different account clears it from this phone (it stays safe in their account).</p>' : ''}
  </div>`;
  let email = '';
  el.querySelector('#aSend').onclick = async () => {
    email = el.querySelector('#aEmail').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter your email address.');
    el.querySelector('#aSend').disabled = true;
    try { await sendCode(email); el.querySelector('#step1').hidden = true; el.querySelector('#step2').hidden = false; el.querySelector('#aSent').textContent = `Code sent to ${email}. Check your inbox (and spam).`; el.querySelector('#aCode').focus(); }
    catch (e) { toast(e.message, 6000); }
    el.querySelector('#aSend').disabled = false;
  };
  el.querySelector('#aBack').onclick = () => { el.querySelector('#step1').hidden = false; el.querySelector('#step2').hidden = true; };
  el.querySelector('#aVerify').onclick = async () => {
    const code = el.querySelector('#aCode').value.trim();
    el.querySelector('#aVerify').disabled = true;
    try {
      const user = await verifyCode(email, code);
      const how = await claimDevice(user.id);
      if (how === 'switched') toast('Signed in. Loading your data…', 4000);
      const prof = await getProfile(user.id).catch(() => null);
      if (!prof) await saveProfile(user.id, { name: getSettings().name || '' }).catch(() => {});
      await syncNow();
      onChange();
      renderAccount(el, { toast, onChange });
    } catch (e) { toast(e.message || 'That code didn\'t work.', 6000); el.querySelector('#aVerify').disabled = false; }
  };
}

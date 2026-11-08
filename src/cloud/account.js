// Account card (Settings): email code sign-in, profile name + handicap, sync status.
import { currentUser, signInPassword, signUpPassword, signOut, getProfile, saveProfile } from './supabase.js';
import { syncNow, onSyncStatus, claimDevice } from './sync.js';
import { getSettings, saveSettings } from '../store.js';
import { openProfileEditor, avatarHtml, localProfile } from '../onboarding.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };

let unsub = null;
export async function renderAccount(el, { toast = () => {}, onChange = () => {} } = {}) {
  if (!el) return;
  const user = await currentUser();
  unsub?.();
  if (!user) return signedOut(el, { toast, onChange });
  const prof = (await getProfile(user.id).catch(() => null)) || {};
  const p = { ...localProfile() };
  if (prof.name && !p.name) p.name = prof.name;
  if (prof.avatar && !p.avatar) p.avatar = prof.avatar;
  const hcp = p.handicap ?? prof.handicap_index;
  el.innerHTML = `<div class="acct">
    <div class="acct-h">${avatarHtml(p)}
      <div style="flex:1;min-width:0"><b>${esc(p.name || 'Add your name')}</b>${p.nickname ? ` <span class="mute">“${esc(p.nickname)}”</span>` : ''}
        <div class="mute small">${[hcp != null ? `HCP ${hcp}` : 'No handicap yet', p.hand === 'left' ? 'Left-handed' : 'Right-handed', p.homeCourse].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="mute small">${esc(user.email)}</div></div></div>
    <button class="btn" type="button" id="editProf" style="width:100%;margin-top:10px">Edit profile</button>
    <p class="small" id="syncLine" style="margin:8px 0"></p>
    <div class="row"><button class="btn" type="button" id="syncBtn">Sync now</button><button class="btn" type="button" id="outBtn">Sign out</button></div>
  </div>`;
  unsub = onSyncStatus((s) => {
    const l = el.querySelector('#syncLine'); if (!l) return;
    l.innerHTML = s.state === 'syncing' ? '⟳ Syncing…' : s.state === 'error' ? `<span style="color:var(--work)">Sync problem: ${esc(s.error)}</span>` : `<span class="mute">☁︎ Backed up · last sync ${ago(s.last)}</span>`;
  });
  el.querySelector('#editProf').onclick = () => openProfileEditor({ prof, user, toast, onDone: () => { onChange(); renderAccount(el, { toast, onChange }); } });
  el.querySelector('#syncBtn').onclick = () => syncNow();
  el.querySelector('#outBtn').onclick = async () => { await signOut(); toast('Signed out. Your data stays on this phone.'); renderAccount(el, { toast, onChange }); };
}

function signedOut(el, { toast, onChange }) {
  const owner = localStorage.getItem('golf.owner');
  let mode = 'in';
  const draw = () => {
    el.innerHTML = `<div class="acct">
      <div class="seg seg2" style="margin-bottom:10px"><button type="button" data-m="in" class="${mode === 'in' ? 'on' : ''}">Sign in</button><button type="button" data-m="up" class="${mode === 'up' ? 'on' : ''}">Create account</button></div>
      <p class="mute small" style="margin:0 0 10px">Backs up your swings, rounds, bag and notes, puts them on any phone, and lets you join leagues with friends.</p>
      <input id="aEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" style="margin-bottom:8px" />
      <input id="aPass" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" placeholder="${mode === 'in' ? 'Password' : 'Choose a password (8+ characters)'}" style="margin-bottom:8px" />
      <button class="btn primary" type="button" id="aGo" style="width:100%">${mode === 'in' ? 'Sign in' : 'Create account'}</button>
      ${owner ? '<p class="mute small" style="margin-top:8px">This phone has a previous owner\'s data. Signing in with a different account clears it from this phone (it stays safe in their account).</p>' : ''}
    </div>`;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    el.querySelector('#aGo').onclick = go;
  };
  const go = async () => {
    const email = el.querySelector('#aEmail').value.trim().toLowerCase(), pass = el.querySelector('#aPass').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter your email address.');
    if (pass.length < 8) return toast('Password needs at least 8 characters.');
    const btn = el.querySelector('#aGo'); btn.disabled = true;
    try {
      const user = mode === 'in' ? await signInPassword(email, pass) : await signUpPassword(email, pass);
      if (!user) { toast('Account created. Supabase wants the email confirmed first: turn off "Confirm email" in Supabase, or click the link it sent.', 8000); btn.disabled = false; return; }
      const how = await claimDevice(user.id);
      if (how === 'switched') toast('Signed in. Loading your data…', 4000);
      const prof = await getProfile(user.id).catch(() => null);
      if (!prof) await saveProfile(user.id, { name: getSettings().name || '' }).catch(() => {});
      await syncNow();
      onChange();
      renderAccount(el, { toast, onChange });
    } catch (e) {
      const m = /invalid login/i.test(e.message) ? 'Wrong email or password.' : /already registered/i.test(e.message) ? 'That email already has an account. Use Sign in.' : e.message;
      toast(m, 6000); btn.disabled = false;
    }
  };
  draw();
}

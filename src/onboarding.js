// First-login setup and the mini profile: photo, name, nickname, handicap, hand, height,
// units, home course and (optionally) distances. Everything is kept in settings (synced to
// the account) and the public bits go to the shared `profiles` table so friends and leagues see them.
import { getSettings, saveSettings, listCourses } from './store.js';
import { currentUser, getProfile, saveProfile } from './cloud/supabase.js';
import { getBag } from './bag.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Well-known UAE courses for the home-course picker (any name can be typed).
const UAE_COURSES = [
  'Emirates Golf Club – Majlis', 'Emirates Golf Club – Faldo', 'Dubai Creek Golf & Yacht Club', 'Jumeirah Golf Estates – Earth',
  'Jumeirah Golf Estates – Fire', 'The Els Club Dubai', 'Address Montgomerie Dubai', 'Arabian Ranches Golf Club', 'Dubai Hills Golf Club',
  'Trump International Golf Club Dubai', 'Al Zorah Golf Club', 'Abu Dhabi Golf Club', 'Yas Links Abu Dhabi', 'Saadiyat Beach Golf Club',
  'Al Hamra Golf Club', 'Tower Links Golf Club', 'Sharjah Golf & Shooting Club', 'Al Ain Equestrian, Shooting & Golf Club',
];
const QUICK_CLUBS = ['Driver', '3 wood', '4 hybrid', '5 iron', '6 iron', '7 iron', '8 iron', '9 iron', 'PW', '52°', '56°', '60°'];

/** The profile as the app knows it: settings first, filled in from the cloud row. */
export function localProfile() {
  const s = getSettings();
  return {
    name: s.name || '', nickname: s.nickname || '', avatar: s.avatar || '', handicap: s.handicap ?? null,
    hand: s.hand || 'right', heightIn: s.heightIn, system: s.system, homeCourse: s.homeCourse || '', onboarded: !!s.onboarded,
  };
}

/** Show setup once for a signed-in user who hasn't done it yet. */
export async function maybeOnboard(opts = {}) {
  const user = await currentUser().catch(() => null);
  if (!user) return false;
  const s = getSettings();
  if (s.onboarded || document.querySelector('.onb')) return false;
  const prof = (await getProfile(user.id).catch(() => null)) || {};
  if (prof.onboarded) { // done on another phone: just pull it in
    Object.assign(s, fromRow(prof, s), { onboarded: true }); saveSettings(s);
    return false;
  }
  openProfileEditor({ ...opts, first: true, prof, user });
  return true;
}

const fromRow = (p, s) => ({
  name: p.name || s.name || '', nickname: p.nickname ?? s.nickname ?? '', avatar: p.avatar ?? s.avatar ?? '',
  handicap: p.handicap_index ?? s.handicap ?? null, homeCourse: p.home_course ?? s.homeCourse ?? '',
  hand: p.handed || s.hand || 'right', heightIn: p.height_in ?? s.heightIn,
});

/** Square-cropped, small JPEG so it fits in the profile row (≈10–20 KB). */
function shrinkPhoto(file, size = 192) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const k = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
      URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = URL.createObjectURL(file);
  });
}

export function avatarHtml(p, cls = 'av') {
  const initial = esc(((p.nickname || p.name || '?').trim()[0] || '?').toUpperCase());
  return p.avatar ? `<img class="${cls}" src="${esc(p.avatar)}" alt="" />` : `<div class="${cls}">${initial}</div>`;
}

/**
 * Full-screen setup. first=true runs it as a 4-step welcome; otherwise it's the "Edit profile" sheet.
 * onDone() is called after saving.
 */
export async function openProfileEditor({ first = false, prof = null, user = null, toast = () => {}, onDone = () => {} } = {}) {
  user = user || (await currentUser().catch(() => null));
  const s = getSettings();
  const p = { ...localProfile(), ...(prof ? fromRow(prof, s) : {}) };
  const metric = () => p.system === 'metric';
  const bag = getBag().map((c) => ({ ...c }));
  const courses = [...new Set([...(await listCourses().catch(() => [])).map((c) => c.name), ...UAE_COURSES])];
  let step = 0;
  const STEPS = ['You', 'Your game', 'Home course', 'Distances'];

  const el = document.createElement('div'); el.className = 'onb';
  document.body.appendChild(el);

  const heightFields = () => {
    const h = p.heightIn || 70;
    return metric()
      ? `<input id="oCm" inputmode="numeric" value="${Math.round(h * 2.54)}" /><span class="u">cm</span>`
      : `<input id="oFt" inputmode="numeric" value="${Math.floor(Math.round(h) / 12)}" /><span class="u">ft</span><input id="oIn" inputmode="numeric" value="${Math.round(h) % 12}" /><span class="u">in</span>`;
  };
  const readHeight = () => {
    if (metric()) { const v = parseFloat(el.querySelector('#oCm')?.value); if (v > 100 && v < 230) p.heightIn = v / 2.54; }
    else { const f = parseFloat(el.querySelector('#oFt')?.value), i = parseFloat(el.querySelector('#oIn')?.value) || 0; if (f >= 4 && f <= 7) p.heightIn = f * 12 + i; }
  };
  const yd = (v) => (v == null ? '' : Math.round(metric() ? v * 0.9144 : v));

  const pages = {
    0: () => `<h2>${first ? 'Welcome! Set up your profile' : 'Your profile'}</h2>
      <p class="mute">This is what your friends see in leagues and on scorecards.</p>
      <label class="photo" for="oPhoto">${avatarHtml(p, 'big')}<span>${p.avatar ? 'Change photo' : 'Add a photo'}</span></label>
      <input id="oPhoto" type="file" accept="image/*" hidden />
      <label class="field-label">Name</label><input id="oName" autocomplete="name" placeholder="First and last name" value="${esc(p.name)}" />
      <label class="field-label">Nickname <span class="mute">(optional)</span></label><input id="oNick" placeholder="What the group calls you" value="${esc(p.nickname)}" />`,
    1: () => `<h2>Your game</h2>
      <p class="mute">Used for stableford points, club picks and to measure your swing.</p>
      <label class="field-label">Handicap index</label>
      <div class="hcprow"><input id="oHcp" inputmode="decimal" placeholder="e.g. 12.4" value="${p.handicap ?? ''}" ${!first && p.handicap == null ? 'disabled' : ''} /><label class="check mini"><input type="checkbox" id="oNoHcp" ${!first && p.handicap == null ? 'checked' : ''} /> No handicap yet</label></div>
      <label class="field-label">You play</label>
      <div class="seg seg2" id="oHand"><button type="button" data-v="right" class="${p.hand !== 'left' ? 'on' : ''}">Right-handed</button><button type="button" data-v="left" class="${p.hand === 'left' ? 'on' : ''}">Left-handed</button></div>
      <label class="field-label">Units</label>
      <div class="seg seg2" id="oSys"><button type="button" data-v="imperial" class="${!metric() ? 'on' : ''}">Yards · ft/in</button><button type="button" data-v="metric" class="${metric() ? 'on' : ''}">Metres · cm</button></div>
      <label class="field-label">Height <span class="mute">(scales your swing measurements)</span></label>
      <div class="hrow">${heightFields()}</div>`,
    2: () => `<h2>Home course</h2>
      <p class="mute">Where you play most. New rounds start here.</p>
      <input id="oHome" list="oCourses" placeholder="Search or type a course" value="${esc(p.homeCourse)}" />
      <datalist id="oCourses">${courses.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <div class="picks">${courses.slice(0, 8).map((c) => `<button type="button" class="pick ${c === p.homeCourse ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`,
    3: () => `<h2>Your distances <span class="mute small">(optional)</span></h2>
      <p class="mute">Full-swing carry in ${metric() ? 'metres' : 'yards'}. Rough numbers are fine. The app sharpens them as you save shots, and you can add ¾ and ½ swings in Bag.</p>
      <div class="dgrid">${QUICK_CLUBS.map((club) => { const c = bag.find((b) => b.club === club); return `<label><span>${esc(club)}</span><input inputmode="numeric" data-club="${esc(club)}" placeholder="–" value="${yd(c?.carry)}" /></label>`; }).join('')}</div>`,
  };

  const readStep = () => {
    if (step === 0) { p.name = el.querySelector('#oName').value.trim(); p.nickname = el.querySelector('#oNick').value.trim(); }
    if (step === 1) {
      const h = parseFloat(el.querySelector('#oHcp').value.replace(',', '.'));
      p.handicap = el.querySelector('#oNoHcp').checked ? null : (Number.isFinite(h) && h >= -10 && h <= 54 ? Math.round(h * 10) / 10 : p.handicap);
      readHeight();
    }
    if (step === 2) p.homeCourse = el.querySelector('#oHome').value.trim();
    if (step === 3) el.querySelectorAll('[data-club]').forEach((i) => {
      const v = parseFloat(i.value); const club = i.dataset.club;
      let c = bag.find((b) => b.club === club);
      if (!c) { c = { club, carry: null, total: null, three: null, threeTotal: null, half: null, halfTotal: null }; bag.push(c); }
      if (i.value.trim() === '') return;
      if (v > 0 && v < 450) c.carry = Math.round(metric() ? v / 0.9144 : v);
    });
  };

  const save = async () => {
    readStep();
    const s2 = getSettings();
    Object.assign(s2, { name: p.name, nickname: p.nickname, avatar: p.avatar, handicap: p.handicap, homeCourse: p.homeCourse, hand: p.hand, heightIn: p.heightIn, system: p.system, onboarded: true });
    if (first || step === 3 || bag.some((b) => b.carry)) s2.bag = bag;
    saveSettings(s2);
    if (user) {
      const row = { name: p.name, handicap_index: p.handicap, nickname: p.nickname, avatar: p.avatar || null, home_course: p.homeCourse, handed: p.hand, height_in: p.heightIn ? Math.round(p.heightIn * 10) / 10 : null, onboarded: true };
      try { await saveProfile(user.id, row); }
      catch (e) {
        // Older database without the new columns: keep the basics in the cloud, the rest syncs with settings.
        console.warn('profile save', e);
        await saveProfile(user.id, { name: p.name, handicap_index: p.handicap }).catch(() => {});
      }
    }
    el.remove();
    toast(first ? `You're all set${p.nickname || p.name ? `, ${(p.nickname || p.name).split(' ')[0]}` : ''}.` : 'Profile saved.');
    onDone(p);
  };

  const draw = () => {
    el.innerHTML = `<div class="onb-in">
      <div class="onb-top">${first ? `<div class="steps">${STEPS.map((t, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div><span class="mute small">${step + 1} of ${STEPS.length} · ${STEPS[step]}</span>` : `<div class="tabs2">${STEPS.map((t, i) => `<button type="button" data-step="${i}" class="${i === step ? 'on' : ''}">${t}</button>`).join('')}</div>`}
        ${first ? '' : '<button class="link" data-close>Close</button>'}</div>
      <div class="onb-body">${pages[step]()}</div>
      <div class="onb-foot">
        ${first && step > 0 ? '<button class="btn" data-back>Back</button>' : ''}
        ${first && step === 3 ? '<button class="btn" data-skip>Skip for now</button>' : ''}
        <button class="btn primary" data-next>${!first ? 'Save' : step === 3 ? 'Finish' : 'Next'}</button>
      </div></div>`;
    const q = (sel) => el.querySelector(sel);
    q('[data-close]')?.addEventListener('click', () => el.remove());
    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { readStep(); step = +b.dataset.step; draw(); }));
    q('[data-back]')?.addEventListener('click', () => { readStep(); step--; draw(); });
    q('[data-skip]')?.addEventListener('click', () => { step = 2; save(); });
    q('[data-next]').addEventListener('click', () => {
      if (step === 0 && !q('#oName').value.trim()) { q('#oName').focus(); return toast('Add your name.'); }
      if (!first || step === 3) return save();
      readStep(); step++; draw();
    });
    q('#oPhoto')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { p.name = q('#oName').value.trim(); p.nickname = q('#oNick').value.trim(); p.avatar = await shrinkPhoto(f); draw(); } catch (err) { toast(err.message); }
    });
    q('#oNoHcp')?.addEventListener('change', (e) => { q('#oHcp').disabled = e.target.checked; if (e.target.checked) q('#oHcp').value = ''; });
    el.querySelectorAll('#oHand button').forEach((b) => b.addEventListener('click', () => { p.hand = b.dataset.v; el.querySelectorAll('#oHand button').forEach((x) => x.classList.toggle('on', x === b)); }));
    el.querySelectorAll('#oSys button').forEach((b) => b.addEventListener('click', () => {
      readHeight(); p.system = b.dataset.v;
      const h = q('#oHcp').value, nh = q('#oNoHcp').checked; draw(); q('#oHcp').value = h; q('#oNoHcp').checked = nh;
    }));
    el.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => { q('#oHome').value = b.dataset.c; el.querySelectorAll('.pick').forEach((x) => x.classList.toggle('on', x === b)); }));
  };
  draw();
}

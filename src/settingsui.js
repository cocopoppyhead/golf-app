// Settings tab: connect hardware, connect AI (provider tiles, key, model), import data, the app
// settings (theme, units, height, hand, quality, videos) and the backup. Shares `settings` with main.js through `api`:
// { settings (get/set), toast, afterAccountChange }.
import { aiFrom, PROVIDERS, listModels } from './coach/ai.js';
import { renderInstall } from './install.js';
import { renderAccount } from './cloud/account.js';
import { renderRangefinder } from './rangefinder.js';
import { saveSettings } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null;
const BASE = import.meta.env?.BASE_URL || '/';
// what's in the AI grid: the three that work today, then the ones on the way
const AI_SOON = [['grok', 'Grok', 'xAI', 'grok'], ['deepseek', 'DeepSeek', 'text only, no photos', 'deepseek'], ['mistral', 'Mistral', 'Le Chat', 'mistralai'], ['qwen', 'Qwen', 'Alibaba', 'qwen'], ['kimi', 'Kimi', 'Moonshot AI', 'kimi']];
const AI_NOW = { claude: ['Claude', 'Anthropic', 'claude'], openai: ['ChatGPT', 'OpenAI', 'openai'], gemini: ['Gemini', 'Google', 'googlegemini'] };
const HW_SOON = [['apple', 'Apple Watch', 'Score and shots from your wrist', 'apple'], ['wearos', 'Galaxy Watch & Wear OS', 'Samsung, Pixel Watch', 'wearos'], ['garmin', 'Garmin watch, live', 'Rounds sync as you play, no export', 'garmin'], ['putt', 'osolo putter sensor', 'Every putt stroke, in the grip', null], ['glasses', 'osolo glasses', 'Chips and putts that finish close', null], ['launch', 'More launch monitors, live', 'Rapsodo, Bushnell, TrackMan', null]];
const IMPORT_SOON = [['tmfile', 'TrackMan files', 'The CSV / report download'], ['arccos', 'Arccos', 'Rounds and shots'], ['shotscope', 'Shot Scope', 'Rounds and shots'], ['apps', '18Birdies, Hole19, Golfshot', 'Scorecards']];
const ICON = {
  laser: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="10" rx="3"/><circle cx="17" cy="12" r="4"/><path d="M21 12h2"/></svg>',
  gps: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  launch: '<svg viewBox="0 0 24 24"><path d="M3 19c4-9 10-13 18-14"/><circle cx="4" cy="19" r="2"/><path d="M15 5h6v6"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 14l3 3 3-3M12 10v7"/></svg>',
  invite: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 8v6M15 11h6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  putt: '<svg viewBox="0 0 24 24"><path d="M14 2v14"/><path d="M14 16h-6l-1 3h7"/><circle cx="18" cy="20" r="2"/></svg>',
  glasses: '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14h4M3 13l1-6M21 13l-1-6"/></svg>',
  tmfile: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M8 13h8M8 17h5"/></svg>',
  arccos: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/></svg>',
  shotscope: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  apps: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
};
const brand = (slug, letter) => (slug ? `<img src="${BASE}brands/${slug}.svg" alt="" />` : `<b class="mono">${esc(letter)}</b>`);
const iconHtml = (k, slug) => (slug ? brand(slug) : ICON[k] || '');

/** Bind the form once. */
export function initSettingsUi(a) {
  api = a;
  const f = $('#settingsForm');
  $('#aiModels').addEventListener('click', loadModels);
  for (const n of ['openaiKey', 'geminiKey']) $('#aiForm')[n].addEventListener('change', loadModels);
  f.theme.addEventListener('change', (e) => { api.settings.theme = e.target.value; saveSettings(api.settings); applyTheme(); });
  f.system.addEventListener('change', (e) => {
    const h = parseFloat(f.height.value); const m = e.target.value === 'metric';
    if (!isNaN(h)) f.height.value = m ? Math.round(h * 2.54) : Math.round((h / 2.54) * 10) / 10;
    $('#hUnit').textContent = m ? 'cm' : 'in';
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const h = parseFloat(f.height.value);
    api.settings = { ...api.settings, theme: f.theme.value, system: f.system.value, heightIn: isNaN(h) ? api.settings.heightIn : f.system.value === 'metric' ? h / 2.54 : h, handedness: f.handedness.value, quality: f.quality.value, keepVideos: f.keepVideos.checked };
    saveSettings(api.settings); applyTheme();
    $('#savedMsg').hidden = false;
  });
  $('#aiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const g = e.target; const prov = g.aiProvider.value; const P = PROVIDERS[prov];
    api.settings = { ...api.settings, aiProvider: prov, apiKey: g.apiKey.value.trim(), openaiKey: g.openaiKey.value.trim(), geminiKey: g.geminiKey.value.trim(), [P.modelField]: g.aiModel.value || P.def };
    saveSettings(api.settings);
    $('#aiForm').hidden = true; drawAi(); api.toast?.(`${P.short} connected`);
  });
  $('#aiCancel').onclick = () => { $('#aiForm').hidden = true; drawAi(); };
  // static "coming soon" lists
  const soon = (list, withSub = true) => list.map(([k, name, sub, slug]) => `<div class="soonitem"><span class="hwic">${iconHtml(k, slug)}</span><span><b>${esc(name)}</b>${withSub && sub ? `<span class="mute small">${esc(sub)}</span>` : ''}</span></div>`).join('');
  $('#hwSoon').innerHTML = soon(HW_SOON);
  $('#importSoon').innerHTML = soon(IMPORT_SOON);
  $('#aiSoon').innerHTML = AI_SOON.map(([k, name, sub, slug]) => `<div class="aitile soon"><span class="ailogo">${brand(slug, name[0])}</span><b>${esc(name)}</b><span class="mute small">${esc(sub)}</span></div>`).join('');
  $('#inviteBtn').onclick = inviteFriends;
  $('#deleteAcctBtn').onclick = deleteAccountSheet;
  document.querySelectorAll('.hwic[data-ic]').forEach((el) => { el.innerHTML = el.dataset.ic === 'garmin' ? brand('garmin') : ICON[el.dataset.ic] || ''; });
}

/** The AI tiles: the connected one ticked; tap one to add or change its key. */
function drawAi() {
  const cur = aiFrom(api.settings);
  $('#aiGrid').innerHTML = Object.entries(AI_NOW).map(([id, [name, sub, slug]]) => {
    const P = PROVIDERS[id]; const has = !!api.settings[P.keyField];
    const on = has && cur.provider === id;
    return `<button type="button" class="aitile ${on ? 'on' : ''}" data-ai="${id}"><span class="ailogo">${brand(slug)}</span><b>${esc(name)}</b><span class="mute small">${on ? `In use${cur.model ? ` · ${esc(cur.model)}` : ''}` : has ? 'Key saved · tap to use' : esc(sub)}</span>${on ? '<span class="aitick">✓</span>' : ''}</button>`;
  }).join('');
  document.querySelectorAll('[data-ai]').forEach((b) => b.onclick = () => openAi(b.dataset.ai));
}
function openAi(prov) {
  const g = $('#aiForm'); g.hidden = false; g.aiProvider.value = prov;
  g.apiKey.value = api.settings.apiKey || ''; g.openaiKey.value = api.settings.openaiKey || ''; g.geminiKey.value = api.settings.geminiKey || '';
  document.querySelectorAll('#aiForm [data-prov]').forEach((el) => (el.hidden = el.dataset.prov !== prov));
  const P = PROVIDERS[prov]; const curM = api.settings[P.modelField] || P.def;
  g.aiModel.innerHTML = curM ? `<option value="${esc(curM)}">${esc(curM)}</option>` : '<option value="">Best available (auto)</option>';
  document.querySelectorAll('[data-ai]').forEach((b) => b.classList.toggle('sel', b.dataset.ai === prov));
  if (g[P.keyField].value.trim() && prov !== 'claude') loadModels();
  g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** A friend link when signed in (adds both ways), else the plain app link. */
async function inviteFriends() {
  const { currentUser } = await import('./cloud/supabase.js');
  const { myFriendCode, inviteLink, APP_URL } = await import('./cloud/social.js');
  const { inviteSheet } = await import('./rounds/friends.js');
  const u = await currentUser().catch(() => null);
  const code = u ? await myFriendCode().catch(() => null) : null;
  if (code) return inviteSheet({ title: 'Add me on osolo', link: inviteLink('friend', code), code, blurb: "A friend who opens this link (signed in) is added both ways: you see each other's scores and can invite each other to rounds." });
  inviteSheet({ title: 'Try osolo', link: APP_URL, code: '', blurb: 'Sign in first and the link adds them as your friend too.' });
}
/** Delete the account (server) and, if asked, everything on this phone. */
function deleteAccountSheet() {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Delete account</b><button class="link" data-close>Cancel</button></div>
    <p class="small">This deletes your osolo account and everything synced to it: profile, rounds, swings, friends, league places. It can't be undone.</p>
    <label class="check small"><input type="checkbox" data-local /> Also wipe this phone (rounds, swings, bag, settings, videos)</label>
    <label class="small">Type DELETE to confirm<input data-confirm autocomplete="off" /></label>
    <button class="btn big" data-ok disabled style="color:var(--work);margin-top:10px">Delete my account</button><p class="small" data-out></p></div>`;
  const q = (x) => sheet.querySelector(x);
  q('[data-close]').onclick = () => sheet.remove();
  q('[data-confirm]').oninput = (e) => { q('[data-ok]').disabled = e.target.value.trim() !== 'DELETE'; };
  q('[data-ok]').onclick = async () => {
    q('[data-ok]').disabled = true; q('[data-out]').textContent = 'Deleting…';
    const { sb, currentUser, signOut } = await import('./cloud/supabase.js');
    try {
      if (await currentUser().catch(() => null)) { const { error } = await sb.rpc('delete_my_account'); if (error) throw error; await signOut().catch(() => {}); }
      if (q('[data-local]').checked) {
        localStorage.clear();
        for (const db of (await indexedDB.databases?.()) || [{ name: 'golf-app' }]) if (db.name) indexedDB.deleteDatabase(db.name);
      }
      q('[data-out]').textContent = 'Done. Restarting…'; setTimeout(() => location.reload(), 1200);
    } catch (e) { q('[data-out]').textContent = `Couldn't delete the account: ${e.message || e}. Nothing on this phone was touched.`; q('[data-ok]').disabled = false; }
  };
  document.body.appendChild(sheet);
}

export function fillSettings() {
  const f = $('#settingsForm');
  f.theme.value = api.settings.theme || 'dark';
  f.system.value = api.settings.system || 'imperial';
  f.height.value = f.system.value === 'metric' ? Math.round(api.settings.heightIn * 2.54) : Math.round(api.settings.heightIn * 10) / 10;
  $('#hUnit').textContent = f.system.value === 'metric' ? 'cm' : 'in';
  renderInstall($('#installRow'), true);
  renderAccount($('#accountRow'), { toast: api.toast, onChange: api.afterAccountChange });
  renderRangefinder($('#laserRow'), { toast: api.toast });
  import('./r10/ui.js').then((m) => m.renderR10Row($('#r10Row'), { toast: api.toast })).catch(() => {});
  import('./rounds/friends.js').then((m) => m.renderFriendsCard($('#friendsCard'), { toast: api.toast, invite: false, onJoined: () => window.dispatchEvent(new Event('golf-synced')) })).catch(() => {});
  f.handedness.value = api.settings.handedness; f.quality.value = api.settings.quality;
  f.keepVideos.checked = api.settings.keepVideos !== false;
  $('#aiForm').hidden = true; drawAi();
  $('#savedMsg').hidden = true;
}
async function loadModels() {
  const f = $('#aiForm'); const prov = f.aiProvider.value; const P = PROVIDERS[prov];
  const key = f[P.keyField].value.trim();
  if (!key) { $('#aiModelHint').textContent = `Add your ${P.short} key first.`; return; }
  if (prov === 'claude') { const cur = f.aiModel.value || P.def; f.aiModel.innerHTML = [...new Set([cur, 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])].filter(Boolean).map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join(''); return; }
  $('#aiModelHint').textContent = 'Checking your key…';
  try {
    const ids = await listModels(prov, key);
    const cur = api.settings[P.modelField];
    f.aiModel.innerHTML = ids.map((m, i) => `<option value="${esc(m)}" ${(cur ? m === cur : i === 0) ? 'selected' : ''}>${esc(m)}${i === 0 ? ' (recommended)' : ''}</option>`).join('');
    $('#aiModelHint').textContent = `Key works. ${ids.length} models available.`;
  } catch (e) { $('#aiModelHint').textContent = `That key didn't work: ${e.message}`; }
}

// ---------------- Theme ----------------
export function applyTheme(t = api.settings.theme || 'dark') {
  const mq = matchMedia('(prefers-color-scheme: light)');
  const real = t === 'system' ? (mq.matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = real;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', { light: '#f3f5f9', hybrid: '#ffffff' }[real] || '#0b1120');
  mq.onchange = () => (api.settings.theme === 'system' ? applyTheme('system') : null);
}


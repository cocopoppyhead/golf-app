// Settings tab: the form (units, height, hand, quality, keys, round rules), the AI coach box
// (provider, key, model list) and the theme. Shares `settings` with main.js through `api`:
// { settings (get/set), toast, afterAccountChange }.
import { aiFrom, PROVIDERS, listModels } from './coach/ai.js';
import { RULES, DEFAULT_RULES } from './rounds/tiger.js';
import { renderInstall } from './install.js';
import { renderAccount } from './cloud/account.js';
import { renderRangefinder } from './rangefinder.js';
import { saveSettings } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let api = null;
/** Bind the form once. */
export function initSettingsUi(a) {
  api = a;
  $('#settingsForm').aiProvider.addEventListener('change', showProvider);
  $('#aiModels').addEventListener('click', loadModels);
  for (const n of ['openaiKey', 'geminiKey']) $('#settingsForm')[n].addEventListener('change', loadModels);
  $('#settingsForm').theme.addEventListener('change', (e) => { api.settings.theme = e.target.value; saveSettings(api.settings); applyTheme(); });
  $('#settingsForm').system.addEventListener('change', (e) => {
    const f = $('#settingsForm'); const h = parseFloat(f.height.value);
    const m = e.target.value === 'metric';
    if (!isNaN(h)) f.height.value = m ? Math.round(h * 2.54) : Math.round((h / 2.54) * 10) / 10;
    $('#hUnit').textContent = m ? 'cm' : 'in';
  });
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const h = parseFloat(f.height.value);
    api.settings = {
      ...api.settings,
      theme: f.theme.value, system: f.system.value, heightIn: isNaN(h) ? api.settings.heightIn : f.system.value === 'metric' ? h / 2.54 : h,
      handedness: f.handedness.value, quality: f.quality.value, keepVideos: f.keepVideos.checked,
      keys: f.keys.value, roundRules: [...document.querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule),
      apiKey: f.apiKey.value.trim(), openaiKey: f.openaiKey.value.trim(), geminiKey: f.geminiKey.value.trim(), aiProvider: f.aiProvider.value, golfer: f.golfer.value.trim(),
      routine: { preshot: f.routinePre.value.trim(), mind: f.routineMind.value.trim(), swingThought: f.swingThought.value.trim() },
      [PROVIDERS[f.aiProvider.value].modelField]: f.aiModel.value || PROVIDERS[f.aiProvider.value].def,
    };
    saveSettings(api.settings);
    applyTheme();
    $('#savedMsg').hidden = false;
    aiSummary(false);
  });
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
  f.handedness.value = api.settings.handedness; f.quality.value = api.settings.quality;
  f.keepVideos.checked = api.settings.keepVideos !== false;
  f.keys.value = api.settings.keys || '';
  const on = new Set(api.settings.roundRules || DEFAULT_RULES);
  $('#rulesBoxes').innerHTML = Object.entries(RULES).map(([id, r]) => `<label class="check small"><input type="checkbox" data-rule="${id}" ${on.has(id) ? 'checked' : ''}/> ${esc(r.label)}</label>`).join('');
  f.apiKey.value = api.settings.apiKey || ''; f.openaiKey.value = api.settings.openaiKey || ''; f.geminiKey.value = api.settings.geminiKey || ''; f.golfer.value = api.settings.golfer;
  const rt = api.settings.routine || {}; f.routinePre.value = rt.preshot || ''; f.routineMind.value = rt.mind || ''; f.swingThought.value = rt.swingThought || '';
  f.aiProvider.value = aiFrom(api.settings).provider; showProvider();
  aiSummary(false);
  $('#savedMsg').hidden = true;
}
// AI coach: a one-line summary; tap to open the provider, key and model
function aiSummary(open) {
  const a = aiFrom(api.settings); const P = PROVIDERS[a.provider];
  $('#aiBox').hidden = !open;
  $('#aiSum').innerHTML = a.apiKey
    ? `<span><b>AI coach</b> · ${esc(P.short)}${a.model ? ` · <span class="mute">${esc(a.model)}</span>` : ''} <span class="goodc">✓</span></span><button type="button" class="link" id="aiToggle">${open ? 'Done' : 'Change'}</button>`
    : `<span><b>AI coach</b> <span class="mute">not connected</span><div class="mute small">Claude, ChatGPT or Gemini</div></span><button type="button" class="link acc" id="aiToggle">${open ? 'Cancel' : 'Connect'}</button>`;
  $('#aiToggle').onclick = () => aiSummary($('#aiBox').hidden);
}
// AI provider: show its key field and the models that key can use
function showProvider() {
  const f = $('#settingsForm'); const prov = f.aiProvider.value; const P = PROVIDERS[prov];
  document.querySelectorAll('[data-prov]').forEach((el) => (el.hidden = el.dataset.prov !== prov));
  const cur = api.settings[P.modelField] || P.def;
  f.aiModel.innerHTML = cur ? `<option value="${esc(cur)}">${esc(cur)}</option>` : '<option value="">Best available (auto)</option>';
  if (f[P.keyField].value.trim() && prov !== 'claude') loadModels();
}
async function loadModels() {
  const f = $('#settingsForm'); const prov = f.aiProvider.value; const P = PROVIDERS[prov];
  const key = f[P.keyField].value.trim();
  if (!key) { $('#aiModelHint').textContent = `Add your ${P.short} key first.`; return; }
  if (prov === 'claude') { const cur = f.aiModel.value || P.def; f.aiModel.innerHTML = [...new Set([cur, 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])].map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join(''); return; }
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


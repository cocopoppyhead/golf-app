import './styles.css';
import { loadVideo, findSwings } from './coach/pose.js';
import { getSettings, saveSettings } from './store.js';
import { renderBag } from './bag.js';

import { renderInstall } from './install.js';
import { exportData, importData } from './backup.js';
import { isNative, nativeSend, onNative, blobToBase64 } from './native.js';
import { initRounds, roundsHome, openCardImport } from './rounds/ui.js';
import { renderAccount, initPasswordRecovery } from './cloud/account.js';
import { pendingInviteFromUrl } from './cloud/social.js';
import { renderScoring } from './progress.js';
import { renderPracticeLog } from './practice.js';
import { importLaunchSheet } from './launch.js';
import { swingSheet } from './mygame.js';
import { renderDrillsCard, loadDrills } from './drills.js';

import { initSettingsUi, fillSettings, applyTheme } from './settingsui.js';
import { garminSheet } from './garmin/ui.js';
export { applyTheme } from './settingsui.js';
import { maybeOnboard, avatarHtml, localProfile, openProfileEditor } from './onboarding.js';
import { startSync } from './cloud/sync.js';

import { $, app, toast, showTab, onTab } from './app/shell.js';
import { renderRecent, renderKeys, getState, openVideo, runSession } from './coach/swingflow.js';

initSettingsUi({ get settings() { return app.settings; }, set settings(v) { app.settings = v; }, toast, afterAccountChange });
applyTheme();

// ---------------- Tabs ----------------
onTab('history', () => renderScoring($('#progScoring')));
onTab('settings', () => fillSettings());
onTab('rounds', () => roundsHome());
onTab('bag', () => renderBag($('#bagRoot')));

// ---------------- Rounds ----------------
initRounds($('#roundsRoot'), {
  settings: () => app.settings,
  toast,
  showTab: (t) => showTab(t),
  saveSetting: (k, v) => { app.settings[k] = v; saveSettings(app.settings); },
});

$('#exportBtn2').onclick = async () => {
  const blob = await exportData();
  const name = `osolo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isNative()) return nativeSend({ type: 'share.file', name, mime: 'application/json', b64: await blobToBase64(blob) });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
};
// the weather on the day for any finished round that doesn't have it (posted scores, photo imports,
// rounds logged offline): checked a few seconds after start, at most every 6 hours
setTimeout(async () => {
  try {
    const k = 'golf.wxBackfill'; const last = +localStorage.getItem(k) || 0;
    if (Date.now() - last < 6 * 3600e3 || !navigator.onLine) return;
    localStorage.setItem(k, String(Date.now()));
    const { backfillWeather } = await import('./garmin/ui.js');
    if (await backfillWeather({ limit: 40 })) window.dispatchEvent(new Event('golf-synced'));
  } catch { /* offline or storage blocked: next time */ }
}, 8000);
$('#launchImportBtn').onclick = () => importLaunchSheet({ toast, onSaved: () => window.dispatchEvent(new Event('golf-synced')) });
$('#cardImportBtn').onclick = () => { showTab('rounds'); setTimeout(() => openCardImport(), 50); };
$('#editSwingBtn').onclick = () => swingSheet({ done: renderKeys });
$('#garminBtn').onclick = () => garminSheet({ toast, onImported: () => { renderRecent(); window.dispatchEvent(new Event('golf-synced')); } });
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
  try {
    const r = await importData(await f.text());
    app.settings = getSettings(); fillSettings(); applyTheme(); renderRecent(); window.dispatchEvent(new Event('golf-synced'));
    toast(`Imported ${r.records} record${r.records === 1 ? '' : 's'}${r.settings.length ? ` and settings (${r.settings.join(', ')})` : ''}.`, 6000);
  } catch (err) { toast(err.message, 5000); }
});

$('#buildTag').textContent = `App version ${__BUILD__} UTC`;

window.__toast = toast;
startSync();
loadDrills(); // the drill library backs the swing screens' drill cards
// an invite link (?join= / ?friend=): remembered, acted on from the Play tab once signed in
if (pendingInviteFromUrl()) { showTab('rounds'); toast('Invite received. Sign in (Settings) if you haven\'t, then it joins from Play.'); }

// Header avatar + first-login setup
function renderHeaderAvatar() {
  const p = localProfile();
  const el = $('#hdrAvatar');
  el.hidden = !(p.name || p.avatar);
  el.innerHTML = avatarHtml(p, 'hav');
}
$('#hdrAvatar').onclick = () => showTab('settings');
function afterAccountChange() {
  app.settings = getSettings(); renderRecent(); renderHeaderAvatar();
  maybeOnboard({ toast, onDone: () => { app.settings = getSettings(); fillSettings(); renderHeaderAvatar(); renderAccount($('#accountRow'), { toast, onChange: afterAccountChange }); } });
}
renderHeaderAvatar();
setTimeout(afterAccountChange, 1200);
window.addEventListener('practice-changed', () => { renderPracticeLog($('#practiceLog'), { toast }); renderDrillsCard($('#drillsCard'), { toast }); });
initPasswordRecovery({ toast, onDone: afterAccountChange });

window.addEventListener('golf-synced', () => { app.settings = getSettings(); });

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !getState()) { reloaded = true; location.reload(); } });
}

renderRecent();
renderInstall($('#installBanner'));
onNative('share.error', (m) => toast(m.text, 5000));
if (isNative()) document.documentElement.classList.add('native', ...(window.GolfNative?.platform ? [window.GolfNative.platform] : []));

// Test hook: lets automated tests feed a video URL
window.__golfTest = { open: async (url) => openVideo(await (await fetch(url)).blob()), session: async (url) => runSession(await (await fetch(url)).blob()), state: getState, onboard: () => openProfileEditor({ first: true, toast, onDone: () => { app.settings = getSettings(); renderHeaderAvatar(); } }), scan: async (url) => { const v = await loadVideo(await (await fetch(url)).blob()); document.body.appendChild(v); const r = await findSwings(v, {}); v.remove(); return { ...r, ratio: findSwings.lastRatio, dur: v.duration }; } };

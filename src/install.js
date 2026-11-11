// "Install the app" — Android/desktop Chrome get the native install prompt; iPhone gets the
// Share → Add to Home Screen steps (Safari has no install prompt).
let deferred = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });

export const isInstalled = () => !!window.GolfNative || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const dismissed = () => { try { return localStorage.getItem('golf.installDismissed') === '1'; } catch { return false; } };

export function renderInstall(el, inSettings = false) {
  if (!el) return;
  const draw = () => {
    if (isInstalled()) { el.innerHTML = inSettings ? '<p class="mute small" style="margin:0 0 14px">✓ Installed as an app</p>' : ''; return; }
    if (!inSettings && dismissed()) { el.innerHTML = ''; return; }
    const ios = isIOS();
    const canPrompt = !!deferred;
    el.innerHTML = `<div class="install ${inSettings ? 'in-set' : ''}">
      <img src="icon-192.png" alt="" />
      <div><b>Install osolo as an app</b><div class="mute small">${ios ? 'Full screen, own icon, works offline.' : 'Own icon, full screen, no browser bar.'}</div></div>
      <button class="btn primary" data-inst>${canPrompt ? 'Install' : 'How'}</button>
      ${inSettings ? '' : '<button class="link x" data-x aria-label="Dismiss">✕</button>'}
    </div>`;
    el.querySelector('[data-inst]').onclick = async () => {
      if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return draw(); }
      showSteps(ios);
    };
    el.querySelector('[data-x]')?.addEventListener('click', () => { try { localStorage.setItem('golf.installDismissed', '1'); } catch {} draw(); });
  };
  listeners.add(draw);
  draw();
}

function showSteps(ios) {
  const share = '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:-3px" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 8l5-5 5 5"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>';
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Install osolo</b><button class="link" data-close>Close</button></div>
    ${ios ? `<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap ${share} <b>Share</b> at the bottom.</li><li>Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open Golf from your home screen.</li></ol>
      <p class="mute small">On iPhone the laser can't connect from an installed web app (Apple doesn't allow Bluetooth). Everything else works.</p>`
    : `<ol class="steps"><li>Open this page in <b>Chrome</b>.</li><li>Tap <b>⋮</b> (top right).</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b> → Install).</li><li>Open Golf from your app drawer.</li></ol>`}
  </div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

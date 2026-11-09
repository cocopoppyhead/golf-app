// Rangefinder connection (lives in Settings): connect/disconnect, other brands, teach mode, pairing help, log.
// The Bag and the round logger pick up lock-ons through onLaser().
import { getSettings } from './store.js';
import { isNative } from './native.js';
import { connectLaser, disconnectLaser, onLaser, laserConnected, laserName, laserLog, laserSupported, isIOS, scanLasers, teachLaser, laserNeedsTeaching, forgetLaser } from './laser.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let status = '', found = null, scanning = false, teachMsg = '', connectingNow = false, unsub = null;

export function renderRangefinder(el, { toast = () => {} } = {}) {
  if (!el) return;
  if (!status && laserConnected()) status = `Connected to ${laserName()}`;
  const draw = () => {
    if (!el.isConnected) return;
    el.innerHTML = `<div class="acct">
        <div class="sechead" style="margin:0 0 6px"><b>Rangefinder</b><button type="button" class="infobtn" id="pairHelp" aria-label="How to pair">i</button></div>
        ${laserSupported() ? `
          ${laserConnected() ? `<p class="small" style="margin:0 0 8px"><b>${esc(laserName())}</b> connected</p>
            <button type="button" class="btn" id="laserBtn" style="width:100%">Disconnect</button>`
          : `<p class="mute small">Bushnell (Pro X3 / X3+): first time, set the laser's Bluetooth to PAIR and enter the code shown in the eyepiece (tap ⓘ). Close the Bushnell Golf app, connect, then fire once.</p>
            <button type="button" class="btn primary" id="laserBtn" style="width:100%">Connect Bushnell</button>
            ${isNative() ? `<button type="button" class="btn" id="scanBtn" style="width:100%;margin-top:8px">${scanning ? 'Scanning…' : 'Other rangefinder (Blue Tees, Shot Scope…)'}</button>` : ''}`}
          ${found?.length && !laserConnected() ? `<div class="devlist">${found.map((d) => `<button type="button" class="pick" data-dev="${esc(d.id)}">${esc(d.name)} <span class="mute">${d.rssi ?? ''}</span></button>`).join('')}</div><p class="mute small">Fire the rangefinder to wake it; the strongest signal is at the top.</p>` : ''}
          ${status ? `<p class="small" style="margin:8px 0 0">${esc(status)}</p>` : ''}
          ${laserNeedsTeaching() ? `<div class="teach"><b>Teach it once</b><p class="mute small">Laser a flag or tree, then type exactly what the rangefinder shows. Do it twice with different distances.</p>
            <div class="row"><input id="teachIn" inputmode="decimal" placeholder="Number on screen" /><div class="seg seg2 mini" id="teachUnit"><button type="button" data-u="y" class="on">yds</button><button type="button" data-u="m">m</button></div></div>
            <button type="button" class="btn primary" id="teachBtn" style="width:100%;margin-top:8px">That's the reading</button>${teachMsg ? `<p class="small" style="margin:8px 0 0">${esc(teachMsg)}</p>` : ''}</div>` : ''}
          ${laserConnected() && !laserNeedsTeaching() && getSettings().laserProfiles?.[laserName()] ? '<button type="button" class="link" id="forgetBtn" style="margin-top:8px">Re-teach this rangefinder</button>' : ''}
          <details style="margin-top:8px"><summary class="small mute">Diagnostics log</summary><pre class="log">${esc(laserLog() || 'Nothing yet.')}</pre><button type="button" class="btn" id="copyLog" style="width:100%">Copy log</button></details>`
        : `<p class="mute small">${isIOS() ? 'iPhone browsers don\'t support Bluetooth. Use the ohsolo app for the rangefinder.' : 'This browser has no Bluetooth. Use Chrome, or the ohsolo Android app.'}</p>`}
        ${!isNative() ? '<p class="mute small" style="margin-top:8px">Other brands (Blue Tees, Shot Scope) need the ohsolo app.</p>' : ''}
      </div>`;
    el.querySelector('#copyLog')?.addEventListener('click', () => navigator.clipboard?.writeText(laserLog()).then(() => toast('Log copied')));
    el.querySelector('#pairHelp')?.addEventListener('click', () => {
      const sh = document.createElement('div'); sh.className = 'sheet';
      sh.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Pairing a Bushnell (first time)</b><button type="button" class="link" data-close>Close</button></div>
        <p class="small">The first time you connect, your phone asks for a 6-digit PIN. It's shown <b>inside the laser's eyepiece</b>, not on the box or in the manual, and it changes each time.</p>
        <ol class="steps">
          <li>Look through the eyepiece and <b>hold the Mode button</b> (on top) until the menu appears.</li>
          <li>Press the <b>Power/Fire</b> button to step through the menu until <b>Bluetooth</b> is highlighted.</li>
          <li>Press <b>Mode</b> to change it from OFF / ON to <b>PAIR</b>.</li>
          <li>Press <b>Power/Fire</b> once to select PAIR.</li>
          <li>A 6-digit code appears in the eyepiece. Tap <b>Connect Bushnell</b> here and type that code when your phone asks.</li>
        </ol>
        <p class="mute small">You only do this once; the phone remembers the laser. Close the Bushnell Golf app first: only one app can use the laser at a time. Set the laser to yards.</p></div>`;
      sh.querySelector('[data-close]').onclick = () => sh.remove();
      document.body.appendChild(sh);
    });
    el.querySelector('#scanBtn')?.addEventListener('click', () => {
      scanning = true; found = []; status = 'Scanning… fire the rangefinder to wake it.'; draw();
      scanLasers((list) => { if (list === null) { scanning = false; status = found?.length ? 'Pick your rangefinder.' : 'Nothing found. Turn Bluetooth on in the rangefinder menu and try again.'; } else found = list; if (el.isConnected) draw(); });
    });
    el.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', async () => {
      found = null; teachMsg = '';
      await connectLaser((m) => { status = m; draw(); }, { id: b.dataset.dev }); draw();
    }));
    let tu = 'y';
    el.querySelectorAll('#teachUnit button').forEach((b) => b.addEventListener('click', () => { tu = b.dataset.u; el.querySelectorAll('#teachUnit button').forEach((x) => x.classList.toggle('on', x === b)); }));
    el.querySelector('#teachBtn')?.addEventListener('click', () => { const r = teachLaser(parseFloat(el.querySelector('#teachIn').value), tu); teachMsg = r.msg; if (r.done) status = `${laserName()} learned. Lock on to a target.`; draw(); });
    el.querySelector('#forgetBtn')?.addEventListener('click', () => { forgetLaser(); teachMsg = ''; status = 'Forgotten. Teach it again below.'; draw(); });
    el.querySelector('#laserBtn')?.addEventListener('click', async () => {
      
      if (laserConnected()) { disconnectLaser(); status = 'Disconnected'; return draw(); }
      if (connectingNow) return;
      connectingNow = true; setTimeout(() => (connectingNow = false), 15000);
      try { await connectLaser((m) => { status = m; if (/Connected|error|No Bushnell|Disconnected|wasn't/i.test(m)) connectingNow = false; draw(); }); } catch (e) { status = e.message; connectingNow = false; }
      draw();
    });
  };
  unsub?.();
  unsub = onLaser((r) => { if (!r) status = 'Disconnected'; draw(); });
  draw();
}

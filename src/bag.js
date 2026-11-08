// Bag: your clubs with full and ¾ carries, "which club?" from a distance, and the Bushnell laser.
// Carries are entered by hand for now. Logged laser shots (tagged full / ¾ / mishit) will refine them,
// so mishits never drag your numbers down.
import { getSettings, saveSettings, listShots } from './store.js';
import { saveShotSheet, renderClubPage, trueDistance } from './shots.js';
import { dist as D, toYards, du, duLong } from './units.js';
import { isNative } from './native.js';
import { connectLaser, disconnectLaser, onLaser, laserConnected, laserName, laserLog, laserSupported, isIOS, scanLasers, teachLaser, laserNeedsTeaching, forgetLaser } from './laser.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// New golfers start with a standard bag and no numbers. Personal numbers come from
// typing them in, importing a data file (Settings), or learning from saved shots.
const DEFAULT_BAG = ['Driver', '3 wood', '3 hybrid', '4 hybrid', '5 iron', '6 iron', '7 iron', '8 iron', '9 iron', 'PW', '52°', '56°', '60°']
  .map((club) => ({ club, carry: null, total: null, three: null, threeTotal: null, half: null, halfTotal: null }));
const COLS = { carry: ['carry', 'three', 'half'], total: ['total', 'threeTotal', 'halfTotal'] };

export function getBag() {
  const s = getSettings();
  return Array.isArray(s.bag) && s.bag.length ? s.bag : DEFAULT_BAG;
}
function saveBag(bag) { const s = getSettings(); s.bag = bag; saveSettings(s); }

/** Best option for a distance across full and ¾ swings. */
export function pickClub(bag, yards) {
  const opts = [];
  for (const c of bag) {
    if (c.carry > 0) opts.push({ club: c.club, carry: c.carry, swing: 'full' });
    if (c.three > 0) opts.push({ club: c.club, carry: c.three, swing: '¾' });
    if (c.half > 0) opts.push({ club: c.club, carry: c.half, swing: '½' });
  }
  if (!opts.length) return null;
  opts.sort((a, b) => Math.abs(a.carry - yards) - Math.abs(b.carry - yards) || (a.swing === 'full' ? -1 : 1));
  const best = opts[0];
  const full = bag.filter((c) => c.carry > 0).sort((a, b) => a.carry - b.carry);
  const above = full.find((c) => c.carry >= yards), below = [...full].reverse().find((c) => c.carry < yards);
  const gap = Math.abs(best.carry - yards) > 12 && above && below ? { below, above } : null;
  // alternative: nearest option on the other side of the number, if it's close enough to matter
  const other = opts.filter((o) => (best.carry >= yards ? o.carry < yards : o.carry >= yards));
  const second = other.find((o) => Math.abs(o.carry - yards) <= 12) || null;
  return { best, second, gap, off: best.carry - yards };
}

let unsub = null;

/** Your numbers, with learned (true) distances replacing typed ones once there are 5+ good shots. */
function effectiveBag(bag, shots) {
  return bag.map((c) => {
    const e = { ...c, learned: {} };
    for (const [k, sw] of [['carry', 'full'], ['three', '¾'], ['half', '½']]) {
      const t = trueDistance(shots, c.club, sw);
      if (t && t.n >= 5) { e[k] = t.avg; e.learned[k] = t.n; }
    }
    return e;
  });
}

export async function renderBag(root) {
  const S = getSettings();
  let bag = getBag().map((c) => ({ total: null, three: null, threeTotal: null, half: null, halfTotal: null, ...c }));
  let mode = 'carry';
  let shots = await listShots().catch(() => []);
  let dist = '', shot = null, status = laserConnected() ? `Connected to ${laserName()}` : '';
  let found = null, scanning = false, teachMsg = '';
  const comp = () => getSettings().competition === true;

  const draw = () => {
    const n = parseFloat(dist);
    const ny = toYards(n);
    const eff = effectiveBag(bag, shots);
    const pick = ny && !comp() ? pickClub(eff, ny) : null;
    const sw = (s) => (s === 'full' ? '' : ` ${s}`);
    const sorted = bag.filter((c) => c.carry).sort((a, b) => b.carry - a.carry);
    const gaps = sorted.slice(1).map((c, k) => ({ a: sorted[k], b: c, gap: sorted[k].carry - c.carry })).filter((g) => g.gap >= 18);
    root.innerHTML = `
      <div class="card">
        <div class="sechead" style="margin:0 0 8px"><h2 style="margin:0">Which club?</h2>
          <label class="check small"><input type="checkbox" id="compBox" ${comp() ? 'checked' : ''}/> Competition</label></div>
        <input id="distIn" inputmode="numeric" placeholder="Distance in ${duLong()}" value="${esc(dist)}" />
        ${shot ? `<p class="small mute" style="margin:6px 0 0">Laser: ${D(shot.raw)} ${du()}${shot.slope != null ? ` · slope ${shot.slope.toFixed(1)}% · plays ${D(shot.playsAs)} ${du()}${comp() ? '' : ' · using plays-as'}` : ''}</p>` : ''}
        ${comp() ? '<p class="mute small">Competition mode: distance only, no club advice (Rules of Golf).</p>'
          : pick?.gap ? `<div class="pickbox"><div class="big" style="font-size:22px">No club for ${n} ${du()} yet</div><div class="mute small">Nothing between ${esc(pick.gap.below.club)} (${D(pick.gap.below.carry)} ${du()}) and ${esc(pick.gap.above.club)} (${D(pick.gap.above.carry)} ${du()}). Add carries or ¾ / ½ numbers below.</div></div>`
          : pick ? `<div class="pickbox"><div class="big">${esc(pick.best.club)}${pick.best.swing !== 'full' ? ` <span style="font-size:20px">${pick.best.swing}</span>` : ''}</div>
            <div class="mute small">${eff.find((c) => c.club === pick.best.club)?.learned[pick.best.swing === 'full' ? 'carry' : pick.best.swing === '¾' ? 'three' : 'half'] ? 'your true distance ' : 'carries '}${D(pick.best.carry)} ${du()}${Math.round(D(Math.abs(pick.off))) ? ` · ${D(Math.abs(pick.off))} ${du()} ${pick.off > 0 ? 'long' : 'short'}` : ''}${pick.second ? ` · or ${esc(pick.second.club)}${sw(pick.second.swing)} (${D(pick.second.carry)} ${du()})` : ''}</div></div>`
          : '<p class="mute small">Type a distance, or lock on with the laser.</p>'}
        ${ny ? `<button class="btn primary big" id="saveShot" style="margin-top:10px">Hit it? Save shot</button>` : ''}
      </div>

      <div class="card">
        <h2>Rangefinder</h2>
        ${laserSupported() ? `
          ${laserConnected() ? `<p class="small" style="margin:0 0 8px"><b>${esc(laserName())}</b> connected</p>
            <button class="btn" id="laserBtn" style="width:100%">Disconnect</button>`
          : `<p class="mute small">Bushnell (Pro X3 / X3+): turn Bluetooth on in the laser's menu, close the Bushnell Golf app, connect, then fire once.</p>
            <button class="btn primary" id="laserBtn" style="width:100%">Connect Bushnell</button>
            ${isNative() ? `<button class="btn" id="scanBtn" style="width:100%;margin-top:8px">${scanning ? 'Scanning…' : 'Other rangefinder (Blue Tees, Shot Scope…)'}</button>` : ''}`}
          ${found?.length && !laserConnected() ? `<div class="devlist">${found.map((d) => `<button class="pick" data-dev="${esc(d.id)}">${esc(d.name)} <span class="mute">${d.rssi ?? ''}</span></button>`).join('')}</div><p class="mute small">Fire the rangefinder to wake it; the strongest signal is at the top.</p>` : ''}
          ${status ? `<p class="small" style="margin:8px 0 0">${esc(status)}</p>` : ''}
          ${laserNeedsTeaching() ? `<div class="teach"><b>Teach it once</b><p class="mute small">Laser a flag or tree, then type exactly what the rangefinder shows. Do it twice with different distances.</p>
            <div class="row"><input id="teachIn" inputmode="decimal" placeholder="Number on screen" /><div class="seg seg2 mini" id="teachUnit"><button data-u="y" class="on">yds</button><button data-u="m">m</button></div></div>
            <button class="btn primary" id="teachBtn" style="width:100%;margin-top:8px">That's the reading</button>${teachMsg ? `<p class="small" style="margin:8px 0 0">${esc(teachMsg)}</p>` : ''}</div>` : ''}
          ${laserConnected() && !laserNeedsTeaching() && getSettings().laserProfiles?.[laserName()] ? '<button class="link" id="forgetBtn" style="margin-top:8px">Re-teach this rangefinder</button>' : ''}
          <details style="margin-top:8px"><summary class="small mute">Diagnostics log</summary><pre class="log">${esc(laserLog() || 'Nothing yet.')}</pre><button class="btn" id="copyLog" style="width:100%">Copy log</button></details>`
        : `<p class="mute small">${isIOS() ? 'iPhone browsers don\'t support Bluetooth. Use the Golf Coach app for the rangefinder.' : 'This browser has no Bluetooth. Use Chrome, or the Golf Coach Android app.'}</p>`}
        ${!isNative() ? '<p class="mute small" style="margin-top:8px">Other brands (Blue Tees, Shot Scope) need the Golf Coach app.</p>' : ''}
      </div>

      <div class="card form">
        <div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Your distances</h2>
          <div class="seg seg2 mini"><button data-mode="carry" class="${mode === 'carry' ? 'on' : ''}">Carry</button><button data-mode="total" class="${mode === 'total' ? 'on' : ''}">Total</button></div></div>
        <p class="mute small">${duLong()[0].toUpperCase() + duLong().slice(1)}. Club suggestions use carry. Your best guess for now. Shots you log with the laser, tagged full, ¾, ½ or mishit, will refine these, and mishits won't count.</p>
        <div class="bagrows"><span class="mute small">Club</span><span class="mute small">Full</span><span class="mute small">¾</span><span class="mute small">½</span><span></span><span></span>
          ${bag.map((c, i) => `<input data-cl="${i}" value="${esc(c.club)}" /><input data-cy="${i}" inputmode="numeric" placeholder="–" value="${D(c[COLS[mode][0]]) ?? ''}" /><input data-th="${i}" inputmode="numeric" placeholder="–" value="${D(c[COLS[mode][1]]) ?? ''}" /><input data-hf="${i}" inputmode="numeric" placeholder="–" value="${D(c[COLS[mode][2]]) ?? ''}" /><button class="link" data-rm="${i}">✕</button><button class="link go" data-open="${i}" aria-label="Club page">›</button>${eff[i] && Object.keys(eff[i].learned).length ? `<span class="learned">true distance: ${[['carry', 'full'], ['three', '¾'], ['half', '½']].filter(([k]) => eff[i].learned[k]).map(([k, l]) => `${l} ${D(eff[i][k])}`).join(' · ')}</span>` : ''}`).join('')}</div>
        <button class="btn" id="addClub" style="width:100%;margin-top:8px">+ Club</button>
        ${gaps.length ? `<p class="small" style="color:var(--ok);margin-top:10px">Gap${gaps.length > 1 ? 's' : ''}: ${gaps.map((g) => `${esc(g.a.club)} → ${esc(g.b.club)} (${D(g.gap)} ${du()})`).join(', ')}</p>` : ''}
        <button class="btn primary big" id="saveBag" style="margin-top:10px">Save bag</button>
      </div>`;

    const sync = () => {
      root.querySelectorAll('[data-cl]').forEach((el) => (bag[+el.dataset.cl].club = el.value.trim()));
      const read = (el, attr, key) => { const c = bag[+el.dataset[attr]]; if (String(D(c[key]) ?? '') !== el.value) c[key] = toYards(el.value); };
      root.querySelectorAll('[data-cy]').forEach((el) => read(el, 'cy', COLS[mode][0]));
      root.querySelectorAll('[data-th]').forEach((el) => read(el, 'th', COLS[mode][1]));
      root.querySelectorAll('[data-hf]').forEach((el) => read(el, 'hf', COLS[mode][2]));
    };
    const din = root.querySelector('#distIn');
    din.addEventListener('input', () => { sync(); dist = din.value; shot = null; draw(); const d = root.querySelector('#distIn'); d.focus(); d.setSelectionRange(d.value.length, d.value.length); });
    root.querySelector('#saveShot')?.addEventListener('click', () => {
      sync();
      saveShotSheet({ club: pick?.best?.club || bag[0]?.club, target: ny, laser: shot, clubs: bag.map((c) => c.club).filter(Boolean),
        onSaved: async (s) => { shots = await listShots(); root.dispatchEvent(new CustomEvent('toast', { detail: `Saved: ${s.club} ${D(s.result)} ${du()}`, bubbles: true })); draw(); } });
    });
    root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      sync(); saveBag(bag);
      const c = bag[+b.dataset.open];
      renderClubPage(root, c.club, { carry: c.carry, onBack: () => renderBag(root), onUseCarry: (y) => { c.carry = y; saveBag(bag); renderBag(root); } });
    }));
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { sync(); mode = b.dataset.mode; draw(); }));
    root.querySelector('#compBox').onchange = (e) => { const s = getSettings(); s.competition = e.target.checked; saveSettings(s); sync(); draw(); };
    root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sync(); bag.splice(+b.dataset.rm, 1); draw(); }));
    root.querySelector('#addClub').onclick = () => { sync(); bag.push({ club: '', carry: null, total: null, three: null, threeTotal: null, half: null, halfTotal: null }); draw(); };
    root.querySelector('#saveBag').onclick = () => { sync(); bag = bag.filter((c) => c.club); saveBag(bag); draw(); root.dispatchEvent(new CustomEvent('toast', { detail: 'Bag saved', bubbles: true })); };
    root.querySelector('#copyLog')?.addEventListener('click', () => navigator.clipboard?.writeText(laserLog()).then(() => root.dispatchEvent(new CustomEvent('toast', { detail: 'Log copied', bubbles: true }))));
    root.querySelector('#scanBtn')?.addEventListener('click', () => {
      sync(); scanning = true; found = []; status = 'Scanning… fire the rangefinder to wake it.'; draw();
      scanLasers((list) => { if (list === null) { scanning = false; status = found?.length ? 'Pick your rangefinder.' : 'Nothing found. Turn Bluetooth on in the rangefinder menu and try again.'; } else found = list; if (root.isConnected) draw(); });
    });
    root.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', async () => {
      sync(); found = null; teachMsg = '';
      await connectLaser((m) => { status = m; draw(); }, { id: b.dataset.dev }); draw();
    }));
    let tu = 'y';
    root.querySelectorAll('#teachUnit button').forEach((b) => b.addEventListener('click', () => { tu = b.dataset.u; root.querySelectorAll('#teachUnit button').forEach((x) => x.classList.toggle('on', x === b)); }));
    root.querySelector('#teachBtn')?.addEventListener('click', () => { sync(); const r = teachLaser(parseFloat(root.querySelector('#teachIn').value), tu); teachMsg = r.msg; if (r.done) status = `${laserName()} learned. Lock on to a target.`; draw(); });
    root.querySelector('#forgetBtn')?.addEventListener('click', () => { forgetLaser(); teachMsg = ''; status = 'Forgotten. Teach it again below.'; draw(); });
    root.querySelector('#laserBtn')?.addEventListener('click', async () => {
      sync();
      if (laserConnected()) { disconnectLaser(); status = 'Disconnected'; return draw(); }
      try { await connectLaser((m) => { status = m; draw(); }); } catch (e) { status = e.message; }
      draw();
    });
  };

  unsub?.();
  unsub = onLaser((r) => {
    if (!r) { status = 'Disconnected'; return draw(); }
    if (!root.isConnected) return;
    shot = r;
    dist = String(D(getSettings().competition ? r.raw : r.playsAs || r.raw));
    draw();
  });
  draw();
}

// Bag: your clubs with full and ¾ carries, "which club?" from a distance, and the Bushnell laser.
// Carries are entered by hand for now. Logged laser shots (tagged full / ¾ / mishit) will refine them,
// so mishits never drag your numbers down.
import { getSettings, saveSettings, listShots } from './store.js';
import { saveShotSheet, renderClubPage, trueDistance } from './shots.js';
import { dist as D, toYards, du, duLong } from './units.js';
import { isNative } from './native.js';
import { getConditions, windComponents, carryFactor, playsLike, condText } from './weather.js';
import { isMetric } from './units.js';
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

/** Every shot you can play: full swings, plus ¾ and ½ (where you have numbers) when partials is on. */
export function shotOptions(bag, partials = true) {
  const opts = [];
  for (const c of bag) {
    if (c.carry > 0) opts.push({ club: c.club, carry: c.carry, swing: 'full' });
    if (partials && c.three > 0) opts.push({ club: c.club, carry: c.three, swing: '¾' });
    if (partials && c.half > 0) opts.push({ club: c.club, carry: c.half, swing: '½' });
  }
  return opts;
}

/** Best option for a distance. */
export function pickClub(bag, yards, partials = true) {
  const opts = shotOptions(bag, partials);
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

const SW = { full: '', '¾': ' ¾', '½': ' ½' };
const short = (club) => club.replace(/^(\d) iron$/i, '$1i').replace(/^(\d) wood$/i, '$1w').replace(/^(\d) hybrid$/i, '$1h').replace(/^Driver$/i, 'Dr');
/**
 * Your clubs on a yardage scale. With a target: zoomed to the 3 shots around it (one short,
 * the pick, one long) with the target line drawn through. Without: the whole bag.
 */
function ladderHtml(opts, target, showAll, best = null) {
  if (!opts.length) return '<p class="mute small">Add your carries below and your clubs show here on a scale.</p>';
  const all = [...opts].sort((a, b) => b.carry - a.carry);
  let rows = all;
  const pickO = best ? all.find((o) => o.club === best.club && o.swing === best.swing) : null;
  if (target && !showAll && pickO) {
    // the pick (and anything with the same carry), plus the next shot longer and the next shorter
    const longer = [...all].reverse().find((o) => o.carry > pickO.carry);
    const shorter = all.find((o) => o.carry < pickO.carry);
    rows = all.filter((o) => o === longer || o === shorter || o.carry === pickO.carry);
  }
  const vals = rows.map((o) => o.carry).concat(target ? [target] : []);
  const pad = target && !showAll ? 6 : 4;
  const max = Math.max(...vals) + pad, min = Math.min(...vals) - pad;
  const H = target && !showAll ? 190 : Math.max(220, rows.length * 30);
  const y = (v) => ((max - v) / (max - min)) * H;
  const bestKey = pickO ? pickO.club + pickO.swing : null;
  // keep labels from overlapping in the full view
  let lastY = -99;
  const marks = rows.map((o) => {
    let yy = y(o.carry); if (yy - lastY < 22) yy = lastY + 22; lastY = yy;
    const on = o.club + o.swing === bestKey;
    return `<div class="rung ${on ? 'on' : ''} ${o.swing !== 'full' ? 'part' : ''}" style="top:${yy}px"><span class="cl">${esc(target && !showAll ? o.club : short(o.club))}${SW[o.swing]}</span><span class="yd">${D(o.carry)}</span></div>`;
  }).join('');
  const tl = target ? `<div class="tline" style="top:${y(target)}px"><span>${D(target)} ${du()}</span></div>` : '';
  return `<div class="ladder" style="height:${Math.max(H, lastY + 24)}px"><div class="rail"></div>${marks}${tl}</div>
    ${target ? `<button class="link" id="ladderAll" style="margin-top:4px">${showAll ? 'Zoom to this distance' : 'Show the whole bag'}</button>` : ''}`;
}

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
  let found = null, scanning = false, teachMsg = '', showAll = false;
  let cond = null, wxErr = '', rel = null;
  const loadWx = (force) => getConditions({ force }).then((c) => { cond = c; wxErr = ''; }).catch((e) => { wxErr = e.message; }).finally(() => root.isConnected && draw());
  const comp = () => getSettings().competition === true;

  const draw = () => {
    const n = parseFloat(dist);
    const ny = toYards(n);
    const eff = effectiveBag(bag, shots);
    const partials = getSettings().partials === true;
    // weather: temperature + wind turn the number into a plays-like distance
    const heading = shot?.heading != null && Number.isFinite(shot.heading) && shot.heading !== 0 ? shot.heading : null;
    const wind = windComponents(cond, { heading, rel });
    const factor = comp() ? 1 : carryFactor(cond, wind);
    const play = ny ? playsLike(ny, factor) : null;
    const pick = ny && !comp() ? pickClub(eff, play, partials) : null;
    const sw = (s) => (s === 'full' ? '' : ` ${s}`);
    const sorted = bag.filter((c) => c.carry).sort((a, b) => b.carry - a.carry);
    const gaps = sorted.slice(1).map((c, k) => ({ a: sorted[k], b: c, gap: sorted[k].carry - c.carry })).filter((g) => g.gap >= 18);
    root.innerHTML = `
      <div class="card">
        <div class="sechead" style="margin:0 0 8px"><h2 style="margin:0">Which club?</h2>
          <label class="check small"><input type="checkbox" id="compBox" ${comp() ? 'checked' : ''}/> Competition</label></div>
        <input id="distIn" inputmode="numeric" placeholder="Distance in ${duLong()}" value="${esc(dist)}" />
        <div class="wx">${cond ? `<span>${condText(cond, heading != null || rel ? wind : null, isMetric())}</span>` : `<span class="mute">${wxErr ? esc(wxErr) : 'Getting the weather…'}</span>`}<button class="link" id="wxRefresh" aria-label="Refresh weather">↻</button></div>
        ${cond && cond.windMph >= 2 && heading == null && !comp() ? `<div class="wxrel"><span class="mute small">Wind is</span>${[['into', 'Into me'], ['behind', 'Behind'], ['across', 'Across']].map(([v, l]) => `<button class="${rel === v ? 'on' : ''}" data-rel="${v}">${l}</button>`).join('')}</div>` : ''}
        ${shot ? `<p class="small mute" style="margin:6px 0 0">Laser: ${D(shot.raw)} ${du()}${shot.slope != null ? ` · slope ${shot.slope.toFixed(1)}% · plays ${D(shot.playsAs)} ${du()}${comp() ? '' : ' · using plays-as'}` : ''}</p>` : ''}
        ${comp() ? '<p class="mute small">Competition mode: distance only, no club advice (Rules of Golf).</p>'
          : `${pick ? `<div class="pickbox"><div class="big">${esc(pick.best.club)}${pick.best.swing !== 'full' ? ` <span style="font-size:20px">${pick.best.swing}</span>` : ''}</div>
            <div class="mute small">${eff.find((c) => c.club === pick.best.club)?.learned[pick.best.swing === 'full' ? 'carry' : pick.best.swing === '¾' ? 'three' : 'half'] ? 'your true distance ' : 'carries '}${D(pick.best.carry)} ${du()}${Math.round(D(Math.abs(pick.off))) ? ` · ${D(Math.abs(pick.off))} ${du()} ${pick.off > 0 ? 'long' : 'short'}` : ''}</div>
            ${pick.gap ? `<div class="small" style="color:var(--ok);margin-top:4px">Gap: nothing between ${esc(pick.gap.below.club)} and ${esc(pick.gap.above.club)}</div>` : ''}</div>` : ''}
            ${play && Math.abs(play - ny) >= 1 ? `<p class="playslike">Plays like <b>${D(play)} ${du()}</b> <span class="mute">(${D(ny)} ${du()} on the laser)</span></p>` : ''}
            ${ladderHtml(shotOptions(eff, partials), play, showAll, pick?.best)}
            <label class="check mini" style="margin-top:8px"><input type="checkbox" id="partialBox" ${partials ? 'checked' : ''} /> Include ¾ and ½ swings (wedges)</label>`}

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
      saveShotSheet({ club: pick?.best?.club || bag[0]?.club, target: ny, laser: shot, clubs: bag.map((c) => c.club).filter(Boolean), cond, wind: cond ? { ...wind, rel, heading } : null, factor,
        onSaved: async (s) => { shots = await listShots(); root.dispatchEvent(new CustomEvent('toast', { detail: `Saved: ${s.club} ${D(s.result)} ${du()}`, bubbles: true })); draw(); } });
    });
    root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      sync(); saveBag(bag);
      const c = bag[+b.dataset.open];
      renderClubPage(root, c.club, { carry: c.carry, onBack: () => renderBag(root), onUseCarry: (y) => { c.carry = y; saveBag(bag); renderBag(root); } });
    }));
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { sync(); mode = b.dataset.mode; draw(); }));
    root.querySelector('#wxRefresh')?.addEventListener('click', () => { sync(); cond = null; wxErr = ''; draw(); loadWx(true); });
    root.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => { sync(); rel = rel === b.dataset.rel ? null : b.dataset.rel; draw(); }));
    root.querySelector('#partialBox')?.addEventListener('change', (e) => { const st = getSettings(); st.partials = e.target.checked; saveSettings(st); sync(); draw(); });
    root.querySelector('#ladderAll')?.addEventListener('click', () => { sync(); showAll = !showAll; draw(); });
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
    shot = r; showAll = false; rel = null; loadWx(false);
    dist = String(D(getSettings().competition ? r.raw : r.playsAs || r.raw));
    draw();
  });
  draw();
  loadWx(false);
}

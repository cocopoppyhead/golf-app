// Bag: your clubs with full and ¾ carries, "which club?" from a distance, and the Bushnell laser.
// One number and a small range per club: what you typed, pulled toward what you actually hit as
// shots are saved (tagged full / ¾ / mishit, so mishits never drag your numbers down).
import { getSettings, saveSettings, listShots } from './store.js';
import { saveShotSheet, renderClubPage, trueDistance } from './shots.js';
import { dist as D, toYards, du, duLong } from './units.js';
import { getConditions, windComponents, carryFactor, playsLike, condText } from './weather.js';
import { isMetric } from './units.js';
import { onLaser, laserConnected, laserName } from './laser.js';

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
  const r = (c, k) => c.range?.[k] || {};
  for (const c of bag) {
    if (c.carry > 0) opts.push({ club: c.club, carry: c.carry, swing: 'full', ...r(c, 'carry') });
    if (partials && c.three > 0) opts.push({ club: c.club, carry: c.three, swing: '¾', ...r(c, 'three') });
    if (partials && c.half > 0) opts.push({ club: c.club, carry: c.half, swing: '½', ...r(c, 'half') });
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
 * Horizontal distance bars (DECADE style). With a target: the pick plus one club longer and one
 * shorter, with the target drawn as a line across the bars. Without: the whole bag.
 */
function barsHtml(opts, target, showAll, best = null) {
  if (!opts.length) return '<p class="mute small">No distances yet. Tap Edit to type rough carries, or save shots and the app learns them.</p>';
  const all = [...opts].sort((a, b) => b.carry - a.carry);
  let rows = all;
  const pickO = best ? all.find((o) => o.club === best.club && o.swing === best.swing) : null;
  if (target && !showAll && pickO) {
    const longer = [...all].reverse().find((o) => o.carry > pickO.carry);
    const shorter = all.find((o) => o.carry < pickO.carry);
    rows = all.filter((o) => o === longer || o === shorter || o.carry === pickO.carry);
  }
  const zoom = target && !showAll;
  const vals = rows.flatMap((o) => [o.lo ?? o.carry, o.hi ?? o.carry]).concat(target ? [target] : []);
  // zoomed: bars start near the shortest so the differences are visible; full bag: start at 0
  const lo = zoom ? Math.min(...vals) - 25 : 0, hi = Math.max(...vals) + (zoom ? 10 : 8);
  const pct = (v) => Math.max(2, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const bestKey = pickO ? pickO.club + pickO.swing : null;
  return `<div class="dbars ${zoom ? 'zoom' : ''}">
    ${rows.map((o) => { const on = o.club + o.swing === bestKey; const band = o.lo != null && o.hi > o.lo; return `<button type="button" class="dbar ${on ? 'on' : ''} ${o.swing !== 'full' ? 'part' : ''} ${o.n >= 5 ? 'learned' : ''}" data-open="${esc(o.club)}">
      <span class="cl">${esc(zoom ? o.club : short(o.club))}${SW[o.swing]}</span>
      <div class="trk">${band ? `<s style="left:${pct(o.lo)}%;width:${pct(o.hi) - pct(o.lo)}%"></s>` : ''}<i style="width:${pct(o.carry)}%"></i>${target ? `<b class="tgt" style="left:${pct(target)}%"></b>` : ''}</div>
      <span class="yd">${D(o.carry)}${band ? `<em>${D(o.lo)}–${D(o.hi)}${o.n ? ` · ${o.n}${o.n >= 5 ? '✓' : ''}` : ''}</em>` : ''}</span></button>`; }).join('')}
    ${target ? `<div class="tgtlbl" style="left:calc(var(--cl) + (100% - var(--cl) - var(--yd)) * ${pct(target) / 100})">${D(target)} ${du()}</div>` : ''}
  </div>
  ${target ? `<button class="link" id="ladderAll" style="margin-top:4px">${showAll ? 'Back to 3 clubs' : 'Show the whole bag'}</button>` : ''}`;
}

/**
 * One number per club, from what you typed and what you've actually hit. The typed number is the
 * starting point; every good saved shot pulls the number toward your real average (after ~4 shots the
 * shots carry more weight than the typed guess). The range is your real spread once there are 3+ shots,
 * otherwise a typical spread for a club of that length (about ±3% — a wedge ±3, a driver ±8).
 */
export function resolveClub(c, shots) {
  const e = { ...c, learned: {}, range: {} };
  for (const [k, sw] of [['carry', 'full'], ['three', '¾'], ['half', '½']]) {
    const typed = c[k] > 0 ? c[k] : null;
    const t = trueDistance(shots, c.club, sw);
    const n = t?.n || 0;
    let val = typed;
    if (t && n) { const w = typed ? n / (n + 4) : 1; val = Math.round((typed || 0) * (1 - w) + t.avg * w); }
    if (!val) continue;
    const half = n >= 3 ? Math.max(3, Math.round(t.sd)) : Math.max(3, Math.round(val * 0.03));
    e[k] = val; e.learned[k] = n; e.range[k] = { lo: val - half, hi: val + half, n, typed, avg: t?.avg ?? null };
  }
  return e;
}
const effectiveBag = (bag, shots) => bag.map((c) => resolveClub(c, shots));

export async function renderBag(root) {
  let bag = getBag().map((c) => ({ total: null, three: null, threeTotal: null, half: null, halfTotal: null, ...c }));
  let mode = 'carry';
  let shots = await listShots().catch(() => []);
  let dist = '', shot = null, showAll = false, editing = false;
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
    const sorted = eff.filter((c) => c.carry).sort((a, b) => b.carry - a.carry);
    const gaps = sorted.slice(1).map((c, k) => ({ a: sorted[k], b: c, gap: sorted[k].carry - c.carry })).filter((g) => g.gap >= 18);
    const key = COLS[mode];
    const opts = mode === 'carry' ? shotOptions(eff, partials)
      : bag.flatMap((c) => [c.total > 0 && { club: c.club, carry: c.total, swing: 'full' }, partials && c.threeTotal > 0 && { club: c.club, carry: c.threeTotal, swing: '¾' }, partials && c.halfTotal > 0 && { club: c.club, carry: c.halfTotal, swing: '½' }].filter(Boolean));
    const learnedN = eff.reduce((a, c) => a + (c.learned.carry || 0), 0);
    root.innerHTML = `
      <div class="card">
        <div class="sechead" style="margin:0 0 8px"><h2 style="margin:0">Bag</h2>
          <div class="row" style="gap:6px"><div class="seg seg2 mini"><button data-mode="carry" class="${mode === 'carry' ? 'on' : ''}">Carry</button><button data-mode="total" class="${mode === 'total' ? 'on' : ''}">Total</button></div>
          <button class="btn sm" id="editBag">${editing ? 'Done' : 'Edit'}</button></div></div>
        ${editing ? `
        <p class="mute small">${duLong()[0].toUpperCase() + duLong().slice(1)}. Full, ¾ and ½ swings. Rough numbers are fine: saved shots sharpen them. Tap ✕ to remove a club.</p>
        <div class="bagrows"><span class="mute small">Club</span><span class="mute small">Full</span><span class="mute small">¾</span><span class="mute small">½</span><span></span><span></span>
          ${bag.map((c, i) => `<input data-cl="${i}" value="${esc(c.club)}" /><input data-cy="${i}" inputmode="numeric" placeholder="–" value="${D(c[key[0]]) ?? ''}" /><input data-th="${i}" inputmode="numeric" placeholder="–" value="${D(c[key[1]]) ?? ''}" /><input data-hf="${i}" inputmode="numeric" placeholder="–" value="${D(c[key[2]]) ?? ''}" /><button class="link" data-rm="${i}">✕</button><span></span>`).join('')}</div>
        <button class="btn" id="addClub" style="width:100%;margin-top:8px">+ Club</button>
        <button class="btn primary big" id="saveBag" style="margin-top:10px">Save bag</button>`
        : `
        <input id="distIn" inputmode="numeric" placeholder="Distance in ${duLong()} (or lock on with the laser)" value="${esc(dist)}" />
        <p class="lasline small">${laserConnected() ? `<span class="dotok"></span> ${esc(laserName())} connected` : `<span class="mute">Rangefinder not connected · <a href="#" id="toLaser">connect in Settings</a></span>`}</p>
        <div class="wx">${cond ? `<span>${condText(cond, heading != null || rel ? wind : null, isMetric())}</span>` : `<span class="mute">${wxErr ? esc(wxErr) : 'Getting the weather…'}</span>`}<button class="link" id="wxRefresh" aria-label="Refresh weather">↻</button></div>
        ${cond && cond.windMph >= 2 && heading == null && !comp() && ny ? `<div class="wxrel"><span class="mute small">Wind is</span>${[['into', 'Into me'], ['behind', 'Behind'], ['across', 'Across']].map(([v, l]) => `<button class="${rel === v ? 'on' : ''}" data-rel="${v}">${l}</button>`).join('')}</div>` : ''}
        ${shot ? `<p class="small mute" style="margin:6px 0 0">Laser: ${D(shot.raw)} ${du()}${shot.slope != null ? ` · slope ${shot.slope.toFixed(1)}% · plays ${D(shot.playsAs)} ${du()}${comp() ? '' : ' · using plays-as'}` : ''}</p>` : ''}
        ${comp() ? '<p class="mute small">Competition mode: distance only, no club advice (Rules of Golf).</p>'
          : `${pick ? `<div class="pickbox"><div class="big">${esc(pick.best.club)}${pick.best.swing !== 'full' ? ` <span style="font-size:20px">${pick.best.swing}</span>` : ''}</div>
            <div class="mute small">${pick.best.lo != null ? `${D(pick.best.lo)}–${D(pick.best.hi)} ${du()}` : `carries ${D(pick.best.carry)} ${du()}`}${pick.best.n >= 5 ? ' · from your shots' : ''}${Math.round(D(Math.abs(pick.off))) ? ` · ${D(Math.abs(pick.off))} ${du()} ${pick.off > 0 ? 'long' : 'short'}` : ''}</div>
            ${pick.gap ? `<div class="small" style="color:var(--ok);margin-top:4px">Gap: nothing between ${esc(pick.gap.below.club)} and ${esc(pick.gap.above.club)}</div>` : ''}</div>` : ''}
            ${play && Math.abs(play - ny) >= 1 ? `<p class="playslike">Plays like <b>${D(play)} ${du()}</b> <span class="mute">(${D(ny)} ${du()} on the laser)</span></p>` : ''}`}
        ${barsHtml(opts, comp() ? null : play, showAll, pick?.best)}
        ${ny ? `<button class="btn primary big" id="saveShot" style="margin-top:10px">Hit it? Save shot</button>` : ''}
        <div class="row" style="justify-content:space-between;margin-top:10px;flex-wrap:wrap;gap:6px">
          <label class="check mini"><input type="checkbox" id="partialBox" ${partials ? 'checked' : ''} /> ¾ and ½ swings</label>
          <label class="check mini"><input type="checkbox" id="compBox" ${comp() ? 'checked' : ''}/> Competition</label></div>
        <p class="mute small" style="margin:8px 0 0">${mode === 'carry' ? `Each bar is your number with its range. ${learnedN ? 'Numbers blend what you typed with your saved shots; ✓ = 5+ good shots, so it\'s your real distance.' : 'Save shots after you hit them and the ranges tighten to what you really carry.'} Tap a club for its page.` : `Total distance in ${duLong()}, as typed. Saved shots refine carry, not total.`}</p>
        ${gaps.length ? `<p class="small" style="color:var(--ok);margin-top:8px">Gap${gaps.length > 1 ? 's' : ''}: ${gaps.map((g) => `${esc(g.a.club)} → ${esc(g.b.club)} (${D(g.gap)} ${du()})`).join(', ')}</p>` : ''}`}
      </div>`;

    const sync = () => {
      root.querySelectorAll('[data-cl]').forEach((el) => (bag[+el.dataset.cl].club = el.value.trim()));
      const read = (el, attr, key) => { const c = bag[+el.dataset[attr]]; if (String(D(c[key]) ?? '') !== el.value) c[key] = toYards(el.value); };
      root.querySelectorAll('[data-cy]').forEach((el) => read(el, 'cy', COLS[mode][0]));
      root.querySelectorAll('[data-th]').forEach((el) => read(el, 'th', COLS[mode][1]));
      root.querySelectorAll('[data-hf]').forEach((el) => read(el, 'hf', COLS[mode][2]));
    };
    const din = root.querySelector('#distIn');
    din?.addEventListener('input', () => { sync(); dist = din.value; shot = null; draw(); const d = root.querySelector('#distIn'); d.focus(); d.setSelectionRange(d.value.length, d.value.length); });
    root.querySelector('#saveShot')?.addEventListener('click', () => {
      sync();
      saveShotSheet({ club: pick?.best?.club || bag[0]?.club, target: ny, laser: shot, clubs: bag.map((c) => c.club).filter(Boolean), cond, wind: cond ? { ...wind, rel, heading } : null, factor,
        onSaved: async (s) => { shots = await listShots(); root.dispatchEvent(new CustomEvent('toast', { detail: `Saved: ${s.club} ${D(s.result)} ${du()}`, bubbles: true })); draw(); } });
    });
    root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      sync(); saveBag(bag);
      const c = bag.find((x) => x.club === b.dataset.open); if (!c) return;
      renderClubPage(root, c.club, { carry: c.carry, onBack: () => renderBag(root), onUseCarry: (y) => { c.carry = y; saveBag(bag); renderBag(root); } });
    }));
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { sync(); mode = b.dataset.mode; draw(); }));
    root.querySelector('#editBag').onclick = () => { sync(); if (editing) { bag = bag.filter((c) => c.club); saveBag(bag); } editing = !editing; draw(); };
    root.querySelector('#wxRefresh')?.addEventListener('click', () => { sync(); cond = null; wxErr = ''; draw(); loadWx(true); });
    root.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => { sync(); rel = rel === b.dataset.rel ? null : b.dataset.rel; draw(); }));
    root.querySelector('#toLaser')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('nav button[data-tab=settings]')?.click(); setTimeout(() => document.querySelector('#laserRow')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); });
    root.querySelector('#partialBox')?.addEventListener('change', (e) => { const st = getSettings(); st.partials = e.target.checked; saveSettings(st); sync(); draw(); });
    root.querySelector('#ladderAll')?.addEventListener('click', () => { sync(); showAll = !showAll; draw(); });
    root.querySelector('#compBox') && (root.querySelector('#compBox').onchange = (e) => { const s = getSettings(); s.competition = e.target.checked; saveSettings(s); sync(); draw(); });
    root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sync(); bag.splice(+b.dataset.rm, 1); draw(); }));
    if (root.querySelector('#addClub')) root.querySelector('#addClub').onclick = () => { sync(); bag.push({ club: '', carry: null, total: null, three: null, threeTotal: null, half: null, halfTotal: null }); draw(); };
    if (root.querySelector('#saveBag')) root.querySelector('#saveBag').onclick = () => { sync(); bag = bag.filter((c) => c.club); saveBag(bag); editing = false; draw(); root.dispatchEvent(new CustomEvent('toast', { detail: 'Bag saved', bubbles: true })); };
  };

  unsub?.();
  unsub = onLaser((r) => {
    if (!r) return root.isConnected && draw();
    if (!root.isConnected) return;
    shot = r; showAll = false; rel = null; loadWx(false);
    dist = String(D(getSettings().competition ? r.raw : r.playsAs || r.raw));
    draw();
  });
  draw();
  loadWx(false);
}

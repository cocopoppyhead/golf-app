// Bag: your clubs and carry distances, plus a quick "which club?" from a distance.
// The laser module will feed the distance in automatically; for now you type it.
import { getSettings, saveSettings } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Starting numbers Conor gave in the rangefinder chat; blanks are for him to fill.
const DEFAULT_BAG = [
  ['Driver', 290], ['3 wood', 225], ['3 hybrid', null], ['4 hybrid', null], ['5 iron', null], ['6 iron', null],
  ['7 iron', null], ['8 iron', null], ['9 iron', null], ['PW', 133], ['52°', 108], ['56°', 103], ['60°', 95],
].map(([club, carry]) => ({ club, carry }));

export function getBag() {
  const s = getSettings();
  return Array.isArray(s.bag) && s.bag.length ? s.bag : DEFAULT_BAG;
}
function saveBag(bag) { const s = getSettings(); s.bag = bag; saveSettings(s); }

/** Club whose carry is the closest at or just above the distance; also the one below. */
export function pickClub(bag, yards) {
  const clubs = bag.filter((c) => Number.isFinite(c.carry) && c.carry > 0).sort((a, b) => a.carry - b.carry);
  if (!clubs.length) return null;
  const up = clubs.find((c) => c.carry >= yards) || clubs[clubs.length - 1];
  const down = [...clubs].reverse().find((c) => c.carry < yards) || null;
  return { club: up, alt: down, gapUp: up.carry - yards, gapDown: down ? yards - down.carry : null };
}

export function renderBag(root) {
  let bag = getBag().map((c) => ({ ...c }));
  const draw = (dist = '') => {
    const n = parseFloat(dist);
    const pick = Number.isFinite(n) ? pickClub(bag, n) : null;
    const sorted = bag.map((c, i) => ({ ...c, i })).filter((c) => c.carry).sort((a, b) => b.carry - a.carry);
    const gaps = sorted.slice(1).map((c, k) => ({ a: sorted[k], b: c, gap: sorted[k].carry - c.carry })).filter((g) => g.gap >= 18);
    root.innerHTML = `
      <div class="card">
        <h2>Which club?</h2>
        <div class="row"><input id="distIn" inputmode="numeric" placeholder="Distance in yards" value="${esc(dist)}" /></div>
        ${pick && pick.alt && pick.gapUp > 20 ? `<div class="pickbox"><div class="big" style="font-size:22px">No club for ${n} y yet</div><div class="mute small">Nothing between ${esc(pick.alt.club)} (${pick.alt.carry} y) and ${esc(pick.club.club)} (${pick.club.carry} y). Fill in your carries below.</div></div>` : pick ? `<div class="pickbox"><div class="big">${esc(pick.club.club)}</div><div class="mute small">carries ${pick.club.carry} y${pick.gapUp > 0 ? ` · ${pick.gapUp} y long at full` : ''}${pick.alt ? ` · or a hard ${esc(pick.alt.club)} (${pick.alt.carry} y)` : ''}</div></div>` : '<p class="mute small">Type a distance. With the laser connected (coming), it fills in when you lock on.</p>'}
        <p class="mute small">Uses your carries below. Wind, temperature and slope adjustments come with the laser module.</p>
      </div>
      <div class="card form">
        <h2>Your carries</h2>
        <p class="mute small">Carry, not total. Start with your best guess; logged shots will refine these later.</p>
        <div class="bagrows">${bag.map((c, i) => `<input data-cl="${i}" value="${esc(c.club)}" /><input data-cy="${i}" inputmode="numeric" placeholder="yds" value="${c.carry ?? ''}" /><button class="link" data-rm="${i}">✕</button>`).join('')}</div>
        <button class="btn" id="addClub" style="width:100%;margin-top:8px">+ Club</button>
        ${gaps.length ? `<p class="small" style="color:var(--ok);margin-top:10px">Gap${gaps.length > 1 ? 's' : ''}: ${gaps.map((g) => `${esc(g.a.club)} → ${esc(g.b.club)} (${g.gap} y)`).join(', ')}</p>` : ''}
        <button class="btn primary big" id="saveBag" style="margin-top:10px">Save bag</button>
      </div>`;
    const sync = () => {
      root.querySelectorAll('[data-cl]').forEach((el) => (bag[+el.dataset.cl].club = el.value.trim()));
      root.querySelectorAll('[data-cy]').forEach((el) => (bag[+el.dataset.cy].carry = parseFloat(el.value) || null));
    };
    const din = root.querySelector('#distIn');
    din.addEventListener('input', () => { sync(); draw(din.value); const d = root.querySelector('#distIn'); d.focus(); d.setSelectionRange(d.value.length, d.value.length); });
    root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sync(); bag.splice(+b.dataset.rm, 1); draw(din.value); }));
    root.querySelector('#addClub').onclick = () => { sync(); bag.push({ club: '', carry: null }); draw(din.value); };
    root.querySelector('#saveBag').onclick = () => { sync(); bag = bag.filter((c) => c.club); saveBag(bag); draw(din.value); root.dispatchEvent(new CustomEvent('toast', { detail: 'Bag saved', bubbles: true })); };
  };
  draw();
}

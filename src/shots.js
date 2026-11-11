// Saved shots: what you aimed at (laser/typed), what you actually hit (+/-), swing type, direction, contact.
// These build each club's "true distance" — only good strikes count, mishits never pull the numbers down.
import { putShot, listShots } from './store.js';
import { dist as D, du, toYards, isMetric } from './units.js';
import { condText } from './weather.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const SWINGS = [['full', 'Full'], ['¾', '¾'], ['½', '½'], ['mishit', 'Mishit']];
export const DIRS = [['L', '◀ Left'], ['S', 'On line'], ['R', 'Right ▶']];
export const CONTACT = [['C', 'Centre'], ['FAT', 'Fat'], ['THN', 'Thin'], ['TOE', 'Toe'], ['HEL', 'Heel']];
export const SHAPES = [['HK', 'Hook'], ['PL', 'Pull'], ['DR', 'Draw'], ['ST', 'Straight'], ['FD', 'Fade'], ['PU', 'Push'], ['SL', 'Slice']];

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * True distance for one club + swing type: last 10 non-mishit shots,
 * dropping outliers more than 2.5 × MAD (or 8%) from the median.
 */
export function trueDistance(shots, club, swing = 'full') {
  // shots saved with weather are converted to a normal day (25 °C, still air) first
  const pool = shots.filter((s) => s.club === club && s.swing === swing).slice(0, 10).map((s) => ({ ...s, result: s.norm ?? s.result }));
  if (!pool.length) return null;
  const vals = pool.map((s) => s.result);
  const med = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - med))) || med * 0.03;
  const keep = pool.filter((s) => Math.abs(s.result - med) <= Math.max(2.5 * mad, med * 0.08));
  const k = keep.map((s) => s.result);
  const avg = k.reduce((a, b) => a + b, 0) / (k.length || 1);
  const sd = Math.sqrt(k.reduce((a, b) => a + (b - avg) ** 2, 0) / (k.length || 1));
  return { avg, sd, n: k.length, of: pool.length, dropped: pool.length - k.length };
}

/** Bottom sheet: save the shot you just hit. */
export function saveShotSheet({ club, target, laser = null, clubs = [], cond = null, wind = null, factor = 1, onSaved = () => {} }) {
  const s = { club, target, delta: 0, swing: 'full', dir: null, contact: null, shape: null };
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const seg = (k, list, cols = list.length) => `<div class="segx" style="grid-template-columns:repeat(${cols},1fr)">${list.map(([v, l]) => `<button class="${s[k] === v ? 'on' : ''}" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const draw = () => {
    const res = D(s.target) + s.delta;
    sheet.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Save shot</b><button class="link" data-close>Cancel</button></div>
      <div class="lbl">Club</div>
      <div class="clubchips">${clubs.map((c) => `<button class="${s.club === c ? 'on' : ''}" data-club="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="lbl">Where did it finish? <span class="mute">target ${D(s.target)} ${du()}</span></div>
      <div class="adj">
        <button data-d="-10">−10</button><button data-d="-5">−5</button><button data-d="-1">−1</button>
        <div class="res"><b>${res}</b><span>${du()} ${s.delta ? `(${s.delta > 0 ? '+' : ''}${s.delta})` : '(on the number)'}</span></div>
        <button data-d="1">+1</button><button data-d="5">+5</button><button data-d="10">+10</button>
      </div>
      ${cond ? `<p class="mute small" style="margin:6px 0 0">Saved with the weather: ${esc(condText(cond, wind, isMetric()))}</p>` : ''}
      <div class="lbl">Swing</div>${seg('swing', SWINGS)}
      <div class="lbl">Direction</div>${seg('dir', DIRS)}
      <div class="lbl">Contact <span class="mute">(optional)</span></div>${seg('contact', CONTACT)}
      <div class="lbl">Shape <span class="mute">(optional)</span></div>${seg('shape', SHAPES, 4)}
      <button class="btn primary big" data-save>Save ${esc(s.club)} · ${res} ${du()}</button>
    </div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { s[b.dataset.k] = s[b.dataset.k] === b.dataset.v && b.dataset.k !== 'swing' ? null : b.dataset.v; draw(); }));
    sheet.querySelectorAll('[data-club]').forEach((b) => (b.onclick = () => { s.club = b.dataset.club; draw(); }));
    sheet.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { s.delta += +b.dataset.d; draw(); }));
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-save]').onclick = async () => {
      const result = toYards(D(s.target) + s.delta);
      const shot = { id: `sh_${Date.now()}`, date: Date.now(), club: s.club, target: s.target, result, swing: s.swing, dir: s.dir, contact: s.contact, shape: s.shape, laser, source: laser ? 'laser' : 'manual',
        cond: cond || null, wind: wind || null, factor: cond ? +factor.toFixed(4) : null, norm: cond && factor ? result / factor : null };
      await putShot(shot);
      sheet.remove();
      onSaved(shot);
    };
  };
  draw();
  document.body.appendChild(sheet);
}

/** Club page: true distance per swing type, misses, shape, contact, history. */
export async function renderClubPage(root, club, { carry, onBack, onUseCarry }) {
  const all = (await listShots()).filter((s) => s.club === club);
  const td = { full: trueDistance(all, club, 'full'), '¾': trueDistance(all, club, '¾'), '½': trueDistance(all, club, '½') };
  const good = all.filter((s) => s.swing !== 'mishit');
  const count = (k, v) => all.filter((s) => s[k] === v).length;
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const dirN = all.filter((s) => s.dir).length, conN = all.filter((s) => s.contact).length, shN = all.filter((s) => s.shape).length;
  // dispersion: short/long vs target (y), left/on/right (x, jittered)
  const pts = good.slice(0, 30).map((s, i) => ({ x: (s.dir === 'L' ? -1 : s.dir === 'R' ? 1 : 0) * 34 + ((i * 37) % 13) - 6, y: Math.max(-40, Math.min(40, (s.result - s.target) * 2)) }));
  root.innerHTML = `
    <button class="btn" data-back>‹ Bag</button>
    <div class="card"><h2>${esc(club)}</h2>
      <div class="lbl">True distance <span class="mute">last 10 shots, outliers dropped</span></div>
      <div class="kpis">${['full', '¾', '½'].map((k) => `<div><b>${td[k] ? D(td[k].avg) : '–'}</b><span>${k === 'full' ? 'Full' : k}${td[k] ? ` · ${td[k].n} shots` : ''}</span></div>`).join('')}<div><b>${carry ? D(carry) : '–'}</b><span>your number</span></div></div>
      ${td.full ? `<p class="small mute">Full: ±${D(td.full.sd)} ${du()} spread${td.full.dropped ? ` · ${td.full.dropped} outlier${td.full.dropped > 1 ? 's' : ''} ignored` : ''}${all.filter((s) => s.swing === 'mishit').length ? ` · ${all.filter((s) => s.swing === 'mishit').length} mishits not counted` : ''}</p>` : '<p class="small mute">Save shots with this club to build its true distance.</p>'}
      ${td.full && td.full.n >= 3 && carry && Math.abs(td.full.avg - carry) >= 3 ? `<button class="btn primary" data-use style="width:100%">Use ${D(td.full.avg)} ${du()} as my full ${esc(club)}</button>` : ''}
    </div>
    ${good.length ? `<div class="card"><h2>Accuracy</h2>
      <svg viewBox="-60 -50 120 100" class="target"><circle r="45" class="r3"/><circle r="30" class="r2"/><circle r="15" class="r1"/>
        <text x="0" y="-38" class="tl">long</text><text x="0" y="46" class="tl">short</text>
        ${pts.map((p) => `<circle cx="${p.x}" cy="${-p.y}" r="3.2" class="pt"/>`).join('')}</svg>
      <div class="kpis"><div><b>${pct(count('dir', 'S'), dirN)}%</b><span>on line</span></div><div><b>${pct(count('dir', 'L'), dirN)}%</b><span>left</span></div><div><b>${pct(count('dir', 'R'), dirN)}%</b><span>right</span></div><div><b>${pct(good.filter((s) => s.result < s.target - 3).length, good.length)}%</b><span>short</span></div></div>
    </div>` : ''}
    ${shN ? `<div class="card"><h2>Shot shape</h2><div class="bars">${SHAPES.map(([k, l]) => `<div><span>${l}</span><div class="meter"><div style="width:${pct(count('shape', k), shN)}%;background:var(--acc)"></div></div><span>${pct(count('shape', k), shN)}%</span></div>`).join('')}</div></div>` : ''}
    ${conN ? `<div class="card"><h2>Contact</h2><div class="face">
      <span class="f-fat">Fat<b>${pct(count('contact', 'FAT'), conN)}%</b></span><span class="f-toe">Toe<b>${pct(count('contact', 'TOE'), conN)}%</b></span>
      <span class="f-c">Centre<b>${pct(count('contact', 'C'), conN)}%</b></span><span class="f-hel">Heel<b>${pct(count('contact', 'HEL'), conN)}%</b></span>
      <span class="f-thn">Thin<b>${pct(count('contact', 'THN'), conN)}%</b></span></div></div>` : ''}
    <div class="card"><h2>Range shots</h2><p class="mute small" style="margin:-4px 0 8px">Distances you saved with this club, for its true carry.</p>${all.length ? all.slice(0, 25).map((s) => `<div class="tagrow"><span>${new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${D(s.result)} ${du()} <span class="mute">(aimed ${D(s.target)})</span> · ${s.swing}${s.dir ? ` · ${s.dir}` : ''}${s.contact ? ` · ${s.contact}` : ''}</span></div>`).join('') : '<p class="mute small">None yet.</p>'}</div>`;
  root.querySelector('[data-back]').onclick = onBack;
  root.querySelector('[data-use]')?.addEventListener('click', () => onUseCarry(td.full.avg));
  // launch-monitor speeds for this club, if any sessions were saved
  import('./launch.js').then(async (L) => { const html = await L.launchClubHtml(club); if (html && root.isConnected) { const d = document.createElement('div'); d.innerHTML = html; const card = d.firstElementChild; root.querySelector('.card').after(card); (await import('./drills.js')).bindDrillCards(card, { toast: (m) => window.__toast?.(m) }); } });
  // on the course with this club: record, strengths and weaknesses, against your level and scratch
  import('./clubpage.js').then(async (C) => { const html = await C.clubCourseHtml(club); if (html && root.isConnected) { const d = document.createElement('div'); d.innerHTML = html; const cards = [...d.children]; let after = root.querySelectorAll('.card')[1] || root.querySelector('.card'); for (const el of cards) { after.after(el); after = el; } } });
  window.scrollTo(0, 0);
}

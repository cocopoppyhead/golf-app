// The Bushnell loop. You lock on to the flag; before you've lowered the laser the app has the
// shot up: distance, what it plays (slope from the laser, wind and temperature from the weather),
// the club, and ✓. One tap (or none: it accepts itself after a few seconds). Every read also
// takes a GPS fix, which is how the app knows you've walked to the next tee.
import { onLaser } from '../laser.js';
import { isNative, nativeSend } from '../native.js';
import { isMetric } from '../units.js';
import { getBag, resolveClub, pickClub } from '../bag.js';
import { listShots, listRounds, getCourse, putRound } from '../store.js';
import { getConditions, windComponents, carryFactor } from '../weather.js';
import { dist as D, du } from '../units.js';
import { loadGeo, geoHole, markedHole, requestFix } from './holemap.js';
import { metres, lineDist } from '../geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const AUTO_ACCEPT_S = 12;

let api = null; // { getCur, setCur, renderHole, toast, ensureShots }
let bagCache = { t: 0, bag: [] };
async function effectiveBag() {
  if (Date.now() - bagCache.t > 60000) { const shots = await listShots().catch(() => []); bagCache = { t: Date.now(), bag: getBag().map((c) => resolveClub(c, shots)) }; }
  return bagCache.bag;
}

/** The hole you're on, from where you stand: current hole unless you're clearly nearer the next tee. */
export function detectHole(fix, course, geo, i) {
  if (!fix || fix.acc > 40) return i;
  const p = [fix.lat, fix.lon];
  const line = (k) => { const gh = geoHole(geo, k + 1) || markedHole(course.holes[k]?.mark, k + 1); return gh?.line || null; };
  const cur = line(i), next = line(i + 1);
  if (!next) return i;
  const dNextTee = metres(p, next[0]);
  const dCur = cur ? lineDist(p, cur) : Infinity;
  const dNext = lineDist(p, next);
  // at the next tee (within 45 m) and not on the current hole's line any more: you've walked on
  if (dNextTee < 45 && dCur > 35) return i + 1;
  if (dNext < dCur - 40 && dNextTee < 120) return i + 1;
  return i;
}

/** Plays-like from a laser read: Bushnell slope figure if it sent one, then wind and temperature. */
export function playsFrom(r, cond) {
  const slope = Number.isFinite(r.playsAs) && r.playsAs > 0 && Math.abs(r.playsAs - r.raw) > 0.4 ? r.playsAs : r.raw;
  const wind = windComponents(cond, { heading: Number.isFinite(r.heading) ? r.heading : null });
  const f = carryFactor(cond, wind);
  return { plays: Math.round(slope / f), slope: Math.round(slope), wind, factor: f };
}

/** Tell the native shell what it needs to suggest a club in a background notification. */
let cfgSent = 0;
export async function syncLoopConfig(force = false) {
  if (!isNative() || (!force && Date.now() - cfgSent < 5 * 60e3)) return;
  cfgSent = Date.now();
  const [bag, cond] = await Promise.all([effectiveBag(), getConditions().catch(() => null)]);
  const clubs = [];
  for (const c of bag) { if (c.carry > 0) clubs.push({ club: c.club, carry: c.carry, swing: 'full' }); if (c.three > 0) clubs.push({ club: c.club, carry: c.three, swing: '¾' }); if (c.half > 0) clubs.push({ club: c.club, carry: c.half, swing: '½' }); }
  nativeSend({ type: 'loop.config', clubs, factor: carryFactor(cond, { head: 0 }), metric: isMetric() });
}

let pop = null; // the open shot card
export function initLaserLoop(a) {
  api = a;
  onLaser(async (r, meta = {}) => {
    if (!r?.raw) return;
    const cur = api.getCur();
    const round = cur?.round && !cur.round.finished ? cur.round : (await listRounds().catch(() => [])).find((x) => !x.finished);
    if (!round) return;
    const course = cur?.round === round ? cur.course : await getCourse(round.courseId).catch(() => null);
    if (!course) return;
    const [geo, fix, bag, cond] = await Promise.all([loadGeo(course.libId), requestFix(3500), effectiveBag(), getConditions().catch(() => null)]);
    let i = round.curHole ?? Math.max(0, round.holes.findIndex((x) => !x || x.score == null));
    const ni = detectHole(fix, course, geo, i);
    if (ni !== i) {
      // leaving a hole the normal way (next ›) fills in putts etc.; a GPS advance does the same quietly
      const prev = round.holes[i]; if (prev && prev.putts == null && prev.shots?.some((s) => s.dist != null)) prev.putts = 2;
      i = ni; round.curHole = i; api.toast(`Hole ${i + 1}`);
      if (cur?.round === round) cur.hole = i;
    }
    const par = course.holes[i]?.par ?? 4;
    const h = round.holes[i] || (round.holes[i] = api.blankHole());
    if (!h.shots?.length) api.ensureShots(h, par, course.holes[i]?.yds);
    const last = h.shots.reduce((m, x, k) => (x?.src === 'laser' ? k : m), -1);
    let k;
    const gh = geoHole(geo, i + 1) || markedHole(course.holes[i]?.mark, i + 1);
    const onTee = fix && fix.acc <= 40 && gh && metres([fix.lat, fix.lon], gh.line[0]) < 45;
    const yds = course.holes[i]?.yds;
    if (last >= 0 && Date.now() - (h.shots[last].t || 0) < 45000) k = last; // re-lasering: same shot
    else if (!h.shots.some((x, n) => n > 0 && x?.dist != null) && (par === 3 || (yds && Math.abs(r.raw - yds) < Math.max(60, yds * 0.2)) || (onTee && !yds))) k = 0; // the pin from the tee: the tee shot
    else if (onTee && !h.shots.some((x, n) => n > 0 && x?.dist != null)) k = -1; // a target from the tee (layup, hazard): club for it, pin distance stays the card's
    else { k = h.shots.findIndex((x, n) => n >= 1 && (!x || x.dist == null)); if (k < 1) k = Math.max(1, h.shots.length); }
    const pl = playsFrom(r, cond);
    const pick = pickClub(bag, pl.plays, true);
    const gps = fix && fix.acc <= 60 ? { lat: +fix.lat.toFixed(6), lon: +fix.lon.toFixed(6), acc: Math.round(fix.acc) } : null;
    const target = k === -1; if (target) k = 0;
    const x = target ? { ...h.shots[0], target: Math.round(r.raw), plays: pl.plays, src: h.shots[0].src || 'card', t: Date.now(), gps, heading: Number.isFinite(r.heading) ? Math.round(r.heading) : null }
      : { ...(h.shots[k] || {}), dist: Math.round(r.raw), plays: pl.plays, src: 'laser', t: Date.now(), gps, heading: Number.isFinite(r.heading) ? Math.round(r.heading) : null };
    if (pick?.best) x.d = { ...(x.d || {}), club: pick.best.club, swing: pick.best.swing, suggested: true };
    h.shots[k] = x;
    round.curHole = i;
    await putRound(round).catch(() => {});
    if (meta.t) x.t = meta.t;
    if (meta.accepted && pick?.best) { x.d.suggested = false; await putRound(round).catch(() => {}); api.toast(`${pick.best.club} · ${D(r.raw)} ${du()}`); }
    else shotCard({ round, course, i, k, x, pl, pick, bag, cond, target });
    if (cur?.round === round && document.querySelector('#holeMap, .holebar')) api.renderHole();
    syncLoopConfig();
  });
}

function shotCard({ round, course, i, k, x, pl, pick, bag, cond, target }) {
  const read = target ? x.target : x.dist;
  pop?.remove();
  const el = document.createElement('div'); el.className = 'sheet laserpop'; pop = el;
  const unit = du();
  const clubs = bag.filter((c) => c.carry > 0).sort((a, b) => b.carry - a.carry);
  const best = pick?.best, second = pick?.second;
  const windTxt = pl.wind && Math.abs(pl.wind.head) >= 2 ? `${Math.round(Math.abs(pl.wind.head))} mph ${pl.wind.head > 0 ? 'into' : 'behind'}` : null;
  const why = [pl.slope !== Math.round(read) ? `slope ${pl.slope}` : null, windTxt, cond && Math.abs(cond.tempC - 25) >= 6 ? `${Math.round(cond.tempC)}°C` : null].filter(Boolean).join(' · ');
  let left = AUTO_ACCEPT_S, timer = null;
  el.innerHTML = `<div class="sheet-in lp">
    <div class="lp-top"><span class="mute small">Hole ${i + 1} · ${target ? 'target from the tee' : `shot ${k + 1}`}${x.gps ? ' · position saved' : ''}</span><button class="link" data-x="no">Not a shot</button></div>
    <div class="lp-num"><b>${D(read)}</b><span>${unit}</span>${pl.plays !== Math.round(read) ? `<em>plays ${D(pl.plays)}</em>` : ''}</div>
    ${why ? `<div class="mute small">${esc(why)}</div>` : ''}
    ${best ? `<button class="btn primary big lp-ok" data-x="ok">✓ ${esc(best.club)}${best.swing !== 'full' ? ` ${best.swing}` : ''} <span class="lp-cd">${left}</span></button>
      ${second ? `<button class="btn big" data-club="${esc(second.club)}" data-sw="${esc(second.swing)}">${esc(second.club)}${second.swing !== 'full' ? ` ${second.swing}` : ''} <span class="mute small">${D(second.carry)}</span></button>` : ''}` : '<p class="mute small">Add carries in Bag and the club comes up here.</p>'}
    <div class="lbl">Other club</div><div class="clubchips">${clubs.map((c) => `<button data-club="${esc(c.club)}" data-sw="full" class="${best?.club === c.club ? 'on' : ''}">${esc(c.club)}<small>${D(c.carry)}</small></button>`).join('')}</div>
    <p class="mute small" style="margin:8px 0 0">Change it later in the shot's Details. ${x.gps ? 'Position saved with the read.' : 'No GPS fix for this read.'}</p></div>`;
  const finish = async (club, swing) => {
    clearInterval(timer); el.remove(); if (pop === el) pop = null;
    if (club) { x.d = { ...(x.d || {}), club, swing, suggested: false }; }
    else if (x.d?.suggested) { x.d.suggested = false; }
    await putRound(round).catch(() => {});
    api.toast(club ? `${club} · ${D(read)} ${unit}` : `${D(read)} ${unit} logged`);
    if (api.getCur()?.round === round && document.querySelector('#holeMap, .holebar')) api.renderHole();
  };
  el.querySelector('[data-x=ok]')?.addEventListener('click', () => finish(best.club, best.swing));
  el.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => finish(b.dataset.club, b.dataset.sw));
  el.querySelector('[data-x=no]').onclick = async () => {
    clearInterval(timer); el.remove(); if (pop === el) pop = null;
    const h = round.holes[i]; const idx = h.shots.indexOf(x);
    if (target) { delete x.target; delete x.plays; if (x.d?.suggested) delete x.d; }
    else if (idx > 0 && idx === h.shots.length - 1 && !x.res && !x.lie) h.shots.splice(idx, 1); else if (idx >= 0) { delete x.dist; delete x.src; delete x.plays; delete x.gps; if (x.d?.suggested) delete x.d; }
    await putRound(round).catch(() => {});
    if (api.getCur()?.round === round && document.querySelector('#holeMap, .holebar')) api.renderHole();
  };
  if (best) timer = setInterval(() => { left -= 1; const cd = el.querySelector('.lp-cd'); if (cd) cd.textContent = left; if (left <= 0) finish(best.club, best.swing); }, 1000);
  document.body.appendChild(el);
  try { navigator.vibrate?.(30); } catch {}
}

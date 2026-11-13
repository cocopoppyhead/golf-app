// The shot panels on the hole screen, as HTML. One panel per shot, shaped by where the ball is:
//   tee      — club (Driver on a par 4/5, or the club you usually hit on this hole), where it finished
//   fairway  — the lie (slope pad + surface, carried over from where the last shot finished), distance,
//              club (suggested from the distance), where it finished
//   greenside — short lies, wedges and putter, green first
//   green    — one panel after the ball finishes on the green: first-putt length (asked once), putts,
//              optional break and slope
// Colour marks the part of the hole: copper for the tee, fairway green in between, deep green at the green.
// Pure: rendering only; ui.js binds the buttons. No DOM access here.
import { ENDED, ENDED_GREENSIDE, TEE_EXTRA, DIRS, SURFACES, SURFACES2, GREENSIDE_LIES, LIE_NAMES, troubleFor, isGreenside, OLD_ENDED } from './hole.js';
import { TEE_ZONES } from './stats.js';
import { PUTT_BANDS, puttBand, puttLabel } from '../units.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LONG_CLUB = /driver|wood|hybrid|^[1-5] ?iron/i;
const SHORT_CLUB = /^(pw|gw|aw|sw|lw|putter)$|wedge|^\d{2}°?$/i;

/** Where in the hole this shot is played from: 'tee' | 'greenside' | 'fairway'. */
export const zoneOf = (h, k) => (k === 0 ? 'tee' : isGreenside(h, k) ? 'greenside' : 'fairway');

/**
 * The club you usually hit off this tee: of your last rounds on this course with a tee club logged
 * (not one osolo filled in), the most common one if you used it at least twice and it isn't the Driver.
 */
export function usualTeeClub(rounds, courseId, holeIdx, { exclude = null, last = 5 } = {}) {
  const seen = rounds.filter((r) => r.id !== exclude && r.courseId === courseId && !r.quick)
    .sort((a, b) => b.date - a.date)
    .map((r) => r.holes?.[holeIdx]?.shots?.[0]?.d)
    .filter((d) => d?.club && !d.clubAuto).slice(0, last).map((d) => d.club);
  if (seen.length < 2) return null;
  const n = {}; seen.forEach((c) => { n[c] = (n[c] || 0) + 1; });
  const [club, k] = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return k >= 2 && !/driver/i.test(club) ? { club, n: k, of: seen.length } : null;
}

// a typical club golfer's full carries (yards), for bags without numbers yet
const TYPICAL = [[/driver/i, 230], [/^3 ?w/i, 210], [/^5 ?w/i, 195], [/^7 ?w/i, 185], [/^[2-3] ?h/i, 185], [/^4 ?h/i, 178], [/^5 ?h/i, 170], [/^[1-3] ?i/i, 185], [/^4 ?i/i, 175], [/^5 ?i/i, 165], [/^6 ?i/i, 155], [/^7 ?i/i, 145], [/^8 ?i/i, 135], [/^9 ?i/i, 125], [/^pw|pitching/i, 115], [/^(gw|aw)|gap/i, 100], [/^sw|sand/i, 85], [/^lw|lob/i, 70]];
export const carryOf = (c) => (c.carry > 0 ? c.carry : (TYPICAL.find(([re]) => re.test(c.club)) || [])[1] || null);
/** The bag club whose full carry (yours, or a typical one until you've set it) is closest to `yds`, or null. */
export function clubForDistance(bag, yds) {
  if (yds == null) return null;
  const withCarry = bag.filter((c) => !/putter/i.test(c.club) && carryOf(c));
  if (!withCarry.length) return null;
  return withCarry.reduce((a, b) => (Math.abs(carryOf(b) - yds) < Math.abs(carryOf(a) - yds) ? b : a)).club;
}

/** The handful of clubs offered on a panel (the rest behind "Other…"). */
export function clubChoices(bag, zone, { chosen = null, suggest = null, open = false } = {}) {
  const names = bag.map((c) => c.club).filter(Boolean);
  if (open) return names;
  let list;
  if (zone === 'tee-long') list = names.filter((n) => LONG_CLUB.test(n)).slice(0, 4);
  else if (zone === 'greenside') list = names.filter((n) => SHORT_CLUB.test(n));
  else {
    // around the suggested (or chosen) club; with nothing to go on, the middle of the bag
    let i = names.indexOf(suggest ?? chosen);
    if (i < 0) i = Math.max(0, names.findIndex((n) => /^7 ?i/i.test(n)));
    list = names.slice(Math.max(0, i - 1), i + 2);
  }
  if (chosen && !list.includes(chosen)) list = [...list, chosen];
  return list;
}

const btn = (on, attrs, label, cls = '') => `<button class="${on ? 'on' : ''} ${cls}" ${attrs}>${label}</button>`;
const RES_LABEL = Object.fromEntries([...TEE_ZONES, ...ENDED, ...TEE_EXTRA, ...OLD_ENDED, ['GS', 'Greenside']]);
const DIR_LABEL = Object.fromEntries(DIRS);

/** The folded line for a logged shot (tap to open). */
export function shotLine(x, k, { zone, dist, du }) {
  const tee = k === 0;
  const res = x.res === 'LR' || x.res === 'LT' ? `${RES_LABEL[x.res].toLowerCase()} left` : x.res === 'RR' || x.res === 'RT' ? `${RES_LABEL[x.res].toLowerCase()} right` : (RES_LABEL[x.res] || x.res || '').toLowerCase();
  const bits = [x.d?.club, !tee && x.dist != null ? `${dist(x.dist)} ${du()}` : null, res || null, x.dir ? `missed ${DIR_LABEL[x.dir] || x.dir}` : null, x.res2 ? RES_LABEL[x.res2] : null, x.pen ? '+1 pen' : null].filter(Boolean).join(' · ');
  return `<button class="card shotline z-${zone}" data-expand="${k}"><span class="sn">${k + 1}</span><span><b>${tee ? 'Tee shot' : `Shot ${k + 1}`}</b><span class="mute small">${esc(bits)}</span></span><span class="mute">✎</span></button>`;
}

/**
 * One open shot panel. o = { h, k, par, course, bag, usual, clubOpen, dist, du, holeYds }.
 */
export function shotPanel(o) {
  const { h, k, par, course, bag, usual, clubOpen, dist, du } = o;
  const x = h.shots[k];
  const zone = zoneOf(h, k);
  const tee = zone === 'tee';
  const lie = x.lie || x.lieAuto;
  const clubZone = tee && par >= 4 ? 'tee-long' : zone;
  const target = tee ? (x.dist ?? o.holeYds) : (x.plays ?? x.dist);
  const suggest = !x.d?.club && !(tee && par >= 4) ? clubForDistance(bag, target) : null;
  const clubs = clubChoices(bag, clubZone, { chosen: x.d?.club, suggest, open: clubOpen });
  const clubHint = x.d?.club && x.src === 'laser' ? 'from the rangefinder'
    : tee && par >= 4 && x.d?.clubAuto && usual ? `you hit ${usual.club} here ${usual.n} of the last ${usual.of} times`
      : x.d?.clubAuto && !tee && target != null ? `${dist(target)} ${du()}: tap another if you hit something else` : '';
  const clubRow = `<div class="lbl">Club${clubHint ? ` <em>· ${esc(clubHint)}</em>` : ''}</div>
    <div class="clubrow">${clubs.map((c) => btn(x.d?.club === c, `data-club="${k}" data-v="${esc(c)}"`, esc(c), !x.d?.club && suggest === c ? 'sug' : '')).join('')}${clubOpen ? '' : `<button data-clubmore="${k}">${zone === 'greenside' ? 'Other…' : '…'}</button>`}</div>`;

  let lieHtml = '';
  if (zone === 'fairway') {
    const from = x.lie ? '' : x.lieAuto && k > 0 && h.shots[k - 1]?.res ? ` <em>· ${esc((LIE_NAMES[x.lieAuto] || x.lieAuto).toLowerCase())}, from your ${k === 1 ? 'tee shot' : `shot ${k}`}</em>` : '';
    const cell = (feet, hill, label) => btn((x.feet || null) === feet && (x.hill || null) === hill, `data-slope="${k}" data-feet="${feet || ''}" data-hill="${hill || ''}"`, label, !feet && !hill ? 'flat' : '');
    const trouble = troubleFor(course);
    const surf = [...SURFACES, ...trouble, ...(trouble.length < 2 ? [['rec', 'Trees']] : []), ...SURFACES2];
    lieHtml = `<div class="lbl">Lie${from}</div>
      <div class="slopepad"><span class="st">Ball above feet</span><span class="sl">Uphill</span>
        <div class="pad">${cell('abv', 'up', '↖')}${cell('abv', null, '↑')}${cell('abv', 'dn', '↗')}${cell(null, 'up', '←')}${cell(null, null, 'Flat')}${cell(null, 'dn', '→')}${cell('blw', 'up', '↙')}${cell('blw', null, '↓')}${cell('blw', 'dn', '↘')}</div>
        <span class="sr">Downhill</span><span class="sb">Ball below feet</span></div>
      <div class="g4 surf">${surf.map(([v, l]) => btn(lie === v || (v === 'bnk' && lie === 'fbk'), `data-lie="${k}" data-v="${v}"`, l, !x.lie && (lie === v || (v === 'bnk' && lie === 'fbk')) ? 'auto' : '')).join('')}</div>
      <p class="small mute trow">Trouble on this course: ${trouble.map((t) => t[1]).join(' and ')} <button class="link" data-trouble>change</button></p>`;
  } else if (zone === 'greenside') {
    lieHtml = `<div class="lbl">Lie</div><div class="g4">${GREENSIDE_LIES.map(([v, l]) => btn(lie === v, `data-lie="${k}" data-v="${v}"`, l, !x.lie && lie === v ? 'auto' : '')).join('')}</div>`;
  }

  const distHtml = tee ? '' : `<div class="lbl">To the pin${zone === 'greenside' ? ' <span class="mute">(optional)</span>' : ''}</div>
    <div class="srow1"><input inputmode="numeric" data-sd="${k}" placeholder="${du()}" value="${x.dist != null ? dist(x.dist) : ''}" /><span class="mute small">${du()}${x.src === 'laser' ? ` · laser${x.plays && x.plays !== x.dist ? `, plays ${dist(x.plays)}` : ''}${x.gps ? ' · 📍' : ''}` : x.src === 'club' ? ' · ≈ from club' : ''}</span></div>`;

  let ended;
  if (tee && par >= 4) {
    ended = `<div class="sides"><span>Left</span><span></span><span>Right</span></div>
      <div class="g5">${TEE_ZONES.map(([z, l]) => btn(x.res === z, `data-res="${k}" data-v="${z}"`, l, z === 'FW' ? 'fw' : '')).join('')}</div>
      <div class="g4" style="margin-top:6px">${TEE_EXTRA.map(([v, l]) => btn(x.res2 === v, `data-res2="${k}" data-v="${v}"`, l)).join('')}</div>`;
  } else if (zone === 'greenside') {
    ended = `<div class="g4">${ENDED_GREENSIDE.slice(0, 4).map(([v, l]) => btn(x.res === v, `data-res="${k}" data-v="${v}"`, l)).join('')}</div>
      <div class="g2" style="margin-top:6px">${ENDED_GREENSIDE.slice(4).map(([v, l]) => btn(x.res === v, `data-res="${k}" data-v="${v}"`, l)).join('')}</div>`;
  } else {
    ended = `<div class="g4">${ENDED.slice(0, 4).map(([v, l]) => btn(x.res === v, `data-res="${k}" data-v="${v}"`, l)).join('')}</div>
      <div class="g5" style="margin-top:6px">${ENDED.slice(4).map(([v, l]) => btn(x.res === v, `data-res="${k}" data-v="${v}"`, l)).join('')}</div>`;
    if (x.res && ['GS', 'BK'].includes(x.res)) ended += `<div class="lbl">Missed the green: where, from the flag?</div><div class="g5">${DIRS.map(([v, l]) => btn(x.dir === v, `data-dir="${k}" data-v="${v}"`, l)).join('')}${btn(x.ss, `data-ss="${k}"`, 'Short-sided', x.ss ? 'warn' : '')}</div>`;
  }
  const tag = { tee: 'Tee', fairway: 'Fairway', greenside: 'Greenside' }[zone];
  return `<div class="card shotpanel z-${zone}">
    <div class="sp-h"><span class="sn">${k + 1}</span><b>${tee ? 'Tee shot' : `Shot ${k + 1}`}</b><span class="ztag">${tag}</span>
      <span class="mute small">${tee ? `${x.dist ? `${dist(x.dist)} ${du()}` : ''}${x.target ? ` · target ${dist(x.target)}${x.gps ? ' 📍' : ''}` : ''}` : ''}</span>
      <button class="btn sm" data-det="${k}">${x.d && (x.d.flight || x.d.strike || x.d.cause || x.d.plan != null || x.d.sat || x.d.cost != null) ? 'Details ✓' : 'Details'}</button></div>
    ${o.detLine ? `<div class="detline">${o.detLine}</div>` : ''}
    ${lieHtml}${distHtml}${clubRow}
    <div class="lbl">Ended up</div>${ended}
    <div class="sp-f"><button class="link" data-pen="${k}">${x.pen ? '<span class="pen">+1 penalty ✕</span>' : '+ penalty stroke'}</button>${k > 0 && k === h.shots.length - 1 ? `<button class="link" data-rm="${k}">Remove shot</button>` : ''}</div>
  </div>`;
}

// The read of a putt on a 3×3 pad, like the stance one: across = which way it breaks, down = up or downhill.
const PREAD_BRK = [['RL', 'Breaks left'], ['S', ''], ['LR', 'Breaks right']];
const PREAD_SL = [['up', 'Uphill'], ['flat', ''], ['dn', 'Downhill']];
const PCELL = { 'up|RL': '↰', 'up|S': '↑', 'up|LR': '↱', 'flat|RL': '⤺', 'flat|S': 'Straight', 'flat|LR': '⤻', 'dn|RL': '↲', 'dn|S': '↓', 'dn|LR': '↳' };

/**
 * One putt. The first gets every length band and the full read pad; later putts are shorter, so fewer
 * bands and a one-line read. Then: in the hole, or missed (which opens the next putt).
 */
export function puttPanel(h, j, { open = false } = {}) {
  const p = h.puttList[j];
  // a missed putt that has a putt after it folds to one line, like a logged shot
  if (!open && j < h.puttList.length - 1) {
    const rd = [p.sl && p.sl !== 'flat' ? (p.sl === 'up' ? 'uphill' : 'downhill') : null, p.brk === 'X' ? 'double break' : p.brk === 'RL' ? 'breaks left' : p.brk === 'LR' ? 'breaks right' : p.brk === 'S' ? 'straight' : null].filter(Boolean).join(', ');
    const miss = [p.mlen === 'S' ? 'short' : p.mlen === 'L' ? 'long' : null, p.mside === 'LF' ? 'left' : p.mside === 'R' ? 'right' : null].filter(Boolean).join(' and ');
    return `<button class="card shotline z-greenside" data-pexp="${j}"><span class="sn">${j + 1}</span><span><b>Putt ${j + 1}</b><span class="mute small">${esc([p.ft != null ? puttLabel(p.ft) : null, rd || null, miss ? `missed ${miss}` : 'missed'].filter(Boolean).join(' · '))}</span></span><span class="mute">✎</span></button>`;
  }
  const first = j === 0;
  const band = puttBand(p.ft);
  const bands = first ? PUTT_BANDS : PUTT_BANDS.slice(0, 5);
  const cell = (sl, brk) => btn((p.sl || 'flat') === sl && (p.brk || 'S') === brk && (p.sl || p.brk), `data-pread="${j}" data-sl="${sl}" data-brk="${brk}"`, PCELL[`${sl}|${brk}`], sl === 'flat' && brk === 'S' ? 'flat' : '');
  const read = first
    ? `<div class="lbl">Read <span class="mute">(optional)</span></div>
      <div class="slopepad putt"><span class="st">Uphill</span><span class="sl">Breaks left</span>
        <div class="pad">${PREAD_SL.flatMap(([sl]) => PREAD_BRK.map(([brk]) => cell(sl, brk))).join('')}</div>
        <span class="sr">Breaks right</span><span class="sb">Downhill</span></div>
      ${btn(p.brk === 'X', `data-pread="${j}" data-brk="X" data-sl=""`, "It's complicated (double break)", 'wide')}`
    : `<div class="lbl">Read <span class="mute">(optional)</span></div><div class="g3">${[['RL', 'Breaks left'], ['S', 'Straight'], ['LR', 'Breaks right']].map(([v, l]) => btn(p.brk === v, `data-pread="${j}" data-brk="${v}" data-sl=""`, l)).join('')}</div>`;
  const last = j === h.puttList.length - 1;
  return `<div class="card shotpanel z-green ${first ? '' : 'later'}" ${last ? 'id="greenPanel"' : ''}>
    <div class="sp-h"><span class="sn">${j + 1}</span><b>Putt ${j + 1}</b><span class="ztag">Green</span></div>
    <div class="lbl">How far from the hole?</div>
    <div class="g4 bands">${bands.map(([v]) => btn(band === v, `data-pft="${j}" data-v="${v}"`, puttLabel(v).replace(/^(Tap-in)$/, 'Tap-in<small>≤2 ft</small>'))).join('')}</div>
    ${read}
    <div class="g2 presult">${btn(p.holed, `data-pholed="${j}"`, 'In the hole')}${btn(!p.holed && !last, `data-pmiss="${j}"`, 'Missed')}</div>
    ${!p.holed && !last ? `<div class="lbl">Where did it miss? <span class="mute">(optional)</span></div>
    <div class="g3">${[['LF', 'Left'], ['C', 'On line'], ['R', 'Right']].map(([v, l]) => btn(p.mside === v, `data-pmside="${j}" data-v="${v}"`, l)).join('')}</div>
    <div class="g2" style="margin-top:6px">${[['S', 'Short'], ['L', 'Long']].map(([v, l]) => btn(p.mlen === v, `data-pmlen="${j}" data-v="${v}"`, l)).join('')}</div>` : ''}
  </div>`;
}

/** Closure before moving on: how many putts, and the hole's score against par. */
export function holeDone(h, par) {
  if (h.score == null) return '';
  const d = h.score - par;
  const word = d <= -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `+${d}`;
  return `<div class="card holedone ${d < 0 ? 'under' : d > 0 ? 'over' : ''}"><b>${h.score}</b><span><b>${word}</b><span class="mute small">${h.putts === 0 ? 'holed from off the green' : `${h.putts} putt${h.putts === 1 ? '' : 's'}${h.puttsAuto ? ' (assumed)' : ''}`}</span></span></div>`;
}

/** The strip from tee to green with a dot where each shot was played from. */
export function routeStrip(h, yds, label = '') {
  const shots = h.shots || [];
  const n = shots.length;
  const pos = shots.map((x, k) => {
    if (k === 0) return 6;
    if (yds && x.dist != null) return Math.max(10, Math.min(86, 100 - (x.dist / yds) * 100));
    return 10 + (76 * k) / Math.max(1, n);
  });
  const done = h.shots?.[n - 1]?.res === 'G' || h.shots?.[n - 1]?.res === 'HO';
  return `<div class="route" aria-hidden="true"><div class="bar">${pos.map((p, k) => `<span class="dot ${!done && k === n - 1 ? 'now' : ''}" style="left:${p.toFixed(1)}%">${k + 1}</span>`).join('')}${done ? `<span class="dot now flag" style="left:95%">⛳</span>` : ''}</div>
    <div class="ends"><span>Tee</span><span>${esc(label)}</span><span>Green</span></div></div>`;
}

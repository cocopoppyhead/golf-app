// The biggest leak, and why. A coach doesn't spread effort across the whole game: they find the part
// that costs the most against the player's level (the radar's weakest spoke) and work out why it
// leaks, then spend the practice there. An 8/10 chipper doesn't need chipping lessons.
//
// Why is read from what the golfer logged on those shots, sorted into the four reasons a part of the
// game leaks:
//   strategy  short-sided, finished in a bunker, "decision" tagged, a touch shot chosen where a full one
//             hits more greens
//   direction missed left or right of the green; pulls, pushes, hooks, slices
//   distance  missed short or long
//   strike    thin, fat, toe, heel
//   (and focus / routine or body when they tagged it)
// Pin positions aren't logged (too much to ask), so "left" means left of the green, not of the flag.
// Every number is counted by the app; the coach reads it. Too little shot-by-shot data → it says so.
import { skillRadar, LONG_FROM } from '../rounds/radar.js';

const GREEN = new Set(['G', 'HO']);
const TOUCH = new Set(['3q', 'half', 'pitch', 'punch']);
const AREAS = {
  ott: { label: 'driving', pick: (x, k, par) => k === 0 && par >= 4 },
  appL: { label: `long approaches (${LONG_FROM}+ yards)`, pick: (x, k, par) => (k > 0 || par === 3) && x.dist >= LONG_FROM && x.dist < 260 },
  appW: { label: `wedges (30-${LONG_FROM - 1} yards)`, pick: (x, k, par) => (k > 0 || par === 3) && x.dist >= 30 && x.dist < LONG_FROM },
  arg: { label: 'short game (chips, pitches, bunkers)', pick: (x, k) => k > 0 && x.dist != null && x.dist < 30 && x.sw !== 'putter' && x.lie !== 'grn' },
};

/** Rounds logged shot by shot (by hand: a watch's shots don't say where they finished): 9+ holes with shots. */
export const shotRounds = (rcs) => rcs.filter(({ r }) => !r.quick && (r.holes || []).filter((h) => h?.shots?.length && !h.shots.some((s) => s?.src === 'garmin')).length >= 9);

/** The why for one area: counts over every logged shot in it. */
export function whyFor(key, rcs) {
  const A = AREAS[key];
  if (!A) return null;
  const c = { n: 0, green: 0, short: 0, long: 0, left: 0, right: 0, shortSided: 0, bunker: 0, strike: 0, strikeBy: {}, dirFlight: 0, tagged: { TAC: 0, SWE: 0, FOC: 0, BAC: 0 }, notPlanned: 0, planN: 0, sat: [], touch: { n: 0, g: 0 }, full: { n: 0, g: 0 }, bySw: {}, tee: { fw: 0, trouble: 0, ob: 0 } };
  for (const { r, c: course } of shotRounds(rcs)) {
    (r.holes || []).forEach((h, i) => {
      const par = course?.holes?.[i]?.par || 4;
      (h?.shots || []).forEach((x, k) => {
        if (!x || x.src === 'garmin' || !A.pick(x, k, par)) return;
        if (key === 'ott') {
          if (!x.res) return; c.n++;
          if (x.res === 'FW') c.tee.fw++;
          if (['LT', 'RT'].includes(x.res) || ['FB', 'WS', 'PN', 'WT', 'OB'].includes(x.res2) || x.pen) c.tee.trouble++;
          if (x.res === 'LT' || x.res === 'LR') c.left++; if (x.res === 'RT' || x.res === 'RR') c.right++;
          if (x.res2 === 'OB' || x.res === 'OB') c.tee.ob++;
        } else {
          if (!x.res && !x.pen) return; c.n++;
          const hit = GREEN.has(x.res);
          if (hit) c.green++;
          if (!hit) { if (x.dir === 'S') c.short++; if (x.dir === 'L') c.long++; if (x.dir === 'LF') c.left++; if (x.dir === 'R') c.right++; }
          if (x.ss) c.shortSided++;
          if (x.res === 'BK') c.bunker++;
          const g = TOUCH.has(x.sw) ? c.touch : x.sw === 'full' || !x.sw ? c.full : null;
          if (g) { g.n++; if (hit) g.g++; }
          const sw = x.sw || 'full'; c.bySw[sw] = c.bySw[sw] || { n: 0, g: 0 }; c.bySw[sw].n++; if (hit) c.bySw[sw].g++;
        }
        const d = x.d || {};
        if (d.strike) { c.strike++; c.strikeBy[d.strike] = (c.strikeBy[d.strike] || 0) + 1; }
        if (['PL', 'PU', 'HK', 'SL'].includes(d.flight)) c.dirFlight++;
        if (d.cause && d.cause in c.tagged) c.tagged[d.cause]++;
        if (d.plan === true || d.plan === false) { c.planN++; if (!d.plan) c.notPlanned++; }
        if (d.sat) c.sat.push(d.sat);
      });
    });
  }
  return c;
}

/** Putting: where the putts go. Long ones (lag: 3-putts from 20 ft+) or short ones (missed from inside 8 ft). */
export function puttingWhy(rcs) {
  const c = { holes: 0, lagN: 0, lag3: 0, shortN: 0, shortMiss: 0, midN: 0, mid3: 0, missN: 0, left: 0, right: 0, onLine: 0, short: 0, long: 0, leftOnRtoL: 0, leftOnLtoR: 0, rightOnRtoL: 0, rightOnLtoR: 0, straightN: 0, leftOnStraight: 0, rightOnStraight: 0 };
  for (const { r } of shotRounds(rcs)) for (const h of r.holes || []) for (const p of h?.puttList || []) {
    if (p.holed || (!p.mside && !p.mlen)) continue;
    c.missN++;
    if (p.mside === 'LF') c.left++; if (p.mside === 'R') c.right++; if (p.mside === 'C') c.onLine++;
    if (p.mlen === 'S') c.short++; if (p.mlen === 'L') c.long++;
    // brk: RL = breaks right to left, LR = left to right (the read). A miss left on every read is a pull.
    if (p.brk === 'RL') { if (p.mside === 'LF') c.leftOnRtoL++; if (p.mside === 'R') c.rightOnRtoL++; }
    if (p.brk === 'LR') { if (p.mside === 'LF') c.leftOnLtoR++; if (p.mside === 'R') c.rightOnLtoR++; }
    if (p.brk === 'S') { c.straightN++; if (p.mside === 'LF') c.leftOnStraight++; if (p.mside === 'R') c.rightOnStraight++; }
  }
  for (const { r } of shotRounds(rcs)) for (const h of r.holes || []) {
    if (!h || h.putts == null || h.puttsAuto || h.firstPutt == null || h.firstPuttSrc === 'garmin-green' || !(h.putts > 0)) continue;
    c.holes++;
    if (h.firstPutt >= 20) { c.lagN++; if (h.putts >= 3) c.lag3++; } else if (h.firstPutt <= 8) { c.shortN++; if (h.putts >= 2) c.shortMiss++; } else { c.midN++; if (h.putts >= 3) c.mid3++; }
  }
  return c;
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const STRIKE = { THN: 'thin', FAT: 'fat', TOE: 'toe', HEL: 'heel' };

/** The reasons, biggest first: [{ why, n, text }]. */
export function reasons(key, c) {
  if (!c?.n) return [];
  const out = [];
  if (key === 'ott') {
    out.push({ why: 'direction', n: c.left + c.right, text: `${c.left} left, ${c.right} right of the fairway${c.dirFlight ? `; ${c.dirFlight} tagged pull, push, hook or slice` : ''}` });
    out.push({ why: 'trouble', n: c.tee.trouble, text: `${c.tee.trouble} in trouble (trees, waste, bunker, water, OB)` });
  } else {
    out.push({ why: 'strategy', n: c.shortSided + c.bunker + c.tagged.TAC, text: `${c.shortSided} short-sided, ${c.bunker} in a bunker${c.tagged.TAC ? `, ${c.tagged.TAC} tagged a decision` : ''}` });
    out.push({ why: 'direction', n: c.left + c.right + c.dirFlight, text: `${c.left} missed left, ${c.right} right${c.dirFlight ? `; ${c.dirFlight} tagged pull, push, hook or slice` : ''}` });
    out.push({ why: 'distance', n: c.short + c.long, text: `${c.short} short, ${c.long} long` });
  }
  if (c.strike) out.push({ why: 'strike', n: c.strike, text: Object.entries(c.strikeBy).map(([k, v]) => `${v} ${STRIKE[k] || k}`).join(', ') });
  if (c.tagged.FOC) out.push({ why: 'focus', n: c.tagged.FOC, text: `${c.tagged.FOC} tagged focus or routine` });
  if (c.tagged.BAC) out.push({ why: 'body', n: c.tagged.BAC, text: `${c.tagged.BAC} tagged body` });
  return out.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
}

/** The block the coach reads: the areas against their level, the biggest leak, and why it leaks. */
export function leakText(rcs, { hcp } = {}) {
  const sr = shotRounds(rcs).length;
  if (sr < 3) return `WHERE TO FOCUS: not enough yet. ${sr} round${sr === 1 ? '' : 's'} logged shot by shot (by hand, with where each shot finished); it takes 3 or more to see which part of the game costs the most and why. ${rcs.length ? 'Scorecards alone show the score, not the cause. ' : ''}Ask them to log their next 3 rounds shot by shot.`;
  const radar = skillRadar(rcs, { hcp: Number.isFinite(+hcp) ? +hcp : 15 });
  const ok = radar.axes.filter((a) => a.enough && a.value != null && a.key !== 'head').sort((a, b) => a.value - b.value);
  if (ok.length < 2) return `WHERE TO FOCUS: ${sr} rounds logged shot by shot, not yet enough shots in each part of the game to compare them. Keep logging: shots with a distance and where they finished.`;
  const lvl = (a) => `${a.label}${a.sub ? ` (${a.sub})` : ''} ${a.value >= 0 ? '+' : ''}${a.value.toFixed(1)}`;
  const worst = ok[0], gap = ok[ok.length - 1].value - worst.value;
  const lines = [`WHERE TO FOCUS (worked out by the app from ${sr} rounds logged shot by shot)`,
    `Each part against their level, strokes a round (plus is better): ${ok.map(lvl).join(', ')}.`,
    `Biggest leak: ${worst.label.toLowerCase()}${gap >= 0.5 ? `, ${gap.toFixed(1)} strokes a round behind their best part` : ', though the parts are close'}. Coach this first; don't spend the session on their strengths.`];
  const c = whyFor(worst.key, rcs);
  if (worst.key === 'putt') {
    const p = puttingWhy(rcs);
    if (p.missN >= 8) lines.push(`Missed putts with a side logged (${p.missN}): ${p.left} left, ${p.right} right, ${p.onLine} on line; ${p.short} short, ${p.long} long. By the read: breaking right to left, ${p.leftOnRtoL} left / ${p.rightOnRtoL} right; left to right, ${p.leftOnLtoR} left / ${p.rightOnLtoR} right; straight, ${p.leftOnStraight} left / ${p.rightOnStraight} right. Misses to one side whatever the read point to the stroke or the set-up (a pull or push: path, face, aim, the putter's fit), not the read; misses on the low side of the break point to the read or the speed. Several causes produce the same miss: suggest a test (a gate drill, an aim check with a line or laser) or a local pro to look at it, rather than a cure.`);
    lines.push(`Why it leaks, from ${p.holes} holes with a first-putt length: from 20 ft and over, ${p.lag3} three-putts in ${p.lagN} (lag, speed); from 8 ft and in, ${p.shortMiss} missed in ${p.shortN} (start line, routine, nerve); 9-19 ft, ${p.mid3} three-putts in ${p.midN}.`);
  } else if (c?.n >= 8) {
    const R = reasons(worst.key, c);
    const greens = worst.key === 'ott' ? `${pct(c.tee.fw, c.n)}% fairways` : `${pct(c.green, c.n)}% greens`;
    lines.push(`Why it leaks, from ${c.n} logged shots (${greens}): ${R.length ? R.map((x) => `${x.why}: ${x.text}`).join('; ') : 'no misses tagged with a reason yet'}.`);
    const SWN = { full: 'full', '3q': '¾', half: '½', pitch: 'pitch', punch: 'punch' };
    const sws = Object.entries(c.bySw).filter(([k, v]) => SWN[k] && v.n >= 4);
    if (sws.length >= 2) lines.push(`Greens hit by swing length: ${sws.map(([k, v]) => `${SWN[k]} ${pct(v.g, v.n)}% (${v.n})`).join(', ')}. The ANALYSIS block cuts these shots more ways (the greens, wind, lie, distance, club, the round).`);
    if (c.planN >= 8) lines.push(`${pct(c.notPlanned, c.planN)}% weren't the shot they wanted${c.sat.length >= 8 ? `; satisfaction ${(c.sat.reduce((a, b) => a + b, 0) / c.sat.length).toFixed(1)}/5` : ''}.`);
    const tagged = c.strike + c.dirFlight + Object.values(c.tagged).reduce((a, b) => a + b, 0);
    if (tagged < c.n / 3) lines.push('Few of these shots have Details (strike, flight, cause) logged, so the why is partly a guess: ask them to tap Details on misses in this part of the game.');
  } else lines.push(`Too few logged shots in ${worst.label.toLowerCase()} (${c?.n || 0}) to say why yet.`);
  if (worst.key !== 'putt') {
    const p = puttingWhy(rcs), side = Math.max(p.left, p.right), other = Math.min(p.left, p.right);
    if (p.missN >= 8 && side >= 5 && side >= 2 * other) lines.push(`Putting note: of ${p.missN} missed putts with a side logged, ${p.left} went left and ${p.right} right, whatever the read. A one-sided miss is a stroke or set-up pattern (path, face, aim, putter fit) worth testing.`);
  }
  lines.push('Approach misses are logged from the flag; older rounds may have them from the green.');
  return lines.join('\n');
}

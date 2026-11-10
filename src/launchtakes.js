// The "take" on a club's launch numbers: what the speeds, launch and spin say and which library
// drill addresses it. Benchmarks are the usual ones (Trackman / PGA averages): a flush driver is
// smash 1.48–1.50; for ~100 mph club speed the carry window is launch 13–15°, spin 2,300–2,800;
// a flush 7-iron is 1.33–1.38. Spin from range balls runs low and erratic, so spin takes carry a
// caveat when no premium-ball session is in the data.
import { predictedCarry } from './flight.js';
const KIND = (name) => (/driver/i.test(name) ? 'driver' : /wood/i.test(name) ? 'wood' : /hybrid|rescue|utility/i.test(name) ? 'hybrid' : /iron|\d\s*i$/i.test(name) ? 'iron' : 'wedge');
const FLUSH = { driver: 1.48, wood: 1.46, hybrid: 1.42, iron: 1.36, wedge: 1.25 }; // a well-struck one
const LOW = { driver: 1.42, wood: 1.40, hybrid: 1.36, iron: 1.30, wedge: 1.18 }; // below this strike is costing you
const YD_PER_MPH = { driver: 2, wood: 1.9, hybrid: 1.8, iron: 1.7, wedge: 1.5 }; // rough carry per mph of ball speed
const STRIKE = ['foot-spray-strike-check', 'tee-height-strike-test'];
const STRIKE_IRON = ['foot-spray-strike-check', 'tee-in-front-low-point-drill'];
const UP = ['headcover-upswing-driver', 'fix-trail-shoulder-low'];

/** Driver launch/spin window for a club speed: slower swings want more launch and spin. */
export function driverWindow(cs = 100) {
  if (cs < 85) return { launch: [14, 17], spin: [2800, 3400] };
  if (cs < 95) return { launch: [13, 16], spin: [2500, 3100] };
  if (cs < 105) return { launch: [12, 15], spin: [2300, 2800] };
  return { launch: [10, 14], spin: [2000, 2600] };
}

const fmt = (n, d = 0) => (n == null ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

/**
 * Takes for one club from its clubSummary (see launch.js). Returns [{ key, level, text, drills }],
 * strongest first. `q.range` is true when every shot was with range balls.
 */
export function launchTakes(q, club) {
  if (!q) return [];
  const kind = KIND(club);
  const out = [];
  const cs = q.clubSpeed?.avg, bs = q.ballSpeed?.avg, sm = q.smash?.avg, sdS = q.smash?.sd || 0, n = q.smash?.n || q.n;
  const launch = q.launch?.avg, spin = q.backSpin?.avg, attack = q.attack?.avg, axis = q.spinAxis?.avg;
  const rangeNote = q.range ? ' Range balls spin low and erratically, so confirm with a premium ball.' : '';
  const flush = FLUSH[kind], low = LOW[kind];

  // --- strike (smash) ---
  if (sm != null && n >= 3) {
    if (sm < low) {
      const lost = cs ? Math.round((flush - sm) * cs) : null;
      out.push({ key: 'smash-low', level: 'work', text: `Smash ${sm.toFixed(2)}${sdS >= 0.045 ? ` (and ±${sdS.toFixed(2)} shot to shot)` : ''} — flush ${kind === 'driver' ? 'driver' : kind} is about ${flush.toFixed(2)}. That's strike, not speed${lost ? `: ~${lost} mph of ball speed (≈ ${Math.round(lost * YD_PER_MPH[kind])} yd of carry) left on the face` : ''}. Find where on the face you're hitting it before you chase anything else.`, drills: kind === 'driver' || kind === 'wood' ? STRIKE : STRIKE_IRON });
    } else if (sdS >= 0.045) {
      out.push({ key: 'smash-spread', level: 'work', text: `Smash averages ${sm.toFixed(2)} but swings ±${sdS.toFixed(2)} shot to shot: your good ones are flush, the rest aren't. Strike location is the variable, so make the strike repeatable before adding speed.`, drills: kind === 'driver' || kind === 'wood' ? ['foot-spray-strike-check', 'smooth-swing-balanced-finish-driver'] : STRIKE_IRON });
    } else if (sm >= flush - 0.02) {
      out.push({ key: 'smash-good', level: 'ok', text: `Strike is good: smash ${sm.toFixed(2)}${cs ? ` at ${fmt(cs)} mph` : ''}. The lever now is club speed — each mph is about ${YD_PER_MPH[kind]} yd.`, drills: kind === 'driver' ? ['smooth-swing-balanced-finish-driver'] : [] });
    }
  }

  // --- driver launch / spin / attack ---
  if (kind === 'driver' || kind === 'wood') {
    const w = driverWindow(cs || 100);
    if (launch != null && spin != null) {
      if (launch < w.launch[0] && spin > w.spin[1]) {
        out.push({ key: 'low-spinny', level: 'work', text: `Launch ${launch.toFixed(1)}° with ${fmt(spin)} rpm: low and spinny. At ${fmt(cs || 100)} mph you want ~${w.launch[0]}–${w.launch[1]}° and ${fmt(w.spin[0])}–${fmt(w.spin[1])} rpm. That pattern is a strike low on the face or a downward hit — tee height and attack angle first.${rangeNote}`, drills: ['tee-height-strike-test', ...UP] });
      } else if (launch < w.launch[0]) {
        out.push({ key: 'low-launch', level: 'work', text: `Launch ${launch.toFixed(1)}° is under the ${w.launch[0]}–${w.launch[1]}° window for your speed. Tee it a little higher, ball off the lead heel, and hit up on it.`, drills: ['tee-height-strike-test', ...UP] });
      } else if (spin > w.spin[1] + 300) {
        out.push({ key: 'spinny', level: 'work', text: `Spin ${fmt(spin)} rpm is high for ${fmt(cs || 100)} mph (window ${fmt(w.spin[0])}–${fmt(w.spin[1])}): it balloons and costs carry and run. A strike low on the face and a downward hit both add spin, so: strike check, then tee height and attack angle.${rangeNote}`, drills: ['foot-spray-strike-check', 'tee-height-strike-test', 'headcover-upswing-driver'] });
      } else if (launch > w.launch[1] + 2 && spin > w.spin[1]) {
        out.push({ key: 'high-spinny', level: 'work', text: `Launch ${launch.toFixed(1)}° and ${fmt(spin)} rpm: high and spinny, adding loft through impact. Check the tee height isn't too high and the hands aren't flipping.${rangeNote}`, drills: ['tee-height-strike-test', 'fix-hands-ahead-impact-bag'] });
      } else if (launch >= w.launch[0] && launch <= w.launch[1] + 2 && spin >= w.spin[0] - 200 && spin <= w.spin[1] + 200) {
        out.push({ key: 'window', level: 'ok', text: `Launch ${launch.toFixed(1)}° and ${fmt(spin)} rpm are in the window for your speed. Nothing to fix in the flight; it's strike and speed from here.`, drills: [] });
      }
    } else if (launch != null && launch < w.launch[0]) {
      out.push({ key: 'low-launch', level: 'work', text: `Launch ${launch.toFixed(1)}° is under the ${w.launch[0]}–${w.launch[1]}° window for your speed. Tee it a little higher and hit up on it.`, drills: ['tee-height-strike-test', ...UP] });
    }
    if (attack != null && attack < -1 && kind === 'driver') {
      out.push({ key: 'down', level: 'work', text: `Attack angle ${attack.toFixed(1)}°: hitting down on the driver. Up 2–4° is worth 10–20 yd at your speed (more launch, less spin) without swinging harder.`, drills: UP });
    }
  }

  // --- irons: launch and spin ---
  if (kind === 'iron' || kind === 'hybrid') {
    if (launch != null && launch < 11) out.push({ key: 'iron-low', level: 'work', text: `Launch ${launch.toFixed(1)}° is low for a ${kind}: a strike low on the face or the ball too far back. Check ball position, then where on the face it's coming off.`, drills: ['fix-club-on-the-ground-ball-position', 'foot-spray-strike-check'] });
    else if (launch != null && launch > 24) out.push({ key: 'iron-high', level: 'work', text: `Launch ${launch.toFixed(1)}° is high for a ${kind}: hands behind the ball at impact add loft and cost carry.`, drills: ['fix-hands-ahead-impact-bag', 'tee-in-front-low-point-drill'] });
    if (spin != null && spin < 4000 && !q.range) out.push({ key: 'iron-lowspin', level: 'work', text: `Spin ${fmt(spin)} rpm is low for a ${kind} (premium ball): thin or low-face contact, or a ball too far forward. It will fly but won't hold greens.`, drills: STRIKE_IRON });
  }

  // --- what those numbers should carry, vs what the bay said ---
  const pred = predictedCarry(q);
  if (pred) {
    const meas = q.carry?.avg;
    if (meas != null && (q.carry?.n || 0) >= 3) {
      const ratio = meas / pred;
      if (ratio < 0.9) out.push({ key: 'carry-short', level: 'info', text: `Those launch numbers should carry about ${pred} yd; the bay said ${Math.round(meas)}. ${q.range ? 'Range balls and sim distance read short — trust the speeds here, not the carries.' : 'The bay reads short, or the ball is running out of spin: trust the speeds more than the carries.'}`, drills: [] });
      else if (ratio > 1.1) out.push({ key: 'carry-long', level: 'info', text: `Those launch numbers should carry about ${pred} yd; the bay said ${Math.round(meas)}, which is generous. Use ${pred} as the honest number.`, drills: [] });
    } else if (meas == null) {
      out.push({ key: 'carry-pred', level: 'info', text: `From the speeds, launch and spin a premium ball carries about ${pred} yd in still air at 15 °C${kind === 'driver' || kind === 'wood' ? ' (rollout on top)' : ''}.`, drills: [] });
    }
  }

  // --- direction: spin axis ---
  if (axis != null && (q.spinAxis?.n || 0) >= 3 && Math.abs(axis) >= 6) {
    const side = axis > 0 ? 'right' : 'left';
    out.push({ key: 'axis', level: 'info', text: `Spin axis ${axis > 0 ? '+' : ''}${axis.toFixed(1)}° on average: a consistent curve ${side} (face ${axis > 0 ? 'open' : 'closed'} to path). Fine if you play it; if not, that's the face-to-path to work on with the coach.`, drills: [] });
  }

  const rank = { work: 0, ok: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** HTML for a list of takes; drill cards are rendered by the caller via drillCardsHtml. */
export function takesHtml(takes, { max = 3 } = {}) {
  if (!takes.length) return '';
  return `<div class="takes">${takes.slice(0, max).map((t) => `<p class="take ${t.level}">${t.text}</p>`).join('')}</div>`;
}

/** One sentence per take for the AI coach. */
export const takesText = (takes) => takes.map((t) => t.text.replace(/\s+/g, ' ')).join(' ');

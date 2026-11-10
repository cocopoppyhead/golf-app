// The hole model: one record per hole with a panel per shot. Pure functions — score, fairway,
// GIR miss, bunkers and the bogey tags are all worked out from the shot panels. No DOM.

// Score, fairway, GIR, approach miss and green-side bunker are all worked out from the panels.
// Where a shot ended up, which side it missed, and what kind of swing it was
export const ENDED = [['G', 'Green'], ['FR', 'Fringe'], ['RG', 'Rough'], ['BK', 'Green bunker'], ['FB', 'Fwy bunker'], ['WS', 'Waste'], ['FW', 'Fairway'], ['TR', 'Trees'], ['PN', 'OB / water'], ['HO', 'Holed']];
export const TEE_EXTRA = [['FB', 'Fairway bunker'], ['WS', 'Waste'], ['PN', 'OB / water']];
export const DIRS = [['S', 'Short'], ['L', 'Long'], ['LF', 'Left'], ['R', 'Right']];
export const SWING_TYPES = [['full', 'Full'], ['3q', '¾'], ['half', '½'], ['pitch', 'Pitch'], ['chip', 'Chip'], ['splash', 'Bunker'], ['punch', 'Punch'], ['putter', 'Putt']];
// what you meant to hit (tee shots and full swings); what actually happened goes in Details → ball flight
export const INTENT = [['D', 'Draw'], ['S', 'Straight'], ['F', 'Fade']];
// the lie in more detail (Details, optional, several can apply): slope, turf, trouble
export const LIE_DETAIL = [['abv', 'Ball above feet'], ['blw', 'Ball below feet'], ['up', 'Uphill'], ['dn', 'Downhill'], ['fc', 'First cut'], ['hvy', 'Heavy rough'], ['fly', 'Flyer lie'], ['div', 'Divot'], ['hp', 'Hardpan'], ['wet', 'Wet / mud']];
// where the first putt was, relative to the flag: long / pin high / short × left / on line / right
export const FP_LONG = [['L', 'Long'], ['P', 'Pin high'], ['S', 'Short']];
export const FP_SIDE = [['LF', 'Left'], ['C', 'On line'], ['R', 'Right']];
/** Did the shot come off as planned? From the planned shape and the logged flight when Details has both; null if unknown. */
export const asPlanned = (x) => {
  if (x.d?.plan === true || x.d?.plan === false) return x.d.plan;
  if (!x.intent || !x.d?.flight) return null;
  return ({ D: 'DRW', S: 'STR', F: 'FAD' })[x.intent] === x.d.flight;
};
export const autoSwing = (x, k) => {
  if (k === 0) return 'full';
  const d = x.dist ?? null, lie = x.lie || x.lieAuto;
  if (lie === 'bnk' && d != null && d <= 50) return 'splash';
  if (lie === 'rec') return 'punch';
  if (d == null) return 'full';
  return d < 30 ? 'chip' : d < 80 ? 'pitch' : 'full';
};
// lie for the next shot from where this one ended
export const LIE_FROM = { FW: 'fw', LR: 'rgh', RR: 'rgh', LT: 'wst', RT: 'wst', FB: 'fbk', FR: 'frg', RG: 'rgh', BK: 'bnk', WS: 'wst', TR: 'rec' };
export const blankHole = () => ({ score: null, putts: null, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [], shots: null });

export function upgradeShot(x) {
  if (['S', 'L', 'LF', 'R'].includes(x.res)) { x.dir = x.res; x.res = null; }
}
export function ensureShots(h, par, yds) {
  if (!h.shots || !h.shots.length) {
    const n = h.score != null && h.putts != null ? Math.max(1, h.score - h.putts) : Math.max(1, par - 2);
    h.shots = Array.from({ length: n }, () => ({ lie: null, dist: null }));
    if (h.tee && par >= 4) h.shots[0].res = h.tee;
  }
  h.shots[0] = { ...h.shots[0], lie: 'tee', dist: h.shots[0].dist ?? yds ?? null };
  h.shots.forEach(upgradeShot);
}
export function defaultLie(h, k) {
  const p = h.shots[k - 1] || {};
  const from = (k - 1 === 0 && p.res2) || p.res;
  if (from && LIE_FROM[from]) return LIE_FROM[from];
  return k === 1 ? 'fw' : 'rgh';
}
export const autoShotType = (s, k, par) => {
  const club = (s.d?.club || '').toLowerCase();
  if (k === 0 && par >= 4) return /driver/.test(club) || !club ? 'DRV' : 'TEE';
  const d = s.dist ?? 0;
  if (s.sw === 'splash' || (s.lie === 'bnk' && d <= 50)) return 'BKR';
  if (s.lie === 'fbk' && d > 50) return d > 150 ? 'IRN' : 'APP';
  if (s.sw === 'putter') return 'PT';
  if (s.sw === 'chip' || s.sw === 'pitch' || (d && d < 30)) return 'CHP';
  if (/wood|hybrid/.test(club)) return 'FWY';
  return d > 150 ? 'IRN' : 'APP';
};
/** Work out score, fairway, GIR miss, bunker and bogey tags from the panels. */
export function derive(h, par) {
  const pens = h.shots.filter((x) => x.pen).length;
  if (h.putts != null) h.score = h.shots.length + pens + h.putts;
  h.tee = par >= 4 ? (h.shots[0].res || null) : null;
  h.gir = null;
  const a = Math.max(0, par - 3); // the shot that should find the green in regulation
  const as = h.shots[a];
  h.miss = as && as.res !== 'G' && as.res !== 'HO' && as.dir ? as.dir : null;
  h.shortSided = h.shots.some((x) => x.ss);
  h.bunker = h.shots.some((x, k) => k > 0 && (x.lie || '') === 'bnk');
  h.fwBunker = h.shots[0]?.res2 === 'FB' || h.shots.some((x, k) => k > 0 && x.lie === 'fbk');
  const det = h.shots.map((x, k) => (x.d ? { shot: x.d.shot || autoShotType(x, k, par), cause: x.d.cause || null, flight: x.d.flight || null, strike: x.d.strike || null, result: x.d.result || null, cost: x.d.cost } : null)).filter(Boolean);
  if (det.length) h.tags = det.filter((t) => t.cost != null).map((t) => ({ ...t, cost: t.cost || 0 }));
}


/** Index of the next hole after i with a bogey or worse, or −1. */
export function nextBogeyFrom(round, course, i) {
  for (let k = i + 1; k < round.holes.length; k++) { const x = round.holes[k]; if (x && x.score > course.holes[k].par) return k; }
  return -1;
}

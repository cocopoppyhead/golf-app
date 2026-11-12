// The hole model: one record per hole with a panel per shot. Pure functions — score, fairway,
// GIR miss, bunkers and the bogey tags are all worked out from the shot panels. No DOM.

// Score, fairway, GIR, approach miss and green-side bunker are all worked out from the panels.
// Where a shot ended up, which side it missed, and what kind of swing it was
// Water and OB are separate (a drop vs stroke and distance); both add the penalty stroke. PN is the old
// combined code, still read. 'Trouble' (TR) covers trees, heather, desert, under a bush.
export const ENDED = [['G', 'Green'], ['GS', 'Greenside'], ['BK', 'Bunker'], ['HO', 'Holed'], ['FW', 'Fairway'], ['RG', 'Rough'], ['TR', 'Trouble'], ['WT', 'Water'], ['OB', 'OB']];
// from greenside, the ball goes on the green, in, stays greenside, into sand, or (rarely) wet / out
export const ENDED_GREENSIDE = [['G', 'Green'], ['HO', 'Holed'], ['GS', 'Greenside'], ['BK', 'Bunker'], ['WT', 'Water'], ['OB', 'OB']];
export const TEE_EXTRA = [['FB', 'f.Bunker'], ['WS', 'Waste'], ['WT', 'Water'], ['OB', 'OB']];
export const PENALTY_RES = ['PN', 'WT', 'OB'];
// legacy labels for codes no longer offered
export const OLD_ENDED = [['FR', 'Fringe'], ['FB', 'Fwy bunker'], ['WS', 'Waste'], ['PN', 'OB / water']];
// where the ball sits for the next shot: slope (3×3 pad: ball above/below the feet × uphill/downhill) and surface
export const SLOPE_FEET = [['abv', 'Ball above feet'], [null, ''], ['blw', 'Ball below feet']];
export const SLOPE_HILL = [['up', 'Uphill'], [null, ''], ['dn', 'Downhill']];
/** The lie surfaces: two rows. The last two of row one are the course's own trouble (see troubleFor). */
export const SURFACES = [['fw', 'Fairway'], ['rgh', 'Rough']];
export const SURFACES2 = [['div', 'Divot'], ['bnk', 'Bunker'], ['hp', 'Hardpan'], ['mud', 'Wet / mud']];
export const GREENSIDE_LIES = [['frg', 'Fringe'], ['rgh', 'Rough'], ['bnk', 'Bunker'], ['hp', 'Hardpan']];
/** Trouble a ball can sit in, beyond rough and sand. A course shows two of these in its lie row. */
export const TROUBLE_OPTIONS = [['wst', 'Waste'], ['des', 'Desert'], ['rec', 'Trees'], ['bsh', 'Bushes'], ['fes', 'Fescue'], ['hea', 'Heather'], ['grs', 'Gorse']];
const T_NAME = Object.fromEntries(TROUBLE_OPTIONS);
// courses we know: the rest of the Gulf gets Waste and Trees, everywhere else Fescue and Heather
const KNOWN = [[/creek/i, ['rec', 'bsh']], [/\bels\b/i, ['wst', 'rec']]];
/** The two trouble surfaces for a course: the golfer's own pick for it (course.trouble), a course we know, or the region's usual. */
export function troubleCodes(course) {
  if (Array.isArray(course?.trouble) && course.trouble.length) return course.trouble.slice(0, 2);
  const known = KNOWN.find(([re]) => re.test(course?.name || ''));
  if (known) return known[1];
  const lat = course?.lat, lon = course?.lon;
  const gulf = (lat != null && lon != null && lat > 12 && lat < 32 && lon > 34 && lon < 60) || course?.region === 'uae';
  return gulf ? ['wst', 'rec'] : ['fes', 'hea'];
}
export const troubleFor = (course) => troubleCodes(course).map((c) => [c, T_NAME[c] || c]);
export const LIE_NAMES = Object.fromEntries([['bsh', 'Bushes'], ['grs', 'Gorse'], ['tee', 'Tee'], ['fw', 'Fairway'], ['rgh', 'Rough'], ['frg', 'Fringe'], ['fbk', 'Fwy bunker'], ['bnk', 'Bunker'], ['wst', 'Waste'], ['des', 'Desert'], ['rec', 'Trees'], ['fes', 'Fescue'], ['hea', 'Heather'], ['div', 'Divot'], ['hp', 'Hardpan'], ['mud', 'Wet / mud']]);
/** A shot played from just off the green: the previous one finished greenside, or this one starts on the fringe or within 30 yards. */
export function isGreenside(h, k) {
  if (k === 0) return false;
  const p = h.shots[k - 1] || {}, x = h.shots[k] || {};
  return p.res === 'GS' || p.res === 'FR' || x.lie === 'frg' || (x.dist != null && x.dist <= 30);
}
/**
 * Putts one by one: h.puttList = [{ ft, brk, sl, holed }]. The count, the first putt's length and its
 * read are kept in step on the hole (h.putts, h.firstPutt, h.pBreak, h.pSlope) for the stats.
 */
export function ensurePutts(h) {
  if (Array.isArray(h.puttList)) return h.puttList;
  h.puttList = [];
  if (h.putts > 0) for (let j = 0; j < h.putts; j++) h.puttList.push(j === 0 ? { ft: h.firstPutt ?? null, brk: h.pBreak ?? null, sl: h.pSlope ?? null, holed: h.putts === 1 } : { ft: null, holed: j === h.putts - 1 });
  return h.puttList;
}
export function syncPutts(h) {
  const L = h.puttList || [];
  const holedAt = L.findIndex((p) => p.holed);
  if (holedAt >= 0) { L.splice(holedAt + 1); h.putts = holedAt + 1; delete h.puttsAuto; } else if (!h.puttsAuto) h.putts = null;
  h.firstPutt = L[0]?.ft ?? null; h.pBreak = L[0]?.brk ?? null; h.pSlope = L[0]?.sl ?? null;
}
/** A hole is "on the green" once a shot finished there (or the last one was holed). */
export const onGreen = (h) => !!h.shots?.length && h.shots[h.shots.length - 1].res === 'G';
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
export const LIE_FROM = { FW: 'fw', LR: 'rgh', RR: 'rgh', LT: 'wst', RT: 'wst', FB: 'fbk', FR: 'frg', GS: 'frg', RG: 'rgh', BK: 'bnk', WS: 'wst', TR: 'rec', WT: 'rgh', OB: 'tee' };
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
/**
 * What a hole still needs before strokes gained can use it, as short phrases (empty = complete):
 * putts, the first putt's length, where the tee shot went, a distance for every shot after the tee.
 */
export function holeGaps(h, par) {
  if (!h || h.score == null) return [];
  const out = [];
  if (h.putts == null || h.puttsAuto) out.push('putts');
  if (h.putts > 0 && h.firstPutt == null) out.push('putt length');
  const shots = h.shots || [];
  if (!shots.length) return out.length ? out : ['shots'];
  if (par >= 4 && !shots[0].res) out.push('where the tee shot went');
  const noDist = shots.map((x, k) => (k > 0 && x.dist == null ? k + 1 : null)).filter(Boolean);
  if (noDist.length) out.push(`distance for shot${noDist.length > 1 ? 's' : ''} ${noDist.join(', ')}`);
  return out;
}

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

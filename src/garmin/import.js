// Turn an osolo-garmin export (see bookmarklet.js) into osolo rounds: scores and putts from the
// scorecard, and when the watch tracked shots (CT10 / auto-detect), one shot panel per shot with
// the club, the lie, the distance to the pin and where it finished, plus the first putt. Pure:
// courses are matched or described here and created by the caller.
import { metres, bearing } from '../geo.js';

const YD = 0.9144;
// Garmin's clubTypeId → name (Garmin's own /club/types table, via etroulland/garmin-golf-analytics, MIT)
export const CLUB_TYPES = { 1: 'Driver', 2: '3 wood', 3: '5 wood', 4: '1 hybrid', 5: '2 hybrid', 6: '3 hybrid', 7: '4 hybrid', 8: '5 hybrid', 9: '6 hybrid', 10: '1 iron', 11: '2 iron', 12: '3 iron', 13: '4 iron', 14: '5 iron', 15: '6 iron', 16: '7 iron', 17: '8 iron', 18: '9 iron', 19: 'PW', 20: 'GW', 21: 'SW', 22: 'LW', 23: 'Putter' };
const PUTT_FT = [3, 6, 10, 20, 30, 50];
const norm = (s) => String(s || '').toLowerCase().replace(/\b(the|golf|club|course|country|resort|&|and|gc|cc)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** clubId → osolo club name, from the export's clubs and club types (falls back to the built-in table). */
export function clubNames(exp) {
  const types = { ...CLUB_TYPES };
  for (const t of exp.clubTypes || []) if (t?.value != null && t.name) types[t.value] = normaliseClubName(t.name);
  const out = {};
  for (const c of exp.clubs || []) if (c?.id != null) out[c.id] = c.name ? normaliseClubName(c.name) : types[c.clubTypeId] || null;
  return out;
}
export function normaliseClubName(n) {
  const s = String(n).trim();
  const m = s.match(/^(\d)\s*(wood|hybrid|iron)$/i); if (m) return `${m[1]} ${m[2].toLowerCase()}`;
  if (/^pitching wedge$/i.test(s)) return 'PW'; if (/^gap wedge$/i.test(s)) return 'GW'; if (/^sand wedge$/i.test(s)) return 'SW'; if (/^lob wedge$/i.test(s)) return 'LW';
  return s;
}

const isPutt = (s, club) => s.shotType === 'PUTT' || club === 'Putter' || (s.startLoc?.lie === 'Green' && !s.shotType);
const LIE = { Fairway: 'fw', Rough: 'rgh', Fringe: 'frg', TeeBox: 'tee', Green: 'grn', Bunker: 'bnk', Sand: 'bnk', Trees: 'rec', Woods: 'rec', Waste: 'wst', Hazard: 'wst' };
const RES = { Green: 'G', Fringe: 'FR', Fairway: 'FW', Rough: 'RG', Trees: 'TR', Woods: 'TR', Waste: 'WS', Water: 'PN', Hazard: 'PN', OutOfBounds: 'PN', OB: 'PN' };
const nearestFt = (ft) => PUTT_FT.reduce((a, b) => (Math.abs(b - ft) < Math.abs(a - ft) ? b : a));
const ll = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? [p.lat, p.lon] : null);
/** Left (−1) or right (+1) of the line from `from` to `pin`, for the point `at`. */
const DEG = 180 / Math.PI;
/** Signed angle (degrees, −180..180) of `at` off the line from `from` to `pin`: negative = left. */
export function angleOff(from, pin, at) { return ((bearing(from, at) * DEG - bearing(from, pin) * DEG + 540) % 360) - 180; }
export function sideOf(from, pin, at) {
  const d = angleOff(from, pin, at);
  return Math.abs(d) < 1 ? 0 : d < 0 ? -1 : 1;
}

/** One Garmin hole (scorecard hole + tracked shots) → an osolo hole record, or null when nothing was scored. */
export function convertHole(gh, shots, pin, par, names) {
  if (!gh || gh.strokes == null) return null;
  const h = { score: gh.strokes, putts: gh.putts ?? null, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [], shots: null };
  const P = ll(pin);
  const list = [...(shots || [])].sort((a, b) => (a.shotOrder ?? 0) - (b.shotOrder ?? 0));
  const putts = list.filter((s) => isPutt(s, names[s.clubId]));
  const strokes = list.filter((s) => !isPutt(s, names[s.clubId]));
  if (putts.length && P) { const S = ll(putts[0].startLoc); if (S) h.firstPutt = nearestFt(metres(S, P) / 0.3048); }
  if (h.putts == null && putts.length) h.putts = putts.length;
  if (strokes.length) {
    h.shots = strokes.map((s, k) => {
      const S = ll(s.startLoc), E = ll(s.endLoc);
      const lie = k === 0 && par >= 4 ? 'tee' : LIE[s.startLoc?.lie] || null;
      const toPin = S && P ? Math.round(metres(S, P) / YD) : s.meters ? Math.round(s.meters / YD) : null;
      const endLie = s.endLoc?.lie;
      let res = RES[endLie] || null;
      const nearGreen = E && P && metres(E, P) < 45 * YD;
      if (endLie === 'Bunker' || endLie === 'Sand') res = nearGreen ? 'BK' : 'FB';
      if (k === strokes.length - 1 && putts.length && !res) res = 'G';
      const x = { lie, dist: toPin, src: 'garmin', res, t: s.shotTime ? Date.parse(s.shotTime) || null : null };
      if (res === 'PN') x.pen = true;
      if (E) x.end = { lat: +E[0].toFixed(6), lon: +E[1].toFixed(6) };
      if (S) x.gps = { lat: +S[0].toFixed(6), lon: +S[1].toFixed(6), acc: 5 };
      const club = names[s.clubId]; if (club) x.d = { club };
      if (s.meters) x.flew = Math.round(s.meters / YD);
      // tee shots on par 4/5: fairway / rough / trouble with the side from the geometry
      if (k === 0 && par >= 4) {
        const side = S && E && P ? sideOf(S, P, E) : 0;
        if (res === 'FW' || res === 'G' || res === 'FR') x.res = 'FW';
        else if (res === 'RG') x.res = side < 0 ? 'LR' : 'RR';
        else if (res === 'TR' || res === 'PN' || res === 'WS' || res === 'FB') { x.res = side < 0 ? 'LT' : 'RT'; if (res === 'FB' || res === 'WS' || res === 'PN') x.res2 = res; }
        else if (gh.fairwayShotOutcome) x.res = ({ HIT: 'FW', LEFT: 'LR', RIGHT: 'RR', LONG: 'FW', SHORT: 'FW' })[gh.fairwayShotOutcome] || null;
      } else if (res && res !== 'G' && res !== 'FW' && E && P && S) {
        // approach that missed: which side of the pin, along the shot line
        // along the shot line vs across it: whichever miss is bigger names the direction
        const ang = angleOff(S, P, E) / DEG, se = metres(S, E);
        const along = se * Math.cos(ang) - metres(S, P), cross = se * Math.sin(ang);
        x.dir = Math.abs(along) >= Math.abs(cross) ? (along > 0 ? 'L' : 'S') : cross < 0 ? 'LF' : 'R';
      }
      return x;
    });
    if (par >= 4) h.tee = h.shots[0].res || null;
  } else if (par >= 4 && gh.fairwayShotOutcome) h.tee = ({ HIT: 'FW', LEFT: 'LR', RIGHT: 'RR' })[gh.fairwayShotOutcome] || null;
  return h;
}

/**
 * Describe a course for a Garmin round: a match among the golfer's courses, else the library, else a new
 * manual course from the snapshot's pars. Returns { kind: 'course'|'library'|'new', course|lib|spec }.
 */
export function matchCourse(snapshot, { courses = [], library = [] } = {}) {
  const name = snapshot?.name || 'Garmin course';
  const n = norm(name);
  const own = courses.find((c) => norm(c.name) === n) || courses.find((c) => n && (norm(c.name).includes(n) || n.includes(norm(c.name))));
  if (own) return { kind: 'course', course: own };
  const lib = library.find((c) => norm(c.name) === n) || library.find((c) => n && (norm(c.name).includes(n) || n.includes(norm(c.name))));
  if (lib) return { kind: 'library', lib };
  const pars = String(snapshot?.holePars || '').split('').map((d) => +d).filter((d) => d >= 3 && d <= 6);
  return { kind: 'new', spec: { name, holes: (pars.length ? pars : Array(18).fill(4)).map((p) => ({ par: p, si: null, yds: null })) } };
}

/**
 * The whole export → [{ garminId, date, courseKey, courseName, holes, putts, score, shotsTracked }], newest first.
 * `resolveCourse(snapshot)` → an osolo course (the caller matches/creates, see matchCourse).
 */
export function convertExport(exp, resolveCourse) {
  if (exp?.app !== 'osolo-garmin') throw new Error('Not an osolo Garmin export. Run the Garmin bookmarklet first.');
  const names = clubNames(exp);
  const out = [];
  for (const r of exp.rounds || []) {
    if (r.error || !r.scorecard) continue;
    const sc = r.scorecard, course = resolveCourse(r.course);
    if (!course) continue;
    const pars = course.holes.map((h) => h.par);
    const byHole = new Map((r.holeShots || []).map((hs) => [hs.holeNumber, hs]));
    const holes = course.holes.map((_, i) => {
      const gh = (sc.holes || []).find((x) => x.number === i + 1);
      const hs = byHole.get(i + 1);
      return convertHole(gh, hs?.shots, hs?.pinPosition, pars[i], names);
    });
    if (!holes.some(Boolean)) continue;
    const date = Date.parse(sc.startTime || r.summary?.startTime || '') || Date.now();
    out.push({
      id: `r_g${r.id}`, garminId: r.id, date, courseId: course.id, courseName: course.name, tees: course.tees || '', learning: true, finished: true, source: 'garmin',
      holes, holesPlayed: holes.filter(Boolean).length, shotsTracked: holes.reduce((a, h) => a + (h?.shots?.length || 0), 0),
      cond: null, mood: {}, garmin: { stepsTaken: sc.stepsTaken ?? null, distanceWalked: sc.distanceWalked ?? null },
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

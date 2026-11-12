// Garmin's account export ("Export your data" in Garmin Connect) keeps golf in DI_CONNECT/DI-GOLF:
//   Golf-SCORECARD_RAWDATA-<scorecardId>.fit   one round each (FIT, Garmin's own golf messages)
//   Golf-CLUB.json, Golf-CLUB_TYPES.json        the bag (same shapes as the Connect API)
//   Golf-COURSE.json                            { data: [{ "<courseId>": "name" }] }
// The golf messages are undocumented; the field meanings below were read off real scorecards:
//   190 round:  1 course name · 3 start · 4 end · 11 tee name · 10 par · 21 course rating · 12 slope
//   191 player: 0 name · 2 total strokes · 1 player index
//   192 hole score: 0 player index · 1 hole number · 2 strokes · 5 putts (−1 or blank = not entered)
//   193 hole: 0 number · 1 length (cm) · 2 par · 3 stroke index · 4/5 green (semicircles)
//   194 shot: 1 hole number · 253 time · 2/3 start · 4/5 end (semicircles) · 7 club id (Golf-CLUB.json; 0 = none)
//             11 heart rate (bpm) from the watch: checked against the round's activity recording, it is
//             the wrist heart rate when the shot was played (the time in 253 is logged a shot later)
// Shots are only there when the watch tracked them (newer watches, CT10 sensors). They carry no lie, and
// the list is noisy: practice strokes with a sensored club show up as extra shots from the same spot,
// and swings without a sensor can be missed. fitHole() cleans that up and only trusts a hole when the
// shots off the green add up to the score minus the putts entered on the watch.
import { parseFit, fitDate } from './fit.js';
import { metres } from '../geo.js';
import { CLUB_TYPES, normaliseClubName } from './import.js';

const SEMI = 180 / 2 ** 31;
const YD_CM = 91.44;

/** One scorecard FIT → { id, start, end, course: { name, tee, rating, slope, holes: [{ number, par, si, yds, green }] }, players: [{ name, index, total, holes: Map(number → { score, putts }) }] }. */
export function readScorecard(buf, id = null) {
  const msgs = parseFit(buf);
  const round = msgs.find((m) => m.num === 190)?.fields;
  if (!round) throw new Error('No golf round in this FIT file');
  const holes = msgs.filter((m) => m.num === 193).map(({ fields: f }) => ({
    number: f[0], par: f[2] ?? null, si: f[3] ?? null, yds: f[1] ? Math.round(f[1] / YD_CM) : null,
    green: f[4] != null && f[5] != null ? { lat: +(f[4] * SEMI).toFixed(6), lon: +(f[5] * SEMI).toFixed(6) } : null,
  })).filter((h) => h.number).sort((a, b) => a.number - b.number);
  const players = msgs.filter((m) => m.num === 191).map(({ fields: f }, k) => ({ name: f[0] || `Player ${k + 1}`, index: f[1] ?? k, total: f[2] ?? null, holes: new Map() }));
  if (!players.length) players.push({ name: 'Me', index: 0, total: null, holes: new Map() });
  for (const { fields: f } of msgs.filter((m) => m.num === 192)) {
    const p = players.find((x) => x.index === (f[0] ?? 0)) || players[0];
    const strokes = f[2] ?? f[3];
    if (f[1] && strokes) p.holes.set(f[1], { score: strokes, putts: f[5] != null && f[5] >= 0 ? f[5] : null });
  }
  const pt = (a, b) => (a != null && b != null && a !== 0x7fffffff ? { lat: +(a * SEMI).toFixed(6), lon: +(b * SEMI).toFixed(6) } : null);
  const shots = new Map();
  for (const { fields: f } of msgs.filter((m) => m.num === 194)) {
    const start = pt(f[2], f[3]); if (!f[1] || !start) continue;
    if (!shots.has(f[1])) shots.set(f[1], []);
    shots.get(f[1]).push({ t: f[253] != null ? fitDate(f[253]) : null, start, end: pt(f[4], f[5]), clubId: f[7] || null, hr: f[11] >= 35 && f[11] <= 230 ? f[11] : null });
  }
  for (const l of shots.values()) l.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return {
    id, start: fitDate(round[3] ?? round[2] ?? round[253]), end: fitDate(round[4]),
    course: { name: round[1] || 'Garmin course', tee: round[11] || '', rating: round[21] || null, slope: round[12] || null, holes },
    players, shots,
  };
}

const YD = 0.9144;
const ON_GREEN = 25; // metres from the pin: a shot starting closer than this is taken as a putt
const SAME_SPOT = 4; // metres: a shot from (almost) where the next one starts was a practice stroke or a re-detection
const PUTT_FT = [3, 6, 10, 20, 30, 50];
const nearestFt = (ft) => PUTT_FT.reduce((a, b) => (Math.abs(b - ft) < Math.abs(a - ft) ? b : a));

/** The bag from the export's Golf-CLUB.json and Golf-CLUB_TYPES.json: club id → osolo club name. */
export function bagNames(clubs = [], types = []) {
  const T = { ...CLUB_TYPES };
  for (const t of types) if (t?.value != null && t.name) T[t.value] = normaliseClubName(t.name);
  const out = {};
  for (const c of clubs) if (c?.id != null) out[c.id] = T[c.clubTypeId] || (c.name ? normaliseClubName(c.name) : null);
  return out;
}

/**
 * One hole from a scorecard: score and putts from the card, and when the watch tracked shots, the strokes
 * off the green (lie unknown, distance to the pin in yards, club, where it started and finished) plus the
 * first putt's length. Shots are only attached when they reconcile with the score; otherwise the hole keeps
 * its score and putts and is left out of strokes gained.
 */
export function fitHole(card, shots, pin, par, names = {}) {
  const h = { score: card.score, putts: card.putts, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [], shots: null };
  // heart rate on the hole, whether or not the shots reconcile: the mean and the highest at a shot
  const hrs = (shots || []).map((s) => s.hr).filter(Boolean);
  if (hrs.length) h.hr = { avg: Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length), max: Math.max(...hrs), n: hrs.length };
  if (!shots?.length || !pin || card.putts == null) return h;
  const real = shots.filter((s, i) => !(i + 1 < shots.length && metres([s.start.lat, s.start.lon], [shots[i + 1].start.lat, shots[i + 1].start.lon]) < SAME_SPOT));
  const P = [pin.lat, pin.lon];
  const toPin = (p) => metres([p.lat, p.lon], P);
  const off = real.filter((s) => toPin(s.start) > ON_GREEN), on = real.filter((s) => toPin(s.start) <= ON_GREEN);
  if (off.length !== card.score - card.putts || (card.putts > 0 && !on.length)) {
    // the hole doesn't add up (a shot missed, or one too many), but each recorded shot still has a start and a
    // finish on the ground: keep those as loose shots for the radar, which scores each one on its own
    h.looseShots = off.filter((s) => s.end).map((s, k) => ({
      tee: k === 0 && s === real[0], from: Math.round(toPin(s.start) / YD), to: Math.round(toPin(s.end) / YD), toFt: Math.round(toPin(s.end) / 0.3048),
      onGreen: toPin(s.end) <= ON_GREEN, club: names[s.clubId] || null,
    })).filter((x) => x.to < x.from);
    if (!h.looseShots.length) delete h.looseShots;
    return h;
  }
  if (card.putts > 0) h.firstPutt = nearestFt(toPin(on[0].start) / 0.3048);
  h.shots = off.map((s, k) => {
    const x = { lie: k === 0 ? 'tee' : 'unk', dist: Math.round(toPin(s.start) / YD), src: 'garmin', res: null, t: s.t };
    x.gps = { ...s.start, acc: 5 };
    if (s.end) { x.end = { ...s.end }; x.flew = Math.round(metres([s.start.lat, s.start.lon], [s.end.lat, s.end.lon]) / YD); }
    const club = names[s.clubId]; if (club) x.d = { club };
    if (s.hr) x.hr = s.hr;
    return x;
  });
  if (!card.putts && h.shots.length) h.shots[h.shots.length - 1].res = 'G';
  h.gir = card.score - card.putts <= par - 2;
  return h;
}

/** The round's heart rate from its holes: average over every shot, the highest, and how many shots had one. */
export function roundHr(holes) {
  const H = holes.filter((h) => h?.hr);
  if (!H.length) return null;
  const n = H.reduce((a, h) => a + h.hr.n, 0);
  return { avg: Math.round(H.reduce((a, h) => a + h.hr.avg * h.hr.n, 0) / n), max: Math.max(...H.map((h) => h.hr.max)), n };
}

/** The scorecard id from the export's file name: Golf-SCORECARD_RAWDATA-199043740.fit → 199043740. */
export const scorecardId = (name) => (String(name).match(/SCORECARD_RAWDATA-(\d+)\.fit$/i) || [])[1] || null;

/**
 * Scorecards → osolo rounds. `resolveCourse({ name, holePars, holes })` returns an osolo course (see
 * matchCourse). The first player on the card is you; anyone else becomes a playing partner.
 */
export function convertScorecards(cards, resolveCourse, { names = {} } = {}) {
  const out = [];
  for (const sc of cards) {
    const course = resolveCourse({ name: sc.course.name, holePars: sc.course.holes.map((h) => h.par).join(''), holes: sc.course.holes, tee: sc.course.tee });
    if (!course) continue;
    const me = sc.players[0];
    // map Garmin hole numbers onto the course's holes (a 9-hole card on an 18-hole course keeps its numbers)
    const holes = course.holes.map((ch, i) => {
      const h = me.holes.get(i + 1); if (!h) return null;
      const cardHole = sc.course.holes.find((x) => x.number === i + 1);
      return fitHole(h, sc.shots?.get(i + 1), cardHole?.green, ch.par || cardHole?.par || 4, names);
    });
    if (!holes.some(Boolean)) continue;
    const partners = sc.players.slice(1).map((p) => ({ name: p.name, scores: course.holes.map((_, i) => p.holes.get(i + 1)?.score ?? null) }));
    out.push({
      id: `r_g${sc.id ?? sc.start}`, garminId: sc.id, date: sc.start || Date.now(), courseId: course.id, courseName: course.name, tees: sc.course.tee || course.tees || '',
      learning: true, finished: true, source: 'garmin', holes, holesPlayed: holes.filter(Boolean).length, shotsTracked: holes.reduce((a, h) => a + (h?.shots?.length || 0), 0),
      players: partners, cond: null, mood: {}, garmin: { durationMin: sc.end && sc.start ? Math.round((sc.end - sc.start) / 60000) : null, scorecard: true },
      hr: roundHr(holes),
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

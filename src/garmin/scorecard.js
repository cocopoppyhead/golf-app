// Garmin's account export ("Export your data" in Garmin Connect) keeps golf in DI_CONNECT/DI-GOLF:
//   Golf-SCORECARD_RAWDATA-<scorecardId>.fit   one round each (FIT, Garmin's own golf messages)
//   Golf-CLUB.json, Golf-CLUB_TYPES.json        the bag (same shapes as the Connect API)
//   Golf-COURSE.json                            { data: [{ "<courseId>": "name" }] }
// The golf messages are undocumented; the field meanings below were read off real scorecards:
//   190 round:  1 course name · 3 start · 4 end · 11 tee name · 10 par · 21 course rating · 12 slope
//   191 player: 0 name · 2 total strokes · 1 player index
//   192 hole score: 0 player index · 1 hole number · 2 strokes · 5 putts (−1 or blank = not entered)
//   193 hole: 0 number · 1 length (cm) · 2 par · 3 stroke index · 4/5 green (semicircles)
import { parseFit, fitDate } from './fit.js';

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
  return {
    id, start: fitDate(round[3] ?? round[2] ?? round[253]), end: fitDate(round[4]),
    course: { name: round[1] || 'Garmin course', tee: round[11] || '', rating: round[21] || null, slope: round[12] || null, holes },
    players,
  };
}

/** The scorecard id from the export's file name: Golf-SCORECARD_RAWDATA-199043740.fit → 199043740. */
export const scorecardId = (name) => (String(name).match(/SCORECARD_RAWDATA-(\d+)\.fit$/i) || [])[1] || null;

/**
 * Scorecards → osolo rounds. `resolveCourse({ name, holePars, holes })` returns an osolo course (see
 * matchCourse). The first player on the card is you; anyone else becomes a playing partner.
 */
export function convertScorecards(cards, resolveCourse) {
  const out = [];
  for (const sc of cards) {
    const course = resolveCourse({ name: sc.course.name, holePars: sc.course.holes.map((h) => h.par).join(''), holes: sc.course.holes, tee: sc.course.tee });
    if (!course) continue;
    const me = sc.players[0];
    // map Garmin hole numbers onto the course's holes (a 9-hole card on an 18-hole course keeps its numbers)
    const holes = course.holes.map((_, i) => {
      const h = me.holes.get(i + 1);
      return h ? { score: h.score, putts: h.putts, tee: null, gir: null, miss: null, bunker: false, firstPutt: null, tags: [], shots: null } : null;
    });
    if (!holes.some(Boolean)) continue;
    const partners = sc.players.slice(1).map((p) => ({ name: p.name, scores: course.holes.map((_, i) => p.holes.get(i + 1)?.score ?? null) }));
    out.push({
      id: `r_g${sc.id ?? sc.start}`, garminId: sc.id, date: sc.start || Date.now(), courseId: course.id, courseName: course.name, tees: sc.course.tee || course.tees || '',
      learning: true, finished: true, source: 'garmin', holes, holesPlayed: holes.filter(Boolean).length, shotsTracked: 0,
      players: partners, cond: null, mood: {}, garmin: { durationMin: sc.end && sc.start ? Math.round((sc.end - sc.start) / 60000) : null },
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

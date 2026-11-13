// What the coach knows about the game itself (the strategist's and swing coach's half), worked out by
// the app from rounds that count: strokes gained by part of the game, the Tiger 5 per round, tee shots,
// GIR and putting, where they score best from (approach bands), the bag with their go-to club, their
// swing work and practice. Every number here is computed; the model reads, it doesn't add up.
import { roundStats, aggregate, roundSummaryText, roundTendencies } from '../rounds/stats.js';
import { roundSG, SG_LABELS } from '../rounds/sg.js';
import { tiger5, TIGER5_LABEL } from '../rounds/tiger.js';
import { approachBands } from '../rounds/bands.js';
import { usualTeeClub } from '../rounds/shotpanel.js';
import { leakText } from './leak.js';
import { benchFor, targetHcp } from '../benchmarks.js';
import { engineText } from './engine.js';

const one = (d) => (d == null ? '?' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`);

/** Strokes gained per round by part of the game, over rounds whose holes are complete enough. */
export function sgText(rcs) {
  const rows = rcs.filter((x) => x.c && !x.r.quick).map((x) => ({ x, S: roundSG(x.r, x.c) })).filter((y) => y.S && y.S.complete >= 9);
  if (rows.length < 3) return '';
  const n = rows.length, per = (k) => rows.reduce((a, y) => a + (y.S[k] * 18) / y.S.complete, 0) / n;
  const parts = ['ott', 'app', 'arg', 'putt'].map((k) => ({ k, v: per(k) })).sort((a, b) => a.v - b.v);
  return `Strokes gained per 18 against a scratch baseline, ${n} rounds with shot detail: ${parts.map((p) => `${SG_LABELS[p.k]} ${one(p.v)}`).join(', ')}. Biggest leak: ${SG_LABELS[parts[0].k]}.`;
}

/** The Tiger 5 per round, and how often the doubles come; doubles, bogeys and birdies against their level and target. */
export function tigerText(rcs, hcp = null) {
  const rows = rcs.filter((x) => x.c && !x.r.quick && (x.r.holes || []).filter((h) => h?.score != null).length >= 18);
  if (rows.length < 3) return '';
  const sum = {}; let tot = 0;
  for (const x of rows) { const t = tiger5(x.r, x.c); tot += t.total; for (const [k, v] of Object.entries(t.by)) sum[k] = (sum[k] || 0) + v; }
  const per = Object.entries(sum).map(([k, v]) => `${TIGER5_LABEL[k]} ${(v / rows.length).toFixed(1)}`).join(', ');
  let level = '';
  if (Number.isFinite(+hcp) && hcp !== null) {
    const B = benchFor(+hcp), tg = targetHcp(+hcp), T = benchFor(tg);
    const n = rows.length, cnt = (f) => rows.reduce((a, x) => a + (x.r.holes || []).filter((h, i) => h?.score != null && f(h.score - (x.c.holes?.[i]?.par || 4))).length, 0) / n;
    level = `\nScoring against golfers at their level (Shot Scope averages a round; Tiger 5 itself isn't published by handicap): doubles or worse ${cnt((d) => d >= 2).toFixed(1)} (a ${Math.round(+hcp)}-handicap about ${B.doubles.toFixed(1)}, ${tg ? `a ${tg}` : 'scratch'} about ${T.doubles.toFixed(1)}); bogeys ${cnt((d) => d === 1).toFixed(1)} (${B.bogeys.toFixed(1)}, ${T.bogeys.toFixed(1)}); birdies or better ${cnt((d) => d <= -1).toFixed(1)} (${B.birdies.toFixed(1)}, ${T.birdies.toFixed(1)}).`;
  }
  return `Tiger 5 per round over ${rows.length} full rounds: ${(tot / rows.length).toFixed(1)} in total (tour winners about 1.6, missed cuts about 3.7): ${per}.${level}`;
}

/** Tee shots, greens, putting, scrambling and the tagged causes, in one line each. */
export function statsText(rcs) {
  const list = rcs.filter((x) => x.c && !x.r.quick).map((x) => ({ round: x.r, course: x.c, stats: roundStats(x.r, x.c) }));
  const A = aggregate(list);
  if (!A || A.holes < 27) return '';
  const t = roundTendencies(A);
  return `${roundSummaryText(A)}${t.length ? `\nTendencies: ${t.map((x) => `${x.text} (${x.detail})`).join('; ')}.` : ''}`;
}

/** Where they score best from, for lay-up numbers. */
export function bandsText(rcs) {
  const b = approachBands(rcs.filter((x) => x.c && !x.r.quick));
  if (!b.best) return '';
  const yd = (band) => (band[1] >= 250 ? `${band[0]}+` : `${band[0]}-${band[1]}`);
  return `Where they score best from: ${yd(b.best.band)} yards (${b.best.n} shots, green ${Math.round(b.best.gir * 100)}%, about ${b.best.finish.toFixed(2)} strokes to finish)${b.worst ? `; worst ${yd(b.worst.band)} (${b.worst.finish.toFixed(2)})` : ''}. Lay up to the best band when going for it isn't on.`;
}

/** The bag with carries (clubs already resolved: [{club, carry}]), their go-to club, and the club they usually hit off each tee. */
export function bagText(settings, bag = [], rcs = []) {
  bag = bag.filter((c) => c.carry > 0);
  const lines = [];
  if (bag.length) lines.push(`Bag (carry yards): ${bag.map((c) => `${c.club} ${Math.round(c.carry)}`).join(', ')}.`);
  if (settings.goToClub) lines.push(`Their go-to club, in their words: ${settings.goToClub}. Offer it for a tight tee shot or when the driver isn't there.`);
  // the usual tee club by course, from the last rounds there
  const byCourse = new Map();
  for (const { r } of rcs) if (!byCourse.has(r.courseId)) byCourse.set(r.courseId, r);
  const tee = [];
  for (const [courseId, r] of byCourse) {
    const counts = {};
    for (let i = 0; i < 18; i++) { const u = usualTeeClub(rcs.map((x) => x.r), courseId, i); if (u?.club) counts[u.club] = (counts[u.club] || 0) + 1; }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3) tee.push(`${r.courseName.split(/\s[–-]\s/)[0]}: ${top[0]} on ${top[1]} tees`);
  }
  if (tee.length) lines.push(`Usual tee club where it isn't the driver: ${tee.slice(0, 4).join('; ')}.`);
  return lines.join('\n');
}

/** Everything about the game in one block, or '' when there's nothing worked out yet. */
export function gameText({ rcs = [], settings = {}, bag = [], swing = '', work = '', drills = '' } = {}) {
  const parts = [leakText(rcs, { hcp: settings.handicap }), engineText(rcs), sgText(rcs), tigerText(rcs, settings.handicap ?? null), statsText(rcs), bandsText(rcs), bagText(settings, bag, rcs),
    swing ? `Swing (from osolo's video analyses): ${swing}` : '', work ? `Working on: ${work}` : '', drills ? `Drills: ${drills}` : ''].filter(Boolean);
  return parts.length ? `THE GAME (worked out by the app; trust these numbers)\n${parts.join('\n')}` : '';
}

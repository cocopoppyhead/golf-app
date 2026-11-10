// The weekly review Molinari does with his players, done for you: the last seven days of rounds,
// practice and swings against the seven before. Where strokes went, whether the practice matched
// it, whether the intention held, and the two or three things to carry into next week. Pure
// functions over the records; the Play home renders it and the coach reads the text version.
import { roundSG, SG_LABELS } from './rounds/sg.js';
import { roundStats, aggregate, roundTendencies } from './rounds/stats.js';
import { intentionLabel } from './rounds/intentions.js';

const DAY = 864e5;
const SG_AREA = { ott: ['driver', 'swing'], app: ['irons', 'wedges', 'swing'], arg: ['chipping', 'bunker', 'wedges'], putt: ['putting'] };
const sessionDone = (s) => s.status === 'done' || (!s.status && s.date);

/** Per-area practice minutes from finished sessions in a window (needs the drill library for areas). */
export function practiceByArea(sessions, lib, from, to) {
  const area = Object.fromEntries((lib?.drills || []).map((d) => [d.id, d.area]));
  const out = {}; let minutes = 0, n = 0;
  for (const s of sessions) {
    if (!sessionDone(s)) continue;
    const t = s.finishedAt || s.date || s.startedAt; if (!(t >= from && t < to)) continue;
    n++; minutes += s.minutes || 0;
    const areas = [...new Set((s.items || []).map((it) => area[it.drillId]).filter(Boolean))];
    const share = areas.length ? (s.minutes || 30) / areas.length : 0;
    for (const a of areas) out[a] = (out[a] || 0) + share;
  }
  return { byArea: out, minutes, n };
}

/**
 * The digest. rounds = [{ r, c }] (all finished rounds, any order), sessions = practice sessions,
 * swings = analysed swings, lib = drill library, now = ms. Returns null when the fortnight is empty.
 */
export function weeklyDigest({ rounds = [], sessions = [], swings = [], lib = null, now = Date.now() } = {}) {
  const from = now - 7 * DAY, prevFrom = now - 14 * DAY;
  const inWin = (t, a, b) => t >= a && t < b;
  const week = rounds.filter(({ r }) => r.finished && inWin(r.date, from, now + DAY));
  const prev = rounds.filter(({ r }) => r.finished && inWin(r.date, prevFrom, from));
  const P = practiceByArea(sessions, lib, from, now + DAY), Pprev = practiceByArea(sessions, lib, prevFrom, from);
  const sw = swings.filter((s) => inWin(s.date || s.at || 0, from, now + DAY)).length;
  if (!week.length && !P.n && !sw && !prev.length) return null;

  const stats = (list) => {
    const L = list.filter(({ r }) => r.learning !== false);
    const items = L.map(({ r, c }) => ({ round: r, course: c, stats: roundStats(r, c) }));
    const A = aggregate(items);
    const Gs = L.map(({ r, c }) => roundSG(r, c)).filter((G) => G && G.complete >= Math.min(9, G.holes));
    const sg = Gs.length ? Object.fromEntries(['ott', 'app', 'arg', 'putt', 'total'].map((k) => [k, Gs.reduce((a, G) => a + G[k] * (18 / G.holes), 0) / Gs.length])) : null;
    return { A, sg, n: list.length, scores: list.map(({ r, c }) => { const S = r._stats || roundStats(r, c); return S.holes >= 18 ? S.score : null; }).filter((x) => x != null) };
  };
  const W = stats(week), V = stats(prev);
  const lines = [];
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // scoring
  if (W.n) {
    const a = avg(W.scores), b = avg(V.scores);
    lines.push({ key: 'rounds', text: `${W.n} round${W.n > 1 ? 's' : ''}${a != null ? `, averaging ${a.toFixed(1)}` : ''}${a != null && b != null ? ` (${a < b ? '−' : '+'}${Math.abs(a - b).toFixed(1)} on the week before)` : ''}${W.A ? `, ${(W.A.doubles * W.A.per18).toFixed(1)} doubles per 18` : ''}.` });
  } else lines.push({ key: 'rounds', text: `No rounds this week${V.n ? ` (${V.n} the week before)` : ''}.` });

  // where the strokes went, and did the practice match
  let weakest = null;
  if (W.sg) {
    const cats = ['ott', 'app', 'arg', 'putt'].map((k) => [k, W.sg[k]]).sort((a, b) => a[1] - b[1]);
    weakest = cats[0][0];
    const swing = V.sg ? ` (${V.sg[weakest] < W.sg[weakest] ? 'better' : 'worse'} than last week's ${V.sg[weakest].toFixed(1)})` : '';
    lines.push({ key: 'sg', text: `Most strokes went in ${SG_LABELS[weakest].toLowerCase()}: ${W.sg[weakest].toFixed(1)} per 18${swing}. Best: ${SG_LABELS[cats[3][0]].toLowerCase()} ${cats[3][1] >= 0 ? '+' : ''}${cats[3][1].toFixed(1)}.` });
  }
  if (P.n) {
    const areas = Object.entries(P.byArea).sort((a, b) => b[1] - a[1]);
    const top = areas[0];
    const matched = weakest ? SG_AREA[weakest].some((a) => (P.byArea[a] || 0) >= P.minutes * 0.25) : null;
    lines.push({ key: 'practice', text: `${P.n} practice session${P.n > 1 ? 's' : ''}, ${P.minutes} min${top ? `, mostly ${top[0]}` : ''}${Pprev.n ? ` (${Pprev.minutes} min the week before)` : ''}.${matched === false ? ` None of it on ${SG_LABELS[weakest].toLowerCase()}, where the strokes went — point next week's sessions there.` : matched === true ? ' That matches where the strokes went.' : ''}` });
  } else lines.push({ key: 'practice', text: `No practice logged${weakest ? ` — ${SG_LABELS[weakest].toLowerCase()} is where to spend it` : ''}.` });
  if (sw) lines.push({ key: 'swings', text: `${sw} swing${sw > 1 ? 's' : ''} analysed.` });

  // intention vs score, across everything you've logged (small samples say so)
  const withIntent = rounds.filter(({ r }) => r.finished && r.intention && r.intentionKept);
  if (withIntent.length >= 4) {
    const sc = ({ r, c }) => { const S = r._stats || roundStats(r, c); return S.holes >= 18 ? S.toPar : null; };
    const kept = withIntent.filter(({ r }) => r.intentionKept >= 4).map(sc).filter((x) => x != null);
    const lost = withIntent.filter(({ r }) => r.intentionKept <= 3).map(sc).filter((x) => x != null);
    if (kept.length >= 2 && lost.length >= 2) {
      const dk = avg(kept), dl = avg(lost);
      lines.push({ key: 'intention', text: `Rounds where you kept your one thing (${kept.length}): ${dk >= 0 ? '+' : ''}${dk.toFixed(1)}. Rounds where it slipped (${lost.length}): ${dl >= 0 ? '+' : ''}${dl.toFixed(1)}.${dl - dk >= 1.5 ? ' That gap is the mental game, measured.' : ''}` });
    }
  }
  const weekIntent = week.map(({ r }) => r).filter((r) => r.intention);
  if (weekIntent.length) {
    const kept = weekIntent.filter((r) => r.intentionKept).map((r) => r.intentionKept);
    lines.push({ key: 'intent-week', text: `This week's one thing${weekIntent.length > 1 ? 's' : ''}: ${[...new Set(weekIntent.map((r) => intentionLabel(r.intention)))].join(', ')}${kept.length ? ` — kept ${(avg(kept)).toFixed(1)}/5` : ''}.` });
  }

  // what to carry into next week
  const carry = [];
  const T = W.A ? roundTendencies(W.A).slice(0, 2) : [];
  for (const t of T) carry.push(t.text);
  const again = week.map(({ r }) => r.debrief?.again?.trim()).filter(Boolean);
  if (again.length) carry.push(`You said: “${again[again.length - 1]}”`);
  if (!carry.length && weakest) carry.push(`A session on ${SG_LABELS[weakest].toLowerCase()}`);

  return { from, to: now, lines, carry: carry.slice(0, 3), weakest, rounds: W.n, practice: P.n, swings: sw };
}

/** Text for the coach. */
export const digestText = (d) => (d ? `This week: ${d.lines.map((l) => l.text).join(' ')}${d.carry.length ? ` Carry into next week: ${d.carry.join('; ')}.` : ''}` : '');

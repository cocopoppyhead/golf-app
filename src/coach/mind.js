// The mental coach: a conversation that knows your rounds. Its context is built from what you already
// log: how you felt at the start, the turn and the finish; your aim and the kind of round; your process
// ratings; the one thing you set out to do and whether you kept it; your debrief; your best shots and
// how they felt; heart rate and heat when the watch had them; your routine and round rules.
// The conversation is kept on this phone only (localStorage), like your API key.
import { getRoutine } from '../rounds/routine.js';
import { RULES, DEFAULT_RULES, checkRules } from '../rounds/tiger.js';
import { moodLine, intentionLabel } from '../rounds/intentions.js';

export const SYSTEM = `You are this golfer's mental-game coach. You know their recent rounds (given below) and use them: name the round, the hole, the number. Grounded in sports psychology that works on a golf course: process goals over outcome goals, a consistent pre-shot routine, committing to a target, accepting the result and resetting between shots, attention on the next shot only, managing arousal (breathing, tempo), and honest post-round reflection.
How to talk:
- Short and plain, like a good caddie. Two to five sentences unless they ask for more. No lists unless they ask.
- Ask one question at a time when you need to understand something.
- Be honest. If the data says they bailed on their routine when it mattered, say so kindly and plainly. No flattery.
- Give one thing to do, concrete enough to try on the next round or the next shot.
- Their mood scale: 1 = flat, 5 = calm and focused (ideal), 10 = agitated.
- You are not a therapist. If they describe real distress beyond golf, say so gently and suggest talking to someone they trust or a professional.
- Accuracy: quote numbers exactly as given. Never add up scores or work out to-par yourself; the app has done it. "+3" means three over par. If something isn't in the data, say you don't have it rather than guess.
- Look for the story across rounds first: the PATTERNS section (front vs back nine, lopsided cards, what follows a double, heat, tee time, heart rate, feeling at the turn). A back nine that falls away can be tiredness, heat, hunger or lost focus: use the heart rate, temperature, tee time and their notes to say which looks likelier, and ask when you can't tell.
- If they correct you, accept it, use their version, and move on without a long apology.`;

const FREQ = { 4: 'always', 3: 'mostly', 2: 'sometimes', 1: 'rarely' };
const fmtD = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const signed = (d) => (Math.round(d) === 0 ? 'E' : d > 0 ? `+${Math.round(d)}` : `${Math.round(d)}`);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const one = (d) => (d == null ? '?' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`);

/** Scored holes of a round with par and score to par. */
export function scored({ r, c }) {
  return (r.holes || []).map((h, i) => ({ h, i, par: c?.holes?.[i]?.par || 4 })).filter((x) => x.h?.score != null).map((x) => ({ ...x, d: x.h.score - x.par }));
}

/** One round as a few lines for the coach. rc = { r, c } (round, course). Every number is worked out here. */
export function roundLines({ r, c }) {
  const holes = scored({ r, c });
  const score = holes.reduce((a, x) => a + x.h.score, 0);
  const front = holes.filter((x) => x.i < 9), back = holes.filter((x) => x.i >= 9);
  const tp = (xs) => signed(xs.reduce((a, x) => a + x.d, 0));
  const big = holes.filter((x) => x.d >= 2).map((x) => `${x.i + 1} (${x.h.score} on a par ${x.par})`);
  const p = r.process || {};
  const start = new Date(r.date);
  const head = r.quick ? `${r.score ?? '?'} (total only, no hole scores)` : holes.length < 18 && holes.length !== 9
    ? `${holes.length} holes played, ${score} strokes, ${tp(holes)} (an incomplete round)`
    : `${score} strokes, ${tp(holes)}${back.length && front.length ? `. Front nine ${tp(front)}, back nine ${tp(back)}` : ''}`;
  const out = [`${fmtD(r.date)}, teed off ${start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, ${r.courseName}: ${head}.`];
  if (!r.quick && holes.length) out.push(`Hole by hole to par: ${front.map((x) => signed(x.d)).join(' ')}${back.length ? ` | ${back.map((x) => signed(x.d)).join(' ')}` : ''}.`);
  if (r.kind || r.aim) out.push(`${r.kind ? (r.kind === 'comp' ? 'Competition' : 'Casual') + ' round' : ''}${r.kind && r.aim ? '; ' : ''}${r.aim ? `aim: ${{ low: 'shoot low', fun: 'have fun', both: 'shoot low and have fun' }[r.aim]}` : ''}.`);
  const mood = r.mood && moodLine(r); if (mood) out.push(`${mood}.`);
  if (big.length) out.push(`Doubles or worse: ${big.join(', ')}.`);
  if (p.routine || p.commit || p.accept) out.push(`Self-rated process: routine ${FREQ[p.routine] || '?'}, committed ${FREQ[p.commit] || '?'}, let bad shots go ${FREQ[p.accept] || '?'}${p.fun ? `, enjoyed it ${FREQ[p.fun]}` : ''}.`);
  if (c && !r.quick && holes.length) { const broken = checkRules(r, c, DEFAULT_RULES).filter((x) => x.holes.length); if (broken.length) out.push(`Rules broken: ${broken.map((x) => `${x.label} (${x.holes.join(', ')})`).join('; ')}.`); }
  const d = r.debrief || {};
  const stop = (x) => String(x).trim().replace(/([^.!?])$/, '$1.');
  if (d.tags?.length) out.push(`What cost most (their words): ${d.tags.join(', ')}.`);
  if (d.notes) out.push(`Their notes: ${stop(d.notes)}`);
  if (d.again) out.push(`Next time they'd: ${stop(d.again)}`);
  const notes = holes.filter((x) => x.h.note).map((x) => `${x.i + 1}: ${x.h.note}`); if (notes.length) out.push(`Hole notes: ${notes.join('; ')}.`);
  const best = (r.best || []).filter((b) => b.note); if (best.length) out.push(`Best shots, how they felt: ${best.map((b) => `hole ${b.h + 1}${b.club ? ` (${b.club})` : ''}: ${b.note}`).join('; ')}.`);
  const hrF = avg(front.map((x) => x.h.hr?.avg).filter(Boolean)), hrB = avg(back.map((x) => x.h.hr?.avg).filter(Boolean));
  if (r.hr?.avg) out.push(`Heart rate: average ${r.hr.avg}${r.hr.max ? `, peak ${r.hr.max}` : ''} bpm${hrF && hrB ? ` (front ${Math.round(hrF)}, back ${Math.round(hrB)})` : ''}.`);
  const t = r.cond?.start?.tempC; if (t != null) out.push(`About ${Math.round(t)}°C${r.cond.start.windMph != null ? `, wind ${Math.round(r.cond.start.windMph)} mph` : ''}.`);
  return out.join(' ');
}

/**
 * Patterns across rounds, worked out here so the coach doesn't do arithmetic: front against back nine,
 * lopsided cards, what follows a double, slow starts and closing holes, and whether heat, a late tee
 * time, a high heart rate or feeling wound up at the turn go with a worse back nine. Only full 18s;
 * a comparison needs at least 3 rounds on each side.
 */
export function patterns(rcs) {
  const full = rcs.filter((x) => !x.r.quick).map((x) => ({ ...x, hs: scored(x) })).filter((x) => x.hs.length === 18);
  if (full.length < 3) return [];
  const out = [];
  const nine = (x, back) => x.hs.filter((h) => (back ? h.i >= 9 : h.i < 9)).reduce((a, h) => a + h.d, 0);
  const rows = full.map((x) => ({ ...x, f: nine(x, false), b: nine(x, true) })).map((x) => ({ ...x, gap: x.b - x.f }));
  out.push(`Over ${rows.length} full rounds: front nine averages ${one(avg(rows.map((x) => x.f)))}, back nine ${one(avg(rows.map((x) => x.b)))} to par.`);
  const lop = rows.filter((x) => Math.abs(x.gap) >= 4);
  if (lop.length) out.push(`Lopsided cards (4+ shots between the nines): ${lop.length} of ${rows.length}. ${lop.filter((x) => x.gap > 0).length} fell away on the back, ${lop.filter((x) => x.gap < 0).length} on the front. ${lop.slice(0, 6).map((x) => `${fmtD(x.r.date)} ${x.r.courseName.split(/\s[–-]\s/)[0]}: ${signed(x.f)} / ${signed(x.b)}`).join('; ')}.`);
  // after a double
  const all = rows.flatMap((x) => x.hs.map((h, k) => ({ d: h.d, prev: k ? x.hs[k - 1].d : null })));
  const after = all.filter((h) => h.prev != null && h.prev >= 2).map((h) => h.d);
  if (after.length >= 5) out.push(`The hole after a double or worse averages ${one(avg(after))} (every hole: ${one(avg(all.map((h) => h.d)))}); ${Math.round((100 * after.filter((d) => d >= 1).length) / after.length)}% of the time it's another bogey or worse.`);
  const by = (from, to) => avg(rows.flatMap((x) => x.hs.filter((h) => h.i >= from && h.i <= to).map((h) => h.d)));
  out.push(`Per hole to par: holes 1-3 ${one(by(0, 2))}, 4-15 ${one(by(3, 14))}, 16-18 ${one(by(15, 17))}.`);
  // what goes with a worse back nine
  const split = (label, test, yes, no) => {
    const a = rows.filter((x) => test(x) === true), b = rows.filter((x) => test(x) === false);
    if (a.length >= 3 && b.length >= 3) out.push(`${label}: back nine minus front ${one(avg(a.map((x) => x.gap)))} (${a.length} rounds ${yes}) against ${one(avg(b.map((x) => x.gap)))} (${b.length} ${no}).`);
  };
  split('Heat', (x) => (x.r.cond?.start?.tempC == null ? null : x.r.cond.start.tempC >= 32), 'at 32°C or hotter', 'cooler');
  split('Tee time', (x) => new Date(x.r.date).getHours() >= 13, 'teeing off 1pm or later', 'earlier');
  const hrs = rows.map((x) => x.r.hr?.avg).filter(Boolean).sort((p, q) => p - q);
  if (hrs.length >= 6) { const mid = hrs[Math.floor(hrs.length / 2)]; split('Heart rate', (x) => (x.r.hr?.avg ? x.r.hr.avg > mid : null), `above ${mid} bpm average`, 'at or below'); }
  split('Feeling at the turn', (x) => (x.r.mood?.turn ? x.r.mood.turn >= 7 : null), 'wound up (7+ of 10)', 'calmer');
  split('Kind of round', (x) => (x.r.kind ? x.r.kind === 'comp' : null), 'competition', 'casual');
  return out;
}

/** Everything the coach is told: who they are, how they prepare, and the recent rounds (newest first). */
export function mindContext({ rounds = [], settings = {}, focus = null } = {}) {
  const R = getRoutine(settings);
  const rules = (settings.roundRules || DEFAULT_RULES).map((id) => RULES[id]?.label).filter(Boolean);
  const parts = [];
  if (settings.golfer) parts.push(`ABOUT THE GOLFER\n${settings.golfer}`);
  if (settings.handicap != null) parts.push(`Handicap: ${settings.handicap}.`);
  parts.push(`THEIR ROUTINE\nBefore every shot: ${R.preshot.join(' / ')}.\nBetween shots: ${R.mind.join(' / ')}.${R.swingThought ? `\nSwing thought: ${R.swingThought}.` : ''}${R.custom ? '' : '\n(This is the app\'s example routine; they have not written their own yet.)'}\nRound rules: ${rules.join('; ')}.`);
  if (focus) parts.push(`THE ROUND THEY WANT TO TALK ABOUT\n${roundLines(focus)}${focus.r.intention ? ` Their one thing for the day: "${intentionLabel(focus.r.intention)}"${focus.r.intentionKept ? `, kept ${focus.r.intentionKept}/5` : ''}.` : ''}`);
  const pats = patterns(rounds);
  if (pats.length) parts.push(`PATTERNS (worked out by the app from their rounds; trust these numbers)\n${pats.join('\n')}`);
  const rest = rounds.filter((x) => !focus || x.r.id !== focus.r.id).slice(0, 12);
  parts.push(rest.length ? `RECENT ROUNDS (newest first)\n${rest.map(roundLines).join('\n')}` : 'RECENT ROUNDS\nNone logged yet.');
  return parts.join('\n\n');
}

// ---- the conversation, kept on this phone ----
const KEY = 'golf.mindChat';
const MAX = 40;
export function loadChat() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function saveChat(msgs) { try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-MAX))); } catch { /* full or blocked: the chat still works this session */ } }
export function clearChat() { try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } }

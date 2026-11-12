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
- Never invent rounds or numbers that are not in the data.`;

const FREQ = { 4: 'always', 3: 'mostly', 2: 'sometimes', 1: 'rarely' };
const fmtD = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** One round as a few lines for the coach. rc = { r, c } (round, course). */
export function roundLines({ r, c }) {
  const holes = (r.holes || []).map((h, i) => ({ h, par: c?.holes?.[i]?.par || 4, i })).filter((x) => x.h?.score != null);
  const score = holes.reduce((a, x) => a + x.h.score, 0);
  const front = holes.filter((x) => x.i < 9), back = holes.filter((x) => x.i >= 9);
  const tp = (xs) => { const d = xs.reduce((a, x) => a + x.h.score - x.par, 0); return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`; };
  const big = holes.filter((x) => x.h.score - x.par >= 2).map((x) => `${x.i + 1} (${x.h.score} on par ${x.par})`);
  const p = r.process || {};
  const out = [`${fmtD(r.date)}, ${r.courseName}: ${r.quick ? `${r.score ?? '?'} (score only)` : `${score} over ${holes.length} holes (${tp(holes)})${back.length ? `, front ${tp(front)}, back ${tp(back)}` : ''}`}.`];
  if (r.kind || r.aim) out.push(`${r.kind ? (r.kind === 'comp' ? 'Competition' : 'Casual') + ' round' : ''}${r.kind && r.aim ? '; ' : ''}${r.aim ? `aim: ${{ low: 'shoot low', fun: 'have fun', both: 'shoot low and have fun' }[r.aim]}` : ''}.`);
  const mood = r.mood && moodLine(r); if (mood) out.push(`${mood}.`);
  if (big.length) out.push(`Doubles or worse: ${big.join(', ')}.`);
  if (p.routine || p.commit || p.accept) out.push(`Self-rated process: routine ${FREQ[p.routine] || '?'}, committed ${FREQ[p.commit] || '?'}, let bad shots go ${FREQ[p.accept] || '?'}${p.fun ? `, enjoyed it ${FREQ[p.fun]}` : ''}.`);
  if (c && !r.quick) { const broken = checkRules(r, c, DEFAULT_RULES).filter((x) => x.holes.length); if (broken.length) out.push(`Rules broken: ${broken.map((x) => `${x.label} (${x.holes.join(', ')})`).join('; ')}.`); }
  const d = r.debrief || {};
  if (d.tags?.length) out.push(`What cost most (their words): ${d.tags.join(', ')}.`);
  const stop = (x) => String(x).trim().replace(/([^.!?])$/, '$1.');
  if (d.notes) out.push(`Their notes: ${stop(d.notes)}`);
  if (d.again) out.push(`Next time they'd: ${stop(d.again)}`);
  const notes = holes.filter((x) => x.h.note).map((x) => `${x.i + 1}: ${x.h.note}`); if (notes.length) out.push(`Hole notes: ${notes.join('; ')}.`);
  const best = (r.best || []).filter((b) => b.note); if (best.length) out.push(`Best shots, how they felt: ${best.map((b) => `hole ${b.h + 1}${b.club ? ` (${b.club})` : ''}: ${b.note}`).join('; ')}.`);
  if (r.hr?.avg) out.push(`Heart rate: average ${r.hr.avg}${r.hr.max ? `, peak ${r.hr.max}` : ''} bpm.`);
  const t = r.cond?.start?.tempC; if (t != null) out.push(`About ${Math.round(t)}°C${r.cond.start.windMph != null ? `, wind ${Math.round(r.cond.start.windMph)} mph` : ''}.`);
  return out.join(' ');
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
  const rest = rounds.filter((x) => !focus || x.r.id !== focus.r.id).slice(0, 10);
  parts.push(rest.length ? `RECENT ROUNDS (newest first)\n${rest.map(roundLines).join('\n')}` : 'RECENT ROUNDS\nNone logged yet.');
  return parts.join('\n\n');
}

// ---- the conversation, kept on this phone ----
const KEY = 'golf.mindChat';
const MAX = 40;
export function loadChat() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function saveChat(msgs) { try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-MAX))); } catch { /* full or blocked: the chat still works this session */ } }
export function clearChat() { try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } }

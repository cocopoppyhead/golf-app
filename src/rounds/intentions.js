// One thing for today: the intention you take to the first tee and rate at the end. Most of the
// difference between a good round and a bad one is here, not in the swing.
export const INTENTIONS = [['commit', 'Commit to every target'], ['safe', 'Play the safe side'], ['routine', 'Routine on every shot'], ['present', 'One shot at a time'], ['club', 'Take enough club'], ['lag', 'Lag putts to the hole'], ['bogey', 'Bogey is fine, no doubles'], ['tempo', 'Smooth tempo']];
export const intentionLabel = (k) => (INTENTIONS.find((x) => x[0] === k) || [null, k])[1];

// Emotional state, 1–10 (5 = calm, focused, energised). Asked at the start, at the turn and at the end.
export const MOOD_WORDS = { low: 'Lethargic · uninterested · sluggish', mid: 'Calm · focused · energised', high: 'Agitated · erratic · jumpy' };
export const WARMUP = [['none', 'None'], ['putt', 'Putting only'], ['range', 'Range balls'], ['full', 'Full warm-up']];
export const moodLine = (r) => {
  const m = r.mood || {}; const f = (x) => (x ? `${x}/10` : '–');
  if (!m.start && !m.turn && !m.finish) return '';
  return `Emotional state: start ${f(m.start)}, turn ${f(m.turn)}, finish ${f(m.finish)}${r.warmup ? ` · warm-up: ${(WARMUP.find((x) => x[0] === r.warmup) || [null, r.warmup])[1].toLowerCase()}` : ''}${r.intention ? ` · intention: “${intentionLabel(r.intention)}”${r.intentionKept ? `, kept ${r.intentionKept}/5` : ''}` : ''}${r.swingThought ? ` · swing thought: “${r.swingThought}”` : ''}${r.expect ? ` · a good round: “${r.expect}”` : ''}`;
};

// Every coach reply is checked by the app before the golfer sees it, whichever model wrote it. These
// are the playbook's hard rules, the ones a model can drift on, enforced in code:
//   - one question at most
//   - no lists or headings (it's a conversation)
//   - no score, stat or to-par figure the app didn't give it (the model reads numbers, it doesn't make them)
//   - nothing impossible in practice (worse than a triple a hole over a stretch: "+12 over 3 holes" is strokes)
//   - no tee time or clock time that isn't in the data
// A reply that breaks one is sent back once with what's wrong (see repairPrompt); the golfer sees the
// rewrite. Style is left to the model and the example conversations: these checks are only for errors.

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18 };
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? +s : WORDNUM[s.toLowerCase()] ?? null);
const norm = (s) => String(s || '').replace(/[−–]/g, '-');

/** The numbers the coach was given (context + what the golfer said), as a set of strings like "12", "+3", "-2". */
export function knownNumbers(...texts) {
  const out = new Set();
  for (const t of texts) for (const m of norm(t).matchAll(/[+-]?\d+(?:\.\d+)?/g)) { out.add(m[0]); out.add(m[0].replace(/^[+-]/, '')); }
  return out;
}

/** Problems with a reply (empty when it's fine). known: from knownNumbers. */
export function checkReply(text, known = new Set()) {
  const t = norm(text), problems = [];
  const q = (t.match(/\?/g) || []).length;
  if (q > 1) problems.push(`it asks ${q} questions; ask one at most`);
  const lines = t.split('\n').map((l) => l.trim());
  if (lines.filter((l) => /^([-*•]|\d+[.)])\s/.test(l)).length >= 2) problems.push('it uses a list; write it as a short conversation in plain sentences');
  if (lines.some((l) => /^#{1,6}\s/.test(l))) problems.push('it has headings; no headings');
  // stat claims must be numbers it was given: to-par (+3, 3 over), strokes, putts, percentages, averages
  const claims = [
    ...[...t.matchAll(/(?<![\w.])([+-]\d+(?:\.\d+)?)(?![\w%])/g)].map((m) => m[1]),
    ...[...t.matchAll(/\b(\d+(?:\.\d+)?)\s+(?:over|under)(?:\s+par)?\b/gi)].map((m) => m[1]),
    ...[...t.matchAll(/\b(\d+(?:\.\d+)?)\s+(?:strokes?|putts?|three-putts?|3-putts?|doubles?|bogeys?|birdies?|pars|penalt(?:y|ies)|fairways|greens)\b/gi)].map((m) => m[1]),
    ...[...t.matchAll(/\b(\d+(?:\.\d+)?)\s?%/g)].map((m) => m[1]),
    ...[...t.matchAll(/\b(?:shot|scored|carded|averag(?:e|ed|ing))\s+(?:a\s+|an\s+)?(\d{2,3})\b/gi)].map((m) => m[1]),
  ];
  const small = (s) => Math.abs(parseFloat(s)) <= 1; // "one bogey", "+1": too common to police
  const unknown = [...new Set(claims)].filter((c) => !small(c) && !known.has(c) && !known.has(c.replace(/^[+-]/, '')));
  if (unknown.length) problems.push(`it states ${unknown.join(', ')}, which the app didn't give you; quote numbers only from the data or what the golfer said, or leave the number out`);
  // golf sense: a to-par figure over a number of holes
  for (const m of t.matchAll(/([+-]?\d+)\s*(?:over(?:\s+par)?\s*)?(?:on|over|for|in|across|through)\s+(?:the\s+)?(?:first\s+|last\s+|opening\s+|closing\s+|those\s+|next\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)\s+holes/gi)) {
    const toPar = Math.abs(parseInt(m[1], 10)), n = num(m[2]);
    // more than a triple bogey a hole, every hole, over a stretch: that's strokes read as to-par (one hole can be a disaster)
    if (n && toPar > (n === 1 ? 5 : 3 * n) && /^[+]|over/i.test(m[0])) problems.push(`"${m[0]}" is impossible in practice (worse than a triple bogey on every hole); that's strokes, not score to par`);
  }
  // clock times: only ones in the data
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi)) if (!known.has(m[1])) problems.push(`it states a time (${m[0]}) that isn't in the data; never assume a tee time`);
  return [...new Set(problems)];
}

/** The note sent back with a reply that failed the checks. */
export const repairPrompt = (problems) => `[osolo's check, not from the golfer] Your last reply can't be shown as it is: ${problems.join('; ')}. Rewrite it, keeping what was good and the same voice, fixing only that. Keep the json block at the end.`;

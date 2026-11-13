// Where the conversation is. A debrief or a pre-round chat has a shape a working coach follows (hear
// it, read it, agree one thing, close it and look forward), so the app holds the step and tells the
// model where it is each turn, instead of trusting it to remember. It is a spine, not a script: the
// golfer can go anywhere, the coach answers, and the step only moves on when its goal is met (the
// model says so in its json) or after a few turns, so it can never circle one round for ever.
// An open question has no steps: it's a conversation.

export const STEPS = {
  debrief: [
    { id: 'hear', goal: 'Hear their version of the round. Start with what went well (a shot, a hole, a nine), then ask about the turning point. Short.' },
    { id: 'read', goal: 'Your read of where the strokes went and which hat each belongs to (decision, swing, mind, energy), from the numbers and what they told you, with how sure you are.' },
    { id: 'lesson', goal: 'Agree one thing for the next round: specific, small, where and when. Put it in "next".' },
    { id: 'close', goal: 'The round is closed. Don\'t reopen it. Answer whatever they ask next as an open conversation, looking forward.' },
  ],
  'pre-round': [
    { id: 'plan', goal: "Today's one intention and the first-tee plan (club and target; their go-to club if the driver is the risk)." },
    { id: 'reset', goal: 'The reset for the first bad hole, in their words if they have them.' },
    { id: 'close', goal: 'They are ready. Wish them well in one line; answer anything else briefly and calmly.' },
  ],
  open: [],
};
const MAX_TURNS = 3; // replies in one step before it moves on regardless

export const startFlow = (mode = 'open') => ({ mode, step: 0, turns: 0 });

/** The line the model sees about where it is, or '' in an open conversation. */
export function stepText(f) {
  const steps = STEPS[f?.mode] || [];
  if (!steps.length) return '';
  const i = Math.min(f.step, steps.length - 1), s = steps[i], last = i === steps.length - 1;
  return `WHERE YOU ARE IN THIS CONVERSATION (the app tracks this; you don't mention it)
Step ${i + 1} of ${steps.length}: ${s.goal}
This is a spine, not a script. If they ask something else, answer it properly first, as a coach would; come back to the step only if it still matters. Talk like a person, not a form.${last ? '' : '\nWhen this step\'s goal is met, add "step_done": true to your json block.'}`;
}

/** After a reply: move on when the step is done, or after MAX_TURNS replies in it. */
export function advance(f, meta) {
  const steps = STEPS[f?.mode] || [];
  if (!steps.length) return f;
  const done = meta?.step_done === true || f.turns + 1 >= MAX_TURNS;
  return done && f.step < steps.length - 1 ? { ...f, step: f.step + 1, turns: 0 } : { ...f, turns: f.turns + 1 };
}

// kept with the chat on this phone
const KEY = 'golf.mindFlow';
export function loadFlow() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function saveFlow(f) { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* the chat still works */ } }
export function clearFlow() { try { localStorage.removeItem(KEY); } catch { /* nothing kept */ } }

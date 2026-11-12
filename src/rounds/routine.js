// The routine: what you do before every shot, and what you say to yourself between them. Yours is kept
// in settings (one line per step); the defaults are an example of a complete one — set-up, decision,
// commitment, rehearsal, breath, go — plus the between-shot lines that keep a round from unravelling.
// Shown before the round with the day's swing thought and expectation, and one tap away on every hole.
export const DEFAULT_ROUTINE = {
  preshot: [
    'Bag behind me and out of the way',
    'Pick the target, then the club',
    'Commit to the shot — have faith in it',
    'Dress rehearsal, not a practice swing',
    'Deep breath, calm and positive',
    'Play, don\'t think',
  ],
  mind: [
    'Head up, above the level of the pin',
    'Forget the bad shot, remember the good one',
    'Attach the emotion to the good shots',
    'Take charge of my body language',
    'Sink that putt',
  ],
};

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** The golfer's routine from settings, falling back to the example for anything left blank. */
export function getRoutine(settings = {}) {
  const r = settings.routine || {};
  return {
    preshot: lines(r.preshot).length ? lines(r.preshot) : DEFAULT_ROUTINE.preshot,
    mind: lines(r.mind).length ? lines(r.mind) : DEFAULT_ROUTINE.mind,
    swingThought: (r.swingThought || '').trim(),
    custom: lines(r.preshot).length > 0 || lines(r.mind).length > 0,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The routine as HTML: numbered pre-shot steps, then the between-shot lines. */
export function routineHtml(R, { swingThought = '', expect = '' } = {}) {
  return `<div class="routine">
    ${swingThought ? `<p class="rt-thought"><span class="mute small">Swing thought</span><b>${esc(swingThought)}</b></p>` : ''}
    ${expect ? `<p class="rt-thought"><span class="mute small">A good round today</span><b>${esc(expect)}</b></p>` : ''}
    <ol>${R.preshot.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <ul>${R.mind.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    ${R.custom ? '' : '<p class="mute small">This is the example routine. Make it yours: Play → Pre-round check-in → Edit.</p>'}
  </div>`;
}

/** One line for the AI coach and the round summary. */
export const routineText = (round) => [round.swingThought ? `swing thought “${round.swingThought}”` : null, round.expect ? `expectation “${round.expect}”` : null].filter(Boolean).join(', ');

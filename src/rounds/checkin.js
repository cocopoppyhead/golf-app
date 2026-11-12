// Pre-round check-in, on the Play page: what to read in the car park before the first tee. Your swing
// thought, the note you left yourself after your last round, your routine before every shot, what you
// say to yourself between shots, and the round rules you're playing to. Edited in mygame.js planSheet.
import { getRoutine } from './routine.js';
import { RULES, DEFAULT_RULES } from './tiger.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The newest finished round with a "next time I'll…" note. */
export function lastNote(rounds = []) {
  const r = rounds.filter((x) => x.finished && x.debrief?.again?.trim()).sort((a, b) => b.date - a.date)[0];
  return r ? { text: r.debrief.again.trim(), courseName: r.courseName, date: r.date } : null;
}

/** Short names for the round rules, so they fit as chips. */
const SHORT = { noDoubles: 'No doubles', noBogeyPar5: 'No bogeys on 5s', noShortBogey: 'No bogeys inside 150', blownSave: 'No blown easy saves', no3Putts: 'No 3-putts', noDoubleChip: 'No double chips', noFwBunker: 'No fairway bunkers off the tee', noTeeErrors: 'No tee-shot errors' };

export function checkinHtml(settings = {}, note = null) {
  const R = getRoutine(settings);
  const rules = (settings.roundRules || DEFAULT_RULES).filter((id) => RULES[id]);
  return `<div class="sechead"><h2>Pre-round check-in</h2><button class="link acc" data-act="plan">Edit</button></div>
  <div class="card checkin">
    <div class="ci-thought">${R.swingThought ? `<span class="ci-k">Swing thought</span><b>${esc(R.swingThought)}</b>` : '<span class="ci-k">Swing thought</span><button class="link acc" data-act="plan">Add one</button>'}</div>
    ${note ? `<div class="ci-note"><span class="ci-k">You said after ${esc(note.courseName || 'your last round')}</span><p>${esc(note.text)}</p></div>` : ''}
    <div class="ci-k">Before every shot</div>
    <ol class="ci-steps">${R.preshot.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <details class="ci-more"><summary>Between shots <span class="ci-n">${R.mind.length}</span></summary><ul>${R.mind.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>
    ${rules.length ? `<details class="ci-more"><summary>Round rules <span class="ci-n">${rules.length}</span></summary><div class="ci-rules">${rules.map((id) => `<span>${esc(SHORT[id] || RULES[id].label)}</span>`).join('')}</div></details>` : ''}
    ${R.custom ? '' : '<p class="mute small ci-ex">This is an example routine. Tap Edit to make it yours.</p>'}
  </div>`;
}

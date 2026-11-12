// The golfer's own game notes, edited where they're used rather than in Settings:
//   swingSheet — swing keys (shown in Practice) and the swing story the AI coach reads
//   planSheet  — the routine (before a round, a tap away on every hole), swing thought, and the
//                round rules checked after each round
import { getSettings, saveSettings } from './store.js';
import { RULES, DEFAULT_RULES } from './rounds/tiger.js';
import { getRoutine } from './rounds/routine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sheetShell(title, body, onSave) {
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet gamesheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${title}</b><button class="link" data-close>Cancel</button></div><form class="form">${body}<button class="btn primary big" type="submit">Save</button></form></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('form').onsubmit = (e) => { e.preventDefault(); onSave(e.target); sheet.remove(); };
  document.body.appendChild(sheet);
  return sheet;
}

export function swingSheet({ done = () => {} } = {}) {
  const s = getSettings();
  sheetShell('My swing', `
    <label>Swing keys
      <textarea name="keys" rows="9" placeholder="# Set-up&#10;- Hinge hips, not upright&#10;# Swing&#10;- Slow takeaway">${esc(s.keys || '')}</textarea>
      <span class="hint"># starts a section, - starts a key. Shown in Practice and used by the AI coach.</span></label>
    <label>Swing story <span class="hint">Sent with every AI review: your handicap, what you're working on, your usual miss.</span>
      <textarea name="golfer" rows="6" placeholder="e.g. 5 handicap. Used to sway; now working on getting to the left heel. Miss: block right.">${esc(s.golfer || '')}</textarea></label>`, (f) => {
    const st = getSettings(); st.keys = f.keys.value; st.golfer = f.golfer.value.trim(); saveSettings(st); done();
  });
}

export function planSheet({ done = () => {} } = {}) {
  const s = getSettings(); const R = getRoutine(s); const rt = s.routine || {};
  const on = new Set(s.roundRules || DEFAULT_RULES);
  sheetShell('My routine and round rules', `
    <label>Before every shot <span class="hint">One step per line. Shown before a round and a tap away on every hole.</span>
      <textarea name="pre" rows="6" placeholder="${esc(R.preshot.join('\n'))}">${esc(rt.preshot || '')}</textarea></label>
    <label>Between shots <span class="hint">What you say to yourself when it goes wrong, and when it goes right.</span>
      <textarea name="mind" rows="4" placeholder="${esc(R.mind.join('\n'))}">${esc(rt.mind || '')}</textarea></label>
    <label>Current swing thought <span class="hint">One. Offered at the start of each round.</span>
      <input name="thought" value="${esc(rt.swingThought || '')}" placeholder="e.g. finish on the left heel" /></label>
    <div class="lbl">Round rules <span class="mute">checked after every round</span></div>
    <div class="rulesbox">${Object.entries(RULES).map(([id, r]) => `<label class="check small"><input type="checkbox" data-rule="${id}" ${on.has(id) ? 'checked' : ''}/> ${esc(r.label)}</label>`).join('')}</div>`, (f) => {
    const st = getSettings();
    st.routine = { ...(st.routine || {}), preshot: f.pre.value.trim(), mind: f.mind.value.trim(), swingThought: f.thought.value.trim() };
    st.roundRules = [...f.querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule);
    saveSettings(st); done();
  });
}

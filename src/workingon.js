// "Range work": the few things you're working on right now, each with drills. Temporary by design:
// mark one fixed and it moves to your history. Lives on the Practice tab and is part of what the
// AI coach knows about you (so reviews check these points first).
import { getSettings, saveSettings } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// short names for the first imported list (later items get a title when added)
const SHORT = { w_conor1: 'Downswing & finish', w_conor2: 'Backswing', w_conor3: 'Compression', w_conor4: 'Shank', w_conor5: 'Grip' };
export const getWork = () => (getSettings().workingOn || []).map((w) => (w.title ? w : { ...w, title: SHORT[w.id] || '' }));
const saveWork = (list) => { const s = getSettings(); s.workingOn = list; saveSettings(s); };
export const activeWork = () => getWork().filter((w) => !w.done);

/** One paragraph for the AI coach. */
export function workContext() {
  const a = activeWork(), d = getWork().filter((w) => w.done).slice(0, 3);
  if (!a.length && !d.length) return '';
  return [
    a.length ? `What the golfer is working on right now (judge the swing against these first, and say plainly whether each is happening): ${a.map((w, i) => `${i + 1}) ${w.text}`).join(' ')}` : '',
    d.length ? `Recently fixed: ${d.map((w) => w.text).join('; ')}.` : '',
  ].filter(Boolean).join(' ');
}

export function renderWork(el, { toast = () => {} } = {}) {
  const list = getWork();
  const active = list.filter((w) => !w.done), done = list.filter((w) => w.done);
  el.innerHTML = `<div class="card workcard">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Range work</h2><button class="link acc" data-wadd>+ Add</button></div>
    <p class="mute small" style="margin:0 0 8px">What you're working on right now. Take these to the range. Mark one fixed when it's grooved.</p>
    ${active.length ? active.map((w) => `<details class="witem"><summary><span class="wt"><b>${esc(w.title || w.text)}</b><span class="mute small">${w.drills?.length ? `${w.drills.length} drill${w.drills.length > 1 ? 's' : ''}` : 'no drills'}</span></span></summary>
      ${w.title ? `<p class="small" style="margin:6px 0 2px"><b>${esc(w.text)}</b></p>` : ''}
      ${w.why ? `<p class="small mute" style="margin:2px 0 6px">${esc(w.why)}</p>` : ''}
      ${(w.drills || []).map((d) => `<div class="drillrow"><b>${esc(d.name)}</b><span class="small">${esc(d.how)}</span>${d.reps ? `<span class="mute small">${esc(d.reps)}</span>` : ''}</div>`).join('')}
      <div class="row" style="margin-top:8px"><button class="btn" data-wdone="${w.id}">Fixed ✓</button><button class="btn" data-wedit="${w.id}">Edit</button></div>
    </details>`).join('') : '<p class="mute small">Nothing on the list. Add what your coach (or the AI coach) has you working on.</p>'}
    ${done.length ? `<details class="wdone"><summary class="mute small">Fixed (${done.length})</summary>${done.map((w) => `<div class="tagrow"><span>✓ ${esc(w.title || w.text)} <span class="mute small">${new Date(w.done).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></span><button class="link" data-wback="${w.id}">back on</button></div>`).join('')}</details>` : ''}
  </div>`;
  const redraw = () => renderWork(el, { toast });
  el.querySelectorAll('[data-wdone]').forEach((b) => b.onclick = () => { saveWork(getWork().map((w) => (w.id === b.dataset.wdone ? { ...w, done: Date.now() } : w))); toast('Nice. Moved to fixed.'); redraw(); });
  el.querySelectorAll('[data-wback]').forEach((b) => b.onclick = () => { saveWork(getWork().map((w) => (w.id === b.dataset.wback ? { ...w, done: null } : w))); redraw(); });
  el.querySelector('[data-wadd]').onclick = () => editSheet(null, redraw);
  el.querySelectorAll('[data-wedit]').forEach((b) => b.onclick = () => editSheet(getWork().find((w) => w.id === b.dataset.wedit), redraw));
}

export function editWorkSheet(w, done) { return editSheet(w, done); }
/** Add a point to Range work (the coach does this when the golfer agrees a focus). Returns it. */
export function addWork({ title = '', text = '', why = '', drills = [] } = {}, { from = 'coach' } = {}) {
  const w = { id: uid(), title: String(title).trim().slice(0, 60), text: String(text || title).trim(), why: String(why || '').trim(), drills: (Array.isArray(drills) ? drills : []).slice(0, 5).map((d) => ({ name: String(d?.name || '').trim(), how: String(d?.how || '').trim(), reps: String(d?.reps || '').trim() })).filter((d) => d.name), from, at: Date.now() };
  if (!w.text) return null;
  saveWork([w, ...getWork()]);
  return w;
}
export const markWorkDone = (id, done = true) => saveWork(getWork().map((w) => (w.id === id ? { ...w, done: done ? Date.now() : null } : w)));
function editSheet(w, done) {
  const x = w ? { ...w } : { id: uid(), text: '', why: '', drills: [], since: Date.now(), done: null };
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in">
    <div class="sheet-h"><b>${w ? 'Edit' : 'Add'} range work</b><button class="link" data-close>Cancel</button></div>
    <label class="field-label">Short name</label><input data-n value="${esc(x.title || '')}" placeholder="e.g. Backswing" />
    <label class="field-label">What you're working on</label><input data-t value="${esc(x.text)}" placeholder="e.g. Finish on the left heel, not the toes" />
    <label class="field-label">Why (optional)</label><input data-y value="${esc(x.why || '')}" placeholder="e.g. weight goes to the toes, so no compression" />
    <label class="field-label">Drills, one per line: name: how (reps)</label>
    <textarea data-d rows="5" placeholder="Walk-through: hit and step the right foot past the left (10 balls)">${esc((x.drills || []).map((d) => `${d.name}: ${d.how}${d.reps ? ` (${d.reps})` : ''}`).join('\n'))}</textarea>
    <button class="btn primary big" data-ok>Save</button>
    ${w ? '<button class="link" data-del style="margin-top:10px;color:var(--work)">Delete</button>' : ''}</div>`;
  const parse = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:]+):\s*(.*?)(?:\s*\(([^)]*)\))?$/);
    return m ? { name: m[1].trim(), how: m[2].trim(), reps: m[3] || '' } : { name: l, how: '', reps: '' };
  });
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-del]')?.addEventListener('click', () => { saveWork(getWork().filter((y) => y.id !== x.id)); sheet.remove(); done(); });
  sheet.querySelector('[data-ok]').onclick = () => {
    x.text = sheet.querySelector('[data-t]').value.trim(); if (!x.text) return;
    x.title = sheet.querySelector('[data-n]').value.trim() || x.text.split(/[:,(]/)[0].trim().slice(0, 28);
    x.why = sheet.querySelector('[data-y]').value.trim(); x.drills = parse(sheet.querySelector('[data-d]').value);
    const list = getWork(); const i = list.findIndex((y) => y.id === x.id);
    if (i >= 0) list[i] = x; else list.unshift(x);
    saveWork(list); sheet.remove(); done();
  };
  document.body.appendChild(sheet);
}

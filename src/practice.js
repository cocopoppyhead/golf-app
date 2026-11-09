// Practice sessions: a weekly plan (how many sessions, split across range / short game / putting)
// and a log of what you actually did, tied to your Range work items and their drills.
// The AI coach sees the log, so "what to work on" meets "what you've been working on".
import { getSettings, saveSettings, listSessions, putSession, deleteSession } from './store.js';
import { activeWork } from './workingon.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => `ps_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const WHERE = [['range', 'Range'], ['short', 'Short game'], ['putting', 'Putting'], ['course', 'On course'], ['home', 'At home']];
const WL = Object.fromEntries(WHERE);
const DEFAULT_PLAN = { perWeek: 3, split: { range: 1, short: 1, putting: 1 } };
export const getPlan = () => ({ ...DEFAULT_PLAN, ...(getSettings().practicePlan || {}), split: { ...DEFAULT_PLAN.split, ...(getSettings().practicePlan?.split || {}) } });
const savePlan = (p) => { const s = getSettings(); s.practicePlan = p; saveSettings(s); };

// Monday-based week
const weekStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const fmt = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** A paragraph for the AI coach: the plan and the last two weeks of sessions. */
export async function practiceContext() {
  const all = await listSessions().catch(() => []);
  const cut = Date.now() - 14 * 86400e3;
  const recent = all.filter((s) => s.date >= cut);
  const P = getPlan();
  if (!recent.length) return `Practice plan: ${P.perWeek} sessions a week. No sessions logged in the last two weeks.`;
  const lines = recent.slice(0, 8).map((s) => `${new Date(s.date).toLocaleDateString()} ${WL[s.where] || s.where}${s.minutes ? ` ${s.minutes} min` : ''}: ${(s.items || []).map((it) => `${it.title}${it.drills?.length ? ` (${it.drills.filter((d) => d.done).map((d) => `${d.name}${d.reps ? ` ${d.reps}` : ''}`).join(', ')})` : ''}`).join('; ') || 'general'}${s.feel ? `, felt ${s.feel}/10` : ''}${s.note ? `, note: "${s.note}"` : ''}`);
  return `Practice plan: ${P.perWeek} sessions a week (range ${P.split.range}, short game ${P.split.short}, putting ${P.split.putting}). Last two weeks (${recent.length} sessions):\n${lines.join('\n')}`;
}

export async function renderPracticeLog(el, { toast = () => {} } = {}) {
  const all = await listSessions().catch(() => []);
  const P = getPlan();
  const ws = weekStart();
  const week = all.filter((s) => s.date >= ws);
  const byWhere = (list, w) => list.filter((s) => s.where === w).length;
  // last 8 weeks, oldest → newest
  const weeks = Array.from({ length: 8 }, (_, i) => { const a = ws - (7 - i) * 7 * 86400e3; return all.filter((s) => s.date >= a && s.date < a + 7 * 86400e3).length; });
  const slots = ['range', 'short', 'putting'].flatMap((w) => Array.from({ length: P.split[w] || 0 }, (_, k) => ({ w, on: byWhere(week, w) > k })));
  const extra = Math.max(0, P.perWeek - slots.length);
  const otherDone = week.length - slots.filter((x) => x.on).length;
  for (let k = 0; k < extra; k++) slots.push({ w: 'any', on: otherDone > k });
  const done = Math.min(week.length, P.perWeek);
  el.innerHTML = `<div class="card">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Practice</h2><button class="link" data-plan>Plan</button></div>
    <p class="mute small" style="margin:0 0 8px">This week: <b class="${done >= P.perWeek ? 'goodc' : ''}">${week.length} of ${P.perWeek}</b> sessions${week.length > P.perWeek ? ' (and then some)' : ''}.</p>
    <div class="slots">${slots.map((s) => `<span class="slot ${s.on ? 'on' : ''}">${s.w === 'any' ? 'Any' : WL[s.w]}</span>`).join('')}</div>
    <div class="wkbars">${weeks.map((n, i) => `<i title="${n} sessions" style="height:${n ? 15 + Math.min(85, (n / Math.max(P.perWeek, 1)) * 85) : 4}%" class="${n >= P.perWeek ? 'on' : ''}"></i>`).join('')}</div>
    <p class="mute small" style="margin:2px 0 8px">Sessions a week, last 8 weeks.</p>
    <button class="btn primary" data-log style="width:100%">+ Log a session</button>
    ${all.length ? `<details class="plog" style="margin-top:8px"><summary class="mute small">Recent sessions (${all.length})</summary>
      ${all.slice(0, 10).map((s) => `<div class="tagrow" data-open="${s.id}"><span><b>${WL[s.where] || esc(s.where)}</b> · ${fmt(s.date)}${s.minutes ? ` · ${s.minutes} min` : ''}<div class="mute small">${(s.items || []).map((it) => esc(it.title)).join(', ') || 'general practice'}${s.feel ? ` · felt ${s.feel}/10` : ''}</div></span><span class="mute">›</span></div>`).join('')}</details>` : ''}
  </div>`;
  const redraw = () => renderPracticeLog(el, { toast });
  el.querySelector('[data-log]').onclick = () => sessionSheet(null, redraw, toast);
  el.querySelector('[data-plan]').onclick = () => planSheet(redraw);
  el.querySelectorAll('[data-open]').forEach((r) => r.onclick = () => sessionSheet(all.find((s) => s.id === r.dataset.open), redraw, toast));
}

function planSheet(done) {
  const P = getPlan();
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const total = ['range', 'short', 'putting'].reduce((a, k) => a + (P.split[k] || 0), 0);
    if (P.perWeek < total) P.perWeek = total;
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Practice plan</b><button class="link" data-close>Cancel</button></div>
      <p class="mute small">How often, and where the time goes. Short game and putting are where most strokes hide for club golfers; the range is where swing changes get grooved.</p>
      <div class="prow2"><span>Sessions a week</span><div class="step"><button data-k="perWeek" data-d="-1">−</button><span>${P.perWeek}</span><button data-k="perWeek" data-d="1">+</button></div></div>
      ${['range', 'short', 'putting'].map((k) => `<div class="prow2"><span>${WL[k]}</span><div class="step sm"><button data-s="${k}" data-d="-1">−</button><span>${P.split[k] || 0}</span><button data-s="${k}" data-d="1">+</button></div></div>`).join('')}
      ${P.perWeek > total ? `<p class="mute small">${P.perWeek - total} session${P.perWeek - total > 1 ? 's' : ''} a week left open: whatever you feel like.</p>` : ''}
      <button class="btn primary big" data-ok>Save plan</button></div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { P.perWeek = Math.max(0, Math.min(14, P.perWeek + +b.dataset.d)); draw(); });
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { P.split[b.dataset.s] = Math.max(0, Math.min(7, (P.split[b.dataset.s] || 0) + +b.dataset.d)); draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-ok]').onclick = () => { savePlan(P); sheet.remove(); done(); };
  };
  draw(); document.body.appendChild(sheet);
}

function sessionSheet(existing, done, toast) {
  const work = activeWork();
  const s = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), date: Date.now(), where: 'range', minutes: 45, items: [], feel: null, note: '' };
  // one item per range-work point, so drills can be ticked; items not from range work are free text
  const itemFor = (w) => s.items.find((it) => it.workId === w.id);
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${existing ? 'Session' : 'Log a session'}</b><button class="link" data-close>Cancel</button></div>
      <div class="clubchips">${WHERE.map(([v, l]) => `<button class="${s.where === v ? 'on' : ''}" data-w="${v}">${l}</button>`).join('')}</div>
      <div class="row" style="margin:8px 0"><label class="small mute" style="flex:1">Date<input type="date" data-date value="${new Date(s.date).toISOString().slice(0, 10)}" /></label><label class="small mute" style="flex:1">Minutes<input inputmode="numeric" data-min value="${s.minutes ?? ''}" /></label></div>
      <div class="lbl">What you worked on</div>
      ${work.length ? work.map((w) => { const it = itemFor(w); return `<div class="sitem ${it ? 'on' : ''}"><label class="check"><input type="checkbox" data-wk="${w.id}" ${it ? 'checked' : ''}/> <b>${esc(w.title || w.text)}</b></label>
        ${it && w.drills?.length ? `<div class="drills">${w.drills.map((d, k) => { const dd = it.drills?.[k] || {}; return `<label class="check mini"><input type="checkbox" data-dr="${w.id}:${k}" ${dd.done ? 'checked' : ''}/> ${esc(d.name)} <span class="mute">${esc(d.reps || '')}</span></label>`; }).join('')}</div>` : ''}</div>`; }).join('') : '<p class="mute small">No Range work points yet. Add them above and they show here with their drills.</p>'}
      <label class="small mute">Anything else<input data-other placeholder="e.g. 30 balls wedges to 60/80/100" value="${esc(s.items.find((it) => !it.workId)?.title || '')}" /></label>
      <div class="lbl">How did it feel? <span class="mute">1 scrappy · 10 flushed</span></div>
      <div class="seg10">${Array.from({ length: 10 }, (_, i) => `<button class="${s.feel === i + 1 ? 'on' : ''}" data-feel="${i + 1}">${i + 1}</button>`).join('')}</div>
      <label class="small mute">Note<input data-note placeholder="e.g. weight finally on the left heel" value="${esc(s.note || '')}" /></label>
      <button class="btn primary big" data-ok style="margin-top:10px">Save session</button>
      ${existing ? '<button class="link" data-del style="margin-top:10px;color:var(--work)">Delete</button>' : ''}</div>`;
    const read = () => {
      s.minutes = +sheet.querySelector('[data-min]').value || null; s.note = sheet.querySelector('[data-note]').value.trim();
      const dv = sheet.querySelector('[data-date]').value; if (dv) s.date = new Date(`${dv}T12:00:00`).getTime();
      const other = sheet.querySelector('[data-other]').value.trim();
      s.items = s.items.filter((it) => it.workId); if (other) s.items.push({ workId: null, title: other, drills: [] });
    };
    sheet.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { read(); s.where = b.dataset.w; draw(); });
    sheet.querySelectorAll('[data-feel]').forEach((b) => b.onclick = () => { read(); s.feel = s.feel === +b.dataset.feel ? null : +b.dataset.feel; draw(); });
    sheet.querySelectorAll('[data-wk]').forEach((c) => c.onchange = () => {
      read(); const w = work.find((x) => x.id === c.dataset.wk);
      if (c.checked) s.items.push({ workId: w.id, title: w.title || w.text, drills: (w.drills || []).map((d) => ({ name: d.name, reps: d.reps || '', done: false })) });
      else s.items = s.items.filter((it) => it.workId !== w.id);
      draw();
    });
    sheet.querySelectorAll('[data-dr]').forEach((c) => c.onchange = () => { const [wid, k] = c.dataset.dr.split(':'); const it = s.items.find((x) => x.workId === wid); if (it?.drills?.[+k]) it.drills[+k].done = c.checked; });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-del]')?.addEventListener('click', async () => { await deleteSession(s.id); sheet.remove(); done(); });
    sheet.querySelector('[data-ok]').onclick = async () => { read(); await putSession(s); sheet.remove(); toast(existing ? 'Session updated.' : 'Session logged.'); done(); };
  };
  draw(); document.body.appendChild(sheet);
}

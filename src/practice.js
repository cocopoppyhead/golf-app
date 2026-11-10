// Practice sessions. A session has a duration, places (range / short game / putting…) and items, and
// every item has an intent that gets logged, so practice is consequential:
//   score    – a library drill with its own number (makes out of 12, strokes vs par 18…)
//   attempts – a goal: "10 in a row at the 150 green", "3 fades, 3 draws, 3 straight" → how many
//              attempts it took, and why the misses happened. The number should fall with practice.
//   reps     – rep work on a swing point ("30 balls on the backswing") → reps done and a 1–10 rating.
// Sessions can be planned for later, repeated weekly and sent to a calendar. Finishing a session asks
// for a 1–10 rating and a note. Everything feeds Progress and the AI coach.
import { getSettings, saveSettings, listSessions, putSession, deleteSession } from './store.js';
import { activeWork, editWorkSheet } from './workingon.js';
import { openLibrary } from './drills.js';
import { calendarSheet as calSheet } from './calendar.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p = 'ps') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const WHERE = [['range', 'Range'], ['short', 'Short game'], ['putting', 'Putting'], ['course', 'On course'], ['home', 'At home']];
const WL = Object.fromEntries(WHERE);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const FAILS = [['THN', 'Thin'], ['FAT', 'Fat'], ['TOE', 'Toe'], ['HEL', 'Heel'], ['PUL', 'Pull'], ['PUS', 'Push'], ['HK', 'Hook'], ['SL', 'Slice'], ['SHT', 'Short'], ['LNG', 'Long'], ['RSH', 'Rushed'], ['DEC', 'Decision']];
const FL = Object.fromEntries(FAILS);
const DEFAULT_PLAN = { perWeek: 3, split: { range: 1, short: 1, putting: 1 } };
export const getPlan = () => ({ ...DEFAULT_PLAN, ...(getSettings().practicePlan || {}), split: { ...DEFAULT_PLAN.split, ...(getSettings().practicePlan?.split || {}) } });
const savePlan = (p) => { const s = getSettings(); s.practicePlan = p; saveSettings(s); };
const changed = () => window.dispatchEvent(new CustomEvent('practice-changed'));

const weekStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmt = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dayStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const whereText = (s) => (s.where || []).map((w) => WL[w] || w).join(' · ') || 'Practice';
const isDone = (s) => s.status === 'done' || (!s.status && s.date); // sessions logged before planning existed
const isPlanned = (s) => s.status === 'planned';
const isActive = (s) => s.status === 'active';
/** Old sessions had where as a string. */
const norm = (s) => ({ ...s, where: Array.isArray(s.where) ? s.where : s.where ? [s.where] : [], items: s.items || [] });

const itemLine = (it) => {
  if (it.mode === 'score') return it.score != null ? `${it.score}${it.of ? `/${it.of}` : ''}` : null;
  if (it.mode === 'attempts') return it.attempts != null ? `${it.attempts} attempt${it.attempts === 1 ? '' : 's'}${it.achieved === false ? ' (not there yet)' : ''}` : null;
  if (it.mode === 'reps') return it.repsDone != null ? `${it.repsDone} reps${it.rating ? ` · ${it.rating}/10` : ''}` : null;
  return null;
};
const itemTarget = (it) => {
  if (it.mode === 'attempts') return `${it.target?.n || '?'}${it.target?.consecutive ? ' in a row' : ' successes'}`;
  if (it.mode === 'reps') return `${it.target?.n || '?'} reps`;
  if (it.mode === 'score') return it.of ? `out of ${it.of}` : 'score';
  return '';
};

/** A paragraph for the AI coach: plan, and the last two weeks of sessions with what was logged. */
export async function practiceContext() {
  const all = (await listSessions().catch(() => [])).map(norm).filter(isDone);
  const cut = Date.now() - 14 * 86400e3;
  const recent = all.filter((s) => s.date >= cut);
  const P = getPlan();
  if (!recent.length) return `Practice plan: ${P.perWeek} sessions a week. No sessions logged in the last two weeks.`;
  const lines = recent.slice(0, 8).map((s) => `${new Date(s.date).toLocaleDateString()} ${whereText(s)}${s.minutes ? ` ${s.minutes} min` : ''}${s.rating ? `, rated ${s.rating}/10` : ''}: ${s.items.map((it) => `${it.title} [${itemTarget(it)}${itemLine(it) ? ` → ${itemLine(it)}` : ', not logged'}${it.fails?.length ? `, misses: ${it.fails.map((f) => FL[f] || f).join('/')}` : ''}]`).join('; ') || 'general'}${s.note ? `, note: "${s.note}"` : ''}`);
  return `Practice plan: ${P.perWeek} sessions a week (range ${P.split.range}, short game ${P.split.short}, putting ${P.split.putting}). Last two weeks (${recent.length} sessions):\n${lines.join('\n')}`;
}

// ---------------- Practice card ----------------
export async function renderPracticeLog(el, { toast = () => {} } = {}) {
  const all = (await listSessions().catch(() => [])).map(norm);
  const active = all.find(isActive);
  const planned = all.filter(isPlanned).sort((a, b) => (a.date || 0) - (b.date || 0));
  const done = all.filter(isDone).sort((a, b) => b.date - a.date);
  const P = getPlan();
  const ws = weekStart();
  const week = done.filter((s) => s.date >= ws);
  const weeks = Array.from({ length: 8 }, (_, i) => { const a = ws - (7 - i) * 7 * 86400e3; return done.filter((s) => s.date >= a && s.date < a + 7 * 86400e3).length; });
  const work = activeWork();
  const redraw = () => renderPracticeLog(el, { toast });

  el.innerHTML = `<div class="card">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Practice</h2><button class="link" data-plan>Weekly plan</button></div>
    <p class="mute small" style="margin:0 0 8px">This week: <b class="${week.length >= P.perWeek ? 'goodc' : ''}">${week.length} of ${P.perWeek}</b> sessions. Every session has things to work on, and each one gets logged.</p>
    <div class="wkbars">${weeks.map((n) => `<i title="${n} sessions" style="height:${n ? 15 + Math.min(85, (n / Math.max(P.perWeek, 1)) * 85) : 4}%" class="${n >= P.perWeek ? 'on' : ''}"></i>`).join('')}</div>
    <p class="mute small" style="margin:2px 0 10px">Sessions a week, last 8 weeks.</p>

    ${active ? `<div class="activesess">
      <div class="sechead" style="margin:0 0 4px"><b>In progress · ${esc(whereText(active))}${active.minutes ? ` · ${active.minutes} min` : ''}</b><button class="link" data-edit="${active.id}">Edit</button></div>
      ${active.items.length ? active.items.map((it, i) => `<button class="sitemrow ${itemLine(it) ? 'done' : ''}" data-logit="${i}"><span class="mode">${it.mode === 'score' ? '🎯' : it.mode === 'attempts' ? '🔁' : '🔨'}</span><span class="sit"><b>${esc(it.title)}</b><span class="mute small">${esc(itemTarget(it))}</span></span><span class="sres">${itemLine(it) ? esc(itemLine(it)) : '<span class="acc">Log ›</span>'}</span></button>`).join('') : '<p class="mute small">No items yet. Edit the session to add drills, goals or rep work.</p>'}
      <button class="btn primary big" data-finish="${active.id}" style="margin-top:8px">Finish session</button>
    </div>` : `<button class="btn primary big" data-new>+ New session</button>`}

    ${planned.length ? `<div class="lbl" style="margin-top:12px">Planned</div>${planned.map((s) => `<div class="planrow"><span><b>${esc(s.title || whereText(s))}</b><span class="mute small">${s.repeat === 'weekly' ? `Every ${DAYS[s.weekday ?? 0]}` : s.date ? fmt(s.date) : 'Saved for later'}${s.minutes ? ` · ${s.minutes} min` : ''} · ${s.items.length} item${s.items.length === 1 ? '' : 's'}</span></span><span class="row" style="gap:4px"><button class="btn sm" data-start="${s.id}">Start</button><button class="btn sm" data-edit="${s.id}">Edit</button></span></div>`).join('')}` : ''}

    <div class="sechead" style="margin:12px 0 2px"><span class="lbl" style="margin:0">Working on</span><button class="link" data-wadd>+ Add</button></div>
    ${work.length ? `<div class="workchips">${work.map((w) => `<button class="chip" data-wedit="${w.id}">${esc(w.title || w.text)}${w.drills?.length ? ` <small>${w.drills.length}</small>` : ''}</button>`).join('')}</div>` : '<p class="mute small">Swing points from your coach or the AI coach. Pull them into sessions as rep work.</p>'}

    ${done.length ? `<details class="plog" style="margin-top:10px"><summary class="mute small">Past sessions (${done.length})</summary>
      ${done.slice(0, 12).map((s) => `<div class="tagrow" data-open="${s.id}"><span><b>${esc(s.title || whereText(s))}</b> · ${fmt(s.date)}${s.minutes ? ` · ${s.minutes} min` : ''}${s.rating ? ` · <b class="${s.rating >= 7 ? 'goodc' : s.rating <= 4 ? 'workc' : ''}">${s.rating}/10</b>` : ''}<div class="mute small">${s.items.map((it) => esc(it.title) + (itemLine(it) ? ` ${esc(itemLine(it))}` : '')).join(', ') || 'general practice'}</div></span><span class="mute">›</span></div>`).join('')}</details>` : ''}
  </div>`;

  el.querySelector('[data-plan]').onclick = () => planSheet(redraw);
  el.querySelector('[data-new]')?.addEventListener('click', () => sessionPlanner(null, { toast, done: redraw }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => sessionPlanner(all.find((s) => s.id === b.dataset.edit), { toast, done: redraw }));
  el.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => startSession(all.find((s) => s.id === b.dataset.start), { toast, done: redraw }));
  el.querySelectorAll('[data-logit]').forEach((b) => b.onclick = () => logItemSheet(active, +b.dataset.logit, { toast, done: redraw }));
  el.querySelector('[data-finish]')?.addEventListener('click', () => finishSheet(active, { toast, done: redraw }));
  el.querySelector('[data-wadd]').onclick = () => editWorkSheet(null, redraw);
  el.querySelectorAll('[data-wedit]').forEach((b) => b.onclick = () => editWorkSheet(activeWork().find((w) => w.id === b.dataset.wedit), redraw));
  el.querySelectorAll('[data-open]').forEach((r) => r.onclick = () => reviewSheet(all.find((s) => s.id === r.dataset.open), { toast, done: redraw }));
}

// ---------------- Weekly plan ----------------
function planSheet(done) {
  const P = getPlan();
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const total = ['range', 'short', 'putting'].reduce((a, k) => a + (P.split[k] || 0), 0);
    if (P.perWeek < total) P.perWeek = total;
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Weekly plan</b><button class="link" data-close>Cancel</button></div>
      <p class="mute small">How often, and where the time goes. Short game and putting are where most strokes hide; the range is where swing changes get grooved.</p>
      <div class="prow2"><span>Sessions a week</span><div class="step"><button data-k="perWeek" data-d="-1">−</button><span>${P.perWeek}</span><button data-k="perWeek" data-d="1">+</button></div></div>
      ${['range', 'short', 'putting'].map((k) => `<div class="prow2"><span>${WL[k]}</span><div class="step sm"><button data-s="${k}" data-d="-1">−</button><span>${P.split[k] || 0}</span><button data-s="${k}" data-d="1">+</button></div></div>`).join('')}
      <button class="btn primary big" data-ok>Save plan</button></div>`;
    sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { P.perWeek = Math.max(0, Math.min(14, P.perWeek + +b.dataset.d)); draw(); });
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { P.split[b.dataset.s] = Math.max(0, Math.min(7, (P.split[b.dataset.s] || 0) + +b.dataset.d)); draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-ok]').onclick = () => { savePlan(P); sheet.remove(); done(); };
  };
  draw(); document.body.appendChild(sheet);
}

// ---------------- Session planner ----------------
/** Full-screen planner: when, how long, where, and the items (drills, goals, rep work). Save for later or start now. */
export function sessionPlanner(existing, { toast = () => {}, done = () => {} } = {}) {
  const s = existing ? norm(JSON.parse(JSON.stringify(existing))) : { id: uid(), status: 'planned', createdAt: Date.now(), date: null, when: 'today', repeat: null, weekday: (new Date().getDay() + 6) % 7, title: '', minutes: 45, where: ['range'], items: [], rating: null, note: '' };
  if (!s.when) s.when = s.repeat === 'weekly' ? 'weekly' : s.date && s.date > Date.now() + 36e5 ? 'date' : s.status === 'planned' && !s.date ? 'later' : 'today';
  const el = document.createElement('div'); el.className = 'onb planner';
  const draw = () => {
    el.innerHTML = `<div class="onb-in">
      <div class="onb-top"><h2 style="margin:0">${existing ? 'Session' : 'New session'}</h2><button class="link" data-close>Cancel</button></div>
      <label class="small mute">Name <span class="mute">(optional)</span><input data-title value="${esc(s.title)}" placeholder="e.g. Tuesday wedges + putting" /></label>
      <div class="lbl">When</div>
      <div class="seg4 mini">${[['today', 'Today'], ['date', 'Pick a day'], ['weekly', 'Every week'], ['later', 'Save for later']].map(([v, l]) => `<button class="${s.when === v ? 'on' : ''}" data-when="${v}">${l}</button>`).join('')}</div>
      ${s.when === 'date' ? `<input type="date" data-date value="${s.date ? dayStr(s.date) : dayStr(Date.now())}" min="${dayStr(Date.now())}" style="margin-top:6px" />` : ''}
      ${s.when === 'weekly' ? `<div class="seg7 mini" style="margin-top:6px">${DAYS.map((d, i) => `<button class="${s.weekday === i ? 'on' : ''}" data-wd="${i}">${d}</button>`).join('')}</div>` : ''}
      <div class="row" style="margin:8px 0"><label class="small mute" style="flex:1">Minutes<input inputmode="numeric" data-min value="${s.minutes ?? ''}" /></label></div>
      <div class="lbl">Where</div>
      <div class="clubchips">${WHERE.map(([v, l]) => `<button class="${s.where.includes(v) ? 'on' : ''}" data-w="${v}">${l}</button>`).join('')}</div>
      <div class="lbl" style="margin-top:10px">What you'll do <span class="mute">(${s.items.length})</span></div>
      ${s.items.map((it, i) => `<div class="pitem"><span class="mode">${it.mode === 'score' ? '🎯' : it.mode === 'attempts' ? '🔁' : '🔨'}</span><span class="sit"><b>${esc(it.title)}</b><span class="mute small">${esc(itemTarget(it))}${it.minutes ? ` · ${it.minutes} min` : ''}</span></span><span class="row" style="gap:2px"><button class="link" data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button><button class="link" data-rm="${i}">✕</button></span></div>`).join('')}
      <div class="addrow">
        <button class="btn" data-add="drill">+ Drill</button>
        <button class="btn" data-add="attempts">+ Goal</button>
        <button class="btn" data-add="reps">+ Rep work</button>
      </div>
      <p class="mute small" style="margin:6px 0 12px"><b>Drill</b>: a library drill with its own score. <b>Goal</b>: something to achieve, logged as how many attempts it took ("10 in a row at the 150 green", "3 fades, 3 draws, 3 straight"). <b>Rep work</b>: balls on a swing point, logged as reps and a 1–10.</p>
      <div class="row">
        ${s.when === 'today' ? `<button class="btn primary big" data-startnow style="flex:2">Start now</button><button class="btn big" data-save style="flex:1">Save</button>` : `<button class="btn primary big" data-save style="flex:1">Save session</button>`}
      </div>
      ${s.when === 'weekly' || s.when === 'date' ? `<button class="btn" data-cal style="width:100%;margin-top:8px">${icon('calendar')} Add to calendar</button>` : ''}
      ${existing ? '<button class="link" data-del style="margin-top:12px;color:var(--work)">Delete session</button>' : ''}
    </div>`;
    const read = () => {
      s.title = el.querySelector('[data-title]').value.trim(); s.minutes = +el.querySelector('[data-min]').value || null;
      const d = el.querySelector('[data-date]'); if (d && d.value) s.date = new Date(`${d.value}T09:00:00`).getTime();
    };
    el.querySelector('[data-close]').onclick = () => el.remove();
    el.querySelectorAll('[data-when]').forEach((b) => b.onclick = () => { read(); s.when = b.dataset.when; s.repeat = s.when === 'weekly' ? 'weekly' : null; if (s.when === 'date' && !s.date) s.date = Date.now() + 86400e3; draw(); });
    el.querySelectorAll('[data-wd]').forEach((b) => b.onclick = () => { read(); s.weekday = +b.dataset.wd; draw(); });
    el.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { read(); const v = b.dataset.w; s.where = s.where.includes(v) ? s.where.filter((x) => x !== v) : [...s.where, v]; draw(); });
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { read(); s.items.splice(+b.dataset.rm, 1); draw(); });
    el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { read(); const i = +b.dataset.up; [s.items[i - 1], s.items[i]] = [s.items[i], s.items[i - 1]]; draw(); });
    el.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
      read();
      const kind = b.dataset.add;
      if (kind === 'drill') return openLibrary({ toast, onPick: (d) => { s.items.push({ id: uid('it'), mode: 'score', title: d.name, drillId: d.id, of: d.metric.of || null, score: null }); if (!s.where.length) s.where = [({ putting: 'putting', chipping: 'short', wedges: 'short', bunker: 'short' })[d.area] || 'range']; draw(); } });
      itemSheet(kind, null, (it) => { s.items.push(it); draw(); });
    });
    const persist = async (status) => {
      read();
      if (s.when === 'today') s.date = s.date && s.date >= dayStart() ? s.date : Date.now();
      if (s.when === 'later') s.date = null;
      if (s.when === 'weekly') { s.repeat = 'weekly'; s.date = null; }
      s.status = status;
      await putSession(s);
    };
    el.querySelector('[data-save]').onclick = async () => { await persist(s.status === 'active' ? 'active' : 'planned'); el.remove(); toast('Session saved.'); changed(); done(); };
    el.querySelector('[data-startnow]')?.addEventListener('click', async () => { await persist('planned'); el.remove(); startSession(s, { toast, done }); });
    el.querySelector('[data-cal]')?.addEventListener('click', () => { read(); calendarSheet(s); });
    el.querySelector('[data-del]')?.addEventListener('click', async () => { await deleteSession(s.id); el.remove(); changed(); done(); });
  };
  draw(); document.body.appendChild(el);
}

/** Goal or rep-work item. */
function itemSheet(mode, existing, onDone) {
  const it = existing ? { ...existing } : mode === 'attempts'
    ? { id: uid('it'), mode: 'attempts', title: '', target: { n: 10, consecutive: true }, attempts: null, achieved: null, fails: [], minutes: null }
    : { id: uid('it'), mode: 'reps', title: '', workId: null, target: { n: 30 }, repsDone: null, rating: null, minutes: null };
  const work = activeWork();
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${mode === 'attempts' ? 'Goal' : 'Rep work'}</b><button class="link" data-close>Cancel</button></div>
      ${mode === 'attempts' ? `
        <p class="mute small">Something to achieve. You'll log how many attempts it took; the number should come down.</p>
        <div class="clubchips">${['10 in a row at the 150 green', '3 fades, 3 draws, 3 straight', '5 up-and-downs in a row', '20 three-footers in a row', '5 drives in a row in the fairway window'].map((t) => `<button class="${it.title === t ? 'on' : ''}" data-preset="${esc(t)}">${t}</button>`).join('')}</div>
        <label class="small mute">The goal<input data-title value="${esc(it.title)}" placeholder="e.g. 10 in a row at the 150 green" /></label>
        <div class="row" style="margin-top:6px"><label class="small mute" style="flex:1">Successes needed<input inputmode="numeric" data-n value="${it.target.n}" /></label>
          <div class="seg seg2 mini" style="flex:1.4;align-self:end"><button class="${it.target.consecutive ? 'on' : ''}" data-cons="1">In a row</button><button class="${!it.target.consecutive ? 'on' : ''}" data-cons="0">In total</button></div></div>`
      : `
        <p class="mute small">Balls on a swing point. You'll log reps done and how well it went, 1–10.</p>
        ${work.length ? `<div class="lbl">From what you're working on</div><div class="clubchips">${work.map((w) => `<button class="${it.workId === w.id ? 'on' : ''}" data-work="${w.id}">${esc(w.title || w.text)}</button>`).join('')}</div>` : ''}
        <label class="small mute">What<input data-title value="${esc(it.title)}" placeholder="e.g. Backswing: shorter, left arm straight" /></label>
        <label class="small mute" style="margin-top:6px">Reps (balls)<input inputmode="numeric" data-n value="${it.target.n}" /></label>`}
      <label class="small mute" style="margin-top:6px">Minutes <span class="mute">(optional)</span><input inputmode="numeric" data-min value="${it.minutes ?? ''}" /></label>
      <button class="btn primary big" data-ok style="margin-top:10px">${existing ? 'Save' : 'Add to session'}</button></div>`;
    const read = () => { it.title = sheet.querySelector('[data-title]').value.trim(); it.target.n = +sheet.querySelector('[data-n]').value || it.target.n; it.minutes = +sheet.querySelector('[data-min]').value || null; };
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { read(); it.title = b.dataset.preset; const m = it.title.match(/^(\d+)/); if (m) it.target.n = +m[1]; it.target.consecutive = /in a row/.test(it.title); if (/fades|draws/.test(it.title)) { it.target.n = 9; it.target.consecutive = false; } draw(); });
    sheet.querySelectorAll('[data-cons]').forEach((b) => b.onclick = () => { read(); it.target.consecutive = b.dataset.cons === '1'; draw(); });
    sheet.querySelectorAll('[data-work]').forEach((b) => b.onclick = () => { read(); const w = work.find((x) => x.id === b.dataset.work); it.workId = it.workId === w.id ? null : w.id; if (it.workId) it.title = w.title && w.text ? `${w.title}: ${w.text}` : w.text || w.title; draw(); });
    sheet.querySelector('[data-ok]').onclick = () => { read(); if (!it.title) return; sheet.remove(); onDone(it); };
  };
  draw(); document.body.appendChild(sheet);
}

/** Start a planned session: a weekly one is cloned so the template stays. */
async function startSession(s, { toast, done }) {
  const all = (await listSessions().catch(() => [])).map(norm);
  const active = all.find(isActive);
  if (active && active.id !== s.id) return toast('Finish the session in progress first.');
  let a = s;
  if (s.repeat === 'weekly') { a = { ...JSON.parse(JSON.stringify(s)), id: uid(), repeat: null, templateId: s.id, createdAt: Date.now() }; a.items.forEach((it) => { it.id = uid('it'); }); }
  a.status = 'active'; a.date = Date.now(); a.startedAt = Date.now();
  a.items.forEach((it) => { it.score = null; it.attempts = null; it.achieved = null; it.fails = []; it.repsDone = null; it.rating = null; it.at = null; });
  await putSession(a);
  toast(`Session started${a.minutes ? ` · ${a.minutes} min` : ''}. Log each item as you go.`);
  changed(); done();
}

/** Log one item of the active session. */
function logItemSheet(s, i, { toast, done }) {
  const it = s.items[i];
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${esc(it.title)}</b><button class="link" data-close>Close</button></div>
      <p class="mute small" style="margin:0 0 8px">${esc(itemTarget(it))}</p>
      ${it.mode === 'score' ? `<div class="lbl">Score</div><div class="row"><input inputmode="decimal" data-score value="${it.score ?? ''}" placeholder="${it.of ? `0–${it.of}` : 'score'}" style="flex:1" />${it.of ? `<span class="mute" style="align-self:center">/ ${it.of}</span>` : ''}</div>`
      : it.mode === 'attempts' ? `<div class="lbl">How many attempts did it take?</div><input inputmode="numeric" data-att value="${it.attempts ?? ''}" placeholder="e.g. 14" />
        <div class="seg seg2 mini" style="margin:8px 0"><button class="${it.achieved !== false ? 'on' : ''}" data-ach="1">Got there</button><button class="${it.achieved === false ? 'on' : ''}" data-ach="0">Ran out of balls / time</button></div>
        <div class="lbl">Why the misses? <span class="mute">(tap all that apply)</span></div><div class="codes small">${FAILS.map(([c, l]) => `<button class="${(it.fails || []).includes(c) ? 'on' : ''}" data-fail="${c}">${l}</button>`).join('')}</div>`
      : `<div class="lbl">Reps done</div><input inputmode="numeric" data-reps value="${it.repsDone ?? it.target?.n ?? ''}" />
        <div class="lbl" style="margin-top:8px">How did it go? <span class="mute">1 scrappy · 10 nailed it</span></div><div class="seg10">${Array.from({ length: 10 }, (_, k) => `<button class="${it.rating === k + 1 ? 'on' : ''}" data-rate="${k + 1}">${k + 1}</button>`).join('')}</div>`}
      <label class="small mute" style="margin-top:6px">Note <span class="mute">(optional)</span><input data-note value="${esc(it.note || '')}" placeholder="e.g. draws fine, fades started left" /></label>
      <button class="btn primary big" data-ok style="margin-top:10px">Save</button></div>`;
    const read = () => {
      it.note = sheet.querySelector('[data-note]').value.trim();
      if (it.mode === 'score') { const v = sheet.querySelector('[data-score]').value; it.score = v === '' ? null : +v; }
      if (it.mode === 'attempts') { const v = sheet.querySelector('[data-att]').value; it.attempts = v === '' ? null : +v; }
      if (it.mode === 'reps') { const v = sheet.querySelector('[data-reps]').value; it.repsDone = v === '' ? null : +v; }
    };
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelectorAll('[data-ach]').forEach((b) => b.onclick = () => { read(); it.achieved = b.dataset.ach === '1'; draw(); });
    sheet.querySelectorAll('[data-fail]').forEach((b) => b.onclick = () => { read(); it.fails = it.fails || []; it.fails = it.fails.includes(b.dataset.fail) ? it.fails.filter((x) => x !== b.dataset.fail) : [...it.fails, b.dataset.fail]; draw(); });
    sheet.querySelectorAll('[data-rate]').forEach((b) => b.onclick = () => { read(); it.rating = +b.dataset.rate; draw(); });
    sheet.querySelector('[data-ok]').onclick = async () => {
      read();
      if (it.mode === 'score' && it.score != null && it.of && it.score > it.of) return toast(`Can't be more than ${it.of}.`);
      if (it.mode === 'attempts' && it.attempts != null && it.achieved == null) it.achieved = true;
      it.at = Date.now();
      await putSession(s); sheet.remove(); changed(); done();
    };
  };
  draw(); document.body.appendChild(sheet);
}

/** Finish: rate the session 1–10 and describe it. */
function finishSheet(s, { toast, done }) {
  const unlogged = s.items.filter((it) => !itemLine(it));
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Finish session</b><button class="link" data-close>Not yet</button></div>
      ${unlogged.length ? `<p class="small" style="color:var(--work)">${unlogged.length} item${unlogged.length > 1 ? 's' : ''} not logged: ${unlogged.map((it) => esc(it.title)).join(', ')}. Finish anyway, or go back and log them.</p>` : ''}
      <div class="lbl">How was it, 1–10?</div><div class="seg10">${Array.from({ length: 10 }, (_, k) => `<button class="${s.rating === k + 1 ? 'on' : ''}" data-rate="${k + 1}">${k + 1}</button>`).join('')}</div>
      <label class="small mute">What happened<textarea data-note rows="3" placeholder="e.g. weight finally on the left heel by the end; fades still starting left">${esc(s.note || '')}</textarea></label>
      <div class="row" style="margin-top:6px"><label class="small mute" style="flex:1">Minutes actually spent<input inputmode="numeric" data-min value="${s.minutes ?? ''}" /></label></div>
      <button class="btn primary big" data-ok style="margin-top:10px">Finish</button></div>`;
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelectorAll('[data-rate]').forEach((b) => b.onclick = () => { s.note = sheet.querySelector('[data-note]').value; s.rating = +b.dataset.rate; draw(); });
    sheet.querySelector('[data-ok]').onclick = async () => {
      s.note = sheet.querySelector('[data-note]').value.trim(); s.minutes = +sheet.querySelector('[data-min]').value || s.minutes;
      if (!s.rating) return toast('Rate it first.');
      s.status = 'done'; s.date = s.startedAt || s.date || Date.now(); s.finishedAt = Date.now();
      await putSession(s); sheet.remove(); toast(`Session logged · ${s.rating}/10.`); changed(); done();
    };
  };
  draw(); document.body.appendChild(sheet);
}

/** Past session: review, re-run, delete. */
function reviewSheet(s, { toast, done }) {
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${esc(s.title || whereText(s))}</b><button class="link" data-close>Close</button></div>
    <p class="mute small">${fmt(s.date)}${s.minutes ? ` · ${s.minutes} min` : ''}${s.rating ? ` · rated ${s.rating}/10` : ''}</p>
    ${s.items.map((it) => `<div class="pitem"><span class="mode">${it.mode === 'score' ? '🎯' : it.mode === 'attempts' ? '🔁' : '🔨'}</span><span class="sit"><b>${esc(it.title)}</b><span class="mute small">${esc(itemTarget(it))}${it.fails?.length ? ` · misses: ${it.fails.map((f) => FL[f]).join(', ')}` : ''}${it.note ? ` · ${esc(it.note)}` : ''}</span></span><span class="sres">${itemLine(it) ? esc(itemLine(it)) : '<span class="mute">–</span>'}</span></div>`).join('') || '<p class="mute small">No items.</p>'}
    ${s.note ? `<p class="small" style="margin-top:8px">${esc(s.note)}</p>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn" data-again>Do it again</button><button class="btn" data-edit>Edit</button></div>
    <button class="link" data-del style="margin-top:12px;color:var(--work)">Delete</button></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-again]').onclick = async () => { const c = { ...JSON.parse(JSON.stringify(s)), id: uid(), status: 'planned', when: 'today', date: Date.now(), rating: null, note: '', createdAt: Date.now() }; c.items.forEach((it) => { it.id = uid('it'); it.score = null; it.attempts = null; it.achieved = null; it.fails = []; it.repsDone = null; it.rating = null; it.note = ''; it.at = null; }); sheet.remove(); sessionPlanner(c, { toast, done }); };
  sheet.querySelector('[data-edit]').onclick = () => { sheet.remove(); sessionPlanner(s, { toast, done }); };
  sheet.querySelector('[data-del]').onclick = async () => { await deleteSession(s.id); sheet.remove(); changed(); done(); };
  document.body.appendChild(sheet);
}

// ---------------- Calendar ----------------
function calendarSheet(s) {
  const title = `Practice: ${s.title || whereText(s)}`;
  const desc = s.items.map((it) => `• ${it.title} (${itemTarget(it)})`).join('\n');
  let start;
  if (s.when === 'weekly') { const d = new Date(); d.setHours(17, 0, 0, 0); const diff = (s.weekday - ((d.getDay() + 6) % 7) + 7) % 7; d.setDate(d.getDate() + (diff === 0 && d.getTime() < Date.now() ? 7 : diff)); start = d.getTime(); }
  else { start = s.date || Date.now() + 86400e3; }
  const end = start + (s.minutes || 45) * 60e3;
  const rrule = s.when === 'weekly' ? `RRULE:FREQ=WEEKLY;BYDAY=${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][s.weekday]}` : '';
  const when = `${new Date(start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${s.when === 'weekly' ? ', every week' : ''} · ${s.minutes || 45} min`;
  calSheet({ title, desc, start, end, rrule, uid: s.id, when, file: 'osolo-practice.ics', note: 'The event carries the item list. Starting the session still happens here in the app.' });
}

// Course page: a satellite hero of the course, Start / Schedule / Preview / Scorecard / Mark holes,
// and your record here — rounds, best/avg/worst overall and hole by hole. Also the course cards on the
// Play tab and the "Upcoming" scheduled rounds.
import { listRounds, listCourses, putCourse, getSettings, saveSettings } from '../store.js';
import { loadLibrary, importCourse, toggleStar, starred, isHome } from './library.js';
import { loadGeo, geoHole, drawCourseMap, mountHoleMap, markedHole, markHoleSheet, offlineTiles, saveCourseOffline } from './holemap.js';
import { dist as D, du } from '../units.js';
import { calendarSheet } from '../calendar.js';
import { icon } from '../icons.js';
import { createEvent, updateEvent, deleteEvent } from '../cloud/social.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : '2-digit' });
const toPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Group the golfer's saved courses by library id (tee variants of one course share a page). */
export function groupCourses(courses) {
  const groups = new Map();
  for (const c of courses) {
    const key = c.libId || `local:${c.id}`;
    if (!groups.has(key)) groups.set(key, { key, libId: c.libId || null, name: c.name, variants: [] });
    groups.get(key).variants.push(c);
  }
  return [...groups.values()];
}

/** Rounds on any variant of this course, newest first, with the score worked out. */
export function courseRecord(group, rounds) {
  const ids = new Set(group.variants.map((c) => c.id));
  const byId = new Map(group.variants.map((c) => [c.id, c]));
  const list = rounds.filter((r) => ids.has(r.courseId) && r.finished).map((r) => {
    const c = byId.get(r.courseId);
    const holes = r.quick ? [] : r.holes.map((h, i) => (h && h.score != null ? { i, score: h.score, par: c.holes[i]?.par ?? 4, putts: h.putts } : null)).filter(Boolean);
    const score = r.quick ? r.score : holes.length ? holes.reduce((a, h) => a + h.score, 0) : null;
    const par = r.quick ? c.holes.reduce((a, h) => a + h.par, 0) : holes.reduce((a, h) => a + h.par, 0);
    const full = r.quick ? (r.holesPlayed || 18) >= c.holes.length : holes.length >= c.holes.length;
    return { r, c, holes, score, par, full };
  }).filter((x) => x.score != null).sort((a, b) => b.r.date - a.r.date);
  const fulls = list.filter((x) => x.full);
  const n = group.variants[0]?.holes.length || 18;
  const perHole = Array.from({ length: n }, (_, i) => {
    const sc = list.flatMap((x) => x.holes.filter((h) => h.i === i));
    const s = sc.map((h) => h.score); const par = group.variants[0]?.holes[i]?.par ?? 4;
    return { i, par, n: s.length, avg: mean(s), best: s.length ? Math.min(...s) : null, worst: s.length ? Math.max(...s) : null, under: sc.filter((h) => h.score < h.par).length, pars: sc.filter((h) => h.score === h.par).length, over: sc.filter((h) => h.score > h.par).length, putts: mean(sc.map((h) => h.putts).filter((p) => p != null)) };
  });
  return { list, played: list.length, best: fulls.length ? Math.min(...fulls.map((x) => x.score)) : null, worst: fulls.length ? Math.max(...fulls.map((x) => x.score)) : null, avg: mean(fulls.map((x) => x.score)), avgToPar: mean(fulls.map((x) => x.score - x.par)), perHole, last: list[0] || null };
}

// ---------- scheduled rounds ----------
export const events = () => (getSettings().events || []).filter((e) => e.when > Date.now() - 6 * 3600e3).sort((a, b) => a.when - b.when);
function saveEvents(list) { const s = getSettings(); s.events = list; saveSettings(s); }
export function scheduleSheet(group, { toast = () => {}, done = () => {}, existing = null } = {}) {
  const ev = existing || { id: uid('ev'), libId: group.libId, courseId: group.variants[0]?.id || null, courseName: group.name, when: null, who: '', note: '' };
  const d = new Date(ev.when || Date.now() + 86400e3); if (!ev.when) d.setHours(7, 30, 0, 0);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${existing ? 'Edit' : 'Schedule a'} round</b><button class="link" data-close>Cancel</button></div>
    <p class="small"><b>${esc(group.name)}</b></p>
    <div class="row"><label class="small mute" style="flex:1">Day<input type="date" data-day value="${day}" /></label><label class="small mute" style="flex:1">Tee time<input type="time" data-time value="${time}" /></label></div>
    ${group.variants.length > 1 ? `<label class="small mute">Tees<select data-tee>${group.variants.map((c) => `<option value="${c.id}" ${c.id === ev.courseId ? 'selected' : ''}>${esc(c.tees || 'default')}</option>`).join('')}</select></label>` : ''}
    <label class="small mute">Who's playing <span>(names, comma separated — invites come later)</span><input data-who value="${esc(ev.who)}" placeholder="e.g. Dave, Rob" /></label>
    <label class="small mute">Note<input data-note value="${esc(ev.note)}" placeholder="e.g. 9 holes, match play" /></label>
    <button class="btn primary big" data-ok style="margin-top:10px">${existing ? 'Save' : 'Schedule'}</button>
    ${existing ? '<button class="link" data-del style="margin-top:10px;color:var(--work)">Remove</button>' : ''}</div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelector('[data-del]')?.addEventListener('click', () => { saveEvents(events().filter((e) => e.id !== ev.id)); if (ev.remoteId) deleteEvent(ev.remoteId).catch(() => {}); sheet.remove(); done(); });
  sheet.querySelector('[data-ok]').onclick = async () => {
    const when = new Date(`${sheet.querySelector('[data-day]').value}T${sheet.querySelector('[data-time]').value || '07:30'}`).getTime();
    if (!when) return toast('Pick a day.');
    Object.assign(ev, { when, who: sheet.querySelector('[data-who]').value.trim(), note: sheet.querySelector('[data-note]').value.trim(), courseId: sheet.querySelector('[data-tee]')?.value || ev.courseId });
    // signed in: the round lives on the server too, so friends can be invited with a link
    try {
      if (ev.remoteId) await updateEvent(ev.remoteId, ev);
      else { const r = await createEvent(ev); if (r) { ev.remoteId = r.id; ev.code = r.invite_code; } }
    } catch (e) { toast(`Saved here; not shared: ${e.message}`); }
    const list = events().filter((e) => e.id !== ev.id); list.push(ev); saveEvents(list);
    sheet.remove(); toast(existing ? 'Updated' : ev.code ? 'Scheduled · tap Invite to share the link' : 'Scheduled'); done(ev);
    if (!existing) eventCalendar(ev);
  };
  document.body.appendChild(sheet);
}
export const eventCalendar = (ev) => calendarSheet({ title: `Golf: ${ev.courseName}`, desc: [ev.who && `With ${ev.who}`, ev.note].filter(Boolean).join('\n'), start: ev.when, end: ev.when + 4.5 * 3600e3, uid: ev.id, file: 'osolo-round.ics' });
export const fmtWhen = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- course cards for the Play tab ----------
/** HTML for the course cards; call bindCourseCards(root, api) after inserting. */
export function courseCardsHtml(groups, rounds) {
  const st = starred();
  const rank = (g) => (g.variants.some((c) => isHome(c)) ? 0 : st.has(g.libId) ? 1 : 2);
  const rows = groups.map((g) => ({ g, rec: courseRecord(g, rounds), last: Math.max(0, ...g.variants.map((c) => c.lastPlayed || 0)) }))
    .sort((a, b) => rank(a.g) - rank(b.g) || b.last - a.last);
  return rows.map(({ g, rec }) => `<div class="ccard" data-course="${esc(g.key)}">
      <canvas class="cthumb" data-thumb="${esc(g.key)}"></canvas>
      <div class="cbody"><b>${rank(g) === 0 ? `${icon('home', 15)} ` : ''}${esc(g.name)}</b>
        <span class="mute small">${g.variants.map((c) => c.tees).filter(Boolean).join(' · ') || 'no tees set'}${rec.played ? ` · ${rec.played} round${rec.played > 1 ? 's' : ''}` : ''}</span>
        ${rec.played ? `<span class="small">${rec.best != null ? `Best <b>${rec.best}</b> · avg <b>${rec.avg.toFixed(1)}</b> · worst <b>${rec.worst}</b>` : `Last: ${rec.last.full ? rec.last.score : `${rec.last.holes.length || rec.last.r.holesPlayed || '?'} holes`} on ${fmtD(rec.last.r.date)}`}</span>` : '<span class="small mute">Not played yet</span>'}
      </div><span class="mute">›</span></div>`).join('');
}
export function bindCourseCards(root, groups, api) {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  root.querySelectorAll('[data-course]').forEach((el) => el.onclick = () => coursePage(byKey.get(el.dataset.course), api));
  root.querySelectorAll('[data-thumb]').forEach(async (cv) => { const g = byKey.get(cv.dataset.thumb); const geo = await loadGeo(g.libId); drawCourseMap(cv, { geo, course: g.variants[0], shapes: false }); });
}

// ---------- the course page ----------
/** api: { root, toast, startRound(course), openRound(id), editCourse(id), back() } */
export async function coursePage(group, api) {
  const { root, toast } = api;
  const [lib, rounds, allCourses] = await Promise.all([loadLibrary(), listRounds().catch(() => []), listCourses().catch(() => [])]);
  group = groupCourses(allCourses).find((g) => g.key === group.key) || group; // fresh variants
  const L = group.libId ? lib.find((x) => x.id === group.libId) : null;
  const geo = await loadGeo(group.libId);
  const first = group.variants[0];
  const rec = courseRecord(group, rounds);
  const st = starred();
  const par = first.holes.reduce((a, h) => a + h.par, 0);
  const mapped = (geo?.holes?.length || 0), marked = first.holes.filter((h) => h.mark).length, n = first.holes.length;
  const coverage = mapped >= n ? `All ${n} holes mapped` : mapped ? `${mapped} of ${n} holes mapped${marked ? `, ${marked} marked by you` : ''}` : marked ? `${marked} of ${n} holes marked by you` : 'No hole map yet';
  const teeLine = (c) => `${esc(c.tees || 'default')}${c.rating ? ` · ${c.rating}/${c.slope}` : ''}${c.holes.some((h) => h.yds) ? ` · ${c.holes.reduce((a, h) => a + (h.yds || 0), 0).toLocaleString()} ${du() === 'm' ? 'yd' : 'yd'}` : ''}`;
  const up = events().filter((e) => e.libId ? e.libId === group.libId : e.courseId === first.id);
  root.innerHTML = `
    <div class="chero"><canvas></canvas><div class="chero-ov">
      <button class="link" data-x="back">‹ Play</button>
      <div class="chero-t"><h1>${esc(group.name)}</h1><span>${esc(L?.emirate || '')}${L?.emirate ? ' · ' : ''}${n} holes · par ${par}</span></div>
      <button class="star ${st.has(group.libId) ? 'on' : ''}" data-x="star" aria-label="Star">${st.has(group.libId) ? '★' : '☆'}</button></div></div>
    <div class="cactions">
      <button class="btn primary" data-x="start">${icon('play')} Start round</button>
      <button class="btn" data-x="schedule">${icon('calendar')} Schedule</button>
      <button class="btn" data-x="preview" ${mapped || marked || first.lat ? '' : 'disabled'}>${icon('map')} Preview holes</button>
      <button class="btn" data-x="card">${icon('card')} Scorecard</button>
    </div>
    ${up.length ? `<div class="card"><div class="lbl">Upcoming here</div>${up.map((e) => `<div class="evrow"><div><b>${fmtWhen(e.when)}</b><div class="mute small">${esc([e.who && `with ${e.who}`, e.note].filter(Boolean).join(' · '))}</div></div><button class="link" data-ev="${e.id}">Edit</button></div>`).join('')}</div>` : ''}
    <div class="card"><div class="lbl">Your record here</div>
      ${rec.played ? `<div class="kpis"><div><b>${rec.played}</b><span>rounds</span></div><div><b>${rec.best ?? '–'}</b><span>best</span></div><div><b>${rec.avg != null ? rec.avg.toFixed(1) : '–'}</b><span>average${rec.avgToPar != null ? ` (${toPar(Math.round(rec.avgToPar))})` : ''}</span></div><div><b>${rec.worst ?? '–'}</b><span>worst</span></div></div>
        ${rec.perHole.some((h) => h.n) ? `<div class="scroll"><table class="card-t holes-t"><thead><tr><th>Hole</th>${rec.perHole.map((h) => `<th>${h.i + 1}</th>`).join('')}</tr></thead>
          <tr><th>Par</th>${rec.perHole.map((h) => `<td class="mute">${h.par}</td>`).join('')}</tr>
          <tr><th>Avg</th>${rec.perHole.map((h) => `<td class="${h.avg == null ? '' : h.avg < h.par + 0.3 ? 'b' : h.avg > h.par + 1 ? 'oo' : h.avg > h.par + 0.6 ? 'o' : ''}">${h.avg != null ? h.avg.toFixed(1) : '–'}</td>`).join('')}</tr>
          <tr><th>Best</th>${rec.perHole.map((h) => `<td class="${h.best != null && h.best < h.par ? 'b' : ''}">${h.best ?? '–'}</td>`).join('')}</tr>
          <tr><th>Worst</th>${rec.perHole.map((h) => `<td class="${h.worst != null && h.worst >= h.par + 2 ? 'oo' : ''}">${h.worst ?? '–'}</td>`).join('')}</tr>
          <tr><th>Putts</th>${rec.perHole.map((h) => `<td class="mute">${h.putts != null ? h.putts.toFixed(1) : '–'}</td>`).join('')}</tr></table></div>
          <p class="mute small">Hole averages from your hole-by-hole rounds here${rec.list.some((x) => x.r.quick) ? '; posted scores count in the totals only' : ''}.</p>` : ''}` : '<p class="mute small">No rounds here yet. Start one and this fills in: best, average and worst overall and on every hole.</p>'}
    </div>
    <div class="card"><div class="lbl">Course</div>
      ${group.variants.map((c) => `<div class="tagrow"><span>${teeLine(c)}</span><button class="link" data-edit="${c.id}">Edit</button></div>`).join('')}
      ${L?.tees?.length > group.variants.length ? `<button class="link acc" data-x="addtee">+ Add another tee from the scorecard</button>` : ''}
      <p class="mute small" style="margin:8px 0 0">${coverage}${geo ? ' · shapes © OpenStreetMap contributors' : ''}. ${mapped < n && first.lat ? '<button class="link acc" data-x="mark">Mark holes on the satellite map</button>' : ''}</p>
      ${mapped || marked ? `<p class="small" style="margin:6px 0 0"><button class="link acc" data-x="offline">${icon('download', 14)} ${(getSettings().offlineCourses || {})[group.key] ? `Saved for offline ${fmtD((getSettings().offlineCourses || {})[group.key])} · refresh` : 'Save the satellite map for offline'}</button> <span class="mute" data-offp></span></p>` : ''}
    </div>
    ${rec.list.length ? `<h2 style="margin:18px 0 8px">Rounds here</h2>${rec.list.map(({ r, score, par: p, full }) => `<div class="hist" data-open="${r.id}"><div class="sc">${score}</div><div><div class="t">${fmtD(r.date)} <span class="mute">${full ? toPar(score - p) : `${r.quick ? r.holesPlayed || '' : r.holes.filter((h) => h && h.score != null).length} holes`}</span></div><div class="s">${esc(r.tees || '')}${r.quick ? ' · score only' : ''}${r.learning === false ? ' · not counted' : ''}</div></div><div class="mute">›</div></div>`).join('')}` : ''}`;
  drawCourseMap(root.querySelector('.chero canvas'), { geo, course: first });
  const redraw = () => coursePage(group, api);
  root.querySelector('[data-x=back]').onclick = api.back;
  root.querySelector('[data-x=star]').onclick = () => { if (group.libId) { toggleStar(group.libId); redraw(); } };
  root.querySelector('[data-x=start]').onclick = () => pickTee(group, L, api, (c) => api.startRound(c));
  root.querySelector('[data-x=schedule]').onclick = () => scheduleSheet(group, { toast, done: redraw });
  root.querySelector('[data-x=preview]').onclick = () => previewHoles(group, geo, api);
  root.querySelector('[data-x=card]').onclick = () => scorecardSheet(group, L);
  root.querySelector('[data-x=addtee]')?.addEventListener('click', () => pickTee(group, L, api, () => redraw(), true));
  root.querySelector('[data-x=mark]')?.addEventListener('click', () => markHoleSheet({ course: first, start: 0, geo, onSave: (k, mark) => saveMark(group, k, mark), onClose: redraw }));
  root.querySelector('[data-x=offline]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget, p = root.querySelector('[data-offp]'); b.disabled = true;
    const n = offlineTiles(geo, first).length; p.textContent = `0 / ${n}`;
    const r = await saveCourseOffline(geo, first, (d, t) => { p.textContent = `${d} / ${t}`; });
    const s = getSettings(); s.offlineCourses = { ...(s.offlineCourses || {}), [group.key]: Date.now() }; saveSettings(s);
    p.textContent = r.failed ? `${r.total - r.failed} of ${r.total} tiles saved` : `${r.total} tiles saved (about ${Math.round((r.total * 18) / 1024)} MB)`;
    toast('Saved. The holes here work without signal now.'); b.disabled = false;
  });
  root.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => api.editCourse(b.dataset.edit));
  root.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => api.openRound(b.dataset.open));
  root.querySelectorAll('[data-ev]').forEach((b) => b.onclick = () => scheduleSheet(group, { toast, done: redraw, existing: events().find((e) => e.id === b.dataset.ev) }));
  window.scrollTo(0, 0);
}

/** A mark belongs to the course, not one tee variant: save it on every variant. */
export async function saveMark(group, k, mark) {
  for (const c of group.variants) { c.holes[k].mark = mark; await putCourse(c); }
}

/** Which tees? Saved variants first, then any other tee on the published card (imported on pick). */
function pickTee(group, L, api, onPick, addOnly = false) {
  const have = new Set(group.variants.map((c) => c.tees));
  const extra = (L?.tees || []).filter((t) => !have.has(t.name));
  if (!addOnly && group.variants.length === 1 && !extra.length) return onPick(group.variants[0]);
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  const yards = (v) => (v == null ? null : Math.round(L?.unit === 'metres' ? v * 1.0936133 : v));
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>${addOnly ? 'Add a tee' : 'Which tees?'}</b><button class="link" data-close>Cancel</button></div>
    <div class="tees">${addOnly ? '' : group.variants.map((c) => `<button class="tee" data-v="${c.id}"><b>${esc(c.tees || 'Default')}</b><span class="mute small">${c.rating ? `CR ${c.rating} · slope ${c.slope}` : ''}${c.lastPlayed ? ` · last played ${fmtD(c.lastPlayed)}` : ''}</span></button>`).join('')}
      ${extra.map((t, i) => { const tot = (t.lengths || []).reduce((a, b) => a + (b || 0), 0); return `<button class="tee" data-t="${i}"><b>${esc(t.name)}</b><span class="mute small">${tot ? `${yards(tot).toLocaleString()} yds` : ''}${t.rating ? ` · CR ${t.rating} · slope ${t.slope}` : ''}${t.gender === 'women' ? ' · ladies' : ''}${addOnly ? '' : ' · from the card'}</span></button>`; }).join('')}</div></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  sheet.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { sheet.remove(); onPick(group.variants.find((c) => c.id === b.dataset.v)); });
  sheet.querySelectorAll('[data-t]').forEach((b) => b.onclick = async () => { const c = await importCourse(L, extra[+b.dataset.t]); const m = group.variants[0]; if (m) c.holes.forEach((h, k) => { if (m.holes[k]?.mark) h.mark = m.holes[k].mark; }); await putCourse(c); sheet.remove(); onPick(c); });
  document.body.appendChild(sheet);
}

/** Browse the holes on the map without a round. */
async function previewHoles(group, geo, api) {
  const c = group.variants[0]; let i = 0, map = null;
  const clubs = await (typeof api.clubs === 'function' ? api.clubs() : api.clubs || []);
  const el = document.createElement('div'); el.className = 'onb preview';
  el.innerHTML = `<div class="onb-in"><div class="onb-top"><b data-t></b><button class="link" data-close>Close</button></div>
    <div class="holebar" style="margin:4px 0 8px"><button class="btn icon" data-p>‹</button><div class="hinfo"><div class="hnum" data-h></div><div class="mute small" data-s></div></div><button class="btn icon" data-n>›</button></div>
    <div data-map></div></div>`;
  document.body.appendChild(el);
  const draw = () => {
    const ch = c.holes[i];
    el.querySelector('[data-t]').textContent = group.name; el.querySelector('[data-h]').textContent = `Hole ${i + 1}`;
    el.querySelector('[data-s]').textContent = `Par ${ch.par}${ch.si ? ` · SI ${ch.si}` : ''}${ch.yds ? ` · ${D(ch.yds)} ${du()}` : ''}`;
    map?.destroy(); const m = el.querySelector('[data-map]'); m.className = ''; m.innerHTML = '';
    const gh = geoHole(geo, i + 1) || markedHole(ch.mark, i + 1);
    map = mountHoleMap(m, { gh, geo, par: ch.par, yds: ch.yds, teeName: c.tees, clubs, canMark: !!c.lat, onMark: () => markHoleSheet({ course: c, start: i, geo, onSave: (k, mark) => saveMark(group, k, mark), onClose: draw }) });
  };
  el.querySelector('[data-close]').onclick = () => { map?.destroy(); el.remove(); };
  el.querySelector('[data-p]').onclick = () => { i = (i + c.holes.length - 1) % c.holes.length; draw(); };
  el.querySelector('[data-n]').onclick = () => { i = (i + 1) % c.holes.length; draw(); };
  draw();
}

function scorecardSheet(group, L) {
  const c0 = group.variants[0]; const n = c0.holes.length;
  const tees = group.variants.map((c) => ({ name: c.tees || 'Default', yds: c.holes.map((h) => h.yds), rating: c.rating, slope: c.slope }));
  const sum = (a, lo, hi) => a.slice(lo, hi).reduce((x, y) => x + (y || 0), 0);
  const row = (label, vals, cls = '') => `<tr><th>${label}</th>${vals.slice(0, 9).map((v) => `<td class="${cls}">${v ?? ''}</td>`).join('')}<td class="tot">${sum(vals, 0, 9) || ''}</td>${n > 9 ? `${vals.slice(9, 18).map((v) => `<td class="${cls}">${v ?? ''}</td>`).join('')}<td class="tot">${sum(vals, 9, 18) || ''}</td><td class="tot">${sum(vals, 0, 18) || ''}</td>` : ''}</tr>`;
  const head = `<tr><th></th>${Array.from({ length: Math.min(9, n) }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>Out</th>${n > 9 ? `${Array.from({ length: n - 9 }, (_, i) => `<th>${i + 10}</th>`).join('')}<th>In</th><th>Tot</th>` : ''}</tr>`;
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Scorecard</b><button class="link" data-close>Close</button></div>
    <p class="small"><b>${esc(group.name)}</b>${L ? ` <span class="mute">· ${esc(L.emirate)}</span>` : ''}</p>
    <div class="scroll"><table class="card-t sc-t"><thead>${head}</thead>
      ${row('Par', c0.holes.map((h) => h.par))}
      ${row('SI', c0.holes.map((h) => h.si), 'mute')}
      ${tees.map((t) => row(`${esc(t.name)}${t.rating ? `<br><span class="mute">${t.rating}/${t.slope}</span>` : ''}`, t.yds)).join('')}</table></div>
    <p class="mute small">${L?.sources?.length ? 'From the club\'s published card.' : 'Entered by hand.'} Yardages are in yards as published.</p></div>`;
  sheet.querySelector('[data-close]').onclick = () => sheet.remove();
  document.body.appendChild(sheet);
}

// UAE course library: published scorecards (par, stroke index, yardage per tee, rating/slope)
// bundled with the app, so a course is two taps instead of typing or photographing a card.
import { putCourse, listCourses, getSettings, saveSettings } from '../store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cache = null;
export async function loadLibrary() {
  if (!cache) cache = fetch(`${import.meta.env.BASE_URL}courses/uae.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return cache;
}

const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const d = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
};
const norm = (s) => String(s || '').toLowerCase().replace(/golf|club|course|the|&|and/g, '').replace(/[^a-z0-9]/g, '');
/** Is this library course the golfer's home course? (home is free text from the profile) */
export function isHome(c, home = getSettings().homeCourse) {
  const h = norm(home); if (!h) return false;
  const n = norm(c.name), k = norm(c.club);
  return n === h || n.includes(h) || h.includes(n) || (k && h === k);
}
export const starred = () => new Set(getSettings().starredCourses || []);
export function toggleStar(id) {
  const s = getSettings(); const st = new Set(s.starredCourses || []);
  st.has(id) ? st.delete(id) : st.add(id); s.starredCourses = [...st]; saveSettings(s);
  return st.has(id);
}
const yards = (v, unit) => (v == null ? null : Math.round(unit === 'metres' ? v * 1.0936133 : v));

/** Make (or update) a local course from a library entry + tee. Returns the course. */
export async function importCourse(lib, tee) {
  const existing = (await listCourses().catch(() => [])).find((c) => c.libId === lib.id && c.tees === (tee?.name || ''));
  const c = existing || { id: `c_${Date.now().toString(36)}` };
  Object.assign(c, {
    name: lib.name, libId: lib.id, tees: tee?.name || '', rating: tee?.rating ?? null, slope: tee?.slope ?? null,
    lat: lib.lat ?? null, lon: lib.lon ?? null,
    holes: lib.par.map((p, i) => ({ par: p || 4, si: lib.si?.[i] ?? null, yds: yards(tee?.lengths?.[i], lib.unit), green: lib.greens?.[i] || null })),
  });
  await putCourse(c);
  return c;
}

/** Full-screen picker: search UAE courses (nearest first if location allowed), then pick tees. */
export async function openLibrary({ onPicked = () => {}, toast = () => {} } = {}) {
  const lib = (await loadLibrary()).filter((c) => Array.isArray(c.par) && c.par.some(Boolean));
  if (!lib.length) return toast('Course list not available. Check your connection.');
  let q = '', here = null, chosen = null;
  const el = document.createElement('div'); el.className = 'onb';
  document.body.appendChild(el);
  const close = () => el.remove();

  const list = () => {
    const f = q.trim().toLowerCase();
    let rows = lib.filter((c) => !f || `${c.name} ${c.club} ${c.emirate}`.toLowerCase().includes(f));
    if (here) rows = rows.map((c) => ({ c, d: c.lat ? km(here, c) : 9e9 })).sort((a, b) => a.d - b.d).map((x) => x.c);
    // home course first, then your starred ones, then the rest
    const st = starred();
    const rank = (c) => (isHome(c) ? 0 : st.has(c.id) ? 1 : 2);
    rows = rows.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
    let lastRank = -1;
    return rows.map((c) => {
      const r = rank(c);
      const head = !f && r !== lastRank ? `<div class="libhead">${r === 0 ? 'Home course' : r === 1 ? 'Starred' : 'All UAE courses'}</div>` : '';
      lastRank = r;
      const par = c.par.reduce((a, b) => a + (b || 0), 0);
      const d = here && c.lat ? ` · ${km(here, c).toFixed(km(here, c) < 10 ? 1 : 0)} km` : '';
      return `${head}<div class="librow"><button class="libitem" data-id="${esc(c.id)}"><b>${r === 0 ? '🏠 ' : ''}${esc(c.name)}</b><span class="mute small">${esc(c.emirate)} · ${c.holes} holes · par ${par}${d}</span></button><button class="star ${st.has(c.id) ? 'on' : ''}" data-star="${esc(c.id)}" aria-label="Star">${st.has(c.id) ? '★' : '☆'}</button></div>`;
    }).join('') || '<p class="mute">No match. Use "+ Course" to add it by hand.</p>';
  };

  const draw = () => {
    if (chosen) {
      const c = chosen;
      const par = c.par.reduce((a, b) => a + (b || 0), 0);
      el.innerHTML = `<div class="onb-in"><div class="onb-top"><button class="link" data-back>‹ Courses</button><button class="link" data-close>Close</button></div>
        <div class="onb-body"><h2>${esc(c.name)}</h2><p class="mute">${esc(c.emirate)} · ${c.holes} holes · par ${par}</p>
        <label class="field-label">Which tees?</label>
        <div class="tees">${(c.tees || []).map((t, i) => {
          const tot = (t.lengths || []).reduce((a, b) => a + (b || 0), 0);
          return `<button class="tee" data-t="${i}"><b>${esc(t.name)}</b><span class="mute small">${tot ? `${yards(tot, c.unit).toLocaleString()} yds` : 'length n/a'}${t.rating ? ` · CR ${t.rating}` : ''}${t.slope ? ` · slope ${t.slope}` : ''}${t.gender === 'women' ? ' · ladies' : ''}</span></button>`;
        }).join('') || '<button class="tee" data-t="-1"><b>Use this course</b><span class="mute small">No tee lengths published</span></button>'}</div>
        ${c.notes ? `<p class="mute small" style="margin-top:14px">${esc(c.notes)}</p>` : ''}
        <p class="mute small" style="margin-top:10px">From the club's published scorecard. You can fix anything afterwards in Edit course.</p></div></div>`;
      el.querySelector('[data-back]').onclick = () => { chosen = null; draw(); };
      el.querySelector('[data-close]').onclick = close;
      el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', async () => {
        const course = await importCourse(c, c.tees?.[+b.dataset.t] || null);
        close(); toast(`${course.name}${course.tees ? ` (${course.tees})` : ''} added`); onPicked(course);
      }));
      return;
    }
    el.innerHTML = `<div class="onb-in"><div class="onb-top"><b>UAE courses</b><button class="link" data-close>Close</button></div>
      <div class="onb-body"><input id="libQ" placeholder="Search courses" value="${esc(q)}" />
      ${here ? '' : '<button class="link acc" id="nearBtn" style="margin:10px 0 0">📍 Nearest first</button>'}
      <div class="liblist">${list()}</div>
      <p class="mute small" style="margin-top:12px">Scorecards from each club's published card. Course outlines © OpenStreetMap contributors.</p></div></div>`;
    el.querySelector('[data-close]').onclick = close;
    const qi = el.querySelector('#libQ');
    qi.oninput = () => { q = qi.value; el.querySelector('.liblist').innerHTML = list(); bind(); };
    el.querySelector('#nearBtn')?.addEventListener('click', () => navigator.geolocation?.getCurrentPosition(
      (p) => { here = { lat: p.coords.latitude, lon: p.coords.longitude }; draw(); },
      () => toast('Location not available.'), { timeout: 8000, maximumAge: 600000 }));
    bind();
  };
  const bind = () => {
    el.querySelectorAll('.libitem').forEach((b) => (b.onclick = () => { chosen = lib.find((c) => c.id === b.dataset.id); draw(); }));
    el.querySelectorAll('[data-star]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleStar(b.dataset.star); el.querySelector('.liblist').innerHTML = list(); bind(); }));
  };
  draw();
}

// The top of Play: an invitation to go and play. A line that reads the sky at your course ("Lovely day
// for a game of golf"), a small drawing of it with the temperature and wind, then "Where are you
// playing?" with your courses, most recent first, one tap from each course's page.
import { badgeHtml } from './badge.js';
import { compass } from '../weather.js';
import { metres } from '../geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** What the sky is doing, from Open-Meteo's WMO weather code, day/night and wind. */
export function skyOf(c) {
  if (!c) return null;
  const k = c.code ?? -1;
  if (k >= 95) return 'storm';
  if ((k >= 51 && k <= 67) || (k >= 80 && k <= 82)) return 'rain';
  if (k === 45 || k === 48) return 'fog';
  if (c.day === false) return k >= 2 ? 'night-cloud' : 'night';
  if (k === 3 || (c.cloud ?? 0) >= 80) return 'cloud';
  if (k === 1 || k === 2 || (c.cloud ?? 0) >= 30) return 'part';
  return 'sun';
}

/** The opening line. Honest about the day: it only says "lovely" when it is. */
export function greeting(c, name = '') {
  const you = name ? `, ${name}` : '';
  if (!c) return `Fancy a game${you}?`;
  const sky = skyOf(c), t = c.tempC ?? 25, w = Math.max(c.windMph ?? 0, (c.gustMph ?? 0) * 0.7);
  if (sky === 'storm') return 'Thunder about. Not one for the course.';
  if (sky === 'rain') return 'Wet one out there. Bring the brolly.';
  if (sky === 'night' || sky === 'night-cloud') return `Dark out${you}. Plan the next one.`;
  if (sky === 'fog') return 'Murky out. Pick small targets.';
  if (t >= 40) return 'A scorcher. Twilight nine?';
  if (w >= 18) return 'Breezy one. Keep it low today.';
  if (t <= 12) return `Fresh out${you}. Keep the ball warm.`;
  if (sky === 'cloud') return `Grey skies, a grand day for golf${you}.`;
  return `Lovely day for a game of golf${you}.`;
}

/** A small drawing of the sky. Colours come from the theme, so it sits right in light and dark. */
export function skyArt(sky) {
  const sun = (x, y, r) => `<g class="wx-sun"><circle cx="${x}" cy="${y}" r="${r}"/>${Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4, r1 = r + 5, r2 = r + 10; return `<line x1="${(x + r1 * Math.cos(a)).toFixed(1)}" y1="${(y + r1 * Math.sin(a)).toFixed(1)}" x2="${(x + r2 * Math.cos(a)).toFixed(1)}" y2="${(y + r2 * Math.sin(a)).toFixed(1)}"/>`; }).join('')}</g>`;
  const cloud = (x, y, s = 1) => `<path class="wx-cloud" transform="translate(${x} ${y}) scale(${s})" d="M10 30h34a11 11 0 0 0 0-22 15 15 0 0 0-28-3A12 12 0 0 0 10 30z"/>`;
  const moon = '<path class="wx-moon" d="M44 12a18 18 0 1 0 14 26 15 15 0 0 1-14-26z"/>';
  const drops = '<g class="wx-rain"><line x1="24" y1="50" x2="21" y2="58"/><line x1="34" y1="50" x2="31" y2="58"/><line x1="44" y1="50" x2="41" y2="58"/></g>';
  const art = {
    sun: sun(36, 32, 13),
    part: `${sun(44, 24, 10)}${cloud(8, 22, 1)}`,
    cloud: `${cloud(14, 8, 0.8)}${cloud(4, 22, 1)}`,
    rain: `${cloud(6, 14, 1)}${drops}`,
    storm: `${cloud(6, 14, 1)}<path class="wx-bolt" d="M36 44l-6 10h7l-4 10 11-14h-7l4-6z"/>`,
    fog: '<g class="wx-fog"><line x1="8" y1="24" x2="58" y2="24"/><line x1="14" y1="34" x2="64" y2="34"/><line x1="8" y1="44" x2="52" y2="44"/></g>',
    night: moon,
    'night-cloud': `${moon}${cloud(14, 28, 0.8)}`,
  }[sky] || sun(36, 32, 13);
  return `<svg class="wx-art" viewBox="0 0 72 64" aria-hidden="true">${art}</svg>`;
}

const SKY_WORD = { sun: 'Sunny', part: 'Some cloud', cloud: 'Cloudy', rain: 'Rain', storm: 'Storms', fog: 'Fog', night: 'Clear night', 'night-cloud': 'Cloudy night' };

/** The drawing and the temperature, beside the line. */
export function weatherHtml(c) {
  if (!c) return '';
  return `${skyArt(skyOf(c))}<b class="wx-t">${Math.round(c.tempC)}°</b>`;
}
/** Under the line: where the reading is from, the sky and the wind. */
export function weatherSub(c, place = '') {
  if (!c) return '';
  return `${place ? `Live at ${esc(place)}. ` : 'Live where you are. '}${SKY_WORD[skyOf(c)]}, wind ${Math.round(c.windMph)} mph${c.windFrom != null ? ` ${compass(c.windFrom)}` : ''}.`;
}

/** "Emirates Golf Club – Majlis" → "Emirates – Majlis"; "Dubai Creek Golf & Yacht Club – Championship" → "Dubai Creek". */
export const clubName = (name) => { const club = String(name || '').split(/\s[–-]\s/)[0]; return club.replace(/\s*(Golf\s*(&|and)\s*(Yacht|Country)\s*Club|Golf\s*Club|Golf\s*Resort|Golf\s*Estates|Golf\s*Course|Country\s*Club)\b/i, '').replace(/^The\s+/i, '').trim() || club; };
export function shortCourse(name) {
  const layout = String(name || '').split(/\s[–-]\s/)[1];
  const c = clubName(name);
  return layout && !/^championship$/i.test(layout) ? `${c} – ${layout}` : c;
}

/**
 * The hero. groups: your courses (course.js groupCourses), most recent first. today: a round scheduled
 * for today, if any (gets a Start button). The weather is filled in after with fillWeather().
 */
export function heroHtml({ name = '', groups = [], today = null, cond = null, place = '' } = {}) {
  const picks = groups.slice(0, 3);
  return `<section class="hero-play">
    <div class="hp-top"><div><h1 class="hp-line" data-hpline>${esc(greeting(cond, name))}</h1><p class="hp-sub" data-hpsub>${weatherSub(cond, place)}</p></div><div class="hp-wx" data-hpwx>${weatherHtml(cond)}</div></div>
    ${today ? `<button class="btn primary big hp-today" data-act="evstart" data-id="${today.id}">Start your ${esc(new Date(today.when).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))} at ${esc(shortCourse(today.courseName))}</button>` : ''}
    <div class="hp-q" data-hpq>${today ? 'Or somewhere else?' : 'Where are we playing?'}</div>
    <div class="hp-courses" data-hpcourses>${tilesHtml(picks)}
</div>
    <button class="hp-find" data-act="library">+ ${picks.length ? 'Another course' : 'Find your course'}</button>
  </section>`;
}

const lastPlayed = (g) => Math.max(0, ...(g.variants || []).map((c) => c.lastPlayed || 0));
const when = (t) => { if (!t) return 'Not played yet'; const days = Math.floor((Date.now() - t) / 864e5); return days < 1 ? 'Played today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
const tilesHtml = (picks) => picks.map((g) => `<button class="hp-course" data-course="${esc(g.key)}">${badgeHtml(g.name, null, { attrs: `data-thumb="${esc(g.key)}"` })}<b>${esc(shortCourse(g.name))}</b><small>${when(lastPlayed(g))}</small></button>`).join('');

export const AWAY_KM = 150; // further than this from every course you've played: you're travelling
export const AT_KM = 2; // this close to one of your courses: you're there

/**
 * Where you are against your courses. here: [lat, lon] or null (only when location is already allowed —
 * never asked for from Play). courses: [{ group, lat, lon }]. Returns { mode: 'home' | 'at' | 'away', at }.
 */
export function whereAmI(here, courses) {
  if (!here) return { mode: 'home', at: null };
  const d = courses.filter((c) => c.lat != null).map((c) => ({ ...c, km: metres(here, [c.lat, c.lon]) / 1000 })).sort((a, b) => a.km - b.km);
  if (!d.length) return { mode: 'home', at: null };
  if (d[0].km > AWAY_KM) return { mode: 'away', at: null };
  return { mode: d[0].km <= AT_KM ? 'at' : 'home', at: d[0].km <= AT_KM ? d[0].group : null };
}

/** Travelling: your usual courses step aside for the ones near you. At a course: it goes first. */
export function placeHero(root, where, groups) {
  const q = root.querySelector('[data-hpq]'), tiles = root.querySelector('[data-hpcourses]'), find = root.querySelector('.hp-find');
  if (!q || !tiles) return false;
  if (where.mode === 'away') {
    q.textContent = 'Away from home? Where are we playing?';
    tiles.innerHTML = '';
    if (find) find.textContent = '+ Find a course near you';
    return true;
  }
  if (where.mode === 'at' && where.at) {
    tiles.innerHTML = tilesHtml([where.at, ...groups.filter((g) => g !== where.at)].slice(0, 3));
    return true;
  }
  return false;
}

/** Fill in the weather once it arrives (or leave the friendly fallback line if it doesn't). */
export function fillWeather(root, cond, { name = '', place = '' } = {}) {
  const line = root.querySelector('[data-hpline]'), wx = root.querySelector('[data-hpwx]'), sub = root.querySelector('[data-hpsub]');
  if (!line || !wx || !cond) return;
  line.textContent = greeting(cond, name);
  wx.innerHTML = weatherHtml(cond);
  if (sub) sub.textContent = weatherSub(cond, place);
}

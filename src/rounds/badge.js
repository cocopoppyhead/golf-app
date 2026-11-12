// A course's badge: the club's logo when osolo ships one (public/logos), else a two-letter monogram on a
// colour taken from the name, so every course has a recognisable mark without fetching anything.
const GENERIC = new Set(['the', 'golf', 'club', 'country', 'and', '&', 'resort', 'course', 'yacht']);
const PLACE = new Set(['dubai', 'abu', 'dhabi', 'uae']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Two letters: "The Montgomerie Golf Club Dubai" → MO, "Abu Dhabi Golf Club – Garden" → AD, "Yas Links Abu Dhabi" → YL. */
export function monogram(name) {
  const base = String(name || '?').split(/\s[–-]\s|\s\(/)[0];
  let w = base.split(/[\s,]+/).filter((x) => x && /^[a-z]/i.test(x) && !GENERIC.has(x.toLowerCase()));
  while (w.length > 1 && PLACE.has(w[w.length - 1].toLowerCase()) && !w.every((x) => PLACE.has(x.toLowerCase()))) w.pop();
  if (!w.length) w = [base];
  return (w.length >= 2 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const BASE = import.meta.env?.BASE_URL || '/';
/** HTML for a badge. `logo` is a path under public/ (from the course library). */
export function badgeHtml(name, logo, { cls = '', attrs = '' } = {}) {
  return logo
    ? `<div class="clogo haslogo ${/-fill\.png$/.test(logo) ? 'fill' : ''} ${cls}" ${attrs}><img src="${BASE}${esc(logo)}" alt="" loading="lazy" /></div>`
    : `<div class="clogo ${cls}" ${attrs} style="--h:${hue(name)}"><span>${esc(monogram(name))}</span></div>`;
}

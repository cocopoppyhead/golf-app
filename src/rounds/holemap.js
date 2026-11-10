// Hole map: satellite imagery underneath, the course's OpenStreetMap shapes on top (greens, tees,
// bunkers, water, fairways) where we have them, and your own club distances drawn as arcs — from
// the tee (where each club lands) and back from the green (where a full wedge is left from).
// Front / centre / back of the green from where you stand (GPS) or from the tee, and tap anywhere
// to measure. Courses without OSM shapes get the same arcs on a plain yardage strip.
import { dist as D, du } from '../units.js';

const BASE = import.meta.env.BASE_URL;
const TILE = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics · Map data © OpenStreetMap contributors';
const YD = 0.9144;
const R = 6371000, rad = Math.PI / 180;

// ---------- course geometry files ----------
const geoCache = new Map();
/** Per-course geometry built from OSM (scripts/osm/build.mjs), or null when the course isn't mapped. */
export function loadGeo(libId) {
  if (!libId) return Promise.resolve(null);
  if (!geoCache.has(libId)) geoCache.set(libId, fetch(`${BASE}courses/osm/${libId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return geoCache.get(libId);
}
export const geoHole = (geo, n) => geo?.holes?.find((h) => h.n === n) || null;

// ---------- maths ----------
const mPerLat = R * rad, mPerLon = (lat) => R * rad * Math.cos(lat * rad);
const metres = (a, b) => Math.hypot((b[1] - a[1]) * mPerLon((a[0] + b[0]) / 2), (b[0] - a[0]) * mPerLat);
const bearing = (a, b) => Math.atan2((b[1] - a[1]) * mPerLon(a[0]), (b[0] - a[0]) * mPerLat); // radians, 0 = north, clockwise
/** Which mapped tee matches the card? The one whose distance to the green is nearest the card yardage. */
export function pickTee(gh, yds, teeName) {
  if (!gh) return null;
  const tees = gh.tees || [];
  if (teeName) { const byName = tees.find((t) => t.name && t.name.toLowerCase() === teeName.toLowerCase()); if (byName) return byName.c; }
  const g = gh.green?.c || gh.line[gh.line.length - 1];
  if (tees.length && yds) { let best = null, err = Infinity; for (const t of tees) { const e = Math.abs(metres(t.c, g) - yds * YD); if (e < err) { err = e; best = t.c; } } if (best) return best; }
  return gh.line[0];
}

// ---------- shared GPS watch (one for the whole app; stops when no map is on screen) ----------
let fix = null, watchId = null, lastUse = 0, fixListeners = new Set();
let lastMode = 'tee'; // Tee / Green / Off survives re-renders of the hole screen
function wantGps() {
  lastUse = Date.now();
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition((p) => {
    fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    fixListeners.forEach((f) => f(fix));
  }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  const tick = setInterval(() => { if (Date.now() - lastUse > 20000) { navigator.geolocation.clearWatch(watchId); watchId = null; clearInterval(tick); } }, 5000);
}
export const currentFix = () => fix;

// ---------- tiles ----------
const tiles = new Map(); // url -> Image (loaded or loading)
function tile(z, x, y, onload) {
  const u = TILE(z, x, y);
  let img = tiles.get(u);
  if (!img) { img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => onload?.(); img.src = u; tiles.set(u, img); }
  else if (!img.complete) img.addEventListener('load', () => onload?.(), { once: true });
  return img.complete && img.naturalWidth ? img : null;
}
const merc = (lat, lon, z) => { const n = 2 ** z; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2) * n]; };
const unmerc = (tx, ty, z) => { const n = 2 ** z; return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / rad), (tx / n) * 360 - 180]; };

/**
 * Mount a hole map into `el`. Returns { update(opts), destroy() }.
 * opts: { gh (geo hole or null), geo (whole course, for neighbouring features), par, yds, teeName,
 *         clubs: [{club, carry}] in yards, onMeasure(text) }
 */
export function mountHoleMap(el, opts) {
  el.classList.add('holemap');
  el.innerHTML = `<div class="hm-top"><div class="hm-dist"></div><div class="hm-mode">${[['tee', 'Tee'], ['green', 'Green'], ['off', 'Off']].map(([v, l]) => `<button data-m="${v}" class="${lastMode === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <canvas></canvas><div class="hm-tap mute small"></div><div class="hm-attr">${ATTRIBUTION}</div>`;
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const distEl = el.querySelector('.hm-dist'), tapEl = el.querySelector('.hm-tap');
  let o = { ...opts }, mode = lastMode, tap = null, raf = 0;
  let frame = null; // {T, G, theta, s, W, H, cx, cy, z, project}
  const unitLabel = () => du();
  const fmt = (m) => `${D(m / YD)}`;

  const layout = () => {
    const W = el.clientWidth || 360; const H = Math.max(240, Math.min(440, Math.round(W * 1.1)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
    const gh = o.gh;
    if (gh) {
      const T = pickTee(gh, o.yds, o.teeName); let G = gh.green?.c || gh.line[gh.line.length - 1];
      // no mapped green and a hole line much shorter than the card: OSM stopped short, so put the green
      // where the card says it is, along the line's final bearing, and say so
      o.approxGreen = false;
      if (!gh.green && o.yds && Math.abs(metres(T, G) - o.yds * YD) > o.yds * YD * 0.2) {
        const end = gh.line[gh.line.length - 1], from = gh.line.length > 2 ? gh.line[gh.line.length - 2] : T; const b = bearing(from, end); const L = o.yds * YD - metres(T, end);
        G = [end[0] + (L * Math.cos(b)) / mPerLat, end[1] + (L * Math.sin(b)) / mPerLon(end[0])]; o.approxGreen = true;
      }
      const theta = bearing(T, G);
      const project = (p) => { // local metres from T, rotated so the hole points up: returns [x right, y up]
        const ex = (p[1] - T[1]) * mPerLon(T[0]), ny = (p[0] - T[0]) * mPerLat;
        return [ex * Math.cos(theta) - ny * Math.sin(theta), ex * Math.sin(theta) + ny * Math.cos(theta)];
      };
      // extent: the hole line, its green and tees, plus the features attached to it
      const pts = [...gh.line, ...(gh.green?.poly || []), ...gh.tees.flatMap((t) => t.poly), ...['bunkers', 'water', 'fairways'].flatMap((k) => (o.geo?.[k] || []).filter((f) => f.h === gh.n).flatMap((f) => f.poly))].map(project);
      let x0 = -60, x1 = 60, y0 = -30, y1 = metres(T, G) + 30;
      for (const [x, y] of pts) { x0 = Math.min(x0, x - 15); x1 = Math.max(x1, x + 15); y0 = Math.min(y0, y - 15); y1 = Math.max(y1, y + 15); }
      const s = Math.min((W - 8) / (x1 - x0), (H - 8) / (y1 - y0)); // px per metre
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const mpp = 1 / (s * dpr); const z = Math.max(15, Math.min(19, Math.round(Math.log2((156543.03 * Math.cos(T[0] * rad)) / mpp))));
      frame = { T, G, theta, s, W, H, cx, cy, z, dpr, project, toPx: ([x, y]) => [(W / 2 + (x - cx) * s), (H / 2 - (y - cy) * s)] };
    } else frame = { W, H, dpr, s: null };
  };

  const toLatLon = (px, py) => { // canvas px -> lat/lon (inverse of project) for tap measuring
    const f = frame; const x = (px - f.W / 2) / f.s + f.cx, y = (f.H / 2 - py) / f.s + f.cy;
    const ex = x * Math.cos(-f.theta) - y * Math.sin(-f.theta), ny = x * Math.sin(-f.theta) + y * Math.cos(-f.theta);
    return [f.T[0] + ny / mPerLat, f.T[1] + ex / mPerLon(f.T[0])];
  };

  const refPoint = () => { // where distances are measured from: a fresh, accurate fix near the hole, else the tee
    const f = fix; if (!frame?.T || !f || f.acc > 35 || Date.now() - f.t > 20000) return { p: frame?.T, gps: false };
    return metres([f.lat, f.lon], frame.T) < 1500 ? { p: [f.lat, f.lon], gps: true } : { p: frame.T, gps: false };
  };

  function draw() {
    raf = 0; if (!frame) layout();
    const f = frame, { W, H, dpr } = f;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1d2a1f'; ctx.fillRect(0, 0, W, H);
    if (!f.s) return drawStrip();
    const { T, G, z, toPx, project } = f;
    // satellite tiles under the frame: walk the mercator tiles covering the canvas corners
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => toLatLon(x, y)).map((ll) => merc(ll[0], ll[1], z));
    const tx0 = Math.floor(Math.min(...corners.map((c) => c[0]))), tx1 = Math.floor(Math.max(...corners.map((c) => c[0])));
    const ty0 = Math.floor(Math.min(...corners.map((c) => c[1]))), ty1 = Math.floor(Math.max(...corners.map((c) => c[1])));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 40) {
      for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
        const img = tile(z, x, y, schedule); if (!img) continue;
        const nw = toPx(project(unmerc(x, y, z))), ne = toPx(project(unmerc(x + 1, y, z))), sw = toPx(project(unmerc(x, y + 1, z)));
        ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.transform((ne[0] - nw[0]) / 256, (ne[1] - nw[1]) / 256, (sw[0] - nw[0]) / 256, (sw[1] - nw[1]) / 256, nw[0], nw[1]);
        ctx.drawImage(img, 0, 0); ctx.restore();
      }
    }
    // OSM shapes
    const poly = (ring, fill, stroke) => { ctx.beginPath(); ring.forEach((p, i) => { const [x, y] = toPx(project(p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    const near = (k) => (o.geo?.[k] || []).filter((x) => x.h === o.gh.n || metres(x.c, T) < 450 || metres(x.c, G) < 300);
    near('fairways').forEach((x) => poly(x.poly, 'rgba(120,200,90,.14)'));
    near('water').forEach((x) => poly(x.poly, 'rgba(70,150,235,.45)', 'rgba(140,200,255,.7)'));
    near('bunkers').forEach((x) => poly(x.poly, 'rgba(240,222,160,.8)', 'rgba(255,245,200,.9)'));
    (o.geo?.holes || []).forEach((h) => { if (h.n !== o.gh.n && h.green && metres(h.green.c, G) < 500) poly(h.green.poly, 'rgba(150,230,150,.35)'); });
    o.gh.tees.forEach((t) => poly(t.poly, 'rgba(120,180,255,.55)', 'rgba(200,225,255,.9)'));
    if (o.gh.green) poly(o.gh.green.poly, 'rgba(150,235,150,.55)', 'rgba(220,255,220,.95)');
    else { const [gx, gy] = toPx(project(G)); ctx.beginPath(); ctx.arc(gx, gy, 9, 0, 7); ctx.strokeStyle = 'rgba(220,255,220,.95)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    // hole line
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5; ctx.beginPath();
    o.gh.line.forEach((p, i) => { const [x, y] = toPx(project(p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
    // club arcs
    const ref = refPoint();
    const arcs = (centre, list, dir, color) => { // dir +1: fan up the hole from centre; -1: fan back from the green
      const [cx0, cy0] = toPx(project(centre)); const base = dir > 0 ? -Math.PI / 2 : Math.PI / 2; const half = 0.5;
      ctx.font = `600 11px Inter, system-ui`; ctx.textAlign = 'left';
      for (const c of list) {
        const r = c.carry * YD * f.s; if (r < 18 || r > Math.max(W, H) * 1.4) continue;
        ctx.beginPath(); ctx.arc(cx0, cy0, r, base - half, base + half); ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(dir > 0 ? [] : [3, 4]); ctx.stroke(); ctx.setLineDash([]);
        const lx = cx0 + r * Math.cos(base + half) + 3, ly = cy0 + r * Math.sin(base + half) + 4;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; const label = `${c.club} ${D(c.carry)}`; const w = ctx.measureText(label).width + 6;
        ctx.fillRect(lx - 3, ly - 11, w, 14); ctx.fillStyle = color; ctx.fillText(label, lx, ly);
      }
    };
    const clubs = (o.clubs || []).filter((c) => c.carry > 0);
    if (mode === 'tee') arcs(ref.p, clubs.filter((c) => o.par === 3 ? true : c.carry >= 120), 1, '#ffd23f');
    if (mode === 'green') arcs(G, clubs.filter((c) => c.carry <= 150), -1, '#8fd3ff');
    // you
    if (ref.gps) { const [x, y] = toPx(project(ref.p)); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#3ddc84'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    // tap marker + lines
    if (tap) {
      const [x, y] = toPx(project(tap)); const [rx, ry] = toPx(project(ref.p)); const [gx, gy] = toPx(project(G));
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(x, y); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    // distances to the green
    const g = o.gh.green;
    const cell = (v, l, c) => `<div><b${c ? ' class="c"' : ''}>${v}</b><span>${l}</span></div>`;
    const dTxt = g ? cell(fmt(metres(ref.p, g.f)), 'front') + cell(fmt(metres(ref.p, g.c)), 'centre', true) + cell(fmt(metres(ref.p, g.b)), 'back') : cell(`${o.approxGreen ? '≈ ' : ''}${fmt(metres(ref.p, G))}`, 'to green', true);
    distEl.innerHTML = `${dTxt}<span class="src">${ref.gps ? '📍 from you' : 'from the tee'} · ${unitLabel()}${o.approxGreen ? ' · green placed from the card, not mapped' : ''}</span>`;
    tapEl.textContent = tap ? `Tap: ${fmt(metres(ref.p, tap))} ${unitLabel()} out · ${fmt(metres(tap, G))} ${unitLabel()} to the green${g ? ` · ${fmt(metres(tap, g.f))} front` : ''}` : 'Tap the map to measure. Arcs are your club carries.';
    wantGps();
  }

  function drawStrip() { // no OSM geometry: a plain yardage strip with the same arcs
    const f = frame, { W, H } = f; const yds = o.yds || 0;
    if (!yds) { distEl.innerHTML = '<span class="src">No map for this course yet</span>'; tapEl.textContent = ''; return; }
    const top = 36, bottom = H - 30, s = (bottom - top) / (yds * YD);
    const cx0 = W / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(cx0, bottom); ctx.lineTo(cx0, top); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(150,235,150,.7)'; ctx.beginPath(); ctx.ellipse(cx0, top, 26, 16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,180,255,.7)'; ctx.fillRect(cx0 - 18, bottom - 6, 36, 12);
    ctx.font = '600 11px Inter, system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    for (let y = 50; y < yds; y += 50) { const py = bottom - y * YD * s; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx0 - 40, py, 80, 1); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(`${D(y)}`, cx0 + 44, py + 4); }
    const clubs = (o.clubs || []).filter((c) => c.carry > 0);
    const arcs = (fromTee, list, color) => { for (const c of list) { const r = c.carry * YD * s; const cy0 = fromTee ? bottom : top; const base = fromTee ? -Math.PI / 2 : Math.PI / 2; ctx.beginPath(); ctx.arc(cx0, cy0, r, base - 0.5, base + 0.5); ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(fromTee ? [] : [3, 4]); ctx.stroke(); ctx.setLineDash([]); const lx = cx0 + r * Math.cos(base + 0.5) + 3, ly = cy0 + r * Math.sin(base + 0.5) + 4; ctx.fillStyle = 'rgba(0,0,0,.55)'; const label = `${c.club} ${D(c.carry)}`; ctx.fillRect(lx - 3, ly - 11, ctx.measureText(label).width + 6, 14); ctx.fillStyle = color; ctx.fillText(label, lx, ly); } };
    if (mode === 'tee') arcs(true, clubs.filter((c) => o.par === 3 || c.carry >= 120), '#ffd23f');
    if (mode === 'green') arcs(false, clubs.filter((c) => c.carry <= 150), '#8fd3ff');
    distEl.innerHTML = `<div><b class="c">${D(yds)}</b><span>card</span></div><span class="src">no map for this course · ${unitLabel()}</span>`;
    tapEl.textContent = 'This course has no map shapes yet, so this is the card yardage with your club arcs.';
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = lastMode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); schedule(); });
  cv.addEventListener('click', (e) => { if (!frame?.s) return; const r = cv.getBoundingClientRect(); const p = toLatLon(e.clientX - r.left, e.clientY - r.top); tap = tap && metres(tap, p) < 8 ? null : p; schedule(); });
  const onFix = () => schedule(); fixListeners.add(onFix);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { frame = null; schedule(); }) : null; ro?.observe(el);
  layout(); schedule();
  return {
    update(next) { o = { ...o, ...next }; frame = null; tap = null; schedule(); },
    destroy() { fixListeners.delete(onFix); ro?.disconnect(); cancelAnimationFrame(raf); },
  };
}

// Hole map: satellite imagery underneath, the course's OpenStreetMap shapes on top (greens, tees,
// bunkers, water, fairways) where we have them, and your own club distances drawn as arcs — from
// the tee (where each club lands) and back from the green (where a full wedge is left from).
// Front / centre / back of the green from where you stand (GPS) or from the tee, and tap anywhere
// to measure. Courses without OSM shapes get the same arcs on a plain yardage strip.
import { dist as D, du } from '../units.js';
import { getSettings, saveSettings } from '../store.js';
import { windComponents, carryFactor } from '../weather.js';
import { holeElevations, elevationYards } from '../elevation.js';
import { YD, mPerLat, mPerLon, metres, bearing, destination, inRing, merc, unmerc, zoomFor } from '../geo.js';

const BASE = import.meta.env.BASE_URL;
const TILE = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics · Map data © OpenStreetMap contributors';

// ---------- course geometry files ----------
const geoCache = new Map();
/** Per-course geometry built from OSM (scripts/osm/build.mjs), or null when the course isn't mapped. */
export function loadGeo(libId) {
  if (!libId) return Promise.resolve(null);
  if (!geoCache.has(libId)) geoCache.set(libId, fetch(`${BASE}courses/osm/${libId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return geoCache.get(libId);
}
export const geoHole = (geo, n) => geo?.holes?.find((h) => h.n === n) || null;

// ---------- which clubs to draw ----------
const kind = (name) => (/driver/i.test(name) ? 'driver' : /wood/i.test(name) ? 'wood' : /hybrid|rescue|utility/i.test(name) ? 'hybrid' : /iron|\d\s*i$/i.test(name) ? 'iron' : 'wedge');
/**
 * Tee shot options worth drawing: driver, the fairway woods (up to two), then the longest hybrid
 * or iron you carry — three or four clubs, not the whole bag. Par 3, or from the fairway: the
 * club for the plays-like distance and one either side.
 */
export function teeClubs(clubs, { par = 4, toGo = null } = {}) {
  const list = clubs.filter((c) => c.carry > 0).sort((a, b) => b.carry - a.carry);
  if (!list.length) return [];
  if (par === 3 || (toGo && toGo < 240)) { // one shot to the green: the club for the distance and one either side
    if (!toGo) return list.slice(-3);
    let i = list.findIndex((c) => c.carry <= toGo); if (i < 0) i = list.length - 1;
    const from = Math.max(0, Math.min(i - 1, list.length - 3));
    return list.slice(from, from + 3);
  }
  const out = [];
  const d = list.find((c) => kind(c.club) === 'driver'); if (d) out.push(d);
  out.push(...list.filter((c) => kind(c.club) === 'wood').slice(0, 2));
  for (const k of ['hybrid', 'iron']) { if (out.length >= 4) break; const c = list.find((x) => kind(x.club) === k && !out.includes(x)); if (c) out.push(c); }
  return out.slice(0, 4);
}
/** The point `m` metres along a polyline from its start (clamped to the end). */
export function alongLine(line, m) {
  let left = m;
  for (let i = 1; i < line.length; i++) {
    const seg = metres(line[i - 1], line[i]);
    if (left <= seg) { const t = seg ? left / seg : 0; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; }
    left -= seg;
  }
  return line[line.length - 1];
}
export const showLeave = () => getSettings().mapLeave !== false;

/** Carry or total on the arcs, and how firm the ground is when a total has to be estimated. */
export const distBasis = () => (getSettings().mapDist === 'total' ? 'total' : 'carry');
export const firmness = () => getSettings().mapFirm || 'normal';
// typical roll-out as a share of carry on normal ground: low, running drives roll; wedges stop
const ROLL = { driver: 0.1, wood: 0.08, hybrid: 0.06, iron: 0.035, wedge: 0.01 };
const FIRM = { soft: 0.5, normal: 1, firm: 1.6 };
/** The distance an arc is drawn at: carry, or the club's total (typed/learned, else carry + estimated roll). */
export function arcDistance(c, basis = distBasis(), firm = firmness()) {
  if (basis !== 'total') return c.carry;
  if (c.total > 0) return c.total;
  return Math.round(c.carry * (1 + ROLL[kind(c.club)] * (FIRM[firm] || 1)));
}
/** Clubs with `carry` replaced by the chosen basis (so every arc routine stays in one unit). */
const withBasis = (clubs) => { const b = distBasis(), f = firmness(); return clubs.map((c) => ({ ...c, carry: arcDistance(c, b, f), carryReal: c.carry })); };

/**
 * What a shot plays in these conditions: air (temperature, humidity, pressure), wind along the
 * shot's bearing, and the rise to the target. yards in, yards out, with the reasons.
 */
export function playsLike(yards, { cond = null, bearingDeg = null, riseM = null } = {}) {
  const wind = windComponents(cond, { heading: bearingDeg });
  const f = carryFactor(cond, wind);
  const elev = elevationYards(riseM);
  const plays = Math.round(yards / f + elev);
  const why = [];
  if (Number.isFinite(riseM) && Math.abs(riseM) >= 1.5) why.push(`${riseM > 0 ? '↑' : '↓'} ${Math.round(Math.abs(riseM) / 0.3048)} ft`);
  if (cond && Math.abs(wind.head) >= 2) why.push(`${Math.round(Math.abs(wind.head))} mph ${wind.head > 0 ? 'into' : 'behind'}`);
  if (cond && Math.abs((cond.tempC ?? 25) - 25) >= 6) why.push(`${Math.round(cond.tempC)}°C`);
  return { plays, factor: f, elev, wind, why };
}

// ---------- tee choice ----------
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
/** A fresh fix within `ms`: the watch's latest if recent, else one getCurrentPosition; null if neither. */
export function requestFix(ms = 3000) {
  wantGps();
  if (fix && Date.now() - fix.t < 8000) return Promise.resolve(fix);
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    const t = setTimeout(() => res(fix), ms);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; res(fix); }, () => { clearTimeout(t); res(fix); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: ms });
  });
}

// ---------- tiles ----------
const tiles = new Map(); // url -> Image (loaded or loading)
function tile(z, x, y, onload) {
  const u = TILE(z, x, y);
  let img = tiles.get(u);
  if (!img) { img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => onload?.(); img.src = u; tiles.set(u, img); }
  else if (!img.complete) img.addEventListener('load', () => onload?.(), { once: true });
  return img.complete && img.naturalWidth ? img : null;
}

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
  let elev = null; // { tee, green } metres for this hole, when known
  const loadElev = () => {
    elev = null; const gh = o.gh; if (!gh || !o.inGame) return;
    const holes = (o.geo?.holes || []).map((x) => ({ n: x.n, tee: x.line[0], green: x.green?.c || x.line[x.line.length - 1] }));
    if (!holes.some((x) => x.n === gh.n)) holes.push({ n: gh.n, tee: gh.line[0], green: gh.green?.c || gh.line[gh.line.length - 1] });
    holeElevations(o.geoId || o.geo?.id || o.courseId, holes).then((m) => { if (m[gh.n] && o.gh === gh) { elev = m[gh.n]; schedule(); } });
  };
  const unitLabel = () => du();
  const fmt = (m) => `${D(m / YD)}`;

  const layout = () => {
    const W = el.clientWidth || 360; const H = Math.max(240, Math.min(440, Math.round(W * 1.1)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`;
    const gh = o.gh;
    if (gh) {
      const T = pickTee(gh, o.yds, o.teeName); let G = gh.green?.c || gh.line[gh.line.length - 1];
      // no mapped green and a hole line far shorter than the card: the mapper stopped short, so put
      // the green where the card says it is, along the line's final bearing, and say so. A line a bit
      // short of the card is normal (a forward tee) and its end is trusted as the green.
      o.approxGreen = false;
      if (!gh.green && o.yds && metres(T, G) < o.yds * YD * 0.6) { // far shorter than the card: the line stops short
        const end = gh.line[gh.line.length - 1], from = gh.line.length > 2 ? gh.line[gh.line.length - 2] : T;
        G = destination(end, bearing(from, end), o.yds * YD - metres(T, end)); o.approxGreen = true;
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
      const z = zoomFor(T[0], 1 / (s * dpr), 15, 19);
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
    (o.geo?.holes || []).forEach((h) => { if (h.n !== o.gh.n && h.green?.poly && metres(h.green.c, G) < 500) poly(h.green.poly, 'rgba(150,230,150,.35)'); });
    (o.geo?.extraGreens || []).forEach((x) => { if (metres(x.c, G) < 500 || metres(x.c, T) < 500) poly(x.poly, metres(x.c, G) < 25 ? 'rgba(150,235,150,.55)' : 'rgba(150,230,150,.35)', metres(x.c, G) < 25 ? 'rgba(220,255,220,.95)' : null); });
    o.gh.tees.forEach((t) => poly(t.poly, 'rgba(120,180,255,.55)', 'rgba(200,225,255,.9)'));
    if (o.gh.green?.poly) poly(o.gh.green.poly, 'rgba(150,235,150,.55)', 'rgba(220,255,220,.95)');
    else { const [gx, gy] = toPx(project(G)); ctx.beginPath(); ctx.arc(gx, gy, 9, 0, 7); ctx.strokeStyle = 'rgba(220,255,220,.95)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
    // hole line
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5; ctx.beginPath();
    o.gh.line.forEach((p, i) => { const [x, y] = toPx(project(p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
    // club arcs
    const ref = refPoint();
    const leaveOn = showLeave();
    // Arcs are short: the fairway plus ~20 yards either side (±40 yd), centred on the hole line where
    // the ball lands, so a dogleg bends the fan with it.
    const HALF_W = 40 * YD;
    const arcs = (centre, list, dir, color) => { // dir +1: fan up the hole from centre; -1: fan back from the green
      const [cx0, cy0] = toPx(project(centre));
      ctx.font = `600 11px Inter, system-ui`; ctx.textAlign = 'left';
      let lastY = -99;
      for (const c of [...list].sort((a, b) => a.carry - b.carry)) { // shortest first so labels stack outward in order
        const r = c.carry * YD * f.s; if (r < 18 || r > Math.max(W, H) * 1.4) continue;
        // where this club lands: along the hole line from the tee, or back from the green along the line
        const path = dir > 0 ? [centre, ...o.gh.line.slice(1), G] : [G, ...[...o.gh.line].reverse()];
        const land = alongLine(path, c.carry * YD);
        const [lx2, ly2] = toPx(project(land));
        const base = Math.atan2(ly2 - cy0, lx2 - cx0);
        const half = Math.min(0.5, Math.atan2(HALF_W * f.s, r));
        ctx.beginPath(); ctx.arc(cx0, cy0, r, base - half, base + half); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash(dir > 0 ? [] : [3, 4]); ctx.stroke(); ctx.setLineDash([]);
        // from the tee: what that leaves to the middle of the green
        let leave = '';
        if (dir > 0 && leaveOn) { const togo = metres(land, G); if (togo > 25) leave = ` · ${D(togo / YD)} left`; }
        if (dir > 0) { ctx.beginPath(); ctx.arc(lx2, ly2, 3, 0, 7); ctx.fillStyle = color; ctx.fill(); }
        const lx = cx0 + r * Math.cos(base + half) + 4; let ly = cy0 + r * Math.sin(base + half) + 4;
        if (lastY > -99 && Math.abs(ly - lastY) < 15) ly = lastY + (dir > 0 ? -15 : 15); lastY = ly; // keep labels from stacking
        ctx.fillStyle = 'rgba(0,0,0,.6)'; const label = `${c.club} ${c.carryReal != null && c.carry !== c.carryReal && !c.total ? '≈' : ''}${D(c.carry)}${leave}`; const w = ctx.measureText(label).width + 6;
        ctx.fillRect(lx - 3, ly - 11, w, 14); ctx.fillStyle = color; ctx.fillText(label, lx, ly);
      }
    };
    const clubs = withBasis((o.clubs || []).filter((c) => c.carry > 0));
    const centreYds = metres(ref.p, G) / YD;
    const pl = o.inGame ? playsLike(centreYds, { cond: o.cond, bearingDeg: (bearing(ref.p, G) * 180) / Math.PI, riseM: elev ? elev.green - elev.tee : null }) : null;
    if (mode === 'tee') arcs(ref.p, teeClubs(clubs, { par: o.par, toGo: o.par === 3 || ref.gps ? (pl ? pl.plays : centreYds) : null }), 1, '#ffd23f');
    if (mode === 'green') arcs(G, clubs.filter((c) => c.carry <= 150).sort((a, b) => b.carry - a.carry).slice(0, 4), -1, '#8fd3ff');
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
    const real = g?.poly && !g.marked;
    // no green outline: front and back assumed 15 yards either side of the centre along the line in
    const last = o.gh.line[o.gh.line.length - 1]; const from = metres(last, G) < 5 ? o.gh.line[Math.max(0, o.gh.line.length - 2)] : last;
    const inb = bearing(from, G); // direction the hole comes into the green
    const F = real ? g.f : destination(G, inb + Math.PI, 15 * YD), B = real ? g.b : destination(G, inb, 15 * YD);
    const pre = real ? '' : '≈ ';
    const dTxt = cell(pre + fmt(metres(ref.p, F)), 'front') + cell(pre + fmt(metres(ref.p, G)), 'centre', true) + cell(pre + fmt(metres(ref.p, B)), 'back');
    const playsTxt = pl && pl.plays !== Math.round(centreYds) ? `<div class="pl"><b>${D(pl.plays)}</b><span>plays</span></div>` : '';
    distEl.innerHTML = `${dTxt}${playsTxt}<span class="src">${ref.gps ? 'from where you stand' : 'from the tee'} · ${unitLabel()}${pl?.why.length ? ` · ${pl.why.join(' · ')}` : ''}${o.approxGreen ? ' · green placed from the card, not mapped' : !real ? ' · green depth assumed' : ''}</span>`;
    tapEl.innerHTML = tap ? `Tap: ${fmt(metres(ref.p, tap))} ${unitLabel()} out · ${fmt(metres(tap, G))} ${unitLabel()} to the green · ${fmt(metres(tap, F))} front` : `${mode === 'tee' && o.par !== 3 ? `<label class="check inl"><input type="checkbox" data-leave ${leaveOn ? 'checked' : ''}/> what each club leaves</label>` : 'Tap the map to measure.'}${o.gh.marked ? ' <button class="link" data-mark>Re-mark</button>' : o.approxGreen && o.canMark ? ' <button class="link acc" data-mark>Mark the green</button>' : ''}`;
    tapEl.querySelector('[data-mark]')?.addEventListener('click', () => o.onMark?.());
    tapEl.querySelector('[data-leave]')?.addEventListener('change', (e) => { const s = getSettings(); s.mapLeave = e.target.checked; saveSettings(s); schedule(); });
    basisRow();
    wantGps();
  }

  function drawStrip() { // no OSM geometry: a plain yardage strip with the same arcs
    const f = frame, { W, H } = f; const yds = o.yds || 0;
    if (!yds) { distEl.innerHTML = '<span class="src">No map for this course yet</span>'; tapEl.innerHTML = o.canMark ? '<button class="link acc" data-mark>Mark this hole on the satellite map</button>' : ''; tapEl.querySelector('[data-mark]')?.addEventListener('click', () => o.onMark?.()); return; }
    const top = 36, bottom = H - 30, s = (bottom - top) / (yds * YD);
    const cx0 = W / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(cx0, bottom); ctx.lineTo(cx0, top); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(150,235,150,.7)'; ctx.beginPath(); ctx.ellipse(cx0, top, 26, 16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,180,255,.7)'; ctx.fillRect(cx0 - 18, bottom - 6, 36, 12);
    ctx.font = '600 11px Inter, system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    for (let y = 50; y < yds; y += 50) { const py = bottom - y * YD * s; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(cx0 - 40, py, 80, 1); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(`${D(y)}`, cx0 + 44, py + 4); }
    const clubs = withBasis((o.clubs || []).filter((c) => c.carry > 0));
    const arcs = (fromTee, list, color) => { let lastY = -99; for (const c of [...list].sort((a, b) => a.carry - b.carry)) { const r = c.carry * YD * s; const cy0 = fromTee ? bottom : top; const base = fromTee ? -Math.PI / 2 : Math.PI / 2; const half = Math.min(0.5, Math.atan2(40 * YD * s, r)); ctx.beginPath(); ctx.arc(cx0, cy0, r, base - half, base + half); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash(fromTee ? [] : [3, 4]); ctx.stroke(); ctx.setLineDash([]); const lx = cx0 + r * Math.cos(base + half) + 4; let ly = cy0 + r * Math.sin(base + half) + 4; if (lastY > -99 && Math.abs(ly - lastY) < 15) ly = lastY + (fromTee ? -15 : 15); lastY = ly; const leave = fromTee && showLeave() && yds - c.carry > 25 ? ` · ${D(yds - c.carry)} left` : ''; ctx.fillStyle = 'rgba(0,0,0,.6)'; const label = `${c.club} ${D(c.carry)}${leave}`; ctx.fillRect(lx - 3, ly - 11, ctx.measureText(label).width + 6, 14); ctx.fillStyle = color; ctx.fillText(label, lx, ly); } };
    if (mode === 'tee') arcs(true, teeClubs(clubs, { par: o.par }), '#ffd23f');
    if (mode === 'green') arcs(false, clubs.filter((c) => c.carry <= 150).sort((a, b) => b.carry - a.carry).slice(0, 4), '#8fd3ff');
    distEl.innerHTML = `<div><b class="c">${D(yds)}</b><span>card</span></div><span class="src">no map for this course · ${unitLabel()}</span>`;
    tapEl.innerHTML = `No map shapes for this course yet, so this is the card yardage with your club arcs.${o.canMark ? ' <button class="link acc" data-mark>Mark this hole on the satellite map</button>' : ''}`;
    tapEl.querySelector('[data-mark]')?.addEventListener('click', () => o.onMark?.());
    basisRow();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  // Carry / Total under the map (and how firm the fairways are when a total has to be estimated)
  function basisRow() {
    let row = el.querySelector('.hm-basis');
    if (!row) { row = document.createElement('div'); row.className = 'hm-basis'; el.querySelector('.hm-attr').before(row); }
    if (mode === 'off') { row.innerHTML = ''; return; }
    const b = distBasis(), f = firmness();
    row.innerHTML = `<span class="mute small">Arcs:</span><div class="hm-mode sm">${[['carry', 'Carry'], ['total', 'Total']].map(([v, l]) => `<button data-basis="${v}" class="${b === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${b === 'total' ? `<span class="mute small">ground:</span><div class="hm-mode sm">${[['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']].map(([v, l]) => `<button data-firm="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}`;
    row.querySelectorAll('[data-basis]').forEach((x) => x.onclick = () => { const s = getSettings(); s.mapDist = x.dataset.basis; saveSettings(s); schedule(); });
    row.querySelectorAll('[data-firm]').forEach((x) => x.onclick = () => { const s = getSettings(); s.mapFirm = x.dataset.firm; saveSettings(s); schedule(); });
  }

  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = lastMode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); schedule(); });
  cv.addEventListener('click', (e) => { if (!frame?.s) return; const r = cv.getBoundingClientRect(); const p = toLatLon(e.clientX - r.left, e.clientY - r.top); tap = tap && metres(tap, p) < 8 ? null : p; schedule(); });
  const onFix = () => schedule(); fixListeners.add(onFix);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { frame = null; schedule(); }) : null; ro?.observe(el);
  layout(); loadElev(); schedule();
  return {
    update(next) { o = { ...o, ...next }; frame = null; tap = null; loadElev(); schedule(); },
    destroy() { fixListeners.delete(onFix); ro?.disconnect(); cancelAnimationFrame(raf); },
  };
}

// ---------- marking a hole yourself (courses OSM hasn't mapped) ----------
/** A hole the golfer marked (tee + green centre) in the same shape as an OSM hole. */
export function markedHole(mark, n) {
  if (!mark?.tee || !mark?.green) return null;
  return { n, line: [mark.tee, mark.green], tees: [], green: { c: mark.green, f: mark.green, b: mark.green, poly: null, marked: true }, marked: true };
}

/**
 * Full-screen map to mark a hole's tee and green centre by tapping: drag to pan, pinch or +/− to
 * zoom. Two taps per hole; "Next hole" carries straight on. onSave(i, {tee, green}) persists.
 */
export function markHoleSheet({ course, start = 0, geo = null, onSave, onClose }) {
  let i = start, step = 'tee', draft = {};
  const holes = course.holes;
  const el = document.createElement('div'); el.className = 'onb markmap';
  el.innerHTML = `<div class="onb-in"><div class="onb-top"><b class="mk-title"></b><button class="link" data-close>Done</button></div>
    <div class="mk-wrap"><canvas></canvas>
      <div class="mk-zoom"><button data-z="1">+</button><button data-z="-1">−</button></div>
      <div class="mk-hint small"></div></div>
    <div class="row mk-btns"><button class="btn" data-undo>Undo</button><button class="btn" data-skip>Skip hole</button><button class="btn primary" data-next disabled>Next hole ›</button></div>
    <div class="hm-attr">${ATTRIBUTION}</div></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const title = el.querySelector('.mk-title'), hint = el.querySelector('.mk-hint');
  // view: centre lat/lon, span (metres across the canvas width), north up
  const firstFix = () => { const m = holes.map((h) => h.mark).filter((m) => m?.green); const prev = holes[i - 1]?.mark?.green || m[m.length - 1]; return prev ? { c: prev, span: 450 } : { c: [course.lat, course.lon], span: 1500 }; };
  let view = firstFix();
  let raf = 0, W = 0, H = 0, dpr = 1;
  const kx = () => mPerLon(view.c[0]), ky = mPerLat;
  const toPx = (p) => { const s = W / view.span; return [W / 2 + (p[1] - view.c[1]) * kx() * s, H / 2 - (p[0] - view.c[0]) * ky * s]; };
  const toLL = (x, y) => { const s = W / view.span; return [view.c[0] + (H / 2 - y) / s / ky, view.c[1] + (x - W / 2) / s / kx()]; };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
  // Carry / Total under the map (and how firm the fairways are when a total has to be estimated)
  function basisRow() {
    let row = el.querySelector('.hm-basis');
    if (!row) { row = document.createElement('div'); row.className = 'hm-basis'; el.querySelector('.hm-attr').before(row); }
    if (mode === 'off') { row.innerHTML = ''; return; }
    const b = distBasis(), f = firmness();
    row.innerHTML = `<span class="mute small">Arcs:</span><div class="hm-mode sm">${[['carry', 'Carry'], ['total', 'Total']].map(([v, l]) => `<button data-basis="${v}" class="${b === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${b === 'total' ? `<span class="mute small">ground:</span><div class="hm-mode sm">${[['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']].map(([v, l]) => `<button data-firm="${v}" class="${f === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}`;
    row.querySelectorAll('[data-basis]').forEach((x) => x.onclick = () => { const s = getSettings(); s.mapDist = x.dataset.basis; saveSettings(s); schedule(); });
    row.querySelectorAll('[data-firm]').forEach((x) => x.onclick = () => { const s = getSettings(); s.mapFirm = x.dataset.firm; saveSettings(s); schedule(); });
  }
  function size() { W = el.querySelector('.mk-wrap').clientWidth; H = el.querySelector('.mk-wrap').clientHeight; dpr = Math.min(2, devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; }
  function draw() {
    raf = 0; if (!W) size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#1d2a1f'; ctx.fillRect(0, 0, W, H);
    const z = zoomFor(view.c[0], view.span / (W * dpr), 13, 19);
    const [a, b] = [toLL(0, 0), toLL(W, H)].map((ll) => merc(ll[0], ll[1], z));
    const tx0 = Math.floor(a[0]), tx1 = Math.floor(b[0]), ty0 = Math.floor(a[1]), ty1 = Math.floor(b[1]);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 48) for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
      const img = tile(z, x, y, schedule); if (!img) continue;
      const nw = toPx(unmerc(x, y, z)), se = toPx(unmerc(x + 1, y + 1, z));
      ctx.drawImage(img, nw[0], nw[1], se[0] - nw[0] + 0.5, se[1] - nw[1] + 0.5);
    }
    const dot = (p, color, label) => { const [x, y] = toPx(p); ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); if (label) { ctx.font = '700 12px Inter, system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.strokeText(label, x + 10, y + 4); ctx.fillText(label, x + 10, y + 4); } };
    // OSM greens if any, other holes' marks, then this hole's draft
    const ring = (r, fill, stroke) => { ctx.beginPath(); r.forEach((p, k) => { const [x, y] = toPx(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } };
    if (geo?.outline) ring(geo.outline, null, 'rgba(255,255,255,.35)');
    (geo?.water || []).forEach((w) => ring(w.poly, 'rgba(70,150,235,.35)'));
    (geo?.bunkers || []).forEach((w) => ring(w.poly, 'rgba(240,222,160,.6)'));
    [...(geo?.holes || []).map((h) => h.green).filter((g) => g?.poly), ...(geo?.extraGreens || [])].forEach((g) => ring(g.poly, 'rgba(150,235,150,.45)', 'rgba(220,255,220,.8)'));
    holes.forEach((h, k) => { if (k !== i && h.mark?.tee && h.mark?.green) { const [x1, y1] = toPx(h.mark.tee), [x2, y2] = toPx(h.mark.green); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); dot(h.mark.green, 'rgba(120,220,120,.9)', String(k + 1)); } });
    if (draft.tee) dot(draft.tee, '#8fb8ff', `${i + 1} tee`);
    if (draft.green) { const [x1, y1] = toPx(draft.tee), [x2, y2] = toPx(draft.green); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); dot(draft.green, '#3ddc84', `${i + 1} green · ${D(metres(draft.tee, draft.green) / YD)} ${du()}`); }
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 + 10, H / 2); ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 + 10); ctx.stroke();
    title.textContent = `Hole ${i + 1} of ${holes.length}${holes[i].yds ? ` · ${D(holes[i].yds)} ${du()} on the card` : ''}`;
    hint.textContent = step === 'tee' ? 'Tap the tee you play from. Drag to move, pinch or +/− to zoom.' : step === 'green' ? 'Now tap the centre of the green.' : `Saved. ${holes[i].yds ? `Card ${D(holes[i].yds)}, map ${D(metres(draft.tee, draft.green) / YD)} ${du()}.` : ''}`;
    el.querySelector('[data-next]').disabled = step !== 'done';
    el.querySelector('[data-next]').textContent = i === holes.length - 1 ? 'Finish' : 'Next hole ›';
  }
  // a tap inside a mapped green (or within 12 m of one) takes that green's centre
  const allGreens = [...(geo?.holes || []).map((h) => h.green).filter((g) => g?.poly), ...(geo?.extraGreens || [])];
  const snapGreen = (p) => { let best = null, d0 = 12; for (const g of allGreens) { if (inRing(p, g.poly)) return g.c; const d = metres(p, g.c); if (d < d0) { d0 = d; best = g.c; } } return best || p; };
  // gestures
  let ptrs = new Map(), moved = false, pinch0 = null;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = false; if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch0 = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), span: view.span }; } });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; if (Math.hypot(dx, dy) > 2) moved = true; const s = W / view.span; view.c = [view.c[0] + dy / s / ky, view.c[1] - dx / s / kx()]; schedule(); }
    else if (ptrs.size === 2 && pinch0) { const [p, q] = [...ptrs.values()]; const d = Math.hypot(p[0] - q[0], p[1] - q[1]); view.span = Math.max(60, Math.min(4000, (pinch0.span * pinch0.d) / Math.max(1, d))); moved = true; schedule(); }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
    if (!moved && ptrs.size === 0 && step !== 'done') {
      const r = cv.getBoundingClientRect(); const p = toLL(e.clientX - r.left, e.clientY - r.top).map((v) => Math.round(v * 1e6) / 1e6);
      if (view.span > 500) { view = { c: p, span: 220 }; schedule(); return; } // first tap on a wide view just zooms in there
      if (step === 'tee') { draft.tee = p; step = 'green'; }
      else if (step === 'green') { draft.green = snapGreen(p); step = 'done'; onSave(i, { ...draft }); }
      schedule();
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  el.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => { view.span = Math.max(60, Math.min(4000, view.span * (b.dataset.z > 0 ? 0.6 : 1.6))); schedule(); });
  el.querySelector('[data-undo]').onclick = () => { if (step === 'green') { draft = {}; step = 'tee'; } else if (step === 'done') { draft = { tee: draft.tee }; step = 'green'; } schedule(); };
  const goto = (k) => { i = k; const m = holes[i].mark; draft = m?.tee && m?.green ? { ...m } : {}; step = draft.green ? 'done' : 'tee'; view = { c: draft.green || holes[i - 1]?.mark?.green || view.c, span: draft.green ? 450 : view.span }; schedule(); };
  el.querySelector('[data-skip]').onclick = () => (i < holes.length - 1 ? goto(i + 1) : close());
  el.querySelector('[data-next]').onclick = () => (i < holes.length - 1 ? goto(i + 1) : close());
  const close = () => { cancelAnimationFrame(raf); el.remove(); onClose?.(); };
  el.querySelector('[data-close]').onclick = close;
  goto(start); size(); schedule();
  return { close };
}

// ---------- static course map (hero images, thumbnails) ----------
/** Bounds of everything mapped for a course: [[lat0,lon0],[lat1,lon1]] or null. */
export function geoBounds(geo, course) {
  const pts = [...(geo?.holes || []).flatMap((h) => h.line), ...(geo?.outline || []), ...(geo?.extraGreens || []).map((g) => g.c), ...(course?.holes || []).flatMap((h) => (h.mark ? [h.mark.tee, h.mark.green] : []))];
  if (!pts.length) return null;
  return [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
}
/**
 * Draw a north-up satellite view of a course into a canvas sized by CSS: tiles, then OSM greens and
 * water, hole lines and your marks. Redraws itself as tiles arrive. Returns a redraw function.
 */
export function drawCourseMap(cv, { geo = null, course = null, centre = null, span = null, shapes = true }) {
  const ctx = cv.getContext('2d');
  const b = geoBounds(geo, course);
  const c = centre || (b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : course?.lat ? [course.lat, course.lon] : null);
  if (!c) return () => {};
  let raf = 0;
  const draw = () => {
    raf = 0;
    const W = cv.clientWidth || 320, H = cv.clientHeight || 180, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    let sp = span;
    if (!sp) { sp = 1500; if (b) { const w = metres([c[0], b[0][1]], [c[0], b[1][1]]), h = metres([b[0][0], c[1]], [b[1][0], c[1]]); sp = Math.max(600, Math.max(w * 1.15, (h * 1.15 * W) / H)); } }
    const s = W / sp, kx = mPerLon(c[0]), ky = mPerLat;
    const toPx = (p) => [W / 2 + (p[1] - c[1]) * kx * s, H / 2 - (p[0] - c[0]) * ky * s];
    const toLL = (x, y) => [c[0] + (H / 2 - y) / s / ky, c[1] + (x - W / 2) / s / kx];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#1d2a1f'; ctx.fillRect(0, 0, W, H);
    const z = zoomFor(c[0], sp / (W * dpr), 12, 18);
    const [a, d] = [toLL(0, 0), toLL(W, H)].map((ll) => merc(ll[0], ll[1], z));
    for (let x = Math.floor(a[0]); x <= Math.floor(d[0]); x++) for (let y = Math.floor(a[1]); y <= Math.floor(d[1]); y++) {
      const img = tile(z, x, y, schedule); if (!img) continue;
      const nw = toPx(unmerc(x, y, z)), se = toPx(unmerc(x + 1, y + 1, z));
      ctx.drawImage(img, nw[0], nw[1], se[0] - nw[0] + 0.5, se[1] - nw[1] + 0.5);
    }
    if (!shapes) return;
    const ring = (r, fill, stroke) => { ctx.beginPath(); r.forEach((p, k) => { const [x, y] = toPx(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    (geo?.water || []).forEach((w) => ring(w.poly, 'rgba(70,150,235,.35)'));
    [...(geo?.holes || []).map((h) => h.green).filter((g) => g?.poly), ...(geo?.extraGreens || [])].forEach((g) => ring(g.poly, 'rgba(150,235,150,.55)'));
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    (geo?.holes || []).forEach((h) => { ctx.beginPath(); h.line.forEach((p, k) => { const [x, y] = toPx(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
    (course?.holes || []).forEach((h) => { if (h.mark) { ctx.beginPath(); const [x1, y1] = toPx(h.mark.tee), [x2, y2] = toPx(h.mark.green); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); } });
    ctx.setLineDash([]);
  };
  const schedule = () => { if (!raf && cv.isConnected) raf = requestAnimationFrame(draw); };
  schedule();
  return schedule;
}

// ---------- save a course for offline ----------
/** Tile keys at zoom z covering a lat/lon bbox grown by `margin` metres. */
function tilesFor(bounds, z, margin = 70) {
  const [[lat0, lon0], [lat1, lon1]] = bounds;
  const dLat = margin / mPerLat, dLon = margin / mPerLon((lat0 + lat1) / 2);
  const a = merc(lat1 + dLat, lon0 - dLon, z), b = merc(lat0 - dLat, lon1 + dLon, z);
  const out = [];
  for (let x = Math.floor(a[0]); x <= Math.floor(b[0]); x++) for (let y = Math.floor(a[1]); y <= Math.floor(b[1]); y++) out.push(`${z}/${x}/${y}`);
  return out;
}
/** Every tile the hole maps and the course hero will ask for; fetched once so the service worker holds them. */
export function offlineTiles(geo, course) {
  const keys = new Set();
  const holes = (geo?.holes || []).slice();
  (course?.holes || []).forEach((h, i) => { if (h.mark && !holes.some((x) => x.n === i + 1)) holes.push(markedHole(h.mark, i + 1)); });
  for (const h of holes) {
    const pts = [...h.line, ...(h.green?.poly || []), ...(h.tees || []).flatMap((t) => t.poly || [])];
    const b = [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
    for (const z of [17, 18]) tilesFor(b, z).forEach((k) => keys.add(k));
  }
  const all = geoBounds(geo, course);
  if (all) for (const z of [14, 15, 16]) tilesFor(all, z, 300).forEach((k) => keys.add(k));
  return [...keys];
}
export async function saveCourseOffline(geo, course, onProgress = () => {}) {
  const keys = offlineTiles(geo, course);
  let done = 0, failed = 0;
  const work = keys.slice();
  const worker = async () => { while (work.length) { const k = work.shift(); const [z, x, y] = k.split('/'); try { const r = await fetch(TILE(+z, +x, +y), { mode: 'no-cors' }); if (!r) failed++; } catch { failed++; } done++; onProgress(done, keys.length); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { total: keys.length, failed };
}

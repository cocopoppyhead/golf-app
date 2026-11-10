// Small-area geometry on lat/lon pairs ([lat, lon] in degrees). Good to well under 1% over a golf
// course; nothing here is meant for continents. Shared by the hole map, the laser loop, the course
// page and the OSM build script, so there is one set of maths to test.

export const EARTH_R = 6371000;
export const RAD = Math.PI / 180;
export const YD = 0.9144; // metres per yard

export const mPerLat = EARTH_R * RAD;
export const mPerLon = (lat) => EARTH_R * RAD * Math.cos(lat * RAD);

/** Metres between two points. */
export const metres = (a, b) => Math.hypot((b[1] - a[1]) * mPerLon((a[0] + b[0]) / 2), (b[0] - a[0]) * mPerLat);

/** Bearing from a to b in radians: 0 = north, clockwise positive. */
export const bearing = (a, b) => Math.atan2((b[1] - a[1]) * mPerLon(a[0]), (b[0] - a[0]) * mPerLat);

/** The point `m` metres from `a` along `bearingRad`. */
export const destination = (a, bearingRad, m) => [a[0] + (m * Math.cos(bearingRad)) / mPerLat, a[1] + (m * Math.sin(bearingRad)) / mPerLon(a[0])];

/** Centroid (plain mean) of a ring of points. */
export const centroid = (ring) => { const n = ring.length || 1; return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]; };

/** Is p inside the polygon ring? (ray casting; ring may or may not repeat its first point) */
export function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const inAny = (p, rings) => rings.some((r) => inRing(p, r));

/** Metres from p to the segment a–b. */
export function segDist(p, a, b) {
  const kx = mPerLon((a[0] + b[0]) / 2), ky = mPerLat;
  const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * ky, px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * ky;
  const l2 = bx * bx + by * by; const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
/** Metres from p to the nearest point of a polyline. */
export const lineDist = (p, line) => { let m = Infinity; for (let i = 1; i < line.length; i++) m = Math.min(m, segDist(p, line[i - 1], line[i])); return line.length === 1 ? metres(p, line[0]) : m; };
/** Length of a polyline in metres. */
export const lineLen = (line) => { let s = 0; for (let i = 1; i < line.length; i++) s += metres(line[i - 1], line[i]); return s; };

/** Round a point to 6 decimals (about 10 cm). */
export const round6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

// Web Mercator tile maths (slippy map tiles, 256 px)
export const merc = (lat, lon, z) => { const n = 2 ** z; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n]; };
export const unmerc = (tx, ty, z) => { const n = 2 ** z; return [Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / RAD, (tx / n) * 360 - 180]; };
/** Metres per pixel of a 256-px tile at zoom z and this latitude. */
export const tileMpp = (lat, z) => (156543.03 * Math.cos(lat * RAD)) / 2 ** z;
/** Zoom level whose tiles are about `mpp` metres per pixel, clamped. */
export const zoomFor = (lat, mpp, lo = 12, hi = 19) => Math.max(lo, Math.min(hi, Math.round(Math.log2((156543.03 * Math.cos(lat * RAD)) / mpp))));

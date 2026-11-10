#!/usr/bin/env node
// Turns raw Overpass pulls (one JSON per library course, produced by scripts/osm/pull.py) into the
// compact per-course geometry the app loads from public/courses/osm/<id>.json.
//
//   node scripts/osm/build.mjs <raw-dir> [courseId ...]
//
// Raw files hold every golf=* way within ~1.8 km of the course centre, so neighbouring courses leak
// in (Emirates Majlis + Faldo + Montgomerie share one patch of Dubai). COURSES below says, per course,
// which OSM polygon(s) bound it and which hole-name pattern to trust. Holes are the golf=hole ways
// (a line from back tee to green, usually with ref=hole number); greens, tees, bunkers, water and
// fairways are polygons that get attached to the nearest hole line.
import fs from 'node:fs';
import path from 'node:path';
import { mPerLat, mPerLon, metres as dist, centroid, inRing, inAny, lineDist, lineLen, round6 as r6 } from '../../src/geo.js';

const RAW = process.argv[2];
const ONLY = process.argv.slice(3);
if (!RAW) { console.error('usage: node scripts/osm/build.mjs <raw-dir> [courseId ...]'); process.exit(1); }
const LIB = JSON.parse(fs.readFileSync('public/courses/uae.json', 'utf8'));
const OUT = 'public/courses/osm';
fs.mkdirSync(OUT, { recursive: true });

// Per-course rules. poly: OSM way/relation ids whose rings bound the course (a hole counts if its
// tee end is inside one). not: polygons that exclude. name: regex a hole's name/golf:course:name
// must match. nameNot: regex it must not match. Without a rule every hole in the raw file is a candidate.
// Every course also gets a radius gate (default 1500 m from the library centre, `radius` overrides,
// `center` moves it). `named` drops holes without a name tag; `notWays` lists hole ways to ignore.
const COURSES = {
  'emirates-golf-club-faldo': { name: /faldo/i },
  'emirates-golf-club-majlis': { name: /maj(i)?lis/i },
  'the-montgomerie-golf-club-dubai': { radius: 1300, named: true, nameNot: /faldo|majlis/i },
  'jumeirah-golf-estates-earth': { name: /earth/i, radius: 2000 },
  'jumeirah-golf-estates-fire': { poly: [{ way: 213572534 }], not: [{ rel: 5353876 }], nameNot: /earth/i, radius: 2500 },
  'the-els-club-dubai': { poly: [{ rel: 5353876 }], center: [25.033, 55.213], radius: 1500 },
  'dubai-hills-golf-club': { radius: 2200, notWays: [1567882081, 1567882082, 1567882083, 1567882084, 1567882085, 1567882086, 1567882087] }, // short course next to the 1st
  'jebel-ali-golf-resort-9-holes': { poly: [{ rel: 5731796 }], radius: 2500 },
  'abu-dhabi-golf-club-national-course': { poly: [{ way: 871972187 }] },
  'abu-dhabi-golf-club-garden-course': { skip: 'only the National course is mapped in OSM' },
  'yas-links-abu-dhabi': { poly: [{ rel: 2244379 }] },
  'yas-links-abu-dhabi-par-3-academy-course': { skip: 'par-3 holes carry no numbers in OSM' },
  'yas-acres-golf-country-club': { center: [24.499, 54.607], radius: 800 },
  'saadiyat-beach-golf-club': { poly: [{ rel: 11177553 }], radius: 3000 },
};

const pts = (e) => (e.geometry || []).map((p) => [p.lat, p.lon]);
const ring6 = (ring) => ring.map(r6);

// rings of a relation: each outer member's geometry (members may be split ways; we join by endpoints)
function relRings(rel) {
  const outers = (rel.members || []).filter((m) => m.type === 'way' && (m.role === 'outer' || !m.role) && m.geometry).map((m) => m.geometry.map((p) => [p.lat, p.lon]));
  const rings = []; const pool = outers.slice();
  while (pool.length) {
    let ring = pool.shift(); let grew = true;
    while (grew && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      grew = false; const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], a = w[0], b = w[w.length - 1];
        if (a[0] === end[0] && a[1] === end[1]) { ring = ring.concat(w.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (b[0] === end[0] && b[1] === end[1]) { ring = ring.concat(w.slice(0, -1).reverse()); pool.splice(i, 1); grew = true; break; }
      }
    }
    rings.push(ring);
  }
  return rings;
}

// One pool of every element from every raw file: neighbouring pulls fill each other's edges.
const POOL = new Map(), RELS = new Map();
for (const f of fs.readdirSync(RAW)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
  for (const e of raw.elements || []) POOL.set(e.type + e.id, e);
  for (const r of raw.rels || []) RELS.set(r.id, r);
}
const ALL = [...POOL.values()];

function build(course) {
  const rule = COURSES[course.id] || {};
  if (rule.skip) return { id: course.id, status: 'skipped: ' + rule.skip };
  if (!course.lat) return { id: course.id, status: 'no centre' };
  const centre = rule.center || [course.lat, course.lon], radius = rule.radius || 1500;
  const els = ALL.filter((e) => { const g = e.geometry; return g && g.length && dist([g[0].lat, g[0].lon], centre) <= radius + 1500; });
  const rels = [...RELS.values()];
  const findRings = (ref) => {
    if (ref.way) { const w = els.find((e) => e.type === 'way' && e.id === ref.way); return w ? [pts(w)] : []; }
    const r = rels.find((x) => x.id === ref.rel); return r ? relRings(r) : [];
  };
  const bound = (rule.poly || []).flatMap(findRings), excl = (rule.not || []).flatMap(findRings);
  if (rule.poly && !bound.length) return { id: course.id, status: 'bounding polygon not found in raw' };

  const tag = (e) => e.tags || {};
  const golf = (e) => (tag(e).golf || '').trim();
  const holeWays = els.filter((e) => e.type === 'way' && golf(e) === 'hole' && (e.geometry || []).length >= 2);
  const cands = holeWays.filter((h) => {
    const t = tag(h), nm = `${t.name || ''} ${t['golf:course:name'] || ''}`; const line = pts(h);
    if (dist(line[0], centre) > radius && dist(line[line.length - 1], centre) > radius) return false;
    if (rule.named && !t.name) return false;
    if (rule.notWays?.includes(h.id)) return false;
    if (rule.name && !rule.name.test(nm)) return false;
    if (rule.nameNot && rule.nameNot.test(nm)) return false;
    if (bound.length && !inAny(line[0], bound) && !inAny(line[line.length - 1], bound)) return false;
    if (excl.length && (inAny(line[0], excl) || inAny(line[line.length - 1], excl))) return false;
    return true;
  });
  const polys = (kind) => els.filter((e) => e.type === 'way' && golf(e) === kind && (e.geometry || []).length >= 4).map((e) => ({ id: e.id, ring: pts(e), c: centroid(pts(e)), tags: tag(e) }));
  const greens = polys('green'), tees = polys('tee'), bunkers = polys('bunker');
  const waterAll = [...polys('water_hazard'), ...polys('lateral_water_hazard'), ...els.filter((e) => e.type === 'way' && tag(e).natural === 'water' && (e.geometry || []).length >= 4).map((e) => ({ id: e.id, ring: pts(e), c: centroid(pts(e)) }))];
  const water = [...new Map(waterAll.map((w) => [w.id, w])).values()]; // a way tagged both golf=water_hazard and natural=water appears once
  const fairways = polys('fairway');
  const byRef = new Map(); const dropped = [];
  for (const h of cands) {
    const t = tag(h); let n = parseInt(t.ref, 10);
    if (!n) { const m = (t.name || '').match(/(\d+)/); n = m ? parseInt(m[1], 10) : 0; }
    if (!n || n > course.holes) { dropped.push(`way ${h.id} (${t.name || 'no name'}, ref ${t.ref ?? '–'})`); continue; }
    const prev = byRef.get(n);
    // duplicates: prefer the line that ends on a green, then one with a par tag, then the longer line
    const score = (w) => { const l = pts(w), e = l[l.length - 1]; const g = greens.some((x) => inRing(e, x.ring) || dist(e, x.c) < 40); return (g ? 4 : 0) + (tag(w).par ? 2 : 0) + Math.min(1, lineLen(l) / 1000); };
    if (!prev || score(h) > score(prev)) byRef.set(n, h);
  }

  const holes = [];
  for (const [n, h] of [...byRef.entries()].sort((a, b) => a[0] - b[0])) {
    const t = tag(h); const line = pts(h); const start = line[0], end = line[line.length - 1];
    // green: polygon containing the line end, else nearest centroid within 60 m
    let g = greens.find((x) => inRing(end, x.ring));
    if (!g) { let best = 60; for (const x of greens) { const d = dist(end, x.c); if (d < best) { best = d; g = x; } } }
    let green = null;
    if (g) {
      // front/back along the direction of the last segment
      const a = line[Math.max(0, line.length - 2)], dir = [(end[0] - a[0]) * mPerLat, (end[1] - a[1]) * mPerLon(end[0])];
      const L = Math.hypot(dir[0], dir[1]) || 1; const u = [dir[0] / L, dir[1] / L];
      const proj = (p) => ((p[0] - g.c[0]) * mPerLat) * u[0] + ((p[1] - g.c[1]) * mPerLon(end[0])) * u[1];
      let f = g.ring[0], b = g.ring[0];
      for (const p of g.ring) { if (proj(p) < proj(f)) f = p; if (proj(p) > proj(b)) b = p; }
      green = { c: r6(g.c), f: r6(f), b: r6(b), poly: ring6(g.ring), depth: Math.round(dist(f, b)) };
    }
    // tees: polygons within 90 m of the line start, or within 25 m of the first 35 % of the line
    const len = lineLen(line);
    const teeSet = tees.filter((x) => dist(x.c, start) <= 90 || (lineDist(x.c, line) <= 25 && dist(x.c, start) <= len * 0.35))
      .map((x) => ({ c: r6(x.c), poly: ring6(x.ring), name: x.tags.name || x.tags.tee || x.tags.colour || null, m: Math.round(dist(x.c, g ? g.c : end)) }))
      .sort((a, b) => b.m - a.m);
    holes.push({ n, par: t.par ? parseInt(t.par, 10) : null, hcp: t.handicap ? parseInt(t.handicap, 10) : null, name: t.name || null, line: line.map(r6), len: Math.round(len), tees: teeSet, green, osm: h.id });
  }
  // features: attach each polygon to the nearest hole line within 110 m (h = hole number, 0 if none)
  const attach = (list) => list.map((x) => {
    let best = 110, hn = 0;
    for (const h of holes) { const d = lineDist(x.c, h.line); if (d < best) { best = d; hn = h.n; } }
    return { h: hn, c: r6(x.c), poly: ring6(x.ring) };
  }).filter((x) => x.h || (!holes.length && dist(x.c, centre) <= radius));
  // greens no hole claimed (unnumbered in OSM): shown on the marking map so the golfer just taps them
  const used = new Set(holes.map((h) => h.green?.c?.join()));
  const extraGreens = greens.filter((g) => !used.has(r6(g.c).join()) && dist(g.c, centre) <= radius).map((g) => ({ c: r6(g.c), poly: ring6(g.ring) }));
  // course outline: the named golf_course polygon nearest the centre, if any
  const outlines = els.filter((e) => e.type === 'way' && tag(e).leisure === 'golf_course' && (e.geometry || []).length >= 4).map((e) => pts(e)).filter((r) => inRing(centre, r) || dist(centroid(r), centre) < 900);
  const outline = outlines.sort((a, b) => b.length - a.length)[0] || null;
  const out = {
    id: course.id, name: course.name, src: 'osm', built: new Date().toISOString().slice(0, 10),
    attribution: '© OpenStreetMap contributors (ODbL)',
    holes, bunkers: attach(bunkers), water: attach(water), fairways: attach(fairways), extraGreens, outline: outline ? ring6(outline) : null,
  };
  if (holes.length || extraGreens.length || outline) {
    fs.writeFileSync(path.join(OUT, course.id + '.json'), JSON.stringify(out));
    if (course.latlonNote) { // hand-placed centre: replace it with the centre of the mapped holes (or the outline)
      const c = holes.length ? centroid(holes.flatMap((h) => [h.line[0], h.line[h.line.length - 1]])) : centroid(outline || extraGreens.map((g) => g.c));
      course.lat = Math.round(c[0] * 1e5) / 1e5; course.lon = Math.round(c[1] * 1e5) / 1e5; delete course.latlonNote; libChanged = true;
    }
  }
  else { try { fs.unlinkSync(path.join(OUT, course.id + '.json')); } catch {} }
  const missing = []; for (let i = 1; i <= course.holes; i++) if (!byRef.has(i)) missing.push(i);
  const gaps = []; // walk check: green of n to tee of n+1 should be a short walk
  for (let i = 1; i < holes.length; i++) { const a = holes[i - 1], b = holes[i]; if (b.n === a.n + 1) { const d = Math.round(dist(a.line[a.line.length - 1], b.line[0])); if (d > 350) gaps.push(`${a.n}→${b.n} ${d} m`); } }
  return { id: course.id, status: holes.length ? 'ok' : extraGreens.length || outline ? `no holes (${extraGreens.length} loose greens${outline ? ', outline' : ''})` : 'no holes', holes: holes.length, missing, gaps, greens: holes.filter((h) => h.green).length, tees: holes.reduce((s, h) => s + h.tees.length, 0), bunkers: out.bunkers.length, water: out.water.length, fairways: out.fairways.length, dropped };
}

let libChanged = false;
const rows = [];
for (const c of LIB) { if (ONLY.length && !ONLY.includes(c.id)) continue; rows.push(build(c)); }
if (libChanged) fs.writeFileSync('public/courses/uae.json', JSON.stringify(LIB, null, 1) + '\n');
for (const r of rows) {
  const extra = r.status === 'ok' ? ` holes ${r.holes}${r.missing.length ? ` (missing ${r.missing.join(',')})` : ''} · greens ${r.greens} · tees ${r.tees} · bunkers ${r.bunkers} · water ${r.water} · fairways ${r.fairways}${r.dropped.length ? ` · dropped ${r.dropped.length}` : ''}${r.gaps.length ? ` · long walks: ${r.gaps.join(', ')}` : ''}` : '';
  console.log(`${r.id.padEnd(46)} ${r.status}${extra}`);
}

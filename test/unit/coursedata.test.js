// The bundled course data has to stay consistent: a bad scorecard or a broken OSM file would
// ruin a round quietly. These run on every push.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { lineLen } from '../../src/geo.js';

const lib = JSON.parse(fs.readFileSync('public/courses/uae.json', 'utf8'));
const osmDir = 'public/courses/osm';
const osm = fs.readdirSync(osmDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(`${osmDir}/${f}`, 'utf8')));

describe('UAE course library', () => {
  it('has unique ids, a par and SI per hole, and tees of the right length', () => {
    const ids = new Set(lib.map((c) => c.id));
    expect(ids.size).toBe(lib.length);
    for (const c of lib) {
      expect(c.par.length, c.id).toBe(c.holes);
      expect(c.par.every((p) => p >= 3 && p <= 6), c.id).toBe(true);
      if (c.si?.length) { // 18-hole cards: 1…18; 9-hole cards may use odds or evens out of 18
        expect(c.si.length, c.id).toBe(c.holes);
        expect(new Set(c.si).size, c.id).toBe(c.holes);
        expect(c.si.every((x) => x >= 1 && x <= 18), c.id).toBe(true);
      }
      for (const t of c.tees || []) {
        if (t.lengths?.length) expect(t.lengths.length, `${c.id} ${t.name}`).toBe(c.holes);
        if (t.rating) expect(t.rating, `${c.id} ${t.name}`).toBeGreaterThan(c.holes === 9 ? 25 : 55);
        if (t.slope) { expect(t.slope).toBeGreaterThanOrEqual(55); expect(t.slope).toBeLessThanOrEqual(155); }
      }
      expect(typeof c.lat, c.id).toBe('number'); expect(typeof c.lon, c.id).toBe('number');
      expect(c.lat).toBeGreaterThan(22); expect(c.lat).toBeLessThan(27); expect(c.lon).toBeGreaterThan(51); expect(c.lon).toBeLessThan(57);
    }
  });
});

describe('OSM course geometry', () => {
  it('every file matches a library course and sits near its centre', () => {
    for (const g of osm) {
      const c = lib.find((x) => x.id === g.id);
      expect(c, g.id).toBeTruthy();
      expect(g.attribution).toMatch(/OpenStreetMap/);
      for (const h of g.holes) {
        expect(h.n).toBeGreaterThanOrEqual(1); expect(h.n).toBeLessThanOrEqual(c.holes);
        expect(h.line.length).toBeGreaterThanOrEqual(2);
        const len = lineLen(h.line);
        expect(len, `${g.id} hole ${h.n}`).toBeGreaterThan(60); expect(len).toBeLessThan(750);
        for (const p of [...h.line, ...(h.green?.poly || []), ...h.tees.flatMap((t) => t.poly)]) { expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true); }
        if (h.green) expect(h.green.depth, `${g.id} hole ${h.n} green depth`).toBeLessThan(100); // double greens exist
      }
      // hole numbers unique and sorted
      const ns = g.holes.map((h) => h.n); expect(new Set(ns).size).toBe(ns.length); expect(ns).toEqual([...ns].sort((a, b) => a - b));
      for (const k of ['bunkers', 'water', 'fairways']) for (const f of g[k]) { expect(f.poly.length).toBeGreaterThanOrEqual(3); expect(typeof f.h).toBe('number'); }
    }
  });
  it('the courses we play most are mapped end to end', () => {
    const full = (id) => osm.find((g) => g.id === id)?.holes.length;
    expect(full('emirates-golf-club-majlis')).toBe(18);
    expect(full('emirates-golf-club-faldo')).toBe(18);
    expect(full('dubai-creek-golf-yacht-club-championship')).toBe(18);
    expect(full('jumeirah-golf-estates-fire')).toBe(18);
    expect(full('yas-links-abu-dhabi')).toBe(18);
    expect(full('abu-dhabi-golf-club-national-course')).toBe(18);
  });
});

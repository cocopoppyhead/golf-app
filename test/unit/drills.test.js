import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';

const lib = JSON.parse(fs.readFileSync('public/drills/library.json', 'utf8'));

describe('drill library', () => {
  it('every drill has an id, area, metric, minutes and places; fault drills name a fault key', () => {
    const ids = new Set();
    for (const d of lib.drills) {
      expect(ids.has(d.id), d.id).toBe(false); ids.add(d.id);
      expect(lib.areas.map((a) => a[0])).toContain(d.area);
      expect(['count', 'streak', 'strokes', 'points', 'feet', 'yards', 'number']).toContain(d.metric.type);
      expect(d.minutes).toBeGreaterThan(0); expect(d.where.length).toBeGreaterThan(0);
      if (d.id.startsWith('fix-')) expect(d.fixes.length).toBeGreaterThan(0);
    }
    // every face-on and down-the-line fault the app measures has at least one drill
    for (const key of ['address:Ball position', 'address:Spine tilt', 'top:Head', 'top:Hips', 'impact:Hips', 'impact:Hands', 'finish:Weight', 'dtl:impact:Early extension']) {
      expect(lib.drills.some((d) => (d.fixes || []).includes(key)), key).toBe(true);
    }
  });
  it('faultDrills and the AI menu read the loaded library', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => lib });
    const m = await import('../../src/drills.js');
    await m.loadDrills();
    expect(m.faultDrills('impact:Hips').map((d) => d.name)).toContain('Step-through drill');
    expect(m.faultDrills('dtl:impact:Early extension').length).toBeGreaterThan(0);
    expect(m.faultDrills('nothing:Here')).toEqual([]);
    const menu = m.drillMenuForAi(['address:Ball position']);
    expect(menu).toMatch(/fix-club-on-the-ground-ball-position/); expect(menu).toMatch(/\[fixes address:Ball position\]/);
  });
});

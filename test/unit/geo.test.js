import { describe, it, expect } from 'vitest';
import { metres, bearing, destination, inRing, lineDist, lineLen, merc, unmerc, zoomFor, centroid } from '../../src/geo.js';

const DXB = [25.0861, 55.1603]; // Emirates Golf Club, roughly

describe('geo', () => {
  it('measures metres between nearby points', () => {
    // 0.001° of latitude is 111.2 m anywhere; 0.001° of longitude at 25° N is about 100.8 m
    expect(metres(DXB, [DXB[0] + 0.001, DXB[1]])).toBeCloseTo(111.2, 0);
    expect(metres(DXB, [DXB[0], DXB[1] + 0.001])).toBeCloseTo(100.8, 0);
  });
  it('bearing: north is 0, east is +90°, and destination inverts it', () => {
    expect(bearing(DXB, [DXB[0] + 0.001, DXB[1]])).toBeCloseTo(0, 3);
    expect(bearing(DXB, [DXB[0], DXB[1] + 0.001])).toBeCloseTo(Math.PI / 2, 3);
    const p = destination(DXB, Math.PI / 4, 300);
    expect(metres(DXB, p)).toBeCloseTo(300, 1);
    expect(bearing(DXB, p)).toBeCloseTo(Math.PI / 4, 3);
  });
  it('point in ring', () => {
    const sq = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(inRing([0.5, 0.5], sq)).toBe(true);
    expect(inRing([1.5, 0.5], sq)).toBe(false);
    expect(centroid(sq)).toEqual([0.5, 0.5]);
  });
  it('distance to a polyline and its length', () => {
    const line = [DXB, [DXB[0] + 0.002, DXB[1]], [DXB[0] + 0.002, DXB[1] + 0.002]];
    expect(lineLen(line)).toBeCloseTo(111.2 * 2 + 100.8 * 2, 0);
    // a point 0.001° east of the first leg's midpoint is ~100.8 m from the line
    expect(lineDist([DXB[0] + 0.001, DXB[1] + 0.001], line)).toBeCloseTo(100.8, 0);
    expect(lineDist(DXB, line)).toBeCloseTo(0, 6);
  });
  it('mercator tile maths round-trips and zoom picks sensible levels', () => {
    const [tx, ty] = merc(DXB[0], DXB[1], 18);
    const back = unmerc(tx, ty, 18);
    expect(back[0]).toBeCloseTo(DXB[0], 6);
    expect(back[1]).toBeCloseTo(DXB[1], 6);
    expect(zoomFor(25, 0.5)).toBe(18); // ~0.54 m/px at z18 in Dubai
    expect(zoomFor(25, 50, 12, 19)).toBe(12);
    expect(zoomFor(25, 0.01, 12, 19)).toBe(19);
  });
});

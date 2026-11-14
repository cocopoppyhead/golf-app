import { describe, it, expect } from 'vitest';
import { useGps, teeFor } from '../../src/rounds/holemap.js';

// a hole running due north: tee at the origin, green 400 m up. Lat/lon near Dubai.
const T = [25.0, 55.0], mN = 1 / 111320, G = [25.0 + 400 * mN, 55.0];
const mE = 1 / (111320 * Math.cos((25 * Math.PI) / 180));
const project = (p) => [(p[1] - T[1]) / mE, (p[0] - T[0]) / mN];
const at = (east, north) => [T[0] + north * mN, T[1] + east * mE];

describe('measure from GPS or the tee', () => {
  it('uses GPS on the hole', () => {
    expect(useGps(at(10, 150), { T, G, project })).toBe(true);
    expect(useGps(at(-80, 300), { T, G, project })).toBe(true);
  });
  it('not from home near the course: off to the side, behind the tee, or further away than the tee', () => {
    expect(useGps(at(600, 200), { T, G, project })).toBe(false);
    expect(useGps(at(0, -200), { T, G, project })).toBe(false);
    expect(useGps(at(0, 900), { T, G, project })).toBe(false); // well past the green, further from it than the tee
  });
  it('standing on a tee you moved: the tee', () => {
    expect(useGps(at(5, 10), { T, G, project, mine: true })).toBe(false);
    expect(useGps(at(5, 60), { T, G, project, mine: true })).toBe(true);
  });
  it('says how the tee was chosen', () => {
    const gh = { line: [T, G], tees: [{ c: at(0, -20), name: 'Black' }, { c: at(0, 40), name: 'White' }], green: { c: G } };
    expect(teeFor(gh, 460, null, [1, 2]).how).toBe('yours');
    expect(teeFor(gh, 460, 'white').how).toBe('named');
    expect(teeFor(gh, 460, null).how).toBe('nearest');
    expect(teeFor({ line: [T, G], tees: [] }, 460, null).how).toBe('line');
  });
});

describe('tapping a tee box', () => {
  it('finds the box under the tap, or none', async () => {
    const { teeBoxAt } = await import('../../src/rounds/holemap.js');
    const box = { c: at(0, 100), poly: [at(-8, 90), at(8, 90), at(8, 110), at(-8, 110)] };
    const gh = { tees: [box] };
    expect(teeBoxAt(gh, at(6, 92))).toEqual(box.c); // inside the outline
    expect(teeBoxAt(gh, at(0, 108))).toEqual(box.c);
    expect(teeBoxAt(gh, at(40, 100))).toBe(null);
    expect(teeBoxAt({ tees: [] }, at(0, 100))).toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import { pickTee, markedHole, geoBounds } from '../../src/rounds/holemap.js';
import { detectHole, playsFrom } from '../../src/rounds/laserloop.js';
import { destination, metres } from '../../src/geo.js';

const T = [25.0, 55.0];
const G = destination(T, 0, 380 * 0.9144); // 380 yards due north
const gh = { n: 1, line: [T, G], green: { c: G, f: G, b: G, poly: null }, tees: [
  { c: destination(G, Math.PI, 420 * 0.9144), name: null }, { c: destination(G, Math.PI, 380 * 0.9144), name: 'Blue' }, { c: destination(G, Math.PI, 330 * 0.9144), name: null },
] };

describe('hole map', () => {
  it('picks the tee by name, else the one nearest the card yardage', () => {
    expect(pickTee(gh, 400, 'blue')).toEqual(gh.tees[1].c);
    expect(metres(pickTee(gh, 425, null), gh.tees[0].c)).toBeCloseTo(0, 6);
    expect(metres(pickTee(gh, 340, null), gh.tees[2].c)).toBeCloseTo(0, 6);
    expect(pickTee({ ...gh, tees: [] }, 340, null)).toEqual(T);
  });
  it('a marked hole looks like an OSM hole', () => {
    expect(markedHole(null, 3)).toBeNull();
    const m = markedHole({ tee: T, green: G }, 3);
    expect(m.n).toBe(3); expect(m.line).toEqual([T, G]); expect(m.green.marked).toBe(true);
  });
  it('bounds cover holes, outline and marks', () => {
    const b = geoBounds({ holes: [gh] }, { holes: [{ mark: { tee: [24.99, 54.99], green: T } }] });
    expect(b[0]).toEqual([24.99, 54.99]); expect(b[1][0]).toBeCloseTo(G[0], 6);
    expect(geoBounds(null, { holes: [{}] })).toBeNull();
  });
});

describe('laser loop', () => {
  const course = { holes: [{}, {}, {}] };
  const T2 = destination(G, Math.PI / 2, 60), G2 = destination(T2, Math.PI / 2, 300);
  const geo = { holes: [gh, { n: 2, line: [T2, G2], green: { c: G2 }, tees: [] }] };
  it('stays on the hole without a good fix, advances when standing on the next tee', () => {
    expect(detectHole(null, course, geo, 0)).toBe(0);
    expect(detectHole({ lat: T2[0], lon: T2[1], acc: 90 }, course, geo, 0)).toBe(0); // poor accuracy
    const mid = destination(T, 0, 150);
    expect(detectHole({ lat: mid[0], lon: mid[1], acc: 8 }, course, geo, 0)).toBe(0); // in the fairway
    const nearTee2 = destination(T2, Math.PI / 2, 10);
    expect(detectHole({ lat: nearTee2[0], lon: nearTee2[1], acc: 8 }, course, geo, 0)).toBe(1);
    expect(detectHole({ lat: nearTee2[0], lon: nearTee2[1], acc: 8 }, course, geo, 1)).toBe(1); // no hole 3 mapped
  });
  it('plays-like: laser slope first, then wind and temperature', () => {
    expect(playsFrom({ raw: 150, playsAs: 150 }, null).plays).toBe(150);
    expect(playsFrom({ raw: 150, playsAs: 158 }, null).plays).toBe(158);
    const into = playsFrom({ raw: 150, playsAs: 150, heading: 0 }, { tempC: 25, windMph: 15, windFrom: 0 });
    const behind = playsFrom({ raw: 150, playsAs: 150, heading: 180 }, { tempC: 25, windMph: 15, windFrom: 0 });
    expect(into.plays).toBeGreaterThan(150); expect(behind.plays).toBeLessThan(150);
    expect(playsFrom({ raw: 150, playsAs: 150 }, { tempC: 40, windMph: 0, windFrom: 0 }).plays).toBeLessThan(150);
  });
});

describe('clubs drawn from the tee', () => {
  const bag = [{ club: 'Driver', carry: 255 }, { club: '3 wood', carry: 225 }, { club: '5 wood', carry: 210 }, { club: '3 hybrid', carry: 200 }, { club: '4 iron', carry: 190 }, { club: '5 iron', carry: 180 }, { club: '7 iron', carry: 160 }, { club: 'PW', carry: 130 }];
  it('par 4/5: driver, up to two woods, then the longest hybrid or iron — four at most', async () => {
    const { teeClubs } = await import('../../src/rounds/holemap.js');
    expect(teeClubs(bag, { par: 4 }).map((c) => c.club)).toEqual(['Driver', '3 wood', '5 wood', '3 hybrid']);
    expect(teeClubs(bag.filter((c) => c.club !== '5 wood' && c.club !== '3 hybrid'), { par: 5 }).map((c) => c.club)).toEqual(['Driver', '3 wood', '4 iron']);
    expect(teeClubs(bag.filter((c) => c.carry < 200), { par: 4 }).map((c) => c.club)).toEqual(['4 iron']);
  });
  it('par 3: three clubs around the plays-like distance', async () => {
    const { teeClubs } = await import('../../src/rounds/holemap.js');
    expect(teeClubs(bag, { par: 3, toGo: 165 }).map((c) => c.club)).toEqual(['5 iron', '7 iron', 'PW']);
    expect(teeClubs(bag, { par: 3, toGo: 120 }).map((c) => c.club)).toEqual(['5 iron', '7 iron', 'PW']); // shortest three when nothing is shorter
    expect(teeClubs(bag, { par: 3, toGo: 300 }).map((c) => c.club)).toEqual(['Driver', '3 wood', '5 wood']);
  });
  it('plays-like adds rise and conditions', async () => {
    const { playsLike } = await import('../../src/rounds/holemap.js');
    expect(playsLike(150, {}).plays).toBe(150);
    expect(playsLike(150, { riseM: 9.144 }).plays).toBe(160);
    expect(playsLike(150, { riseM: -9.144 }).plays).toBe(140);
    const into = playsLike(150, { cond: { tempC: 25, windMph: 15, windFrom: 0, pressure: 1013, humidity: 50 }, bearingDeg: 0 });
    expect(into.plays).toBeGreaterThan(160); expect(into.why.join()).toMatch(/into/);
  });
  it('from the fairway: the club for the distance and one either side', async () => {
    const { teeClubs, alongLine } = await import('../../src/rounds/holemap.js');
    expect(teeClubs(bag, { par: 4, toGo: 185 }).map((c) => c.club)).toEqual(['4 iron', '5 iron', '7 iron']);
    const line = [[25, 55], destination([25, 55], 0, 200), destination(destination([25, 55], 0, 200), Math.PI / 2, 200)];
    expect(metres(alongLine(line, 100), destination([25, 55], 0, 100))).toBeLessThan(0.5);
    expect(metres(alongLine(line, 300), destination(destination([25, 55], 0, 200), Math.PI / 2, 100))).toBeLessThan(0.5);
    expect(alongLine(line, 999)).toEqual(line[2]);
  });
});

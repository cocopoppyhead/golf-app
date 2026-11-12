import { describe, it, expect } from 'vitest';
import { usualTeeClub, clubForDistance, clubChoices, zoneOf, shotPanel, greenPanel } from '../../src/rounds/shotpanel.js';
import { holeGaps, troubleFor, isGreenside, defaultLie } from '../../src/rounds/hole.js';
import { puttBand, puttLabel } from '../../src/units.js';
import { expected } from '../../src/rounds/sg.js';

const bag = ['Driver', '3 wood', '3 hybrid', '4 iron', '5 iron', '6 iron', '7 iron', '8 iron', '9 iron', 'PW', 'GW', 'SW', 'LW', 'Putter'].map((club) => ({ club }));
const tee = (club, auto = false) => ({ shots: [{ d: { club, clubAuto: auto } }] });
const round = (k, club, auto) => ({ id: `r${k}`, courseId: 'c', date: k, holes: [tee(club, auto)] });

describe('hole flow helpers', () => {
  it('knows the club you usually hit off a tee, ignoring ones osolo filled in', () => {
    expect(usualTeeClub([round(1, '3 wood'), round(2, '3 wood'), round(3, 'Driver')], 'c', 0)).toEqual({ club: '3 wood', n: 2, of: 3 });
    expect(usualTeeClub([round(1, 'Driver'), round(2, 'Driver')], 'c', 0)).toBeNull(); // Driver is the default anyway
    expect(usualTeeClub([round(1, '3 wood', true), round(2, '3 wood', true)], 'c', 0)).toBeNull();
  });
  it('suggests a club for a distance, from your carries or typical ones', () => {
    expect(clubForDistance(bag, 145)).toBe('7 iron');
    expect(clubForDistance([{ club: '7 iron', carry: 160 }, { club: '6 iron', carry: 172 }], 165)).toBe('7 iron');
    expect(clubChoices(bag, 'greenside')).toEqual(['PW', 'GW', 'SW', 'LW', 'Putter']);
    expect(clubChoices(bag, 'tee-long')).toEqual(['Driver', '3 wood', '3 hybrid', '4 iron']);
    expect(clubChoices(bag, 'fairway', { suggest: '7 iron' })).toEqual(['6 iron', '7 iron', '8 iron']);
  });
  it('works out where a shot is played from', () => {
    const h = { shots: [{ res: 'FW' }, { dist: 140, res: 'GS' }, { dist: 12 }] };
    expect(['tee', 'fairway', 'greenside'].map((_, k) => zoneOf(h, k))).toEqual(['tee', 'fairway', 'greenside']);
    expect(isGreenside({ shots: [{}, { dist: 200 }] }, 1)).toBe(false);
  });
  it('carries the lie over from where the last shot finished; your own pick wins', () => {
    const h = { shots: [{ res: 'RR' }, { lie: null }, { lie: null }] };
    expect(defaultLie(h, 1)).toBe('rgh');
    h.shots[0] = { res: 'FW', res2: 'WS' };
    expect(defaultLie(h, 1)).toBe('wst');
    h.shots[1] = { lie: 'rgh', res: 'BK' };
    expect(defaultLie(h, 2)).toBe('bnk');
  });
  it('gives desert courses Waste and Desert, elsewhere Fescue and Heather', () => {
    expect(troubleFor({ lat: 25.1, lon: 55.2 }).map((x) => x[1])).toEqual(['Waste', 'Desert']);
    expect(troubleFor({ lat: 53.3, lon: -6.2 }).map((x) => x[1])).toEqual(['Fescue', 'Heather']);
    expect(troubleFor({ trouble: [['x', 'Gorse'], ['y', 'Ice plant']] }).map((x) => x[1])).toEqual(['Gorse', 'Ice plant']);
    expect(expected('hea', 100)).toBe(expected('rec', 100));
  });
  it('lists what a hole still needs for strokes gained', () => {
    expect(holeGaps({ score: 4, putts: 2, firstPutt: 12, shots: [{ res: 'FW' }, { dist: 150, res: 'G' }] }, 4)).toEqual([]);
    expect(holeGaps({ score: 4, putts: 2, firstPutt: null, shots: [{ res: null }, { dist: null }] }, 4)).toEqual(['putt length', 'where the tee shot went', 'distance for shot 2']);
    expect(holeGaps({ score: 4, putts: 2, puttsAuto: true, firstPutt: 12, shots: [{ res: 'FW' }, { dist: 150 }] }, 4)).toEqual(['putts']);
    expect(holeGaps(null, 4)).toEqual([]);
  });
  it('puts first putts in bands; old lengths fall into theirs', () => {
    expect([1, 3, 6, 10, 20, 30, 50].map(puttBand)).toEqual([2, 4, 7, 12, 18, 25, 50]);
    expect(puttLabel(12)).toBe('10–15 ft');
    expect(puttLabel(2)).toBe('Tap-in');
  });
  it('draws the panels for each part of the hole', () => {
    const h = { shots: [{ lie: 'tee', res: 'RR', d: { club: 'Driver' } }, { lieAuto: 'rgh', dist: 146 }] };
    const fw = shotPanel({ h, k: 1, par: 4, course: { lat: 25, lon: 55 }, bag, dist: (x) => x, du: () => 'yd', holeYds: 400 });
    expect(fw).toContain('z-fairway'); expect(fw).toContain('Desert'); expect(fw).toContain('from your tee shot'); expect(fw).toContain('is your 7 iron');
    const t = shotPanel({ h, k: 0, par: 4, course: {}, bag, dist: (x) => x, du: () => 'yd', holeYds: 400 });
    expect(t).toContain('f.Bunker'); expect(t).toContain('Water'); expect(t).toContain('>OB<');
    const g = greenPanel({ putts: 2, firstPutt: 10 });
    expect(g).toContain('data-fpb="12"'); expect(g).toMatch(/class="on\s*" data-fpb="12"/);
  });
});

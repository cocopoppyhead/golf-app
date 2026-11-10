import { describe, it, expect } from 'vitest';
import { parseDelimited, mapHeaders, normaliseClub, parseLaunchFile } from '../../src/launchfile.js';
import { normaliseTable } from '../../src/launch.js';

const GARMIN = `Date,Player,Club Name,Club Type,Shot Type,Club Speed,Attack Angle,Club Path,Club Face,Face to Path,Ball Speed,Smash Factor,Launch Angle,Launch Direction,Backspin,Sidespin,Spin Rate,Spin Axis,Apex Height,Carry Distance,Carry Deviation Angle,Carry Deviation Distance,Total Distance,Total Deviation Angle,Total Deviation Distance,Note,Tag
2026-11-09 19:02:11,Conor,Driver,Driver,Full,101.2,-1.4,2.1,3.0,0.9,146.5,1.45,11.8,1.2,3620,410,3643,6.5,29.1,212.3,2.1,7.8,234.0,2.3,9.4,,
2026-11-09 19:03:40,Conor,Driver,Driver,Full,99.4,-2.0,1.0,4.1,3.1,134.2,1.35,13.1,2.2,3310,620,3368,10.6,27.0,195.1,3.4,11.6,215.2,3.5,13.1,,
2026-11-09 19:10:02,Conor,7 Iron,Iron,Full,82.0,-4.1,0.2,1.1,0.9,109.6,1.34,17.8,-0.5,6450,150,6452,1.3,27.5,150.2,-0.4,-1.0,158.0,-0.3,-0.8,,`;

const TRACKMAN = `TrackMan Report;;;;;;;;;;;;;
Player;Conor;;;;;;;;;;;;
;;;;;;;;;;;;;
Shot;Club;Club Speed (mph);Attack Angle (°);Ball Speed (mph);Smash Factor;Launch Angle (°);Spin Rate (rpm);Spin Axis (°);Height (yds);Carry (yds);Total (yds);Side (yds);Side Total (yds)
1;Dr;100,1;-1,2;141,6;1,41;11,5;3710;4,0;26,0;205,0;228,0;R 6,0;R 9,0
2;Dr;103,6;0,5;154,4;1,49;12,4;3150;-2,1;30,2;231,0;255,0;L 3,0;L 4,0
Average;;101,9;-0,4;148,0;1,45;12,0;3430;1,0;28,1;218,0;241,5;;`;

const MEVO = `Shot\tClub\tBall (km/h)\tClub (km/h)\tSmash\tLaunch V\tLaunch H\tSpin\tSpin Axis\tHeight (m)\tCarry (m)\tTotal (m)\tLateral (m)
1\t7i\t176.3\t132.0\t1.34\t17.8\t-0.5\t6450\t1.3\t25.1\t137.3\t144.5\t-1.0`;

describe('launch file import', () => {
  it('parses comma, semicolon (with decimal commas) and tab files', () => {
    expect(parseDelimited('a,b\n1,"x,y"\n').length).toBe(2);
    expect(parseDelimited(TRACKMAN)[2][2]).toBe('Club Speed (mph)');
    expect(parseDelimited(MEVO)[1][2]).toBe('176.3');
  });
  it('maps vendor headers to the app keys', () => {
    const g = mapHeaders(GARMIN.split('\n')[0].split(','));
    expect(Object.fromEntries(g.map((c) => [c.key, c.label]))).toMatchObject({ clubSpeed: 'Club Speed', ballSpeed: 'Ball Speed', launch: 'Launch Angle', backSpin: 'Backspin', apex: 'Apex Height', carry: 'Carry Distance', total: 'Total Distance', attack: 'Attack Angle', face: 'Club Face', path: 'Club Path', club: 'Club Name' });
    const t = mapHeaders(parseDelimited(TRACKMAN)[2]);
    expect(t.find((c) => c.key === 'side').label).toBe('Side (yds)');
    expect(t.filter((c) => c.key === 'side').length).toBe(1);
    expect(mapHeaders(MEVO.split('\n')[0].split('\t')).find((c) => c.key === 'ballSpeed').unit).toBe('kmh');
  });
  it('normalises club names', () => {
    expect(normaliseClub('Dr')).toBe('Driver'); expect(normaliseClub('7i')).toBe('7 iron'); expect(normaliseClub('3W')).toBe('3 wood'); expect(normaliseClub('56')).toBe('56°'); expect(normaliseClub('PW')).toBe('PW'); expect(normaliseClub('4 Hybrid')).toBe('4 hybrid');
  });
  it('Garmin export → one group per club, dated from the file', () => {
    const G = parseLaunchFile(GARMIN, { filename: 'Garmin_R10_Session.csv' });
    expect(G.map((g) => g.club).sort()).toEqual(['7 iron', 'Driver']);
    const d = G.find((g) => g.club === 'Driver');
    expect(d.source).toBe('Garmin R10'); expect(new Date(d.date).getFullYear()).toBe(2026);
    const T = normaliseTable(d.table);
    expect(T.rows.length).toBe(2); expect(T.rows[0].clubSpeed).toBe(101.2); expect(T.rows[0].backSpin).toBe(3620); expect(T.rows[0].carry).toBe(212.3); expect(T.cols).toContain('attack');
  });
  it('TrackMan report → skips the title block and the Average row; decimal commas and L/R sides', () => {
    const G = parseLaunchFile(TRACKMAN, { filename: 'trackman.csv' });
    expect(G.length).toBe(1); expect(G[0].club).toBe('Driver');
    const T = normaliseTable(G[0].table);
    expect(T.rows.length).toBe(2);
    expect(T.rows[0].clubSpeed).toBe(100.1); expect(T.rows[0].smash).toBe(1.41); expect(T.rows[0].side).toBe(6); expect(T.rows[1].side).toBe(-3);
  });
  it('FlightScope metric export converts km/h and metres', () => {
    const T = normaliseTable(parseLaunchFile(MEVO)[0].table);
    expect(T.rows[0].ballSpeed).toBeCloseTo(109.5, 0); expect(T.rows[0].clubSpeed).toBeCloseTo(82, 0); expect(T.rows[0].carry).toBeCloseTo(150.2, 0);
  });
  it('a file without launch columns yields nothing', () => {
    expect(parseLaunchFile('Hole,Score,Putts\n1,4,2\n')).toEqual([]);
  });
});

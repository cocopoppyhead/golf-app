import { describe, it, expect } from 'vitest';
import { leakText, whyFor, reasons, shotRounds } from '../../src/coach/leak.js';

const course = { holes: Array.from({ length: 18 }, () => ({ par: 4, yds: 400 })) };
// a good driver, chipper and putter who misses wedges short and long: half the wedges miss the green
const hole = (i) => (i % 2
  ? { score: 4, putts: 1, firstPutt: 4, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 110, res: 'GS', dir: i % 4 === 1 ? 'S' : 'L', sw: 'full', d: { strike: i % 8 === 1 ? 'FAT' : null } }, { lie: 'rgh', dist: 12, res: 'G', sw: 'chip' }] }
  : { score: 4, putts: 2, firstPutt: 25, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 110, res: 'G', sw: 'full' }] });
const rounds = (n) => Array.from({ length: n }, (_, k) => ({ r: { id: `r${k}`, finished: true, holes: course.holes.map((_, i) => hole(i)) }, c: course }));

describe('the biggest leak and why', () => {
  it('asks for 3 rounds logged shot by shot before it says anything', () => {
    expect(leakText(rounds(2), { hcp: 10 })).toMatch(/log their next 3 rounds shot by shot/);
    expect(leakText([{ r: { quick: true, holes: [] }, c: course }], { hcp: 10 })).toMatch(/Scorecards alone show the score/);
  });
  it('a watch\'s shots don\'t count as logged shot by shot', () => {
    const g = rounds(3).map(({ r, c }) => ({ r: { ...r, holes: r.holes.map((h) => ({ ...h, shots: h.shots.map((s) => ({ ...s, src: 'garmin' })) })) }, c }));
    expect(shotRounds(g)).toHaveLength(0);
  });
  it('counts why the wedges leak: distance, not direction', () => {
    const c = whyFor('appW', rounds(5));
    expect(c.n).toBe(90); expect(c.green).toBe(45);
    expect(c.short + c.long).toBe(45); expect(c.left + c.right).toBe(0);
    const R = reasons('appW', c);
    expect(R[0].why).toBe('distance');
    expect(R.find((x) => x.why === 'strike').text).toMatch(/fat/);
  });
  it('names the wedges as the leak and the reason, for the coach', () => {
    const t = leakText(rounds(5), { hcp: 10 });
    expect(t).toMatch(/Biggest leak: wedges/);
    expect(t).toMatch(/distance: \d+ short, \d+ long/);
    expect(t).toMatch(/don't spend the session on their strengths/);
  });
});

import { puttingWhy } from '../../src/coach/leak.js';
describe('putts missed to one side, whatever the read', () => {
  const putts = (i) => [{ ft: 15, brk: ['RL', 'LR', 'S'][i % 3], mside: 'LF', mlen: i % 2 ? 'S' : null, holed: false }, { ft: 2, holed: true }];
  const rcs = Array.from({ length: 3 }, (_, k) => ({ r: { id: `p${k}`, holes: Array.from({ length: 18 }, (_, i) => ({ score: 4, putts: 2, firstPutt: 15, puttList: putts(i), shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 120, res: 'G', sw: 'full' }] })) }, c: { holes: Array.from({ length: 18 }, () => ({ par: 4, yds: 400 })) } }));
  it('counts left misses on every kind of read', () => {
    const p = puttingWhy(rcs);
    expect(p.missN).toBe(54); expect(p.left).toBe(54); expect(p.right).toBe(0);
    expect(p.leftOnRtoL).toBe(18); expect(p.leftOnLtoR).toBe(18); expect(p.leftOnStraight).toBe(18);
  });
});

describe('wedges by swing length', () => {
  const course = { holes: Array.from({ length: 18 }, () => ({ par: 4, yds: 400 })) };
  // full wedges hit the green, ¾ wedges miss short
  const hole = (i) => (i % 2
    ? { score: 4, putts: 1, firstPutt: 4, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 70, res: 'GS', dir: 'S', sw: '3q' }, { lie: 'rgh', dist: 10, res: 'G', sw: 'chip' }] }
    : { score: 4, putts: 2, firstPutt: 25, shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 110, res: 'G', sw: 'full' }] });
  const rcs = Array.from({ length: 5 }, (_, k) => ({ r: { id: `w${k}`, holes: course.holes.map((_, i) => hole(i)) }, c: course }));
  it('shows the gap between full and part swings, and both fixes', () => {
    const t = leakText(rcs, { hcp: 10 });
    expect(t).toMatch(/Greens hit by swing length: .*full 100%.*¾ 0%/);
    expect(t).toMatch(/lay up to a full-swing number \(strategy\) or practise the part swings/);
  });
});

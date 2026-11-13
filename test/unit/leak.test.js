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

import { describe, it, expect } from 'vitest';
import { rows, splits, engineText } from '../../src/coach/engine.js';

const course = { holes: Array.from({ length: 18 }, () => ({ par: 4, yds: 400 })) };
// wedges: on soft greens they hold (green), on firm greens half run through (long)
const round = (k, firm) => ({ r: { id: `r${k}`, courseName: 'Trump International', kind: k % 2 ? 'comp' : 'casual', greens: { firm, speed: 'fast' }, holes: course.holes.map((_, i) => {
  const miss = firm === 'firm' && i % 2;
  return { score: 4, putts: miss ? 1 : 2, puttList: miss ? [{ ft: 6, brk: 'LR', holed: true }] : [{ ft: 20, holed: false, mside: 'LF' }, { ft: 2, holed: true }], shots: [{ lie: 'tee', dist: 400, res: 'FW' }, { lie: 'fw', dist: 110, res: miss ? 'GS' : 'G', dir: miss ? 'L' : null, sw: 'full' }, ...(miss ? [{ lie: 'rgh', dist: 12, res: 'G', sw: 'chip' }] : [])] };
}) }, c: course });
const rcs = [round(0, 'soft'), round(1, 'soft'), round(2, 'firm'), round(3, 'firm')];

describe('the analysis engine', () => {
  it('turns every logged shot and putt into a row with its context', () => {
    const { shots, putts } = rows(rcs);
    const w = shots.filter((x) => x.area === 'appW');
    expect(w).toHaveLength(72);
    expect(w[0]).toMatchObject({ swing: 'full swing', lie: 'fairway', firm: 'soft greens', speed: 'fast greens', nine: 'front nine', course: 'Trump International' });
    expect(putts.length).toBeGreaterThan(0);
  });
  it('a watch\'s shots are left out', () => {
    const g = [{ r: { holes: [{ score: 4, shots: [{ lie: 'tee', dist: 400, res: 'FW', src: 'garmin' }] }] }, c: course }];
    expect(rows(g).shots).toHaveLength(0);
  });
  it('finds where the result changes: wedges on soft against firm greens', () => {
    const S = splits(rows(rcs).shots.filter((x) => x.area === 'appW'), ['firm', 'kind', 'swing']);
    expect(S[0].dim).toBe('firm');
    expect(S[0].groups.map((g) => [g.v, g.pct])).toEqual([['soft greens', 100], ['firm greens', 50]]);
    expect(S.find((s) => s.dim === 'swing')).toBeUndefined(); // one group only: nothing to compare
  });
  it('reports it for the coach as differences, not causes', () => {
    const t = engineText(rcs);
    expect(t).toMatch(/Wedges \(30-139 yd\): greens 75% \(72\); by the greens: soft greens 100% \(36\), firm greens 50% \(36\)/);
    expect(t).toMatch(/differences, not causes/);
  });
  it('stays quiet with too little data', () => { expect(engineText([round(0, 'soft')].slice(0, 0))).toBe(''); });
});

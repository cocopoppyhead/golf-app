import { describe, it, expect } from 'vitest';
import { toParTv, roundToPar, courseHistory, mark, historyLine, ribbonHtml, cardHtml } from '../../src/rounds/ribbon.js';

const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const none = pars.map(() => null);

describe('ribbon', () => {
  it('shows to-par the broadcast way', () => {
    expect([toParTv(0), toParTv(2), toParTv(-1), toParTv(null)]).toEqual(['E', '+2', '-1', '–']);
  });
  it('rounds the average to a whole stroke, halves away from par', () => {
    expect(roundToPar(0.4)).toBe(0); expect(roundToPar(0.5)).toBe(1); expect(roundToPar(-0.5)).toBe(-1);
    expect(roundToPar(-0.4)).toBe(0); expect(roundToPar(1.49)).toBe(1); expect(roundToPar(null)).toBe(null);
  });
  it('builds per-hole history from earlier rounds, newest first, ignoring holes not played', () => {
    const r = (s) => ({ r: { holes: s.map((score) => (score == null ? null : { score })) } });
    const h = courseHistory([r([5, 4]), r([4, null]), r([6, 4]), r([5, 3])], [4, 4]);
    expect(h[0]).toEqual({ n: 4, avg: 1, last: [5, 4, 6] }); // 20/4 - 4 = +1
    expect(h[1]).toEqual({ n: 3, avg: 0, last: [4, 4, 3] }); // 11/3 - 4 = -0.33
    expect(courseHistory([], [4])[0]).toEqual({ n: 0, avg: null, last: [] });
  });
  it('marks scores like a scorecard', () => {
    expect(mark(2, 4)).toContain('eagle'); expect(mark(3, 4)).toContain('bird'); expect(mark(4, 4)).toContain('par');
    expect(mark(5, 4)).toContain('bog'); expect(mark(7, 4)).toContain('dbl'); expect(mark(null, 4)).toBe('');
  });
  it('writes the history line', () => {
    expect(historyLine(null, 4)).toContain('Loading');
    expect(historyLine({ n: 0, avg: null, last: [] }, 4)).toContain('FIRST TIME');
    const l = historyLine({ n: 4, avg: 1, last: [5, 4, 6] }, 4);
    expect(l).toContain('+1'); expect(l).toContain('(4 RDS)'); expect(l).toContain('LAST 3'); expect((l.match(/class="mk/g) || []).length).toBe(3);
    expect(historyLine({ n: 1, avg: 0, last: [4] }, 4)).toContain('(1 RD)');
  });
  it('shows the front nine on holes 1-9 and the back nine with IN on 10-18', () => {
    const s = [...none]; s[0] = 5; s[1] = 3;
    const front = ribbonHtml({ i: 2, pars, scores: s, name: 'Conor', hist: null });
    expect((front.match(/data-go="/g) || []).length).toBe(9);
    expect(front).toContain('data-go="0"'); expect(front).toContain('OUT'); expect(front).toContain('THRU 2'); expect(front).toContain('>E<');
    expect(front).toMatch(/rb-c cur rb-todo" data-go="2"/);
    const back = ribbonHtml({ i: 11, pars, scores: none, name: '', hist: null });
    expect(back).toContain('data-go="9"'); expect(back).not.toContain('data-go="8"'); expect(back).toContain('>IN<'); expect(back).toContain('NOT STARTED'); expect(back).toContain('YOU');
  });
  it('a 9-hole course shows TOT', () => {
    expect(ribbonHtml({ i: 0, pars: pars.slice(0, 9), scores: none.slice(0, 9), name: 'A', hist: null })).toContain('TOT');
  });
  it('escapes the name', () => {
    expect(ribbonHtml({ i: 0, pars, scores: none, name: '<b>x', hist: null })).not.toContain('<B>X');
  });
  it('the full card has both nines with today and the average', () => {
    const s = [...none]; s[0] = 4;
    const hists = pars.map(() => ({ n: 2, avg: 1, last: [5] }));
    const c = cardHtml({ i: 0, pars, scores: s, name: 'Conor', courseName: 'Emirates – Majlis', hists });
    expect((c.match(/class="cd-grid"/g) || []).length).toBe(2);
    expect(c).toContain('EMIRATES'); expect(c).not.toContain('MAJLIS'); expect(c).toContain('OUT'); expect(c).toContain('IN');
    expect(c).toContain('E THRU 1');
    expect(cardHtml({ i: 0, pars, scores: none, name: 'C', courseName: 'X', hists: null })).toContain('…');
  });
});

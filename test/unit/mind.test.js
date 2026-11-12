import { describe, it, expect } from 'vitest';
import { roundLines, mindContext, patterns } from '../../src/coach/mind.js';
import { turns } from '../../src/coach/mindchat.js';

const c = { holes: Array.from({ length: 18 }, () => ({ par: 4 })) };
const r = { id: 'a', date: Date.parse('2026-11-08'), courseName: 'Emirates Golf Club – Majlis', finished: true, kind: 'comp', aim: 'low',
  holes: c.holes.map((_, i) => ({ score: i === 13 ? 7 : i >= 9 ? 5 : 4, putts: 2 })),
  mood: { start: 5, turn: 6, finish: 8 }, process: { routine: 3, commit: 2, accept: 1 },
  debrief: { tags: ['Lost focus'], again: 'Breathe on the 10th tee' }, hr: { avg: 102, max: 131 }, cond: { start: { tempC: 31, windMph: 9 } } };

describe('mental coach context', () => {
  it('turns a round into the lines the coach needs', () => {
    const t = roundLines({ r, c });
    expect(t).toContain('83 strokes, +11. Front nine E, back nine +11');
    expect(t).toContain('E E E E E E E E E | +1 +1 +1 +1 +3');
    expect(t).toContain('Competition round; aim: shoot low');
    expect(t).toContain('14 (7 on a par 4)');
    expect(t).toContain('let bad shots go rarely');
    expect(t).toContain('Breathe on the 10th tee. Heart rate');
    expect(t).toContain('average 102');
    expect(t).toContain('31°C');
  });
  it('puts the routine first and the focus round apart from the rest', () => {
    const t = mindContext({ rounds: [{ r, c }], settings: { routine: { swingThought: 'left heel' } }, focus: { r, c } });
    expect(t).toMatch(/THEIR ROUTINE[\s\S]*left heel/);
    expect(t).toContain('THE ROUND THEY WANT TO TALK ABOUT');
    expect(t).toContain('RECENT ROUNDS\nNone logged yet.');
  });
});

describe('patterns the coach is given', () => {
  const mk = (k, back, o = {}) => ({ r: { id: `r${k}`, date: Date.parse('2026-10-01T05:00:00Z') + k * 864e5, courseName: 'Trump International Dubai', finished: true,
    holes: c.holes.map((_, i) => ({ score: i < 9 ? 4 + (i === 0 ? 1 : 0) : 4 + (i < 9 + back ? 1 : 0) })), ...o }, c });
  const rounds = [mk(1, 6, { cond: { start: { tempC: 35 } } }), mk(2, 7, { cond: { start: { tempC: 36 } } }), mk(3, 5, { cond: { start: { tempC: 34 } } }), mk(4, 1, { cond: { start: { tempC: 26 } } }), mk(5, 2, { cond: { start: { tempC: 25 } } }), mk(6, 1, { cond: { start: { tempC: 27 } } })];
  it('spots lopsided cards and ties them to the heat', () => {
    const p = patterns(rounds).join('\n');
    expect(p).toContain('front nine averages +1.0, back nine +3.7');
    expect(p).toContain('Lopsided cards (4+ shots between the nines): 3 of 6. 3 fell away on the back');
    expect(p).toContain('Heat: back nine minus front +5.0 (3 rounds at 32°C or hotter) against +0.3 (3 cooler)');
    expect(p).toContain('holes 1-3 +0.3');
  });
  it('says an incomplete round is incomplete, not "12 over"', () => {
    const r3 = { ...mk(9, 0).r, holes: [{ score: 5 }, { score: 4 }, { score: 3 }, ...Array(15).fill(null)] };
    expect(roundLines({ r: r3, c })).toContain('3 holes played, 12 strokes, E (an incomplete round)');
  });
  it('needs three full rounds before it claims a pattern', () => expect(patterns(rounds.slice(0, 2))).toEqual([]));
});
describe('chat turns', () => {
  it('joins two of yours in a row and starts with yours', () => {
    expect(turns([{ role: 'assistant', text: 'x' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: 'c' }]))
      .toEqual([{ role: 'user', text: 'a\n\nb' }, { role: 'assistant', text: 'c' }]);
  });
});

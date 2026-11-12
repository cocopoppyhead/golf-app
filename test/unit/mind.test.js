import { describe, it, expect } from 'vitest';
import { roundLines, mindContext } from '../../src/coach/mind.js';

const c = { holes: Array.from({ length: 18 }, () => ({ par: 4 })) };
const r = { id: 'a', date: Date.parse('2026-11-08'), courseName: 'Emirates Golf Club – Majlis', finished: true, kind: 'comp', aim: 'low',
  holes: c.holes.map((_, i) => ({ score: i === 13 ? 7 : i >= 9 ? 5 : 4, putts: 2 })),
  mood: { start: 5, turn: 6, finish: 8 }, process: { routine: 3, commit: 2, accept: 1 },
  debrief: { tags: ['Lost focus'], again: 'Breathe on the 10th tee' }, hr: { avg: 102, max: 131 }, cond: { start: { tempC: 31, windMph: 9 } } };

describe('mental coach context', () => {
  it('turns a round into the lines the coach needs', () => {
    const t = roundLines({ r, c });
    expect(t).toContain('front E, back +11');
    expect(t).toContain('Competition round; aim: shoot low');
    expect(t).toContain('14 (7 on par 4)');
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

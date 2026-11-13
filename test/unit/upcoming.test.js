import { describe, it, expect } from 'vitest';
import { upcomingText } from '../../src/coach/mindchat.js';
import { checkReply, knownNumbers } from '../../src/coach/check.js';

describe('scheduled rounds for the coach', () => {
  const now = new Date(2026, 10, 14, 9, 0).getTime();
  const ev = (d, h, m, extra = {}) => ({ id: `e${d}`, when: new Date(2026, 10, d, h, m).getTime(), courseName: 'Test Links', ...extra });

  it('gives the tee time as entered, with who and the note', () => {
    const t = upcomingText([ev(15, 15, 30, { who: 'Sam', note: '9 holes' })], now);
    expect(t).toContain('15:30 at Test Links with Sam (9 holes)');
    expect(t).toMatch(/Sun 15 Nov/);
  });

  it('leaves out past and far-off rounds', () => {
    expect(upcomingText([ev(10, 8, 0), ev(30, 8, 0)], now)).toBe('');
  });

  it('lets the coach quote that tee time and no other', () => {
    const ctx = upcomingText([ev(15, 15, 30)], now);
    expect(checkReply('See you on the tee at 15:30.', knownNumbers(ctx), { times: ctx })).toEqual([]);
    expect(checkReply('See you on the tee at 12:00.', knownNumbers(ctx), { times: ctx }).join(' ')).toMatch(/time/);
  });
});

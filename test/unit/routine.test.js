import { describe, it, expect } from 'vitest';
import { DEFAULT_ROUTINE, getRoutine, routineHtml, routineText } from '../../src/rounds/routine.js';

describe('routine', () => {
  it('falls back to the example and flags it', () => {
    const R = getRoutine({});
    expect(R.preshot).toEqual(DEFAULT_ROUTINE.preshot); expect(R.custom).toBe(false); expect(R.swingThought).toBe('');
    expect(routineHtml(R)).toContain('example routine');
  });
  it('uses the golfer\'s lines, one per line, blanks ignored', () => {
    const R = getRoutine({ routine: { preshot: 'Bag away\n\n  Commit  \n', mind: '', swingThought: ' left heel ' } });
    expect(R.preshot).toEqual(['Bag away', 'Commit']); expect(R.mind).toEqual(DEFAULT_ROUTINE.mind); expect(R.custom).toBe(true); expect(R.swingThought).toBe('left heel');
    const html = routineHtml(R, { swingThought: 'left heel', expect: 'no doubles' });
    expect(html).toContain('<li>Bag away</li>'); expect(html).toContain('left heel'); expect(html).toContain('no doubles'); expect(html).not.toContain('example routine');
  });
  it('escapes and summarises', () => {
    expect(routineHtml(getRoutine({ routine: { preshot: '<b>x</b>' } }))).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(routineText({ swingThought: 'tempo', expect: 'enjoy it' })).toBe('swing thought “tempo”, expectation “enjoy it”');
    expect(routineText({})).toBe('');
  });
});

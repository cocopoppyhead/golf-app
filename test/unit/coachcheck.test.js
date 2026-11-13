import { describe, it, expect } from 'vitest';
import { checkReply, knownNumbers, repairPrompt } from '../../src/coach/check.js';
import { startFlow, stepText, advance, STEPS } from '../../src/coach/flow.js';

const ctx = 'Trump International, 5 Nov: 78 strokes, +6. Front nine +5, back nine +1. Hole by hole to par: +1 0 +2 0 0 +1 0 +1 0 | 0 0 +1 0 0 0 0 0 0. Started 15:30.';
const known = knownNumbers(ctx);

describe('the app checks every coach reply', () => {
  it('passes a good reply', () => {
    expect(checkReply('Front nine +5, back nine +1: the damage was early. On the 1st tee next time, take your 3 wood. What happened on the 3rd?', known)).toEqual([]);
  });
  it('catches two questions', () => {
    expect(checkReply('How did you feel? And what club?', known)[0]).toMatch(/2 questions/);
  });
  it('catches a list and headings', () => {
    const p = checkReply('## Read\n- one\n- two', known);
    expect(p.some((x) => /list/.test(x))).toBe(true); expect(p.some((x) => /headings/.test(x))).toBe(true);
  });
  it('catches a number the app never gave it', () => {
    expect(checkReply('You were +9 on the back nine.', known).join()).toMatch(/\+9/);
    expect(checkReply('You averaged 84 there.', known).join()).toMatch(/84/);
    expect(checkReply('You hit 62% of fairways.', known).join()).toMatch(/62/);
  });
  it('lets through numbers the golfer said, and advice numbers', () => {
    const k = knownNumbers(ctx, 'I three-putted 4 times');
    expect(checkReply('Those 4 three-putts are the leak. Lag to a 3-foot circle, 20 balls this week.', k)).toEqual([]);
  });
  it('catches the impossible: +12 over 3 holes', () => {
    const k = knownNumbers('12 strokes over 3 holes, +12 strokes'); // even if 12 appears somewhere
    expect(checkReply('You were +12 over 3 holes there.', k).join()).toMatch(/impossible/);
    expect(checkReply('You were 2 over for the last three holes.', knownNumbers('2'))).toEqual([]);
  });
  it('never assumes a tee time', () => {
    expect(checkReply('With a 7am start the dew would have slowed the greens.', known).join()).toMatch(/time/);
  });
  it('the repair note names the problems', () => {
    expect(repairPrompt(['it asks 2 questions'])).toMatch(/2 questions/);
  });
});

describe('the conversation has a shape, not a script', () => {
  it('an open question has no steps', () => {
    expect(stepText(startFlow('open'))).toBe('');
  });
  it('a debrief starts by hearing the round and moves on when the step is done', () => {
    let f = startFlow('debrief');
    expect(stepText(f)).toMatch(/Step 1 of 4/);
    f = advance(f, { step_done: true });
    expect(stepText(f)).toMatch(/Step 2 of 4/);
  });
  it('never circles a step for ever: moves on after three replies', () => {
    let f = startFlow('debrief');
    f = advance(f, {}); f = advance(f, {}); expect(f.step).toBe(0);
    f = advance(f, {}); expect(f.step).toBe(1);
  });
  it('ends closed, and stays there', () => {
    let f = startFlow('debrief');
    for (let i = 0; i < 20; i++) f = advance(f, { step_done: true });
    expect(f.step).toBe(STEPS.debrief.length - 1);
    expect(stepText(f)).toMatch(/closed/);
    expect(stepText(f)).not.toMatch(/step_done/);
  });
  it('says it is a spine, not a script', () => {
    expect(stepText(startFlow('pre-round'))).toMatch(/spine, not a script/);
  });
});

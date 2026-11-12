import { describe, it, expect } from 'vitest';
import { splitLearning, pictureText } from '../../src/coach/picture.js';

describe('what the coach learns', () => {
  it('splits the learning block off the reply', () => {
    const { text, meta } = splitLearning('Walk faster between shots.\n```json\n{"note":"slow play gets to him","works":["walk fast","hum"],"next":"hum on the 10th tee"}\n```');
    expect(text).toBe('Walk faster between shots.');
    expect(meta.works).toEqual(['walk fast', 'hum']);
  });
  it('keeps the text when the block is broken', () => {
    const { text, meta } = splitLearning('Fine.\n```json\n{oops\n```');
    expect(text).toBe('Fine.'); expect(meta).toBeNull();
  });
  it('reads back as the coach sees it', () => {
    expect(pictureText({ works: ['hum a tune'], unravels: [], cues: [], next: 'target out loud', notes: [{ at: Date.parse('2026-11-12'), note: 'first chat' }] })).toContain('What works for them: hum a tune.');
    expect(pictureText({ works: [], unravels: [], cues: [], next: null, notes: [] })).toContain('Nothing yet');
  });
});

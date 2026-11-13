import { describe, it, expect, beforeEach } from 'vitest';
import { addWork, getWork } from '../../src/workingon.js';

describe('the coach adds an agreed focus to Range work', () => {
  beforeEach(() => localStorage.clear());
  it('adds it with its drills, newest first', () => {
    const w = addWork({ title: 'Wedge distance', text: 'Control ¾ wedges', why: '0% greens with ¾ wedges', drills: [{ name: 'Wedge ladder', how: '50/75/100% to the same target', reps: '3 x 10' }] });
    expect(w.from).toBe('coach');
    expect(getWork()[0]).toMatchObject({ title: 'Wedge distance', text: 'Control ¾ wedges' });
    expect(getWork()[0].drills[0].name).toBe('Wedge ladder');
  });
  it('ignores an empty plan', () => { expect(addWork({})).toBeNull(); });
});

import { describe, it, expect } from 'vitest';
import { chatMarkdown } from '../../src/coach/sharechat.js';

describe('sharing the coach chat', () => {
  it('writes the whole conversation, who said what, and what the coach learned', () => {
    const md = chatMarkdown([
      { role: 'user', text: 'Talk me through my last round', at: Date.parse('2026-11-12T15:30:00Z') },
      { role: 'assistant', text: 'Front nine +5, back nine +1.', at: Date.parse('2026-11-12T15:31:00Z'), added: 'Wedge distance' },
    ], { picture: { works: ['a long exhale'], unravels: [], cues: [], next: 'commit on the 1st tee', notes: [] }, model: 'Claude' });
    expect(md).toMatch(/^# osolo coach chat/);
    expect(md).toMatch(/## Me .*\n\nTalk me through my last round/);
    expect(md).toMatch(/## Coach .*\n\nFront nine \+5, back nine \+1\./);
    expect(md).toMatch(/Added to Range work: Wedge distance/);
    expect(md).toMatch(/What the coach has learned[\s\S]*a long exhale/);
    expect(md).toMatch(/Coach: Claude/);
  });
});

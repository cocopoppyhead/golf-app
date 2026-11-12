import { describe, it, expect } from 'vitest';
import { SCENARIOS } from '../coach-evals/scenarios.mjs';
import { mindContext } from '../../src/coach/mind.js';
import { systemPrompt } from '../../src/coach/playbook.js';
import { evidence } from '../../src/coach/mind.js';

// Offline half of the coach evals: each scenario's story must actually be in what the coach is given.
const ctx = (id) => mindContext({ rounds: SCENARIOS.find((s) => s.id === id).rounds, settings: {} });
describe('coach eval scenarios carry their story', () => {
  it('heat fade: heat, tee time and heart rate by nine', () => {
    const t = ctx('heat-fade');
    expect(t).toContain('Heat: back nine minus front +5.0');
    expect(t).toContain('Heart rate by nine (5 rounds): front 98, back 118');
  });
  it('focus fade: wound up at the turn, and their own words', () => {
    const t = ctx('focus-fade');
    expect(t).toContain('Feeling at the turn: back nine minus front +5.0');
    expect(t).toContain('Lost focus (5)');
    expect(t).not.toContain('Heat:');
  });
  it('double chain: the hole after a double', () => expect(ctx('double-chain')).toMatch(/hole after a double or worse averages \+(0\.[5-9]|1\.\d)/));
  it('incomplete: never "12 over"', () => expect(ctx('incomplete')).toContain('3 holes played, 12 strokes, -1 (an incomplete round)'));
  it('two rounds: no patterns claimed', () => expect(ctx('small-sample')).not.toContain('PATTERNS'));
  it('the playbook has every part, and the modes differ', () => {
    for (const k of ['WHAT TO LOOK AT', 'HOW TO READ IT', 'WHAT TO HAND BACK', 'HOW TO HOLD THE CONVERSATION']) expect(systemPrompt()).toContain(k);
    expect(systemPrompt('pre-round')).toContain('BEFORE A ROUND');
    expect(systemPrompt('debrief')).toContain('DEBRIEF');
  });

  it('knows how much evidence it has', () => {
    expect(evidence(SCENARIOS.find((s) => s.id === 'baseline').rounds).phase).toBe('baseline');
    expect(ctx('baseline')).toContain('PHASE: BASELINE');
    expect(evidence(SCENARIOS.find((s) => s.id === 'heat-fade').rounds).phase).toBe('early');
  });
});

import { gameText } from '../../src/coach/game.js';
describe('the game block the coach reads', () => {
  const g = (id) => { const s = SCENARIOS.find((x) => x.id === id); return gameText({ rcs: s.rounds, settings: s.settings || {} }); };
  it('has the Tiger 5 and the go-to club', () => {
    const t = g('why-not-lower');
    expect(t).toContain('Tiger 5 per round over 6 full rounds');
    expect(t).toContain('Double bogeys 1.0');
    expect(t).toContain('go-to club, in their words: 3 wood off the tee');
    expect(t).not.toContain('[object Object]');
  });
  it('playbook has the four hats and the triage', () => {
    const p = systemPrompt();
    for (const k of ['The strategist', 'The swing coach', 'The psychologist', 'The caddie', 'HOW TO TELL WHICH IT IS', 'WHAT YOU STAND FOR']) expect(p).toContain(k);
  });
});

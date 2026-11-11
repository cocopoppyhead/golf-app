import { describe, it, expect } from 'vitest';
import { monogram } from '../../src/rounds/badge.js';

describe('course badges', () => {
  it('makes two-letter monograms from the distinctive words', () => {
    expect(monogram('The Montgomerie Golf Club Dubai')).toBe('MO');
    expect(monogram('The Els Club Dubai')).toBe('EL');
    expect(monogram('Jumeirah Golf Estates – Earth')).toBe('JE');
    expect(monogram('Yas Links Abu Dhabi')).toBe('YL');
    expect(monogram('Abu Dhabi Golf Club - Garden Course')).toBe('AD');
    expect(monogram('Abu Dhabi City Golf Club')).toBe('AD');
    expect(monogram('Emirates Golf Club – Faldo')).toBe('EM');
    expect(monogram('Dubai Hills Golf Club')).toBe('DH');
    expect(monogram('Jebel Ali Golf Resort (9 holes)')).toBe('JA');
    expect(monogram('Trump International Golf Club Dubai')).toBe('TI');
    expect(monogram('')).toBe('?');
  });
});

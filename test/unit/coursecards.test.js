import { describe, it, expect } from 'vitest';
import { monogram } from '../../src/rounds/course.js';

describe('course badges', () => {
  it('makes two-letter monograms from the distinctive words', () => {
    expect(monogram('The Montgomerie Golf Club Dubai')).toBe('MO');
    expect(monogram('The Els Club Dubai')).toBe('EL');
    expect(monogram('Jumeirah Golf Estates – Earth')).toBe('JE');
    expect(monogram('Yas Links Abu Dhabi')).toBe('YA');
    expect(monogram('Trump International Golf Club Dubai')).toBe('TI');
    expect(monogram('')).toBe('?');
  });
});

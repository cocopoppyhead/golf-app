import { describe, it, expect } from 'vitest';
import { skyOf, greeting, shortCourse, clubName } from '../../src/rounds/hero.js';

const c = (o) => ({ tempC: 28, windMph: 6, gustMph: 9, code: 0, day: true, cloud: 5, ...o });
describe('Play greeting', () => {
  it('reads the sky from the weather code', () => {
    expect(skyOf(c())).toBe('sun');
    expect(skyOf(c({ code: 2 }))).toBe('part');
    expect(skyOf(c({ code: 3 }))).toBe('cloud');
    expect(skyOf(c({ code: 61 }))).toBe('rain');
    expect(skyOf(c({ code: 95 }))).toBe('storm');
    expect(skyOf(c({ day: false }))).toBe('night');
  });
  it('only says lovely when it is', () => {
    expect(greeting(c(), 'Conor')).toBe('Lovely day for a game of golf, Conor.');
    expect(greeting(c({ tempC: 42 }))).toMatch(/scorcher/i);
    expect(greeting(c({ windMph: 22 }))).toMatch(/breezy/i);
    expect(greeting(c({ code: 63 }))).toMatch(/wet/i);
    expect(greeting(null, 'Conor')).toBe('Fancy a game, Conor?');
  });
  it('shortens course names for the tiles', () => {
    expect(shortCourse('Emirates Golf Club – Majlis')).toBe('Emirates – Majlis');
    expect(shortCourse('Dubai Creek Golf & Yacht Club – Championship')).toBe('Dubai Creek');
    expect(clubName('The Els Club Dubai')).toBe('Els Club Dubai');
  });
});

import { whereAmI } from '../../src/rounds/hero.js';
describe('where am I', () => {
  const courses = [{ group: 'majlis', lat: 25.086, lon: 55.164 }, { group: 'creek', lat: 25.243, lon: 55.333 }];
  it('never guesses without a location', () => expect(whereAmI(null, courses).mode).toBe('home'));
  it('at the course', () => expect(whereAmI([25.087, 55.165], courses)).toEqual({ mode: 'at', at: 'majlis' }));
  it('in town', () => expect(whereAmI([25.2, 55.27], courses).mode).toBe('home'));
  it('travelling', () => expect(whereAmI([51.5, -0.12], courses).mode).toBe('away'));
});

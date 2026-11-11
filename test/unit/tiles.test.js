import { describe, it, expect } from 'vitest';
import { tilesHtml, clubSummary } from '../../src/launch.js';
describe('tiles', () => {
  it('renders eight tiles with benchmark bars for a full session', () => {
    const rows = [[101.2, 146.5, 11.8, 3620, 8], [99.4, 134.2, 13.1, 3310, -12], [102.8, 148.9, 12.0, 3490, 15]].map((r, i) => ({ n: i + 1, clubSpeed: r[0], ballSpeed: r[1], smash: Math.round((r[1] / r[0]) * 100) / 100, launch: r[2], backSpin: r[3], side: r[4], carry: 185 + i * 3, attack: -1.5 }));
    const q = clubSummary([{ id: 'a', date: 1, club: 'Driver', ball: 'range', rows }], 'Driver');
    const html = tilesHtml(q, 'Driver');
    expect((html.match(/class="lmtile /g) || []).length).toBe(8);
    expect(html).toMatch(/Dispersion/);
    expect((html.match(/class="bar/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

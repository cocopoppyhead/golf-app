import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

// Progress → "Your game": the skills radar from seeded hole-by-hole rounds, the window toggle and the axis tap.
test('the skills radar draws six axes from rounds, switches windows and jumps to the detail', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('golf.settings')); s.handicap = 12; s.handicapMode = 'manual'; localStorage.setItem('golf.settings', JSON.stringify(s));
    const course = { id: 'c', name: 'Test Links', tees: 'Blue', holes: Array.from({ length: 18 }, (_, i) => ({ par: i % 6 === 2 ? 3 : i % 6 === 5 ? 5 : 4, yds: i % 6 === 2 ? 170 : 400 })) };
    const round = (k) => ({ id: `r${k}`, finished: true, learning: true, date: Date.parse('2026-06-01') + k * 7 * 864e5, courseId: 'c', courseName: 'Test Links', tees: 'Blue', holes: course.holes.map((h, i) => {
      if (h.par === 3) return { score: 3, putts: 2, firstPutt: 30, tags: [], shots: [{ lie: 'tee', dist: 170, res: 'G' }] };
      const onG = (i + k) % 10 < 5, wedge = (i + k) % 4 === 0;
      const shots = [{ lie: 'tee', dist: 400, res: 'FW', d: { plan: true } }];
      if (wedge) shots.push({ lie: 'fw', dist: 230, res: 'FW' }, { lie: 'fw', dist: 95, res: onG ? 'G' : 'RG' });
      else shots.push({ lie: 'fw', dist: 160, res: onG ? 'G' : 'RG' });
      if (!onG) shots.push({ lie: 'bnk', dist: 15, res: 'G' });
      return { score: shots.length + 2, putts: 2, firstPutt: onG ? 20 : 8, tags: [], shots };
    }) });
    await new Promise((res, rej) => { const r = indexedDB.open('golf-app', 6); r.onsuccess = () => { const t = r.result.transaction(['courses', 'rounds'], 'readwrite'); t.objectStore('courses').put(course); for (let k = 0; k < 12; k++) t.objectStore('rounds').put(round(k)); t.oncomplete = res; t.onerror = rej; }; r.onerror = rej; });
  });
  await page.reload();
  await page.click('nav button[data-tab=history]');
  const card = page.locator('.radarcard');
  await expect(card).toBeVisible();
  await expect(card.locator('.radar .rax')).toHaveCount(6);
  await expect(card.locator('.radar .ryou')).toHaveCount(1);
  await expect(card).toContainText('The handicap each part of your game plays like'); await expect(card.locator('.rring.target')).toHaveText('10'); // a 12 aims at 10
  await expect(page.locator('.area .ah p').filter({ hasText: /Your (strength|biggest gap)/ }).first()).toBeVisible();
  await expect(card.locator('[data-radar-n="10"]')).toHaveClass(/on/);
  await expect(card.locator('[data-radar-n="50"]')).toHaveText('All 12'); // only 12 fully tracked rounds
  await expect(card.locator('[data-radar-n="50"]')).toBeEnabled();
  await expect(card.locator('[data-radar-n="100"]')).toBeDisabled();
  await expect(card).toContainText('Mind');
  await expect(card).toContainText('Short game');
  await expect(card.locator('.hbasis')).toContainText('10 rounds');
  await expect(card.locator('.hbasis')).toContainText('10 with every shot logged');
  // keep one round out of the radar but in the scores
  await card.locator('[data-pickrounds]').click();
  await page.locator('.pickrounds [data-radar-rid="r11"]').click();
  await expect(page.locator('.pickrounds [data-radar-rid="r11"]')).toHaveText('Left out of radar');
  await page.locator('.pickrounds [data-close]').click();
  await expect(page.locator('.radarcard .hused')).toContainText('Scores from 12 rounds, radar from 11');
  await page.locator('.radarcard .hexplain summary').click();
  await expect(card.locator('.radarinfo')).toContainText('Wedges');
  await page.locator('.radarcard .radar [data-goto="putting"] .rl').click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
});

// Unfinished rounds stay out of Progress until you tick them in "Choose rounds".
test('rounds that look unfinished are left out, and you can pick them back in', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const course = { id: 'c', name: 'Test Links', tees: 'Blue', holes: Array.from({ length: 18 }, () => ({ par: 4, yds: 400 })) };
    const round = (k, gap) => ({ id: `r${k}`, finished: true, learning: true, date: Date.parse('2026-06-01') + k * 864e5, courseId: 'c', courseName: 'Test Links', holes: course.holes.map((_, i) => (gap && i === 4 ? null : { score: 5, putts: 2, tags: [] })) });
    await new Promise((res, rej) => { const r = indexedDB.open('golf-app', 6); r.onsuccess = () => { const t = r.result.transaction(['courses', 'rounds'], 'readwrite'); t.objectStore('courses').put(course); [round(1), round(2), round(3, true)].forEach((x) => t.objectStore('rounds').put(x)); t.oncomplete = res; t.onerror = rej; }; r.onerror = rej; });
  });
  await page.reload();
  await page.click('nav button[data-tab=history]');
  const card = page.locator('.radarcard');
  await expect(card.locator('.hused')).toContainText('Scores from 2 rounds (1 left out), radar from 0');
  await card.locator('[data-pickrounds]').click();
  const row = page.locator('.pickrounds .prow.off');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('hole 5 not scored');
  await row.locator('input').check();
  await page.locator('.pickrounds [data-close]').click();
  await expect(page.locator('.radarcard .hused')).toContainText('Scores from 3 rounds');
});

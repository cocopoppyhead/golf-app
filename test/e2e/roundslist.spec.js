import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

// Play: the five latest rounds, then "All rounds" with course and date filters.
test('the rounds list shows five, and All rounds filters by course and date', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const mk = (id, name) => ({ id, name, tees: '', holes: Array.from({ length: 9 }, () => ({ par: 4 })) });
    const day = 864e5, now = Date.now();
    const R = Array.from({ length: 8 }, (_, k) => ({ id: `r${k}`, finished: true, quick: true, holesPlayed: 9, score: 40 + k, courseId: k % 2 ? 'b' : 'a', courseName: k % 2 ? 'Bravo Links' : 'Alpha Club', date: now - k * 60 * day, holes: [] }));
    await new Promise((res) => { const o = indexedDB.open('golf-app'); o.onsuccess = () => { const t = o.result.transaction(['courses', 'rounds'], 'readwrite'); t.objectStore('courses').put(mk('a', 'Alpha Club')); t.objectStore('courses').put(mk('b', 'Bravo Links')); R.forEach((r) => t.objectStore('rounds').put(r)); t.oncomplete = res; }; });
  });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await expect(page.locator('#view-rounds .hist, .hist').filter({ hasText: /Alpha|Bravo/ })).toHaveCount(5);
  await page.click('[data-act=allrounds]');
  const sheet = page.locator('.sheet.allrounds');
  await expect(sheet.locator('.hist')).toHaveCount(8);
  await sheet.locator('[data-course]').selectOption('Bravo Links');
  await expect(sheet.locator('.hist')).toHaveCount(4);
  await sheet.locator('[data-when]').selectOption('90');
  await expect(sheet.locator('.hist')).toHaveCount(1); // only the round 60 days ago
  await sheet.locator('.hist').first().click();
  await expect(sheet).toHaveCount(0);
});

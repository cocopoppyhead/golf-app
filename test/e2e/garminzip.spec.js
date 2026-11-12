import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';
import { scorecardFit, storedZip } from '../fixtures/garminfit.js';

// Garmin's own export: a zip with several scorecards — two on a course osolo doesn't know, two on a
// UAE library course — imports in one go, creating each course once.
test('a Garmin export zip imports every round, creating each course once', async ({ page }) => {
  await boot(page);
  const p9 = [4, 3, 4, 3, 4, 3, 4, 4, 3], p18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const day = 86400;
  const zip = storedZip([
    ['x/DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-101.fit', scorecardFit({ course: 'Pine Cliffs Golf', tee: 'Yellow', pars: p9, scores: [5, 4, 4, 4, 6, 4, 5, 3, 3] })],
    ['x/DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-102.fit', scorecardFit({ course: 'Pine Cliffs Golf', tee: 'Yellow', start: 1011189463 + day, pars: p9, scores: [4, 3, 4, 3, 5, 3, 4, 4, 3] })],
    ['x/DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-103.fit', scorecardFit({ course: 'The Montgomerie Dubai Golf Club', tee: 'Blue', start: 1011189463 + 2 * day, pars: p18, scores: p18.map((p) => p + 1), putts: p18.map(() => 2) })],
    ['x/DI_CONNECT/DI-GOLF/Golf-SCORECARD_RAWDATA-104.fit', scorecardFit({ course: 'The Montgomerie Dubai Golf Club', tee: 'Blue', start: 1011189463 + 3 * day, pars: p18, scores: p18 })],
    ['x/DI_CONNECT/DI-GOLF/Golf-COURSE.json', new TextEncoder().encode('{"type":"COURSE","data":[]}')],
  ]);
  await page.click('nav button[data-tab=settings]');
  await page.click('#garminBtn');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-pickmany]')]);
  await fc.setFiles({ name: 'garmin-export.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('.garmin [data-out]')).toContainText('Imported 4 rounds');
  await page.locator('.garmin [data-close]').click();
  await page.click('nav button[data-tab=rounds]');
  await expect(page.locator('.hist')).toHaveCount(4);
  const courses = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('golf-app'); r.onsuccess = () => { const q = r.result.transaction('courses').objectStore('courses').getAll(); q.onsuccess = () => res(q.result.map((c) => c.name)); }; }));
  expect(courses.filter((n) => /Pine Cliffs/.test(n))).toHaveLength(1);
  expect(courses.filter((n) => /Montgomerie/.test(n))).toHaveLength(1);
  // importing again adds nothing
  await page.click('nav button[data-tab=settings]'); await page.click('#garminBtn');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-pickmany]')]);
  await fc2.setFiles({ name: 'garmin-export.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('.garmin [data-out]')).toContainText('4 already here');
});

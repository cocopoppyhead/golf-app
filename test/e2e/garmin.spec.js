import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

const pt = (dN, dE, lie) => ({ lat: 25.0 + dN / 111320, lon: 55.0 + dE / (111320 * Math.cos((25 * Math.PI) / 180)), lie });
const pin = { lat: 25.0036, lon: 55.0 };
const shots = [
  { shotOrder: 1, clubId: 101, meters: 240, shotType: 'TEE', startLoc: { lat: 25, lon: 55, lie: 'TeeBox' }, endLoc: pt(240, -10, 'Fairway') },
  { shotOrder: 2, clubId: 107, meters: 150, shotType: 'APPROACH', startLoc: pt(240, -10, 'Fairway'), endLoc: pt(396, 2, 'Green') },
  { shotOrder: 3, clubId: 123, meters: 4, shotType: 'PUTT', startLoc: pt(396, 2, 'Green'), endLoc: pt(400, 0, 'Green') },
];
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, strokes: i === 0 ? 3 : 5, putts: 2 }));
const EXPORT = { app: 'osolo-garmin', version: 1, clubs: [{ id: 101, clubTypeId: 1 }, { id: 107, clubTypeId: 16 }, { id: 123, clubTypeId: 23 }], clubTypes: [], rounds: [
  { id: 777, scorecard: { startTime: '2026-10-20T06:30:00', holes }, course: { name: 'Emirates Golf Club - Majlis', holePars: '454434345443544345' }, holeShots: [{ holeNumber: 1, pinPosition: pin, shots }] },
] };

test('Garmin export imports as a round on a library course, with tracked shots', async ({ page }) => {
  await boot(page);
  await page.click('nav button[data-tab=settings]');
  await page.click('#garminBtn');
  const sheet = page.locator('.sheet.garmin');
  await expect(sheet).toContainText('connect.garmin.com');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), sheet.locator('[data-pick]').click()]);
  await chooser.setFiles({ name: 'osolo-garmin-2026-11-11.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(EXPORT)) });
  await expect(sheet.locator('[data-out]')).toContainText('Imported 1 round');
  await expect(sheet.locator('[data-out]')).toContainText('2 tracked shots');
  await sheet.locator('[data-close]').click();
  // the round is on the Play list, on the Majlis, and its summary opens
  await page.click('nav button[data-tab=rounds]');
  const row = page.locator('.hist').first();
  await expect(row).toContainText('Majlis');
  await expect(row).toContainText('88');
  await row.click();
  await expect(page.locator('.card.debrief')).toBeVisible();
  // importing again adds nothing
  await page.click('nav button[data-tab=settings]');
  await page.click('#garminBtn');
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.sheet.garmin [data-pick]').click()]);
  await chooser2.setFiles({ name: 'osolo-garmin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(EXPORT)) });
  await expect(page.locator('.sheet.garmin [data-out]')).toContainText('Imported 0 rounds (1 already here)');
});

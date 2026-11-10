import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

test('the app loads and every tab renders', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  for (const tab of ['rounds', 'coach', 'history', 'bag', 'settings']) {
    await page.click(`nav button[data-tab=${tab}]`);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('settings save and persist: units switch to metric', async ({ page }) => {
  await boot(page);
  await page.click('nav button[data-tab=settings]');
  await page.selectOption('#settingsForm [name=system]', 'metric');
  await expect(page.locator('#hUnit')).toHaveText('cm');
  await page.locator('#settingsForm button[type=submit]').click();
  await expect(page.locator('#savedMsg')).toBeVisible();
  await page.reload();
  await page.click('nav button[data-tab=settings]');
  await expect(page.locator('#settingsForm [name=system]')).toHaveValue('metric');
});

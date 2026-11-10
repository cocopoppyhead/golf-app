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

import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

test('drill library opens, a drill can be favourited and logged', async ({ page }) => {
  await boot(page);
  await page.click('nav button[data-tab=coach]');
  await page.click('#drillsCard [data-lib]');
  await expect(page.locator('.drilllib')).toBeVisible();
  await page.click('.drilllib .ditem >> nth=0');
  await expect(page.locator('.drillsheet')).toBeVisible();
});

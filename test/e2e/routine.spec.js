import { test, expect } from '@playwright/test';
import { boot, addCourse } from './helpers.js';

// My routine: edited in Settings, shown with the swing thought before the round, one tap away on a hole.
test('the routine is set in Settings, shown at the start and from the hole screen', async ({ page }) => {
  await boot(page);
  await page.click('nav button[data-tab=settings]');
  await page.fill('#settingsForm [name=routinePre]', 'Bag behind me\nCommit to it');
  await page.fill('#settingsForm [name=swingThought]', 'left heel');
  await page.click('#settingsForm button[type=submit]');
  await addCourse(page, 'Montgomerie');
  await page.click('[data-x=start]');
  // through the tee picker if one shows, to the start sheet
  for (let i = 0; i < 3; i++) {
    const sheet = page.locator('.sheet').last();
    await sheet.waitFor({ state: 'visible' });
    if (await sheet.locator('.tee').count()) { await sheet.locator('.tee').first().click(); continue; }
    if (await sheet.locator('.moodscale').count()) break;
    await sheet.locator('[data-ok]').click();
  }
  const start = page.locator('.sheet').last();
  await expect(start.locator('[data-thought]')).toHaveValue('left heel');
  await start.locator('[data-expect]').fill('no doubles');
  await start.locator('.rtd summary').click();
  await expect(start.locator('.routine')).toContainText('Bag behind me');
  await expect(start.locator('.routine')).not.toContainText('example routine');
  await start.locator('[data-m="5"]').click();
  await start.locator('[data-ok]').click();
  await page.waitForSelector('.holebar');
  await page.locator('[data-routine]').first().click();
  const rs = page.locator('.sheet').last();
  await expect(rs).toContainText('Before the shot');
  await expect(rs).toContainText('left heel');
  await expect(rs).toContainText('no doubles');
  await expect(rs).toContainText('Commit to it');
  await rs.locator('[data-x]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
});

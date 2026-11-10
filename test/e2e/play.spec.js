import { test, expect } from '@playwright/test';
import { boot, addCourse, startRound, endEarly, packet } from './helpers.js';

test.describe('Play', () => {
  test('course page, hole map and previous plays', async ({ page }) => {
    await boot(page);
    await addCourse(page, 'majlis');
    await expect(page.locator('.chero h1')).toContainText('Majlis');
    await expect(page.locator('body')).toContainText('All 18 holes mapped');
    await startRound(page);
    // hole map with front / centre / back from the tee position
    const dist = page.locator('.hm-dist');
    await expect(dist).toContainText('centre');
    await expect(dist).toContainText(/from where you stand|from the tee/);
    // tap to measure
    await page.click('.holemap canvas', { position: { x: 150, y: 250 } });
    await expect(page.locator('.hm-tap')).toContainText('to the green');
    // next hole
    await page.click('[data-pt="2"]');
    await page.click('[data-h=next]');
    await expect(page.locator('.hnum')).toHaveText('Hole 2');
    // end early, back home: the course card shows the round
    await endEarly(page);
    await page.click('nav button[data-tab=bag]'); await page.click('nav button[data-tab=rounds]');
    await expect(page.locator('.ccard')).toContainText('1 round');
  });

  test('a laser read becomes a shot card with a club, and the hole advances by GPS', async ({ page, context }) => {
    await boot(page);
    await addCourse(page, 'majlis');
    await startRound(page);
    await page.evaluate((b64) => window.__golfNativeEvent({ type: 'laser.packet', b64 }), packet(168, 171));
    const card = page.locator('.laserpop');
    await expect(card).toContainText('168');
    await expect(card).toContainText(/✓ \d? ?\w+/);
    await page.click('.laserpop [data-x=ok]');
    await expect(page.locator('.shotpanel').first()).toContainText('target');
    // walk to the 2nd tee and read again: hole 2, tee shot
    await context.setGeolocation({ latitude: 25.08875, longitude: 55.16228, accuracy: 6 });
    await page.waitForTimeout(1500);
    await page.evaluate((b64) => window.__golfNativeEvent({ type: 'laser.packet', b64 }), packet(340, 340));
    await expect(page.locator('.hnum')).toHaveText('Hole 2');
    await expect(page.locator('.laserpop')).toContainText('shot 1');
    await page.click('.laserpop [data-x=no]');
  });

  test('an unmapped course offers marking and the schematic strip', async ({ page }) => {
    await boot(page);
    await addCourse(page, 'trump');
    await expect(page.locator('body')).toContainText(/No hole map yet|holes marked/);
    await startRound(page);
    await expect(page.locator('.hm-dist')).toContainText('card');
    await page.click('[data-mark]');
    await expect(page.locator('.mk-title')).toContainText('Hole 1 of 18');
    await page.click('.markmap [data-close]');
  });
});

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

test('post a score without hole data, see its summary, and find it in the rounds list', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await page.click('nav button[data-tab=rounds]');
  await page.click('[data-act=post]');
  await expect(page.locator('#psScore')).toBeVisible();
  await page.fill('#psScore', '84');
  await page.fill('#psPutts', '33');
  await page.click('[data-x=save]');
  // back on the list, then its quick summary
  await expect(page.locator('.hist').first()).toContainText('84');
  await expect(page.locator('.hist').first()).toContainText('score only');
  await page.locator('.hist').first().click();
  await expect(page.locator('.kpis')).toContainText('84');
  await expect(page.locator('[data-x=edit]')).toBeVisible();
});

test('shot Details (as planned, stars, lie) and the first putt from the flag are saved with the hole', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await page.click('[data-res="0"][data-v="FW"]');
  await page.fill('[data-sd="1"]', '150'); await page.press('[data-sd="1"]', 'Enter');
  await page.click('[data-int="1"][data-v="D"]');
  await page.click('[data-det="1"]');
  const sheet = page.locator('.sheet').last();
  await sheet.locator('[data-k="flight"][data-v="STR"]').click();
  await expect(sheet.locator('[data-plan="false"]')).toHaveClass(/auto/); // draw planned, straight hit → suggested "No"
  await sheet.locator('[data-plan="false"]').click();
  await sheet.locator('[data-sat="2"]').click();
  await sheet.locator('[data-lie2="blw"]').click();
  await sheet.locator('[data-ok]').click();
  await expect(page.locator('.detline').first()).toContainText('not the shot ✗');
  await expect(page.locator('.detline').first()).toContainText('★★');
  await expect(page.locator('.detline').first()).toContainText('Ball below feet');
  await page.click('[data-res="1"][data-v="G"]');
  await page.click('[data-pt="2"]'); await page.click('[data-fp="20"]');
  await page.click('[data-fpl="S"][data-fps="R"]');
  await expect(page.locator('[data-fpl="S"][data-fps="R"]')).toHaveClass(/on/);
  // leave and come back: it all survives
  await page.click('[data-h=next]'); await page.click('[data-h=prev]');
  await expect(page.locator('[data-fpl="S"][data-fps="R"]')).toHaveClass(/on/);
  await expect(page.locator('.detline').first()).toContainText('Ball below feet');
});

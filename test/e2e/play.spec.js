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
    // next hole: ball on the green with shot 2, two putts
    await page.click('[data-res="1"][data-v="G"]');
    await page.click('[data-pmiss="0"]'); await page.click('[data-pholed="1"]');
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

test('a hole: Driver pre-picked, lie carried over, slope, Details, then the green panel; it all survives', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  // par 4 tee shot: the Driver is already picked
  await expect(page.locator('.shotpanel.z-tee [data-club].on')).toHaveText(/Driver/i);
  await page.click('[data-res="0"][data-v="RR"]');
  // shot 2: the lie comes from the tee shot (rough), ball below the feet, distance, details
  await expect(page.locator('.shotpanel.z-fairway [data-lie][data-v="rgh"]')).toHaveClass(/auto/);
  await page.click('[data-slope="1"][data-feet="blw"][data-hill=""]');
  await page.fill('[data-sd="1"]', '150'); await page.press('[data-sd="1"]', 'Enter');
  await page.click('[data-det="1"]');
  const sheet = page.locator('.sheet').last();
  await sheet.locator('[data-k="flight"][data-v="PL"]').click();
  await sheet.locator('[data-plan="false"]').click();
  await sheet.locator('[data-sat="2"]').click();
  await sheet.locator('[data-k="cause"][data-v="SWE"]').click();
  await sheet.locator('[data-cost="1"]').click();
  await sheet.locator('[data-ok]').click();
  await expect(page.locator('.detline').first()).toContainText('not the shot ✗');
  await expect(page.locator('.detline').first()).toContainText('★★');
  await expect(page.locator('.detline').first()).toContainText('cost +1');
  // on the green: one panel with the putt length and putts
  await page.click('[data-res="1"][data-v="G"]');
  await expect(page.locator('#greenPanel')).toBeVisible();
  await page.click('[data-pft="0"][data-v="18"]');
  await page.click('[data-pread="0"][data-sl="up"][data-brk="RL"]');
  await expect(page.locator('.holedone')).toHaveCount(0); // not holed yet: no score
  await page.click('[data-pmiss="0"]');
  await page.click('[data-pft="1"][data-v="4"]'); await page.click('[data-pholed="1"]');
  await expect(page.locator('.holedone')).toContainText('4');
  await expect(page.locator('.holedone')).toContainText('Par');
  await expect(page.locator('.holedone')).toContainText('2 putts');
  // leave and come back: it all survives
  await page.click('[data-h=next]'); await page.click('[data-h=prev]');
  await expect(page.locator('[data-pexp="0"]')).toContainText('16–20 ft · uphill, breaks left · missed');
  await page.click('[data-pexp="0"]');
  await expect(page.locator('[data-pft="0"][data-v="18"]')).toHaveClass(/on/);
  await expect(page.locator('[data-pread="0"][data-sl="up"][data-brk="RL"]')).toHaveClass(/on/);
  await expect(page.locator('[data-pholed="1"]')).toHaveClass(/on/);
  await page.click('[data-expand="1"]');
  await expect(page.locator('[data-slope="1"][data-feet="blw"][data-hill=""]')).toHaveClass(/on/);
  await expect(page.locator('[data-lie="1"][data-v="rgh"]')).toHaveClass(/on/);
});

test('Submit lists holes missing details; Save keeps the round to finish later', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  // hole 1 complete, hole 2 with no putt length
  await page.click('[data-res="0"][data-v="FW"]');
  await page.fill('[data-sd="1"]', '140'); await page.press('[data-sd="1"]', 'Enter');
  await page.click('[data-res="1"][data-v="G"]'); await page.click('[data-pft="0"][data-v="12"]'); await page.click('[data-pmiss="0"]'); await page.click('[data-pholed="1"]');
  await page.click('[data-h=next]');
  await page.click('[data-res="0"][data-v="FW"]');
  await page.fill('[data-sd="1"]', '120'); await page.press('[data-sd="1"]', 'Enter');
  await page.click('[data-res="1"][data-v="G"]'); // on the green, putts not entered: assumed 2, flagged
  await page.click('[data-h=endearly]');
  await page.locator('.sheet [data-ok]').click(); // Submit
  const sheet = page.locator('.sheet').last();
  await expect(sheet).toContainText('1 hole is missing details');
  await expect(sheet).toContainText('Hole 2 · putts, putt length');
  await sheet.locator('[data-anyway]').click();
  await page.locator('.sheet [data-skip]').click(); // the end-of-round mood sheet
  await expect(page.locator('.holebar')).toHaveCount(0);
  const r = await page.evaluate(async () => new Promise((res) => { const o = indexedDB.open('golf-app'); o.onsuccess = () => { const q = o.result.transaction('rounds').objectStore('rounds').getAll(); q.onsuccess = () => res(q.result[0]); }; }));
  expect(r.finished).toBe(true); expect(r.submitted).toBe(true);
  expect(r.holes[1].putts).toBe(2); expect(r.holes[1].puttsAuto).toBe(true); expect(r.holes[1].firstPutt).toBeNull();
});

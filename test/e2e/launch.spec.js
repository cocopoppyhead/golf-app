import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

const GARMIN = `Date,Player,Club Name,Club Type,Shot Type,Club Speed,Attack Angle,Ball Speed,Smash Factor,Launch Angle,Backspin,Spin Axis,Apex Height,Carry Distance,Total Distance
2026-11-09 19:02:11,Conor,Driver,Driver,Full,101.2,-1.4,146.5,1.45,11.8,3620,6.5,29.1,212.3,234.0
2026-11-09 19:03:40,Conor,Driver,Driver,Full,99.4,-2.0,134.2,1.35,13.1,3310,10.6,27.0,195.1,215.2
2026-11-09 19:05:02,Conor,Driver,Driver,Full,102.8,0.3,148.9,1.45,12.0,3490,2.0,30.0,220.0,241.0
2026-11-09 19:10:02,Conor,7 Iron,Iron,Full,82.0,-4.1,109.6,1.34,17.8,6450,1.3,27.5,150.2,158.0`;

test('a Garmin CSV imports club by club into the launch-monitor card, with the take and drills', async ({ page }) => {
  await boot(page);
  await page.click('nav button[data-tab=bag]');
  const card = page.locator('#launchCard');
  await expect(card).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), card.locator('[data-import-file]').click()]);
  await chooser.setFiles({ name: 'Garmin_R10_Session.csv', mimeType: 'text/csv', buffer: Buffer.from(GARMIN) });
  // the driver (most shots) comes first; drop one row, keep the rest
  const sheet = page.locator('.lmsheet');
  await expect(sheet.locator('.sheet-h b')).toHaveText(/Driver/);
  await expect(sheet.locator('[data-row]')).toHaveCount(3);
  await sheet.locator('[data-row="1"]').click();
  await expect(sheet.locator('[data-save]')).toHaveText(/Save 2 shots/);
  await sheet.locator('[data-save]').click();
  // then the 7 iron
  await expect(page.locator('.lmsheet .sheet-h b')).toHaveText(/7 iron/);
  await page.locator('.lmsheet [data-save]').click();
  await expect(page.locator('.lmsheet')).toHaveCount(0);
  // the card lists both clubs with speeds, and the driver's take names strike drills
  await expect(card.locator('tr[data-open="Driver"]')).toContainText('102');
  await expect(card.locator('tr[data-open="7 iron"]')).toContainText('82');
  await expect(card.locator('.take').first()).toContainText(/Smash|Launch/);
  await expect(card.locator('.dcard').first()).toBeVisible();
  // the club page carries the model carry and the takes
  await card.locator('tr[data-open="Driver"]').click();
  await expect(page.locator('.lmtile').filter({ hasText: 'Carry' })).toHaveCount(1);
});

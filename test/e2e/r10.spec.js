// The live R10 screen against a fake R10 behind Web Bluetooth: the fake replays the device side of the
// handshake (registration, device info, capabilities, subscribe, wake) and a shot captured from a real
// R10 (10over's golden fixture), and the screen must show the shot and save it to the launch data.
import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';
import { buildFrame, buildAck, wrap, chunk, pbRequest } from '../../src/r10/protocol.js';

const SHOT_FULL = [
  0xf2, 0x01, 0x53, 0x1a, 0x51, 0x08, 0x08, 0xca, 0x3e, 0x4c, 0x12, 0x4a, 0x08, 0x2a, 0x10, 0x01,
  0x1a, 0x1d, 0x0d, 0x00, 0x00, 0x48, 0x41, 0x15, 0x9a, 0x99, 0x99, 0xbf, 0x1d, 0x00, 0x00, 0x86,
  0x42, 0x25, 0x00, 0x00, 0xa0, 0x40, 0x2d, 0x00, 0x00, 0x2f, 0x45, 0x30, 0x00, 0x38, 0x01, 0x22,
  0x14, 0x0d, 0x00, 0x00, 0x30, 0x42, 0x15, 0x00, 0x00, 0xc0, 0x3f, 0x1d, 0x00, 0x00, 0x00, 0xc0,
  0x25, 0x00, 0x00, 0x60, 0xc0, 0x2a, 0x0f, 0x08, 0xe8, 0x07, 0x10, 0xdc, 0x0b, 0x18, 0x88, 0x0e,
  0x20, 0x98, 0x11, 0x28, 0xc4, 0x13];
const SUBSCRIBE_OK = [0xf2, 0x01, 0x0a, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x00, 0x12, 0x02, 0x08, 0x08];
const READY = [0xf2, 0x01, 0x0b, 0x1a, 0x09, 0x08, 0x08, 0xca, 0x3e, 0x04, 0x0a, 0x02, 0x08, 0x02];
const WOKEN = [0xb2, 0x02, 0x04, 0x22, 0x02, 0x08, 0x00];

const pb = (type, envelope) => buildFrame(type, [...pbRequest(0, Uint8Array.from(envelope)).slice(4, -2)]);
const out = (frame) => chunk(wrap(frame), 1).map((c) => [...c]);
const info = () => { const p = [150, 0, 0x26, 0x0e, 1, 2, 3, 4, 10, 0, 0xff, 0xff]; for (const t of ['R10', 'Approach R10', 'R10']) p.push(t.length, ...new TextEncoder().encode(t)); return buildFrame(5024, p); };

const SCRIPT = {
  register: [0x00, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00],
  info: out(info()),
  // after the host's Nth complete frame, the device sends these
  after: { 1: out(buildFrame(5050, [2, 0xff, 0xff])), 3: out(buildAck(5050, 0, [])), 4: out(pb(5044, SUBSCRIBE_OK)), 6: [...out(pb(5044, WOKEN)), ...out(pb(5043, READY))] },
  shot: out(pb(5043, SHOT_FULL)),
};

test('the R10 connects over Bluetooth, shows a shot as it lands and saves it', async ({ page }) => {
  await page.addInitScript((S) => {
    const listeners = []; let zeros = 0, frames = 0;
    const notify = (bytes) => setTimeout(() => { const v = new DataView(Uint8Array.from(bytes).buffer); listeners.forEach((f) => f({ target: { value: v } })); }, 5);
    const send = (list) => list.forEach((c, i) => setTimeout(() => notify(c), 10 * i));
    const rw = {
      properties: { write: true, notify: true },
      addEventListener: (t, f) => listeners.push(f),
      startNotifications: async () => {},
      writeValueWithResponse: async () => { notify(S.register); setTimeout(() => send(S.info), 30); },
    };
    const wr = {
      properties: { write: true },
      writeValueWithResponse: async (b) => {
        for (const x of new Uint8Array(b.buffer || b).subarray(1)) if (x === 0) zeros++;
        while (Math.floor(zeros / 2) > frames) { frames++; if (S.after[frames]) setTimeout(() => send(S.after[frames]), 20); }
      },
    };
    const device = { name: 'Approach R10', addEventListener: () => {}, gatt: { connect: async () => device.gatt, disconnect: () => {}, getPrimaryService: async () => ({ getCharacteristic: async (u) => (u.startsWith('6a4e2810') ? rw : wr) }) } };
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
    window.__r10shot = () => send(S.shot);
  }, SCRIPT);
  await boot(page);
  await page.click('nav button[data-tab=settings]');
  await page.locator('#r10Row [data-open]').click();
  const sheet = page.locator('.r10sheet');
  await sheet.locator('[data-club]').first().click();
  await sheet.locator('[data-connect]').click();
  await expect(sheet).toContainText('Ready. Swing away.', { timeout: 10000 });
  await page.evaluate(() => window.__r10shot());
  // 67 m/s ball speed is 149.9 mph; carry is osolo's own estimate
  await expect(sheet.locator('.r10last')).toContainText('149.9');
  await expect(sheet.locator('.r10last')).toContainText('carry ≈');
  await expect(sheet.locator('.r10tab tbody tr')).toHaveCount(1);
  // a resent alert is not a second shot
  await page.evaluate(() => window.__r10shot());
  await page.waitForTimeout(400);
  await expect(sheet.locator('.r10tab tbody tr')).toHaveCount(1);
  // saved: the launch data has it, marked as the R10's
  const saved = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('golf-app'); r.onsuccess = () => { const q = r.result.transaction('launch').objectStore('launch').getAll(); q.onsuccess = () => res(q.result); }; }));
  expect(saved.length).toBe(1);
  expect(saved[0].source).toBe('Garmin R10');
  expect(saved[0].rows[0].ballSpeed).toBeCloseTo(149.9, 1);
  await page.screenshot({ path: 'test/e2e/out/r10-live.png' });
});

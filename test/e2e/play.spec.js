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
    await page.click('[data-h=fwd]');
    await expect(page.locator('.rb-h')).toHaveText('2');
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
    await expect(page.locator('.rb-h')).toHaveText('2');
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
  await page.click('[data-h=fwd]'); await page.click('[data-h=prev]');
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
  await page.click('[data-h=fwd]');
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

test('the hole ribbon: hole, par and first-time note; the strip and the full card jump to a hole', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  const rb = page.locator('.ribbon');
  await expect(rb.locator('.rb-h')).toHaveText('1');
  await expect(rb.locator('.rb-tp')).toContainText('NOT STARTED');
  await expect(rb.locator('[data-hist]')).toContainText('FIRST TIME HERE');
  await expect(rb.locator('.rb-c')).toHaveCount(9);
  await page.screenshot({ path: 'test/e2e/out/hole-ribbon.png' });
  await rb.locator('.rb-c[data-go="3"]').click();
  await expect(page.locator('.rb-h')).toHaveText('4');
  await page.locator('.ribbon .rb-1').click();
  const card = page.locator('.cardsheet');
  await expect(card.locator('.cd-grid')).toHaveCount(2);
  await page.screenshot({ path: 'test/e2e/out/hole-card.png' });
  await card.locator('.cd-hd[data-go="11"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.rb-h')).toHaveText('12');
  await expect(page.locator('.rb-hd').last()).toHaveText('IN');
});

test('a drive in the fairway: shot 2 is a fairway shot with the fairway lie, even with a short distance typed', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await page.click('[data-res="0"][data-v="FW"]');
  const p2 = page.locator('.shotpanel.z-fairway');
  await expect(p2.locator('[data-lie][data-v="fw"]')).toHaveClass(/auto/);
  await page.fill('[data-sd="1"]', '10'); await page.press('[data-sd="1"]', 'Enter');
  await expect(page.locator('.shotpanel.z-fairway')).toContainText('To the pin (optional)');
  await expect(page.locator('.shotpanel.z-greenside')).toHaveCount(0);
});

test('Next asks for the score: on the green in 2 starts at 4 with 2 putts; n/a shows a hyphen on the card', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await page.click('[data-res="0"][data-v="FW"]');
  await page.click('.shotpanel.z-fairway [data-res="1"][data-v="G"]');
  await page.locator('button[data-h="next"].big').click();
  const sheet = page.locator('.scorecheck');
  await expect(sheet).toContainText('Hole 1 · par 4');
  await expect(sheet.locator('.sc-step')).toContainText('4');
  await expect(sheet.locator('.sc-step')).toContainText('2 putts');
  await sheet.locator('[data-d="1"]').click();
  await expect(sheet.locator('.sc-step')).toContainText('3 putts');
  await page.screenshot({ path: 'test/e2e/out/score-check.png' });
  await sheet.locator('[data-ok]').click();
  await expect(page.locator('.rb-h')).toHaveText('2');
  await expect(page.locator('.rb-c[data-go="0"] .mk.bog')).toHaveText('5');
  // hole 2: no score
  await page.locator('button[data-h="next"].big').click();
  await page.locator('.scorecheck [data-na]').click();
  await expect(page.locator('.rb-h')).toHaveText('3');
  await expect(page.locator('.rb-c[data-go="1"] .rb-na')).toHaveText('–');
  await expect(page.locator('.rb-tp')).toContainText('THRU 2');
});

test('move the tee: distances and the tee shot are measured from your tee, and it says so', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1, accuracy: 8 }); // away from the course: distances come from the tee
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  const dist = page.locator('.hm-dist');
  await expect(dist).toContainText('from the');
  await page.locator('#holeMap').screenshot({ path: 'test/e2e/out/tee-before.png' });
  await page.waitForTimeout(800);
  const before = await dist.locator('b.c').innerText();
  await page.locator('[data-tee-move]').click();
  await expect(page.locator('.hm-tap')).toContainText('teeing off');
  const box = await page.locator('#holeMap canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
  await expect(page.locator('.hm-dist')).toContainText('from your tee today');
  await expect(page.locator('[data-tee-reset]')).toBeVisible();
  const after = await page.locator('.hm-dist b.c').innerText();
  expect(after).not.toBe(before);
  await page.waitForTimeout(800); await page.locator('#holeMap').screenshot({ path: 'test/e2e/out/tee-after.png' });
  await page.locator('[data-tee-reset]').click();
  await expect(page.locator('.hm-dist')).not.toContainText('your tee');
  await expect(page.locator('.hm-dist b.c')).toHaveText(before);
});

test('standing near the course (GPS on, not on the hole line ahead): a moved tee still sets the distances', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await page.waitForTimeout(800);
  const before = await page.locator('.hm-dist b.c').innerText();
  await page.locator('[data-tee-move]').click();
  const box = await page.locator('#holeMap canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect(page.locator('.hm-dist')).toContainText('from your tee today');
  expect(await page.locator('.hm-dist b.c').innerText()).not.toBe(before);
});

test('the top arrows browse holes without asking for a score', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  for (const n of ['2', '3', '4']) { await page.click('[data-h=fwd]'); await expect(page.locator('.rb-h')).toHaveText(n); }
  await expect(page.locator('.scorecheck')).toHaveCount(0);
  await page.click('[data-h=prev]'); await expect(page.locator('.rb-h')).toHaveText('3');
});

test('map tiles that fail once are fetched again (no dark map until reload)', async ({ page }) => {
  const seen = new Set(); let retried = 0;
  await page.route(/arcgisonline|World_Imagery/, (r) => {
    const u = r.request().url();
    if (!seen.has(u)) { seen.add(u); return r.abort(); } // every tile fails the first time
    retried++; return r.continue();
  });
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await expect.poll(() => retried, { timeout: 10000 }).toBeGreaterThan(3);
});

test('after tapping the map to measure, Move tee is still there', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1, accuracy: 8 });
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  const box = await page.locator('#holeMap canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await expect(page.locator('.hm-tap')).toContainText('Tap:');
  await expect(page.locator('[data-tee-move]')).toBeVisible();
});

test('greenside bunker: the sand wedge is picked; a confirmed score can be changed', async ({ page }) => {
  await boot(page);
  await addCourse(page, 'Majlis');
  await startRound(page);
  await page.click('[data-res="0"][data-v="FW"]');
  await page.click('.shotpanel.z-fairway [data-res="1"][data-v="BK"]');
  await page.click('[data-add]');
  const p3 = page.locator('.shotpanel.z-greenside');
  await expect(p3.locator('[data-club].on')).toHaveText('56°');
  await p3.locator('[data-res="2"][data-v="G"]').click();
  await page.locator('button[data-h="next"].big').click();
  await page.locator('.scorecheck [data-ok]').click(); // 3 shots + 2 putts = 5
  await page.click('[data-h=prev]');
  await expect(page.locator('.holedone')).toContainText('5');
  await page.locator('[data-score-edit]').click();
  await expect(page.locator('.scorecheck')).toContainText('change your score');
  await page.locator('.scorecheck [data-d="-1"]').click();
  await page.locator('.scorecheck [data-ok]').click();
  await expect(page.locator('.holedone')).toContainText('4');
  await expect(page.locator('.holedone')).toContainText('1 putt');
});

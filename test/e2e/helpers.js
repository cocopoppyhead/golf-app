// Shared setup: stub the weather API, skip the install nudge, seed a bag, start a round on a course.
export const WEATHER = { current: { temperature_2m: 31, relative_humidity_2m: 40, surface_pressure: 1010, wind_speed_10m: 9, wind_direction_10m: 300, wind_gusts_10m: 12 } };
export const BAG = [{ club: 'Driver', carry: 255 }, { club: '3 wood', carry: 230 }, { club: '4 hybrid', carry: 205 }, { club: '6 iron', carry: 175 }, { club: '8 iron', carry: 150 }, { club: 'PW', carry: 125 }, { club: '56°', carry: 85 }];

export async function boot(page, { bag = BAG } = {}) {
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: WEATHER }));
  await page.goto('./');
  await page.evaluate((bag) => {
    localStorage.setItem('golf.installDismissed', '1');
    const s = JSON.parse(localStorage.getItem('golf.settings') || '{}'); s.bag = bag; s.onboarded = true; localStorage.setItem('golf.settings', JSON.stringify(s));
  }, bag);
  await page.reload();
  await page.waitForSelector('nav button[data-tab=rounds]');
}

/** Pick a library course (first result for `query`), second tee, and land on its course page. */
export async function addCourse(page, query) {
  await page.click('nav button[data-tab=rounds]');
  await page.click('[data-act=library]');
  await page.fill('#libQ', query);
  await page.click('.libitem');
  await page.click('.tee >> nth=1');
  await page.waitForSelector('.chero');
}

/** From the course page: start a round, through the partners and mood sheets, to hole 1. */
export async function startRound(page) {
  await page.click('[data-x=start]');
  // tee picker (if several), partners, mood: each is a sheet with a primary [data-ok]
  for (let i = 0; i < 4; i++) {
    const sheet = page.locator('.sheet').last();
    const shown = await sheet.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
    if (!shown) break;
    if (await sheet.locator('.tee').count()) await sheet.locator('.tee').first().click();
    else if (await sheet.locator('.moodscale').count()) { await sheet.locator('[data-m="5"]').click(); await sheet.locator('[data-ok]').click(); }
    else await sheet.locator('[data-ok]').click();
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('.holebar');
}

/** A Bushnell packet as the native shell would deliver it: 5 little-endian floats, base64. */
export function packet(raw, playsAs = raw, heading = 90) {
  const b = Buffer.alloc(20); b.writeFloatLE(raw, 0); b.writeFloatLE(2, 4); b.writeFloatLE(heading, 8); b.writeFloatLE(playsAs, 12); b.writeFloatLE(1, 16);
  return b.toString('base64');
}

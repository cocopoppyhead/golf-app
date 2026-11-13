import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

// The mental coach: opened from Pre-round check-in, it sends your routine and rounds with the question.
test('the mental coach answers with your routine and rounds in its context', async ({ page }) => {
  let sent = null;
  await page.route('https://api.anthropic.com/**', async (r) => { sent = JSON.parse(r.request().postData()); const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    await r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: [{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Breathe out longer ' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'than you breathe in on the first tee.' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '\n```json\n{"note":"First chat: nerves on the 1st tee","works":["a long exhale"],"next":"long exhale on the first tee"}\n```' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }].map(ev).join('') }); });
  await boot(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('golf.settings')); s.apiKey = 'sk-ant-test'; s.aiProvider = 'claude'; s.routine = { swingThought: 'left heel' }; localStorage.setItem('golf.settings', JSON.stringify(s)); });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await page.click('.checkin [data-act=mind]');
  const chat = page.locator('.mindchat');
  await chat.locator('[data-start]').first().click();
  await expect(chat.locator('.mc-m.assistant')).toContainText('Breathe out longer');
  await expect(chat.locator('.mc-m.assistant')).not.toContainText('json');
  await chat.locator('.mc-picture summary').click();
  await expect(chat.locator('.mc-picture')).toContainText('long exhale on the first tee');
  expect(sent.system).toContain('LEARNING MODE');
  expect(sent.system).toContain('HOW TO TELL WHICH IT IS');
  expect(sent.system).toContain('THEIR ROUTINE');
  expect(sent.system).toContain('left heel');
  expect(sent.stream).toBe(true);
  expect(sent.messages.at(-1)).toEqual({ role: 'user', content: 'Get my head right before today' });
  // kept on the phone: reopening shows the conversation
  await chat.locator('[data-close]').click();
  await page.click('.checkin [data-act=mind]');
  await expect(page.locator('.mindchat .mc-m')).toHaveCount(2);
  // Return is a new line, not send: the Send button sends
  const ta = page.locator('.mindchat textarea');
  await ta.click(); await page.keyboard.type('First line'); await page.keyboard.press('Enter'); await page.keyboard.type('Second line');
  await expect(ta).toHaveValue('First line\nSecond line');
  await expect(page.locator('.mindchat .mc-m')).toHaveCount(2);
  await page.locator('.mindchat .mc-form button').click();
  await expect(page.locator('.mindchat .mc-m.user').last()).toContainText('Second line');
  await expect.poll(() => sent.messages.at(-1).content).toBe('First line\nSecond line');
});

// The app checks a reply before it stands: one that breaks a hard rule goes back once, and you see the rewrite.
test('a reply that breaks the rules is rewritten before you see it', async ({ page }) => {
  const sent = [];
  const replies = ['What club was it? And where did it finish?', 'Walk me through the 3rd: what club did you hit?'];
  await page.route('https://api.anthropic.com/**', async (r) => { sent.push(JSON.parse(r.request().postData())); const text = replies[Math.min(sent.length - 1, 1)]; const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    await r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: [{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }].map(ev).join('') }); });
  await boot(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('golf.settings')); s.apiKey = 'sk-ant-test'; s.aiProvider = 'claude'; localStorage.setItem('golf.settings', JSON.stringify(s)); localStorage.removeItem('golf.mindChat'); });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await page.click('.checkin [data-act=mind]');
  const chat = page.locator('.mindchat');
  await chat.locator('[data-start]').nth(1).click();
  await expect(chat.locator('.mc-m.assistant')).toHaveText('Walk me through the 3rd: what club did you hit?');
  expect(sent.length).toBe(2);
  expect(sent[1].messages.at(-1).content).toMatch(/2 questions/);
});

// When the golfer agrees a focus, the coach puts it on Range work with its drills.
test('an agreed focus goes onto Range work', async ({ page }) => {
  const text = 'Good, wedges it is. Ladder them on the range this week.\n```json\n{"note":"Agreed wedges focus","plan":{"title":"Wedge distance","text":"Control 3/4 wedges","why":"0% greens with 3/4 wedges","drills":[{"name":"Wedge ladder","how":"50/75/100% to one target","reps":"3 x 10"}]}}\n```';
  await page.route('https://api.anthropic.com/**', async (r) => { const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    await r.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: [{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }].map(ev).join('') }); });
  await boot(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('golf.settings')); s.apiKey = 'sk-ant-test'; s.aiProvider = 'claude'; localStorage.setItem('golf.settings', JSON.stringify(s)); localStorage.removeItem('golf.mindChat'); });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await page.click('.checkin [data-act=mind]');
  const chat = page.locator('.mindchat');
  await chat.locator('textarea').fill('Yes, let\'s focus on the wedges');
  await chat.locator('.mc-form button').click();
  await expect(chat.locator('.mc-added')).toContainText('Wedge distance');
  const work = await page.evaluate(() => JSON.parse(localStorage.getItem('golf.settings')).workingOn);
  expect(work[0]).toMatchObject({ title: 'Wedge distance', from: 'coach' });
  expect(work[0].drills[0].name).toBe('Wedge ladder');
});

// Share chat: the conversation comes out as a Markdown file (a download in a desktop browser).
test('the chat can be shared as a file', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('golf.settings')); s.apiKey = 'sk-ant-test'; s.aiProvider = 'claude'; localStorage.setItem('golf.settings', JSON.stringify(s)); localStorage.setItem('golf.mindChat', JSON.stringify([{ role: 'user', text: 'How was my putting?', at: 1 }, { role: 'assistant', text: 'Solid inside 6 feet.', at: 2 }])); });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await page.click('.checkin [data-act=mind]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.mindchat [data-share]').click()]);
  expect(dl.suggestedFilename()).toMatch(/^osolo-coach-chat-\d{4}-\d{2}-\d{2}\.md$/);
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toMatch(/How was my putting\?/); expect(text).toMatch(/Solid inside 6 feet\./);
});

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
  expect(sent.system).toContain('WHICH HAT LEADS');
  expect(sent.system).toContain('THEIR ROUTINE');
  expect(sent.system).toContain('left heel');
  expect(sent.stream).toBe(true);
  expect(sent.messages.at(-1)).toEqual({ role: 'user', content: 'Get my head right before today' });
  // kept on the phone: reopening shows the conversation
  await chat.locator('[data-close]').click();
  await page.click('.checkin [data-act=mind]');
  await expect(page.locator('.mindchat .mc-m')).toHaveCount(2);
});

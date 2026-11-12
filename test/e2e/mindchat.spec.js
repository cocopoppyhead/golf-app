import { test, expect } from '@playwright/test';
import { boot } from './helpers.js';

// The mental coach: opened from Pre-round check-in, it sends your routine and rounds with the question.
test('the mental coach answers with your routine and rounds in its context', async ({ page }) => {
  let sent = null;
  await page.route('https://api.anthropic.com/**', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ json: { content: [{ type: 'text', text: 'Breathe out longer than you breathe in on the first tee.' }] } }); });
  await boot(page);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('golf.settings')); s.apiKey = 'sk-ant-test'; s.aiProvider = 'claude'; s.routine = { swingThought: 'left heel' }; localStorage.setItem('golf.settings', JSON.stringify(s)); });
  await page.reload();
  await page.click('nav button[data-tab=rounds]');
  await page.click('.checkin [data-act=mind]');
  const chat = page.locator('.mindchat');
  await chat.locator('[data-start]').first().click();
  await expect(chat.locator('.mc-m.assistant')).toContainText('Breathe out longer');
  expect(sent.system).toContain('THEIR ROUTINE');
  expect(sent.system).toContain('left heel');
  expect(sent.messages.at(-1)).toEqual({ role: 'user', content: 'Get my head right before today' });
  // kept on the phone: reopening shows the conversation
  await chat.locator('[data-close]').click();
  await page.click('.checkin [data-act=mind]');
  await expect(page.locator('.mindchat .mc-m')).toHaveCount(2);
});

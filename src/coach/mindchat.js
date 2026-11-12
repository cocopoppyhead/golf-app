// The mental coach, as a full-screen conversation. Opened from Play (Pre-round check-in) and from a
// round's summary (to talk that round through). Uses whichever AI you connected in Settings.
import { getSettings, listRounds, getCourse } from '../store.js';
import { aiFrom, aiReady, aiName, chatLLM, md } from './ai.js';
import { SYSTEM, mindContext, loadChat, saveChat, clearChat } from './mind.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STARTERS = ['Get my head right before today', 'Talk me through my last round', 'Why do my rounds unravel?', 'First-tee nerves'];

/** focus: { r, c } to talk one round through. onSettings: go to Settings → Connect AI. */
export async function openMindChat({ focus = null, onSettings = () => {} } = {}) {
  const s = getSettings();
  let msgs = loadChat(), busy = false, err = '';
  const sheet = document.createElement('div'); sheet.className = 'sheet mindchat';
  const ready = aiReady(s);
  const starters = focus ? [`Talk me through ${focus.r.courseName.split(/\s[–-]\s/)[0]}`, 'What should I take from it?', 'Where did my head go?'] : STARTERS;
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in mc-in">
      <div class="sheet-h"><b>Mental coach</b><span class="mc-hact">${msgs.length ? '<button class="link" data-new>New chat</button>' : ''}<button class="link" data-close>Close</button></span></div>
      <div class="mc-log" aria-live="polite">
        ${msgs.length ? '' : `<p class="mc-intro">${ready ? `Knows your last rounds: how you felt, your process, your debriefs. ${focus ? `Ready to talk about ${esc(focus.r.courseName)}.` : 'Ask anything about the mental side.'}` : `Your coach runs on your own AI. Connect Claude, ChatGPT or Gemini first.`}</p>`}
        ${msgs.map((m) => `<div class="mc-m ${m.role}">${m.role === 'assistant' ? md(m.text) : esc(m.text)}</div>`).join('')}
        ${busy ? '<div class="mc-m assistant mc-typing"><i></i><i></i><i></i></div>' : ''}
        ${err ? `<p class="mc-err">${esc(err)}</p>` : ''}
      </div>
      ${ready ? `${msgs.length ? '' : `<div class="mc-starters">${starters.map((t) => `<button data-start="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="mc-form"><textarea name="q" rows="1" placeholder="Talk to your coach" ${busy ? 'disabled' : ''}></textarea><button class="btn primary" ${busy ? 'disabled' : ''}>Send</button></form>
      <p class="mc-foot mute small">Uses ${esc(aiName(s))}. The chat stays on this phone.</p>` : '<button class="btn primary big" data-settings>Connect AI in Settings</button>'}
    </div>`;
    const log = sheet.querySelector('.mc-log'); log.scrollTop = log.scrollHeight;
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-new]')?.addEventListener('click', () => { msgs = []; clearChat(); err = ''; draw(); });
    sheet.querySelector('[data-settings]')?.addEventListener('click', () => { sheet.remove(); onSettings(); });
    sheet.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => send(b.dataset.start));
    const f = sheet.querySelector('.mc-form');
    if (f) {
      const ta = f.q;
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
      f.onsubmit = (e) => { e.preventDefault(); const q = ta.value.trim(); if (q) send(q); };
    }
  };
  const context = async () => {
    const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished).sort((a, b) => b.date - a.date).slice(0, 12);
    const pairs = []; for (const r of rounds) pairs.push({ r, c: await getCourse(r.courseId).catch(() => null) });
    return mindContext({ rounds: pairs, settings: s, focus });
  };
  const send = async (q) => {
    if (busy) return;
    msgs = [...msgs, { role: 'user', text: q, at: Date.now() }]; busy = true; err = ''; draw();
    try {
      const text = await chatLLM({ ...aiFrom(s), system: `${SYSTEM}\n\n${await context()}`, messages: msgs.slice(-20).map(({ role, text }) => ({ role, text })) });
      msgs = [...msgs, { role: 'assistant', text: text.trim() || '…', at: Date.now() }]; saveChat(msgs);
    } catch (e) { err = `${e.message || 'That didn\'t go through.'} Try again.`; msgs = msgs.slice(0, -1); }
    busy = false; draw();
    if (err) { const ta = sheet.querySelector('textarea'); if (ta) ta.value = q; }
  };
  draw();
  document.body.appendChild(sheet);
}

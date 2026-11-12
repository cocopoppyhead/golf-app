// The coach, as a full-screen conversation. Opened from Play (Pre-round check-in) and from a
// round's summary (to talk that round through). Uses whichever AI you connected in Settings.
import { getSettings, listRounds, getCourse } from '../store.js';
import { aiFrom, aiReady, aiName, chatLLM, md } from './ai.js';
import { mindContext, loadChat, saveChat, clearChat } from './mind.js';
import { systemPrompt } from './playbook.js';
import { counts } from '../rounds/quality.js';
import { getPicture, pictureText, splitLearning, learn, clearPicture } from './picture.js';
import { gameText } from './game.js';
import { listShots, listSwings } from '../store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Alternate user and coach turns (two of yours in a row after a failed reply are sent as one), starting with yours. */
export function turns(list) {
  const out = [];
  for (const { role, text } of list) { if (out.length && out[out.length - 1].role === role) out[out.length - 1].text += `\n\n${text}`; else out.push({ role, text }); }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
/** What the coach has learned, folded under the chat. */
function pictureHtml(p) {
  const has = p.works.length || p.unravels.length || p.cues.length || p.next || p.notes.length;
  const list = (t, a) => (a.length ? `<div class="mcp-k">${t}</div><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<details class="mc-picture"><summary>What your coach has learned about you${has ? '' : ' <span class="mute">(nothing yet)</span>'}</summary>
    ${has ? `${p.next ? `<div class="mcp-k">Agreed for next round</div><p>${esc(p.next)}</p>` : ''}${list('What works for you', p.works)}${list('What unravels you', p.unravels)}${list('Your cues', p.cues)}
    ${p.notes.length ? `<div class="mcp-k">Notebook</div><ul class="mcp-notes">${p.notes.map((n) => `<li><span class="mute">${new Date(n.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> ${esc(n.note)}</li>`).join('')}</ul>` : ''}
    <button class="link" data-forget>Clear this</button>` : '<p class="mute small">It builds a picture of you as you talk: what works, what unravels you, your own cues. You can clear it any time.</p>'}
  </details>`;
}
const STARTERS = ['Get my head right before today', 'Talk me through my last round', 'Where am I losing strokes?', 'Why am I not a lower handicap?'];

/** focus: { r, c } to talk one round through. onSettings: go to Settings → Connect AI. */
export async function openMindChat({ focus = null, mode = null, onSettings = () => {} } = {}) {
  let M = mode || (focus ? 'debrief' : 'open');
  const s = getSettings();
  let msgs = loadChat().filter((m) => m.text && m.text !== '…'), busy = false, err = '', live = '';
  const sheet = document.createElement('div'); sheet.className = 'sheet mindchat';
  const ready = aiReady(s);
  const starters = focus ? [`Talk me through ${focus.r.courseName.split(/\s[–-]\s/)[0]}`, 'What should I take from it?', 'Where did my head go?'] : STARTERS;
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in mc-in">
      <div class="sheet-h"><b>Your coach</b><span class="mc-hact">${msgs.length ? '<button class="link" data-new>New chat</button>' : ''}<button class="link" data-close>Close</button></span></div>
      <div class="mc-log" aria-live="polite">
        ${msgs.length ? '' : `<p class="mc-intro">${ready ? `Strategy, swing, the mental side and the next round, from your rounds, practice and check-ins. ${focus ? `Ready to talk about ${esc(focus.r.courseName)}.` : 'Ask anything about your game.'}` : `Your coach runs on your own AI. Connect Claude, ChatGPT or Gemini first.`}</p>`}
        ${msgs.map((m) => `<div class="mc-m ${m.role}">${m.role === 'assistant' ? md(m.text) : esc(m.text)}</div>`).join('')}
        ${busy ? (live ? `<div class="mc-m assistant mc-live">${md(live)}</div>` : '<div class="mc-m assistant mc-typing mc-live"><i></i><i></i><i></i></div>') : ''}
        ${err ? `<p class="mc-err">${esc(err)}</p>` : ''}
      </div>
      ${ready ? `${msgs.length ? '' : `<div class="mc-starters">${starters.map((t) => `<button data-start="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="mc-form"><textarea name="q" rows="1" placeholder="Talk to your coach" ${busy ? 'disabled' : ''}></textarea><button class="btn primary" ${busy ? 'disabled' : ''}>Send</button></form>
      <p class="mc-foot mute small">Uses ${esc(aiName(s))}. The chat and what the coach learns stay on this phone.</p>
      ${pictureHtml(getPicture(s))}` : '<button class="btn primary big" data-settings>Connect AI in Settings</button>'}
    </div>`;
    const log = sheet.querySelector('.mc-log'); log.scrollTop = log.scrollHeight;
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-new]')?.addEventListener('click', () => { msgs = []; clearChat(); err = ''; draw(); });
    sheet.querySelector('[data-settings]')?.addEventListener('click', () => { sheet.remove(); onSettings(); });
    sheet.querySelector('[data-forget]')?.addEventListener('click', () => { if (confirm('Clear what the coach has learned about you? Your rounds stay.')) { clearPicture(s); draw(); } });
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
    // only rounds that count (finished, whole, not marked "don't count"): broken or half-logged rounds mislead the coach
    const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished).sort((a, b) => b.date - a.date).slice(0, 80);
    const pairs = [];
    for (const r of rounds) { const c = await getCourse(r.courseId).catch(() => null); if (counts(r, c)) pairs.push({ r, c }); if (pairs.length >= 60) break; }
    const practice = await import('../practice.js').then((m) => m.practiceContext()).catch(() => '');
    const [shots, swings] = await Promise.all([listShots().catch(() => []), listSwings().catch(() => [])]);
    const swing = await import('./profile.js').then((m) => m.coachContext(swings)).catch(() => '');
    const work = await import('../workingon.js').then((m) => m.workContext()).catch(() => '');
    const drills = await import('../drills.js').then((m) => m.drillContext()).catch(() => '');
    const bag = await import('../bag.js').then((m) => m.getBag().map((c) => m.resolveClub(c, shots))).catch(() => []);
    const game = gameText({ rcs: pairs, settings: s, bag, swing, work, drills });
    return mindContext({ rounds: pairs, settings: s, focus, picture: pictureText(getPicture(s)), practice, game });
  };
  const send = async (q) => {
    if (busy) return;
    if (!msgs.length && !focus && q === STARTERS[0]) M = 'pre-round'; // "Get my head right before today"
    msgs = [...msgs, { role: 'user', text: q, at: Date.now() }]; busy = true; err = ''; draw();
    try {
      const onText = (t) => {
        live = t; const el = sheet.querySelector('.mc-live'); if (!el) return;
        el.classList.remove('mc-typing'); el.innerHTML = md(t);
        const log = sheet.querySelector('.mc-log'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
      };
      const { text: full, cut } = await chatLLM({ ...aiFrom(s), system: `${systemPrompt(M)}\n\n${await context()}`, messages: turns(msgs.slice(-20)), onText: (t) => onText(splitLearning(t).text) });
      const { text, meta } = splitLearning(full);
      if (!text.trim()) throw new Error('No reply came back.');
      if (meta) learn(meta, s);
      msgs = [...msgs, { role: 'assistant', text: text.trim() + (cut && !meta ? '\n\n_(Cut short. Say "go on" for the rest.)_' : ''), at: Date.now() }]; saveChat(msgs);
    } catch (e) { err = `${e.message || 'That didn\'t go through.'} Try again.`; msgs = msgs.slice(0, -1); }
    busy = false; live = ''; draw();
    if (err) { const ta = sheet.querySelector('textarea'); if (ta) ta.value = q; }
  };
  draw();
  document.body.appendChild(sheet);
}

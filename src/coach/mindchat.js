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
import { startFlow, stepText, advance, loadFlow, saveFlow, clearFlow } from './flow.js';
import { checkReply, knownNumbers, knownDates, repairPrompt } from './check.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Rounds they've scheduled in the app, with the tee time they entered (the only tee times the coach may use). */
export function upcomingText(list = [], now = Date.now()) {
  const soon = list.filter((e) => e.when && e.when > now - 3 * 3600e3 && e.when < now + 14 * 86400e3).slice(0, 3);
  if (!soon.length) return '';
  const f = (e) => { const d = new Date(e.when); return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} at ${e.courseName || 'a course'}${e.who ? ` with ${e.who}` : ''}${e.note ? ` (${e.note})` : ''}`; };
  return `SCHEDULED IN THE APP (tee times as they entered them): ${soon.map(f).join('; ')}.`;
}

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
  // the conversation's step (debrief and pre-round have a shape; see flow.js): carried on with the chat, fresh with a new one
  let flow = (msgs.length && loadFlow()) || startFlow(M);
  const sheet = document.createElement('div'); sheet.className = 'sheet mindchat';
  const ready = aiReady(s);
  const starters = focus ? [`Talk me through ${focus.r.courseName.split(/\s[–-]\s/)[0]}`, 'What should I take from it?', 'Where did my head go?'] : STARTERS;
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in mc-in">
      <div class="sheet-h"><b>Your coach</b><span class="mc-hact">${msgs.length ? '<button class="link" data-share>Share</button><button class="link" data-new>New chat</button>' : ''}<button class="link" data-close>Close</button></span></div>
      <div class="mc-log" aria-live="polite">
        ${msgs.length ? '' : `<p class="mc-intro">${ready ? `Strategy, swing, the mental side and the next round, from your rounds, practice and check-ins. ${focus ? `Ready to talk about ${esc(focus.r.courseName)}.` : 'Ask anything about your game.'}` : `Your coach runs on your own AI. Connect Claude, ChatGPT or Gemini first.`}</p>`}
        ${msgs.map((m) => `<div class="mc-m ${m.role}">${m.role === 'assistant' ? md(m.text) : esc(m.text)}</div>${m.added ? `<p class="mc-added">Added to Range work: <b>${esc(m.added)}</b>. It's on the Practice tab with its drills.</p>` : ''}`).join('')}
        ${busy ? (live ? `<div class="mc-m assistant mc-live">${md(live)}</div>` : '<div class="mc-m assistant mc-typing mc-live"><i></i><i></i><i></i></div>') : ''}
        ${err ? `<p class="mc-err">${esc(err)}</p>` : ''}
      </div>
      ${ready ? `${msgs.length ? '' : `<div class="mc-starters">${starters.map((t) => `<button data-start="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="mc-form"><textarea name="q" rows="1" enterkeyhint="enter" placeholder="Talk to your coach" ${busy ? 'disabled' : ''}></textarea><button class="btn primary" ${busy ? 'disabled' : ''}>Send</button></form>
      <p class="mc-foot mute small">Uses ${esc(aiName(s))}. The chat stays on this phone (Share sends a copy); what the coach learns about you syncs to your account.</p>
      ${pictureHtml(getPicture(s))}` : '<button class="btn primary big" data-settings>Connect AI in Settings</button>'}
    </div>`;
    const log = sheet.querySelector('.mc-log'); log.scrollTop = log.scrollHeight;
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-share]')?.addEventListener('click', () => import('./sharechat.js').then((m) => m.shareChat(msgs, { picture: getPicture(s), model: aiName(s) })));
    sheet.querySelector('[data-new]')?.addEventListener('click', () => { msgs = []; clearChat(); clearFlow(); flow = startFlow(M); err = ''; draw(); });
    sheet.querySelector('[data-settings]')?.addEventListener('click', () => { sheet.remove(); onSettings(); });
    sheet.querySelector('[data-forget]')?.addEventListener('click', () => { if (confirm('Clear what the coach has learned about you? Your rounds stay.')) { clearPicture(s); draw(); } });
    sheet.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => send(b.dataset.start));
    const f = sheet.querySelector('.mc-form');
    if (f) {
      const ta = f.q;
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; });
      // Return is a new line, like any chat on a phone; the Send button sends (Cmd/Ctrl+Return too, on a keyboard)
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } });
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
    const launch = await import('../launch.js').then((m) => m.launchContext()).catch(() => '');
    const game = gameText({ rcs: pairs, settings: s, bag, swing, work, drills, launch });
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    const next = await import('../rounds/course.js').then((m) => upcomingText(m.events())).catch(() => '');
    return `TODAY: ${today}.${next ? `\n${next}` : ''}\n\n${mindContext({ rounds: pairs, settings: s, focus, picture: pictureText(getPicture(s)), practice, game })}`;
  };
  const send = async (q) => {
    if (busy) return;
    if (!msgs.length) { if (!focus && q === STARTERS[0]) M = 'pre-round'; flow = startFlow(M); } // "Get my head right before today"
    msgs = [...msgs, { role: 'user', text: q, at: Date.now() }]; busy = true; err = ''; draw();
    try {
      const onText = (t) => {
        live = t; const el = sheet.querySelector('.mc-live'); if (!el) return;
        el.classList.remove('mc-typing'); el.innerHTML = md(t);
        const log = sheet.querySelector('.mc-log'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
      };
      const ctx = await context(), system = `${systemPrompt(flow.mode, stepText(flow))}\n\n${ctx}`, convo = turns(msgs.slice(-20));
      let { text: full, cut } = await chatLLM({ ...aiFrom(s), system, messages: convo, maxTokens: 6000, onText: (t) => onText(splitLearning(t).text) });
      // ran out of room mid-reply: carry on by itself rather than make them type "go on"
      for (let k = 0; cut && k < 2; k++) {
        const more = await chatLLM({ ...aiFrom(s), system, messages: [...convo, { role: 'assistant', text: full }, { role: 'user', text: '[osolo, not from the golfer] You were cut off. Continue exactly where you stopped, without repeating anything; end with the json block.' }], maxTokens: 6000, onText: (t) => onText(splitLearning(full + t).text) }).catch(() => null);
        if (!more?.text) break;
        full += more.text; cut = more.cut;
      }
      // the app checks the reply before it stands (check.js); one rewrite if it broke a hard rule
      const userText = msgs.filter((m) => m.role === 'user').map((m) => m.text);
      const known = knownNumbers(ctx, ...userText);
      const pic = getPicture(s);
      const opts = { dates: knownDates(ctx, ...userText), times: ctx, allowLists: /\blists?\b|bullet|point form/i.test([...userText, ...pic.works, ...pic.cues].join(' ')) };
      const problems = checkReply(splitLearning(full).text, known, opts);
      if (problems.length) {
        sheet.querySelector('.mc-live')?.classList.add('mc-fixing');
        const again = await chatLLM({ ...aiFrom(s), system, messages: [...convo, { role: 'assistant', text: full }, { role: 'user', text: repairPrompt(problems) }], maxTokens: 6000, onText: (t) => onText(splitLearning(t).text) }).catch(() => null);
        if (again?.text && checkReply(splitLearning(again.text).text, known, opts).length < problems.length) ({ text: full, cut } = again);
      }
      const { text, meta } = splitLearning(full);
      if (!text.trim()) throw new Error('No reply came back.');
      if (meta) learn(meta, s);
      // they agreed a focus: it goes onto Range work with its drills
      let added = null;
      if (meta?.plan && typeof meta.plan === 'object') added = await import('../workingon.js').then((m) => m.addWork(meta.plan)).catch(() => null);
      flow = advance(flow, meta); saveFlow(flow);
      msgs = [...msgs, { role: 'assistant', text: text.trim() + (cut && !meta ? '\n\n_(Cut short. Say "go on" for the rest.)_' : ''), at: Date.now(), ...(added ? { added: added.title || added.text } : {}) }]; saveChat(msgs);
    } catch (e) { err = `${e.message || 'That didn\'t go through.'} Try again.`; msgs = msgs.slice(0, -1); }
    busy = false; live = ''; draw();
    if (err) { const ta = sheet.querySelector('textarea'); if (ta) ta.value = q; }
  };
  draw();
  document.body.appendChild(sheet);
}

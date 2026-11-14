// The check-ins during a round: mood and energy at the start, the turn and the finish (with the weather
// read at that moment), and the routine card.
import { played } from './stats.js';
import { getConditions } from '../weather.js';
import { getSettings as S0, saveSettings as S1 } from '../store.js';
import { putRound, listRounds } from '../store.js';
import { icon } from '../icons.js';
import { INTENTIONS, intentionLabel, WARMUP, ENERGY, MOOD_WORDS } from './intentions.js';
import { getRoutine, routineHtml } from './routine.js';
import { lastBestHere } from './bestshots.js';
import { esc, fmtD } from './fmt.js';

export function routineSheet(round) {
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Before the shot</b><button class="link" data-x>Close</button></div>${routineHtml(getRoutine(S0()), { swingThought: round.swingThought, expect: round.expect })}</div>`;
  sheet.querySelector('[data-x]').onclick = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}
// end of round: how well the process held up, on a four-step scale (4 = always)
const PROCESS = [['routine', 'Followed my pre-shot routine'], ['commit', 'Committed to every shot'], ['accept', 'Let bad shots go']];
const FREQ = [[4, 'Always'], [3, 'Mostly'], [2, 'Sometimes'], [1, 'Rarely']];
/** The weather at the check-in (start) and at the finish. Offline? The startup backfill fills it in later. */
export function readWeather(round, key) {
  if (key !== 'start' && key !== 'finish') return;
  getConditions({ force: true }).then((w) => { if (!w) return; round.cond = { ...(round.cond || {}), [key]: w }; putRound(round); }).catch(() => {});
}
const moodColor = (n) => `hsl(${n <= 5 ? 200 - (n - 1) * 20 : 120 - (n - 5) * 24}, 75%, 50%)`;
export function moodSheet(round, key, done) {
  round.mood ||= {};
  let v = round.mood[key] ?? null, w = round.warmup ?? null, en = round.energy ?? null, it = round.intention ?? null, kept = round.intentionKept ?? null, kind = round.kind ?? null, kindInfo = false, aim = round.aim ?? null;
  const proc = { ...(round.process || {}) };
  const greens = { ...(round.greens || {}) }; // { firm: soft|normal|firm, speed: slow|medium|fast }
  const R = getRoutine(S0());
  let thought = round.swingThought ?? R.swingThought ?? '', expect = round.expect ?? '';
  let lastAgain = null; // what you said you'd do differently, last time on this course
  let bestHere = []; // your best shots, last time here
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const title = { start: 'Before you tee off', turn: 'At the turn', finish: 'Round done' }[key];
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-in moodsheet">
      <div class="sheet-h"><b>${title}</b><button class="link" data-skip>Skip</button></div>
      ${key === 'start' ? `<div class="lbl">What kind of round? <button class="infob" data-kindinfo aria-label="What's the difference?">i</button></div>
      <div class="seg2">${[['comp', 'Competition'], ['casual', 'Casual']].map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
      <div class="lbl">Today's aim</div>
      <div class="seg3 aimseg">${[['low', 'Shoot low'], ['fun', 'Have fun'], ['both', 'Both']].map(([k, l]) => `<button class="${aim === k ? 'on' : ''}" data-aim="${k}">${l}</button>`).join('')}</div>
      ${kindInfo ? '<div class="infopop"><b>Competition</b> Medal or card in: your real game, under pressure.<br><b>Casual</b> A practice round: trying shots, no pressure. Both count in your stats; Progress can show them apart.</div>' : ''}` : ''}
      <div class="lbl">How do you feel right now?</div>
      <div class="moodscale">${Array.from({ length: 10 }, (_, n) => `<button class="${v === n + 1 ? 'on' : ''}" data-m="${n + 1}" style="--c:${moodColor(n + 1)}">${n + 1}</button>`).join('')}</div>
      <div class="moodlbl">${[['Low', MOOD_WORDS.low, 1], ['Ideal', MOOD_WORDS.mid, 5], ['High', MOOD_WORDS.high, 10]].map(([t, w, n]) => `<span style="color:${moodColor(n)}">${t}${w.split(' · ').map((x) => `<small>${x[0].toUpperCase() + x.slice(1)}</small>`).join('')}</span>`).join('')}</div>
      ${key === 'start' ? `<div class="lbl">Energy today? <span class="mute">(sleep, work, legs)</span></div><div class="seg3">${ENERGY.map(([k, l]) => `<button class="${en === k ? 'on' : ''}" data-en="${k}">${l}</button>`).join('')}</div>
      <div class="lbl">Any practice or warm-up before the round?</div><div class="seg4">${WARMUP.map(([k, l]) => `<button class="${w === k ? 'on' : ''}" data-w="${k}">${l}</button>`).join('')}</div>
      ${bestHere.length ? `<div class="again best"><b>Your best shots here last time:</b>${bestHere.map((b) => `<div class="small">Hole ${b.h + 1}${b.club ? `, ${esc(b.club)}` : ''}: ${esc(b.note)}</div>`).join('')}</div>` : ''}
      ${lastAgain ? `<div class="again"><b>Last time here you said you'd:</b> ${esc(lastAgain.text)} <span class="mute small">(${fmtD(lastAgain.date)}, ${lastAgain.score})</span></div>` : ''}
      <div class="lbl">One thing for today <span class="mute">(optional — you'll rate it at the end)</span></div><div class="chips3">${INTENTIONS.map(([k, l]) => `<button class="${it === k ? 'on' : ''}" data-it="${k}">${l}</button>`).join('')}</div>
      <div class="row2"><label class="small">Swing thought<input data-thought value="${esc(thought)}" placeholder="one, and only one" /></label><label class="small">A good round today is…<input data-expect value="${esc(expect)}" placeholder="e.g. no doubles" /></label></div>
      <details class="lminfo rtd"><summary>${icon('info', 14)} My routine</summary>${routineHtml(R)}</details>` : ''}
      ${key === 'finish' ? `<div class="lbl">Your process today</div>${PROCESS.map(([k, l]) => `<div class="procrow"><span>${l}</span><div class="seg4 sm">${FREQ.map(([v, w]) => `<button class="${proc[k] === v ? 'on' : ''}" data-proc="${k}" data-v="${v}">${w}</button>`).join('')}</div></div>`).join('')}
      ${round.aim === 'fun' || round.aim === 'both' ? `<div class="procrow"><span>Did you enjoy it?</span><div class="seg4 sm">${FREQ.map(([v, w]) => `<button class="${proc.fun === v ? 'on' : ''}" data-proc="fun" data-v="${v}">${['Loved it', 'Mostly', 'Some', 'No'][4 - v]}</button>`).join('')}</div></div>` : ''}` : ''}
      ${key === 'finish' ? `<div class="lbl">The greens today <span class="mute">(optional)</span></div>
      <div class="seg3">${[['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']].map(([k, l]) => `<button class="${greens.firm === k ? 'on' : ''}" data-gfirm="${k}">${l}</button>`).join('')}</div>
      <div class="seg3" style="margin-top:6px">${[['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']].map(([k, l]) => `<button class="${greens.speed === k ? 'on' : ''}" data-gspeed="${k}">${l}</button>`).join('')}</div>` : ''}
      ${key === 'finish' && it ? `<div class="lbl">Did you keep to it: “${esc(intentionLabel(it))}”?</div><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="${kept >= n ? 'on' : ''}" data-kept="${n}">★</button>`).join('')}</div>` : ''}
      <button class="btn primary big" data-ok>${key === 'start' ? 'Start hole 1' : key === 'turn' ? 'On to the back nine' : 'See my round'}</button></div>`;
    sheet.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { v = +b.dataset.m; draw(); });
    sheet.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { w = b.dataset.w; draw(); });
    sheet.querySelectorAll('[data-en]').forEach((b) => b.onclick = () => { en = en === b.dataset.en ? null : b.dataset.en; draw(); });
    sheet.querySelectorAll('[data-aim]').forEach((b) => b.onclick = () => { aim = aim === b.dataset.aim ? null : b.dataset.aim; round.aim = aim; draw(); });
    sheet.querySelectorAll('[data-proc]').forEach((b) => b.onclick = () => { const k = b.dataset.proc, v = +b.dataset.v; proc[k] = proc[k] === v ? null : v; draw(); });
    sheet.querySelectorAll('[data-gfirm]').forEach((b) => b.onclick = () => { greens.firm = greens.firm === b.dataset.gfirm ? null : b.dataset.gfirm; draw(); });
    sheet.querySelectorAll('[data-gspeed]').forEach((b) => b.onclick = () => { greens.speed = greens.speed === b.dataset.gspeed ? null : b.dataset.gspeed; draw(); });
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => { kind = kind === b.dataset.kind ? null : b.dataset.kind; round.kind = kind; draw(); });
    sheet.querySelector('[data-kindinfo]')?.addEventListener('click', () => { kindInfo = !kindInfo; draw(); });
    sheet.querySelectorAll('[data-it]').forEach((b) => b.onclick = () => { it = it === b.dataset.it ? null : b.dataset.it; draw(); });
    sheet.querySelectorAll('[data-kept]').forEach((b) => b.onclick = () => { kept = kept === +b.dataset.kept ? null : +b.dataset.kept; draw(); });
    sheet.querySelector('[data-skip]').onclick = () => { round.mood[key] = round.mood[key] ?? 0; sheet.remove(); putRound(round).catch(() => {}); readWeather(round, key); done(); };
    sheet.querySelector('[data-thought]')?.addEventListener('input', (e) => { thought = e.target.value; });
    sheet.querySelector('[data-expect]')?.addEventListener('input', (e) => { expect = e.target.value; });
    sheet.querySelector('[data-ok]').onclick = () => {
      round.mood[key] = v;
      if (key === 'finish') { round.process = proc; round.greens = greens.firm || greens.speed ? { firm: greens.firm || null, speed: greens.speed || null } : null; }
      if (key === 'start') { round.kind = kind; round.aim = aim; round.warmup = w; round.energy = en; round.intention = it; round.swingThought = thought.trim() || null; round.expect = expect.trim() || null; if (round.swingThought && round.swingThought !== R.swingThought) { const st = S0(); st.routine = { ...(st.routine || {}), swingThought: round.swingThought }; S1(st); } }
      if (key === 'finish') round.intentionKept = kept;
      sheet.remove(); putRound(round).catch(() => {}); readWeather(round, key); done();
    };
  };
  draw();
  document.body.appendChild(sheet);
  if (key === 'start') listRounds().then((rs) => {
    const prev = rs.filter((r) => r.id !== round.id && r.courseId === round.courseId && r.finished && r.debrief?.again?.trim()).sort((a, b) => b.date - a.date)[0];
    if (prev && sheet.isConnected) { lastAgain = { text: prev.debrief.again.trim(), date: prev.date, score: prev.score ?? played(prev).reduce((a, h) => a + h.score, 0) }; }
    bestHere = lastBestHere(rs, round.courseId, round.id).slice(0, 3);
    if ((prev || bestHere.length) && sheet.isConnected) draw();
  }).catch(() => {});
}


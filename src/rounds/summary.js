// The round summary: scorecard with partners, weather, stats, strokes gained, Tiger 5, rules, debrief
// (what cost you, what you'd do differently), take-to-practice and the AI review. Also the stat cards
// the Play home reuses. Shares the Play root with rounds/ui.js through `api`:
// { root, ctx, home(), setCur(round, course), reopen(round, course) }.
import { CODES, roundStats, aggregate, roundSummaryText, pct, top } from './stats.js';
import { condText } from '../weather.js';
import { getSettings as S0, saveSettings as S1, putRound, deleteRound, listRounds, listSwings } from '../store.js';
import { isMetric } from '../units.js';
import { reviewRound, md, aiFrom, aiReady } from '../coach/ai.js';
import { coachContext, addCoachNote } from '../coach/profile.js';
import { checkRules, rulesCard, DEFAULT_RULES, tiger5, TIGER5_LABEL } from './tiger.js';
import { roundSG, SG_LABELS } from './sg.js';
import { workContext } from '../workingon.js';
import { practiceContext } from '../practice.js';
import { drillContext } from '../drills.js';
import { intentionLabel, moodLine } from './intentions.js';
import { autoShotType } from './hole.js';
import { removeSummary } from '../cloud/social.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtD = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const toParStr = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
const DEBRIEF_TAGS = ['Driver into trouble', 'Risky shot choice', 'Approach misses', 'Short game', '3-putts', 'Lost focus', 'Back problem', 'Tired', 'Wind / conditions', 'Bad luck'];

let api = null;
export function initSummary(a) { api = a; }

/** Weather saved with the round (start and finish), for the summary and the AI review. */
export function wxLine(r) {
  const w = r.cond || {}; if (!w.start && !w.finish) return '';
  const m = isMetric();
  const a = w.start ? condText(w.start, null, m) : '', b = w.finish ? condText(w.finish, null, m) : '';
  return `<p class="mute small" style="margin:8px 0 0">☁ ${a}${b && b !== a ? ` → ${b}` : ''}</p>`;
}

/** Who else is on the card. Names are remembered for next time. */
export function playersSheet(round, done) {
  const s = S0(); const known = s.partners || [];
  round.players = round.players || [];
  const n = round.holes.length;
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  const draw = () => {
    const on = new Set(round.players.map((p) => p.name));
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Who's playing?</b><button class="link" data-close>Close</button></div>
      <p class="mute small">Their scores go on your card, score and putts only. Your own shot detail stays separate.</p>
      <div class="clubchips">${[...new Set([...known, ...round.players.map((p) => p.name)])].map((k) => `<button class="${on.has(k) ? 'on' : ''}" data-pk="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input id="pNew" placeholder="Add a name" style="flex:1" /><button class="btn" data-padd>Add</button></div>
      <button class="btn primary big" data-ok style="margin-top:10px">${round.players.length ? `Start with ${round.players.map((p) => p.name.split(' ')[0]).join(', ')}` : 'Just me'}</button></div>`;
    const toggle = (name) => { const i = round.players.findIndex((p) => p.name === name); if (i >= 0) round.players.splice(i, 1); else round.players.push({ name, scores: Array(n).fill(null), putts: Array(n).fill(null) }); draw(); };
    sheet.querySelectorAll('[data-pk]').forEach((b) => b.onclick = () => toggle(b.dataset.pk));
    sheet.querySelector('[data-padd]').onclick = () => { const v = sheet.querySelector('#pNew').value.trim(); if (!v) return; if (!known.includes(v)) { known.push(v); s.partners = known; S1(s); } toggle(v); };
    sheet.querySelector('#pNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') sheet.querySelector('[data-padd]').click(); });
    const close = () => { sheet.remove(); done(); };
    sheet.querySelector('[data-close]').onclick = close; sheet.querySelector('[data-ok]').onclick = close;
  };
  draw(); document.body.appendChild(sheet);
}

// ---------------- Summary ----------------
/** What the shot details say to take to practice: flight and strike by shot type. */
export function practiceCard(r, c) {
  const by = {};
  r.holes.forEach((h, i) => (h?.shots || []).forEach((x, k) => {
    if (!x.d) return;
    const t = x.d.shot || autoShotType(x, k, c.holes[i]?.par ?? 4);
    const b = (by[t] ||= { n: 0, codes: {} }); b.n++;
    for (const v of [x.d.flight, x.d.strike, x.d.cause]) if (v && v !== 'STR' && v !== 'PUR') b.codes[v] = (b.codes[v] || 0) + 1;
    if (x.ss) b.codes.SS = (b.codes.SS || 0) + 1;
  }));
  const rows = Object.entries(by).filter(([, b]) => Object.keys(b.codes).length);
  if (!rows.length) return '';
  const name = Object.fromEntries(CODES.shot);
  const lab = { ...Object.fromEntries([...CODES.flight, ...CODES.strike, ...CODES.cause]), SS: 'Short-sided' };
  return `<div class="card"><h2>Take to practice</h2>${rows.map(([t, b]) => `<div class="tend"><div><b>${esc(name[t] || t)}</b><div class="mute small">${Object.entries(b.codes).sort((a, z) => z[1] - a[1]).map(([k, v]) => `${esc(lab[k] || k)} ×${v}`).join(' · ')} <span class="mute">(of ${b.n} logged)</span></div></div></div>`).join('')}</div>`;
}

/** Strokes gained card: one bar per category, centred on the tour baseline. */
export function sgCard(G, title, sub = '') {
  if (!G) return '';
  const keys = ['ott', 'app', 'arg', 'putt'];
  const max = Math.max(2, ...keys.map((k) => Math.abs(G[k])));
  const worst = keys.reduce((a, k) => (G[k] < G[a] ? k : a), 'ott');
  return `<div class="card"><div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Strokes gained</h2><span class="sgpill ${G.total >= 0 ? 'pos' : 'neg'}" style="float:none">${G.total >= 0 ? '+' : ''}${G.total.toFixed(1)}</span></div>
    <p class="mute small" style="margin:0 0 10px">${esc(title)}${sub ? ` · ${esc(sub)}` : ''}. Versus a tour-average player, so negative is normal; the biggest bar is where your shots go.</p>
    ${keys.map((k) => `<div class="sgrow"><span>${SG_LABELS[k]}</span><div class="sgbar"><i class="${G[k] >= 0 ? 'pos' : 'neg'}" style="${G[k] >= 0 ? 'left:50%' : `right:50%`};width:${(Math.abs(G[k]) / max) * 50}%"></i></div><b>${G[k] >= 0 ? '+' : ''}${G[k].toFixed(1)}</b></div>`).join('')}
    ${G[worst] < -0.5 ? `<p class="small" style="margin:10px 0 0">Practice priority: <b>${SG_LABELS[worst].toLowerCase()}</b> (${G[worst].toFixed(1)}).</p>` : ''}</div>`;
}

export function statsCard(S, title) {
  const isAgg = S.rounds != null;
  const k = isAgg ? S.per18 : 1;
  const f = (x, d = 1) => (isAgg ? (x * k).toFixed(d) : x);
  const missTot = Object.values(S.miss).reduce((a, b) => a + b, 0);
  const costs = (m) => top(m).slice(0, 4).map(([c, v]) => `<span class="pill">${esc(c)} ${isAgg ? (v * k).toFixed(1) : v}</span>`).join('');
  const costRow = (label, m) => (Object.keys(m).length ? `<div class="lbl">${label}</div><div>${costs(m)}</div>` : '');
  return `<div class="card"><h2>${esc(title)}</h2>
    <div class="kpis">
      <div><b>${isAgg ? `${S.avgToPar >= 0 ? '+' : ''}${S.avgToPar.toFixed(1)}` : `${S.score} <small>${toParStr(S.toPar)}</small>`}</b><span>${isAgg ? 'avg to par' : 'score'}</span></div>
      <div><b>${pct(S.fir, S.firOpp) ?? '–'}%</b><span>fairways</span></div>
      <div><b>${pct(S.gir, S.girOpp) ?? '–'}%</b><span>greens</span></div>
      <div><b>${S.puttsHoles ? (isAgg ? (S.putts * (S.holes / S.puttsHoles) * k).toFixed(1) : S.putts) : '–'}</b><span>putts</span></div>
    </div>
    <div class="statrows">
      <div><span>Tee misses</span><span>${S.teeLeft} left · ${S.teeRight} right${S.teeTrouble ? ` · ${S.teeTrouble} in trouble` : ''}</span></div>
      <div><span>Missed greens</span><span>${missTot ? `${S.miss.S} short · ${S.miss.L} long · ${S.miss.LF} left · ${S.miss.R} right` : '–'}</span></div>
      <div><span>Up and down</span><span>${S.scrOpp ? `${S.scr}/${S.scrOpp} (${pct(S.scr, S.scrOpp)}%)` : '–'}${S.sandOpp ? ` · sand ${S.sand}/${S.sandOpp}` : ''}</span></div>
      <div><span>3-putts</span><span>${f(S.threePutts)}${isAgg ? ' per round' : ''}</span></div>
      <div><span>Birdies · pars · bogeys · doubles+</span><span>${[S.birdies, S.pars, S.bogeys, S.doubles].map((x) => f(x, isAgg ? 1 : 0)).join(' · ')}</span></div>
    </div>
    ${costRow(`Strokes lost${isAgg ? ' per round' : ''} by cause`, S.byCause)}${costRow('By shot', S.byShot)}${costRow('By flight or strike', S.byStrike)}
    ${S.untagged ? `<p class="mute small">${f(S.untagged)} dropped stroke${S.untagged === 1 ? '' : 's'} not tagged.</p>` : ''}
  </div>`;
}

export async function renderSummary(r, c) {
  const S = roundStats(r, c);
  api.setCur(r, c);
  const half = (from, to) => c.holes.slice(from, to).map((h, i) => {
    const x = r.holes[from + i]; const d = x?.score != null ? x.score - h.par : null;
    return `<td class="${d == null ? '' : d < 0 ? 'b' : d === 0 ? '' : d === 1 ? 'o' : 'oo'}">${x?.score ?? '–'}</td>`;
  }).join('');
  const nine = c.holes.length > 9;
  const prow = (from, to) => (r.players || []).map((p) => `<tr class="pr"><th>${esc(p.name.split(' ')[0])}</th>${c.holes.slice(from, to).map((h, i) => { const v = p.scores[from + i]; const d = v == null ? null : v - h.par; return `<td class="${d == null ? '' : d < 0 ? 'b' : d === 0 ? '' : d === 1 ? 'o' : 'oo'}">${v ?? '–'}</td>`; }).join('')}<td>${c.holes.slice(from, to).reduce((a, h, i) => a + (p.scores[from + i] || 0), 0) || '–'}</td></tr>`).join('');
  api.root.innerHTML = `
    <button class="btn" data-x="back">‹ Rounds</button>
    <div class="card"><h2>${esc(r.courseName)} <span class="mute small">${fmtD(r.date)}</span></h2>
      <div class="scroll"><table class="card-t"><tr><th>Hole</th>${c.holes.slice(0, 9).map((_, i) => `<th>${i + 1}</th>`).join('')}<th>Out</th></tr>
      <tr><th>Par</th>${c.holes.slice(0, 9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(0, 9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(0, 9)}<td><b>${S.front}</b></td></tr>
      ${prow(0, 9)}
      ${nine ? `<tr><th>Hole</th>${c.holes.slice(9).map((_, i) => `<th>${i + 10}</th>`).join('')}<th>In</th></tr>
      <tr><th>Par</th>${c.holes.slice(9).map((h) => `<td class="mute">${h.par}</td>`).join('')}<td class="mute">${c.holes.slice(9).reduce((a, h) => a + h.par, 0)}</td></tr>
      <tr><th>You</th>${half(9, 18)}<td><b>${S.back}</b></td></tr>
      ${prow(9, 18)}` : ''}</table></div>
      ${(r.players || []).length ? `<p class="mute small" style="margin:8px 0 0">${r.players.map((p) => `${esc(p.name)} ${p.scores.reduce((a, v) => a + (v || 0), 0) || '–'}`).join(' · ')}</p>` : ''}
      ${wxLine(r)}
    </div>
    ${moodLine(r) ? `<p class="mute small center">${esc(moodLine(r))}</p>` : ''}
    ${statsCard(S, `${S.score} (${toParStr(S.toPar)})`)}
    ${practiceCard(r, c)}
    ${(() => { const G = roundSG(r, c); return G && G.complete >= Math.min(9, G.holes) ? sgCard(G, 'This round', G.complete < G.holes ? `${G.complete} of ${G.holes} holes have full shot data` : '') : '<div class="card"><h2>Strokes gained</h2><p class="mute small">Log shot distances and lies (they fill in from the rangefinder) plus the first-putt distance, and strokes gained shows here.</p></div>'; })()}
    ${(() => { const T = tiger5(r, c); return `<div class="card"><div class="sechead" style="margin:0 0 6px"><h2 style="margin:0">Tiger 5</h2><span class="sgpill ${T.total <= 6 ? 'pos' : 'neg'}" style="float:none">${T.total}</span></div>
      <p class="mute small" style="margin:0 0 6px">${T.total <= 6 ? 'Six or fewer: a round you can win with.' : 'Over six: these cost the round.'}</p>
      ${T.res.map((x) => `<div class="rule"><span class="${x.holes.length ? 'x' : 'ok'}">${x.holes.length || '✓'}</span><div><b>${TIGER5_LABEL[x.id]}</b>${x.holes.length ? `<div class="mute small">Hole${x.holes.length > 1 ? 's' : ''} ${x.holes.join(', ')}</div>` : ''}</div></div>`).join('')}</div>`; })()}
    ${rulesCard(checkRules(r, c, api.ctx.settings().roundRules || DEFAULT_RULES), esc)}
    <div class="card debrief"><h2>Debrief</h2>
      <p class="mute small">What really decided this round? The coach reads this alongside the numbers.</p>
      ${c.holes.map((ch, i) => ({ h: r.holes[i], ch, i })).filter(({ h, ch }) => h && h.score - ch.par >= 2).map(({ h, ch, i }) => `<div class="dhole"><b>Hole ${i + 1}: ${h.score} on a par ${ch.par}</b>${(h.tags || []).length ? `<span class="mute small"> · ${esc(h.tags.map((t) => [t.shot, t.cause, t.flight, t.strike, t.result].filter(Boolean).join('/')).join(', '))}</span>` : ''}
        <textarea data-hn="${i}" rows="2" placeholder="What happened on ${i + 1}?">${esc(h.note || '')}</textarea></div>`).join('')}
      <div class="lbl">What cost you most today?</div>
      <div class="dtags">${DEBRIEF_TAGS.map((t) => `<button class="${r.debrief?.tags?.includes(t) ? 'on' : ''}" data-dt="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="lbl">If you played this round again, what would you do differently?</div>
      <textarea id="debriefAgain" rows="3" placeholder="e.g. 3-wood off 5 and 14. Lay up on 9. Pick a target on every putt before I walk in.">${esc(r.debrief?.again || '')}</textarea>
      ${r.intention ? `<p class="mute small" style="margin:4px 0 0">Today's one thing: “${esc(intentionLabel(r.intention))}”${r.intentionKept ? ` · kept ${'★'.repeat(r.intentionKept)}` : ''}</p>` : ''}
      <div class="lbl">Notes</div>
      <textarea id="debriefNotes" rows="4" placeholder="e.g. Two driver slices into water on 5 and 14. Went for 9 in two when I should have laid up. Putted well.">${esc(r.debrief?.notes || '')}</textarea>
      <p class="mute small" id="dbSaved"></p>
    </div>
    <div class="actions" style="grid-template-columns:1fr 1fr">
      <button class="btn primary" data-x="ai">AI round review</button>
      <button class="btn" data-x="edit">Edit holes</button>
    </div>
    <div id="roundAi" class="card ai" ${r.ai ? '' : 'hidden'}>${r.ai ? md(r.ai) : ''}</div>
    <label class="card check"><input type="checkbox" data-learn ${r.learning !== false ? 'checked' : ''}/> Count toward my coach profile (untick for scrambles, fun rounds)</label>
    <button class="btn" data-x="del" style="width:100%;color:var(--work)">Delete round</button>`;
  api.root.querySelector('[data-learn]').onchange = (e) => { r.learning = e.target.checked; putRound(r); };
  // debrief autosave
  let dbT = null;
  const saveDb = () => { clearTimeout(dbT); dbT = setTimeout(async () => { await putRound(r); const el = api.root.querySelector('#dbSaved'); if (el) el.textContent = 'Saved'; }, 600); };
  r.debrief ||= { notes: '', tags: [] };
  api.root.querySelector('#debriefNotes').addEventListener('input', (e) => { r.debrief.notes = e.target.value; saveDb(); });
  api.root.querySelector('#debriefAgain').addEventListener('input', (e) => { r.debrief.again = e.target.value; saveDb(); });
  api.root.querySelectorAll('[data-hn]').forEach((t) => t.addEventListener('input', (e) => { r.holes[+t.dataset.hn].note = e.target.value; saveDb(); }));
  api.root.querySelectorAll('[data-dt]').forEach((b) => (b.onclick = () => {
    const t = b.dataset.dt, i = r.debrief.tags.indexOf(t);
    if (i >= 0) r.debrief.tags.splice(i, 1); else r.debrief.tags.push(t);
    b.classList.toggle('on'); saveDb();
  }));
  api.root.querySelectorAll('[data-x]').forEach((b) => b.onclick = async () => {
    const x = b.dataset.x;
    if (x === 'back') return api.home();
    if (x === 'edit') { r.finished = false; await putRound(r); return api.reopen(r, c); }
    if (x === 'del') { await deleteRound(r.id); removeSummary(r.id).catch(() => {}); return api.home(); }
    if (x === 'ai') {
      const s = api.ctx.settings();
      if (!aiReady(s)) return api.ctx.toast('Add a Claude, ChatGPT or Gemini key in Settings to use the AI coach.', 5000);
      const out = api.root.querySelector('#roundAi'); out.hidden = false; out.innerHTML = '<p class="mute">Coach is going through your round…</p>';
      try {
        const recent = (await listRounds()).filter((x) => x.finished && x.id !== r.id && x.learning !== false).slice(0, 8);
        const A = await api.aggStats(recent);
        const swings = await listSwings().catch(() => []);
        const holeLog = r.holes.map((h, i) => h ? `H${i + 1} par ${c.holes[i].par}: ${h.score} (${h.putts ?? '?'} putts${h.tee ? `, tee ${h.tee}` : ''}${h.miss ? `, missed green ${h.miss}` : ''}${h.bunker ? ', bunker' : ''}${(h.tags || []).length ? `, tags: ${h.tags.map((t) => [t.shot, t.cause, t.flight, t.strike, t.result].filter(Boolean).join('/') + (t.cost ? ` +${t.cost}` : ' saved')).join('; ')}` : ''}${(h.shots || []).some((x) => x.d || x.res || x.dist) ? `, shots: ${h.shots.map((x, k) => `${k + 1}${x.lie && x.lie !== 'tee' ? ` from ${x.lie}` : ''}${x.dist ? ` ${Math.round(x.dist)}y` : ''}${x.sw ? ` ${x.sw}` : ''}${x.intent ? ` (planned ${({ D: 'draw', S: 'straight', F: 'fade' })[x.intent]})` : ''}${x.res ? ` → ${x.res}${x.dir ? ` missed ${x.dir}` : ''}${x.ss ? ' short-sided' : ''}` : ''}${x.d ? ` [${[x.d.club, x.d.flight, x.d.strike, x.d.cause, x.d.result].filter(Boolean).join('/')}]` : ''}`).join('; ')}` : ''}${h.note ? `, golfer's note: "${h.note}"` : ''})` : null).filter(Boolean).join('\n');
        const roundText = `${c.name}${c.tees ? ` (${c.tees})` : ''}: ${S.score} (${toParStr(S.toPar)}). ${moodLine(r) ? moodLine(r) + ' (1 = lethargic, 5 = calm/focused ideal, 10 = agitated). ' : ''}${roundSummaryText(aggregate([{ round: r, course: c, stats: S }]))}\nRules the golfer plays by: ${checkRules(r, c, api.ctx.settings().roundRules || DEFAULT_RULES).map((x) => `${x.label}: ${x.holes.length ? `broken on ${x.holes.join(',')}` : 'kept'}`).join('; ')}.\nHole by hole:\n${holeLog}${r.debrief?.tags?.length || r.debrief?.notes ? `\nGolfer's debrief: ${[...(r.debrief.tags || []), r.debrief.notes].filter(Boolean).join('; ')}` : ''}${r.debrief?.again ? `\nWhat they'd do differently next time: ${r.debrief.again}` : ''}`;
        const { text, meta } = await reviewRound({ ...aiFrom(s), roundText: `${wxLine(r) ? `Conditions: ${wxLine(r).replace(/<[^>]+>/g, '').replace('☁ ', '')}\n` : ''}${roundText}`, recentText: A ? roundSummaryText(A) : '', history: coachContext(swings, recent.length ? A : null), golfer: [s.golfer, workContext(), await practiceContext().catch(() => ''), await drillContext().catch(() => '')].filter(Boolean).join(' ') });
        r.ai = text; await putRound(r);
        if (meta?.note && r.learning !== false) addCoachNote(`[round] ${String(meta.note).slice(0, 280)}`);
        out.innerHTML = md(text);
      } catch (err) { out.innerHTML = `<p style="color:var(--work)">${esc(err.message)}</p>`; }
    }
  });
  window.scrollTo(0, 0);
}


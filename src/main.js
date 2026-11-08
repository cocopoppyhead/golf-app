import './styles.css';
import { loadVideo, extractPose } from './coach/pose.js';
import { cleanTrack, findPhases } from './coach/phases.js';
import { analyse } from './coach/metrics.js';
import { drawOverlay } from './coach/render.js';
import { SwingPlayer } from './coach/player.js';
import { exportMp4, canExport } from './coach/export.js';
import { getCoaching, md } from './coach/ai.js';
import { getSettings, saveSettings, putSwing, listSwings, getSwing, deleteSwing } from './store.js';
import { tendencies, focusProgress, updatePlan, checkIn, getPlan, setFocus, addCoachNote, coachContext, metricLabel, metricCue } from './coach/profile.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let settings = getSettings();
let state = null; // current analysis session

// ---------------- Tabs ----------------
const TITLES = { coach: 'Coach', history: 'Progress', rounds: 'Rounds', settings: 'Settings' };
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $('#tabTitle').textContent = TITLES[name];
  if (name === 'history') renderHistory();
  if (name === 'settings') fillSettings();
  if (name !== 'coach') state?.player?.stop();
  window.scrollTo(0, 0);
}
function screen(id) {
  document.querySelectorAll('#tab-coach .screen').forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
}
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

// ---------------- Coach: start ----------------
function setClub(c) {
  settings.club = c; saveSettings(settings);
  document.querySelectorAll('#clubSeg button').forEach((b) => b.classList.toggle('on', b.dataset.club === c));
}
document.querySelectorAll('#clubSeg button').forEach((b) => b.addEventListener('click', () => setClub(b.dataset.club)));
setClub(settings.club);
$('#learnBox').checked = settings.learning !== false;
$('#learnBox').addEventListener('change', (e) => { settings.learning = e.target.checked; saveSettings(settings); });

$('#videoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) openVideo(file);
});

async function openVideo(file) {
  state?.player?.stop();
  if (state?.video) { URL.revokeObjectURL(state.video.src); state.video.remove(); }
  state = null;
  try {
    const video = await loadVideo(file);
    // iOS needs the element in the DOM to decode frames reliably
    Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
    document.body.appendChild(video);
    state = { video, club: settings.club, ball: null, learning: settings.learning !== false };
    if (video.duration <= 4) return runAnalysis([0, video.duration]); // short clip: nothing to trim
    await showTrim();
  } catch (err) {
    console.error(err);
    screen('coach-start');
    toast(err.message || 'Could not open that video.', 6000);
  }
}

// ---------------- Coach: trim ----------------
const fmtT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
async function showTrim() {
  const { video } = state;
  const dur = video.duration;
  const c = $('#trimCanvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  const a = $('#trimStart'), b = $('#trimEnd');
  for (const el of [a, b]) { el.min = 0; el.max = dur; el.step = 0.05; }
  a.value = 0; b.value = dur;
  let previewing = false;
  const show = async (t) => { await seekTo(video, t); ctx.drawImage(video, 0, 0); };
  const update = () => {
    const s = +a.value, e = +b.value;
    $('#trimSel').style.left = `${(s / dur) * 100}%`;
    $('#trimSel').style.right = `${100 - (e / dur) * 100}%`;
    $('#trimInfo').textContent = `${fmtT(s)} → ${fmtT(e)} · ${(e - s).toFixed(1)} s selected`;
  };
  const MIN = 1.0;
  a.oninput = () => { if (+a.value > +b.value - MIN) a.value = +b.value - MIN; update(); previewing = false; show(+a.value); };
  b.oninput = () => { if (+b.value < +a.value + MIN) b.value = +a.value + MIN; update(); previewing = false; show(+b.value); };
  update();
  screen('coach-trim');
  await show(0);

  // Filmstrip so you can see where the swing is
  const strip = $('#trimStrip'); strip.innerHTML = '';
  const N = 8, th = document.createElement('canvas');
  th.height = 72; th.width = Math.round((72 * video.videoWidth) / video.videoHeight);
  const tctx = th.getContext('2d');
  for (let i = 0; i < N; i++) {
    await seekTo(video, (dur * (i + 0.5)) / N);
    tctx.drawImage(video, 0, 0, th.width, th.height);
    const img = new Image(); img.src = th.toDataURL('image/jpeg', 0.6); strip.appendChild(img);
  }
  await show(+a.value);

  $('#trimPlay').onclick = async () => {
    if (previewing) { previewing = false; return; }
    previewing = true; $('#trimPlay').textContent = '■ Stop';
    await seekTo(video, +a.value);
    video.playbackRate = 1;
    await video.play().catch(() => {});
    const tick = () => {
      if (!previewing || video.currentTime >= +b.value || video.ended) {
        video.pause(); previewing = false; $('#trimPlay').textContent = '▶ Preview selection'; return;
      }
      ctx.drawImage(video, 0, 0); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  $('#trimGo').onclick = () => { previewing = false; video.pause(); runAnalysis([+a.value, +b.value]); };
  $('#trimAll').onclick = () => { previewing = false; video.pause(); runAnalysis([0, dur]); };
}

async function runAnalysis(range) {
  const { video } = state;
  screen('coach-busy');
  const setP = (p, msg) => { $('#busyBar').style.width = `${Math.round(p * 100)}%`; if (msg) $('#busyMsg').textContent = msg; };
  setP(0, 'Loading the pose model…');
  try {
    const raw = await extractPose(video, { quality: settings.quality, range, onProgress: setP });
    const fr = cleanTrack(raw.frames);
    const ph = findPhases(fr, { handedness: settings.handedness });
    Object.assign(state, { fr, ph, raw, range, club: settings.club, ball: null });
    await askBall();
  } catch (err) {
    console.error(err);
    if (video.duration > 4) { await showTrim(); toast(`${err.message || 'Could not analyse that.'} Try trimming tighter around one swing.`, 7000); }
    else { screen('coach-start'); toast(err.message || 'Something went wrong analysing that video.', 6000); }
  }
}

// ---------------- Coach: ball tap ----------------
async function askBall() {
  const { video, fr, ph } = state;
  await seekTo(video, fr[ph.address].t);
  const c = $('#ballCanvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  const draw = () => {
    ctx.drawImage(video, 0, 0);
    if (state.ball) {
      const u = Math.min(c.width, c.height) / 34;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = u * 0.2; ctx.setLineDash([u * 0.6, u * 0.5]);
      ctx.beginPath(); ctx.moveTo(state.ball.x, 0); ctx.lineTo(state.ball.x, state.ball.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, u * 0.9, 0, Math.PI * 2); ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = u * 0.25; ctx.stroke();
    }
  };
  draw();
  c.onclick = (e) => {
    const r = c.getBoundingClientRect();
    state.ball = { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
    $('#ballOk').disabled = false; draw();
  };
  $('#ballOk').disabled = true;
  $('#ballOk').onclick = () => showResult();
  $('#ballSkip').onclick = () => { state.ball = null; showResult(); };
  screen('coach-ball');
}

const seekTo = (v, t) => new Promise((r) => { v.onseeked = r; v.currentTime = t; });

// ---------------- Coach: result ----------------
function computeA() {
  const heightIn = settings.units === 'cm' ? settings.heightIn / 2.54 : settings.heightIn;
  state.A = analyse(state.fr, state.ph, { club: state.club, heightIn, ball: state.ball });
  return state.A;
}

function renderChipsAndSummary() {
  const A = state.A;
  const chips = $('#cpChips');
  chips.innerHTML = A.checkpoints.map((c, i) => {
    const worst = c.items.some((x) => x.status === 'work') ? 'work' : c.items.some((x) => x.status === 'ok') ? 'ok' : 'good';
    return `<button data-i="${i}"><i style="background:var(--${worst})"></i>${c.title}</button>`;
  }).join('');
  chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => state.player.showCheckpoint(+b.dataset.i)));
  const s = A.summary;
  $('#summary').innerHTML = `<h2>${esc(s.headline)}</h2><p>${esc(s.advice)}</p><span class="score">${s.score} checks on target</span>`;
}

async function showResult() {
  const { video, fr } = state;
  const A = computeA();
  screen('coach-result');
  $('#aiOut').hidden = true; $('#aiOut').innerHTML = '';
  state.ai = null;

  const player = new SwingPlayer($('#playCanvas'), video, fr, A, {
    onCheckpoint: (k) => renderCp(k),
    onEnd: () => { $('#playBtn').textContent = '↻'; },
  });
  player.rate = +$('#rateSel').value;
  state.player = player;
  renderChipsAndSummary();
  $('#rateSel').onchange = (e) => (player.rate = +e.target.value);
  $('#playBtn').textContent = '▶';
  $('#playBtn').onclick = () => {
    if (player.playing) { player.stop(); $('#playBtn').textContent = '▶'; }
    else { $('#playBtn').textContent = '❚❚'; player.play(); }
  };
  $('#nudgeBack').onclick = () => nudge(-1);
  $('#nudgeFwd').onclick = () => nudge(1);
  const focus = Math.max(0, A.checkpoints.findIndex((c) => c.key === A.summary.focus));
  await player.showCheckpoint(focus);

  $('#exportBtn').disabled = !canExport();
  $('#exportBtn').onclick = doExport;
  $('#aiBtn').onclick = doAi;
  $('#newBtn').onclick = () => { player.stop(); screen('coach-start'); };

  // Save to history, then update the coach profile
  state.id = `s_${Date.now()}`; state.date = Date.now();
  state.thumbs = await checkpointImages(360, false);
  await putSwing(record()).catch(() => {});
  await refreshCoachCard(true);
}

/** The "Coach check-in" card under the summary: this swing vs your current focus. */
async function refreshCoachCard(runPlan) {
  const el = $('#coachCheck');
  if (!state.learning) {
    el.innerHTML = `<h3>Test swing</h3><p class="mute">Not counted toward your profile.</p><button class="btn" id="countBtn">Count this swing</button>`;
    $('#countBtn').onclick = async () => { state.learning = true; await putSwing(record()).catch(() => {}); refreshCoachCard(true); };
    return;
  }
  const swings = await listSwings().catch(() => []);
  const res = runPlan ? updatePlan(swings, record()) : { plan: getPlan(), check: checkIn(record()), tendencies: tendencies(swings) };
  const { plan, check, event } = res;
  const t = res.tendencies;
  let html = `<h3>Coach check-in</h3>`;
  if (event) html += `<p class="event">${esc(event)}</p>`;
  if (plan.focus && check) {
    const p = focusProgress(swings, plan);
    html += `<div class="focus"><span class="tag">FOCUS</span> ${esc(plan.focus.label)}</div>
      <p class="cue">${esc(plan.focus.cue)}.</p>
      <p><b style="color:var(--${check.status})">${check.verdict}</b> on this swing: ${esc(check.text.split(': ').slice(1).join(': '))}</p>
      ${dots(p)}`;
  } else if (!plan.focus) {
    const need = Math.max(0, 3 - t.swings);
    html += `<p class="mute">${need ? `${need} more learning swing${need > 1 ? 's' : ''} and I'll start spotting your tendencies and set a focus.` : 'No recurring fault across your recent swings. Nice.'}</p>`;
  }
  el.innerHTML = html;
}

function dots(p) {
  if (!p?.values.length) return '';
  const last = p.values.slice(-10);
  return `<div class="dots">${last.map((v) => `<i title="${esc(v.you)}" style="background:var(--${v.status})"></i>`).join('')}</div>
    <p class="mute small">${p.good} of last ${p.lastN} on target · counts as fixed at 4 of 5</p>`;
}

// Move the shown checkpoint one frame earlier/later, then re-measure everything.
let saveTimer = null;
async function nudge(d) {
  const p = state.player;
  const k = Math.max(0, p.cpShown);
  const keys = ['address', 'top', 'impact', 'finish'];
  const key = keys[k];
  const lo = k > 0 ? state.ph[keys[k - 1]] + 1 : 0;
  const hi = k < 3 ? state.ph[keys[k + 1]] - 1 : state.fr.length - 1;
  const next = Math.min(hi, Math.max(lo, state.ph[key] + d));
  if (next === state.ph[key]) return;
  state.ph[key] = next;
  const A = computeA();
  p.A = A; p.cpTimes = A.checkpoints.map((c) => state.fr[c.frame].t);
  p.end = state.fr[Math.min(state.fr.length - 1, A.checkpoints[3].frame + 12)].t;
  p.start = state.fr[Math.max(0, A.checkpoints[0].frame - 8)].t;
  renderChipsAndSummary();
  await p.showCheckpoint(k);
  state.ai = null; $('#aiOut').hidden = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { state.thumbs = await checkpointImages(360, false); await putSwing(record()).catch(() => {}); refreshCoachCard(false); }, 1500);
}

function renderCp(k) {
  const c = state.A.checkpoints[k];
  document.querySelectorAll('#cpChips button').forEach((b) => b.classList.toggle('on', +b.dataset.i === k));
  $('#cpCard').innerHTML = cpHtml(c, k);
  $('#nudgeLabel').textContent = `Wrong frame? Nudge ${c.title.toLowerCase()}`;
}
function cpHtml(c, k) {
  return `<h3>${c.title.toUpperCase()} <span>checkpoint ${k + 1}/4</span></h3>
  <div class="head"><span class="y">YOU</span><span class="p">TOUR PRO</span></div>
  ${c.items.map((it) => `<div class="item"><div><div class="n"><i style="background:var(--${it.status})"></i>${esc(it.name)}</div><div class="y">${esc(it.you)}</div></div><div class="p" style="padding-top:22px">${esc(it.pro)}</div></div>`).join('')}`;
}

function record() {
  const A = state.A;
  return {
    id: state.id, date: state.date || Date.now(), learning: state.learning !== false, club: A.club, summary: A.summary, thumbs: state.thumbs, ai: state.ai || null,
    checkpoints: A.checkpoints.map((c) => ({ key: c.key, title: c.title, items: c.items.map(({ name, you, pro, status, value }) => ({ name, you, pro, status, value })) })),
  };
}

/** JPEGs of the 4 checkpoints with overlay (+ card), at a given width. */
async function checkpointImages(width, card) {
  const { video, fr, A } = state;
  const k = width / video.videoWidth;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  const out = document.createElement('canvas'); out.width = Math.round(width); out.height = Math.round(video.videoHeight * k);
  const octx = out.getContext('2d');
  const imgs = [];
  for (const [i, cp] of A.checkpoints.entries()) {
    await seekTo(video, fr[cp.frame].t);
    ctx.drawImage(video, 0, 0);
    drawOverlay(ctx, A, fr[cp.frame].lm, { cp, card, cpIndex: i });
    octx.drawImage(c, 0, 0, out.width, out.height);
    imgs.push(out.toDataURL('image/jpeg', 0.8));
  }
  await state.player?.showCheckpoint(state.player.cpShown >= 0 ? state.player.cpShown : 0);
  return imgs;
}

async function doExport() {
  const btn = $('#exportBtn'); btn.disabled = true;
  state.player.stop();
  try {
    const blob = await exportMp4(state.video, state.fr, state.A, { onProgress: (p) => (btn.textContent = `Saving ${Math.round(p * 100)}%`) });
    const name = `swing-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
    const file = new File([blob], name, { type: 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Swing analysis' }).catch(() => {});
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } catch (e) { toast(e.message, 6000); }
  btn.textContent = 'Save video'; btn.disabled = false;
  await state.player.showCheckpoint(Math.max(0, state.player.cpShown));
}

async function doAi() {
  const out = $('#aiOut');
  if (!settings.apiKey) { toast('Add your Claude API key in Settings to use the AI coach.'); showTab('settings'); return; }
  out.hidden = false; out.innerHTML = '<p class="mute">Coach is looking at your swing…</p>';
  $('#aiBtn').disabled = true;
  try {
    const images = await checkpointImages(560, true);
    const swings = (await listSwings().catch(() => [])).filter((s) => s.id !== state.id);
    const history = state.learning ? coachContext(swings) : '';
    const { text, meta } = await getCoaching({ apiKey: settings.apiKey, model: settings.model, A: state.A, images, golfer: settings.golfer, history });
    state.ai = text;
    let extra = '';
    if (state.learning && meta) {
      if (meta.note) addCoachNote(String(meta.note).slice(0, 300));
      const valid = state.A.checkpoints.flatMap((c) => c.items.map((i) => `${c.key}:${i.name}`));
      const cur = getPlan().focus?.key;
      if (meta.focus && valid.includes(meta.focus) && meta.focus !== cur) {
        const plan = setFocus(meta.focus); plan.focus.setBy = 'AI coach'; localStorage.setItem('golf.plan', JSON.stringify(plan));
        extra = `<p class="event">Coach set your focus to: ${esc(metricLabel(meta.focus).toLowerCase())}.</p>`;
      }
    }
    out.innerHTML = md(text) + extra;
    await putSwing(record()).catch(() => {});
    if (state.learning) refreshCoachCard(false);
  } catch (e) { out.innerHTML = `<p style="color:var(--work)">${esc(e.message)}</p>`; }
  $('#aiBtn').disabled = false;
}

// ---------------- History ----------------
const fmtDate = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const val = (s, cp, name) => s.checkpoints.find((c) => c.key === cp)?.items.find((i) => i.name === name)?.value;

async function renderCoachPanel(all) {
  const el = $('#coachPanel');
  const plan = getPlan();
  const t = tendencies(all);
  const p = focusProgress(all, plan);
  const keys = [...new Set(all.flatMap((s) => s.checkpoints.flatMap((c) => c.items.map((i) => `${c.key}:${i.name}`))))];
  let html = `<h2>Your coach</h2>`;
  if (plan.focus) {
    html += `<div class="focus"><span class="tag">CURRENT FOCUS</span> ${esc(plan.focus.label)}</div>
      <p class="cue">${esc(plan.focus.cue)}.</p>
      <p class="mute small">Set ${plan.focus.setBy === 'auto' ? 'automatically' : `by ${esc(plan.focus.setBy)}`} on ${new Date(plan.focus.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${p?.count || 0} swing${(p?.count || 0) === 1 ? '' : 's'} since</p>${dots(p)}`;
  } else html += `<p class="mute">No focus yet. ${t.swings < 3 ? `Analyse ${3 - t.swings} more swing${3 - t.swings > 1 ? 's' : ''} in learning mode.` : 'No recurring fault found.'}</p>`;
  if (keys.length) {
    html += `<label class="small mute" style="display:block;margin-top:10px">Change focus
      <select id="focusSel"><option value="">Auto (let the coach pick)</option>${keys.map((k) => `<option value="${k}" ${plan.focus?.key === k ? 'selected' : ''}>${esc(metricLabel(k))}</option>`).join('')}</select></label>`;
  }
  if (t.list.length) {
    html += `<h3 style="margin-top:16px">Tendencies <span class="mute small">last ${t.swings} learning swings</span></h3>` + t.list.slice(0, 6).map((x) => `
      <div class="tend"><div><b>${esc(x.label)}</b><div class="mute small">${esc(x.cue)}</div></div>
      <div class="r"><div class="meter"><div style="width:${Math.round(x.rate * 100)}%"></div></div><span class="small">${x.misses}/${x.n} · ${x.trend === 'improving' ? '↑ improving' : x.trend === 'worse' ? '↓ worse' : '→ steady'}</span></div></div>`).join('');
  }
  if (plan.done.length) html += `<h3 style="margin-top:16px">Fixed</h3>` + plan.done.slice(0, 5).map((d) => `<p class="small">✓ ${esc(d.label)} <span class="mute">${new Date(d.finished).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></p>`).join('');
  if (plan.notes.length) html += `<h3 style="margin-top:16px">Coach's notebook</h3>` + plan.notes.slice(0, 4).map((n) => `<p class="small"><span class="mute">${new Date(n.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> ${esc(n.note)}</p>`).join('');
  html += `<p class="mute small" style="margin-top:12px">Rounds and scorecards will feed this profile too, once that module is built.</p>`;
  el.innerHTML = html;
  $('#focusSel')?.addEventListener('change', (e) => {
    if (e.target.value) setFocus(e.target.value);
    else { setFocus(null); updatePlan(all, null); }
    renderCoachPanel(all);
  });
}

async function renderHistory() {
  $('#historyDetail').hidden = true; $('#historyList').hidden = false; $('#trend').hidden = false; $('#coachPanel').hidden = false;
  const all = await listSwings().catch(() => []);
  renderCoachPanel(all);
  if (!all.length) {
    $('#trend').innerHTML = '<h2>No swings yet</h2><p class="mute">Analyse a swing in Coach and it lands here, so you can track the numbers over time.</p>';
    $('#historyList').innerHTML = '';
    return;
  }
  const rows = all.slice(0, 8).map((s) => {
    const f = (v, d = 1) => (v == null ? '–' : (+v).toFixed(d));
    return `<tr><td>${new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td><td>${f(val(s, 'top', 'Head'))}</td><td>${f(val(s, 'impact', 'Head'))}</td><td>${f(val(s, 'impact', 'Hips'))}</td><td>${f(val(s, 'impact', 'Spine tilt'), 0)}°</td></tr>`;
  }).join('');
  $('#trend').innerHTML = `<h2>Trend</h2><div class="trend"><table><tr><th></th><th>Head @top</th><th>Head @impact</th><th>Hips @impact</th><th>Tilt @impact</th></tr>${rows}</table></div>
  <p class="mute small">Inches; + = toward target. Tour: head ≤ 0 at impact, hips +1 to +6.</p>`;
  $('#historyList').innerHTML = all.map((s) => `
    <div class="hist" data-id="${s.id}">
      <img src="${s.thumbs?.[2] || ''}" alt="" />
      <div><div class="t">${esc(s.summary.headline)}</div><div class="s">${fmtDate(s.date)} · ${esc(s.club)} · ${esc(s.summary.score)} on target${s.ai ? ' · AI reviewed' : ''}${s.learning === false ? ' · test swing' : ''}</div></div>
      <div class="mute">›</div>
    </div>`).join('');
  document.querySelectorAll('.hist').forEach((el) => el.addEventListener('click', () => showDetail(el.dataset.id)));
}

async function showDetail(id) {
  const s = await getSwing(id);
  if (!s) return;
  $('#historyList').hidden = true; $('#trend').hidden = true; $('#coachPanel').hidden = true;
  const d = $('#historyDetail'); d.hidden = false;
  d.innerHTML = `<button class="btn" id="backBtn">‹ Back</button>
    <div class="card summary"><h2>${esc(s.summary.headline)}</h2><p>${esc(s.summary.advice)}</p><span class="score">${esc(s.summary.score)} checks on target</span><p class="mute small">${fmtDate(s.date)} · ${esc(s.club)}</p></div>
    <div class="thumbs">${(s.thumbs || []).map((t) => `<img src="${t}" alt="" />`).join('')}</div>
    ${s.checkpoints.map((c, k) => `<div class="card cp">${cpHtml(c, k)}</div>`).join('')}
    ${s.ai ? `<div class="card ai">${md(s.ai)}</div>` : ''}
    <label class="card check"><input type="checkbox" id="detLearn" ${s.learning !== false ? 'checked' : ''}/> Count toward my coach profile (learning mode)</label>
    <button class="btn" id="delBtn" style="width:100%;color:var(--work)">Delete this swing</button>`;
  $('#detLearn').onchange = async (e) => { s.learning = e.target.checked; await putSwing(s); };
  $('#backBtn').onclick = renderHistory;
  $('#delBtn').onclick = async () => { await deleteSwing(id); renderHistory(); };
  window.scrollTo(0, 0);
}

// ---------------- Settings ----------------
function fillSettings() {
  const f = $('#settingsForm');
  f.height.value = settings.heightIn; f.units.value = settings.units;
  f.handedness.value = settings.handedness; f.quality.value = settings.quality;
  f.apiKey.value = settings.apiKey; f.model.value = settings.model; f.golfer.value = settings.golfer;
  $('#savedMsg').hidden = true;
}
$('#settingsForm').units.addEventListener('change', (e) => {
  const f = $('#settingsForm'); const h = parseFloat(f.height.value);
  if (!isNaN(h)) f.height.value = e.target.value === 'cm' ? Math.round(h * 2.54) : Math.round((h / 2.54) * 10) / 10;
});
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const h = parseFloat(f.height.value);
  settings = {
    ...settings,
    heightIn: isNaN(h) ? settings.heightIn : h, units: f.units.value,
    handedness: f.handedness.value, quality: f.quality.value,
    apiKey: f.apiKey.value.trim(), model: f.model.value.trim() || 'claude-sonnet-5-5', golfer: f.golfer.value.trim(),
  };
  saveSettings(settings);
  $('#savedMsg').hidden = false;
});

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

// Test hook: lets automated tests feed a video URL
window.__golfTest = { open: async (url) => openVideo(await (await fetch(url)).blob()) };

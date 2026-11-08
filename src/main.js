import './styles.css';
import { loadVideo, extractPose } from './coach/pose.js';
import { cleanTrack, findPhases } from './coach/phases.js';
import { analyse } from './coach/metrics.js';
import { drawOverlay } from './coach/render.js';
import { SwingPlayer } from './coach/player.js';
import { exportMp4, canExport } from './coach/export.js';
import { getCoaching, md } from './coach/ai.js';
import { getSettings, saveSettings, putSwing, listSwings, getSwing, deleteSwing } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let settings = getSettings();
let state = null; // current analysis session

// ---------------- Tabs ----------------
const TITLES = { coach: 'Coach', history: 'History', rounds: 'Rounds', settings: 'Settings' };
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

$('#videoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) runAnalysis(file);
});

async function runAnalysis(file) {
  state?.player?.stop();
  if (state?.video) { URL.revokeObjectURL(state.video.src); state.video.remove(); }
  screen('coach-busy');
  const setP = (p, msg) => { $('#busyBar').style.width = `${Math.round(p * 100)}%`; if (msg) $('#busyMsg').textContent = msg; };
  setP(0, 'Loading the pose model…');
  try {
    const video = await loadVideo(file);
    // iOS needs the element in the DOM to decode frames reliably
    Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
    document.body.appendChild(video);
    const raw = await extractPose(video, { quality: settings.quality, onProgress: setP });
    const fr = cleanTrack(raw.frames);
    const ph = findPhases(fr, { handedness: settings.handedness });
    state = { video, fr, ph, raw, club: settings.club, ball: null };
    await askBall();
  } catch (err) {
    console.error(err);
    screen('coach-start');
    toast(err.message || 'Something went wrong analysing that video.', 6000);
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
async function showResult() {
  const { video, fr, ph } = state;
  const heightIn = settings.units === 'cm' ? settings.heightIn / 2.54 : settings.heightIn;
  const A = analyse(fr, ph, { club: state.club, heightIn, ball: state.ball });
  state.A = A;
  screen('coach-result');
  $('#aiOut').hidden = true; $('#aiOut').innerHTML = '';

  const chips = $('#cpChips');
  chips.innerHTML = A.checkpoints.map((c, i) => {
    const worst = c.items.some((x) => x.status === 'work') ? 'work' : c.items.some((x) => x.status === 'ok') ? 'ok' : 'good';
    return `<button data-i="${i}"><i style="background:var(--${worst})"></i>${c.title}</button>`;
  }).join('');
  chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => state.player.showCheckpoint(+b.dataset.i)));

  const s = A.summary;
  $('#summary').innerHTML = `<h2>${esc(s.headline)}</h2><p>${esc(s.advice)}</p><span class="score">${s.score} checks on target</span>`;

  const player = new SwingPlayer($('#playCanvas'), video, fr, A, {
    onCheckpoint: (k) => renderCp(k),
    onEnd: () => { $('#playBtn').textContent = '↻'; },
  });
  player.rate = +$('#rateSel').value;
  state.player = player;
  $('#rateSel').onchange = (e) => (player.rate = +e.target.value);
  $('#playBtn').textContent = '▶';
  $('#playBtn').onclick = () => {
    if (player.playing) { player.stop(); $('#playBtn').textContent = '▶'; }
    else { $('#playBtn').textContent = '❚❚'; player.play(); }
  };
  const focus = Math.max(0, A.checkpoints.findIndex((c) => c.key === s.focus));
  await player.showCheckpoint(focus);

  $('#exportBtn').disabled = !canExport();
  $('#exportBtn').onclick = doExport;
  $('#aiBtn').onclick = doAi;
  $('#newBtn').onclick = () => { player.stop(); screen('coach-start'); };

  // Save to history
  state.id = `s_${Date.now()}`;
  state.thumbs = await checkpointImages(360, false);
  await putSwing(record()).catch(() => {});
}

function renderCp(k) {
  const c = state.A.checkpoints[k];
  document.querySelectorAll('#cpChips button').forEach((b) => b.classList.toggle('on', +b.dataset.i === k));
  $('#cpCard').innerHTML = cpHtml(c, k);
}
function cpHtml(c, k) {
  return `<h3>${c.title.toUpperCase()} <span>checkpoint ${k + 1}/4</span></h3>
  <div class="head"><span class="y">YOU</span><span class="p">TOUR PRO</span></div>
  ${c.items.map((it) => `<div class="item"><div><div class="n"><i style="background:var(--${it.status})"></i>${esc(it.name)}</div><div class="y">${esc(it.you)}</div></div><div class="p" style="padding-top:22px">${esc(it.pro)}</div></div>`).join('')}`;
}

function record() {
  const A = state.A;
  return {
    id: state.id, date: Date.now(), club: A.club, summary: A.summary, thumbs: state.thumbs, ai: state.ai || null,
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
    const text = await getCoaching({ apiKey: settings.apiKey, model: settings.model, A: state.A, images, golfer: settings.golfer });
    state.ai = text;
    out.innerHTML = md(text);
    await putSwing(record()).catch(() => {});
  } catch (e) { out.innerHTML = `<p style="color:var(--work)">${esc(e.message)}</p>`; }
  $('#aiBtn').disabled = false;
}

// ---------------- History ----------------
const fmtDate = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const val = (s, cp, name) => s.checkpoints.find((c) => c.key === cp)?.items.find((i) => i.name === name)?.value;

async function renderHistory() {
  $('#historyDetail').hidden = true; $('#historyList').hidden = false; $('#trend').hidden = false;
  const all = await listSwings().catch(() => []);
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
      <div><div class="t">${esc(s.summary.headline)}</div><div class="s">${fmtDate(s.date)} · ${esc(s.club)} · ${esc(s.summary.score)} on target${s.ai ? ' · AI reviewed' : ''}</div></div>
      <div class="mute">›</div>
    </div>`).join('');
  document.querySelectorAll('.hist').forEach((el) => el.addEventListener('click', () => showDetail(el.dataset.id)));
}

async function showDetail(id) {
  const s = await getSwing(id);
  if (!s) return;
  $('#historyList').hidden = true; $('#trend').hidden = true;
  const d = $('#historyDetail'); d.hidden = false;
  d.innerHTML = `<button class="btn" id="backBtn">‹ Back</button>
    <div class="card summary"><h2>${esc(s.summary.headline)}</h2><p>${esc(s.summary.advice)}</p><span class="score">${esc(s.summary.score)} checks on target</span><p class="mute small">${fmtDate(s.date)} · ${esc(s.club)}</p></div>
    <div class="thumbs">${(s.thumbs || []).map((t) => `<img src="${t}" alt="" />`).join('')}</div>
    ${s.checkpoints.map((c, k) => `<div class="card cp">${cpHtml(c, k)}</div>`).join('')}
    ${s.ai ? `<div class="card ai">${md(s.ai)}</div>` : ''}
    <button class="btn" id="delBtn" style="width:100%;color:var(--work)">Delete this swing</button>`;
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
window.__golfTest = { runAnalysis: async (url) => runAnalysis(await (await fetch(url)).blob()) };

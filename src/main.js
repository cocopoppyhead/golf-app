import './styles.css';
import { loadVideo, extractPose, findSwings, seek as seekSafe } from './coach/pose.js';
import { openRecorder } from './coach/recorder.js';
import { cleanTrack, findPhases } from './coach/phases.js';
import { analyse } from './coach/metrics.js';
import { analyseDTL } from './coach/dtl.js';
import { drawOverlay } from './coach/render.js';
import { SwingPlayer } from './coach/player.js';
import { exportMp4, canExport } from './coach/export.js';
import { getCoaching, md, aiFrom, aiReady, aiName, PROVIDERS, listModels } from './coach/ai.js';
import { getSettings, saveSettings, putSwing, listSwings, getSwing, deleteSwing, putMedia, getMedia, mediaKeys } from './store.js';
import { renderBag } from './bag.js';
import { isMetric } from './units.js';
import { drillFor, drillHtml } from './coach/drills.js';
import { keysHtml, getKeysText, parseKeys } from './keys.js';
import { RULES, DEFAULT_RULES } from './rounds/tiger.js';
import { renderInstall } from './install.js';
import { exportData, importData } from './backup.js';
import { isNative, nativeSend, onNative, blobToBase64 } from './native.js';
import { initRounds, roundsHome, recentRoundAggregate } from './rounds/ui.js';
import { roundTendencies } from './rounds/stats.js';
import { savePlan as savePlanX } from './coach/profile.js';
import { renderAccount } from './cloud/account.js';
import { renderScoring, practiceFromRounds } from './progress.js';
import { renderWork, workContext } from './workingon.js';
import { maybeOnboard, avatarHtml, localProfile, openProfileEditor } from './onboarding.js';
import { startSync } from './cloud/sync.js';
import { tendencies, focusProgress, updatePlan, checkIn, getPlan, setFocus, addCoachNote, coachContext, metricLabel, metricCue } from './coach/profile.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let settings = getSettings();
let state = null; // current analysis session

// ---------------- Tabs ----------------
const TITLES = { coach: 'Swing', history: 'Progress', rounds: 'Rounds', bag: 'Bag', settings: 'Settings' };
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, true)));
function showTab(name, fromNav = false) {
  // The camera button always brings you to the swing page (unless an analysis is running)
  if (name === 'coach' && fromNav && $('#coach-busy').hidden) { state?.player?.stop(); screen('coach-start'); renderRecent(); }
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $('#tabTitle').textContent = TITLES[name];
  if (name === 'history') renderHistory();
  if (name === 'settings') fillSettings();
  if (name === 'rounds') roundsHome();
  if (name === 'bag') renderBag($('#bagRoot'));
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
  if (state && !state.A) state.club = c;
  document.querySelectorAll('#clubSeg button').forEach((b) => b.classList.toggle('on', b.dataset.club === c));
}
document.querySelectorAll('#clubSeg button').forEach((b) => b.addEventListener('click', () => setClub(b.dataset.club)));
function setView(v, guessed = false) {
  if (!guessed) { settings.view = v; saveSettings(settings); }
  if (state && !state.A) state.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#viewHint').textContent = guessed ? `Looks like ${v === 'dtl' ? 'it was filmed from behind' : 'a face-on video'}. Change it if not.` : '';
}
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
setView(settings.view || 'face');
setClub(settings.club);
$('#learnBox').checked = settings.learning !== false;
$('#learnBox').addEventListener('change', (e) => { settings.learning = e.target.checked; saveSettings(settings); if (state && !state.A) state.learning = e.target.checked; });

for (const id of ['#videoInput', '#videoCapture']) $(id).addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) openVideo(file);
});
$('#seeAll').onclick = () => showTab('history');
document.addEventListener('toast', (e) => toast(e.detail));

// Recent swings on the camera page; tap to reopen the full analysis if the video is kept.
function renderKeys() {
  const t = getKeysText();
  $('#keysCard').hidden = !t.trim();
  $('#keysBody').innerHTML = keysHtml(t);
}

async function renderRecent() {
  renderKeys();
  const [all, keys] = await Promise.all([listSwings().catch(() => []), mediaKeys().catch(() => [])]);
  const has = new Set(keys);
  const plan = getPlan();
  const fs = $('#focusStrip');
  fs.hidden = !plan.focus;
  if (plan.focus) fs.innerHTML = `<span class="tag">FOCUS</span> ${esc(plan.focus.label)} <span class="mute">· ${esc(plan.focus.cue)}</span>`;
  const el = $('#recentSwings');
  if (!all.length) { el.innerHTML = '<p class="mute small">No swings yet. Record one above.</p>'; $('#seeAll').hidden = true; return; }
  $('#seeAll').hidden = false;
  el.innerHTML = all.slice(0, 5).map((s) => {
    const chk = plan.focus && !s.golfer ? checkIn(s, plan) : null;
    return `<div class="recent" data-id="${s.id}">
      <img src="${s.thumbs?.[2] || ''}" alt="" />
      <div><div class="t">${s.summary.score10 != null ? `<span class="sc10">${s.summary.score10.toFixed(1)}</span> ` : ''}${esc(s.summary.headline.replace('Biggest opportunity: ', 'Fix: '))}</div>
      <div class="s"><span class="club">${s.view === 'dtl' ? 'behind' : 'face-on'}</span><span class="club">${esc(s.club)}</span>${fmtDate(s.date)}${chk ? ` · <span style="color:var(--${chk.status})">${chk.verdict}</span>` : ''}${s.golfer ? ` · <b>${esc(s.golfer)}</b>` : s.learning === false ? ' · test' : ''}</div></div>
      <div class="${has.has(s.id) ? 'play' : 'mute'}">${has.has(s.id) ? '▶' : '›'}</div></div>`;
  }).join('');
  el.querySelectorAll('.recent').forEach((r) => r.addEventListener('click', () => (has.has(r.dataset.id) ? openSaved(r.dataset.id) : (showTab('history'), showDetail(r.dataset.id)))));
}

async function openSaved(id) {
  const [m, sw] = await Promise.all([getMedia(id), getSwing(id)]);
  if (!m || !sw) return toast('That swing is no longer saved.');
  const blob = m.blob || (m.mediaRef ? (await getMedia(m.mediaRef))?.blob : null);
  if (!blob) return toast('That video is no longer on this phone.');
  state?.player?.stop();
  if (state?.video) { URL.revokeObjectURL(state.video.src); state.video.remove(); }
  try {
    const video = await loadVideo(blob);
    Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
    document.body.appendChild(video);
    state = { video, file: m.mediaRef ? null : blob, mediaRef: m.mediaRef || null, sessionId: sw.sessionId || null, fr: m.fr, ph: m.ph, ball: m.ball, range: m.range, view: m.view || sw.view || 'face', club: sw.club, learning: sw.learning !== false, golfer: sw.golfer || null, heightIn: sw.heightIn || null, id: sw.id, date: sw.date, ai: sw.ai, thumbs: sw.thumbs };
    await showResult(true);
  } catch (e) { toast(e.message, 5000); }
}

function dropVideo() {
  state?.player?.stop();
  stopPreview();
  if (state?.video) { URL.revokeObjectURL(state.video.src); state.video.remove(); }
  state = null;
}

// ---------------- Coach: setup (finds the swing(s) for you) ----------------
let preview = null;
function stopPreview() { if (preview) { preview.on = false; preview.video.pause(); preview = null; } }
/** Loop the found swing(s) on the setup screen so you can see what will be analysed. */
async function startPreview(video, wins) {
  stopPreview();
  const c = $('#setupCanvas'), ctx = c.getContext('2d');
  const me = (preview = { on: true, video });
  let w = 0;
  const go = async () => {
    await seekTo(video, wins[w][0]);
    if (!me.on) return;
    try { video.playbackRate = 0.5; } catch {}
    await video.play().catch(() => {});
  };
  await go();
  const tick = async () => {
    if (!me.on) return;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    if (video.currentTime >= wins[w][1] || video.ended) {
      video.pause(); await new Promise((r) => setTimeout(r, 500));
      w = (w + 1) % wins.length; await go();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function openVideo(file) {
  dropVideo();
  screen('coach-setup');
  $('#setupScan').hidden = false; $('#setupBar').style.width = '0%'; $('#setupMsg').textContent = 'Opening the video…';
  $('#setupFound').innerHTML = ''; $('#viewHint').textContent = '';
  $('#setupGo').disabled = true; $('#setupGo').hidden = false; $('#setupGo').textContent = 'Analyse swing';
  $('#setupManual').textContent = 'Pick the swing myself';
  setClub(settings.club); $('#learnBox').checked = settings.learning !== false;
  setWho('me');
  listSwings().then((all) => { $('#friendNames').innerHTML = [...new Set(all.map((s) => s.golfer).filter(Boolean))].map((n) => `<option value="${esc(n)}"></option>`).join(''); }).catch(() => {});
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === (settings.view || 'face')));
  let video;
  try {
    video = await loadVideo(file);
    // iOS needs the element in the DOM to decode frames reliably
    Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
    document.body.appendChild(video);
  } catch (err) {
    console.error(err); screen('coach-start'); return toast(err.message || 'Could not open that video.', 6000);
  }
  const me = (state = { video, file, club: settings.club, view: settings.view || 'face', ball: null, learning: settings.learning !== false, wins: [] });
  const c = $('#setupCanvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  await seekTo(video, Math.min(0.5, video.duration / 2)); ctx.drawImage(video, 0, 0);
  let scan = { windows: [], view: null };
  try {
    let n = 0;
    scan = await findSwings(video, {
      quality: settings.quality,
      onProgress: (p, m) => {
        if (state !== me) return;
        $('#setupBar').style.width = `${Math.round(p * 100)}%`; $('#setupMsg').textContent = m;
        if (++n % 2 === 0) ctx.drawImage(video, 0, 0); // live look at what's being scanned
      },
    });
  } catch (err) { console.warn('scan failed', err); }
  if (state !== me) return; // cancelled or another video opened
  $('#setupScan').hidden = true;
  if (scan.view) setView(scan.view, true);
  let wins = scan.windows;
  const dur = video.duration;
  if (!wins.length && dur <= 6) wins = [[0, dur]];
  me.wins = wins;
  if (!wins.length) {
    $('#setupFound').innerHTML = `Couldn't spot a full swing<span class="mute">Check your whole body and the club at the top are in frame, or pick the swing yourself.</span>`;
    $('#setupGo').hidden = true;
    $('#setupManual').textContent = 'Pick the swing myself ›';
    return;
  }
  const len = wins.reduce((a, w) => a + w[1] - w[0], 0);
  $('#setupFound').innerHTML = wins.length === 1
    ? `✓ Swing found<span class="mute">Address to finish, ${len.toFixed(1)} s. Playing below.</span>`
    : `✓ ${wins.length} swings found<span class="mute">Each one gets its own review. Playing them in turn below.</span>`;
  $('#setupGo').textContent = wins.length === 1 ? 'Analyse swing' : `Analyse all ${wins.length} swings`;
  $('#setupGo').disabled = false;
  startPreview(video, wins);
}

// Whose swing: yours (counts toward your profile) or a friend's (kept separate)
function setWho(who) {
  document.querySelectorAll('#whoSeg button').forEach((b) => b.classList.toggle('on', b.dataset.who === who));
  $('#friendRow').hidden = who !== 'friend';
  $('#learnRow').hidden = who === 'friend';
  if (who === 'friend') { $('#friendHt').placeholder = `Height in ${isMetric() ? 'cm' : 'inches'} (optional)`; setTimeout(() => $('#friendName').focus(), 50); }
}
document.querySelectorAll('#whoSeg button').forEach((b) => b.addEventListener('click', () => setWho(b.dataset.who)));
function readWho() {
  if (!state) return true;
  const friend = !$('#friendRow').hidden;
  if (!friend) { state.golfer = null; state.heightIn = null; state.learning = $('#learnBox').checked; return true; }
  const name = $('#friendName').value.trim();
  if (!name) { toast('Add your friend\'s name.'); $('#friendName').focus(); return false; }
  const h = parseFloat($('#friendHt').value);
  state.golfer = name; state.learning = false;
  state.heightIn = h > 0 ? (isMetric() ? h / 2.54 : h) : null;
  if (state.heightIn && (state.heightIn < 48 || state.heightIn > 90)) state.heightIn = null;
  return true;
}
$('#setupGo').onclick = () => {
  if (!state?.wins?.length) return;
  if (!readWho()) return;
  stopPreview();
  if (state.wins.length === 1) runAnalysis(state.wins[0]);
  else runSession(state.file, { video: state.video, wins: state.wins });
};
$('#setupManual').onclick = () => { if (!state?.video || !readWho()) return; stopPreview(); showTrim(); };
$('#setupCancel').onclick = () => { dropVideo(); screen('coach-start'); renderRecent(); };

async function runSession(file, pre = null) {
  const keep = pre ? { view: state.view, club: state.club, learning: state.learning, golfer: state.golfer || null, heightIn: state.heightIn || null } : null;
  if (!pre) dropVideo();
  screen('coach-busy');
  const setP = (p, msg) => { $('#busyBar').style.width = `${Math.round(p * 100)}%`; if (msg) $('#busyMsg').textContent = msg; };
  setP(0, 'Loading the pose model…');
  try {
    let video = pre?.video, wins = pre?.wins;
    if (!pre) {
      video = await loadVideo(file);
      Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '2px', height: '2px', opacity: 0 });
      document.body.appendChild(video);
      const scan = await findSwings(video, { quality: settings.quality, onProgress: (p, m) => setP(p * 0.3, m) });
      wins = scan.windows;
    }
    if (!wins.length) throw new Error('No full swings found. Make sure your whole body and the top of the swing are in frame.');
    const view = keep?.view || settings.view || 'face', club = keep?.club || settings.club, learning = keep ? keep.learning !== false : settings.learning !== false;
    const swings = [];
    for (const [i, w] of wins.entries()) {
      try {
        const raw = await extractPose(video, { quality: settings.quality, range: w, dense: true, onProgress: (p) => setP((pre ? 0.05 : 0.3) + (pre ? 0.85 : 0.6) * ((i + p) / wins.length), `Reviewing swing ${i + 1} of ${wins.length}…`) });
        const fr = cleanTrack(raw.frames);
        swings.push({ fr, ph: findPhases(fr, { handedness: settings.handedness }), range: w });
      } catch (e) { console.warn('swing skipped', e); }
    }
    if (!swings.length) throw new Error('Found movement but no clear swings. Try again with the whole body in frame.');
    // One ball tap covers the whole session (face-on); the camera doesn't move.
    let ball = null;
    if (view === 'face') {
      state = { video, fr: swings[0].fr, ph: swings[0].ph, view, club, ball: null, golfer: keep?.golfer || null, heightIn: keep?.heightIn || null };
      ball = await new Promise((resolve) => askBall(resolve));
    }
    screen('coach-busy'); setP(0.92, 'Saving…');
    const sessionId = `rs_${Date.now()}`;
    if (settings.keepVideos !== false) await putMedia({ id: sessionId, blob: file }).catch(() => {});
    for (const [i, s] of swings.entries()) {
      state = { video, file: null, mediaRef: settings.keepVideos !== false ? sessionId : null, sessionId, fr: s.fr, ph: s.ph, range: s.range, ball, view, club, learning, golfer: keep?.golfer || null, heightIn: keep?.heightIn || null, id: `${sessionId}_${i + 1}`, date: Date.now() + i, player: null };
      computeA();
      state.thumbs = await checkpointImages(360, false);
      await putSwing(record()).catch(() => {});
      await saveMedia();
      if (learning) updatePlan(await listSwings().catch(() => []), record());
    }
    renderSession(sessionId);
  } catch (err) {
    console.error(err); screen('coach-start'); toast(err.message || 'Could not review that session.', 7000);
  }
}

async function renderSession(sessionId) {
  const all = (await listSwings().catch(() => [])).filter((s) => s.sessionId === sessionId).sort((a, b) => a.date - b.date);
  if (!all.length) { screen('coach-start'); return renderRecent(); }
  const scores = all.map((s) => s.summary.score10 ?? 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best = all[scores.indexOf(Math.max(...scores))];
  const counts = {};
  all.forEach((s) => { const k = s.summary.priority?.key; if (k) counts[k] = (counts[k] || 0) + 1; });
  const topKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const plan = getPlan();
  const d = topKey ? (drillFor(topKey) || drillFor(`dtl:${topKey}`)) : null;
  $('#coach-session').innerHTML = `
    <div class="card"><div class="scorerow">${scoreRing(Math.round(avg * 10) / 10)}<div><h2>${all[0].golfer ? `${esc(all[0].golfer)}'s session` : 'Range session'} · ${all.length} swing${all.length > 1 ? 's' : ''}</h2>
      <p>Average ${avg.toFixed(1)}/10 · best: swing ${all.indexOf(best) + 1} (${best.summary.score10?.toFixed(1)})</p>
      ${topKey ? `<p class="mute small">Showed up most: ${esc(topKey.split(':').reverse().join(' at ').toLowerCase())} (${counts[topKey]} of ${all.length})</p>` : ''}</div></div>
      <button class="btn" id="speakBtn" style="width:100%;margin-top:10px">🔊 Read it out</button></div>
    ${all.map((s, i) => { const chk = plan.focus && !s.golfer ? checkIn(s, plan) : null; return `<div class="recent" data-id="${s.id}"><img src="${s.thumbs?.[2] || ''}" alt="" />
      <div><div class="t"><span class="sc10">${s.summary.score10?.toFixed(1) ?? '–'}</span> Swing ${i + 1}</div><div class="s">${esc(s.summary.headline.replace('Biggest opportunity: ', 'Fix: '))}${chk ? ` · <span style="color:var(--${chk.status})">${chk.verdict}</span>` : ''}</div></div><div class="play">▶</div></div>`; }).join('')}
    ${d ? `<div class="card"><div class="lbl">Take this to your next session</div>${drillHtml(d, esc)}</div>` : ''}
    <button class="btn" id="sessDone" style="width:100%">Done</button>`;
  screen('coach-session');
  document.querySelectorAll('#coach-session .recent').forEach((r) => r.addEventListener('click', () => openSaved(r.dataset.id)));
  $('#sessDone').onclick = () => { screen('coach-start'); renderRecent(); };
  $('#speakBtn').onclick = () => {
    if (!window.speechSynthesis) return toast('Speech not available on this device.');
    const lines = [`${all.length} swings. Average ${avg.toFixed(1)} out of 10.`, ...all.map((s, i) => `Swing ${i + 1}: ${s.summary.score10?.toFixed(1)}. ${s.summary.advice.split('.')[0]}.`)];
    if (d) lines.push(`Next session, work on: ${d.title}. ${d.feel}.`);
    speechSynthesis.cancel(); lines.forEach((t) => speechSynthesis.speak(new SpeechSynthesisUtterance(t)));
  };
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
    Object.assign(state, { fr, ph, raw, range, ball: null });
    if (state.view === 'dtl') await showResult(); else await askBall();
  } catch (err) {
    console.error(err);
    if (video.duration > 4) { await showTrim(); toast(`${err.message || 'Could not analyse that.'} Try trimming tighter around one swing.`, 7000); }
    else { screen('coach-start'); toast(err.message || 'Something went wrong analysing that video.', 6000); }
  }
}

// ---------------- Coach: ball tap ----------------
async function askBall(resolve = null) {
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
  $('#ballOk').onclick = () => (resolve ? resolve(state.ball) : showResult());
  $('#ballSkip').onclick = () => { state.ball = null; resolve ? resolve(null) : showResult(); };
  screen('coach-ball');
}

const seekTo = (v, t) => seekSafe(v, t);

// ---------------- Coach: result ----------------
function computeA() {
  const heightIn = state.heightIn || settings.heightIn;
  state.A = state.view === 'dtl'
    ? analyseDTL(state.fr, state.ph, { club: state.club, heightIn })
    : analyse(state.fr, state.ph, { club: state.club, heightIn, ball: state.ball });
  // address / top / impact poses for the fixed position lines on the video
  const { fr, ph } = state;
  state.A.refs = { address: fr[ph.address].lm, top: fr[ph.top].lm, impact: fr[ph.impact].lm };
  state.A.refFrames = { address: ph.address, top: ph.top, impact: ph.impact };
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
  $('#summary').innerHTML = `<div class="scorerow">${scoreRing(s.score10)}<div><h2>${esc(s.headline)}</h2><p>${esc(s.advice)}</p><span class="score">${s.score} checks on target</span></div></div>`;
}

async function showResult(reopen = false) {
  const { video, fr } = state;
  const A = computeA();
  screen('coach-result');
  if (reopen && state.ai) { $('#aiOut').hidden = false; $('#aiOut').innerHTML = md(state.ai); }
  else { $('#aiOut').hidden = true; $('#aiOut').innerHTML = ''; }
  if (!reopen) state.ai = null;

  const scrub = $('#scrub');
  let dragging = false;
  const setFill = (t) => { const p = (t - player.start) / ((player.end - player.start) || 1); scrub.style.setProperty('--fill', `${Math.max(0, Math.min(1, p)) * 100}%`); };
  const player = new SwingPlayer($('#playCanvas'), video, fr, A, {
    onCheckpoint: (k, passing) => (passing ? highlightCp(k) : renderCp(k)),
    onTime: (t) => { if (!dragging) scrub.value = t; setFill(t); },
    onState: (on) => { $('#playBtn').textContent = on ? '❚❚' : '▶'; $('#playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play'); },
  });
  state.player = player;
  player.rate = +(settings.playRate || 0.25);
  player.stopAtCp = !!settings.cpStop;
  renderChipsAndSummary();

  // Scrub bar: drag to move frame by frame; checkpoint dots jump straight there.
  const syncScrub = () => {
    scrub.min = player.start; scrub.max = player.end; scrub.step = 0.001;
    const span = (player.end - player.start) || 1;
    $('#cpMarks').innerHTML = state.A.checkpoints.map((c, i) => {
      const worst = c.items.some((x) => x.status === 'work') ? 'work' : c.items.some((x) => x.status === 'ok') ? 'ok' : 'good';
      return `<button data-i="${i}" style="left:${((player.cpTimes[i] - player.start) / span) * 100}%" aria-label="${c.title}"><i style="background:var(--${worst})"></i><span>${c.title}</span></button>`;
    }).join('');
    $('#cpMarks').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => player.showCheckpoint(+b.dataset.i)));
  };
  syncScrub();
  state.syncScrub = syncScrub;
  scrub.onpointerdown = () => { dragging = true; player.stop(); };
  scrub.oninput = () => { player.stop(); player.seek(+scrub.value); setFill(+scrub.value); };
  scrub.onchange = () => { dragging = false; const k = player.cpAt(+scrub.value); if (k >= 0) { player.cpShown = k; renderCp(k); } };
  scrub.onpointerup = scrub.onpointercancel = () => { dragging = false; };

  const toggle = () => (player.playing ? player.stop() : player.play());
  $('#playBtn').onclick = toggle;
  $('#playCanvas').onclick = () => { toggle(); $('#tapNote').classList.add('gone'); };
  $('#tapNote').classList.remove('gone');
  setTimeout(() => $('#tapNote').classList.add('gone'), 3500);
  document.querySelectorAll('#rateSeg button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.r === player.rate);
    b.onclick = () => {
      player.setRate(+b.dataset.r); settings.playRate = +b.dataset.r; saveSettings(settings);
      document.querySelectorAll('#rateSeg button').forEach((x) => x.classList.toggle('on', x === b));
      if (!player.playing) player.play();
    };
  });
  $('#cpStop').checked = player.stopAtCp;
  $('#cpStop').onchange = (e) => { player.stopAtCp = e.target.checked; settings.cpStop = e.target.checked; saveSettings(settings); };
  $('#nudgeBack').onclick = () => nudge(-1);
  $('#nudgeFwd').onclick = () => nudge(1);

  $('#exportBtn').disabled = !canExport();
  $('#exportBtn').onclick = doExport;
  $('#aiBtn').onclick = doAi;
  $('#newBtn').textContent = state.sessionId ? '‹ Session' : 'New swing';
  $('#newBtn').onclick = () => { player.stop(); if (state.sessionId) renderSession(state.sessionId); else { screen('coach-start'); renderRecent(); } };

  // The card shows your priority checkpoint; the swing loops from address to finish above it.
  const focus = Math.max(0, A.checkpoints.findIndex((c) => c.key === A.summary.focus));
  player.cpShown = focus; renderCp(focus);
  if (!reopen) {
    // Save to history (+ video and tracking so it can be reopened) before playback takes the video
    state.id = `s_${Date.now()}`; state.date = Date.now();
    state.thumbs = await checkpointImages(360, false);
    await putSwing(record()).catch(() => {});
    await saveMedia();
  }
  await player.seek(player.start);
  player.play();
  await refreshCoachCard(!reopen);
}

/** The "Coach check-in" card under the summary: this swing vs your current focus. */
async function refreshCoachCard(runPlan) {
  const el = $('#coachCheck');
  if (state.golfer) {
    el.innerHTML = `<h3>${esc(state.golfer)}'s swing</h3><p class="mute">Saved under their name. Not counted toward your profile.</p>${priorityHtml(null)}`;
    return;
  }
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
  if (event && /^Fixed/.test(event)) celebrate();
  if (plan.focus && check) {
    const p = focusProgress(swings, plan);
    html += `<div class="focus"><span class="tag">FOCUS</span> ${esc(plan.focus.label)}</div>
      <p class="cue">${esc(plan.focus.cue)}.</p>
      <p><b style="color:var(--${check.status})">${check.verdict}</b> on this swing: ${esc(check.text.split(': ').slice(1).join(': '))}</p>
      ${dots(p)}${streakHtml(p)}`;
  } else if (!plan.focus) {
    const need = Math.max(0, 3 - t.swings);
    html += `<p class="mute">${need ? `${need} more learning swing${need > 1 ? 's' : ''} and I'll start spotting your tendencies and set a focus.` : 'No recurring fault across your recent swings. Nice.'}</p>`;
  }
  html += priorityHtml(plan);
  el.innerHTML = html;
}

/** Your one priority for this swing (current focus, else this swing's biggest fault) + its drill. */
function priorityHtml(plan) {
  const key = plan?.focus?.key || state.A?.summary.priority?.key;
  if (!key) return '';
  const d = drillFor(key) || drillFor(`dtl:${key}`);
  return d ? `<div class="priority"><div class="lbl" style="margin-top:12px">${plan?.focus ? 'Work on this' : 'Priority for this swing'}</div>${drillHtml(d, esc)}</div>` : '';
}

function scoreRing(v) {
  if (v == null) return '';
  const pct = Math.max(0, Math.min(1, v / 10));
  const col = v >= 8 ? 'var(--good)' : v >= 6 ? 'var(--ok)' : 'var(--work)';
  return `<div class="ring" style="--p:${pct};--c:${col}"><b>${v.toFixed(1)}</b><span>/10</span></div>`;
}

function streakHtml(p) {
  if (!p?.values.length) return '';
  let n = 0;
  for (let i = p.values.length - 1; i >= 0 && p.values[i].status === 'good'; i--) n++;
  return n >= 2 ? `<p class="streak">🔥 ${n} in a row on target</p>` : '';
}

function celebrate() {
  const c = document.createElement('div'); c.className = 'confetti';
  c.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * 0.4}s;background:${['#3ddc84', '#ffd23f', '#ff4fa3', '#3ec8ff'][i % 4]}"></i>`).join('');
  document.body.appendChild(c); setTimeout(() => c.remove(), 2600);
  navigator.vibrate?.([60, 40, 120]);
}

function dots(p) {
  if (!p?.values.length) return '';
  const last = p.values.slice(-10);
  return `<div class="dots">${last.map((v) => `<i title="${esc(v.you)}" style="background:var(--${v.status})"></i>`).join('')}</div>
    <p class="mute small">${p.good} of last ${p.lastN} on target · counts as fixed at 4 of 5</p>`;
}

async function saveMedia() {
  if (settings.keepVideos === false || (!state.file && !state.mediaRef)) return;
  const { fr, ph, ball, range } = state;
  const m = { id: state.id, fr, ph: { ...ph }, ball, range, view: state.view };
  if (state.mediaRef) m.mediaRef = state.mediaRef; else m.blob = state.file;
  await putMedia(m).catch((e) => console.warn('video not kept', e));
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
  p.refresh(A);
  renderChipsAndSummary();
  state.syncScrub?.();
  await p.showCheckpoint(k);
  state.ai = null; $('#aiOut').hidden = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { state.thumbs = await checkpointImages(360, false); await putSwing(record()).catch(() => {}); await saveMedia(); refreshCoachCard(false); }, 1500);
}

function highlightCp(k) {
  document.querySelectorAll('#cpChips button, #cpMarks button').forEach((b) => b.classList.toggle('on', +b.dataset.i === k));
}
function renderCp(k) {
  const c = state.A.checkpoints[k];
  highlightCp(k);
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
    id: state.id, date: state.date || Date.now(), sessionId: state.sessionId || null, learning: !state.golfer && state.learning !== false, golfer: state.golfer || null, heightIn: state.golfer ? state.heightIn || null : undefined, view: state.view || 'face', club: A.club, summary: A.summary, thumbs: state.thumbs, ai: state.ai || null,
    checkpoints: A.checkpoints.map((c) => ({ key: c.key, title: c.title, items: c.items.map(({ name, you, pro, status, value }) => ({ name, you, pro, status, value })) })),
  };
}

/** JPEGs of the 4 checkpoints with overlay (+ card), at a given width. */
async function checkpointImages(width, card) {
  const { video, fr, A } = state;
  const p = state.player && state.player.video === video ? state.player : null;
  const wasPlaying = p?.playing;
  p?.stop();
  const k = width / video.videoWidth;
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  const out = document.createElement('canvas'); out.width = Math.round(width); out.height = Math.round(video.videoHeight * k);
  const octx = out.getContext('2d');
  const imgs = [];
  for (const [i, cp] of A.checkpoints.entries()) {
    await seekTo(video, fr[cp.frame].t);
    ctx.drawImage(video, 0, 0);
    drawOverlay(ctx, A, fr[cp.frame].lm, { cp, card, cpIndex: i, frame: cp.frame });
    octx.drawImage(c, 0, 0, out.width, out.height);
    imgs.push(out.toDataURL('image/jpeg', 0.8));
  }
  if (p && wasPlaying) p.play();
  else if (p) await p.showCheckpoint(p.cpShown >= 0 ? p.cpShown : 0);
  return imgs;
}

async function doExport() {
  const btn = $('#exportBtn'); btn.disabled = true;
  state.player.stop();
  try {
    const blob = await exportMp4(state.video, state.fr, state.A, { onProgress: (p) => (btn.textContent = `Saving ${Math.round(p * 100)}%`) });
    const name = `swing-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
    const file = new File([blob], name, { type: 'video/mp4' });
    if (isNative()) {
      btn.textContent = 'Opening share…';
      nativeSend({ type: 'share.file', name, mime: 'video/mp4', b64: await blobToBase64(blob) });
    } else if (navigator.canShare?.({ files: [file] })) {
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
  if (!aiReady(settings)) { toast('Add a Claude, ChatGPT or Gemini key in Settings to use the AI coach.'); showTab('settings'); return; }
  out.hidden = false; out.innerHTML = '<p class="mute">Coach is looking at your swing…</p>';
  $('#aiBtn').disabled = true;
  try {
    const images = await checkpointImages(560, true);
    const swings = (await listSwings().catch(() => [])).filter((s) => s.id !== state.id);
    const history = state.learning && !state.golfer ? coachContext(swings, await recentRoundAggregate()) : '';
    const golfer = state.golfer
      ? `This is ${state.golfer}'s swing (a friend of the app owner). Coach ${state.golfer} directly; no history on file.`
      : [settings.golfer, workContext(), settings.keys ? `Their own swing keys/notes (use their language): ${settings.keys.replace(/\n+/g, ' | ')}` : ''].filter(Boolean).join('. ');
    const { text, meta } = await getCoaching({ ...aiFrom(settings), A: state.A, images, golfer, history });
    state.ai = text;
    let extra = '';
    if (state.learning && !state.golfer && meta) {
      if (meta.note) addCoachNote(String(meta.note).slice(0, 300));
      const valid = state.A.checkpoints.flatMap((c) => c.items.map((i) => `${c.key}:${i.name}`));
      const cur = getPlan().focus?.key;
      if (meta.focus && valid.includes(meta.focus) && meta.focus !== cur) {
        const plan = setFocus(meta.focus); plan.focus.setBy = 'AI coach'; savePlanX(plan);
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
  const RA = await recentRoundAggregate();
  const rt = roundTendencies(RA);
  html += `<h3 style="margin-top:16px">On the course <span class="mute small">${RA ? `last ${RA.rounds} round${RA.rounds > 1 ? 's' : ''}` : ''}</span></h3>`;
  html += rt.length ? rt.slice(0, 4).map((x) => `<div class="tend"><div><b>${esc(x.text)}</b><div class="mute small">${esc(x.detail)}</div></div></div>`).join('')
    : `<p class="mute small">${RA ? 'No clear on-course pattern yet.' : 'Log rounds in the Rounds tab and on-course patterns show up here next to your swing ones.'}</p>`;
  el.innerHTML = html;
  $('#focusSel')?.addEventListener('change', (e) => {
    if (e.target.value) setFocus(e.target.value);
    else { setFocus(null); updatePlan(all, null); }
    renderCoachPanel(all);
  });
}

// Progress has two halves: Scoring (rounds) and Practice (what to work on: rounds + swing coach)
let progTab = 'scoring';
document.querySelectorAll('#progSeg button').forEach((b) => b.addEventListener('click', () => { progTab = b.dataset.p; renderHistory(); }));
async function renderHistory() {
  document.querySelectorAll('#progSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === progTab));
  $('#progSeg').hidden = false;
  $('#progScoring').hidden = progTab !== 'scoring'; $('#progPractice').hidden = progTab !== 'practice';
  if (progTab === 'scoring') { $('#historyDetail').hidden = true; return renderScoring($('#progScoring')); }
  renderWork($('#rangeWork'), { toast });
  practiceFromRounds().then((h) => { $('#practiceRounds').innerHTML = h; }).catch(() => {});
  $('#historyDetail').hidden = true; $('#historyList').hidden = false; $('#trend').hidden = false; $('#coachPanel').hidden = false;
  const all = await listSwings().catch(() => []);
  const mine = all.filter((s) => !s.golfer);
  renderCoachPanel(mine);
  if (!all.length) {
    $('#trend').innerHTML = '<h2>No swings yet</h2><p class="mute">Analyse a swing in Coach and it lands here, so you can track the numbers over time.</p>';
    $('#historyList').innerHTML = '';
    return;
  }
  // swing score over time, and the face-on numbers (implausible values = tracking glitch, shown as –)
  const face = mine.filter((s) => s.view !== 'dtl').slice(0, 8);
  const sc = mine.slice(0, 15).map((s) => s.summary.score10).filter((v) => v != null).reverse();
  const W = 280, H = 44, mn = Math.min(...sc, 0), mx = Math.max(...sc, 10);
  const line = sc.length > 1 ? `<svg viewBox="0 0 ${W} ${H}" class="spark"><polyline points="${sc.map((v, i) => `${(i / (sc.length - 1)) * W},${H - 4 - ((v - mn) / (mx - mn || 1)) * (H - 8)}`).join(' ')}" fill="none" stroke="var(--acc)" stroke-width="2.5"/></svg>` : '';
  const f = (v, d = 1) => (v == null || Math.abs(v) > (d === 0 ? 60 : 20) ? '–' : d === 1 && isMetric() ? Math.round(v * 2.54) : (+v).toFixed(d));
  const rows = face.map((s) => `<tr><td>${new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td><td><b>${s.summary.score10 != null ? s.summary.score10.toFixed(1) : '–'}</b></td><td>${f(val(s, 'top', 'Head'))}</td><td>${f(val(s, 'impact', 'Hips'))}</td><td>${f(val(s, 'impact', 'Spine tilt'), 0)}${f(val(s, 'impact', 'Spine tilt'), 0) === '–' ? '' : '°'}</td></tr>`).join('');
  $('#trend').innerHTML = `<h2>Swing trend</h2>${line ? `<p class="mute small" style="margin:0">Swing score, last ${sc.length} swings</p>${line}` : ''}
    ${rows ? `<div class="trend"><table><tr><th></th><th>Score</th><th>Head move @top</th><th>Hip shift @impact</th><th>Spine tilt @impact</th></tr>${rows}</table></div>
    <p class="mute small">Face-on swings. ${isMetric() ? 'cm' : 'Inches'}; + = toward the target. Tour: hips shifted ${isMetric() ? '+3 to +15' : '+1 to +6'} at impact. – = tracking glitch.</p>` : ''}`;
  $('#historyList').innerHTML = all.map((s) => `
    <div class="hist" data-id="${s.id}">
      <img src="${s.thumbs?.[2] || ''}" alt="" />
      <div><div class="t">${esc(s.summary.headline)}</div><div class="s">${fmtDate(s.date)} · ${esc(s.club)} · ${esc(s.summary.score)} on target${s.ai ? ' · AI reviewed' : ''}${s.golfer ? ` · ${esc(s.golfer)}'s swing` : s.learning === false ? ' · test swing' : ''}</div></div>
      <div class="mute">›</div>
    </div>`).join('');
  document.querySelectorAll('.hist').forEach((el) => el.addEventListener('click', () => showDetail(el.dataset.id)));
}

async function showDetail(id) {
  const s = await getSwing(id);
  if (!s) return;
  $('#progPractice').hidden = true; $('#progSeg').hidden = true;
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
  f.theme.value = settings.theme || 'dark';
  f.system.value = settings.system || 'imperial';
  f.height.value = f.system.value === 'metric' ? Math.round(settings.heightIn * 2.54) : Math.round(settings.heightIn * 10) / 10;
  $('#hUnit').textContent = f.system.value === 'metric' ? 'cm' : 'in';
  renderInstall($('#installRow'), true);
  renderAccount($('#accountRow'), { toast, onChange: afterAccountChange });
  f.handedness.value = settings.handedness; f.quality.value = settings.quality;
  f.keepVideos.checked = settings.keepVideos !== false;
  f.keys.value = settings.keys || '';
  const on = new Set(settings.roundRules || DEFAULT_RULES);
  $('#rulesBoxes').innerHTML = Object.entries(RULES).map(([id, r]) => `<label class="check small"><input type="checkbox" data-rule="${id}" ${on.has(id) ? 'checked' : ''}/> ${esc(r.label)}</label>`).join('');
  f.apiKey.value = settings.apiKey || ''; f.openaiKey.value = settings.openaiKey || ''; f.geminiKey.value = settings.geminiKey || ''; f.golfer.value = settings.golfer;
  f.aiProvider.value = aiFrom(settings).provider; showProvider();
  $('#savedMsg').hidden = true;
}
// AI provider: show its key field and the models that key can use
function showProvider() {
  const f = $('#settingsForm'); const prov = f.aiProvider.value; const P = PROVIDERS[prov];
  document.querySelectorAll('[data-prov]').forEach((el) => (el.hidden = el.dataset.prov !== prov));
  const cur = settings[P.modelField] || P.def;
  f.aiModel.innerHTML = cur ? `<option value="${esc(cur)}">${esc(cur)}</option>` : '<option value="">Best available (auto)</option>';
  if (f[P.keyField].value.trim() && prov !== 'claude') loadModels();
}
async function loadModels() {
  const f = $('#settingsForm'); const prov = f.aiProvider.value; const P = PROVIDERS[prov];
  const key = f[P.keyField].value.trim();
  if (!key) { $('#aiModelHint').textContent = `Add your ${P.short} key first.`; return; }
  if (prov === 'claude') { const cur = f.aiModel.value || P.def; f.aiModel.innerHTML = [...new Set([cur, 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'])].map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join(''); return; }
  $('#aiModelHint').textContent = 'Checking your key…';
  try {
    const ids = await listModels(prov, key);
    const cur = settings[P.modelField];
    f.aiModel.innerHTML = ids.map((m, i) => `<option value="${esc(m)}" ${(cur ? m === cur : i === 0) ? 'selected' : ''}>${esc(m)}${i === 0 ? ' (recommended)' : ''}</option>`).join('');
    $('#aiModelHint').textContent = `Key works. ${ids.length} models available.`;
  } catch (e) { $('#aiModelHint').textContent = `That key didn't work: ${e.message}`; }
}
$('#settingsForm').aiProvider.addEventListener('change', showProvider);
$('#aiModels').addEventListener('click', loadModels);
for (const n of ['openaiKey', 'geminiKey']) $('#settingsForm')[n].addEventListener('change', loadModels);
$('#settingsForm').theme.addEventListener('change', (e) => { settings.theme = e.target.value; saveSettings(settings); applyTheme(); });
$('#settingsForm').system.addEventListener('change', (e) => {
  const f = $('#settingsForm'); const h = parseFloat(f.height.value);
  const m = e.target.value === 'metric';
  if (!isNaN(h)) f.height.value = m ? Math.round(h * 2.54) : Math.round((h / 2.54) * 10) / 10;
  $('#hUnit').textContent = m ? 'cm' : 'in';
});
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const h = parseFloat(f.height.value);
  settings = {
    ...settings,
    theme: f.theme.value, system: f.system.value, heightIn: isNaN(h) ? settings.heightIn : f.system.value === 'metric' ? h / 2.54 : h,
    handedness: f.handedness.value, quality: f.quality.value, keepVideos: f.keepVideos.checked,
    keys: f.keys.value, roundRules: [...document.querySelectorAll('[data-rule]')].filter((x) => x.checked).map((x) => x.dataset.rule),
    apiKey: f.apiKey.value.trim(), openaiKey: f.openaiKey.value.trim(), geminiKey: f.geminiKey.value.trim(), aiProvider: f.aiProvider.value, golfer: f.golfer.value.trim(),
    [PROVIDERS[f.aiProvider.value].modelField]: f.aiModel.value || PROVIDERS[f.aiProvider.value].def,
  };
  saveSettings(settings);
  applyTheme();
  $('#savedMsg').hidden = false;
});

// ---------------- Theme ----------------
export function applyTheme(t = settings.theme || 'dark') {
  const mq = matchMedia('(prefers-color-scheme: light)');
  const real = t === 'system' ? (mq.matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = real;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', real === 'light' ? '#f3f5f9' : '#0b1120');
  mq.onchange = () => (settings.theme === 'system' ? applyTheme('system') : null);
}
applyTheme();

// ---------------- Rounds ----------------
initRounds($('#roundsRoot'), {
  settings: () => settings,
  toast,
  saveSetting: (k, v) => { settings[k] = v; saveSettings(settings); },
});

$('#exportBtn2').onclick = async () => {
  const blob = await exportData();
  const name = `golf-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isNative()) return nativeSend({ type: 'share.file', name, mime: 'application/json', b64: await blobToBase64(blob) });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
};
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
  try {
    const r = await importData(await f.text());
    settings = getSettings(); fillSettings(); applyTheme(); renderRecent();
    toast(`Imported: ${r.settings.join(', ') || 'no settings'}${r.records ? ` + ${r.records} records` : ''}`, 5000);
  } catch (err) { toast(err.message, 5000); }
});

$('#buildTag').textContent = `App version ${__BUILD__} UTC`;

startSync();

// Header avatar + first-login setup
function renderHeaderAvatar() {
  const p = localProfile();
  const el = $('#hdrAvatar');
  el.hidden = !(p.name || p.avatar);
  el.innerHTML = avatarHtml(p, 'hav');
}
$('#hdrAvatar').onclick = () => showTab('settings');
function afterAccountChange() {
  settings = getSettings(); renderRecent(); renderHeaderAvatar();
  maybeOnboard({ toast, onDone: () => { settings = getSettings(); fillSettings(); renderHeaderAvatar(); renderAccount($('#accountRow'), { toast, onChange: afterAccountChange }); } });
}
renderHeaderAvatar();
setTimeout(afterAccountChange, 1200);

window.addEventListener('golf-synced', () => { settings = getSettings(); });

// ---------------- PWA ----------------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !state) { reloaded = true; location.reload(); } });
}

renderRecent();
renderInstall($('#installBanner'));
onNative('share.error', (m) => toast(m.text, 5000));
if (isNative()) document.documentElement.classList.add('native');

// Test hook: lets automated tests feed a video URL
window.__golfTest = { open: async (url) => openVideo(await (await fetch(url)).blob()), session: async (url) => runSession(await (await fetch(url)).blob()), state: () => state, onboard: () => openProfileEditor({ first: true, toast, onDone: () => { settings = getSettings(); renderHeaderAvatar(); } }), scan: async (url) => { const v = await loadVideo(await (await fetch(url)).blob()); document.body.appendChild(v); const r = await findSwings(v, {}); v.remove(); return { ...r, ratio: findSwings.lastRatio, dur: v.duration }; } };

// The live R10 screen: connect, pick the club and ball, hit. Each shot shows as it lands and is saved to
// the launch data straight away (one session per club), so the Bag, the club pages and the coach see it.
import { getSettings, saveSettings, putLaunch } from '../store.js';
import { getBag } from '../bag.js';
import { simulate } from '../flight.js';
import { dist as D, du } from '../units.js';
import { KEY_ORDER, clubSummary, tilesHtml, takesBlock } from '../launch.js';
import { bindDrillCards } from '../drills.js';
import { shotRow } from './protocol.js';
import { connectR10, r10Supported } from './connect.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => `lm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const n1 = (v) => (v == null ? '–' : Math.round(v * 10) / 10);
const n0 = (v) => (v == null ? '–' : Math.round(v));

let conn = null; // stays connected while the app is open, across opening and closing the screen

/** The settings row: what's paired, and the button that opens the live screen. */
export function renderR10Row(el, { toast = () => {} } = {}) {
  if (!el) return;
  const s = getSettings();
  el.innerHTML = r10Supported()
    ? `<button type="button" class="btn primary" style="width:100%;margin-top:8px" data-open>${conn ? 'Open the R10 screen' : 'Connect R10'}</button>${s.launchPaired ? `<p class="mute small" style="margin:6px 0 0">Last used: ${esc(s.launchPaired)}</p>` : ''}`
    : `<p class="mute small" style="margin:8px 0 0">${/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone browsers can\'t use Bluetooth: use the osolo app.' : 'This browser has no Bluetooth: use Chrome or the osolo app.'}</p>`;
  el.querySelector('[data-open]')?.addEventListener('click', () => openR10Sheet({ toast, onClose: () => renderR10Row(el, { toast }) }));
}

export function openR10Sheet({ toast = () => {}, onClose = () => {}, onSaved = () => {} } = {}) {
  const bag = getBag().map((c) => c.club);
  let club = getSettings().r10Club && bag.includes(getSettings().r10Club) ? getSettings().r10Club : bag.find((c) => /7/.test(c)) || bag[0] || '7i';
  let ball = 'range', status = conn ? 'Connected. Swing away.' : '', phase = conn ? 'armed' : '', fault = '', rec = null, last = null, busy = false;
  const log = [];
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet r10sheet';

  const save = async () => { if (!rec?.rows.length) return; rec.cols = KEY_ORDER.filter((k) => rec.rows.some((r) => r[k] != null)); await putLaunch(rec); onSaved(rec); };
  const newRec = () => { rec = { id: uid(), date: Date.now(), club, ball, source: 'Garmin R10', live: true, cols: [], rows: [] }; };
  const onEvent = (e) => {
    if (e.type === 'status') status = e.text;
    else if (e.type === 'connected') { status = `Connected to ${e.name}. Setting up…`; const st = getSettings(); st.launchPaired = e.name; saveSettings(st); }
    else if (e.type === 'ready') { status = 'Ready. Swing away.'; phase = 'armed'; fault = ''; }
    else if (e.type === 'state') phase = e.name;
    else if (e.type === 'fault') fault = e.text;
    else if (e.type === 'error') { status = e.text; busy = false; }
    else if (e.type === 'log') { log.push(e.text); if (log.length > 60) log.shift(); }
    else if (e.type === 'disconnected') { conn = null; status = 'Disconnected.'; phase = ''; }
    else if (e.type === 'shot') {
      const row = shotRow(e.shot, simulate);
      if (row.warmup) { status = 'Warm-up shot (not saved).'; }
      else {
        if (!rec || rec.club !== club || rec.ball !== ball) newRec();
        rec.rows.push(row); last = row; save().catch((err) => toast(`Couldn't save: ${err.message}`));
      }
    }
    draw();
  };

  const connect = async () => {
    if (busy || conn) return; busy = true; status = 'Looking for the R10…'; draw();
    try { conn = await connectR10({ onEvent }); } catch (e) { status = /cancel/i.test(e.message) ? 'Not connected.' : e.message; }
    busy = false; draw();
  };

  const lastHtml = () => {
    if (!last) return `<p class="mute small" style="margin:10px 0">${conn ? 'Hit a shot: it shows here as soon as the R10 has read it.' : ''}</p>`;
    const big = last.carry != null ? `<b class="r10big">${D(last.carry)}<small>${du()}</small></b><span class="mute small">carry ≈ (osolo's calculation)</span>` : `<b class="r10big">${n1(last.ballSpeed)}<small>mph</small></b><span class="mute small">ball speed</span>`;
    const cell = (l, v, u = '') => `<div><span class="mute small">${l}</span><b>${v}${u ? `<small> ${u}</small>` : ''}</b></div>`;
    return `<div class="card r10last">${big}
      <div class="r10grid">${cell('Ball', n1(last.ballSpeed), 'mph')}${cell('Club', n1(last.clubSpeed), 'mph')}${cell('Smash', last.smash ?? '–')}${cell('Launch', n1(last.launch), '°')}${cell('Spin', n0(last.spin), 'rpm')}${cell('Direction', last.azimuth == null ? '–' : `${last.azimuth > 0 ? 'R' : last.azimuth < 0 ? 'L' : ''}${Math.abs(last.azimuth)}`, '°')}
      ${last.face != null ? cell('Face', n1(last.face), '°') + cell('Path', n1(last.path), '°') + cell('Attack', n1(last.attack), '°') : ''}</div></div>`;
  };

  const draw = () => {
    const q = rec?.rows.length ? clubSummary([rec], club) : null;
    sheet.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Garmin R10</b><button type="button" class="link" data-close>Close</button></div>
      <p class="small" style="margin:0 0 8px">${esc(status || 'Not connected.')}${phase && conn ? ` <span class="mute">· ${esc(phase)}</span>` : ''}</p>
      ${fault ? `<p class="small" style="margin:0 0 8px;color:var(--work)">${esc(fault)}</p>` : ''}
      ${conn ? '' : `<button type="button" class="btn primary big" data-connect ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Connect R10'}</button>
        <details class="small" style="margin:8px 0"><summary class="mute">Setting up</summary><ol class="steps">
          <li>Put the R10 2–2.5 m (6–8 ft) behind the ball, pointing down your target line, level.</li>
          <li>Turn it on. Close the Garmin Golf app: the R10 talks to one app at a time.</li>
          <li>Tap Connect and choose <b>Approach R10</b>. The first time, accept the pairing request.</li>
          <li>Wait for <b>Ready</b>, then hit. Club data (face, path, attack) needs a reasonably full swing.</li></ol></details>`}
      <div class="lbl">Club</div>
      <div class="clubchips">${bag.map((c) => `<button type="button" class="${c === club ? 'on' : ''}" data-club="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="lbl">Ball</div>
      <div class="seg seg2 mini" data-ball><button type="button" data-b="range" class="${ball === 'range' ? 'on' : ''}">Range balls</button><button type="button" data-b="premium" class="${ball === 'premium' ? 'on' : ''}">Premium</button></div>
      ${lastHtml()}
      ${q ? `<div class="lbl">${esc(club)}: ${q.n} shot${q.n > 1 ? 's' : ''} this session</div>${tilesHtml(q, club)}${takesBlock(q, club, { max: 2 })}` : ''}
      ${rec?.rows.length ? `<table class="r10tab"><thead><tr><th>#</th><th>Ball</th><th>Club</th><th>Launch</th><th>Spin</th><th>Carry≈</th></tr></thead><tbody>${rec.rows.slice().reverse().map((r, i) => `<tr><td>${rec.rows.length - i}</td><td>${n1(r.ballSpeed)}</td><td>${n1(r.clubSpeed)}</td><td>${n1(r.launch)}</td><td>${n0(r.spin)}</td><td>${r.carry != null ? D(r.carry) : '–'}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="mute small" style="margin-top:10px">Every shot saves as it lands. Carry is osolo's flight-model estimate from ball speed, launch and spin: the R10 doesn't send its own over Bluetooth. Because they're calculated, they don't change your Bag.</p>
      ${conn ? '<button type="button" class="btn" data-disconnect style="width:100%;margin-top:8px">Disconnect</button>' : ''}
      ${log.length ? `<details style="margin-top:8px"><summary class="small mute">Diagnostics</summary><pre class="log">${esc(log.join('\n'))}</pre></details>` : ''}
    </div>`;
    sheet.querySelector('[data-close]').onclick = () => { sheet.remove(); onClose(); };
    sheet.querySelector('[data-connect]')?.addEventListener('click', connect);
    sheet.querySelector('[data-disconnect]')?.addEventListener('click', () => { conn?.disconnect(); conn = null; status = 'Disconnected.'; draw(); });
    sheet.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => { club = b.dataset.club; const st = getSettings(); st.r10Club = club; saveSettings(st); last = null; rec = null; draw(); });
    sheet.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { ball = b.dataset.b; rec = null; draw(); });
    bindDrillCards?.(sheet);
  };
  draw();
  document.body.appendChild(sheet);
  return sheet;
}

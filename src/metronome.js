// Tempo trainer. Full swing: three tones — takeaway, top, impact — in the 3:1 ratio every tour
// player shares (Tour Tempo frames at 30 fps: 18/6 fast … 27/9 slow). Putting: a steady 2:1
// tick, back on one, through on two. Runs on Web Audio, so it keeps time with the screen off
// as long as the page stays open.
import { getSettings, saveSettings } from './store.js';

const SWING = [[18, 6], [21, 7], [24, 8], [27, 9]]; // frames back / down at 30 fps
const PUTT_BPM = [60, 66, 72, 76, 80, 86];

let ctx = null, timer = null, running = false;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
function tone(at, freq, len = 0.07, gain = 0.5) {
  const o = audio().createOscillator(), g = audio().createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(audio().destination); o.start(at); o.stop(at + len + 0.02);
}

export function openMetronome({ toast = () => {} } = {}) {
  const S = getSettings(); const pref = S.metronome || { mode: 'swing', swing: 1, putt: 2, gap: 1.6 };
  let { mode, swing, putt, gap } = pref;
  const el = document.createElement('div'); el.className = 'sheet itemsheet metro';
  const save = () => { const s = getSettings(); s.metronome = { mode, swing, putt, gap }; saveSettings(s); };
  const stop = () => { running = false; clearTimeout(timer); timer = null; el.querySelector('[data-go]').textContent = 'Start'; el.querySelector('.m-dot').classList.remove('on'); };
  const draw = () => {
    const [b, d] = SWING[swing]; const back = b / 30, down = d / 30;
    el.innerHTML = `<div class="sheet-in">
      <div class="sheet-h"><b>Tempo</b><button class="link" data-close>Close</button></div>
      <div class="seg" style="grid-template-columns:1fr 1fr"><button class="${mode === 'swing' ? 'on' : ''}" data-mode="swing">Full swing 3:1</button><button class="${mode === 'putt' ? 'on' : ''}" data-mode="putt">Putting 2:1</button></div>
      <div class="m-face"><span class="m-dot"></span><b data-big>${mode === 'swing' ? `${b}/${d}` : `${PUTT_BPM[putt]} bpm`}</b><span class="mute small" data-sub>${mode === 'swing' ? `${back.toFixed(2)} s back · ${down.toFixed(2)} s down` : 'back on one, through on two'}</span></div>
      <div class="lbl">${mode === 'swing' ? 'Tempo (frames back / down)' : 'Beats per minute'}</div>
      <div class="chips3">${mode === 'swing' ? SWING.map(([x, y], i) => `<button class="${i === swing ? 'on' : ''}" data-sw="${i}">${x}/${y}<small>${['fast', 'tour', 'smooth', 'slow'][i]}</small></button>`).join('') : PUTT_BPM.map((v, i) => `<button class="${i === putt ? 'on' : ''}" data-pt="${i}">${v}</button>`).join('')}</div>
      ${mode === 'swing' ? `<div class="lbl">Pause between swings</div><div class="chips3">${[1.2, 1.6, 2.2, 3].map((g) => `<button class="${g === gap ? 'on' : ''}" data-gap="${g}">${g} s</button>`).join('')}</div>` : ''}
      <button class="btn primary big" data-go style="margin-top:10px">${running ? 'Stop' : 'Start'}</button>
      <p class="mute small" style="margin-top:8px">${mode === 'swing' ? 'Three tones: start the club back on the first, reach the top on the second, strike on the third. 21/7 is the most common tour tempo; most amateurs are too slow back and too quick down.' : 'Stroke back on the first tick, through on the second. Same length every time; the distance comes from the length of the stroke, not the speed.'}</p>
    </div>`;
    el.querySelector('[data-close]').onclick = () => { stop(); el.remove(); };
    el.querySelectorAll('[data-mode]').forEach((x) => x.onclick = () => { stop(); mode = x.dataset.mode; save(); draw(); });
    el.querySelectorAll('[data-sw]').forEach((x) => x.onclick = () => { swing = +x.dataset.sw; save(); const was = running; stop(); draw(); if (was) start(); });
    el.querySelectorAll('[data-pt]').forEach((x) => x.onclick = () => { putt = +x.dataset.pt; save(); const was = running; stop(); draw(); if (was) start(); });
    el.querySelectorAll('[data-gap]').forEach((x) => x.onclick = () => { gap = +x.dataset.gap; save(); const was = running; stop(); draw(); if (was) start(); });
    el.querySelector('[data-go]').onclick = () => (running ? stop() : start());
  };
  const flash = () => { const dot = el.querySelector('.m-dot'); if (!dot) return; dot.classList.add('on'); setTimeout(() => dot.classList.remove('on'), 90); };
  const start = () => {
    try { audio().resume(); } catch { return toast('No audio on this device.'); }
    running = true; el.querySelector('[data-go]').textContent = 'Stop';
    const loop = () => {
      if (!running) return;
      const t = audio().currentTime + 0.05;
      if (mode === 'swing') {
        const [b, d] = SWING[swing]; const back = b / 30, down = d / 30;
        tone(t, 660); tone(t + back, 880); tone(t + back + down, 1320, 0.09, 0.7);
        setTimeout(flash, 50); setTimeout(flash, 50 + back * 1000); setTimeout(flash, 50 + (back + down) * 1000);
        timer = setTimeout(loop, (back + down + gap) * 1000);
      } else {
        const beat = 60 / PUTT_BPM[putt];
        tone(t, 660); tone(t + beat, 880, 0.08, 0.7);
        setTimeout(flash, 50); setTimeout(flash, 50 + beat * 1000);
        timer = setTimeout(loop, beat * 2 * 1000);
      }
    };
    loop();
  };
  draw(); document.body.appendChild(el);
}

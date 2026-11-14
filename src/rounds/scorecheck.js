// Before leaving a hole: confirm the score. The app never moves on with a number the golfer didn't see.
// Pure part (scoreGuess, applyScore) is tested; the sheet just shows it.

const strokesBeforeGreen = (h) => (h.shots || []).length + (h.shots || []).filter((x) => x.pen).length;

/** Does this hole need a confirmed score before moving on? Not when the putts are logged to the hole. */
export function needsCheck(h) {
  if (!h) return true;
  if (h.score != null && h.putts != null && !h.puttsAuto) return false;
  if (h.score != null && h.scoreConfirmed) return false;
  if (h.pickup) return false;
  return true;
}

/**
 * The starting number on the sheet: the score so far if the hole is finished, else the shots logged plus two
 * putts when on the green, else par. Never below the strokes already logged.
 */
export function scoreGuess(h, par) {
  const n = strokesBeforeGreen(h), last = h.shots?.[h.shots.length - 1]?.res;
  if (h.score != null) return h.score;
  if (last === 'HO') return n;
  if (last === 'G') return n + 2;
  return Math.max(par, n + 1);
}

/** Write the confirmed score. On the green the putts follow from it; off it, the score stands alone. */
export function applyScore(h, score) {
  const n = strokesBeforeGreen(h), last = h.shots?.[h.shots.length - 1]?.res;
  if ((last === 'G' || last === 'HO') && score >= n) {
    h.putts = score - n; delete h.puttsAuto;
  }
  h.score = score; h.scoreConfirmed = true; delete h.pickup;
}

/** No score on this hole (picked up, Stableford, a team format): shown as a hyphen, left out of score stats. */
export function applyNoScore(h) {
  h.score = null; h.putts = null; h.pickup = true; delete h.puttsAuto; delete h.scoreConfirmed;
}

/** The sheet. done() runs after Confirm or Skip (Skip leaves the hole without a score); Cancel stays on the hole. */
export function scoreCheckSheet({ h, par, hole }, done) {
  let v = scoreGuess(h, par);
  const min = Math.max(1, strokesBeforeGreen(h));
  const sheet = document.createElement('div'); sheet.className = 'sheet scorecheck';
  const word = (d) => (d <= -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `+${d}`);
  const putts = () => { const n = strokesBeforeGreen(h), last = h.shots?.[h.shots.length - 1]?.res; return last === 'G' || last === 'HO' ? v - n : null; };
  const draw = () => {
    const p = putts();
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Hole ${hole} · par ${par}: your score?</b><button class="link" data-close>Cancel</button></div>
      <div class="sc-step"><button data-d="-1" ${v <= min ? 'disabled' : ''} aria-label="One less">−</button>
        <span class="${v < par ? 'under' : v > par ? 'over' : ''}"><b>${v}</b><small>${word(v - par)}${p != null ? ` · ${p} putt${p === 1 ? '' : 's'}` : ''}</small></span>
        <button data-d="1" aria-label="One more">+</button></div>
      <button class="btn primary big" data-ok>Confirm ${v}</button>
      <button class="btn big" data-na>No score (n/a)</button>
      <p class="mute small center">Picked up, Stableford, or a team format: the card shows a hyphen.</p>
      <p class="center"><button class="link mute" data-skip>Skip: fill it in later</button></p></div>`;
    sheet.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { v = Math.max(min, v + +b.dataset.d); draw(); });
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    sheet.querySelector('[data-ok]').onclick = () => { applyScore(h, v); sheet.remove(); done(); };
    sheet.querySelector('[data-na]').onclick = () => { applyNoScore(h); sheet.remove(); done(); };
    sheet.querySelector('[data-skip]').onclick = () => { if (h.puttsAuto) { h.putts = null; h.score = null; delete h.puttsAuto; } sheet.remove(); done(); };
  };
  draw();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

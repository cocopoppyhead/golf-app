// The hole ribbon: the top of the hole screen styled like a tour broadcast graphic. Hole and par, the golfer
// and today's score; underneath, their usual score on this hole and the last three times they played it; and
// the nine they're on as a scorecard strip (tap a hole to go to it). Tapping the ribbon opens the full card.
// Pure functions: the screen passes in the round, the course and the history; nothing here reads storage.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Score to par as broadcast shows it: E, +2, -1. */
export const toParTv = (d) => (d == null ? '–' : d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);

/** An average to par rounded to a whole stroke, halves away from par: +0.4 -> 0, +0.5 -> +1, -0.5 -> -1. */
export const roundToPar = (x) => (x == null || !Number.isFinite(x) ? null : Math.sign(x) * Math.floor(Math.abs(x) + 0.5) || 0);

/**
 * Per-hole history from earlier rounds on this course: [{ n, avg, last: [scores, newest first] }] by hole.
 * rows: [{ r, c }] earlier rounds that count (the caller filters), newest first; pars: this course's pars.
 */
export function courseHistory(rows, pars) {
  return pars.map((par, i) => {
    const sc = rows.map(({ r }) => r.holes?.[i]?.score).filter((v) => Number.isFinite(v));
    return { n: sc.length, avg: sc.length ? roundToPar(sc.reduce((a, b) => a + b, 0) / sc.length - par) : null, last: sc.slice(0, 3) };
  });
}

/** One score marked the scorecard way: circle birdie, double circle eagle, square bogey, double square worse. */
export function mark(score, par) {
  if (!Number.isFinite(score)) return '';
  const d = score - par, cls = d <= -2 ? 'eagle' : d === -1 ? 'bird' : d === 1 ? 'bog' : d >= 2 ? 'dbl' : 'par';
  return `<span class="mk ${cls}">${score}</span>`;
}

/** The ribbon's second line: usual score here and the last three, or a first-time note. */
export function historyLine(hist, par) {
  if (!hist) return '<span class="rb-dim">Loading your history here…</span>';
  if (!hist.n) return '<span class="rb-dim">FIRST TIME HERE</span>';
  return `YOUR AVG <b>${toParTv(hist.avg)}</b> <span class="rb-n">(${hist.n} RD${hist.n > 1 ? 'S' : ''})</span><span class="rb-sep">|</span>LAST ${Math.min(3, hist.last.length)} ${hist.last.map((s) => mark(s, par)).join('')}`;
}

/**
 * The ribbon. i: hole index; pars: every hole's par; scores: today's score per hole (null = not played);
 * name: what to call the golfer; hist: this hole's history (or null while loading).
 */
export function ribbonHtml({ i, pars, scores, name, hist }) {
  const par = pars[i], played = scores.map((s, k) => (Number.isFinite(s) ? s - pars[k] : null)).filter((d) => d != null);
  const today = played.length ? played.reduce((a, b) => a + b, 0) : null;
  const nine = pars.length > 9 && i >= 9 ? 9 : 0, end = Math.min(pars.length, nine + 9);
  const cells = [];
  for (let k = nine; k < end; k++) cells.push({ k, s: scores[k], p: pars[k] });
  const nineDiff = cells.filter((c) => Number.isFinite(c.s)).reduce((a, c) => a + c.s - c.p, 0);
  const nineAny = cells.some((c) => Number.isFinite(c.s));
  const cols = `grid-template-columns:34px repeat(${cells.length},1fr) 34px`;
  return `<div class="ribbon" data-card role="button" aria-label="Open the scorecard">
    <div class="rb-1"><b class="rb-h">${i + 1}</b><span class="rb-p">PAR<br>${par}</span><i class="rb-flag"></i>
      <b class="rb-nm">${esc((name || 'You').toUpperCase())}</b>
      <span class="rb-tp"><b>${toParTv(today)}</b><small>${played.length ? `THRU ${played.length}` : 'NOT STARTED'}</small></span></div>
    <div class="rb-2" data-hist>${historyLine(hist, par)}</div>
    <div class="rb-sc" style="${cols}">
      <span class="rb-lb">HOLE</span>${cells.map((c) => `<span class="rb-hd">${c.k + 1}</span>`).join('')}<span class="rb-hd">${nine ? 'IN' : pars.length > 9 ? 'OUT' : 'TOT'}</span>
      <span class="rb-lb">YOU</span>${cells.map((c) => `<span class="rb-c${c.k === i ? ' cur' : ''}${Number.isFinite(c.s) ? '' : ' rb-todo'}" data-go="${c.k}">${Number.isFinite(c.s) ? mark(c.s, c.p) : c.p}</span>`).join('')}<span class="rb-tot">${nineAny ? toParTv(nineDiff) : ''}</span>
    </div></div>`;
}

/** The full card: today and the usual score per hole, both nines. hists: per hole (or null while loading). */
export function cardHtml({ i, pars, scores, name, courseName, hists }) {
  const played = scores.map((s, k) => (Number.isFinite(s) ? s - pars[k] : null)).filter((d) => d != null);
  const today = played.length ? played.reduce((a, b) => a + b, 0) : null;
  const nine = (from, to, label) => {
    const ks = []; for (let k = from; k < to; k++) ks.push(k);
    const parSum = ks.reduce((a, k) => a + pars[k], 0);
    const done = ks.filter((k) => Number.isFinite(scores[k]));
    const avgs = ks.map((k) => hists?.[k]?.avg).filter((v) => v != null);
    const cols = `grid-template-columns:46px repeat(${ks.length},1fr) 38px`;
    return `<div class="cd-grid" style="${cols}">
      <span class="cd-lb">HOLE</span>${ks.map((k) => `<span class="cd-hd${k === i ? ' cur' : ''}" data-go="${k}">${k + 1}</span>`).join('')}<span class="cd-hd">${label}</span>
      <span class="cd-lb">PAR</span>${ks.map((k) => `<span>${pars[k]}</span>`).join('')}<span>${parSum}</span>
      <span class="cd-lb">TODAY</span>${ks.map((k) => `<span data-go="${k}">${Number.isFinite(scores[k]) ? mark(scores[k], pars[k]) : '<i class="cd-dash">–</i>'}</span>`).join('')}<span>${done.length ? toParTv(done.reduce((a, k) => a + scores[k] - pars[k], 0)) : ''}</span>
      <span class="cd-lb">AVG</span>${ks.map((k) => `<span class="cd-avg">${hists ? (hists[k]?.n ? toParTv(hists[k].avg) : '·') : '…'}</span>`).join('')}<span class="cd-avg">${avgs.length ? toParTv(avgs.reduce((a, b) => a + b, 0)) : ''}</span>
    </div>`;
  };
  const two = pars.length > 9;
  return `<div class="sheet cardsheet"><div class="sheet-in rb-card">
    <div class="cd-h"><b>${esc((name || 'You').toUpperCase())} · ${esc((courseName || '').split(/\s[–-]\s/)[0].toUpperCase())}</b><span>${toParTv(today)}${played.length ? ` THRU ${played.length}` : ''}</span><button class="link" data-close>Close</button></div>
    ${nine(0, Math.min(9, pars.length), two ? 'OUT' : 'TOT')}
    ${two ? nine(9, pars.length, 'IN') : ''}
    <p class="cd-note">AVG is your usual score to par on each hole here, from rounds that count, rounded to a whole stroke. Tap a hole to go to it.</p>
  </div></div>`;
}

// Launch-monitor sessions from a photo of the bay's table (TrackMan, Toptracer, a sim). The
// speeds are the point — club speed, ball speed, smash, launch, spin — because a cheap sim with
// range balls gets those roughly right and the distances wrong. You tick which columns and rows
// to keep; carries only touch your Bag if you keep the carry column with a premium ball.
import { getSettings, listLaunch, putLaunch, deleteLaunch, putShot } from './store.js';
import { readLaunchTable, aiFrom, aiReady } from './coach/ai.js';
import { dist as D, du, isMetric } from './units.js';
import { icon } from './icons.js';
import { drillsLoaded, drillCardsHtml, bindDrillCards } from './drills.js';
import { launchTakes, takesHtml, takesText, benchmarks } from './launchtakes.js';
import { simulate } from './flight.js';
import { parseLaunchFile } from './launchfile.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtD = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0; };

export const COLS = {
  clubSpeed: { label: 'Club speed', unit: 'mph' }, ballSpeed: { label: 'Ball speed', unit: 'mph' }, smash: { label: 'Smash', unit: '' },
  launch: { label: 'Launch', unit: '°' }, backSpin: { label: 'Back spin', unit: 'rpm' }, sideSpin: { label: 'Side spin', unit: 'rpm' }, spin: { label: 'Spin', unit: 'rpm' }, spinAxis: { label: 'Spin axis', unit: '°' },
  carry: { label: 'Carry', unit: 'yd' }, total: { label: 'Total', unit: 'yd' }, apex: { label: 'Apex', unit: 'yd' }, descent: { label: 'Descent', unit: '°' },
  side: { label: 'Offline', unit: 'yd' }, toTarget: { label: 'To target', unit: 'yd' }, azimuth: { label: 'Direction', unit: '°' }, face: { label: 'Face', unit: '°' }, path: { label: 'Path', unit: '°' }, attack: { label: 'Attack', unit: '°' },
};
// what the Bag and the coach care about, in display order
export const KEY_ORDER = ['clubSpeed', 'ballSpeed', 'smash', 'launch', 'backSpin', 'sideSpin', 'spinAxis', 'carry', 'total', 'apex', 'descent', 'side', 'toTarget', 'azimuth', 'face', 'path', 'attack'];

// ---- units in → stored (yards, mph, rpm, degrees) ----
const toMph = (v, u) => (u === 'kmh' ? v / 1.609344 : u === 'ms' ? v * 2.236936 : v);
const toYd = (v, u) => (u === 'm' ? v / 0.9144 : v);
/** Normalise one parsed table into { cols: [key…], rows: [{key: value}] } with app units. */
export function normaliseTable(t) {
  const cols = (t.columns || []).map((c, i) => ({ i, key: c.key, label: c.label || c.key, unit: (c.unit || '').toLowerCase() }));
  const rows = (t.rows || []).map((r) => {
    const o = {};
    cols.forEach((c) => {
      let v = r[c.i]; if (v == null || v === '') return;
      if (typeof v === 'string') { const m = v.replace(',', '').match(/-?\d+(\.\d+)?/); const neg = /^\s*L/i.test(v); v = m ? +m[0] * (neg ? -1 : 1) : null; }
      if (!Number.isFinite(v)) return;
      if (['clubSpeed', 'ballSpeed'].includes(c.key)) v = toMph(v, c.unit);
      if (['carry', 'total', 'apex', 'side', 'toTarget'].includes(c.key)) v = toYd(v, c.unit);
      if (c.key === 'club') o.club = String(r[c.i]); else if (c.key === 'shot') o.n = v; else if (c.key !== 'other') o[c.key] = Math.round(v * (c.key === 'smash' ? 100 : 10)) / (c.key === 'smash' ? 100 : 10);
    });
    if (o.ballSpeed && o.clubSpeed && !o.smash) o.smash = Math.round((o.ballSpeed / o.clubSpeed) * 100) / 100;
    return o;
  }).filter((o) => Object.keys(o).some((k) => k !== 'n'));
  const keys = KEY_ORDER.filter((k) => rows.some((r) => r[k] != null));
  return { cols: keys, rows, club: t.club || null, notes: t.notes || '' };
}

/** Per-club summary across sessions: means, spread, shot count, latest date. */
export function clubSummary(sessions, club) {
  const shots = sessions.filter((s) => s.club === club).flatMap((s) => s.rows.filter((r) => r.keep !== false).map((r) => ({ ...r, date: s.date, ball: s.ball })));
  if (!shots.length) return null;
  const out = { n: shots.length, last: Math.max(...shots.map((r) => r.date)), range: shots.every((r) => r.ball !== 'premium') };
  for (const k of KEY_ORDER) { const v = shots.map((r) => r[k]).filter((x) => x != null); const p = k === 'smash' ? 100 : 10; if (v.length) out[k] = { avg: Math.round(mean(v) * p) / p, sd: Math.round(sd(v) * p) / p, n: v.length, best: k === 'smash' || k === 'ballSpeed' || k === 'clubSpeed' || k === 'carry' || k === 'total' ? Math.max(...v) : null }; }
  return out;
}

/** One line per club for the AI coach. */
export async function launchContext() {
  const S = await listLaunch().catch(() => []); if (!S.length) return '';
  const clubs = [...new Set(S.map((s) => s.club))];
  const lines = clubs.map((c) => { const q = clubSummary(S, c); if (!q) return null; const bits = [q.clubSpeed && `club ${q.clubSpeed.avg} mph`, q.ballSpeed && `ball ${q.ballSpeed.avg} mph`, q.smash && `smash ${q.smash.avg} ±${q.smash.sd}`, q.launch && `launch ${q.launch.avg}°`, q.backSpin && `spin ${Math.round(q.backSpin.avg)}`, q.attack && `attack ${q.attack.avg}°`, q.carry && `carry ${Math.round(q.carry.avg)} (${q.range ? 'range balls, treat as low' : 'premium ball'})`].filter(Boolean); const takes = launchTakes(q, c); return `${c}: ${bits.join(', ')} over ${q.n} shots, last ${fmtD(q.last)}${takes.length ? `. App's read: ${takesText(takes.slice(0, 3))} Drills already matched: ${[...new Set(takes.flatMap((t) => t.drills))].slice(0, 4).join(', ') || 'none'}` : ''}`; }).filter(Boolean);
  return `Launch monitor data (from sim/bay tables): ${lines.join('; ')}. Build on the app's read rather than repeating it.`;
}

/** Takes + matched drill cards for a club, ready to drop in a card. */
export function takesBlock(q, club, { max = 3, title = 'Drills for this' } = {}) {
  const takes = launchTakes(q, club).slice(0, max);
  if (!takes.length) return '';
  const lib = drillsLoaded();
  const ids = [...new Set(takes.flatMap((t) => t.drills))];
  const drills = lib ? ids.map((id) => lib.drills.find((d) => d.id === id)).filter(Boolean).slice(0, 3) : [];
  return `${takesHtml(takes, { max })}${drillCardsHtml(drills, { title })}`;
}

// ---------- import flow ----------
/** Pick a photo of the table → AI reads it → review grid → save. */
export function importLaunchSheet({ toast = () => {}, onSaved = () => {}, club = null } = {}) {
  const s = getSettings();
  if (!aiReady(s)) return toast('Add a Claude, ChatGPT or Gemini key in Settings: the table is read by the AI.');
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const file = inp.files?.[0]; inp.remove(); if (!file) return;
    const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet lmsheet';
    sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Launch monitor</b><button class="link" data-close>Cancel</button></div><p class="mute">Reading the table…</p></div>`;
    sheet.querySelector('[data-close]').onclick = () => sheet.remove();
    document.body.appendChild(sheet);
    try {
      const data = await shrink(file, 2000);
      const t = await readLaunchTable({ ...aiFrom(s), images: [data] });
      const T = normaliseTable(t);
      if (!T.rows.length) throw new Error('No shot rows found in that photo.');
      reviewSheet(sheet, T, { toast, onSaved, club: club || T.club });
    } catch (e) { sheet.querySelector('.sheet-in').innerHTML = `<div class="sheet-h"><b>Launch monitor</b><button class="link" data-close>Close</button></div><p style="color:var(--work)">${esc(e.message)}</p>`; sheet.querySelector('[data-close]').onclick = () => sheet.remove(); }
  };
  inp.click();
}

/** Pick a CSV/TSV export (Garmin R10, TrackMan, FlightScope, Rapsodo, a sim) → one review per club → save. */
export function importLaunchFile({ toast = () => {}, onSaved = () => {} } = {}) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain'; inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const file = inp.files?.[0]; inp.remove(); if (!file) return;
    let groups;
    try { groups = parseLaunchFile(await file.text(), { filename: file.name }); } catch (e) { return toast(`Couldn't read that file: ${e.message}`); }
    if (!groups.length) return toast('No launch-monitor columns found. Export the session as CSV (Garmin Golf, TrackMan, FlightScope and Rapsodo all do) and try again.');
    const queue = [...groups].sort((a, b) => b.table.rows.length - a.table.rows.length);
    const next = () => {
      const g = queue.shift(); if (!g) return;
      const T = normaliseTable(g.table);
      if (!T.rows.length) return next();
      const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet lmsheet'; sheet.innerHTML = '<div class="sheet-in"></div>'; document.body.appendChild(sheet);
      reviewSheet(sheet, T, { toast, club: g.club || null, when: g.date || Date.now(), source: g.source, remaining: queue.length, onSaved: (rec) => { onSaved(rec); next(); }, onSkip: next });
    };
    next();
  };
  inp.click();
}

function reviewSheet(sheet, T, { toast, onSaved, club, when = Date.now(), source: source0 = '', remaining = 0, onSkip = null }) {
  const bag = (getSettings().bag || []).map((c) => c.club);
  const keep = new Set(T.cols.filter((k) => !['toTarget', 'azimuth'].includes(k)));
  const rows = T.rows.map((r) => ({ ...r, keep: true }));
  let ball = 'range', source = source0;
  const unitOf = (k) => (COLS[k]?.unit === 'yd' ? du() : COLS[k]?.unit === 'mph' ? (isMetric() ? 'km/h' : 'mph') : COLS[k]?.unit || '');
  const show = (k, v) => (v == null ? '–' : COLS[k]?.unit === 'yd' ? D(v) : COLS[k]?.unit === 'mph' && isMetric() ? Math.round(v * 1.609) : k === 'backSpin' || k === 'sideSpin' || k === 'spin' ? Math.round(v) : v);
  const draw = () => {
    const kept = rows.filter((r) => r.keep);
    const avg = (k) => { const v = kept.map((r) => r[k]).filter((x) => x != null); return v.length ? mean(v) : null; };
    sheet.querySelector('.sheet-in').innerHTML = `<div class="sheet-h"><b>Launch monitor${club ? ` · ${esc(club)}` : ''}</b><button class="link" data-close>${onSkip ? (remaining ? `Skip (${remaining} more)` : 'Skip') : 'Cancel'}</button></div>
      ${when && Math.abs(Date.now() - when) > 36e5 ? `<p class="mute small" style="margin:0 0 6px">Session date from the file: ${new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>` : ''}
      <div class="row"><label class="small mute" style="flex:1">Club<select data-club>${[club, ...bag].filter((x, i, a) => x && a.indexOf(x) === i).map((c) => `<option ${c === club ? 'selected' : ''}>${esc(c)}</option>`).join('')}${club ? '' : '<option value="" selected>— pick —</option>'}</select></label>
        <label class="small mute" style="flex:1">Ball<select data-ball><option value="range">Range balls</option><option value="premium">Premium balls</option></select></label></div>
      <label class="small mute">Where <span>(optional)</span><input data-src placeholder="e.g. Topgolf bay 12, Trackman at Dubai Hills" /></label>
      <p class="small" style="margin:8px 0 4px"><b>Keep these columns</b> <span class="mute">— untick what the sim gets wrong</span></p>
      <div class="chips3">${T.cols.map((k) => `<button class="${keep.has(k) ? 'on' : ''}" data-col="${k}">${COLS[k]?.label || k}</button>`).join('')}</div>
      <p class="small" style="margin:10px 0 4px"><b>Shots</b> <span class="mute">— tap a row to drop it (duffs, warm-ups)</span></p>
      <div class="scroll"><table class="card-t lm-t"><thead><tr><th></th>${[...keep].map((k) => `<th>${COLS[k]?.label || k}<br><span class="mute">${unitOf(k)}</span></th>`).join('')}</tr></thead>
        ${rows.map((r, i) => `<tr class="${r.keep ? '' : 'off'}" data-row="${i}"><td>${r.n ?? i + 1}</td>${[...keep].map((k) => `<td>${show(k, r[k])}</td>`).join('')}</tr>`).join('')}
        <tr class="avg"><th>avg</th>${[...keep].map((k) => `<td>${show(k, avg(k) != null ? Math.round(avg(k) * 10) / 10 : null)}</td>`).join('')}</tr></table></div>
      ${keep.has('carry') ? `<p class="mute small" style="margin:8px 0 0">${ball === 'premium' ? 'Premium balls: the carries will count toward your Bag number for this club.' : 'Range balls: carries are saved for the record only and will not touch your Bag.'}</p>` : ''}
      ${T.notes ? `<p class="mute small">Reader note: ${esc(T.notes)}</p>` : ''}
      <button class="btn primary big" data-save style="margin-top:10px">Save ${kept.length} shot${kept.length === 1 ? '' : 's'}</button>`;
    const q = (x) => sheet.querySelector(x);
    q('[data-close]').onclick = () => { sheet.remove(); onSkip?.(); };
    q('[data-ball]').value = ball; q('[data-src]').value = source;
    q('[data-club]').onchange = (e) => { club = e.target.value; };
    q('[data-ball]').onchange = (e) => { ball = e.target.value; draw(); };
    q('[data-src]').oninput = (e) => { source = e.target.value; };
    sheet.querySelectorAll('[data-col]').forEach((b) => b.onclick = () => { keep.has(b.dataset.col) ? keep.delete(b.dataset.col) : keep.add(b.dataset.col); draw(); });
    sheet.querySelectorAll('[data-row]').forEach((tr) => tr.onclick = () => { rows[+tr.dataset.row].keep = !rows[+tr.dataset.row].keep; draw(); });
    q('[data-save]').onclick = async () => {
      if (!club) return toast('Pick the club first.');
      const keptRows = rows.filter((r) => r.keep).map((r) => { const o = { n: r.n }; for (const k of keep) if (r[k] != null) o[k] = r[k]; return o; });
      if (!keptRows.length) return toast('Keep at least one shot.');
      const rec = { id: uid('lm'), date: when, club, ball, source: source.trim(), cols: [...keep], rows: keptRows };
      await putLaunch(rec);
      // premium-ball carries feed the Bag's learned number like any saved shot
      let fed = 0;
      if (ball === 'premium' && keep.has('carry')) { for (const r of keptRows) if (r.carry) { await putShot({ id: uid('s'), at: when, club, swing: 'full', target: Math.round(r.carry), result: Math.round(r.carry), note: 'launch monitor', cond: null, norm: r.carry }); fed++; } }
      sheet.remove(); toast(`Saved ${keptRows.length} shots for ${club}${fed ? ` · ${fed} carries into your Bag` : ''}`); onSaved(rec);
    };
  };
  draw();
}

async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

// ---------- cards ----------
/** Bag: one card listing clubs with launch data, plus the import button. */
export async function renderLaunchCard(el, { toast = () => {}, onOpenClub = null } = {}) {
  const S = await listLaunch().catch(() => []);
  const clubs = [...new Set(S.map((s) => s.club))];
  el.innerHTML = `<div class="card lmcard">
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Launch monitor</h2><span><button class="link acc" data-import>${icon('camera', 14)} Photo</button> <button class="link acc" data-import-file style="margin-left:10px">${icon('upload', 14)} File</button></span></div>
    <p class="mute small" style="margin:0 0 8px">Photograph the bay's results table, or import the CSV a Garmin R10, TrackMan, FlightScope or Rapsodo exports. Club speed, ball speed, smash and launch are worth keeping even when a sim's distances aren't.</p>
    ${clubs.length ? `<table class="card-t lm-t"><thead><tr><th style="text-align:left">Club</th><th>Club</th><th>Ball</th><th>Smash</th><th>Launch</th><th>Shots</th></tr></thead>
      ${clubs.map((c) => { const q = clubSummary(S, c); return `<tr data-open="${esc(c)}"><td style="text-align:left"><b>${esc(c)}</b><br><span class="mute small">${fmtD(q.last)}</span></td><td>${q.clubSpeed ? `${q.clubSpeed.avg}<br><span class="mute small">±${q.clubSpeed.sd}</span>` : '–'}</td><td>${q.ballSpeed ? `${q.ballSpeed.avg}<br><span class="mute small">±${q.ballSpeed.sd}</span>` : '–'}</td><td>${q.smash ? `<b>${q.smash.avg}</b>` : '–'}</td><td>${q.launch ? `${q.launch.avg}°` : '–'}</td><td>${q.n}</td></tr>`; }).join('')}</table>
      <p class="mute small" style="margin:6px 0 0">Speeds in mph. Smash = ball speed ÷ club speed: about 1.48–1.50 is a flush driver, 1.33–1.38 a flush 7-iron.</p>
      ${clubs.slice(0, 2).map((c) => { const q = clubSummary(S, c); const t = launchTakes(q, c)[0]; return t ? `<div class="takes"><div class="lbl">${esc(c)}</div><p class="take ${t.level}">${t.text}</p></div>` : ''; }).join('')}
      ${(() => { const lib = drillsLoaded(); if (!lib) return ''; const ids = [...new Set(clubs.slice(0, 2).flatMap((c) => launchTakes(clubSummary(S, c), c).slice(0, 1).flatMap((t) => t.drills)))]; return drillCardsHtml(ids.map((id) => lib.drills.find((d) => d.id === id)).filter(Boolean).slice(0, 3), { title: 'Drills for this' }); })()}
      ${S.slice(0, 5).map((s) => `<div class="tagrow"><span class="small">${fmtD(s.date)} · ${esc(s.club)} · ${s.rows.length} shots · ${s.ball === 'premium' ? 'premium' : 'range balls'}${s.source ? ` · ${esc(s.source)}` : ''}</span><button class="link" data-del="${s.id}">Delete</button></div>`).join('')}` : ''}
  </div>`;
  const redraw = () => renderLaunchCard(el, { toast, onOpenClub });
  el.querySelector('[data-import]').onclick = () => importLaunchSheet({ toast, onSaved: redraw });
  el.querySelector('[data-import-file]').onclick = () => importLaunchFile({ toast, onSaved: redraw });
  bindDrillCards(el, { toast });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (!confirm('Delete this launch-monitor session?')) return; await deleteLaunch(b.dataset.del); redraw(); });
  if (onOpenClub) el.querySelectorAll('[data-open]').forEach((tr) => tr.onclick = () => onOpenClub(tr.dataset.open));
}

/** Club page: speeds for this club. */
export async function launchClubHtml(club) {
  const S = await listLaunch().catch(() => []);
  const q = clubSummary(S, club); if (!q) return '';
  return `<div class="card"><h2>Launch monitor <span class="mute small">${q.n} shots · last ${fmtD(q.last)}</span></h2>
    ${tilesHtml(q, club)}
    ${takesBlock(q, club)}
    ${sessionTrendHtml(S, club)}
    <p class="mute small">Carries here are what the bay measured; only premium-ball sessions feed your Bag number.</p></div>`;
}

/**
 * The eight tiles, two rows of four, ranked by what decides distance and consistency: ball speed,
 * smash, club speed, carry (model, with the bay's number beneath), launch, spin, attack angle (else
 * apex), spin axis (else descent). Each carries its spread and a benchmark bar for the golfer's speed.
 * Tiles with nothing measured and nothing the model can give are left out.
 */
const YD_PER_MPH_TXT = (kind) => ({ driver: 2, wood: 1.9, hybrid: 1.8, iron: 1.7, wedge: 1.5 })[kind] || 1.8;
export function tilesHtml(q, club) {
  const B = benchmarks(club, q.clubSpeed?.avg);
  const metric = isMetric();
  const speed = (v) => (metric ? `${Math.round(v * 1.609)}` : `${Math.round(v * 10) / 10}`);
  const speedU = metric ? 'km/h' : 'mph';
  const model = q.ballSpeed && q.launch && q.backSpin ? simulate({ ballSpeed: q.ballSpeed.avg, launch: q.launch.avg, spin: q.backSpin.avg }) : null;
  // a bar: the window shaded, the value as a dot; status by where the value sits
  const bar = (v, lo, hi, { pad = 0.6 } = {}) => {
    if (v == null || lo == null) return '';
    const span = hi - lo, min = lo - span * pad, max = hi + span * pad;
    const x = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    const st = v < lo ? 'low' : v > hi ? 'high' : 'ok';
    return `<i class="bar ${st}"><b style="left:${(( lo - min) / (max - min)) * 100}%;width:${(span / (max - min)) * 100}%"></b><u style="left:${x}%"></u></i>`;
  };
  const smashBar = (v) => { if (v == null) return ''; const lo = B.smash.low, hi = B.smash.flush + 0.02; return bar(v, lo, hi, { pad: 1 }); };
  const T = [], I = [];
  // tile: value, one-word label, spread, bar. Everything else (windows, benchmarks, caveats) goes behind the ⓘ.
  const tile = (label, value, unit, spread, barHtml, status = '', tag = '') => T.push(`<div class="lmtile ${status}"><span class="lbl">${label}</span><b>${value}</b><div class="foot"><em class="l">${tag || ''}</em><em class="u">${unit}</em><em class="r">${spread ? `±${spread}` : ''}</em></div>${barHtml}</div>`);
  const info = (label, text) => I.push(`<div><b>${label}</b><span>${text}</span></div>`);
  if (q.ballSpeed) { tile('Ball speed', speed(q.ballSpeed.avg), speedU, speed(q.ballSpeed.sd), ''); info('Ball speed', `How fast the ball leaves the face. The single biggest driver of distance: about ${YD_PER_MPH_TXT(B.kind)} yd per mph.`); }
  if (q.smash) { tile('Smash factor', q.smash.avg.toFixed(2), '', q.smash.sd.toFixed(2), smashBar(q.smash.avg)); info('Smash', `Ball speed ÷ club speed, i.e. strike quality. Flush with this club is about ${B.smash.flush.toFixed(2)}; under ${B.smash.low.toFixed(2)} the strike is costing you. The bar runs from ${B.smash.low.toFixed(2)} to flush.`); }
  if (q.clubSpeed) { tile('Club speed', speed(q.clubSpeed.avg), speedU, speed(q.clubSpeed.sd), ''); info('Club speed', 'Clubhead speed at impact. Adding speed helps only once the strike is consistent.'); }
  if (model || q.carry) { tile('Carry', D(model ? model.carry : q.carry.avg), du() === 'y' ? 'yd' : 'm', !model && q.carry ? D(q.carry.sd) : '', '', '', model ? 'model' : ''); info('Carry', model ? `What those speeds, launch and spin should fly with a premium ball in still air at 15 °C, from the flight model.${q.carry ? ` The bay said ${D(q.carry.avg)}${q.range ? ' with range balls' : ''}${q.carry.avg / model.carry < 0.9 ? ' — short of what the numbers say, so trust the speeds here, not the distance' : ''}.` : ''}` : `The carry the bay measured${q.range ? ' with range balls, so treat it as low' : ''}.`); }
  if (q.launch) { tile('Launch angle', q.launch.avg.toFixed(1), 'deg', q.launch.sd.toFixed(1), bar(q.launch.avg, B.launch[0], B.launch[1])); info('Launch', `Angle the ball leaves at. For your speed the window is ${B.launch[0]}–${B.launch[1]}°; the bar shows it, the dot is you.`); }
  if (q.backSpin) { tile('Spin rate', Math.round(q.backSpin.avg).toLocaleString(), 'rpm', Math.round(q.backSpin.sd), bar(q.backSpin.avg, B.spin[0], B.spin[1])); info('Spin', `Backspin. Window for your speed: ${B.spin[0].toLocaleString()}–${B.spin[1].toLocaleString()} rpm. Too much balloons and costs carry; too little drops out of the air.${q.range ? ' Range balls spin low and erratically — confirm with a premium ball.' : ''}`); }
  if (q.attack) { tile('Attack angle', `${q.attack.avg > 0 ? '+' : ''}${q.attack.avg.toFixed(1)}`, 'deg', q.attack.sd.toFixed(1), bar(q.attack.avg, B.attack[0], B.attack[1], { pad: 1 })); info('Attack angle', `Up (+) or down (−) through impact. Window for this club: ${B.attack[0] > 0 ? '+' : ''}${B.attack[0]} to ${B.attack[1] > 0 ? '+' : ''}${B.attack[1]}°.`); }
  else if (q.apex || model) { tile('Apex', D(q.apex ? q.apex.avg : model.apex), du() === 'y' ? 'yd' : 'm', q.apex ? D(q.apex.sd) : '', '', '', q.apex ? '' : 'model'); info('Apex', q.apex ? 'Peak height the bay measured.' : 'Peak height from the flight model.'); }
  if (q.side && (q.side.n || 0) >= 3) { const bias = q.side.avg; tile('Dispersion', `±${D(q.side.sd)}`, du() === 'y' ? 'yd' : 'm', '', bar(bias, -q.side.sd, q.side.sd, { pad: 1 })); info('Spread', `Left–right dispersion: two in three shots finish within ±${D(q.side.sd)} ${du() === 'y' ? 'yd' : 'm'} of your average line${Math.abs(bias) >= 3 ? `, which is ${D(Math.abs(bias))} ${bias > 0 ? 'right' : 'left'} of target` : ', which is on target'}${q.carry?.sd ? `. Carry spread ±${D(q.carry.sd)}` : ''}. The dot is your average miss.`); }
  else if (q.spinAxis) { tile('Spin axis', `${q.spinAxis.avg > 0 ? '+' : ''}${q.spinAxis.avg.toFixed(1)}`, 'deg', q.spinAxis.sd.toFixed(1), bar(q.spinAxis.avg, -4, 4, { pad: 1 })); info('Spin axis', `Tilt of the spin: positive curves right, negative left. ${Math.abs(q.spinAxis.avg) > 2 ? `Yours is a consistent ${q.spinAxis.avg > 0 ? 'fade/slice' : 'draw/hook'} pattern.` : 'Yours is close to straight.'}`); }
  else if (q.descent || model) { tile('Descent', (q.descent ? q.descent.avg : model.descent).toFixed(0), 'deg', q.descent ? q.descent.sd.toFixed(0) : '', '', '', q.descent ? '' : 'model'); info('Descent', `Landing angle${q.descent ? '' : ' from the flight model'}: steeper stops faster, shallower runs out.`); }
  if (!T.length) return '';
  return `<div class="lmtiles">${T.join('')}</div>
    <details class="lminfo"><summary>${icon('info', 14)} What these numbers mean</summary><div class="lminfo-in"><p class="mute small">Speeds in ${speedU}. Bars show the window for your club speed; the dot is you (red when outside). ± is the shot-to-shot spread.</p>${I.join('')}</div></details>`;
}

/** Session by session for one club (latest first) with a sparkline per metric, once there are two sessions. */
export function sessionTrendHtml(S, club) {
  const mine = S.filter((s) => s.club === club && s.rows.some((r) => r.keep !== false)).sort((a, b) => a.date - b.date);
  if (mine.length < 2) return '';
  const per = mine.map((s) => ({ date: s.date, ball: s.ball, source: s.source, q: clubSummary([s], club) }));
  const metric = [['clubSpeed', 'Club', 1], ['ballSpeed', 'Ball', 1], ['smash', 'Smash', 2], ['launch', 'Launch', 1], ['backSpin', 'Spin', 0]].filter(([k]) => per.some((p) => p.q?.[k]));
  const spark = (vals) => {
    const v = vals.filter((x) => x != null); if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), W = 64, H = 18;
    const pts = vals.map((x, i) => (x == null ? null : `${(i / (vals.length - 1)) * W},${H - 2 - (hi === lo ? H / 2 : ((x - lo) / (hi - lo)) * (H - 4))}`)).filter(Boolean).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>`;
  };
  const fmt = (k, v, d) => (v == null ? '–' : k === 'launch' ? `${v.toFixed(1)}°` : v.toFixed(d));
  return `<div class="lbl" style="margin-top:10px">Session by session</div>
    <table class="card-t lm-t trend"><thead><tr><th style="text-align:left">When</th>${metric.map(([k, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tr class="sparks"><td></td>${metric.map(([k]) => `<td>${spark(per.map((p) => p.q?.[k]?.avg ?? null))}</td>`).join('')}</tr>
      ${[...per].reverse().slice(0, 8).map((p) => `<tr><td style="text-align:left">${fmtD(p.date)}<br><span class="mute small">${p.q.n} shots${p.ball === 'premium' ? ' · premium' : ''}</span></td>${metric.map(([k, , d]) => `<td>${fmt(k, p.q?.[k]?.avg ?? null, d)}</td>`).join('')}</tr>`).join('')}</table>
    <p class="mute small" style="margin:4px 0 0">Sparklines run oldest → newest. Different bays and balls move the numbers; compare like with like.</p>`;
}

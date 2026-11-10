// Launch-monitor sessions from a photo of the bay's table (TrackMan, Toptracer, a sim). The
// speeds are the point — club speed, ball speed, smash, launch, spin — because a cheap sim with
// range balls gets those roughly right and the distances wrong. You tick which columns and rows
// to keep; carries only touch your Bag if you keep the carry column with a premium ball.
import { getSettings, listLaunch, putLaunch, deleteLaunch, listShots, putShot } from './store.js';
import { readLaunchTable, aiFrom, aiReady } from './coach/ai.js';
import { dist as D, du, isMetric } from './units.js';
import { icon } from './icons.js';
import { drillsLoaded, drillCardsHtml, bindDrillCards } from './drills.js';
import { launchTakes, takesHtml, takesText } from './launchtakes.js';
import { predictedCarry } from './flight.js';

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
      if (c.key === 'club') o.club = String(r[c.i]); else if (c.key === 'shot') o.n = v; else if (c.key !== 'other') o[c.key] = Math.round(v * 10) / 10;
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

function reviewSheet(sheet, T, { toast, onSaved, club }) {
  const bag = (getSettings().bag || []).map((c) => c.club);
  const keep = new Set(T.cols.filter((k) => !['toTarget', 'azimuth'].includes(k)));
  const rows = T.rows.map((r) => ({ ...r, keep: true }));
  let ball = 'range', source = '', when = Date.now();
  const unitOf = (k) => (COLS[k]?.unit === 'yd' ? du() : COLS[k]?.unit === 'mph' ? (isMetric() ? 'km/h' : 'mph') : COLS[k]?.unit || '');
  const show = (k, v) => (v == null ? '–' : COLS[k]?.unit === 'yd' ? D(v) : COLS[k]?.unit === 'mph' && isMetric() ? Math.round(v * 1.609) : k === 'backSpin' || k === 'sideSpin' || k === 'spin' ? Math.round(v) : v);
  const draw = () => {
    const kept = rows.filter((r) => r.keep);
    const avg = (k) => { const v = kept.map((r) => r[k]).filter((x) => x != null); return v.length ? mean(v) : null; };
    sheet.querySelector('.sheet-in').innerHTML = `<div class="sheet-h"><b>Launch monitor</b><button class="link" data-close>Cancel</button></div>
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
    q('[data-close]').onclick = () => sheet.remove();
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
    <div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Launch monitor</h2><button class="link acc" data-import>${icon('camera', 14)} Add from photo</button></div>
    <p class="mute small" style="margin:0 0 8px">Photograph the bay's results table. Club speed, ball speed, smash and launch are worth keeping even when a sim's distances aren't.</p>
    ${clubs.length ? `<table class="card-t lm-t"><thead><tr><th style="text-align:left">Club</th><th>Club</th><th>Ball</th><th>Smash</th><th>Launch</th><th>Shots</th></tr></thead>
      ${clubs.map((c) => { const q = clubSummary(S, c); return `<tr data-open="${esc(c)}"><td style="text-align:left"><b>${esc(c)}</b><br><span class="mute small">${fmtD(q.last)}</span></td><td>${q.clubSpeed ? `${q.clubSpeed.avg}<br><span class="mute small">±${q.clubSpeed.sd}</span>` : '–'}</td><td>${q.ballSpeed ? `${q.ballSpeed.avg}<br><span class="mute small">±${q.ballSpeed.sd}</span>` : '–'}</td><td>${q.smash ? `<b>${q.smash.avg}</b>` : '–'}</td><td>${q.launch ? `${q.launch.avg}°` : '–'}</td><td>${q.n}</td></tr>`; }).join('')}</table>
      <p class="mute small" style="margin:6px 0 0">Speeds in mph. Smash = ball speed ÷ club speed: about 1.48–1.50 is a flush driver, 1.33–1.38 a flush 7-iron.</p>
      ${clubs.slice(0, 2).map((c) => { const q = clubSummary(S, c); const t = launchTakes(q, c)[0]; return t ? `<div class="takes"><div class="lbl">${esc(c)}</div><p class="take ${t.level}">${t.text}</p></div>` : ''; }).join('')}
      ${(() => { const lib = drillsLoaded(); if (!lib) return ''; const ids = [...new Set(clubs.slice(0, 2).flatMap((c) => launchTakes(clubSummary(S, c), c).slice(0, 1).flatMap((t) => t.drills)))]; return drillCardsHtml(ids.map((id) => lib.drills.find((d) => d.id === id)).filter(Boolean).slice(0, 3), { title: 'Drills for this' }); })()}
      ${S.slice(0, 5).map((s) => `<div class="tagrow"><span class="small">${fmtD(s.date)} · ${esc(s.club)} · ${s.rows.length} shots · ${s.ball === 'premium' ? 'premium' : 'range balls'}${s.source ? ` · ${esc(s.source)}` : ''}</span><button class="link" data-del="${s.id}">Delete</button></div>`).join('')}` : ''}
  </div>`;
  const redraw = () => renderLaunchCard(el, { toast, onOpenClub });
  el.querySelector('[data-import]').onclick = () => importLaunchSheet({ toast, onSaved: redraw });
  bindDrillCards(el, { toast });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (!confirm('Delete this launch-monitor session?')) return; await deleteLaunch(b.dataset.del); redraw(); });
  if (onOpenClub) el.querySelectorAll('[data-open]').forEach((tr) => tr.onclick = () => onOpenClub(tr.dataset.open));
}

/** Club page: speeds for this club. */
export async function launchClubHtml(club) {
  const S = await listLaunch().catch(() => []);
  const q = clubSummary(S, club); if (!q) return '';
  const cell = (k) => (q[k] ? `<div><b>${k === 'launch' || k === 'attack' ? `${q[k].avg}°` : k === 'backSpin' ? Math.round(q[k].avg) : k === 'carry' || k === 'total' || k === 'apex' ? D(q[k].avg) : q[k].avg}</b><span>${COLS[k].label}${q[k].sd ? ` ±${k === 'backSpin' ? Math.round(q[k].sd) : k === 'carry' || k === 'total' || k === 'apex' ? D(q[k].sd) : q[k].sd}` : ''}</span></div>` : '');
  const pred = predictedCarry(q);
  return `<div class="card"><h2>Launch monitor <span class="mute small">${q.n} shots · last ${fmtD(q.last)}</span></h2>
    <div class="kpis">${['clubSpeed', 'ballSpeed', 'smash', 'launch'].map(cell).join('')}</div>
    ${q.backSpin || q.carry || q.attack || pred ? `<div class="kpis">${['backSpin', 'attack', 'carry'].map(cell).join('')}${pred ? `<div><b>${D(pred)}</b><span>Should carry <span class="mute">(model)</span></span></div>` : ''}${['total', 'apex'].map(cell).join('')}</div>` : ''}
    ${takesBlock(q, club)}
    <p class="mute small">Carries here are what the bay measured; only premium-ball sessions feed your Bag number.</p></div>`;
}

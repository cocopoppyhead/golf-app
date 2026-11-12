// Settings → Garmin: how to run the export in Garmin Connect, then import the file. Rounds already
// imported (same Garmin scorecard id) are skipped, so re-importing after new rounds is safe.
import { BOOKMARKLET } from './bookmarklet.js';
import { convertExport, matchCourse } from './import.js';
import { readScorecard, scorecardId, convertScorecards, bagNames } from './scorecard.js';
import { readZipEntries } from './zip.js';
import { readActivity, activityStamp, matchActivity } from './activity.js';
import { historicConditions } from '../weather.js';
import { getCourse } from '../store.js';
import { listCourses, putCourse, listRounds, putRound } from '../store.js';
import { loadLibrary, importCourse } from '../rounds/library.js';
import { icon } from '../icons.js';
import { nativeSend, onNative } from '../native.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function garminSheet({ toast = () => {}, onImported = () => {} } = {}) {
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet garmin';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Import from Garmin</b><button class="link" data-close>Close</button></div>
    <p class="small" style="margin:0 0 8px">Garmin has no public golf API. Two ways to bring your rounds in:</p>
    <div class="card" style="margin:0 0 12px"><b>Your Garmin data export (easiest)</b>
      <p class="small mute" style="margin:4px 0 8px">Garmin Connect → Account settings → Data management → Export your data. Garmin emails a zip. Choose that zip here, or the files from its <code>DI_CONNECT/DI-GOLF</code> folder (select them all). Scores, putts and tracked shots for every round, on the right courses. The activities zip in <code>DI-Connect-Uploaded-Files</code> adds your heart rate through each round.</p>
      <button class="btn primary" data-pickmany style="width:100%">${icon('upload', 14)} Choose the zip or the DI-GOLF files</button></div>
    <p class="small" style="margin:0 0 6px"><b>Or the osolo export</b> — adds every CT10 shot with its club and where it finished:</p>
    <ol class="steps">
      <li><b>Make the bookmark once.</b> Copy the link below, add a bookmark in your browser (any page), edit it and paste this as its address. Call it “osolo Garmin export”.
        <div class="row" style="margin-top:6px"><button class="btn" data-copy style="flex:1">${icon('share', 14)} Copy bookmarklet</button></div>
        <details class="small mute" style="margin-top:4px"><summary>or paste it in the console</summary><textarea readonly rows="3" style="width:100%;font:11px/1.3 ui-monospace,monospace">${esc(BOOKMARKLET.replace(/^javascript:/, ''))}</textarea></details></li>
      <li><b>Sign in at connect.garmin.com</b>, open any page there, and click the bookmark. A small osolo box reports progress; it downloads <code>osolo-garmin-&lt;date&gt;.json</code>.</li>
      <li><b>Load the file here.</b> <button class="btn primary" data-pick style="margin-top:6px">${icon('upload', 14)} Choose the Garmin file</button></li>
    </ol>
    <p class="mute small">Your Garmin password never touches osolo: the export runs in your own browser session. Putts default to 2 in Garmin when you didn't enter them; shots without a recognised club are kept without one.</p>
    <p class="small" data-out></p></div>`;
  const q = (x) => sheet.querySelector(x);
  q('[data-close]').onclick = () => sheet.remove();
  q('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(BOOKMARKLET); q('[data-copy]').textContent = 'Copied'; } catch { toast('Copy failed: use the console version below.'); } };
  const report = (r) => {
    q('[data-out]').innerHTML = `<b>Imported ${r.added} round${r.added === 1 ? '' : 's'}</b>${r.updated ? ` · added shots and heart rate to ${r.updated} you had` : ''}${r.skipped ? ` (${r.skipped} already here)` : ''}${r.newCourses.length ? ` · new courses: ${r.newCourses.map(esc).join(', ')}` : ''}${r.shots ? ` · ${r.shots} tracked shots` : ''}${r.failed ? ` · ${r.failed} file${r.failed > 1 ? 's' : ''} couldn't be read` : ''}.${r.activities ? `<br>${r.activities} golf activities: heart rate added to ${r.hrRounds} round${r.hrRounds === 1 ? '' : 's'}.` : ''}${r.weather ? ` Weather on the day for ${r.weather}.` : ''}`;
    toast(`Garmin: ${r.added} rounds imported`); onImported(r);
  };
  q('[data-pickmany]').onclick = async () => {
    if (window.GolfNative?.caps?.includes('files.pick')) { // the Android app: the system picker, zip-aware
      q('[data-out]').textContent = 'Choose the Garmin zip (or the DI-GOLF files)…';
      try {
        const files = await nativePick();
        if (!files) { q('[data-out]').textContent = ''; return; }
        q('[data-out]').textContent = 'Reading your Garmin files…';
        report(await importGarminFiles(files, { progress: (t) => { q('[data-out]').textContent = t; } }));
      } catch (e) { q('[data-out]').textContent = e.message || String(e); }
      return;
    }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const files = [...(inp.files || [])]; inp.remove(); if (!files.length) return;
      q('[data-out]').textContent = 'Reading your Garmin files…';
      try { report(await importGarminFiles(files, { progress: (t) => { q('[data-out]').textContent = t; } })); } catch (e) { q('[data-out]').textContent = `${e.message || e} (${files.length === 1 ? `${files[0].name}, ${(files[0].size / 1e6).toFixed(1)} MB` : `${files.length} files`})`; }
    };
    inp.click();
  };
  q('[data-pick]').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files?.[0]; inp.remove(); if (!f) return;
      q('[data-out]').textContent = 'Importing…';
      try {
        const exp = JSON.parse(await f.text());
        const r = await importGarminExport(exp);
        q('[data-out]').innerHTML = `<b>Imported ${r.added} round${r.added === 1 ? '' : 's'}</b>${r.updated ? ` · added shots and heart rate to ${r.updated} you had` : ''}${r.skipped ? ` (${r.skipped} already here)` : ''}${r.newCourses.length ? ` · new courses: ${r.newCourses.map(esc).join(', ')}` : ''}${r.shots ? ` · ${r.shots} tracked shots` : ''}.`;
        toast(`Garmin: ${r.added} rounds imported`); onImported(r);
      } catch (e) { q('[data-out]').textContent = e.message || String(e); }
    };
    inp.click();
  };
  document.body.appendChild(sheet);
}

/** Ask the Android shell to pick files; it returns golf entries (still deflated when they came from a zip). */
async function nativePick() {
  const id = Math.random().toString(36).slice(2);
  const r = await new Promise((resolve) => { const off = onNative('files.picked', (m) => { if (m.id === id) { off(); resolve(m); } }); nativeSend({ type: 'files.pick', id }); });
  if (r.error) throw new Error(r.error);
  if (r.canceled) return null;
  const out = [];
  for (const f of r.files || []) {
    const raw = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
    const bytes = f.method === 8 ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer() : raw;
    out.push(new File([bytes], f.name));
  }
  if (!out.length) throw new Error(r.skipped?.length ? `Too large to read: ${r.skipped.join(', ')}` : 'No golf scorecards in what you picked. Choose the Garmin export zip, or the files in DI_CONNECT/DI-GOLF.');
  return out;
}

/**
 * Files from Garmin's account export: the zip itself, or the DI-GOLF files picked together. Scorecard FIT
 * files become rounds; an osolo-garmin JSON among them is imported too; other files are ignored.
 */
export async function importGarminFiles(files, { progress = () => {} } = {}) {
  const entries = []; const acts = [];
  const isAct = (n) => /\.fit$/i.test(n) && !/SCORECARD_RAWDATA/i.test(n);
  // activity files stream through: only golf ones are kept, as a summary (heart rate a minute, start, place)
  let seenActs = 0;
  const each = (e) => {
    if (!isAct(e.name)) return true;
    seenActs++; if (seenActs % 200 === 0) progress(`Reading activities… ${seenActs}`);
    if (activityStamp(e.bytes) == null) return false;
    try { const a = readActivity(e.bytes); if (a) acts.push(a); } catch { /* a damaged file: skip */ }
    return false;
  };
  for (const f of files) {
    const sig = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const isZip = sig[0] === 0x50 && sig[1] === 0x4b && (sig[2] === 3 || sig[2] === 5);
    if (isZip) {
      const want = (n) => /SCORECARD_RAWDATA-\d+\.fit$/i.test(n) || /Golf-CLUB(_TYPES)?\.json$/i.test(n) || /osolo-garmin.*\.json$/i.test(n) || /\.zip$/i.test(n) || isAct(n);
      const got = await readZipEntries(f, want, each);
      for (const e of got) {
        if (!/\.zip$/i.test(e.name)) { entries.push(e); continue; }
        // Garmin zips inside the zip (DI-Connect-Uploaded-Files holds the activities)
        if (e.bytes.byteLength < 400e6) entries.push(...(await readZipEntries(new Blob([e.bytes]), (n) => want(n) && !/\.zip$/i.test(n), each).catch(() => [])));
      }
    }
    else entries.push({ name: f.name, bytes: await f.arrayBuffer() });
  }
  // Classify by content, not name: Android's picker can hand over files without their real names.
  const cards = []; let failed = 0; const exps = []; const seen = []; let clubs = [], clubTypes = [];
  for (const e of entries) {
    const b = new Uint8Array(e.bytes); seen.push(e.name);
    const isFit = b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54; // ".FIT"
    if (isFit) {
      try { const sc = readScorecard(e.bytes, scorecardId(e.name)); cards.push(sc); } catch { try { const a = readActivity(e.bytes); if (a) acts.push(a); } catch { /* neither */ } }
    } else if (b[0] === 0x7b) { // "{"
      try {
        const j = JSON.parse(new TextDecoder().decode(b));
        if (j?.app === 'osolo-garmin') exps.push(j);
        else if (Array.isArray(j?.data) && j.data.some((c) => c?.clubTypeId != null)) clubs = j.data; // Golf-CLUB.json: the bag
        else if (Array.isArray(j?.data) && j.data.some((t) => t?.value != null && t?.name)) clubTypes = j.data; // Golf-CLUB_TYPES.json
      } catch { failed++; }
    }
  }
  // a card without a scorecard id in its name: key it by its start time so re-imports still dedupe
  cards.forEach((c) => { if (!c.id) c.id = `t${Math.round((c.start || 0) / 1000)}`; });
  if (!cards.length && !exps.length && !acts.length) {
    const list = seen.slice(0, 6).map((n) => n.split('/').pop()).join(', ');
    throw new Error(`No golf scorecards found${seen.length ? ` in ${seen.length} file${seen.length > 1 ? 's' : ''} (${list}${seen.length > 6 ? ', …' : ''})` : ''}. Choose the Garmin export zip, or the Golf-SCORECARD_RAWDATA files from DI_CONNECT/DI-GOLF.`);
  }
  const total = { added: 0, updated: 0, skipped: 0, newCourses: [], shots: 0, failed };
  const add = (r) => { total.added += r.added; total.updated += r.updated; total.skipped += r.skipped; total.shots += r.shots; r.newCourses.forEach((c) => total.newCourses.includes(c) || total.newCourses.push(c)); };
  for (const exp of exps) add(await importGarminExport(exp)); // shot-level rounds first: same ids win
  const names = bagNames(clubs, clubTypes);
  if (cards.length) add(await storeRounds((resolve) => convertScorecards(cards, resolve, { names })));
  if (acts.length) { progress(`Matching ${acts.length} golf activities to your rounds…`); total.hrRounds = await attachActivities(acts); total.activities = acts.length; }
  progress('Looking up the weather on each day…');
  total.weather = await backfillWeather().catch(() => 0);
  return total;
}

/** Golf activities → heart rate (once a minute, average, peak) and where it started, on the rounds they match. */
async function attachActivities(acts) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished);
  let n = 0;
  for (const a of acts) {
    const r = matchActivity(a, rounds); if (!r) continue;
    if (r.hrTrace?.length === a.trace.length && r.hrAct?.avg === a.avgHr) continue; // already there
    r.hrTrace = a.trace; r.hrAct = { avg: a.avgHr, max: a.maxHr, durationMin: a.durationMin };
    if (!r.hr) r.hr = { avg: a.avgHr, max: a.maxHr, n: a.trace.length, src: 'activity' };
    r.garmin = { ...(r.garmin || {}), lat: a.lat, lon: a.lon, durationMin: r.garmin?.durationMin ?? a.durationMin };
    r.updatedAt = Date.now(); await putRound(r); n++;
  }
  return n;
}

/** The weather on the day for rounds that don't have it (Garmin rounds, rounds logged without a connection). */
export async function backfillWeather({ limit = 120 } = {}) {
  const rounds = (await listRounds().catch(() => [])).filter((r) => r.finished && r.cond?.start?.tempC == null && r.date <= Date.now()).slice(0, limit);
  let n = 0; let q = 0;
  const one = async (r) => {
    let lat = r.garmin?.lat, lon = r.garmin?.lon;
    if (lat == null) { const c = await getCourse(r.courseId).catch(() => null); lat = c?.lat; lon = c?.lon; }
    if (lat == null) return;
    const w = await historicConditions(lat, lon, r.date, r.garmin?.durationMin || 240).catch(() => null);
    if (!w) return;
    r.cond = { ...(r.cond || {}), start: w, historic: true }; r.updatedAt = Date.now(); await putRound(r); n++;
  };
  const pool = Array.from({ length: 4 }, async () => { while (q < rounds.length) await one(rounds[q++]); });
  await Promise.all(pool);
  return n;
}

/** Convert and store: courses matched or created, rounds added unless already imported. */
export async function importGarminExport(exp) {
  return storeRounds((resolve) => convertExport(exp, resolve));
}

async function storeRounds(convert) {
  const [courses, library, rounds] = await Promise.all([listCourses().catch(() => []), loadLibrary().catch(() => []), listRounds().catch(() => [])]);
  const have = new Map(rounds.map((r) => [r.id, r]));
  const newCourses = []; const cache = new Map(); const snaps = new Map();
  const resolve = (snapshot) => { const key = snapshot?.name || '?'; if (!snaps.has(key) && snapshot) snaps.set(key, snapshot); if (cache.has(key)) return cache.get(key); const m = matchCourse(snapshot, { courses, library }); cache.set(key, m); return m; };
  const pending = new Map(); // placeholder course id → what to create (library course or one described by the card)
  const converted = convert((snap) => {
    const m = resolve(snap);
    if (m.kind === 'course') return m.course;
    if (m.kind === 'library') { const id = `lib:${m.lib.id}`; pending.set(id, m); return { id, name: m.lib.name, holes: (m.lib.par || Array(m.lib.holes || 18).fill(4)).map((p, i) => ({ par: p || 4, si: m.lib.si?.[i] ?? null })) }; }
    const id = `new:${m.spec.name}`; pending.set(id, m); return { id, name: m.spec.name, holes: m.spec.holes };
  });
  const made = new Map(); // placeholder (+ tee for library courses) → the course created for it
  let added = 0, updated = 0, skipped = 0, shots = 0;
  for (const r of converted) {
    const old = have.get(r.id);
    if (old) {
      // an earlier import without shots: take the shots now that osolo can read them, keep everything else
      const moreShots = (r.shotsTracked || 0) > (old.shotsTracked || 0), newHr = !!r.hr && !old.hr;
      if (old.source === 'garmin' && (moreShots || newHr) && old.holes?.length === r.holes.length) {
        const holes = old.holes.map((h, i) => (h && r.holes[i] ? { ...h, ...(moreShots ? { shots: r.holes[i].shots, firstPutt: h.firstPutt ?? r.holes[i].firstPutt, gir: h.gir ?? r.holes[i].gir, putts: h.putts ?? r.holes[i].putts } : {}), hr: r.holes[i].hr || h.hr } : h));
        await putRound({ ...old, holes, shotsTracked: Math.max(r.shotsTracked || 0, old.shotsTracked || 0), hr: r.hr || old.hr, garmin: { ...(old.garmin || {}), ...r.garmin }, updatedAt: Date.now() });
        updated++; shots += r.shotsTracked; continue;
      }
      skipped++; continue;
    }
    const m = pending.get(r.courseId);
    if (m) { // materialise library / new courses on first use, once each
      const key = m.kind === 'library' ? `${r.courseId}|${(r.tees || '').toLowerCase()}` : r.courseId;
      let c = made.get(key);
      if (!c && m.kind === 'library') {
        const tee = m.lib.tees?.find((t) => r.tees && t?.name?.toLowerCase() === r.tees.toLowerCase()) || m.lib.tees?.[0] || null;
        c = await importCourse(m.lib, tee);
      } else if (!c) {
        c = { id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: m.spec.name, tees: m.spec.tees || r.tees || '', rating: null, slope: null, holes: m.spec.holes };
        await putCourse(c);
      }
      if (!made.has(key)) { made.set(key, c); courses.push(c); if (!newCourses.includes(c.name)) newCourses.push(c.name); }
      r.courseId = c.id; r.courseName = c.name; if (m.kind === 'library') r.tees = c.tees || r.tees;
    }
    r.updatedAt = Date.now();
    await putRound(r); added++; shots += r.shotsTracked || 0;
  }
  return { added, updated, skipped, newCourses, shots };
}

// Settings → Garmin: how to run the export in Garmin Connect, then import the file. Rounds already
// imported (same Garmin scorecard id) are skipped, so re-importing after new rounds is safe.
import { BOOKMARKLET } from './bookmarklet.js';
import { convertExport, matchCourse } from './import.js';
import { listCourses, putCourse, listRounds, putRound } from '../store.js';
import { loadLibrary, importCourse } from '../rounds/library.js';
import { icon } from '../icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function garminSheet({ toast = () => {}, onImported = () => {} } = {}) {
  const sheet = document.createElement('div'); sheet.className = 'sheet itemsheet garmin';
  sheet.innerHTML = `<div class="sheet-in"><div class="sheet-h"><b>Import from Garmin</b><button class="link" data-close>Close</button></div>
    <p class="small" style="margin:0 0 8px">Garmin has no public golf API, so you export your own rounds from Garmin Connect in a browser (best on a computer), then load the file here. Scores, putts and, when the watch or CT10 sensors tracked shots, every shot with its club and where it finished.</p>
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
  q('[data-pick]').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'; inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files?.[0]; inp.remove(); if (!f) return;
      q('[data-out]').textContent = 'Importing…';
      try {
        const exp = JSON.parse(await f.text());
        const r = await importGarminExport(exp);
        q('[data-out]').innerHTML = `<b>Imported ${r.added} round${r.added === 1 ? '' : 's'}</b>${r.skipped ? ` (${r.skipped} already here)` : ''}${r.newCourses.length ? ` · new courses: ${r.newCourses.map(esc).join(', ')}` : ''}${r.shots ? ` · ${r.shots} tracked shots` : ''}.`;
        toast(`Garmin: ${r.added} rounds imported`); onImported(r);
      } catch (e) { q('[data-out]').textContent = e.message || String(e); }
    };
    inp.click();
  };
  document.body.appendChild(sheet);
}

/** Convert and store: courses matched or created, rounds added unless already imported. */
export async function importGarminExport(exp) {
  const [courses, library, rounds] = await Promise.all([listCourses().catch(() => []), loadLibrary().catch(() => []), listRounds().catch(() => [])]);
  const have = new Set(rounds.map((r) => r.id));
  const newCourses = []; const cache = new Map();
  const resolve = (snapshot) => { const key = snapshot?.name || '?'; if (cache.has(key)) return cache.get(key); const m = matchCourse(snapshot, { courses, library }); cache.set(key, m); return m; };
  const converted = convertExport(exp, (snap) => { const m = resolve(snap); return m.kind === 'course' ? m.course : m.kind === 'library' ? { id: `lib:${m.lib.id}`, name: m.lib.name, holes: m.lib.par.map((p, i) => ({ par: p || 4, si: m.lib.si?.[i] ?? null })) } : { id: `new:${m.spec.name}`, name: m.spec.name, holes: m.spec.holes }; });
  let added = 0, skipped = 0, shots = 0;
  for (const r of converted) {
    if (have.has(r.id)) { skipped++; continue; }
    // materialise library / new courses on first use
    if (r.courseId.startsWith('lib:')) { const m = resolve({ name: r.courseName }); const c = await importCourse(m.lib, m.lib.tees?.[0] || null); r.courseId = c.id; r.tees = c.tees || ''; courses.push(c); cache.set(r.courseName, { kind: 'course', course: c }); if (!newCourses.includes(c.name)) newCourses.push(c.name); }
    else if (r.courseId.startsWith('new:')) { const m = resolve({ name: r.courseName }); const c = { id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: m.spec.name, tees: '', rating: null, slope: null, holes: m.spec.holes }; await putCourse(c); r.courseId = c.id; courses.push(c); cache.set(r.courseName, { kind: 'course', course: c }); newCourses.push(c.name); }
    r.updatedAt = Date.now();
    await putRound(r); added++; shots += r.shotsTracked || 0;
  }
  return { added, skipped, newCourses, shots };
}

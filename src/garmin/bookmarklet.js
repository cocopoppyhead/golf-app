// The export the golfer runs in their own logged-in Garmin Connect tab. Garmin has no public golf
// API, so this fetches the same endpoints the Connect web app uses (scorecards, per-hole shots,
// clubs, club types) with the browser's own session and downloads one JSON file for osolo to
// import. osolo never sees a Garmin password. Endpoints as used by the community exporters
// (forums.garmin.com "Export Golf Scorecards" thread; gsingers/garmin_golf; etroulland/garmin-golf-analytics).
// Everything must be inline: Garmin's page CSP blocks loading outside scripts.
function garminExport() {
  const B = 'https://connect.garmin.com/modern/proxy/gcs-golfcommunity/api/v2';
  const H = { headers: { NK: 'NT', 'X-Requested-With': 'XMLHttpRequest', 'DI-Backend': 'connectapi.garmin.com', Accept: 'application/json' }, credentials: 'include' };
  const get = async (u) => { const r = await fetch(u, H); if (!r.ok) throw new Error(`${r.status} ${u.split('/v2/')[1]}`); return r.json(); };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#0b1120;color:#eef2fb;font:14px/1.4 system-ui;padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:320px';
  const say = (t) => { box.textContent = `osolo · ${t}`; };
  document.body.appendChild(box);
  (async () => {
    say('reading your clubs…');
    const [clubs, types] = await Promise.all([get(`${B}/club/player?per-page=1000&include-stats=false`).catch(() => []), get(`${B}/club/types`).catch(() => [])]);
    say('listing your rounds…');
    const sum = await get(`${B}/scorecard/summary?per-page=10000&user-locale=en`);
    const cards = (sum.scorecardSummaries || []).filter((s) => s.id);
    const rounds = [];
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]; say(`round ${i + 1} of ${cards.length}…`);
      try {
        const det = await get(`${B}/scorecard/detail?scorecard-ids=${c.id}&include-longest-shot-distance=true`);
        const d = det.scorecardDetails?.[0] || {};
        const sc = d.scorecard || {}; const holes = sc.holes || [];
        const nums = holes.map((h) => h.number).filter(Boolean);
        let shots = [];
        if (nums.length) {
          try { const r = await get(`${B}/shot/scorecard/${c.id}/hole?hole-numbers=${nums.join(',')}&image-size=IMG_730X730`); shots = r.holeShots || []; } catch { /* per hole below */ }
          if (!shots.length) for (const n of nums) { try { const r = await get(`${B}/shot/scorecard/${c.id}/hole?hole-numbers=${n}&image-size=IMG_730X730`); shots.push(...(r.holeShots || [])); } catch { /* no shots for this hole */ } }
        }
        rounds.push({ id: c.id, summary: c, scorecard: sc, stats: d.scorecardStats || null, course: det.courseSnapshots?.[0] || d.courseSnapshot || null, holeShots: shots });
      } catch (e) { rounds.push({ id: c.id, summary: c, error: String(e.message || e) }); }
    }
    const out = { app: 'osolo-garmin', version: 1, exportedAt: new Date().toISOString(), clubs, clubTypes: types, rounds };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `osolo-garmin-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    say(`done: ${rounds.length} rounds saved to your Downloads. Import the file in osolo → Settings → Garmin.`);
    setTimeout(() => box.remove(), 15000);
  })().catch((e) => { say(`could not export: ${e.message}. Are you signed in at connect.garmin.com?`); });
}

/** The bookmarklet URL, ready to copy into a bookmark's address. */
export const BOOKMARKLET = `javascript:(${garminExport.toString()})();`;
export { garminExport };

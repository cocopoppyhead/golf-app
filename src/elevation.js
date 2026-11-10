// Tee and green elevations per hole from Open-Meteo's elevation API (Copernicus 90 m DEM),
// fetched once per course and kept on the phone. Coarse, but enough to know a hole plays
// uphill or down; a laser with slope is better for the shot in hand.
const key = (id) => `golf.elev.${id}`;
const inflight = new Map();

/** points: [{ n, tee: [lat,lon], green: [lat,lon] }] → { n: { tee, green } } in metres, or {} if unavailable. */
export async function holeElevations(id, points) {
  if (!id || !points?.length) return {};
  try { const c = JSON.parse(localStorage.getItem(key(id)) || 'null'); if (c && points.every((p) => c[p.n])) return c; } catch {}
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    try {
      const lats = [], lons = [];
      for (const p of points) { lats.push(p.tee[0], p.green[0]); lons.push(p.tee[1], p.green[1]); }
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.map((v) => v.toFixed(5)).join(',')}&longitude=${lons.map((v) => v.toFixed(5)).join(',')}`);
      if (!r.ok) return {};
      const e = (await r.json()).elevation; if (!Array.isArray(e)) return {};
      const out = {}; points.forEach((p, i) => { out[p.n] = { tee: e[i * 2], green: e[i * 2 + 1] }; });
      try { localStorage.setItem(key(id), JSON.stringify(out)); } catch {}
      return out;
    } catch { return {}; } finally { inflight.delete(id); }
  })();
  inflight.set(id, job);
  return job;
}

/** Yards to add for a rise of `dm` metres (green above you = positive): about a yard per yard. */
export const elevationYards = (dm) => (Number.isFinite(dm) ? dm / 0.9144 : 0);

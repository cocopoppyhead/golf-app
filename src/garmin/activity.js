// Garmin activity files (DI_CONNECT/DI-Connect-Uploaded-Files in the account export: one FIT per
// activity the watch recorded). For a golf round they hold the wrist heart rate through the round,
// about once a second, and the GPS track. osolo keeps the heart rate once a minute, the round's
// average and peak, and where it started (for the weather on the day).
import { parseFit, fitDate, fitFileId } from './fit.js';

export const GOLF = 25; // FIT sport enum
const SEMI = 180 / 2 ** 31;
const KEEP = new Set([12, 18, 20]); // sport, session, record

/** Quick check from the first message: an activity file, and when it was made (ms). */
export function activityStamp(buf) {
  try { const id = fitFileId(buf); return id && id.type === 4 ? id.created : null; } catch { return null; }
}

/** A golf activity → { start, end, durationMin, avgHr, maxHr, trace: [[minute, bpm]], lat, lon }, or null if it isn't golf. */
export function readActivity(buf) {
  const msgs = parseFit(buf, { only: KEEP });
  const ses = msgs.find((m) => m.num === 18)?.fields;
  const sport = ses?.[5] ?? msgs.find((m) => m.num === 12)?.fields?.[0];
  if (sport !== GOLF) return null;
  const recs = msgs.filter((m) => m.num === 20 && m.fields[253] != null);
  const start = fitDate(ses?.[2] ?? recs[0]?.fields[253]);
  const end = ses?.[7] != null ? start + ses[7] : fitDate(recs[recs.length - 1]?.fields[253]);
  const perMin = new Map();
  for (const r of recs) {
    const hr = r.fields[3]; if (!hr || hr < 35 || hr > 230) continue;
    const m = Math.floor((fitDate(r.fields[253]) - start) / 60000); if (m < 0) continue;
    const b = perMin.get(m) || [0, 0]; b[0] += hr; b[1]++; perMin.set(m, b);
  }
  const trace = [...perMin.entries()].sort((a, b) => a[0] - b[0]).map(([m, [s, n]]) => [m, Math.round(s / n)]);
  const hrs = recs.map((r) => r.fields[3]).filter((x) => x >= 35 && x <= 230);
  const fix = recs.find((r) => r.fields[0] != null && r.fields[1] != null)?.fields;
  return {
    start, end, durationMin: end && start ? Math.round((end - start) / 60000) : null,
    avgHr: ses?.[16] || (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null),
    maxHr: ses?.[17] || (hrs.length ? Math.max(...hrs) : null),
    trace, lat: fix ? +(fix[0] * SEMI).toFixed(5) : null, lon: fix ? +(fix[1] * SEMI).toFixed(5) : null,
  };
}

/** The round an activity belongs to: the one that started within 3 hours of it. */
export function matchActivity(act, rounds) {
  let best = null, gap = 3 * 3600e3;
  for (const r of rounds) { const d = Math.abs((r.date || 0) - act.start); if (d < gap) { gap = d; best = r; } }
  return best;
}

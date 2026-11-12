// Heat through a round: temperature, humidity and an estimated heat-stress index hour by hour, matched to
// the holes. Heat in the Gulf isn't one number for a round: an early start can be humid and then hot, a
// 2 pm start can be brutal for 11 holes and fine after; the score follows. So the round keeps an hourly
// trace and each hole gets the hour it was played in.
//
// Heat stress is the Wet Bulb Globe Temperature (WBGT), the measure sport heat policies use because it
// counts humidity (sweat only cools when it evaporates). Without a globe thermometer we use the Australian
// Bureau of Meteorology's approximation from temperature and humidity, which assumes moderately strong sun
// and light wind (fine for a golf course in daylight; it can read low in still, humid air):
//   WBGT ≈ 0.567·T + 0.393·e + 3.94, e = vapour pressure in hPa
// Bands follow the Sports Medicine Australia guidance golf clubs use: under 21 low, 21–25 moderate,
// 26–29 high, 30 and over extreme (postpone or move to a cooler part of the day).

export const BANDS = [[30, 'extreme', 'Extreme'], [26, 'high', 'High'], [21, 'moderate', 'Moderate'], [-99, 'low', 'Low']];

/** Vapour pressure (hPa) from air temperature (°C) and relative humidity (%). */
const vapour = (t, rh) => (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));

/** Estimated WBGT (°C) from temperature and humidity (Bureau of Meteorology approximation). */
export function wbgt(tempC, rh) {
  if (tempC == null || rh == null) return null;
  return Math.round((0.567 * tempC + 0.393 * vapour(tempC, rh) + 3.94) * 10) / 10;
}

export function heatBand(w) {
  if (w == null) return null;
  const [, key, label] = BANDS.find(([min]) => w >= min);
  return { key, label };
}

/** A round has a real start time when it was logged live or came from a watch; a posted score has only a date. */
export const realStart = (r) => !!r && !r.quick && !['ghin', 'post', 'photo'].includes(r.source);

/** When the round ended, if known: the watch's duration, or the finish weather reading, or the last hole's time. */
export function roundEnd(r) {
  if (r.garmin?.durationMin) return r.date + r.garmin.durationMin * 60e3;
  const last = holeTimes(r, { raw: true }).filter(Boolean).pop();
  if (last) return last;
  if (r.cond?.finish?.at && r.cond.finish.at > r.date) return r.cond.finish.at;
  return null;
}

/**
 * When each hole was played (ms), or null. Order of trust: the time the hole was logged (h.at), the first
 * shot's own time (watch or rangefinder), else spread evenly between the real start and the real end.
 * Spread times are marked est. Nothing is invented for a round without a real start.
 */
export function holeTimes(r, { raw = false } = {}) {
  const holes = r?.holes || [];
  const own = holes.map((h) => (h ? h.at || h.shots?.find((s) => s?.t)?.t || null : null));
  if (raw) return own;
  if (!realStart(r)) return holes.map(() => null);
  const start = r.date, end = r.garmin?.durationMin ? r.date + r.garmin.durationMin * 60e3 : (r.cond?.finish?.at > r.date ? r.cond.finish.at : null);
  const played = holes.map((h, i) => (h?.score != null ? i : -1)).filter((i) => i >= 0);
  return holes.map((h, i) => {
    if (own[i]) return { t: own[i], est: false };
    if (h?.score == null || !end) return null;
    const k = played.indexOf(i);
    return { t: start + ((k + 0.5) / played.length) * (end - start), est: true };
  }).map((x) => (x && typeof x === 'object' ? x : x ? { t: x, est: false } : null));
}

/**
 * Hour-by-hour conditions from Open-Meteo for a stretch of time: [{ t, tempC, rh, wbC, feelsC, sun, windMph, wbgt }].
 * Recent days come from the forecast service (it keeps three months), older ones from the archive.
 */
export async function heatTrace(lat, lon, startMs, endMs) {
  if (lat == null || lon == null || !startMs || !endMs) return null;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const host = Date.now() - startMs < 80 * 864e5 ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const vars = 'temperature_2m,relative_humidity_2m,wet_bulb_temperature_2m,apparent_temperature,shortwave_radiation,wind_speed_10m';
  const url = `${host}?latitude=${(+lat).toFixed(3)}&longitude=${(+lon).toFixed(3)}&start_date=${day(startMs - 3600e3)}&end_date=${day(endMs + 3600e3)}&hourly=${vars}&wind_speed_unit=mph&timezone=GMT`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const H = (await res.json()).hourly || {};
  const out = [];
  (H.time || []).forEach((iso, i) => {
    const t = Date.parse(`${iso}:00Z`);
    if (t < startMs - 3600e3 || t > endMs + 3600e3) return;
    const tempC = H.temperature_2m?.[i], rh = H.relative_humidity_2m?.[i];
    out.push({ t, tempC, rh, wbC: H.wet_bulb_temperature_2m?.[i] ?? null, feelsC: H.apparent_temperature?.[i] ?? null, sun: H.shortwave_radiation?.[i] ?? null, windMph: H.wind_speed_10m?.[i] ?? null, wbgt: wbgt(tempC, rh) });
  });
  return out.length ? out : null;
}

/** The conditions for each hole: the trace hour nearest the hole's time. [{ wbgt, tempC, rh, band, est } | null]. */
export function holeHeat(r) {
  const trace = r?.heat?.trace;
  if (!trace?.length) return (r?.holes || []).map(() => null);
  return holeTimes(r).map((ht) => {
    if (!ht) return null;
    // between the two hours either side of the hole (the readings are hourly)
    const after = trace.findIndex((p) => p.t >= ht.t);
    if (after < 0 || (after === 0 && trace[0].t - ht.t > 90 * 60e3)) return null;
    const a = trace[Math.max(0, after - 1)], b = trace[after], f = b.t === a.t ? 0 : (ht.t - a.t) / (b.t - a.t);
    const mix = (k) => (a[k] == null || b[k] == null ? (b[k] ?? a[k]) : a[k] + (b[k] - a[k]) * f);
    const w = Math.round(mix('wbgt') * 10) / 10;
    return { wbgt: w, tempC: mix('tempC'), rh: mix('rh'), band: heatBand(w), est: ht.est, t: ht.t };
  });
}

/** The hottest heat-stress reading during the round, and when. */
export function roundPeak(r) {
  const hh = holeHeat(r).map((x, i) => (x ? { ...x, i } : null)).filter(Boolean);
  if (!hh.length) return null;
  return hh.reduce((a, b) => (b.wbgt > a.wbgt ? b : a));
}

/**
 * Score against heat stress across rounds, hole by hole: average to par in each band, so a round that
 * was brutal for 11 holes and fine for 7 counts each part where it belongs. list: [{ r, c }].
 */
export function heatByHole(list) {
  const acc = Object.fromEntries(BANDS.map(([, key, label]) => [key, { key, label, n: 0, sum: 0 }]));
  for (const { r, c } of list) {
    const hh = holeHeat(r);
    (r.holes || []).forEach((h, i) => {
      const x = hh[i]; if (!x || h?.score == null) return;
      const par = c?.holes?.[i]?.par || 4;
      acc[x.band.key].n++; acc[x.band.key].sum += h.score - par;
    });
  }
  return BANDS.map(([, key]) => acc[key]).filter((b) => b.n).map((b) => ({ ...b, toPar: b.sum / b.n }));
}

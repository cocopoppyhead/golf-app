// Weather for the shot: temperature, humidity, pressure and wind where you're standing (Open-Meteo,
// free, no key), and a "plays like" distance. One set of numbers, kept at standard conditions
// (25 °C / 77 °F, sea level, still air — TrackMan's Normalize defaults): every saved shot is
// converted to that day, and today's conditions are put back on top when you play. Coefficients
// are the published rules of thumb (TrackMan / Titleist / Andrew Rice), checked 10 Nov 2026:
//   temperature: ~1.5% per 20 °F (0.14% per °C) — 1 to 2 yards per 10 °F depending on the club
//   air pressure (altitude and weather): ~2% more carry per 1,000 ft (0.6 × the pressure drop)
//   humidity: under a yard across the whole range (humid air is slightly thinner)
//   wind: a headwind costs ~1% per mph, a tailwind adds ~0.5% per mph; crosswind mostly moves it sideways
// Not modelled: a cold ball (keep balls warm — Titleist), winter layers, flier lies.
import { isNative, nativeSend, onNative } from './native.js';

export const BASE_C = 25;
const TEMP_PER_C = 0.0014, HEAD_PER_MPH = 0.01, TAIL_PER_MPH = 0.005;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

let cache = null; // { at, lat, lon, cond }
let permAsked = false;
let permWait = null;
onNative('location.permission', (m) => { permWait?.(m.granted); permWait = null; });

async function position() {
  if (!navigator.geolocation) throw new Error('Location not available on this device.');
  // inside the app, Android needs the app-level permission first
  if (isNative() && !permAsked) {
    permAsked = true;
    await new Promise((r) => { permWait = r; nativeSend({ type: 'location.permission' }); setTimeout(() => r(true), 8000); });
  }
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => reject(new Error('Location is off, so no weather. Allow location for osolo.')), { timeout: 10000, maximumAge: 300000 }));
}

/** Current conditions at your position. Cached for 10 minutes. */
export async function getConditions({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 10 * 60e3) return cache.cond;
  const { lat, lon } = await position();
  const cond = await conditionsAt(lat, lon, { force: true });
  cache = { at: Date.now(), cond };
  return cond;
}

const atCache = new Map(); // 'lat,lon' -> { at, cond }
/**
 * Current conditions at a place (a course), no location permission needed. Also the sky: WMO weather
 * code, day or night, cloud cover — for the Play page's greeting. Cached for 10 minutes per place.
 */
export async function conditionsAt(lat, lon, { force = false } = {}) {
  const key = `${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
  const hit = atCache.get(key);
  if (!force && hit && Date.now() - hit.at < 10 * 60e3) return hit.cond;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${(+lat).toFixed(4)}&longitude=${(+lon).toFixed(4)}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day,cloud_cover&wind_speed_unit=mph`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Weather service unavailable.');
  const c = (await r.json()).current;
  const cond = { tempC: c.temperature_2m, humidity: c.relative_humidity_2m, pressure: c.surface_pressure, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, gustMph: c.wind_gusts_10m,
    code: c.weather_code ?? null, day: c.is_day == null ? null : !!c.is_day, cloud: c.cloud_cover ?? null, at: Date.now(), lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), source: 'open-meteo' };
  atCache.set(key, { at: Date.now(), cond });
  return cond;
}

/**
 * Wind relative to your shot. heading = compass direction you're aiming (from the Bushnell, if it sends it).
 * Without a heading, rel = 'into' | 'behind' | 'across' | null picked by hand.
 * Returns { head: mph (+ into you, − behind), cross: mph }.
 */
/**
 * The weather for a round already played (Open-Meteo's archive, hourly): the mean over the round's hours
 * and the hottest hour. Recent days come from the forecast service, older ones from the archive.
 */
export async function historicConditions(lat, lon, startMs, durationMin = 240) {
  if (lat == null || lon == null || !startMs) return null;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const end = startMs + (durationMin || 240) * 60e3;
  // the archive lags about five days; the forecast service keeps the last three months, so recent rounds use that
  const host = Date.now() - startMs < 80 * 864e5 ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const url = `${host}?latitude=${(+lat).toFixed(3)}&longitude=${(+lon).toFixed(3)}&start_date=${day(startMs)}&end_date=${day(end)}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=mph&timezone=GMT`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`weather archive ${r.status}`);
  const j = await r.json(); const H = j.hourly || {};
  const idx = (H.time || []).map((t, i) => [Date.parse(`${t}:00Z`), i]).filter(([t]) => t >= startMs - 3600e3 && t <= end).map(([, i]) => i);
  if (!idx.length) return null;
  const mean = (k) => Math.round((idx.reduce((a, i) => a + (H[k][i] ?? 0), 0) / idx.length) * 10) / 10;
  return { tempC: mean('temperature_2m'), maxC: Math.max(...idx.map((i) => H.temperature_2m[i] ?? -99)), humidity: Math.round(mean('relative_humidity_2m')), windMph: mean('wind_speed_10m'), at: startMs, lat: +(+lat).toFixed(3), lon: +(+lon).toFixed(3), source: 'open-meteo-archive' };
}

export function windComponents(cond, { heading = null, rel = null } = {}) {
  if (!cond) return { head: 0, cross: 0 };
  const w = cond.windMph || 0;
  if (heading != null && Number.isFinite(heading)) {
    const a = ((cond.windFrom - heading) * Math.PI) / 180;
    return { head: w * Math.cos(a), cross: w * Math.sin(a) };
  }
  if (rel === 'into') return { head: w, cross: 0 };
  if (rel === 'behind') return { head: -w, cross: 0 };
  if (rel === 'across') return { head: 0, cross: w };
  return { head: 0, cross: 0 };
}

/** How much further (>1) or shorter (<1) the ball carries in these conditions vs 25 °C, still air. */
export function carryFactor(cond, wind = { head: 0 }) {
  if (!cond) return 1;
  const t = 1 + TEMP_PER_C * ((cond.tempC ?? BASE_C) - BASE_C);
  const h = wind.head > 0 ? 1 - HEAD_PER_MPH * wind.head : 1 + TAIL_PER_MPH * -wind.head;
  // thinner air carries further: low pressure (altitude, weather) and, slightly, humid air
  const p = cond.pressure ? 1 + 0.6 * ((1013 - cond.pressure) / 1013) : 1;
  const rh = cond.humidity != null ? 1 + 0.003 * ((cond.humidity - 50) / 50) : 1;
  return t * Math.max(0.6, h) * p * rh;
}

/** The distance to play for a target in these conditions (what a normal-day club should carry). */
export const playsLike = (yards, factor) => yards / factor;
/** A distance hit in these conditions, converted back to a normal day (for learning your true distances). */
export const normalised = (yards, factor) => yards / factor;

export function condText(cond, wind = null, metric = false) {
  if (!cond) return '';
  const t = metric ? `${Math.round(cond.tempC)}°C` : `${Math.round(cond.tempC * 9 / 5 + 32)}°F`;
  const w = cond.windMph < 2 ? 'calm' : `${Math.round(cond.windMph)} mph from ${compass(cond.windFrom)}${cond.gustMph > cond.windMph + 5 ? ` (gusts ${Math.round(cond.gustMph)})` : ''}`;
  const rel = wind && (Math.abs(wind.head) >= 2 || Math.abs(wind.cross) >= 2)
    ? ` · ${Math.abs(wind.head) >= 2 ? `${Math.round(Math.abs(wind.head))} ${wind.head > 0 ? 'into you' : 'behind you'}` : ''}${Math.abs(wind.head) >= 2 && Math.abs(wind.cross) >= 2 ? ', ' : ''}${Math.abs(wind.cross) >= 2 ? `${Math.round(Math.abs(wind.cross))} across` : ''}` : '';
  return `${t} · ${w}${rel}`;
}

// Weather for the shot: temperature and wind where you're standing (Open-Meteo, free, no key),
// and a "plays like" distance. Rules of thumb (TrackMan-style averages, sea level):
//   temperature: carry changes ~0.2% per °C away from 25 °C (hot air is thinner, the ball flies further)
//   wind: a headwind costs ~1% per mph, a tailwind adds ~0.5% per mph; crosswind mostly moves it sideways
import { isNative, nativeSend, onNative } from './native.js';

export const BASE_C = 25;
const TEMP_PER_C = 0.002, HEAD_PER_MPH = 0.01, TAIL_PER_MPH = 0.005;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

let cache = null; // { at, lat, lon, cond }
let permAsked = false;
let permWait = null;
onNative('location.permission', (m) => { permWait?.(m.granted); permWait = null; });

function position() {
  return new Promise(async (resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location not available on this device.'));
    // inside the app, Android needs the app-level permission first
    if (isNative() && !permAsked) {
      permAsked = true;
      await new Promise((r) => { permWait = r; nativeSend({ type: 'location.permission' }); setTimeout(() => r(true), 8000); });
    }
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Location is off, so no weather. Allow location for osolo.')), { timeout: 10000, maximumAge: 300000 });
  });
}

/** Current conditions at your position. Cached for 10 minutes. */
export async function getConditions({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 10 * 60e3) return cache.cond;
  const { lat, lon } = await position();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather service unavailable.');
  const c = (await r.json()).current;
  const cond = { tempC: c.temperature_2m, humidity: c.relative_humidity_2m, pressure: c.surface_pressure, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, gustMph: c.wind_gusts_10m, at: Date.now(), lat: +lat.toFixed(4), lon: +lon.toFixed(4), source: 'open-meteo' };
  cache = { at: Date.now(), cond };
  return cond;
}

/**
 * Wind relative to your shot. heading = compass direction you're aiming (from the Bushnell, if it sends it).
 * Without a heading, rel = 'into' | 'behind' | 'across' | null picked by hand.
 * Returns { head: mph (+ into you, − behind), cross: mph }.
 */
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
  return t * Math.max(0.6, h);
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

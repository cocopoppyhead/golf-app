// Units: everything is stored in yards / inches internally and converted for display and input.
import { getSettings } from './store.js';

export const isMetric = () => getSettings().system === 'metric';
const YD_M = 0.9144, IN_CM = 2.54;

/** Golf distance (stored in yards) → display number in the chosen unit. */
export const dist = (yards) => (yards == null ? null : Math.round(isMetric() ? yards * YD_M : yards));
/** Display number typed by the user → yards for storage. */
export const toYards = (v) => (v == null || v === '' || !Number.isFinite(+v) || +v <= 0 ? null : isMetric() ? +v / YD_M : +v);
export const du = () => (isMetric() ? 'm' : 'y');       // short label after a number
export const duLong = () => (isMetric() ? 'metres' : 'yards');

/** Body measurement (stored in inches) → "3.5 in" or "9 cm". */
export const len = (inches) => (isMetric() ? `${Math.round(Math.abs(inches) * IN_CM)} cm` : `${Math.abs(inches).toFixed(1)} in`);
export const lenRange = (a, b) => (isMetric() ? `${Math.round(a * IN_CM)}–${Math.round(b * IN_CM)} cm` : `${a}–${b} in`);
export const lu = () => (isMetric() ? 'cm' : 'in');

/**
 * First-putt bands. Stored as one value in feet per band (the band's typical length, used for strokes
 * gained); older rounds stored 3/6/10/20/30/50 and fall into the band that contains them.
 * [ft stored, from, to] — to = null for the open-ended last band.
 */
export const PUTT_BANDS = [[2, 0, 2], [4, 3, 5], [7, 6, 9], [12, 10, 15], [18, 16, 20], [25, 21, 30], [35, 31, 40], [50, 41, null]];
export const PUTT_FT = PUTT_BANDS.map((b) => b[0]);
/** The band (its stored value) a first-putt length in feet falls in. */
export const puttBand = (ft) => (ft == null ? null : (PUTT_BANDS.find(([, a, b]) => b == null || ft <= b) || PUTT_BANDS[PUTT_BANDS.length - 1])[0]);
const M = { 2: '≤0.6', 4: '1–1.5', 7: '2–3', 12: '3–4.5', 18: '5–6', 25: '6.5–9', 35: '9.5–12', 50: '12+' };
export const puttLabel = (ft) => {
  const b = PUTT_BANDS.find((x) => x[0] === puttBand(ft)); if (!b) return '';
  if (isMetric()) return `${M[b[0]]} m`;
  return b[0] === 2 ? 'Tap-in' : b[2] == null ? '40+ ft' : `${b[1]}–${b[2]} ft`;
};
export const puttUnit = () => (isMetric() ? 'metres' : 'feet');

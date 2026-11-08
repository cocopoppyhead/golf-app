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

/** First-putt buttons: stored in feet, labelled in feet or metres. */
export const PUTT_FT = [3, 6, 10, 20, 30, 50];
export const puttLabel = (ft) => (isMetric() ? ({ 3: '1', 6: '2', 10: '3', 20: '6', 30: '9', 50: '12+' })[ft] : ft === 50 ? '40+' : String(ft));
export const puttUnit = () => (isMetric() ? 'metres' : 'feet');

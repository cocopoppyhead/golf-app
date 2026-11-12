// "Heat through the round" on the round summary: heat stress hole by hole, the score on each hole beneath
// it, and heart rate when the watch had it. One picture of the Els morning that turned brutal by the
// 15th, or the Creek afternoon that came good once the sun dropped.
import { holeHeat, roundPeak } from '../heat.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ZONES = [[30, 36, 'extreme'], [26, 30, 'high'], [21, 26, 'moderate'], [14, 21, 'low']];

export function heatCardHtml(r, c) {
  const hh = holeHeat(r);
  const idx = hh.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 6) return '';
  const n = (r.holes || []).length, W = 340, H = 150, L = 26, R = 8, top = 8, chartH = 78, barTop = top + chartH + 14, barH = 34;
  const x = (i) => L + ((i + 0.5) / n) * (W - L - R);
  const lo = 14, hi = 36, y = (w) => top + chartH - ((Math.max(lo, Math.min(hi, w)) - lo) / (hi - lo)) * chartH;
  const zones = ZONES.map(([a, b, k]) => `<rect x="${L}" y="${y(b).toFixed(1)}" width="${W - L - R}" height="${(y(a) - y(b)).toFixed(1)}" class="hz ${k}"/>`).join('');
  const line = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(hh[i].wbgt).toFixed(1)}`).join('');
  const dots = idx.map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(hh[i].wbgt).toFixed(1)}" r="2.6" class="hd ${hh[i].band.key}"/>`).join('');
  // heart rate on its own scale, faint
  const hrs = (r.holes || []).map((h) => h?.hr?.avg || null);
  const hrIdx = hrs.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  let hrLine = '';
  if (hrIdx.length >= 6) {
    const a = Math.min(...hrIdx.map((i) => hrs[i])) - 5, b = Math.max(...hrIdx.map((i) => hrs[i])) + 5;
    const yh = (v) => top + chartH - ((v - a) / (b - a)) * chartH;
    hrLine = `<path d="${hrIdx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${yh(hrs[i]).toFixed(1)}`).join('')}" class="hhr"/>`;
  }
  // score to par under each hole
  const bars = (r.holes || []).map((h, i) => {
    if (h?.score == null) return '';
    const d = h.score - (c?.holes?.[i]?.par || 4), mid = barTop + barH / 2, hgt = Math.min(2, Math.abs(d)) * (barH / 4);
    const cls = d < 0 ? 'b' : d === 0 ? 'p' : d === 1 ? 'o' : 'oo';
    return d === 0 ? `<rect x="${(x(i) - 5).toFixed(1)}" y="${(mid - 1).toFixed(1)}" width="10" height="2" class="hs p"/>` : `<rect x="${(x(i) - 5).toFixed(1)}" y="${(d > 0 ? mid : mid - hgt).toFixed(1)}" width="10" height="${hgt.toFixed(1)}" rx="1.5" class="hs ${cls}"/>`;
  }).join('');
  const ticks = [1, 6, 9, 10, 15, 18].filter((k) => k <= n).map((k) => `<text x="${x(k - 1).toFixed(1)}" y="${H - 2}" class="ht">${k}</text>`).join('');
  const ylab = [21, 26, 30].map((w) => `<text x="${L - 4}" y="${(y(w) + 3).toFixed(1)}" class="hy">${w}</text>`).join('');
  const pk = roundPeak(r);
  const est = idx.some((i) => hh[i].est);
  const time = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `<div class="card heatcard"><div class="sechead" style="margin:0 0 4px"><h2 style="margin:0">Heat through the round</h2></div>
    <svg viewBox="0 0 ${W} ${H}" class="heatsvg" role="img" aria-label="Heat stress and score by hole">${zones}${ylab}${hrLine}<path d="${line}" class="hl"/>${dots}<line x1="${L}" x2="${W - R}" y1="${barTop + barH / 2}" y2="${barTop + barH / 2}" class="hbase"/>${bars}${ticks}</svg>
    <p class="small mute hleg"><span><span class="sw"></span>Heat stress, estimated WBGT °C</span>${hrLine ? '<span><span class="sw hrsw"></span>Heart rate</span>' : ''}<span><span class="sw bar"></span>Score on each hole</span></p>
    ${pk ? `<p class="small">Peak <b>${pk.wbgt.toFixed(0)}</b> (${esc(pk.band.label.toLowerCase())}) on the ${pk.i + 1}${['st', 'nd', 'rd'][((pk.i + 1) % 10) - 1] && ![11, 12, 13].includes(pk.i + 1) ? ['st', 'nd', 'rd'][((pk.i + 1) % 10) - 1] : 'th'}, about ${time(pk.t)}: ${Math.round(pk.tempC)}°C at ${Math.round(pk.rh)}% humidity.</p>` : ''}
    ${pk && pk.wbgt >= 30 ? '<p class="small heatwarn">Extreme band: sport heat policies postpone play at this level. Feeling cold or shivery, nausea, dizziness or confusion in heat are warning signs of heat exhaustion: stop, get into shade, cool down, and get help if it doesn\'t pass.</p>' : ''}
    ${est ? '<p class="small mute">Hole times spread between your start and finish where the hole wasn\'t timed.</p>' : ''}
  </div>`;
}

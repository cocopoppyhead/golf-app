// osolo's analysis engine: the golfer's own data cut every way the app can, so the coach arrives with
// the answers instead of working them out on the spot. Every logged shot and putt becomes a row with
// its context (distance, lie, swing length, club, the greens, wind, heat, the round's kind and aim,
// mood and energy, where in the round, after a bad hole...), and the engine looks for the cuts where
// the result really changes: wedges 70% from full swings and 20% from ¾; 60% on soft greens and 30% on
// firm; putts from 6 ft holed 80% calm and 50% after a double. Only differences with enough shots on
// both sides are reported, biggest first. It doesn't decide what to do; it shows where the game
// changes, and the coach (and the golfer) work out why and what to try.
import { holeHeat } from '../heat.js';
import { LONG_FROM } from '../rounds/radar.js';
import { LIE_NAMES, LIE_FROM } from '../rounds/hole.js';

const GREEN = new Set(['G', 'HO']);
const MIN_N = 5;     // shots on each side of a difference
const MIN_GAP = 15;  // percentage points

const band = (d, step) => (d == null ? null : `${Math.floor(d / step) * step}-${Math.floor(d / step) * step + step - 1}`);
const SW = { full: 'full swing', '3q': '¾ swing', half: '½ swing', pitch: 'pitch', chip: 'chip', punch: 'punch', splash: 'bunker splash' };
const wind = (mph) => (mph == null ? null : mph < 8 ? 'calm' : mph < 16 ? 'breezy' : 'windy');
const stretch = (i) => (i < 3 ? 'holes 1-3' : i >= 15 ? 'holes 16-18' : 'holes 4-15');
const moodBand = (m) => (!m ? null : m <= 3 ? 'flat (1-3)' : m <= 7 ? 'settled (4-7)' : 'up (8-10)');

/** Every logged shot (by hand) and putt, with its context. rcs: [{ r, c }]. */
export function rows(rcs) {
  const shots = [], putts = [];
  for (const { r, c } of rcs) {
    if (r.quick) continue;
    const heat = holeHeat(r);
    const ctx0 = {
      kind: r.kind === 'comp' ? 'competition' : r.kind === 'casual' ? 'casual' : null,
      aim: { low: 'shooting low', fun: 'for fun', both: 'low and fun' }[r.aim] || null,
      firm: r.greens?.firm ? `${r.greens.firm} greens` : null,
      speed: r.greens?.speed ? `${r.greens.speed} greens` : null,
      wind: wind(r.cond?.start?.windMph),
      energy: r.energy ? `energy ${r.energy}` : null,
      mood: moodBand(r.mood?.start),
      warmup: r.warmup ? (r.warmup === 'none' ? 'no warm-up' : 'warmed up') : null,
      course: r.courseName ? r.courseName.split(/\s[–-]\s/)[0] : null,
    };
    let prevToPar = null;
    (r.holes || []).forEach((h, i) => {
      const par = c?.holes?.[i]?.par || 4;
      if (!h || h.score == null) { prevToPar = null; return; }
      const ctx = { ...ctx0, nine: i < 9 ? 'front nine' : 'back nine', stretch: stretch(i), after: prevToPar == null ? null : prevToPar >= 2 ? 'after a double or worse' : prevToPar >= 1 ? 'after a bogey' : 'after par or better', heat: heat[i]?.band ? `${heat[i].band.label.toLowerCase()} heat` : null };
      (h.shots || []).forEach((x, k) => {
        if (!x || x.src === 'garmin') return;
        const tee = k === 0 && par >= 4;
        const area = tee ? 'ott' : x.dist == null ? null : x.dist < 30 ? 'arg' : x.dist < LONG_FROM ? 'appW' : x.dist < 260 ? 'appL' : null;
        if (!area || (!x.res && !x.pen)) return;
        const ok = tee ? x.res === 'FW' : GREEN.has(x.res);
        shots.push({ area, ok, ...ctx, lie: tee ? null : (LIE_NAMES[x.lie || x.lieAuto || (k > 0 ? LIE_FROM[h.shots[k - 1]?.res2 || h.shots[k - 1]?.res] : null)] || '').toLowerCase() || null, swing: tee ? null : SW[x.sw] || (x.sw ? null : 'full swing'), club: x.d?.club || null, dist: tee ? null : `${band(x.dist, area === 'arg' ? 10 : 25)} yd` });
      });
      (h.puttList || []).forEach((p, j) => {
        if (!p || p.ft == null) return;
        const ft = p.ft <= 3 ? '0-3 ft' : p.ft <= 8 ? '4-8 ft' : p.ft <= 15 ? '9-15 ft' : p.ft <= 30 ? '16-30 ft' : '31 ft+';
        const read = { RL: 'breaking right to left', LR: 'breaking left to right', S: 'straight', X: 'double break' }[p.brk] || null;
        const slope = { up: 'uphill', dn: 'downhill', flat: 'flat' }[p.sl] || null;
        putts.push({ ok: !!p.holed, ft, read, slope, first: j === 0 ? 'first putt' : 'second putt or later', ...ctx });
      });
      prevToPar = h.score - par;
    });
  }
  return { shots, putts };
}

const DIMS = { shot: ['swing', 'dist', 'lie', 'club', 'firm', 'speed', 'wind', 'heat', 'kind', 'aim', 'energy', 'mood', 'warmup', 'nine', 'stretch', 'after', 'course'], putt: ['read', 'slope', 'firm', 'speed', 'wind', 'heat', 'kind', 'energy', 'mood', 'nine', 'stretch', 'after', 'course'] };
const DIM_NAME = { swing: 'swing length', dist: 'distance', lie: 'lie', club: 'club', firm: 'the greens', speed: 'green speed', wind: 'wind', heat: 'heat', kind: 'kind of round', aim: 'aim for the day', energy: 'energy', mood: 'mood at the start', warmup: 'warm-up', nine: 'nine', stretch: 'part of the round', after: 'the hole before', course: 'course', read: 'the read', slope: 'slope' };

/** The cuts where the result changes: [{ dim, groups: [{ v, n, pct }], gap, weight }], biggest first. */
export function splits(list, dims) {
  const out = [];
  for (const dim of dims) {
    const g = new Map();
    for (const x of list) { const v = x[dim]; if (v == null) continue; const a = g.get(v) || { v, n: 0, ok: 0 }; a.n++; if (x.ok) a.ok++; g.set(v, a); }
    const groups = [...g.values()].filter((a) => a.n >= MIN_N).map((a) => ({ ...a, pct: Math.round((100 * a.ok) / a.n) })).sort((a, b) => b.pct - a.pct);
    if (groups.length < 2) continue;
    const gap = groups[0].pct - groups[groups.length - 1].pct;
    if (gap < MIN_GAP) continue;
    out.push({ dim, groups, gap, weight: gap * Math.sqrt(Math.min(groups[0].n, groups[groups.length - 1].n)) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

const AREA_NAME = { ott: ['Driving', 'fairways'], appL: [`Long approaches (${LONG_FROM}+ yd)`, 'greens'], appW: [`Wedges (30-${LONG_FROM - 1} yd)`, 'greens'], arg: ['Short game (inside 30 yd)', 'greens'] };
const line = (s) => `by ${DIM_NAME[s.dim]}: ${s.groups.map((g) => `${g.v} ${g.pct}% (${g.n})`).join(', ')}`;

/** The engine's findings for the coach, areas in the order given (the biggest leak first). */
export function engineText(rcs, { order = ['appW', 'appL', 'ott', 'arg', 'putt'], perArea = 4 } = {}) {
  const { shots, putts } = rows(rcs);
  if (shots.length + putts.length < 30) return '';
  const out = ['ANALYSIS (osolo\'s engine: where their results change, from their own logged shots; percentages with the number of shots in brackets)'];
  for (const a of order) {
    if (a === 'putt') {
      const P = putts.filter((p) => p.ft === '4-8 ft' || p.ft === '9-15 ft');
      if (P.length >= 20) { const S = splits(P, DIMS.putt).slice(0, perArea); out.push(`Putts from 4-15 ft, holed ${Math.round((100 * P.filter((p) => p.ok).length) / P.length)}% (${P.length})${S.length ? `; ${S.map(line).join('; ')}` : ': no big differences yet'}.`); }
      continue;
    }
    const L = shots.filter((x) => x.area === a);
    if (L.length < 15) continue;
    const [name, what] = AREA_NAME[a];
    const S = splits(L, DIMS.shot).slice(0, perArea);
    out.push(`${name}: ${what} ${Math.round((100 * L.filter((x) => x.ok).length) / L.length)}% (${L.length})${S.length ? `; ${S.map(line).join('; ')}` : ': no big differences yet'}.`);
  }
  if (out.length === 1) return '';
  out.push('These are differences, not causes. Use them to ask better questions and to suggest what to test; the golfer often knows why.');
  return out.join('\n');
}

// What the rounds and the practice log say about one club: how it's used on the course (tee
// shots, approaches, misses, penalties, strokes gained per shot), what the golfer thought of the
// shots, the lies that went wrong, practice on its area, and the strengths and weaknesses that fall
// out when all that is set against the golfer's handicap level and scratch. Pure functions.
import { holeSG } from './rounds/sg.js';
import { benchFor, scratch, levelLabel } from './benchmarks.js';
import { BANDS, bandLabel } from './rounds/bands.js';

const KIND = (name) => (/driver/i.test(name) ? 'driver' : /wood/i.test(name) ? 'wood' : /hybrid|rescue|utility/i.test(name) ? 'hybrid' : /iron|\d\s*i$/i.test(name) ? 'iron' : /putter/i.test(name) ? 'putter' : 'wedge');
export const clubArea = (club) => ({ driver: 'driver', wood: 'driver', hybrid: 'irons', iron: 'irons', wedge: 'wedges', putter: 'putting' })[KIND(club)];
const GREEN = new Set(['G', 'HO']);
const TROUBLE = new Set(['LT', 'RT', 'TR', 'PN', 'WT', 'OB']);

/**
 * On-course record for a club over rounds [{ r, c }]: counts, rates, misses, SG per shot.
 * Only shots whose Details name the club count, so this is as good as the golfer's logging.
 */
export function clubOnCourse(rounds, club) {
  const S = { club, n: 0, rounds: new Set(), tee: { n: 0, fw: 0, left: 0, right: 0, trouble: 0, pen: 0, lengths: [] }, app: { n: 0, green: 0, short: 0, long: 0, left: 0, right: 0, pen: 0, byBand: {}, firstPutts: [] }, sg: { sum: 0, n: 0 }, plan: { n: 0, yes: 0 }, sat: { n: 0, sum: 0 }, lies: {}, last: 0 };
  for (const { r, c } of rounds) {
    if (!r?.holes || !c?.holes) continue;
    r.holes.forEach((h, i) => {
      if (!h?.shots?.length || h.score == null) return;
      const par = c.holes[i]?.par ?? 4, yds = c.holes[i]?.yds;
      let G = null;
      h.shots.forEach((x, k) => {
        if (!x || x.d?.club !== club) return;
        S.n++; S.rounds.add(r.id); S.last = Math.max(S.last, r.date || 0);
        if (G === null) G = h.putts != null ? holeSG({ ...h, shots: h.shots.map((s) => ({ ...s, lie: s.lie || s.lieAuto })) }, par, yds) : false;
        if (G && G.shots?.[k]) { S.sg.sum += G.shots[k].sg; S.sg.n++; }
        if (x.d.plan === true || x.d.plan === false) { S.plan.n++; if (x.d.plan) S.plan.yes++; }
        if (x.d.sat) { S.sat.n++; S.sat.sum += x.d.sat; }
        const bad = x.d.plan === false || x.d.cost > 0 || (x.d.sat && x.d.sat <= 2);
        for (const l of x.d.lies || []) { const m = (S.lies[l] ||= { n: 0, bad: 0 }); m.n++; if (bad) m.bad++; }
        if (k === 0 && par >= 4) {
          const t = S.tee; t.n++;
          if (x.res === 'FW') t.fw++;
          if (x.res === 'LR' || x.res === 'LT') t.left++; if (x.res === 'RR' || x.res === 'RT') t.right++;
          if (TROUBLE.has(x.res) || ['FB', 'WS', 'PN', 'WT', 'OB'].includes(x.res2) || x.pen) t.trouble++;
          if (x.pen || ['PN', 'WT', 'OB'].includes(x.res2)) t.pen++;
          const next = h.shots[1];
          if (x.flew) t.lengths.push(x.flew); else if (yds && next?.dist != null && next.dist < yds) t.lengths.push(yds - next.dist);
        } else if (x.dist != null && x.dist >= 30) {
          const a = S.app; a.n++;
          const band = BANDS.find(([lo, hi]) => x.dist >= lo && x.dist < hi);
          const key = band ? bandLabel(band) : '250+';
          const b = (a.byBand[key] ||= { n: 0, green: 0 }); b.n++;
          if (GREEN.has(x.res)) { a.green++; b.green++; if (k === h.shots.length - 1 && h.firstPutt != null) a.firstPutts.push(h.firstPutt); }
          if (x.dir === 'S') a.short++; if (x.dir === 'L') a.long++; if (x.dir === 'LF') a.left++; if (x.dir === 'R') a.right++;
          if (x.pen || ['PN', 'WT', 'OB'].includes(x.res)) a.pen++;
        }
      });
    });
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  return {
    ...S, rounds: S.rounds.size,
    fir: S.tee.n ? S.tee.fw / S.tee.n : null, teeTrouble: S.tee.n ? S.tee.trouble / S.tee.n : null, drive: med(S.tee.lengths),
    gir: S.app.n ? S.app.green / S.app.n : null, proximity: avg(S.app.firstPutts),
    sgPerShot: S.sg.n ? S.sg.sum / S.sg.n : null, planned: S.plan.n ? S.plan.yes / S.plan.n : null, satisfaction: S.sat.n ? S.sat.sum / S.sat.n : null,
  };
}

/**
 * Strengths and weaknesses for the club against the golfer's level and scratch. Returns
 * [{ kind: 'strength'|'weakness'|'note', text }], strongest claims first; nothing below the sample floors.
 */
export function clubVerdicts(S, { hcp = null, practice = null } = {}) {
  const L = benchFor(hcp), Z = scratch(), lvl = levelLabel(hcp);
  const out = [];
  const pc = (x) => `${Math.round(x * 100)}%`;
  const k = KIND(S.club);
  if ((k === 'driver' || k === 'wood' || k === 'hybrid') && S.tee.n >= 8) {
    if (S.fir >= L.fir + 0.08) out.push({ kind: 'strength', text: `${pc(S.fir)} fairways off the tee with it — a ${lvl} averages ${pc(L.fir)}, scratch ${pc(Z.fir)}.` });
    else if (S.fir <= L.fir - 0.08) out.push({ kind: 'weakness', text: `${pc(S.fir)} fairways with it; a ${lvl} averages ${pc(L.fir)}. That's the number to move.` });
    if (S.teeTrouble >= L.teeTrouble + 0.08) out.push({ kind: 'weakness', text: `${pc(S.teeTrouble)} of its tee shots need a recovery (trees, hazard, fairway bunker, lost) — ${pc(L.teeTrouble)} for a ${lvl}. Pick the safe side; those cost more than a missed fairway.` });
    else if (S.teeTrouble <= L.teeTrouble - 0.06) out.push({ kind: 'strength', text: `${S.teeTrouble === 0 ? 'None of its tee shots found trouble' : `Only ${pc(S.teeTrouble)} of its tee shots find trouble`} (${pc(L.teeTrouble)} is normal for a ${lvl}): it keeps you in play.` });
    const miss = S.tee.left + S.tee.right;
    if (miss >= 6 && Math.max(S.tee.left, S.tee.right) / miss >= 0.7) { const side = S.tee.right > S.tee.left ? 'right' : 'left'; out.push({ kind: 'note', text: `${Math.max(S.tee.left, S.tee.right) === miss ? `Every miss went ${side} (${miss})` : `Misses go ${side}: ${Math.max(S.tee.left, S.tee.right)} of ${miss}`}. Aim with that: when the trouble is ${side}, it's not the club.` }); }
    if (S.drive != null && S.tee.lengths.length >= 6) {
      if (S.drive >= L.driveYd + 12) out.push({ kind: 'strength', text: `Typical drive ${S.drive} yd — ${Math.round(S.drive - L.driveYd)} past a ${lvl}'s ${Math.round(L.driveYd)}${S.drive >= Z.driveYd ? ', scratch length' : ''}.` });
      else if (S.drive <= L.driveYd - 15) out.push({ kind: 'weakness', text: `Typical drive ${S.drive} yd against ${Math.round(L.driveYd)} for a ${lvl}: distance, not accuracy, is the gap here.` });
    }
  }
  const gk = k === 'wedge' ? 'girFrom100' : 'gir', gWhat = k === 'wedge' ? 'from 100 yards' : 'overall';
  if (S.app.n >= 8) {
    if (S.gir >= L[gk] + 0.1) out.push({ kind: 'strength', text: `${pc(S.gir)} greens with it; a ${lvl} hits ${pc(L[gk])} ${gWhat}, scratch ${pc(Z[gk])}.` });
    else if (S.gir <= L[gk] - 0.1) out.push({ kind: 'weakness', text: `${pc(S.gir)} greens with it against ${pc(L[gk])} ${gWhat} for a ${lvl}.` });
    const misses = S.app.short + S.app.long + S.app.left + S.app.right;
    if (misses >= 6) {
      const m = [['short', S.app.short], ['long', S.app.long], ['left', S.app.left], ['right', S.app.right]].sort((a, b) => b[1] - a[1])[0];
      if (m[1] / misses >= 0.5) out.push({ kind: m[0] === 'short' ? 'weakness' : 'note', text: `${m[1]} of ${misses} misses are ${m[0]}${m[0] === 'short' ? ' — one more club, or it is not flying the number you have in the Bag' : ''}.` });
    }
    if (S.proximity != null && S.app.firstPutts.length >= 6) {
      if (S.proximity <= L.proximityFt - 8) out.push({ kind: 'strength', text: `When it finds the green the first putt averages ${Math.round(S.proximity)} ft; ${Math.round(L.proximityFt)} ft is normal for a ${lvl}, ${Math.round(Z.proximityFt)} for scratch.` });
      else if (S.proximity >= L.proximityFt + 10) out.push({ kind: 'weakness', text: `First putts after it average ${Math.round(S.proximity)} ft (${Math.round(L.proximityFt)} ft for a ${lvl}): on the green, but not close.` });
    }
    if (S.app.pen >= 2 && S.app.pen / S.app.n >= 0.1) out.push({ kind: 'weakness', text: `${S.app.pen} penalties in ${S.app.n} approaches with it: the aggressive line is costing you.` });
  }
  if (S.sg.n >= 10) out.push({ kind: S.sgPerShot >= -0.05 ? 'strength' : S.sgPerShot <= -0.25 ? 'weakness' : 'note', text: `Strokes gained ${S.sgPerShot >= 0 ? '+' : ''}${S.sgPerShot.toFixed(2)} per shot against the tour baseline over ${S.sg.n} shots${S.sgPerShot <= -0.25 ? ' — it is where rounds leak' : S.sgPerShot >= -0.05 ? ' — tour-level for a club' : ''}.` });
  if (S.plan.n >= 8 && S.planned <= 0.45) out.push({ kind: 'weakness', text: `Only ${pc(S.planned)} of its shots came off as planned (${S.plan.n} rated). Either the plan or the shot has to change.` });
  for (const [l, m] of Object.entries(S.lies)) if (m.n >= 4 && m.bad / m.n >= 0.6) out.push({ kind: 'weakness', text: `${LIE_WORD[l] || l}: ${m.bad} of ${m.n} went wrong with this club. Practise that lie, not flat ones.` });
  if (practice) {
    if (practice.sessions30 === 0 && (out.some((o) => o.kind === 'weakness'))) out.push({ kind: 'note', text: `No practice logged on ${practice.area} in the last 30 days.` });
    else if (practice.trend?.delta != null && practice.trend.delta >= 0.08) out.push({ kind: 'strength', text: `${practice.area} drills are trending up (${Math.round(practice.trend.delta * 100)}% better than your previous attempts).` });
    else if (practice.trend?.delta != null && practice.trend.delta <= -0.08) out.push({ kind: 'note', text: `${practice.area} drill scores have slipped ${Math.round(-practice.trend.delta * 100)}% against your previous attempts.` });
  }
  const rank = { weakness: 0, strength: 1, note: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
const LIE_WORD = { abv: 'Ball above feet', blw: 'Ball below feet', up: 'Uphill lies', dn: 'Downhill lies', fc: 'First cut', hvy: 'Heavy rough', fly: 'Flyer lies', div: 'Divots', hp: 'Hardpan', wet: 'Wet lies' };

/** Rows for the "against your level" table: [{ label, you, level, scratch, higherBetter }], only what the club has data for. */
export function levelRows(S, hcp) {
  const L = benchFor(hcp), Z = scratch();
  const rows = [];
  const pc = (x) => (x == null ? null : `${Math.round(x * 100)}%`);
  const k = KIND(S.club);
  if (S.tee.n >= 3 && (k === 'driver' || k === 'wood' || k === 'hybrid')) {
    rows.push({ label: 'Fairways', you: pc(S.fir), level: pc(L.fir), scratch: pc(Z.fir), better: S.fir != null ? Math.sign(S.fir - L.fir) : 0, n: S.tee.n });
    rows.push({ label: 'Tee shots in trouble', you: pc(S.teeTrouble), level: pc(L.teeTrouble), scratch: pc(Z.teeTrouble), better: S.teeTrouble != null ? Math.sign(L.teeTrouble - S.teeTrouble) : 0, n: S.tee.n });
    if (S.drive != null) rows.push({ label: 'Typical drive', you: `${S.drive} yd`, level: `${Math.round(L.driveYd)} yd`, scratch: `${Math.round(Z.driveYd)} yd`, better: Math.sign(S.drive - L.driveYd), n: S.tee.lengths.length });
  }
  if (S.app.n >= 3) {
    const gk = k === 'wedge' ? 'girFrom100' : 'gir';
    rows.push({ label: k === 'wedge' ? 'Greens hit (vs from 100 yd)' : 'Greens hit (vs all approaches)', you: pc(S.gir), level: pc(L[gk]), scratch: pc(Z[gk]), better: S.gir != null ? Math.sign(S.gir - L[gk]) : 0, n: S.app.n });
    if (S.proximity != null) rows.push({ label: 'First putt after it', you: `${Math.round(S.proximity)} ft`, level: `${Math.round(L.proximityFt)} ft`, scratch: `${Math.round(Z.proximityFt)} ft`, better: Math.sign(L.proximityFt - S.proximity), n: S.app.firstPutts.length });
  }
  return rows;
}

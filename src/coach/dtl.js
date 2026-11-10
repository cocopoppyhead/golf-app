// Down-the-line (from behind) analysis: posture, knee flex, spine angle kept, head height, early extension, balance.
// Same pose track and checkpoints as face-on; different measurements.
import { L, hands, hipC, shC, headC } from './phases.js';
import { headBox, summarise } from './metrics.js';
import { len, lenRange } from '../units.js';

const deg = (r) => (r * 180) / Math.PI;
const angleAt = (a, b, c) => { // angle ABC in degrees
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)))));
};

const CLUB = { // forward bend at address (deg from vertical)
  driver: [28, 42], wood: [30, 44], iron: [33, 47], wedge: [35, 50],
};

export function analyseDTL(fr, ph, { club = 'iron', heightIn = 70 } = {}) {
  const A = fr[ph.address].lm, TP = fr[ph.top].lm, IM = fr[ph.impact].lm, FN = fr[ph.finish].lm;
  // Which way is the ball? Hands hang in front of the body at address.
  const b = Math.sign(hands(A).x - hipC(A).x) || 1;
  // Scale from leg length (shoulder width is foreshortened side-on)
  const leg = ((A[L.lAn].y - A[L.lHip].y) + (A[L.rAn].y - A[L.rHip].y)) / 2;
  const S = (0.46 * heightIn) / (leg || 1);
  const inch = (px) => px * S;
  // forward bend: angle of hip→shoulder line from vertical, positive = toward ball
  const bend = (lm) => deg(Math.atan2((shC(lm).x - hipC(lm).x) * b, hipC(lm).y - shC(lm).y));
  const knee = (lm) => { const l = 180 - angleAt(lm[L.lHip], lm[L.lKn], lm[L.lAn]), r = 180 - angleAt(lm[L.rHip], lm[L.rKn], lm[L.rAn]); return (l + r) / 2; };
  const headDrop = (lm) => inch(headC(lm).y - headC(A).y); // + = head lower
  const towardBall = (lm) => inch((hipC(lm).x - hipC(A).x) * b); // + = hips moved toward ball (early extension)
  const B = CLUB[club] || CLUB.iron;
  const g = (v, lo, hi, soft) => (v >= lo && v <= hi ? 'good' : (v < lo ? lo - v : v - hi) <= soft ? 'ok' : 'work');
  const hd = (v) => (Math.abs(v) < 0.4 ? 'level' : v > 0 ? `${len(v)} lower` : `${len(v)} higher`);

  const bend0 = bend(A), knee0 = knee(A);
  const base = { head: headC(A), hip: hipC(A), box: headBox(A), ball: null, bend: bend0, ballSide: b };
  const spineLen = Math.hypot(shC(A).x - hipC(A).x, shC(A).y - hipC(A).y);

  const bTop = bend(TP), bImp = bend(IM), bFin = bend(FN);
  const hTop = headDrop(TP), hImp = headDrop(IM);
  const ee = towardBall(IM);
  const feetX = (FN[L.lAn].x + FN[L.rAn].x) / 2;
  const overFeet = inch(Math.abs(hipC(FN).x - feetX));

  const checkpoints = [
    { key: 'address', title: 'Address', frame: ph.address, items: [
      { name: 'Posture', you: `${Math.round(bend0)}° forward bend`, pro: `${B[0]}–${B[1]}° from the hips`, status: g(bend0, B[0], B[1], 5), value: bend0 },
      { name: 'Knee flex', you: `${Math.round(knee0)}° bend`, pro: '15–35°, athletic', status: g(knee0, 15, 35, 6), value: knee0 },
    ], marks: [] },
    { key: 'top', title: 'Top', frame: ph.top, items: [
      { name: 'Spine angle', you: `${Math.round(bTop)}° (address ${Math.round(bend0)}°)`, pro: 'Within 5° of address', status: g(bend0 - bTop, -5, 5, 5), value: bTop - bend0 },
      { name: 'Head height', you: hd(hTop), pro: `Level (within ${lenRange(0, 1.5).split('–')[1]})`, status: g(Math.abs(hTop), 0, 1.5, 1.5), value: hTop },
    ], marks: [{ type: 'spine', from: hipC(TP), angle: bend0, target: -b, len: spineLen }, { type: 'hline', y: base.head.y, label: 'PRO: head stays level' }] },
    { key: 'impact', title: 'Impact', frame: ph.impact, items: [
      { name: 'Early extension', you: ee > 0.4 ? `Hips ${len(ee)} toward the ball` : 'Hips stayed back', pro: `Hips stay back (under ${lenRange(0, 1).split('–')[1]})`, status: ee <= 1 ? 'good' : ee <= 2.5 ? 'ok' : 'work', value: ee },
      { name: 'Spine angle', you: `${Math.round(bImp)}° (address ${Math.round(bend0)}°)`, pro: 'Within 5° of address', status: g(bend0 - bImp, -5, 5, 5), value: bImp - bend0 },
      { name: 'Head height', you: hd(hImp), pro: 'Level, or slightly lower', status: g(hImp, -1.5, 2, 1.5), value: hImp },
    ], marks: [{ type: 'spine', from: hipC(IM), angle: bend0, target: -b, len: spineLen }] },
    { key: 'finish', title: 'Finish', frame: ph.finish, items: [
      { name: 'Balance', you: `${bFin < 25 ? 'Tall' : 'Still bent over'}, hips ${overFeet < 4 ? 'over your feet' : `${len(overFeet)} off your feet`}`, pro: 'Tall and balanced', status: bFin < 25 && overFeet < 4 ? 'good' : bFin < 35 && overFeet < 7 ? 'ok' : 'work', value: overFeet },
    ], marks: [] },
  ];

  return {
    view: 'dtl', scale: S, base, target: -b, club, checkpoints, summary: summarise(checkpoints, 'dtl'),
    live: (lm) => {
      const h = headDrop(lm), e = towardBall(lm);
      return [`Head height: ${Math.abs(h) < 0.4 ? 'level' : `${len(h)} ${h > 0 ? 'lower' : 'higher'}`}`, `Hips: ${Math.abs(e) < 0.4 ? 'on the line' : `${len(e)} ${e > 0 ? 'toward ball' : 'back'}`}`];
    },
  };
}

// Measurements at each checkpoint, graded against general tour benchmarks.
// All distances are approximate: 2D pose from one camera, scaled from the golfer's height.
import { L, hands, hipC, shC, headC, median } from './phases.js';

const deg = (r) => (r * 180) / Math.PI;
const fmtIn = (v) => `${Math.abs(v).toFixed(1)} in`;
const dir = (v, eps = 0.3) => (Math.abs(v) < eps ? 'no shift' : v > 0 ? 'toward target' : 'away from target');

// Benchmarks by club. tilt = spine tilt away from target at address (deg).
const CLUB = {
  driver: { ball: [0.68, 0.92], tilt: [8, 18], stance: [1.15, 1.75], hands: [-1.5, 3.5] },
  wood:   { ball: [0.6, 0.82],  tilt: [6, 15], stance: [1.05, 1.6],  hands: [0, 4.5] },
  iron:   { ball: [0.45, 0.65], tilt: [3, 12], stance: [0.9, 1.45],  hands: [1, 6.5] },
  wedge:  { ball: [0.38, 0.58], tilt: [2, 10], stance: [0.75, 1.25], hands: [1, 6.5] },
};

/** Inches per pixel, from the golfer's height and two body lengths at address. */
export function scaleFromHeight(lm, heightIn) {
  const shW = Math.hypot(lm[L.lSh].x - lm[L.rSh].x, lm[L.lSh].y - lm[L.rSh].y);
  const leg = ((lm[L.lAn].y - lm[L.lHip].y) + (lm[L.rAn].y - lm[L.rHip].y)) / 2;
  // MediaPipe shoulder points sit ~0.215 x height apart; hip joint to ankle at address ~0.46 x height (knees flexed)
  const a = (0.215 * heightIn) / shW, b = (0.46 * heightIn) / leg;
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : a || b;
}

/** Work out which MediaPipe side (left/right label) is the lead side, from address positions. */
function sides(lm, target) {
  const leftIsLead = (lm[L.lAn].x - lm[L.rAn].x) * target > 0;
  const s = leftIsLead
    ? { an: [L.lAn, L.rAn], heel: [L.lHeel, L.rHeel], toe: [L.lToe, L.rToe], hip: [L.lHip, L.rHip], sh: [L.lSh, L.rSh] }
    : { an: [L.rAn, L.lAn], heel: [L.rHeel, L.lHeel], toe: [L.rToe, L.lToe], hip: [L.rHip, L.lHip], sh: [L.rSh, L.lSh] };
  return { leadAn: s.an[0], trailAn: s.an[1], leadHeel: s.heel[0], trailHeel: s.heel[1], trailToe: s.toe[1], leadHip: s.hip[0], trailHip: s.hip[1] };
}

function spineTilt(lm, target) {
  const s = shC(lm), h = hipC(lm);
  // positive = upper body leaning away from target
  return deg(Math.atan2(-(s.x - h.x) * target, h.y - s.y));
}

function grade(v, [lo, hi], softness) {
  if (v >= lo && v <= hi) return 'good';
  const off = v < lo ? lo - v : v - hi;
  return off <= softness ? 'ok' : 'work';
}

export function headBox(lm) {
  const h = headC(lm);
  const w = Math.abs(lm[L.lEar].x - lm[L.rEar].x) * 1.7 || 40;
  return { x: h.x - w / 2, y: h.y - w * 0.85, w, h: w * 1.35 };
}

/**
 * fr: cleaned frames, ph: phases, opts: {club, heightIn, ball:{x,y}}
 * Returns { scale, sides, base, checkpoints: [...], summary }
 */
export function analyse(fr, ph, { club = 'iron', heightIn = 70, ball } = {}) {
  const B = CLUB[club] || CLUB.iron;
  const t = ph.target;
  const A = fr[ph.address].lm, TP = fr[ph.top].lm, IM = fr[ph.impact].lm, FN = fr[ph.finish].lm;
  const S = scaleFromHeight(A, heightIn);
  const sd = sides(A, t);
  const inch = (px) => px * S;
  const ballPt = ball || { x: (A[L.lAn].x + A[L.rAn].x) / 2, y: Math.max(A[L.lToe].y, A[L.rToe].y) + 0.05 * Math.abs(A[L.lAn].x - A[L.rAn].x) };

  const base = {
    head: headC(A), hip: hipC(A), hands: hands(A), tilt: spineTilt(A, t),
    box: headBox(A), ball: ballPt,
    leadAnX: A[sd.leadAn].x, trailAnX: A[sd.trailAn].x,
    trailHeelY: A[sd.trailHeel].y,
    shW: Math.abs(A[L.lSh].x - A[L.rSh].x), hipW: Math.abs(A[L.lHip].x - A[L.rHip].x),
  };
  const shift = (p0, p1) => inch((p1.x - p0.x) * t); // + = toward target

  // ---------- ADDRESS ----------
  const stanceW = Math.abs(base.leadAnX - base.trailAnX);
  const ballFrac = (ballPt.x - base.trailAnX) / (base.leadAnX - base.trailAnX); // 0 trail foot, 1 lead foot
  const ballLabel = ballFrac < 0.4 ? 'Back of centre' : ballFrac < 0.6 ? 'Centre' : ballFrac < 0.78 ? 'Forward of centre' : 'Off lead heel';
  const stanceRatio = stanceW / base.shW;
  const stanceLabel = stanceRatio < 0.9 ? 'Narrower than shoulders' : stanceRatio < 1.2 ? 'About shoulder width' : stanceRatio < 1.5 ? 'Wider than shoulders' : 'Very wide';
  const address = {
    key: 'address', title: 'Address', frame: ph.address,
    items: [
      { name: 'Ball position', you: ballLabel, pro: { driver: 'Off lead heel', wood: 'Forward of centre', iron: 'Centre to slightly forward', wedge: 'Centre' }[club], status: grade(ballFrac, B.ball, 0.08), value: ballFrac },
      { name: 'Spine tilt', you: `${Math.round(base.tilt)}° ${base.tilt >= 0 ? 'away from' : 'toward'} target`, pro: `${B.tilt[0]}–${B.tilt[1]}° away from target`, status: grade(base.tilt, B.tilt, 3), value: base.tilt },
      { name: 'Stance', you: stanceLabel, pro: club === 'driver' ? 'Wider than shoulders' : club === 'wedge' ? 'Shoulder width or a touch narrower' : 'About shoulder width', status: grade(stanceRatio, B.stance, 0.15), value: stanceRatio },
    ],
    marks: [],
  };

  // ---------- TOP ----------
  const headTop = shift(base.head, headC(TP));
  const hipTop = shift(base.hip, hipC(TP));
  const trailHipPast = inch((base.trailAnX - TP[sd.trailHip].x) * t); // + = trail hip is outside trail foot (sway)
  const tiltTop = spineTilt(TP, t);
  const top = {
    key: 'top', title: 'Top', frame: ph.top,
    items: [
      { name: 'Head', you: `${fmtIn(headTop)} ${dir(headTop)}`, pro: 'Small shift back (0–3 in), stays in the box', status: headTop > 1 ? 'work' : headTop < -4.5 ? 'work' : headTop < -3 ? 'ok' : 'good', value: headTop },
      { name: 'Hips', you: trailHipPast > 0.5 ? `Slid ${fmtIn(trailHipPast)} past trail foot` : `${fmtIn(hipTop)} ${dir(hipTop)}, inside trail foot`, pro: 'Turn without sliding past trail foot', status: trailHipPast > 1.5 ? 'work' : trailHipPast > 0.5 ? 'ok' : hipTop > 1.5 ? 'ok' : 'good', value: hipTop },
      { name: 'Spine tilt', you: `${Math.round(tiltTop)}° ${tiltTop >= 0 ? 'away from' : 'toward'} target`, pro: 'Tilted away from target', status: tiltTop < -2 ? 'work' : tiltTop < 2 ? 'ok' : 'good', value: tiltTop },
    ],
    marks: [{ type: 'vline', x: base.trailAnX, label: 'PRO: hips stay inside this line' }],
  };

  // ---------- IMPACT ----------
  const hipImp = shift(base.hip, hipC(IM));
  const headImp = shift(base.head, headC(IM));
  const headVsBall = inch((headC(IM).x - ballPt.x) * t); // + = head ahead of ball
  const tiltImp = spineTilt(IM, t);
  const handsAhead = inch((hands(IM).x - ballPt.x) * t);
  const impact = {
    key: 'impact', title: 'Impact', frame: ph.impact,
    items: [
      { name: 'Hips', you: `${fmtIn(hipImp)} ${dir(hipImp)}`, pro: 'Shifted toward target (1–6 in)', status: hipImp < 0 ? 'work' : hipImp < 1 ? 'ok' : hipImp > 8 ? 'ok' : 'good', value: hipImp },
      { name: 'Head', you: `${fmtIn(headImp)} ${dir(headImp)}${headVsBall > 0 ? ', ahead of the ball' : headVsBall > -1.5 ? ', over the ball' : ', behind the ball'}`, pro: 'Behind ball, near address spot', status: headImp > 3.5 || headVsBall > 1 ? 'work' : headImp > 2 || headVsBall > -1.5 ? 'ok' : 'good', value: headImp },
      { name: 'Spine tilt', you: `${Math.round(tiltImp)}° (address was ${Math.round(base.tilt)}°)`, pro: 'Equal or more tilt than address', status: tiltImp < base.tilt - 6 ? 'work' : tiltImp < base.tilt - 2 ? 'ok' : 'good', value: tiltImp },
      { name: 'Hands', you: handsAhead >= 0 ? `${fmtIn(handsAhead)} ahead of ball` : `${fmtIn(handsAhead)} behind ball`, pro: club === 'driver' ? 'Level with or just ahead of ball' : 'Ahead of ball (shaft leaning forward)', status: grade(handsAhead, B.hands, 1.5), value: handsAhead },
    ],
    marks: [
      { type: 'circle', x: base.head.x, y: base.head.y, r: base.box.w * 0.32, label: 'PRO: head here' },
      { type: 'spine', from: hipC(IM), angle: base.tilt, target: t, len: Math.hypot(shC(A).x - hipC(A).x, shC(A).y - hipC(A).y) },
    ],
  };

  // ---------- FINISH ----------
  const hipVsLead = inch((hipC(FN).x - base.leadAnX) * t); // 0 = stacked over lead foot, - = hanging back
  const heelLift = inch(base.trailHeelY - FN[sd.trailHeel].y);
  const toeHeel = FN[sd.trailToe].y - FN[sd.trailHeel].y; // heel above toe => positive
  const shRatio = Math.abs(FN[L.lSh].x - FN[L.rSh].x) / base.shW;
  const finish = {
    key: 'finish', title: 'Finish', frame: ph.finish,
    items: [
      { name: 'Weight', you: hipVsLead > -3 ? 'Stacked over lead foot' : `Hips ${fmtIn(hipVsLead)} behind lead foot`, pro: 'Stacked over lead foot', status: hipVsLead > -3 ? 'good' : hipVsLead > -6 ? 'ok' : 'work', value: hipVsLead },
      { name: 'Trail foot', you: heelLift > 2 || toeHeel > 0 ? 'Up on the toe' : heelLift > 0.8 ? 'Heel partly up' : 'Heel still down', pro: 'Up on the toe', status: heelLift > 2 || toeHeel > 0 ? 'good' : heelLift > 0.8 ? 'ok' : 'work', value: heelLift },
      { name: 'Body', you: shRatio < 0.6 ? 'Chest facing target' : shRatio < 0.8 ? 'Chest mostly round' : 'Chest still facing ball', pro: 'Chest facing target, balanced', status: shRatio < 0.6 ? 'good' : shRatio < 0.8 ? 'ok' : 'work', value: shRatio },
    ],
    marks: [{ type: 'vline', x: base.leadAnX, label: 'PRO: hips stacked over lead foot' }],
  };

  const checkpoints = [address, top, impact, finish];
  return { scale: S, sides: sd, base, target: t, club, checkpoints, summary: summarise(checkpoints) };
}

const PRIORITY_COPY = {
  'impact:Head': 'Keep your head at its address spot through impact',
  'impact:Spine tilt': 'hold your spine tilt away from target',
  'impact:Hips': 'get your hips moving toward the target before your arms swing down',
  'impact:Hands': 'lead with your hands so the shaft leans forward at impact',
  'top:Head': 'let your head stay in its box going back',
  'top:Hips': 'turn your hips rather than sliding them past your trail foot',
  'top:Spine tilt': 'keep your upper body tilted away from the target at the top',
  'address:Ball position': 'fix your ball position',
  'address:Spine tilt': 'set a little more spine tilt away from target at address',
  'address:Stance': 'adjust your stance width',
  'finish:Weight': 'finish with your weight stacked over your lead foot',
  'finish:Trail foot': 'let your trail heel come up so you finish on the toe',
  'finish:Body': 'rotate all the way through so your chest faces the target',
};

function summarise(cps) {
  const pts = { work: 2, ok: 1, good: 0 };
  const weight = { address: 1, top: 1.1, impact: 1.5, finish: 0.8 };
  let worst = null, worstScore = -1;
  for (const c of cps) {
    const s = c.items.reduce((a, it) => a + pts[it.status], 0) * weight[c.key];
    if (s > worstScore) { worstScore = s; worst = c; }
  }
  const issues = worst.items.filter((i) => i.status !== 'good').sort((a, b) => pts[b.status] - pts[a.status]);
  const fine = worst.items.filter((i) => i.status === 'good').map((i) => i.name.toLowerCase());
  const total = cps.reduce((a, c) => a + c.items.length, 0);
  const goods = cps.reduce((a, c) => a + c.items.filter((i) => i.status === 'good').length, 0);
  if (!issues.length) {
    return { focus: null, headline: 'Solid swing on every checkpoint', advice: 'Every measurement is inside the tour range. Film a down-the-line clip next time to check plane and posture.', score: `${goods}/${total}` };
  }
  const phrases = issues.slice(0, 2).map((i) => PRIORITY_COPY[`${worst.key}:${i.name}`] || `work on your ${i.name.toLowerCase()}`);
  let advice = phrases.join(' and ');
  advice = advice[0].toUpperCase() + advice.slice(1) + '.';
  if (fine.length) advice += ` Your ${fine.join(' and ')} ${fine.length > 1 ? 'are' : 'is'} already doing ${fine.length > 1 ? 'their' : 'its'} job.`;
  return { focus: worst.key, headline: `Biggest opportunity: ${worst.title}`, advice, score: `${goods}/${total}` };
}

export { median };

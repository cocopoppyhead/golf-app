// Draws the analysis overlay onto a canvas for one video frame.
import { L, hands, hipC, shC, headC } from './phases.js';
import { len } from '../units.js';

export const COLORS = {
  limb: '#ffd23f', joint: '#ff4b3e', spine: '#3ec8ff', head: '#3ec8ff',
  boxOk: '#5bd47a', boxOut: '#ff9f2e', pro: '#ff4fa3', ball: '#ffffff',
  good: '#3ddc84', ok: '#ffad33', work: '#ff5a4f', card: 'rgba(14,20,36,0.86)',
};

const LIMBS = [
  [L.lSh, L.lEl], [L.lEl, L.lWr], [L.rSh, L.rEl], [L.rEl, L.rWr],
  [L.lHip, L.lKn], [L.lKn, L.lAn], [L.rHip, L.rKn], [L.rKn, L.rAn],
  [L.lAn, L.lHeel], [L.lHeel, L.lToe], [L.lToe, L.lAn],
  [L.rAn, L.rHeel], [L.rHeel, L.rToe], [L.rToe, L.rAn],
];
const JOINTS = [L.lSh, L.rSh, L.lEl, L.rEl, L.lWr, L.rWr, L.lHip, L.rHip, L.lKn, L.rKn, L.lAn, L.rAn];

function pill(ctx, text, x, y, u, { bg = 'rgba(0,0,0,0.65)', fg = '#fff', align = 'center', size = 1 } = {}) {
  ctx.font = `700 ${Math.round(u * 1.05 * size)}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + u * 0.9, h = u * 1.6 * size;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg; roundRect(ctx, x0, y - h / 2, w, h, u * 0.35); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x0 + u * 0.45, y + 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * ctx: 2D context sized to video W x H (video frame already drawn)
 * A: analysis result, lm: landmarks for this frame, cp: checkpoint object or null
 */
// Which reference lines to draw. Toggled from the player ("Lines" tick box); the ball line stays.
export const overlayOptions = { lines: true };

export function drawOverlay(ctx, A, lm, { cp = null, card = false, cpIndex = 0, frame = -1 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const u = Math.max(9, Math.min(W, H) / 34); // base unit for sizes
  const S = A.scale, t = A.target, b = A.base;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Ball line (face-on only)
  if (b.ball) {
    ctx.setLineDash([u * 0.6, u * 0.5]); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.14;
    ctx.beginPath(); ctx.moveTo(b.ball.x, 0); ctx.lineTo(b.ball.x, b.ball.y); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, 'BALL', b.ball.x, Math.min(H - u * 4.2, b.ball.y + u * 1.6), u);
  }

  if (A.refs && overlayOptions.lines) drawPositionLines(ctx, A, lm, u, { cp, frame });

  // Head oval from address, fixed for the whole swing (GolfTEC style); orange once the head leaves it
  const hc = headC(lm), bx = b.box;
  const inBox = hc.x > bx.x && hc.x < bx.x + bx.w && hc.y > bx.y && hc.y < bx.y + bx.h;
  if (overlayOptions.lines) {
    ctx.strokeStyle = inBox ? COLORS.boxOk : COLORS.boxOut; ctx.lineWidth = u * 0.16;
    ctx.beginPath(); ctx.ellipse(bx.x + bx.w / 2, bx.y + bx.h / 2, bx.w / 2, bx.h / 2, 0, 0, Math.PI * 2); ctx.stroke();
    // where the head is now vs where it started
    ctx.fillStyle = inBox ? COLORS.boxOk : COLORS.boxOut; ctx.beginPath(); ctx.arc(hc.x, hc.y, u * 0.22, 0, 7); ctx.fill();
  }

  // Pro marks for this checkpoint
  if (cp) for (const m of cp.marks) drawMark(ctx, m, u, H);

  // Skeleton
  ctx.strokeStyle = COLORS.limb; ctx.lineWidth = u * 0.28;
  for (const [a, c] of LIMBS) { ctx.beginPath(); ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[c].x, lm[c].y); ctx.stroke(); }
  ctx.strokeStyle = COLORS.spine; ctx.lineWidth = u * 0.32;
  const sc = shC(lm), hp = hipC(lm);
  ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(sc.x, sc.y); ctx.stroke();
  ctx.lineWidth = u * 0.16;
  for (const [a, c] of [[L.lSh, L.rSh], [L.lHip, L.rHip]]) { ctx.beginPath(); ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[c].x, lm[c].y); ctx.stroke(); }
  for (const j of JOINTS) {
    ctx.beginPath(); ctx.arc(lm[j].x, lm[j].y, u * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.joint; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = u * 0.1; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(hc.x, hc.y, u * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.head; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = u * 0.1; ctx.stroke();

  // Bottom bar: live head and hip shift
  const hs = (hc.x - b.head.x) * t * S, ps = (hp.x - b.hip.x) * t * S;
  const word = (v) => (Math.abs(v) < 0.3 ? '' : v > 0 ? ' toward target' : ' away from target');
  const lines = A.live ? A.live(lm) : [`Head shift: ${len(hs)}${word(hs)}`, `Hip shift: ${len(ps)}${word(ps)}`];
  const barH = u * 3.2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - barH, W, barH);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.font = `500 ${Math.round(u * 1.0)}px Inter, system-ui, sans-serif`;
  ctx.fillText(lines[0], u * 0.7, H - barH * 0.68);
  ctx.fillText(lines[1], u * 0.7, H - barH * 0.3);
  ctx.textAlign = 'right';
  ctx.fillStyle = inBox ? COLORS.boxOk : COLORS.boxOut; ctx.fillText('Head oval', W - u * 0.7, H - barH * 0.68);
  ctx.fillStyle = COLORS.spine; ctx.font = `500 ${Math.round(u * 0.85)}px Inter, system-ui, sans-serif`;
  ctx.fillText('Spine / shoulders / hips', W - u * 0.7, H - barH * 0.3);

  if (cp && card) drawCard(ctx, cp, cpIndex, u, W);
  ctx.restore();
}

/**
 * Coach-style position lines. Straight lines from address stay on screen the whole swing, with
 * ticks for where the hips were at the top and at impact, so sway, slide and getting on top of
 * the ball show at a glance.
 *   Face-on: trail-hip line (sway), lead-hip line (shift/slide), chest vs ball at impact.
 *   Behind:  hip line (early extension) and head-height line.
 */
function drawPositionLines(ctx, A, lm, u, { cp, frame }) {
  const { address: a0, top: tp, impact: im } = A.refs;
  const S = A.scale, t = A.target;
  const H = ctx.canvas.height;
  const sev = (v, ok, work) => (v >= work ? COLORS.work : v >= ok ? COLORS.ok : COLORS.good);
  const vline = (x, y0, y1, label, align = 'center') => {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.13;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    if (label) pill(ctx, label, x + (align === 'left' ? u * 0.3 : align === 'right' ? -u * 0.3 : 0), y0 - u * 0.2, u, { size: 0.72, bg: 'rgba(0,0,0,0.55)', align });
  };
  const tick = (x, y, col, label, up = true) => {
    ctx.strokeStyle = col; ctx.lineWidth = u * 0.3;
    ctx.beginPath(); ctx.moveTo(x, y - u * 0.9); ctx.lineTo(x, y + u * 0.9); ctx.stroke();
    if (label) pill(ctx, label, x, up ? y - u * 1.9 : y + u * 1.9, u, { size: 0.7, fg: col });
  };
  const arrow = (x0, x1, y, col, label) => {
    if (Math.abs(x1 - x0) < u * 0.3) return;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = u * 0.26;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    const d = Math.sign(x1 - x0);
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - d * u * 0.7, y - u * 0.5); ctx.lineTo(x1 - d * u * 0.7, y + u * 0.5); ctx.closePath(); ctx.fill();
    if (label) pill(ctx, label, (x0 + x1) / 2, y + u * 1.3, u, { size: 0.8, fg: col });
  };
  const inch = (px) => px * S;
  const nearImpact = cp?.key === 'impact' || (frame >= 0 && A.refFrames && Math.abs(frame - A.refFrames.impact) <= 2);

  if (A.view === 'dtl') {
    const b = A.base.ballSide || 1; // +1: the ball is image-right of the hips
    const torso = hipC(a0).y - shC(a0).y;
    const back = (f) => hipC(f).x - b * 0.12 * torso; // approx. back of the hips (the "butt line")
    const hx = back(a0), hy = hipC(a0).y;
    const ankY = Math.max(a0[L.lAn].y, a0[L.rAn].y);
    vline(hx, hy - torso * 0.7, ankY, 'Butt line', b > 0 ? 'right' : 'left');
    // head height
    const hd = headC(a0);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = u * 0.13; ctx.setLineDash([u * 0.5, u * 0.4]);
    ctx.beginPath(); ctx.moveTo(hd.x - torso * 0.7, hd.y); ctx.lineTo(hd.x + torso * 0.7, hd.y); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, 'Head height', hd.x - torso * 0.7, hd.y - u * 1.0, u, { size: 0.7, align: 'left', bg: 'rgba(0,0,0,0.55)' });
    // where the hips were at impact
    const ix = back(im), ee = inch((ix - hx) * b);
    tick(ix, hy, sev(ee, 1, 2.5), 'impact', false);
    // live: hips drifting toward the ball
    const cx = back(lm), now = inch((cx - hx) * b);
    if (now > 0.6) arrow(hx, cx, hy + u * 1.6, sev(now, 1, 2.5), `${len(now)} toward ball`);
    return;
  }

  // ---- face-on ----
  const sd = A.sides;
  if (!sd) return;
  const ankY = Math.max(a0[L.lAn].y, a0[L.rAn].y);
  // Shoulder lines: full height, on the outside of each shoulder at address (GolfTEC style). Where
  // you started; the live skeleton shows where you are, so turn, sway and slide read at a glance.
  const trailSh = sd.trailSh ?? (sd.trailHip === L.rHip ? L.rSh : L.lSh), leadSh = sd.leadSh ?? (sd.leadHip === L.lHip ? L.lSh : L.rSh); // older saved swings have no shoulder sides
  const shOff = Math.abs(a0[leadSh].x - a0[trailSh].x) * 0.12; // joint → outside edge of the shoulder
  const sx = a0[trailSh].x - t * shOff, sl = a0[leadSh].x + t * shOff;
  const sAlign = sx < sl ? 'right' : 'left';
  vline(sx, u * 2.2, ankY, 'Trail shoulder', sAlign);
  vline(sl, u * 2.2, ankY, 'Lead shoulder', sAlign === 'right' ? 'left' : 'right');
  // Hip column (outside of both hips at address): a faint band the hips should stay inside.
  const off = Math.abs(a0[sd.leadHip].x - a0[sd.trailHip].x) * 0.35; // hip joint → outside of the hip
  const tx = a0[sd.trailHip].x - t * off, lx = a0[sd.leadHip].x + t * off, hy = hipC(a0).y;
  const top = Math.min(a0[L.lSh].y, a0[L.rSh].y) - u * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(Math.min(tx, lx), top, Math.abs(lx - tx), ankY - top);
  // top of the backswing: trail hip vs its line (sway away from the target)
  const trailEdge = (f) => f[sd.trailHip].x - t * off, leadEdge = (f) => f[sd.leadHip].x + t * off;
  const swTop = inch((tx - trailEdge(tp)) * t);
  tick(trailEdge(tp), hy, sev(swTop, 1.5, 3), 'top');
  // impact: lead hip vs its line (a little toward the target is good; a lot is a slide)
  const shImp = inch((leadEdge(im) - lx) * t);
  tick(leadEdge(im), hy, shImp > 4 ? COLORS.ok : COLORS.good, 'impact', false);
  // live arrows
  const swNow = inch((tx - trailEdge(lm)) * t);
  if (swNow > 0.8) arrow(tx, trailEdge(lm), hy + u * 1.8, sev(swNow, 1.5, 3), `Sway ${len(swNow)}`);
  const shNow = inch((leadEdge(lm) - lx) * t);
  if (shNow > 0.8) arrow(lx, leadEdge(lm), hy + u * 1.8, shNow > 4 ? COLORS.ok : COLORS.good, `${shNow > 4 ? 'Slide' : 'Bump'} ${len(shNow)}`);
  // on top of the ball: chest (shoulder centre) vs the ball line at impact
  const ball = A.base.ball;
  if (ball && nearImpact) {
    const c = shC(lm), behind = inch((ball.x - c.x) * t);
    const driver = A.club === 'driver';
    const col = driver ? (behind < -1 ? COLORS.ok : COLORS.good) : sev(behind, 2, 4);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c.x, c.y, u * 0.6, 0, Math.PI * 2); ctx.fill();
    arrow(c.x, ball.x, c.y + u * 1.6, col, behind > 0.5 ? `Chest ${len(behind)} behind ball` : behind < -0.5 ? `Chest ${len(-behind)} ahead of ball` : 'Chest over the ball');
  }
}

function drawMark(ctx, m, u, H) {
  ctx.strokeStyle = COLORS.pro; ctx.lineWidth = u * 0.22; ctx.setLineDash([u * 0.7, u * 0.45]);
  if (m.type === 'vline') {
    const y0 = H * 0.3, y1 = H * 0.86;
    ctx.beginPath(); ctx.moveTo(m.x, y0); ctx.lineTo(m.x, y1); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, m.label, m.x, y0 - u * 1.1, u, { fg: COLORS.pro, size: 0.95 });
  } else if (m.type === 'hline') {
    const x0 = m.x0 ?? ctx.canvas.width * 0.15, x1 = m.x1 ?? ctx.canvas.width * 0.85;
    ctx.beginPath(); ctx.moveTo(x0, m.y); ctx.lineTo(x1, m.y); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, m.label, (x0 + x1) / 2, m.y - u * 1.1, u, { fg: COLORS.pro, size: 0.95 });
  } else if (m.type === 'circle') {
    ctx.setLineDash([]); ctx.lineWidth = u * 0.24;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
    pill(ctx, m.label, m.x + m.r + u * 0.4, m.y, u, { fg: COLORS.pro, align: 'left', size: 0.95 });
  } else if (m.type === 'spine') {
    // the address spine angle, drawn from today's hip centre
    const a = (m.angle * Math.PI) / 180, tgt = m.target ?? 1;
    const x1 = m.from.x - Math.sin(a) * m.len * tgt, y1 = m.from.y - Math.cos(a) * m.len;
    ctx.beginPath(); ctx.moveTo(m.from.x, m.from.y); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.setLineDash([]);
}

export function drawCard(ctx, cp, idx, u, W) {
  const pad = u * 0.8, rowH = u * 2.55, w = Math.min(W - u, u * 30);
  const h = pad * 2 + u * 3.6 + cp.items.length * rowH;
  const x = u * 0.5, y = u * 0.5;
  ctx.fillStyle = COLORS.card; roundRect(ctx, x, y, w, h, u * 0.7); ctx.fill();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(u * 1.7)}px Inter, system-ui, sans-serif`;
  ctx.fillText(cp.title.toUpperCase(), x + pad, y + pad + u * 1.4);
  const tw = ctx.measureText(cp.title.toUpperCase()).width;
  ctx.fillStyle = '#9aa4b8'; ctx.font = `500 ${Math.round(u * 0.8)}px Inter, system-ui, sans-serif`;
  ctx.fillText(`checkpoint ${idx + 1}/4`, x + pad + tw + u * 0.6, y + pad + u * 1.35);
  const c2 = x + w * 0.52;
  ctx.font = `800 ${Math.round(u * 0.9)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = COLORS.limb; ctx.fillText('YOU', x + pad, y + pad + u * 3.0);
  ctx.fillStyle = COLORS.pro; ctx.fillText('TOUR PRO', c2, y + pad + u * 3.0);
  cp.items.forEach((it, i) => {
    const ry = y + pad + u * 3.6 + i * rowH;
    ctx.fillStyle = COLORS[it.status]; ctx.beginPath(); ctx.arc(x + pad + u * 0.35, ry + u * 0.75, u * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(u * 0.95)}px Inter, system-ui, sans-serif`;
    ctx.fillText(it.name, x + pad + u * 1.0, ry + u * 1.05);
    ctx.font = `500 ${Math.round(u * 0.78)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = COLORS.limb; fitText(ctx, it.you, x + pad + u * 1.0, ry + u * 2.1, c2 - x - pad - u * 1.4);
    ctx.fillStyle = COLORS.pro; fitText(ctx, it.pro, c2, ry + u * 2.1, x + w - c2 - pad);
  });
}

function fitText(ctx, s, x, y, maxW) {
  let txt = s;
  while (ctx.measureText(txt).width > maxW && txt.length > 4) txt = txt.slice(0, -2);
  if (txt !== s) txt = txt.slice(0, -1) + '…';
  ctx.fillText(txt, x, y);
}

/** Summary slide (end of exported video). */
export function drawSummary(ctx, A) {
  const W = ctx.canvas.width, H = ctx.canvas.height, u = Math.min(W, H) / 30;
  ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(u * 1.5)}px Inter, system-ui, sans-serif`;
  wrap(ctx, A.summary.headline, W / 2, H * 0.36, W - u * 3, u * 1.9);
  ctx.fillStyle = '#c9d1e0'; ctx.font = `500 ${Math.round(u * 0.95)}px Inter, system-ui, sans-serif`;
  const y = wrap(ctx, A.summary.advice, W / 2, H * 0.46, W - u * 4, u * 1.4);
  ctx.fillStyle = '#7f8aa3'; ctx.font = `500 ${Math.round(u * 0.8)}px Inter, system-ui, sans-serif`;
  wrap(ctx, 'Measurements are approximate (2D pose tracking). Pro marks are general tour benchmarks, not a specific player.', W / 2, y + u * 2, W - u * 4, u * 1.2);
}

function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

export { hands };

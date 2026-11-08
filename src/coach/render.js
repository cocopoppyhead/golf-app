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
export function drawOverlay(ctx, A, lm, { cp = null, card = false, cpIndex = 0 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const u = Math.max(9, Math.min(W, H) / 34); // base unit for sizes
  const S = A.scale, t = A.target, b = A.base;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Ball line
  ctx.setLineDash([u * 0.6, u * 0.5]); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.14;
  ctx.beginPath(); ctx.moveTo(b.ball.x, 0); ctx.lineTo(b.ball.x, b.ball.y); ctx.stroke(); ctx.setLineDash([]);
  pill(ctx, 'BALL', b.ball.x, Math.min(H - u * 4.2, b.ball.y + u * 1.6), u);

  // Head box (from address); turns orange when the head leaves it
  const hc = headC(lm), bx = b.box;
  const inBox = hc.x > bx.x && hc.x < bx.x + bx.w && hc.y > bx.y && hc.y < bx.y + bx.h;
  ctx.strokeStyle = inBox ? COLORS.boxOk : COLORS.boxOut; ctx.lineWidth = u * 0.16;
  ctx.strokeRect(bx.x, bx.y, bx.w, bx.h);

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
  const barH = u * 3.2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - barH, W, barH);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.font = `500 ${Math.round(u * 1.0)}px Inter, system-ui, sans-serif`;
  ctx.fillText(`Head shift: ${len(hs)}${word(hs)}`, u * 0.7, H - barH * 0.68);
  ctx.fillText(`Hip shift: ${len(ps)}${word(ps)}`, u * 0.7, H - barH * 0.3);
  ctx.textAlign = 'right';
  ctx.fillStyle = inBox ? COLORS.boxOk : COLORS.boxOut; ctx.fillText('Head box', W - u * 0.7, H - barH * 0.68);
  ctx.fillStyle = COLORS.spine; ctx.font = `500 ${Math.round(u * 0.85)}px Inter, system-ui, sans-serif`;
  ctx.fillText('Spine / shoulders / hips', W - u * 0.7, H - barH * 0.3);

  if (cp && card) drawCard(ctx, cp, cpIndex, u, W);
  ctx.restore();
}

function drawMark(ctx, m, u, H) {
  ctx.strokeStyle = COLORS.pro; ctx.lineWidth = u * 0.22; ctx.setLineDash([u * 0.7, u * 0.45]);
  if (m.type === 'vline') {
    const y0 = H * 0.3, y1 = H * 0.86;
    ctx.beginPath(); ctx.moveTo(m.x, y0); ctx.lineTo(m.x, y1); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, m.label, m.x, y0 - u * 1.1, u, { fg: COLORS.pro, size: 0.95 });
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

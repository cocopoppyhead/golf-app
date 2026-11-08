// Cleans the pose track and finds the 4 checkpoints: address, top, impact, finish.
// Face-on view. Works for right- or left-handed golfers and mirrored (selfie) video:
// the target side is worked out from where the hands go at the top.

export const L = {
  nose: 0, lEye: 2, rEye: 5, lEar: 7, rEar: 8,
  lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Fill gaps by linear interpolation, then light smoothing (3-frame centred average). */
export function cleanTrack(frames) {
  const n = frames.length;
  const good = frames.map((f) => !!f.lm);
  if (!good.some(Boolean)) throw new Error('No golfer found in the video. Make sure your whole body is in frame.');
  const out = frames.map((f) => ({ t: f.t, lm: f.lm ? f.lm.map((p) => ({ ...p })) : null, interp: !f.lm }));
  for (let i = 0; i < n; i++) {
    if (out[i].lm) continue;
    let a = i - 1; while (a >= 0 && !frames[a].lm) a--;
    let b = i + 1; while (b < n && !frames[b].lm) b++;
    const A = a >= 0 ? frames[a].lm : null, B = b < n ? frames[b].lm : null;
    if (A && B) {
      const k = (i - a) / (b - a);
      out[i].lm = A.map((p, j) => ({ x: p.x + (B[j].x - p.x) * k, y: p.y + (B[j].y - p.y) * k, v: Math.min(p.v, B[j].v) }));
    } else out[i].lm = (A || B).map((p) => ({ ...p }));
  }
  const sm = out.map((f, i) => {
    if (i === 0 || i === n - 1) return f;
    const p = out[i - 1].lm, q = out[i + 1].lm;
    return { ...f, lm: f.lm.map((c, j) => ({ x: (p[j].x + 2 * c.x + q[j].x) / 4, y: (p[j].y + 2 * c.y + q[j].y) / 4, v: c.v })) };
  });
  return sm;
}

export const hands = (lm) => mid(lm[L.lWr], lm[L.rWr]);
export const hipC = (lm) => mid(lm[L.lHip], lm[L.rHip]);
export const shC = (lm) => mid(lm[L.lSh], lm[L.rSh]);
export function headC(lm) {
  const pts = [L.nose, L.lEye, L.rEye, L.lEar, L.rEar].map((i) => lm[i]);
  return { x: pts.reduce((s, p) => s + p.x, 0) / 5, y: pts.reduce((s, p) => s + p.y, 0) / 5 };
}

/**
 * Returns { address, top, impact, finish } frame indices plus target sign
 * (+1 = target is to the right of the image, -1 = left).
 */
export function findPhases(fr, { handedness = 'auto' } = {}) {
  const n = fr.length;
  if (n < 10) throw new Error('Clip too short. Film the full swing, from set-up to finish.');
  const H = fr.map((f) => hands(f.lm));
  const hipY = (i) => hipC(fr[i].lm).y, shY = (i) => shC(fr[i].lm).y;
  const torso = (lm) => Math.hypot(shC(lm).x - hipC(lm).x, shC(lm).y - hipC(lm).y);
  const T = median(fr.map((f) => torso(f.lm)));
  // Speed per frame, normalised to the peak, so slow-motion clips behave the same as real time.
  const raw = H.map((h, i) => (i === 0 ? 0 : Math.hypot(h.x - H[i - 1].x, h.y - H[i - 1].y)));
  const spd = raw.map((_, i) => (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(n - 1, i + 1)]) / 3);
  let pk = 1;
  for (let i = 1; i < n; i++) if (spd[i] > spd[pk]) pk = i;
  const rel = spd.map((s) => s / (spd[pk] || 1));

  // Hands "high" = above the shoulders; "low" = below the belt line.
  const high = (i) => H[i].y < shY(i);
  const low = (i) => H[i].y > hipY(i) - 0.15 * T;

  // Top: walk back from peak speed to the backswing (hands high), then on to the takeaway (hands low).
  let j = pk;
  while (j > 0 && !high(j)) j--;
  let k = j;
  while (k > 0 && !low(k)) k--;
  let top = j;
  for (let i = k; i <= pk; i++) if (H[i].y < H[top].y) top = i;

  // Address: from the takeaway, walk back to where the hands are still (under 6% of peak speed).
  let address = k;
  while (address > 0 && rel[address] > 0.06) address--;
  // prefer the stillest frame among the few just before takeaway
  let best = address;
  for (let i = Math.max(0, address - 8); i <= address; i++) if (low(i) && rel[i] < rel[best]) best = i;
  address = best;

  // Impact: in the low part of the downswing, the frame where the hands are closest to
  // where they were at address (more robust than "lowest hands", which motion blur upsets).
  let rise = top + 1;
  while (rise < n - 1 && !(rise > pk && high(rise))) rise++;
  // Target side: at the top the hands sit over the trail shoulder, i.e. away from target.
  let target;
  if (handedness === 'auto') target = hands(fr[top].lm).x - shC(fr[address].lm).x > 0 ? -1 : 1;
  else target = handedness === 'right' ? 1 : -1; // face-on, not mirrored: a right-hander's target is image-right
  // at impact the hands are ~2 in ahead of their address spot (~12% of torso length)
  const A0 = { x: H[address].x + target * 0.12 * T, y: H[address].y };
  let impact = -1, bestD = Infinity;
  for (let i = top + 1; i <= rise; i++) {
    if (!low(i)) continue;
    const d = Math.abs(H[i].x - A0.x) + 0.5 * Math.abs(H[i].y - A0.y);
    if (d < bestD) { bestD = d; impact = i; }
  }
  if (impact < 0) { impact = top + 1; for (let i = top + 1; i <= rise; i++) if (H[i].y > H[impact].y) impact = i; }

  // Finish: after the hands rise past the shoulders, the first frame where they settle.
  let finish = -1;
  for (let i = rise; i < n; i++) if (high(i) && rel[i] < 0.12) { finish = i; break; }
  if (finish < 0) {
    finish = rise;
    for (let i = rise; i < n; i++) if (H[i].y < H[finish].y) finish = i;
  }

  return { address, top, impact, finish, target, peak: pk, torsoPx: T };
}

export function median(a) {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
}

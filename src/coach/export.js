// Renders the annotated swing to an MP4 on the device (WebCodecs + mp4-muxer).
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawOverlay, drawSummary } from './render.js';
import { seek } from './pose.js';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export const canExport = () => typeof window.VideoEncoder === 'function';

export async function exportMp4(video, fr, A, { slow = 3, holdSec = 2.5, summarySec = 4, onProgress = () => {} } = {}) {
  if (!canExport()) throw new Error('This browser cannot make videos. Use Chrome, or Safari on iOS 17+.');
  // Keep within H.264 level 4.x limits
  const k = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
  const W = even(video.videoWidth * k), H = even(video.videoHeight * k);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');

  let config = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a']) {
    const c = { codec, width: W, height: H, bitrate: 6_000_000, framerate: 30 };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
  }
  if (!config) throw new Error('H.264 video encoding is not supported on this device.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
  enc.configure(config);

  let ts = 0, n = 0, lastKey = -1e9;
  const push = async (durSec) => {
    const frame = new VideoFrame(canvas, { timestamp: Math.round(ts * 1e6), duration: Math.round(durSec * 1e6) });
    const key = ts - lastKey >= 2;
    if (key) lastKey = ts;
    enc.encode(frame, { keyFrame: key });
    frame.close();
    ts += durSec; n++;
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 20));
  };
  const seekV = (t) => seek(video, t);

  const cpByFrame = new Map(A.checkpoints.map((c, i) => [c.frame, i]));
  const i0 = Math.max(0, A.checkpoints[0].frame - 8), i1 = Math.min(fr.length - 1, A.checkpoints[3].frame + 12);
  for (let i = i0; i <= i1; i++) {
    if (err) throw err;
    await seekV(fr[i].t);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.save(); ctx.scale(k, k);
    const ci = cpByFrame.has(i) ? cpByFrame.get(i) : -1;
    // draw at source resolution coordinates
    const c2 = { canvas: { width: video.videoWidth, height: video.videoHeight } };
    drawOverlay(proxy(ctx, c2.canvas), A, fr[i].lm, { cp: ci >= 0 ? A.checkpoints[ci] : null, card: ci >= 0, cpIndex: ci, frame: i });
    ctx.restore();
    const dt = i < i1 ? Math.max(1 / 120, fr[i + 1].t - fr[i].t) : 1 / 30;
    await push(ci >= 0 ? holdSec : dt * slow);
    onProgress((i - i0) / (i1 - i0 + 1));
  }
  drawSummary(ctx, A);
  await push(summarySec);
  await enc.flush();
  muxer.finalize();
  if (err) throw err;
  onProgress(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// Lets drawOverlay think the canvas is source-sized while we draw scaled.
function proxy(ctx, fakeCanvas) {
  return new Proxy(ctx, {
    get(t, p) { if (p === 'canvas') return fakeCanvas; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

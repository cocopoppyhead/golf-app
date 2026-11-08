// Pose extraction: runs MediaPipe Pose Landmarker over a video file, on the device.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { cleanTrack, findPhases } from './phases.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODELS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
};

let cached = { key: null, lm: null };
// MediaPipe VIDEO mode needs timestamps that never go backwards for the life of the landmarker,
// across every analysis in the session — so one shared clock.
let clock = 0;
const tick = (ms) => (clock += ms);

export async function getLandmarker(quality = 'full') {
  if (cached.key === quality && cached.lm) return cached.lm;
  if (cached.lm) cached.lm.close();
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[quality] || MODELS.full, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let lm;
  try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
  cached = { key: quality, lm };
  return lm;
}

export function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = typeof file === 'string' ? file : URL.createObjectURL(file);
    v.onloadeddata = () => {
      if (Number.isFinite(v.duration)) return resolve(v);
      // MediaRecorder WebM has no duration until you seek past the end
      v.ondurationchange = () => { if (Number.isFinite(v.duration)) { v.ondurationchange = null; v.currentTime = 0; resolve(v); } };
      v.currentTime = 1e7;
    };
    v.onerror = () => reject(new Error('Could not open this video. Try an MP4 or MOV from your phone camera.'));
  });
}

function seek(v, t) {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(t, v.duration - 0.001);
  });
}

// Tiny fingerprint so we skip duplicate frames when sampling faster than the video's fps.
function fingerprint(ctx, v) {
  ctx.drawImage(v, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
  return h;
}

/**
 * Two passes: a quick 8 fps scan to find the swing (fastest hand movement),
 * then a dense pass (up to 60 fps, deduped) around it.
 * Returns { frames: [{t, lm:[{x,y,v}]|null}], width, height, window:[t0,t1] }
 */
export async function extractPose(video, { quality = 'full', range = null, dense = false, onProgress = () => {} } = {}) {
  const lm = await getLandmarker(quality);
  const W = video.videoWidth, H = video.videoHeight, dur = video.duration;
  const fp = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  fp.canvas.width = fp.canvas.height = 24;
  const detectAt = async (t) => {
    await seek(video, t);
    const r = lm.detectForVideo(video, tick(33));
    const p = r.landmarks?.[0];
    return p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null;
  };

  // Only look inside the part the golfer trimmed to (default: whole clip)
  const r0 = Math.max(0, range?.[0] ?? 0), r1 = Math.min(dur, range?.[1] ?? dur);

  // Pass 1: coarse scan
  let window = [r0, r1];
  if (!dense && r1 - r0 > 4) {
    const coarse = [];
    const step = 1 / 8;
    for (let t = r0; t < r1; t += step) {
      coarse.push({ t, lm: await detectAt(t) });
      onProgress(0.3 * ((t - r0) / (r1 - r0)), 'Finding your swing…');
    }
    try {
      const valid = coarse.filter((f) => f.lm);
      const fr = cleanTrack(valid);
      const ph = findPhases(fr);
      window = [Math.max(r0, fr[ph.address].t - 0.8), Math.min(r1, fr[ph.finish].t + 0.8)];
    } catch {
      window = [r0, Math.min(r1, r0 + 8)];
    }
  }

  // Pass 2: dense
  const frames = [];
  const [t0, t1] = window;
  const step = Math.max(1 / 60, (t1 - t0) / 240); // cap work at ~240 frames (long slow-mo clips)
  let last = null;
  for (let t = t0; t <= t1; t += step) {
    await seek(video, t);
    const f = fingerprint(fp, video);
    if (f === last) continue;
    last = f;
    const r = lm.detectForVideo(video, tick(17));
    const p = r.landmarks?.[0];
    frames.push({ t: video.currentTime, lm: p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null });
    onProgress(0.3 + 0.7 * ((t - t0) / (t1 - t0 || 1)), 'Tracking your body…');
  }
  onProgress(1, 'Done');
  return { frames, width: W, height: H, window };
}

/**
 * Range mode: find every swing in a longer clip. Coarse 8 fps scan, then each burst of fast
 * hand movement that has the hands going above the shoulders becomes one swing window.
 * Returns [[t0, t1], ...] in time order.
 */
export async function findSwings(video, { quality = 'full', onProgress = () => {} } = {}) {
  const lm = await getLandmarker(quality);
  const W = video.videoWidth, H = video.videoHeight, dur = video.duration;
  const coarse = [];
  for (let t = 0; t < dur; t += 1 / 8) {
    await seek(video, t);
    const r = lm.detectForVideo(video, tick(125));
    const p = r.landmarks?.[0];
    coarse.push({ t, lm: p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null });
    onProgress(t / dur, 'Finding your swings…');
  }
  const ok = coarse.filter((f) => f.lm);
  if (ok.length < 10) return [];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hand = (f) => mid(f.lm[15], f.lm[16]);
  const shY = (f) => (f.lm[11].y + f.lm[12].y) / 2;
  const spd = ok.map((f, i) => (i ? Math.hypot(hand(f).x - hand(ok[i - 1]).x, hand(f).y - hand(ok[i - 1]).y) / (f.t - ok[i - 1].t || 0.125) : 0));
  const max = Math.max(...spd);
  // candidate peaks: fast, local max, hands above shoulders within 1.5 s before (the top)
  const peaks = [];
  for (let i = 1; i < ok.length - 1; i++) {
    if (spd[i] < 0.35 * max || spd[i] < spd[i - 1] || spd[i] < spd[i + 1]) continue;
    const hadTop = ok.some((f) => f.t < ok[i].t && f.t > ok[i].t - 1.5 && hand(f).y < shY(f));
    if (!hadTop) continue;
    if (peaks.length && ok[i].t - peaks[peaks.length - 1].t < 2.5) { if (spd[i] > peaks[peaks.length - 1].s) peaks[peaks.length - 1] = { t: ok[i].t, s: spd[i] }; continue; }
    peaks.push({ t: ok[i].t, s: spd[i] });
  }
  // practice swings are usually slower: keep peaks at least half as fast as the fastest
  const strong = peaks.filter((p) => p.s >= 0.5 * Math.max(...peaks.map((q) => q.s)));
  return strong.map((p, k) => {
    const prev = strong[k - 1]?.t ?? -Infinity, next = strong[k + 1]?.t ?? Infinity;
    return [Math.max(0, p.t - 2.8, (prev + p.t) / 2), Math.min(dur, p.t + 2.0, (p.t + next) / 2)];
  });
}

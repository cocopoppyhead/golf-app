// Pose extraction: runs MediaPipe Pose Landmarker over a video file, on the device.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { cleanTrack, findPhases } from './phases.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODELS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
};

let cached = { key: null, lm: null };

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
    v.onloadeddata = () => resolve(v);
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
export async function extractPose(video, { quality = 'full', onProgress = () => {} } = {}) {
  const lm = await getLandmarker(quality);
  const W = video.videoWidth, H = video.videoHeight, dur = video.duration;
  const fp = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  fp.canvas.width = fp.canvas.height = 24;
  let ts = 0; // MediaPipe VIDEO mode needs strictly increasing timestamps
  const detectAt = async (t) => {
    await seek(video, t);
    const r = lm.detectForVideo(video, (ts += 33));
    const p = r.landmarks?.[0];
    return p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null;
  };

  // Pass 1: coarse scan
  let window = [0, dur];
  if (dur > 4) {
    const coarse = [];
    const step = 1 / 8;
    for (let t = 0; t < dur; t += step) {
      coarse.push({ t, lm: await detectAt(t) });
      onProgress(0.3 * (t / dur), 'Finding your swing…');
    }
    try {
      const valid = coarse.filter((f) => f.lm);
      const fr = cleanTrack(valid);
      const ph = findPhases(fr);
      window = [Math.max(0, fr[ph.address].t - 0.8), Math.min(dur, fr[ph.finish].t + 0.8)];
    } catch {
      window = [0, Math.min(dur, 8)];
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
    const r = lm.detectForVideo(video, (ts += 17));
    const p = r.landmarks?.[0];
    frames.push({ t: video.currentTime, lm: p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null });
    onProgress(0.3 + 0.7 * ((t - t0) / (t1 - t0 || 1)), 'Tracking your body…');
  }
  onProgress(1, 'Done');
  return { frames, width: W, height: H, window };
}

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

export function seek(v, t) {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(t, v.duration - 0.001));
    let timer = null;
    const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    // Some browsers never fire 'seeked' when the time doesn't change (or on odd files): don't hang.
    timer = setTimeout(done, Math.abs(v.currentTime - target) < 1e-3 ? 50 : 1500);
    v.currentTime = target;
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
/**
 * Coarse scan of a whole clip. Finds every full swing and returns a window per swing that runs
 * from just before address to just after the finish, plus a guess at the camera view.
 * Returns { windows: [[t0, t1], ...], view: 'face' | 'dtl' | null }.
 */
export async function findSwings(video, { quality = 'full', onProgress = () => {} } = {}) {
  const lm = await getLandmarker(quality);
  const W = video.videoWidth, H = video.videoHeight, dur = video.duration;
  const step = dur > 40 ? 1 / 6 : 1 / 8;
  const coarse = [];
  for (let t = 0; t < dur; t += step) {
    await seek(video, t);
    const r = lm.detectForVideo(video, tick(Math.round(step * 1000)));
    const p = r.landmarks?.[0];
    coarse.push({ t, lm: p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null });
    onProgress(Math.min(1, t / dur), 'Finding your swing…');
  }
  const ok = coarse.filter((f) => f.lm);
  if (ok.length < 8) return { windows: [], view: null, seen: ok.length, anyTop: false };
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hand = (f) => mid(f.lm[15], f.lm[16]);
  const shY = (f) => (f.lm[11].y + f.lm[12].y) / 2;
  const hipY = (f) => (f.lm[23].y + f.lm[24].y) / 2;


  const spd = ok.map((f, i) => (i ? Math.hypot(hand(f).x - hand(ok[i - 1]).x, hand(f).y - hand(ok[i - 1]).y) / (f.t - ok[i - 1].t || step) : 0));
  const max = Math.max(...spd) || 1;
  // Candidate downswings: a fast local max with the hands above the shoulders shortly before it
  // (the top). 4 s look-back so slow-motion clips still qualify.
  const peaks = [];
  for (let i = 1; i < ok.length - 1; i++) {
    if (spd[i] < 0.35 * max || spd[i] < spd[i - 1] || spd[i] < spd[i + 1]) continue;
    const hadTop = ok.some((f) => f.t < ok[i].t && f.t > ok[i].t - 4 && hand(f).y < shY(f));
    if (!hadTop) continue;
    if (peaks.length && ok[i].t - ok[peaks[peaks.length - 1].i].t < 2.5) { if (spd[i] > peaks[peaks.length - 1].s) peaks[peaks.length - 1] = { i, s: spd[i] }; continue; }
    peaks.push({ i, s: spd[i] });
  }
  const anyTop = ok.some((f) => hand(f).y < shY(f)); // hands above the shoulders at some point: a backswing happened
  if (!peaks.length) return { windows: [], view: guessView(ok), seen: ok.length, anyTop };
  // practice swings are usually slower: keep peaks at least half as fast as the fastest
  const top = Math.max(...peaks.map((q) => q.s));
  const strong = peaks.filter((q) => q.s >= 0.5 * top);
  const still = 0.1 * max;

  const windows = strong.map(({ i }) => {
    const tp = ok[i].t;
    // Top of the backswing: highest hands in the 4 s before the fast part
    let ti = i;
    for (let j = i; j >= 0 && ok[j].t > tp - 4; j--) if (hand(ok[j]).y < hand(ok[ti]).y) ti = j;
    // Address: the last still moment, hands down by the hips, before the takeaway
    let addr = null;
    for (let j = ti - 1; j >= 1 && ok[j].t > tp - 8; j--) {
      const low = hand(ok[j]).y > (shY(ok[j]) + hipY(ok[j])) / 2;
      if (low && spd[j] < still && spd[j - 1] < still * 1.5) { addr = ok[j].t; break; }
    }
    if (addr == null) addr = Math.max(0, ok[ti].t - 1.6);
    // Finish: hands up and settled after impact
    let fin = null;
    for (let j = i + 1; j < ok.length && ok[j].t < tp + 4; j++) {
      if (hand(ok[j]).y < shY(ok[j]) && spd[j] < still * 1.5) { fin = ok[j].t; break; }
    }
    if (fin == null) fin = Math.min(dur, tp + 1.4);
    return [Math.max(0, addr - 0.5), Math.min(dur, fin + 0.7)];
  });
  // don't let neighbouring swings overlap
  for (let k = 1; k < windows.length; k++) {
    if (windows[k][0] < windows[k - 1][1]) {
      const m = (ok[strong[k - 1].i].t + ok[strong[k].i].t) / 2;
      windows[k - 1][1] = Math.min(windows[k - 1][1], m); windows[k][0] = Math.max(windows[k][0], m);
    }
  }
  // judge the view at address (shoulders square), not mid-swing when they're turned
  const atAddr = ok.filter((f) => windows.some(([a]) => f.t >= a && f.t <= a + 1.2));
  return { windows, view: guessView(atAddr.length >= 3 ? atAddr : ok), seen: ok.length, anyTop };
}

/** Face-on shows the shoulders and hips spread apart; from behind they overlap. */
function guessView(frames) {
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const vals = frames.map((f) => {
    const s = mid(f.lm[11], f.lm[12]), h = mid(f.lm[23], f.lm[24]);
    const torso = Math.hypot(s.x - h.x, s.y - h.y) || 1;
    return (Math.abs(f.lm[11].x - f.lm[12].x) + Math.abs(f.lm[23].x - f.lm[24].x)) / torso;
  }).sort((a, b) => a - b);
  const r = vals[vals.length >> 1] ?? 0;
  findSwings.lastRatio = r;
  return r > 0.75 ? 'face' : r < 0.5 ? 'dtl' : null;
}

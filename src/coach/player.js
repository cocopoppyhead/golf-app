import { seek } from './pose.js';
// Plays the analysed swing (address → finish) on a canvas with the pose overlay.
// Loops by default, can be scrubbed frame by frame, and can optionally freeze at each checkpoint.
import { drawOverlay } from './render.js';

export function nearestFrame(fr, t) {
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--;
  return lo;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class SwingPlayer {
  constructor(canvas, video, fr, A, { onCheckpoint = () => {}, onTime = () => {}, onState = () => {} } = {}) {
    Object.assign(this, { canvas, video, fr, A, onCheckpoint, onTime, onState });
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    this.ctx = canvas.getContext('2d');
    this.rate = 0.25; this.hold = 1600; this.loop = true; this.stopAtCp = false;
    this.playing = false; this.cpShown = -1; this.run = 0;
    this.refresh(A);
  }

  /** Recompute the play range and checkpoint times (after a nudge). */
  refresh(A) {
    const { fr } = this;
    this.A = A;
    this.start = fr[Math.max(0, A.checkpoints[0].frame - 6)].t;
    this.end = fr[Math.min(fr.length - 1, A.checkpoints[3].frame + 10)].t;
    this.cpTimes = A.checkpoints.map((c) => fr[c.frame].t);
  }

  /** Seek and draw. Rapid calls (scrubbing) collapse to the latest position. */
  async seek(t) {
    this.want = t;
    if (this.seeking) return this.seeking;
    this.seeking = (async () => {
      while (this.want != null) {
        const w = this.want; this.want = null;
        await seek(this.video, w);
        this.draw(); this.onTime(w);
      }
      this.seeking = null;
    })();
    return this.seeking;
  }

  /** Frame index of a checkpoint when the video sits on it, else -1. */
  cpAt(t) {
    const i = nearestFrame(this.fr, t);
    return this.A.checkpoints.findIndex((c) => c.frame === i);
  }

  draw(cpIndex = -1) {
    const { ctx, video, fr, A } = this;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    const i = nearestFrame(fr, video.currentTime);
    const k = cpIndex >= 0 ? cpIndex : (this.playing ? -1 : this.cpAt(video.currentTime));
    const cp = k >= 0 ? A.checkpoints[k] : null;
    drawOverlay(ctx, A, fr[cp ? cp.frame : i].lm, { cp, card: false, cpIndex: k });
  }

  async showCheckpoint(k) {
    this.stop();
    await seek(this.video, this.cpTimes[k]);
    this.cpShown = k; this.draw(k); this.onCheckpoint(k, false); this.onTime(this.cpTimes[k]);
  }

  async play() {
    if (this.playing) return;
    this.playing = true; this.onState(true);
    const run = ++this.run;
    const v = this.video;
    const alive = () => this.playing && this.run === run;
    if (v.currentTime >= this.end - 0.02 || v.currentTime < this.start - 0.02) await seek(v, this.start);
    let last = this.lastCpBefore(v.currentTime);
    const go = async () => {
      try { v.playbackRate = this.rate; } catch { v.playbackRate = 0.25; }
      await v.play().catch(() => {});
    };
    await go();
    const tick = async () => {
      if (!alive()) return;
      const t = v.currentTime;
      const k = this.lastCpBefore(t);
      if (k !== last && k >= 0) {
        last = k;
        if (this.stopAtCp) {
          v.pause(); await seek(v, this.cpTimes[k]);
          if (!alive()) return;
          this.cpShown = k; this.draw(k); this.onCheckpoint(k, false); this.onTime(this.cpTimes[k]);
          await wait(this.hold);
          if (!alive()) return;
          await go();
        } else this.onCheckpoint(k, true);
      }
      if (t >= this.end || v.ended) {
        v.pause(); this.draw(); this.onTime(this.end);
        if (!this.loop) { this.playing = false; this.onState(false); return; }
        await wait(700);
        if (!alive()) return;
        await seek(v, this.start); last = -1;
        if (!alive()) return;
        await go();
      } else { this.draw(); this.onTime(t); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  lastCpBefore(t) {
    let k = -1;
    this.cpTimes.forEach((x, i) => { if (t >= x - 0.004) k = i; });
    return k;
  }

  setRate(r) { this.rate = r; if (this.playing) { try { this.video.playbackRate = r; } catch {} } }

  stop() {
    const was = this.playing;
    this.playing = false; this.run++; this.video.pause();
    if (was) this.onState(false);
  }
}

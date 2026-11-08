import { seek } from './pose.js';
// Plays the analysed swing slowly on a canvas, freezing at each checkpoint.
import { drawOverlay } from './render.js';

export function nearestFrame(fr, t) {
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--;
  return lo;
}

export class SwingPlayer {
  constructor(canvas, video, fr, A, { onCheckpoint = () => {}, onEnd = () => {} } = {}) {
    Object.assign(this, { canvas, video, fr, A, onCheckpoint, onEnd });
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    this.ctx = canvas.getContext('2d');
    this.rate = 0.25; this.hold = 2200; this.playing = false; this.cpShown = -1;
    this.start = fr[Math.max(0, A.checkpoints[0].frame - 8)].t;
    this.end = fr[Math.min(fr.length - 1, A.checkpoints[3].frame + 12)].t;
    this.cpTimes = A.checkpoints.map((c) => fr[c.frame].t);
  }

  async seek(t) {
    await seek(this.video, t);
    this.draw();
  }

  draw(cpIndex = -1) {
    const { ctx, video, fr, A } = this;
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    const i = nearestFrame(fr, video.currentTime);
    const cp = cpIndex >= 0 ? A.checkpoints[cpIndex] : null;
    drawOverlay(ctx, A, fr[cp ? cp.frame : i].lm, { cp, card: false, cpIndex });
  }

  async showCheckpoint(k) {
    this.stop();
    await seek(this.video, this.cpTimes[k]);
    this.cpShown = k; this.draw(k); this.onCheckpoint(k);
  }

  async play() {
    if (this.playing) return;
    this.playing = true;
    const v = this.video;
    if (v.currentTime >= this.end - 0.02 || v.currentTime < this.start) await this.seek(this.start);
    let next = this.cpTimes.findIndex((t) => t > v.currentTime + 0.001);
    v.playbackRate = this.rate;
    await v.play().catch(() => {});
    const tick = async () => {
      if (!this.playing) return;
      if (next >= 0 && next < 4 && v.currentTime >= this.cpTimes[next]) {
        v.pause();
        await seek(v, this.cpTimes[next]);
        this.draw(next); this.onCheckpoint(next);
        const k = next; next = k + 1 < 4 ? k + 1 : -1;
        await new Promise((r) => setTimeout(r, this.hold));
        if (!this.playing) return;
        await v.play().catch(() => {});
      } else if (v.currentTime >= this.end) {
        v.pause(); this.playing = false; this.draw(); this.onEnd(); return;
      } else this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.playing = false; this.video.pause(); }
}

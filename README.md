# Golf app

Personal golf app. Module 1 is a **swing coach**; rounds, scorecards and the Bushnell laser come next.

Live: https://cocopoppyhead.github.io/golf-app/

## Swing coach

1. Film a face-on swing (portrait, hip height, 3–4 m away, whole body + ball in frame; slow-mo or 60 fps helps).
2. Pick the club and the video. Pose tracking (MediaPipe Pose Landmarker) runs **on the phone**. No video is uploaded anywhere.
3. Tap the ball.
4. You get the four checkpoints (address, top, impact, finish) with YOU vs TOUR PRO, pro marks on the video, and the biggest opportunity.
5. Optional:
   - **AI coach** sends the measurements and four annotated frames to Claude, using your own API key, which is stored on the phone only.
   - **Save video** renders an annotated MP4 to share.
6. Every swing is saved to **History** (on the phone, IndexedDB) with a trend table.

### What it measures (face-on)

| Checkpoint | Measures |
|---|---|
| Address | Ball position in stance, spine tilt, stance width vs shoulders |
| Top | Head shift, hip shift / sway past trail foot, spine tilt |
| Impact | Hip shift toward target, head vs address + ball, spine tilt vs address, hands ahead of ball |
| Finish | Weight over lead foot, trail heel up, chest facing target |

Inches are scaled from your height (Settings), so they're approximate. Target direction is detected automatically from where the hands go at the top, so right/left-handed and mirrored selfie video all work.

## Code map

```
src/coach/pose.js     MediaPipe on video frames (coarse scan to find the swing, then dense pass)
src/coach/phases.js   cleaning + checkpoint detection (speed-normalised, works for slow-mo)
src/coach/metrics.js  measurements + tour benchmarks + summary
src/coach/render.js   overlay drawing (skeleton, head box, ball line, pro marks, cards)
src/coach/player.js   slow playback with checkpoint freezes
src/coach/export.js   MP4 export (WebCodecs + mp4-muxer)
src/coach/ai.js       Claude API coaching
src/store.js          settings + IndexedDB history (has a `rounds` store ready for module 2)
```

## Dev

```
npm install
npm run dev        # http://localhost:5173/golf-app/
npm run build
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Roadmap

- Down-the-line view: swing plane, posture, early extension
- Rounds: score, putts, FIR/GIR, bogey-cause tags, scorecard photo
- Bushnell Pro X3 over Web Bluetooth (Android Chrome): lock-on → club recommendation from your carries

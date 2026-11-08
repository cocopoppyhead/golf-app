# Golf app

Personal golf app. Module 1 is a **swing coach**; rounds, scorecards and the Bushnell laser come next.

Live: https://cocopoppyhead.github.io/golf-app/

## Swing coach

The raised camera button in the middle of the nav opens the Swing page: **Record a swing** (opens the camera) or **Upload a video** (gallery), club, learning mode, filming tips, and recent swings. Tap a recent swing to replay its full analysis (videos are kept on the phone; switch off in Settings).

1. Film a face-on swing (portrait, hip height, 3–4 m away, whole body + ball in frame; slow-mo or 60 fps helps).
2. Pick the club and the video, then **trim** to one swing (drag the start/end handles to cut walking in, practice swings and walking off). Pose tracking (MediaPipe Pose Landmarker) runs **on the phone**. No video is uploaded anywhere.
3. Tap the ball.
4. You get the four checkpoints (address, top, impact, finish) with YOU vs TOUR PRO, pro marks on the video, and the biggest opportunity. If a checkpoint lands on the wrong frame, nudge it with ◀ ▶ and everything re-measures.
5. Optional:
   - **AI coach** sends the measurements and four annotated frames to Claude, using your own API key, which is stored on the phone only.
   - **Save video** renders an annotated MP4 to share.
6. **Learning mode** (tickbox, on by default): swings that count build your coach profile. It finds recurring faults (tendencies), sets one work-in-progress focus, checks every new swing against it, and marks it fixed at 4 of 5 on target. The AI coach gets this history and its own notebook, so reviews follow on from the last one. Untick for test swings. Rounds will feed the same profile.
7. Every swing is saved to **Progress** (on the phone, IndexedDB) with a trend table.

### What it measures (face-on)

| Checkpoint | Measures |
|---|---|
| Address | Ball position in stance, spine tilt, stance width vs shoulders |
| Top | Head shift, hip shift / sway past trail foot, spine tilt |
| Impact | Hip shift toward target, head vs address + ball, spine tilt vs address, hands ahead of ball |
| Finish | Weight over lead foot, trail heel up, chest facing target |

Inches are scaled from your height (Settings), so they're approximate. Target direction is detected automatically from where the hands go at the top, so right/left-handed and mirrored selfie video all work.

## Rounds

- **Courses**: type pars (tap to cycle 3/4/5), stroke index and yards, or fill them from a scorecard photo (Claude reads it).
- **Log on the course**, hole by hole, with big buttons: score, putts, first-putt distance, tee shot (◀ trouble / rough / fairway / rough / trouble ▶), green hit is worked out automatically (or set by hand), miss direction plus green-side bunker, up-and-down and sand saves calculated.
- **Bogey or worse → "what caused it?"** Tag the shot with your codes: shot (DRV/TEE/IRN/APP/CHP/BNK/PT), cause (TAC/SWE/FOC/BAC), flight/strike (HK/PL/SL/PU/THN/FAT/TOE/HEL), where it ended up (BNK/OBS/WDS/RGH/SS/LNG/SHT), cost +1/+2, or "saved it" on a par.
- **Or after the round**: photograph the card, check the scores it read, then it walks you through only the bogey holes to tag them.
- **Stats**: fairways, greens, miss patterns, putts, 3-putts, scrambling, sand saves, scoring mix, strokes lost by cause/shot/strike. Per round and per-round average across recent rounds.
- **Coach link**: on-course patterns (e.g. "tee shots miss right", "most shots lost to SWE") show in Progress next to swing tendencies and go to the AI coach. **AI round review** reads the round, recent rounds and your swing profile together. Untick "count toward my coach profile" for scrambles or fun rounds.

## Bag

Your clubs and carries (editable; seeded with the numbers from the rangefinder chat), gap warnings, and a "which club?" box. The laser will fill the distance in later.

## Code map

```
src/coach/pose.js     MediaPipe on video frames (coarse scan to find the swing, then dense pass)
src/coach/phases.js   cleaning + checkpoint detection (speed-normalised, works for slow-mo)
src/coach/metrics.js  measurements + tour benchmarks + summary
src/coach/render.js   overlay drawing (skeleton, head box, ball line, pro marks, cards)
src/coach/player.js   slow playback with checkpoint freezes
src/coach/export.js   MP4 export (WebCodecs + mp4-muxer)
src/coach/ai.js       Claude API coaching (with coaching history)
src/coach/profile.js  coach memory: tendencies, current focus, progress, notebook
src/rounds/stats.js   round stats, on-course tendencies (pure)
src/rounds/ui.js      courses, hole logger, tag sheet, scorecard import, summaries
src/bag.js            clubs, carries, club picker
src/store.js          settings + IndexedDB (swings, media, rounds, courses)
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
- Bushnell Pro X3 over Web Bluetooth (Android Chrome): lock-on → club recommendation from your carries

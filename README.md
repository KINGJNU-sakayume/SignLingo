# SignLingo · Motion Lab

A client-side video → MediaPipe landmarks → constrained articulated mannequin proof of concept for investigating Korean Sign Language (KSL) reconstruction. **This is an estimated motion tool, not a validated KSL instructor.** No curriculum, accounts, scoring, prerecorded gestures, or server inference.

## Use without a local installation

1. In the GitHub repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. This one-time repository setting requires an owner/admin. The ordinary workflow token cannot enable a new Pages site itself.
2. Push to `main`, or open **Actions → Validate and deploy Motion Lab → Run workflow**. The workflow installs locked dependencies, type-checks, tests, builds, validates the browser UI, and deploys the resulting static artifact.
3. Open the URL in the workflow's `github-pages` environment after deployment succeeds. For this repository the expected URL is `https://kingjnu-sakayume.github.io/SignLingo/`; an expected URL is not evidence of deployment.
4. Upload an MP4 (H.264 recommended) or WebM (VP8/VP9), up to 120 seconds and 250 MB. Use one signer with shoulders, wrists, and hands visible. No video is included in this repository.
5. Enable **Mirrored source** only if the *saved pixels* are horizontally reflected. Both models receive unmirrored pixels; the source overlay maps back to the displayed pixels. A selfie preview alone does not establish whether the saved file is mirrored.
6. Choose 15 or 30 samples/second and **Extract & reconstruct**. First use downloads model assets; CPU inference can take longer than video duration. Progress and cancellation are available.
7. Compare source and 3D playback. Scrub, choose 0.25×/0.5×/1×, orbit, zoom, switch front/side/rear, show the skeleton/joints, and jump to flagged frames. Turquoise is anatomical left; amber is right.
8. Export motion JSON. Reimport it later without rerunning inference. To compare again, attach the matching original filename/size and duration. JSON does **not** contain the video. Filename/size/duration matching is a convenience, not cryptographic source verification.

No video, extracted landmarks or motion JSON are uploaded by the application. Model/CDN hosts receive ordinary asset requests. JSON exports contain source filenames and motion data; share deliberately. Live HTTPS and WebGL2 are required; recent desktop Chrome/Edge is the tested browser target.

## What the viewer means

- **Rest pose** is a static rig preview, never a reconstructed sign.
- Missing arms/hands are withheld. A lost handshape can be held for at most 200 ms, colored amber and explicitly assigned confidence zero; after that the hand mesh is hidden. Observed arm motion can remain visible.
- Confidence numbers are pose visibility/presence and a conservative proxy combining arm visibility with hand *handedness classification* score. MediaPipe does not return a calibrated accuracy score for each finger. A high value does not establish correct depth or handshape.
- Flagged frames include uncertain hand identity, wrist jumps, behind-torso depth, degenerate geometry, and anatomical limit corrections. No flag does not imply accuracy.
- Legs are static presentation geometry. Facial expression and linguistic nonmanual grammar are not reconstructed. Head direction is only a coarse nose/ear estimate.
- Manual wrist edits apply to the current sampled frame, are bounded by the same wrist limits, interpolate to adjacent frames, and persist in JSON. They are not a full pose editor; reprocessing discards edits.

## Development / validation

Node 24 is used in CI; Node ≥22.12 is required by Vite 8.

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run dev
```

An existing Chromium can be selected with `CHROMIUM_PATH=/absolute/path/to/chromium`. The opt-in `vision.spec.ts` performs actual MediaPipe inference, without mocked predictions. It requires `VISION_TEST_VIDEO=/path/to/clip.mp4`, plus the two unmodified `.task` files in `work/`. It serves those exact upstream model bytes and package WASM bytes locally in restricted test environments. See the technical report for what was actually tested; routine CI skips this optional external-asset test.

Vite uses relative asset URLs (`base: './'`) so workers and JS resolve under `/SignLingo/` and custom domains. Override `VITE_BASE_PATH` when a specific deployment needs it. No history router or backend routes are required.

## Pinned inference assets and network failures

| Asset | Exact source |
|---|---|
| Pose full float16, revision 1 | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task |
| Hand float16, revision 1 | https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task |
| Tasks Vision 1.1.0 WASM loader/binaries | https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm |

The two models total approximately 16.5 MB, plus WASM. Their URLs and runtime version are included in motion exports. Hosts must support HTTPS/CORS and remain reachable. A blocked CDN, failed download, unsupported WASM/SIMD, missing WebGL2/OffscreenCanvas, or unsupported video codec causes an explicit error. There is no gesture fallback. Versioned URLs do not guarantee perpetual availability. The app does not install a service worker or promise offline model caching.

MediaPipe code is Apache 2.0; consult upstream model cards/terms for selected model assets. This repository does not relicense external models, datasets, or footage. No private videos/checkpoints/datasets are committed.

## Architecture

| Module | Responsibility |
|---|---|
| `src/motion/video.ts` | Bounded local video decoding, frame seeks, sampling, pixel unmirroring, progress/cancel |
| `detector.ts`, `detector.worker.ts` | Replaceable detector contract; real Pose + Hand Tasks inference in a worker |
| `math.ts` | Explicit coordinate conversion, hand registration, two-bone IK, quaternion frames and wrist limits |
| `tracking.ts` | Unique anatomical wrist association, confidence gating, ambiguous-crossing rejection |
| `reconstruct.ts` | Torso/head estimation, fixed-length rig retargeting, finger constraints, adaptive filtering and diagnostics |
| `player.ts` | Timestamp lookup, quaternion interpolation, bounded manual edits; video as master clock |
| `serialization.ts`, `types.ts` | Versioned KSL motion contract, strict import validation, raw observations and correction metadata |
| `components/Avatar.tsx` | Procedural hierarchical mesh rig with 30 finger segment joints; orbitable Three.js viewer |
| `components/Overlay.tsx`, `App.tsx` | Synchronized comparison, source overlays, diagnostics and correction controls |
| `.github/workflows/pages.yml` | Validation and static Pages deployment |

Read [RECONSTRUCTION_REPORT.md](RECONSTRUCTION_REPORT.md) for coordinate conventions, constraints, model research, evidence, and known accuracy limits. KSL is an independent language; no spoken-Korean word-to-gesture assumption is encoded here.

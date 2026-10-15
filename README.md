# SignLingo · Motion Lab + Practice

A client-side video → MediaPipe landmarks → articulated mannequin proof of concept for investigating Korean Sign Language (KSL) reconstruction. **This is an estimated motion tool, not a validated KSL instructor.** Includes local webcam practice with component-level movement residuals. No curriculum, accounts, definitive correctness score, prerecorded gestures, or server inference.

## Use without a local installation

1. In the GitHub repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. This one-time repository setting requires an owner/admin. The ordinary workflow token cannot enable a new Pages site itself.
2. Push to `main`, or open **Actions → Validate and deploy Motion Lab → Run workflow**. The workflow installs locked dependencies, type-checks, tests, builds, validates the browser UI, and deploys the resulting static artifact.
3. Open the URL in the workflow's `github-pages` environment after deployment succeeds. For this repository the expected URL is `https://kingjnu-sakayume.github.io/SignLingo/`; an expected URL is not evidence of deployment.
4. Upload an MP4 (H.264 recommended) or WebM (VP8/VP9), up to 120 seconds and 250 MB. Use one signer with shoulders, wrists, and hands visible. No video is included in this repository.
5. Enable **Mirrored source** only if the *saved pixels* are horizontally reflected. Both models receive unmirrored pixels; the source overlay maps back to the displayed pixels. A selfie preview alone does not establish whether the saved file is mirrored.
6. Choose 15 or 30 samples/second and **Extract & reconstruct**. First use downloads model assets; CPU inference can take longer than video duration. Progress and cancellation are available.
7. Compare source and 3D playback. Scrub, choose 0.25×/0.5×/1×, repeat an A–B section, orbit, zoom, switch front/side/first-person/hand close-up views, show the skeleton/joints, and jump to flagged frames. Turquoise is anatomical left; amber is right. **몸통 고정** (off by default here) previews the learner screens' steadied torso; Motion Lab otherwise shows stored poses unchanged.
8. Export motion JSON. Reimport it later without rerunning inference. To compare again, attach the matching original filename/size and duration. JSON does **not** contain the video. Filename/size/duration matching is a convenience, not cryptographic source verification.

No video, extracted landmarks or motion JSON are uploaded by the application. Model/CDN hosts receive ordinary asset requests. JSON exports contain source filenames and motion data; share deliberately. Live HTTPS and WebGL2 are required; recent desktop Chrome/Edge is the tested browser target. On iOS/iPadOS, Tasks Vision runs on the main thread to avoid a WebKit worker canvas incompatibility; processing can be slower and briefly use more battery. Other browsers retain worker inference, with a main-thread retry only for worker DOM/canvas errors. This compatibility route is not yet validated on physical iOS hardware.

## What the viewer means

- **Rest pose** is a static rig preview, never a reconstructed sign.
- Missing arms/hands are withheld. A lost handshape can be held for at most 200 ms, colored amber and explicitly assigned confidence zero; after that the hand mesh is hidden in Motion Lab. Observed arm motion can remain visible. Learner screens additionally fill such hands **for display only** (translucent orange, legend “추정으로 채운 손 모양”); stored clips and diagnostics keep the original states. See [the display pipeline](docs/DISPLAY_PIPELINE.md).
- Confidence numbers are pose visibility/presence and a conservative proxy combining arm visibility with hand *handedness classification* score and, in 0.2, palm conditioning. MediaPipe does not return a calibrated accuracy score for each finger. A high value does not establish correct depth or handshape.
- Flagged frames include uncertain hand identity, wrist jumps, behind-torso depth, degenerate geometry, and anatomical limit corrections. No flag does not imply accuracy.
- Only the upper body is drawn (no legs, pelvis or floor), as in broadcast signing. Facial expression and linguistic nonmanual grammar are not reconstructed. Head direction is only a coarse nose/ear estimate. The first-person view looks at the hands from just below the signer's eyes and keeps anatomical left/right; the learner mirror view reflects the rendering only.
- Manual wrist edits apply to the current sampled frame, are limited to ±45° per axis (legacy 0.1 clips also retain their original wrist bounds), interpolate to adjacent frames, and persist in JSON. They are not a full pose editor; reprocessing discards edits.

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

The two models total approximately 16.5 MB, plus WASM. The local batch tool caches them in `work/models/` and records their SHA-256 on first download, then refuses changed bytes ([details](docs/MOTION_BATCH.md)). Their URLs and runtime version are included in motion exports. Hosts must support HTTPS/CORS and remain reachable. A blocked CDN, failed download, unsupported WASM/SIMD, missing WebGL2/OffscreenCanvas, or unsupported video codec causes an explicit error. There is no gesture fallback. Versioned URLs do not guarantee perpetual availability. The app does not install a service worker or promise offline model caching.

MediaPipe code is Apache 2.0; consult upstream model cards/terms for selected model assets. This repository does not relicense external models, datasets, or footage. No private videos/checkpoints/datasets are committed.

## Architecture

| Module | Responsibility |
|---|---|
| `src/motion/video.ts` | Bounded local video decoding, frame seeks, sampling, pixel unmirroring, progress/cancel |
| `detector.ts`, `detector.worker.ts` | Replaceable detector contract; real Pose + Hand Tasks inference in a worker or iOS document-backed CPU adapter |
| `handRegions.ts`, `visionResult.ts`, `association.ts` | Experimental 0.3.1 hand-region gap-fill: pose-predicted crops for sides the wrist rule left empty, crop→frame inverse, one hand per side; the single-frame wrist association it shares with the solver |
| `extract.ts`, `pipeline.ts` | Shared Motion Lab / batch extraction entry; pipeline version metadata |
| `math.ts` | Explicit coordinate conversion, hand registration, two-bone IK, quaternion frames and wrist limits |
| `tracking.ts` | Unique anatomical wrist association, confidence gating, ambiguous-crossing rejection |
| `reconstruct.ts` | Torso/head estimation, fixed-length rig retargeting, finger constraints, adaptive filtering and diagnostics |
| `player.ts` | Timestamp lookup, quaternion interpolation, bounded manual edits; video as master clock |
| `display/` | Pure display-only post-processing (torso steadying with arm IK compensation, constraint preview, handshape filling), per-screen presets; never stored or compared ([details](docs/DISPLAY_PIPELINE.md)) |
| `constraints/` | `signlingo.constraints` v1 documents and a pure solver: same height, contact, symmetry, handshape presets, palm facing, hold and wrist offsets, re-solved with the fixed-length arm IK; corrected clips are MotionClip version 2 ([details](docs/CONSTRAINTS.md)) |
| `serialization.ts`, `types.ts` | Versioned KSL motion contract (version 1, and version 2 for constraint-corrected poses), strict import validation, raw observations and correction metadata |
| `components/Avatar.tsx` | Procedural upper-body mesh rig with 30 finger segment joints; front/side/first-person/hand close-up views, render-only mirror view |
| `components/Overlay.tsx`, `App.tsx` | Synchronized comparison, source overlays, diagnostics and correction controls |
| `src/batch/` | Local `motion:batch` / `motion:compare` / `motion:report` tools: headless Chromium runs the same extraction path; per-clip reports ([details](docs/MOTION_BATCH.md)) |
| `.github/workflows/pages.yml` | Validation and static Pages deployment |

Read [RECONSTRUCTION_REPORT.md](RECONSTRUCTION_REPORT.md) for coordinate conventions, constraints, model research, evidence, and known accuracy limits. KSL is an independent language; no spoken-Korean word-to-gesture assumption is encoded here.

## Phase 2 reconstruction laboratory

The default 0.2.0 solver preserves source finger directions through the rendered parent hierarchy and separates forearm axial roll from wrist swing without clamping the detected palm orientation. Unusual estimated angles are inspection warnings; they are not silently forced into a neutral handshape. Fixed arm reach remains constrained, with every applied correction recorded.

Enable **Technical inspection mode** after processing or importing motion. Compare original 0.1.0 and improved 0.2.0 on identical detections, inspect detected/rendered joints, direction residuals, joint-angle timelines, coverage, abrupt rotations, identity clues, elbow instability and per-joint corrections. The optional lab preserves the main upload, playback, camera and manual-edit workflow. Summary numbers are proxies, never linguistic accuracy.

See [the reproducible consented evaluation workflow](docs/EVALUATION.md) for separate handshape, palm, location, path, coordination, temporal and anatomical review. `npm run evaluate -- --motion private-data/clip.motion.json --consent` produces a local summary in `work/evaluation/`. No real KSL validation is claimed. Schema version 1 and all 38 local joint names remain compatible; the pipeline version identifies solver behavior. Constraint-corrected clips are version 2: they keep every observation, the pipeline record and the original rotations of each changed joint.

## Phase 3: webcam practice

Select **Practice Mode** in the workspace navigation. Motion Lab remains available and retains its loaded state when switching; its playback and processing pause/cancel on exit.

1. Load an existing MotionClip JSON. Watch the reference avatar; attach the matching original video when available.
2. Select English or 한국어. Enable the camera explicitly and keep head, shoulders, arms and hands in view; hips are optional for every comparison component. Optionally check a framing snapshot before recording. Camera/recording measurements are separate from inference throughput. Selfie preview mirroring does not change anatomical left/right. Use the separate input-unmirror option only if actual camera pixels are already mirrored.
3. Start the three-second countdown, imitate the sign, and stop recording (20-second maximum). Recording runs without inference, then the saved file is analyzed locally through the existing MediaPipe detector and reconstruction pipeline. Choose 30 Hz (default) or 15 Hz analysis; slower processing does not set the recording frame rate. No audio is requested.
4. Check the proposed active signing intervals. Adjust the reference and learner start/end times to include the entire sign and meaningful holds while removing surrounding idle time.
5. Inspect DTW-aligned avatars/video, time mapping, wrist paths and separate articulation, palm, shoulder/face location, trajectory, direction and bilateral coordination residuals. Timing is descriptive, not a speed penalty. Click feedback to seek its evidence and highlight the hand.
6. Choose **Try again** as often as needed. Camera tracks stop on recording stop, failure, cancellation, tab hiding and leaving Practice Mode. Completed recordings remain available after analysis cancellation/failure for reanalysis or explicit download; clips and recordings stay in browser memory and are discarded on exit/reload. No automatic recording upload or persistence exists.

Lower residuals do not prove correct KSL. Missing tracking is not scored as an error or perfect match. Meaning changes require qualified linguistic review. See [PRACTICE_EVALUATION.md](PRACTICE_EVALUATION.md) for formulas, engineering thresholds, evidence gates, tested scenarios and unvalidated claims.

Practice uses `src/practice/{capture,features,compare,types}.ts` plus a localized React view, with the existing MotionClip schema, reconstructor and avatar. The [iOS Safari runtime fix (#2)](https://github.com/KINGJNU-sakayume/SignLingo/pull/2) is integrated on top of Practice Mode. iOS uses Canvas-backed main-thread inference; supported platforms keep workers. Use **Record or choose a phone video** to process a short native-camera recording locally with the same recording-first analysis pipeline. The user reports successful inference at approximately 6.6 FPS on iPhone 15 Pro / iOS 27.0.1 / Safari. That is not a measured encoded recording rate; the new recording-first behavior still needs physical-device validation. An optional `PRACTICE_VISION_TEST=1` browser smoke test runs actual MediaPipe against a local public-photo canvas stream when the documented ignored assets are available.

See [mobile Practice behavior, evidence requirements and device verification](docs/MOBILE_PRACTICE.md) for partial-feature semantics, fallback limits and the automated versus physical-device test matrix.

Read [the upper-body and capture report](docs/UPPER_BODY_CAPTURE.md) for hip-independent coordinates, independent 2D/3D evidence, decoded-frame timestamps, capture/analysis measurements, actual benchmark results and remaining limitations. GPU delegation and MediaPipe runtime routing are unchanged.

## Phase 5: content-driven KSL learning

Learning Mode now starts from `public/content/manifest.json`. Approved expressions load their reviewed MotionClip automatically and continue into the existing Practice Mode. Current release: **10 researched candidates, 0 published expressions**; rights and expert reviews are still required. Upcoming courses are not playable.

**학습하기** is a Duolingo-style learning path: units of 3–5 minute lessons, one question per screen, a feedback sheet, a completion screen and Leitner review. Recognition questions are graded; camera imitation only shows observed differences and is never graded. Streaks, XP, hearts and leagues are intentionally absent. Run `npm run dev` and open `/?demo=1` to try the flow with development-only synthetic demo motions (never bundled into production builds). See [the learning design](docs/LEARNING_DESIGN.md) for tokens, screens, grading principles, the demo mode and what was left out.

See [source and rights research](docs/KSL_CONTENT_RESEARCH.md) and [content preparation, review and publishing](docs/CONTENT_PUBLISHING.md). `npm run content:validate` checks rights, separate reviews, evidence documents, asset integrity and published-version compatibility; production builds run it automatically. Motion Lab and its local inspection flow remain available.

## Batch processing and the experimental pipeline 0.3.1

Motion Lab and `npm run motion:batch` extract with pipeline **0.2.0** by default. Pipeline **0.3.1** is an opt-in experiment: Motion Lab's **실험: 손 영역 재검출** checkbox or `--pipeline 0.3.1`.

- 0.3.1 keeps the full-frame hands exactly as 0.2.0 stores them. Only a side the wrist rule left without a hand gets a pose-predicted crop, sized from the image-space forearm, upscaled to 320 px and run through an IMAGE-mode HandLandmarker.
- At most one crop hand per side is added, chosen by distance to that side's pose wrist, never by handedness label.
- A fill is kept only if the same wrist rule still assigns every full-frame hand as before. A frame whose full-frame pass found two hands is therefore identical to 0.2.0.
- 0.3.1 clips record `pipeline.handRegions` (method `pose-forearm-roi-v2-gapfill`), a learner-display temporal policy, and each hand's `origin`, all within schema 1.
- The earlier 0.3.0 let crop hands compete with full-frame hands by score. On the private evaluation it did not reduce missing hands and, with two nearby hands, displaced correctly tracked ones. Its clips still load but are no longer produced.

The learner display's hand filling has a safeguard: hands with too little observed evidence in the signing interval, or with off-screen wrists, are hidden rather than filled.

`npm run motion:batch`, `motion:compare` (with `--trace <file>` for frame-by-frame diagnostics) and `motion:report` process local videos in headless Chromium through the same `extractMotion()` path, with all off-machine requests blocked. Reports go to `work/` and contain numbers and coordinates only.

See [batch processing and 0.3.1](docs/MOTION_BATCH.md) and the [recording guide](docs/RECORDING_GUIDE.md) for contributors. Real-video comparisons run privately; private videos and derived JSON are never committed.

### Constraint correction

A finished motion can be corrected with a constraint document (`signlingo.constraints` v1): "the hands meet at the same height", "index fingers extended", "palm facing down". A person, or an LLM working outside the app from [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md), writes the JSON; the static app never calls an LLM. Motion Lab previews it over the original with residual graphs and exports a corrected version-2 clip; `npm run content -- constrain` applies it to a review package (new revision, reviews reset); `motion:batch --constraints <folder>` applies reviewer-written intent right after recognition; `npm run motion:constrain-report` writes before/after residuals to `work/constraint-report.*`. Facial expression, nonmanual signals and unobserved fine finger movement are never generated.

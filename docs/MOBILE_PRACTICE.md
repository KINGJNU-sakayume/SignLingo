# Mobile Practice Mode: behavior and verification

> Historical report for mobile PR #4. The live-inference capture and hip-dependent position sections below describe that baseline. Current recording-first behavior, upper-body coordinates and new measurements are documented in [UPPER_BODY_CAPTURE.md](UPPER_BODY_CAPTURE.md). The user has since reported working inference (~6.6 FPS) on iPhone 15 Pro / iOS 27.0.1 / Safari; encoded recording rate was not measured.

This change integrates the detector routing from PR #2 on main after PR #3
(`2bb8145`), preserving Practice Mode, MotionClip v1, model versions, the
reconstructor, hand association algorithm, DTW algorithm and Pages deployment.

## Inference and capture

- iPhone Safari, Chrome on iOS (`CriOS`) and iPad desktop-UA mode select
  document-owning main-thread CPU inference. Other supported browsers retain
  the module worker. Missing Worker/ImageBitmap capabilities also select the
  main thread. Worker DOM/OffscreenCanvas failures at initialization or inference
  retry on the main thread; unrelated model errors remain errors.
- Main-thread inference accepts an HTML Canvas directly. It does not require
  ImageBitmap or OffscreenCanvas. Each frame yields before synchronous Tasks
  inference. A Canvas snapshot is retained while a worker owns its transferred
  bitmap, allowing a DOM-error retry at the same timestamp.
- Initialization is cancellable and bounded to 120 seconds. A task completing
  initialization after cancellation closes itself. Partial model initialization
  closes the first task if the second fails. Workers, tasks, bitmaps, camera
  tracks, recorder handlers, timers, frame arrays and object URLs are released
  on their respective completion/failure/cancellation paths.
- Static avatars render on demand, including the hidden Motion Lab view. Stable
  Practice poses are memoized so live diagnostics do not redraw unchanged 3D
  scenes. Pose changes and orbit controls still update the views.
- Live input requests the front camera without audio, up to 960-pixel long-edge
  processing, preserving portrait aspect ratio. Canvas storage is reused. There
  is one inference in flight, a 15 FPS target and at least 10 ms between samples;
  slow inference reduces sampling instead of building an unbounded queue or
  shrinking fingers further. The UI reports measured completion FPS (last 30
  completed samples), not the requested camera frame rate.
- Preview mirroring is CSS-only. The separate actual-pixels-mirrored option
  reflects pixels before inference. The overlay applies the corresponding XOR
  reflection so canonical landmarks line up with the displayed raw preview.
- Track mute/end, page hiding and page exit discard the attempt with an explicit
  retry message. Frozen video time/no decoded frames for 2.5 seconds also fail.
  Rotating the device during recording invalidates mixed-orientation capture;
  start again in the chosen orientation. Live inference has a 10-second deadline.
- MediaRecorder negotiates VP8 WebM, WebM, MP4 or browser default. Unsupported
  recording, permission denial, capture failure, model initialization failure,
  inference failure, insufficient tracking and insufficient comparison evidence
  have distinct messages. Failed inference never creates a successful attempt.

## Evidence requirements

No hip coordinates, wrist positions or torso heights are synthesized for
comparison. Raw landmarks remain separate from held/interpolated avatar poses.
Confidence requirements stay at 0.6 for reliable pose references and hand
observations; the hand-only identity fallback is stricter (0.9).

| Component | Evidence required |
| --- | --- |
| Handshape | Reliable observed hand, valid 21-point geometry, well-conditioned palm and valid finger segments; independent of hips, shoulders and arm reconstruction |
| Anatomical side | Existing wrist association with reliable image wrist; if no body is detected at all, a unique high-confidence hand label may support hand-only shape, with an explicit identity limitation |
| Palm orientation | Reliable shoulders and a nondegenerate frame; full torso uses measured hips, otherwise an approximate shoulder frame uses camera-up |
| Torso position, trajectory, direction, coordination | Reliable full torso frame, measured torso height and the relevant world/image wrists; unavailable without them |
| Face position | Torso-position requirements plus a reliable nose |

The shoulder frame is sensitive to camera tilt and cannot measure torso height
or torso-relative position. Palm comparisons require the **same frame type**;
a full-torso reference versus a cropped learner can still compare handshape,
but cannot produce an incompatible palm/position score. Hand-only model labels
are less reliable than wrist association; verify left/right visually. Existing
crossing-wrist ambiguity is not bypassed with a label when body landmarks exist.
An avatar can remain neutral/withheld while raw handshape evidence is available.

Live diagnostics report model state, processed FPS, body and each hand state,
current feature availability (shape/palm/torso position/face position per hand,
8 possible components), and reasons for missing measurements. This per-frame
percentage is distinct from comparison coverage over both selected intervals.

A completed capture needs at least 3 usable hand frames and at least 20% of
processed frames with hand evidence. Live attempts spanning over a second also
need at least 5 processed FPS; otherwise the phone-video fallback is recommended.
These are engineering rejection gates, **not** an accuracy or KSL-validity claim.
The existing comparison threshold remains 65% distinct-frame coverage and at
least 3 samples in each clip per metric. Unavailable metrics remain null, never
zero/perfect. Partial results explicitly report insufficient comparison evidence.

## Phone-video fallback

Inside Practice Mode, load the same reference JSON and choose **Record or choose
a phone video**. The `capture="user"` file input offers native phone capture where
supported; desktop browsers offer file selection. Record a complete short sign
(up to 20 seconds and 100 MB), return to the page and process it locally.
H.264 MP4 is the preferred interoperable format; codec support is browser-specific.
The browser handles the file's decoded portrait orientation. Use the actual-pixel
unmirror option only when the recorded file itself is mirrored.

This path does not use getUserMedia or MediaRecorder and does not require
real-time CPU throughput. It samples the recorded video sequentially at 15 Hz
and uses the existing detector/reconstructor and reference comparison workflow.
It supports cancellation, decode/model/inference errors and tracking rejection.
It does not retry a failed live attempt invisibly or accept an empty recording.

“Offline” means video processing is local, with no inference server or video
upload. The app and MediaPipe assets must first be reachable/downloaded. There
is no service worker or guaranteed offline asset cache; a fresh offline browser
cannot download models. The fallback cannot repair an unsupported codec or a
model that cannot load—those failures remain visible.

## Automated verification for this change

- `npm run typecheck`, `npm test` (100 passed), and `npm run build` passed.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`: 15 passed,
  3 external-asset tests skipped.
- Synthetic geometry tests: missing hips, missing wrist/nose, hand-only input,
  partial metrics, ambiguous identity, zero/low detection coverage, and existing
  reconstruction, DTW, mirrored-input and desktop Practice Mode regressions.
- Detector tests: iOS Safari/CriOS/iPad selection, worker preservation, missing
  ImageBitmap, DOM-error retry at initialization/inference, cancellation and
  initialization deadlines, late task cleanup, partial initialization failure,
  bitmap cleanup and cancellation before queued inference.
- Capture tests: actual FPS/diagnostics, mute/disconnect, frozen video clock,
  orientation changes, setup/recorder/inference errors, undersampling, permission
  cancellation, short/empty recordings and time/resource bounds.
- Chromium browser tests: existing desktop workflows; native-file fallback with
  MediaRecorder unavailable; a real decoded synthetic portrait H.264 file;
  successful reference comparison; empty tracking/model/inference failure;
  diagnostics and overlay; page visibility interruption; fallback cancellation;
  iOS-selected main-thread Tasks adapter with ImageBitmap disabled and an actual
  red/blue pixel-unmirroring assertion. The detector outputs/Tasks API are mocked
  in these tests, so they establish lifecycle behavior, not model accuracy.

The existing opt-in real-MediaPipe tests were **not run for this change**:
`VISION_TEST_VIDEO` / `PRACTICE_VISION_TEST` and their ignored model/photo assets
were not supplied. Three tests are explicitly skipped by the default suite.
Chromium with an iOS user agent is **not iPhone Safari validation**. No physical
phone or WebKit engine verification is claimed.

## Physical-device verification still required

Run on the HTTPS Pages build in iPhone Safari, Chrome on the same iPhone,
iPad desktop-UA Safari, and Android Chrome. Record device, OS/browser version,
backend, sustained FPS and feature coverage; do not mark all mobile devices
verified from one model.

1. Grant/deny/revoke permission; cancel during permission and model loading.
   Retry and verify that only one camera session survives and the camera
   indicator turns off on stop, failure, cancel and mode exit.
2. In portrait, record a well-lit 5–10 second sign with hips cropped, then a
   full-torso version. Verify fingers remain tracked, the overlay lines up,
   missing-position reasons are truthful, and unavailable metrics stay blank.
3. Toggle preview mirroring, raise the anatomical left hand, and verify identity
   and overlay. Repeat with an actually mirrored file and the input-unmirror
   option. Exercise hands crossing, occlusion and a one-hand sign.
4. Lock/unlock, switch apps/tabs, interrupt the camera, and rotate mid-recording.
   Confirm an explicit discarded-attempt message and successful fresh retry.
5. Try slower hardware/thermal throttling and repeat several attempts. Check
   responsiveness, FPS, memory growth and camera/CPU release; use the fallback
   when live sampling is insufficient.
6. Record using the native phone-video input and select an existing phone video.
   Check portrait metadata, H.264 MP4 (and HEVC only if supported), cancellation,
   replay, interval trimming and comparison against the unchanged reference.
7. Test blocked model downloads, poor lighting, empty scenes, cropped shoulders,
   and low hand coverage. None should yield a misleading perfect comparison.

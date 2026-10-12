# Practice Mode: technical evaluation, version 1

Practice Mode adds local imitation and comparison to the existing Motion Lab. It does **not** establish whether a learner's Korean Sign Language is correct, whether two motions mean the same sign, or whether the reconstruction faithfully represents a real signer. There is no overall score, pass/fail threshold, curriculum or certified assessment.

## Workflow and data

Load a schema-1 MotionClip JSON, inspect the reference avatar, and optionally attach the original video with matching filename and size. This matching is a convenience, not cryptographic provenance. The JSON contains no video. Enable the camera explicitly, check framing, start the three-second countdown, sign, then stop. Recordings stop automatically after 20 seconds. The camera releases immediately on stop, cancel, camera failure, tab hiding, page exit and mode exit. Late-arriving permission streams are stopped too. Retries create a new detector, reconstruction state and recorder.

Webcam frames go through the **existing `LandmarkDetector` / MediaPipe Pose + Hand Tasks and `Reconstructor`**, one frame at a time, targeting 15 Hz at up to 640 pixels on the longest edge. No second tracking model or paid backend is introduced. Sampling slows if CPU inference is slow; actual capture timestamps are retained. MediaRecorder records video concurrently. This avoids trying to seek an unfinished WebM with infinite duration metadata. Recorded playback uses the aligned frame times and known capture duration. The recording has no audio.

Reference and learner clips retain the existing `signlingo.motion` version 1 interchange format and reconstruction pipeline version. A separate in-memory `signlingo.practice` version 1 session holds the attempt number, clips, selected intervals, alignment, component evidence and `linguisticValidation: not-performed`. Nothing is automatically persisted or uploaded. Blob URLs are revoked on replacement/unmount. Model and WASM assets are downloaded from the existing public hosts. No microphone, server inference, API key or GPU server is required.

Imported learner MotionClips support repeatable offline inspection. They must already contain canonical anatomical assignments, as produced by Motion Lab. Avatars show the stored reconstruction, including any manual edits; comparison uses the **original raw observations**, excluding held poses and ignoring manual corrections. Fixed rig lengths can conceal positional differences, so the view also includes body-relative measured wrist paths and explicit residuals.

## Coordinates, anatomy and evidence

- The existing pose-wrist association defines anatomical left and right. Comparison never searches for a cheaper left/right swap. Crossing ambiguities withheld by the existing reconstructor remain unavailable.
- Selfie preview mirroring is CSS only. Both detectors receive the original camera pixels. For a virtual camera that already supplies mirrored pixels, the separate input option reverses the canvas **before both detectors**. `source.mirrored` records that operation; stored coordinates are canonical and must not be flipped again at comparison time.
- The body frame uses the shoulder midpoint, the anatomical shoulder axis and the shoulder-to-hip-midpoint up direction. Wrist and nose positions are expressed in that frame. Horizontal/depth displacement is divided by shoulder width, vertical displacement by torso height. Translation, a shared camera rotation, global size, and different shoulder/torso proportions are thereby factored out under the estimated 3D model.
- Each hand's 15 measured phalanx directions are normalized to unit length and expressed in its palm frame. Individual finger lengths are not compared. Full palm orientation is expressed relative to the torso.
- Evidence requires body image/world visibility or presence ≥0.6 at both shoulders, both hips and the respective wrist, a tracked (not held/missing) hand, hand score and reconstruction quality ≥0.6, finite 21-point hand geometry, palm conditioning ≥0.3 and segment lengths 3–100 mm. Face-relative measurements additionally require a visible nose. Missing coordinates are **not** replaced by zeros or synthesized poses.
- MediaPipe hand handedness confidence is **not** landmark accuracy. Per-finger confidence is unavailable. Monocular depth, occlusion and hand/body coordinate agreement remain uncertain even when these engineering gates pass. Torso/hip occlusion may suppress comparison; frame the upper body down to the hips.

No claim of invariance to arbitrary perspective, severe foreshortening, arbitrary arm proportions, disabilities or all valid signing styles is supported. Body normalization and angle-based features remove specific geometric nuisances; remaining residuals are observations, not penalties for anatomy.

## Active interval selection

Activity is detected from consecutive reliable samples separated by at most 300 ms. Either hand can activate the interval: normalized wrist speed >0.16 body units/s, mean articulation change >22°/s, or palm change >35°/s. At least two active transitions are needed; the first and last receive 250 ms padding. Static holds and insufficient evidence fall back to the whole captured interval and invite manual selection.

These are movement heuristics, **not linguistic sign boundaries**. Holds can be meaningful. Check both intervals and retain the complete sign; use the independent start/end controls to remove surrounding idle periods. A synthetic four-second example with activity in the middle verifies that long idle portions are excluded. The user's real four-second KSL clip was not available for this evaluation.

## Alignment and component metrics

Selected frames are uniformly subsampled to at most 180 per clip without interpolating across missing tracking. Intervals must contain at least three samples. Dynamic Time Warping uses a monotonic path through both selected endpoints, a ±45% normalized index-progress band, and a 0.025 repeat-step cost. It matches geometry rather than equal timestamps. The cost per valid hand is:

`(3 × handshape_degrees/90 + 2 × palm_degrees/180 + min(2, position_residual)) / 6`

Contributions from both hands share **one** temporal alignment, preserving bilateral sequence relationships. A missing hand contributes cost 0.75 with weight 1, not a perfect match. These weights emphasize hand features for engineering reasons; they are **not clinically or linguistically calibrated**. They affect alignment only; no aggregate score is presented. Larger speed ratios can align because progress is normalized, but the band and endpoint constraints limit arbitrary warping. Short/incomplete gestures can still align to some degree: inspect endpoint discrepancies and component residuals; this is not an automatic completeness classifier.

| Component | Displayed measurement |
|---|---|
| Finger articulation, each hand | Mean angular difference of all 15 unit phalanx directions in their palm frames (degrees); includes flexion and spread |
| Palm orientation, each hand | Quaternion geodesic angle in torso coordinates (degrees) |
| Hand / torso position | Euclidean residual in the normalized body coordinate system |
| Hand / face position | Residual of the normalized wrist-minus-nose vector; not facial grammar |
| Movement path | Residual of displacement from each selected interval's first wrist position; unavailable if that anchor is missing |
| Movement direction | Angular residual of consecutive observed wrist displacements larger than 0.015 body units, with no >300 ms gap; stationary samples have no direction |
| Two-hand coordination | Residual of the simultaneous left-minus-right wrist vector after shared alignment; does not independently shift each hand to conceal a lag |
| Timing / sequence | Learner/reference selected sample-duration ratio and largest difference in normalized timestamp progress along the path; descriptive, with no speed penalty |

Residuals are means across valid alignment pairs. Repeated matches contribute to the mean, but cannot inflate evidence coverage: coverage is the **minimum fraction of distinct selected frames** participating in valid pairs on either side. At least three distinct samples per clip and coverage ≥65% are required to display a numeric metric. Sampling/downsampling is not a continuous-time integral; long irregular gaps can bias residual means. Static or tiny motions can leave direction unavailable even when hand tracking is good.

The alignment plot labels the selected intervals and shows the actual time mapping. A common slider and playback step through the matched avatars and locally attached videos. Solid/dashed wrist traces show both paths; gaps are left unconnected. Clicking a feedback item seeks to the supporting matched frame and highlights the anatomical hand.

## Feedback and its limits

Localized English/Korean feedback separates **observed movement differences**, **missing/uncertain tracking**, and **potential meaning changes requiring KSL review**. No automatic meaning label is assigned.

Specific difference messages require sufficient overall hand evidence and three distinct successive matched samples in **both** clips, with no inter-sample gap over 300 ms. An isolated outlier or repeated matching to a single learner frame cannot support a message. Display heuristics are:

- Learner hand lower: vertical difference >0.16 torso-height units.
- Palm direction differs: angle >25°.
- Index more extended: sum of the two inter-phalangeal bend angles at least 25° smaller.
- Movement path differs: relative displacement residual >0.2 body units.

Messages identify the anatomical hand and both time positions. They deliberately describe observations rather than prescribe a supposedly correct sign. Tracking gaps receive their own messages (below 90% coverage or insufficient sample support). Lack of an observed-difference message does not establish equivalence. Significant handshape/location/timing differences **may** carry meaning, but their interpretation requires a qualified KSL reviewer and the full linguistic context.

## Automated validation performed

Commands run on this branch:

```sh
npm run typecheck
npm test
npm run build
CHROMIUM_PATH=/path/to/chrome-headless-shell \
  PRACTICE_VISION_TEST=1 \
  VISION_TEST_VIDEO=/path/to/public-photo-smoke.mp4 \
  VISION_EXPECT_HANDS=1 npm run test:browser
```

- Numerical/data/lifecycle tests: **71 passed** (42 existing, 29 practice additions). Analytic fixtures cover identical sequences, resampled faster/slower demonstrations, nonlinear slower starts, shoulder/torso and individual finger proportion changes, camera translation/rotation, canonical mirrored-source metadata, anatomical swaps, held/missing hands, incomplete/reversed sequences, handshape and palm changes, bilateral phase changes, four-second middle activity, manual selection, static holds, short invalid intervals, confidence gaps and isolated outliers.
- Capture tests exercise denial/missing/busy cameras, late permission resolution after cancellation, video-play/model/recorder setup failures, inference failure, recorder error, disconnect, cancellation, stop timeout, too-short and empty recordings, auto-stop, retry resource isolation and successful MotionClip import round-trip. Input unmirroring is passed explicitly to capture; preview mirroring does not affect it.
- Browser tests: **10 passed** with Chromium 156 (the CI Playwright browser): 4 existing Motion Lab tests, 3 routine Practice UI tests, 1 real practice-inference smoke test, and 2 existing real video-inference/cancellation tests. Practice checks cover reference replay, JSON comparison, interval editing, localized feedback selection, 390-pixel mobile layout, permission-denial messaging, countdown, actual input-pixel unmirroring independent of CSS preview reflection, local MediaRecorder capture, cleanup, retry and exit during countdown. The lifecycle UI test uses explicitly synthetic worker detections and a canvas stream; it is **not** model-accuracy evidence.
- The additional practice smoke test uses a canvas stream of the **public still-photo fixture** already used in Phase 2, the unmodified MediaPipe model/WASM bytes and actual inference. It successfully records, reconstructs and reaches the comparison view, then stops all camera tracks. A static photo proves plumbing, not moving-hand capture accuracy or KSL assessment validity. No real webcam hardware is available in this environment.

Routine CI discovers all new unit and browser tests automatically; external-asset smoke tests remain opt-in. No CI or GitHub Pages workflow was changed. For the opt-in practice test, place the upstream `male_full_height_hands.jpg`, `pose_landmarker_full.task` and `hand_landmarker.task` in ignored `work/`; the original photo URL is `https://storage.googleapis.com/mediapipe-assets/male_full_height_hands.jpg` (see `docs/PHASE1_REPORT.md` for provenance). WASM is read from the pinned npm package. Personal recordings and test artifacts remain uncommitted.

## Safari/mobile investigation and outstanding validation

Before implementation, inspected pending [Safari PR #2](https://github.com/KINGJNU-sakayume/SignLingo/pull/2), head `458cb4c8ca9c10f12fa1e9762fe476a6cbda63db`. It adds iOS/iPadOS main-thread routing and targeted worker-initialization fallback without changing `LandmarkDetector`. This feature reuses that interface and **does not modify the MediaPipe runtime**, so the pending fix can be integrated independently. Until that fix lands, iOS worker inference may fail. This feature does not claim to have fixed Safari. Main-thread inference also needs hardware testing for responsiveness during recording.

The responsive interface was checked at 390×844 in Chromium. Recording selects a supported WebM/MP4 MIME rather than requiring WebM. HTTPS/localhost, camera APIs, MediaRecorder, ImageBitmap and WebGL2 are needed. Physical iOS Safari, Android cameras, camera orientation changes, thermal throttling, long-session memory behavior and real permission prompts remain unverified.

Next validity work requires consented full-motion reference/learner recordings, diverse bodies and camera setups, expert KSL annotation, explicit nonmanual review, held-out evaluation, and analysis of false feedback from tracking errors. No such corpus, calibrated weights, certified judgment or linguistic success rate is claimed here.

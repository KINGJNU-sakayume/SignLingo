# Practice Mode: technical evaluation

Practice provides local motion comparison, **not KSL correctness, meaning equivalence or certified assessment**. There is no overall score or calibrated linguistic threshold. The current upper-body/capture behavior and benchmark evidence are detailed in [UPPER_BODY_CAPTURE.md](docs/UPPER_BODY_CAPTURE.md). [MOBILE_PRACTICE.md](docs/MOBILE_PRACTICE.md) retains the historical mobile PR #4 investigation.

## Workflow, privacy and data

Load an existing schema-1 MotionClip and optionally attach the matching original video (filename/size matching is a convenience, not cryptographic provenance). Enable the camera, optionally inspect one framing snapshot, start the countdown and record for up to 20 seconds. Keep head, shoulders, arms and hands visible; hips are optional.

Camera recording requests an **ideal** 30 FPS without MediaPipe inference. After stop, camera tracks release and the original blob is retained before asynchronous analysis. The native-phone file input uses the same `processPracticeVideo` → `processVideo` → existing detector/reconstructor path. Analysis supports 30 Hz (default) or 15 Hz, and 960/640-pixel maximum dimensions. A slow processing rate does not represent recording FPS. Model failures, canceled analysis and insufficient tracking do not erase a completed recording; it can be reanalyzed or explicitly downloaded. Leaving Practice/reloading clears browser-memory data.

No audio, automatic uploads, persistence, paid API or inference server is introduced. Model/WASM asset requests still reach the existing public hosts. Blob URLs and camera/detector resources are released. The unchanged iOS adapter uses Canvas/main-thread inference; supported desktop/Android paths retain workers. No GPU/model/runtime change is made in this follow-up.

The existing `signlingo.motion` version 1 schema remains readable. Optional `source.timeOffset` records the first decoded presentation timestamp when extracted evidence begins after the video's origin. Frames still start at timestamp zero; both players map back to media time. Files without an offset behave as before. A separate in-memory `signlingo.practice` session contains clips, intervals, alignment and comparison evidence with `linguisticValidation: not-performed`.

Avatars show stored frame reconstruction, including manual wrist edits, through the display-only pipeline in [DISPLAY_PIPELINE.md](docs/DISPLAY_PIPELINE.md): both avatars steady the torso (wrists, palms and fingers keep their reconstructed positions), the reference also fills missing handshapes in translucent orange, and the learner's own attempt keeps its tracking gaps visible. The optional mirror view only reflects the rendering. Metrics use original raw observations and ignore edits and all display processing; held or filled avatar handshapes are never evidence and anatomical left/right is never swapped. Fixed rig lengths can conceal position differences, so measured wrist paths and residuals are displayed too.

## Coordinates and component evidence

Anatomical sides retain the existing pose-wrist association; ambiguous crossings are not reassigned from hand labels. Only when body detection is absent can a unique ≥0.9 hand label support shape, with an explicit identity limitation. Preview reflection is CSS-only; actual pixel unmirroring happens before both detectors during analysis. Canonical MotionClip coordinates are not reflected again.

The common upper-body frame uses shoulder midpoint and shoulder span for all axes. It does not read hips. Shoulder geometry and projected image up provide roll/yaw; a bounded **constant** pitch calibration can use stable head geometry. Moving head landmarks are not used as a per-frame torso axis. Small frame jitter is stabilized, with larger motion adopted immediately. See the current report for exact calibration/filter rules and their perspective/head-posture limitations.

Independent image-plane measurements use aspect-corrected pixels and shoulder normalization. Missing depth remains missing; no zero-z pseudo-3D coordinates are fabricated. When only 2D has enough evidence, the card explicitly says **2D image plane · no depth**. Otherwise a separate 2D residual accompanies the estimated-3D value. World depth and palm orientation remain monocular estimates even when confidence gates pass.

| Component | Evidence and residual |
|---|---|
| Handshape | Reliable identity, hand score ≥0.6, finite 21-point geometry, palm conditioning ≥0.6, all 15 segments 3–100 mm. Mean angular residual of unit phalanx directions in the palm frame; independent of hips/shoulders and finger lengths |
| Palm orientation | Reliable measured palm and world/image shoulders. Quaternion geodesic angle in the common upper-body frame; independent of a degenerate finger |
| Hand / shoulder position | Reliable shoulders and wrist. Euclidean residual in shoulder-width units, independently in estimated 3D and measured 2D |
| Hand / face position | Position requirements plus reliable nose. Wrist-minus-nose residual; not facial grammar |
| Trajectory | Reliable selected-interval starting wrist and subsequent positions; displacement-from-start residual |
| Direction | Displacement over an observed 100–300 ms window, >0.015 shoulder widths, without missing samples or adjacent gaps >300 ms; angular residual |
| Coordination | Simultaneous left-minus-right wrist-vector residual; both hands share one temporal path |
| Timing / sequence | Selected duration ratio and largest normalized timestamp-progress warp; descriptive, no speed penalty |

Image/world reference confidence remains ≥0.6 and image points must lie in the image. Thresholds were not globally lowered. Each component has its own availability/reason, and a valid pose wrist can support location while handshape is unavailable. Current-frame availability, whole-attempt handshape coverage and paired metric coverage are separate. MediaPipe handedness score is not per-finger accuracy. No invariance to arbitrary perspective, body proportions, disability or signing style is claimed.

## Segmentation, decoded timestamps and alignment

**Default interval (v4, 2026-10-16):** the signing interval (`practiceInterval` → `signingInterval`): the span in which a hand is raised more than 10 cm above its rest position, the same basis the constraint solver uses for `phase`/`fraction` spans. The motion heuristic below took the whole clip for ksl-thanks and ksl-sorry, so their handshape, palm and trajectory were unmeasurable even when a reference was compared with itself (7 of 13 metrics). It remains the fallback when no hand is ever raised (method `activity`). Manual trim is unchanged.

Fallback heuristic: active intervals use adjacent reliable observations ≤300 ms apart: either wrist speed >0.16 body units/s, mean articulation change >22°/s, or palm change >35°/s. At least two transitions are needed and 250 ms padding is added. Static/uncertain sequences fall back to full-interval selection. These are movement heuristics, not sign boundaries; manual trim must retain meaningful holds and the complete sign.

Practice samples saved video by decoded presentation timestamps from `requestVideoFrameCallback`. Duplicate presentation times and unconfirmed callbacks do not become new evidence. Variable intervals remain in the clip. Without callbacks, timestamps are explicitly unverified seek targets and exact duplicate pixel snapshots are withheld; this fallback may remove legitimate static holds and is not equivalent timing evidence. No intermediate handshapes are synthesized.

At most 180 existing observations are selected near uniform **time** bins. DTW uses a monotonic path through both endpoints, a ±45% normalized elapsed-time band and a 0.025 repeated-step cost. Geometry determines correspondence, not equal timestamps. With all terms present, the hand cost is:

`(3 × handshape_degrees/90 + 2 × palm_degrees/180 + min(2, position_residual)) / 6`

Unavailable terms/weights are omitted; usable image position may substitute for unavailable world position with its space clearly distinguished in the result. A missing hand contributes cost 0.75 with weight 1. These are **engineering alignment weights**, not clinical or linguistic calibration, and no aggregate score is shown.

Residual means weight observed time support and divide repeated matches by per-frame repeat count. Coverage is the minimum of distinct-frame and supported-time coverage in either clip. Half-neighbor support is capped at 150 ms each side: a long gap cannot count as a reliable held pose. At least three distinct samples and 65% coverage per clip remain required. Global speed changes incur no duration penalty. Endpoint/residual inspection can expose incomplete gestures, but DTW is not an automatic completeness or meaning classifier.

**Compared hands:** only the hands taking part in the reference sign (raised in at least 15% of its signing interval). A one-handed sign (ksl-sorry) no longer reports the resting left hand; if the learner raises the unused hand for at least 30% of their signing interval, one `unused` notice says so. Coordination is measured only when both hands take part.

**Opposite hand:** the learner is also aligned left-right mirrored (pose landmark pairs and hand labels swapped, image x → 1 − x). When the mirrored alignment costs less than 80% of the direct one, by more than 0.04, and the direct cost is at least 0.25, a single `mirror` notice replaces the scattered differences it would cause. A mirror-symmetric two-handed sign (ksl-meet) looks the same mirrored and is not flagged. Whether KSL accepts a left-handed form of a sign is not assessed.

**Reviewed forms (constraint rubric):** for a corrected reference, each reviewed `handshape`/`palmFacing` constraint is measured on the learner's **tracked** frames that the alignment pairs with the constraint's core frames. The limit is relative: the 90th percentile of the reference signer's own observed (pre-correction) residuals plus 10° (handshape) or 15° (palm). A constraint is met when 60% of at least three measured frames are within the limit; unmet constraints give one `shape`/`facing` notice quoting the constraint note. Position constraints are excluded (fixed avatar arm lengths, monocular depth).

**Tracking notice:** a hand's `missing` notice appears exactly when its handshape metric fails the 65% evidence gate (it used to appear below 90%).

**Publish gate:** `npm run content -- validate` (and so `npm run build`) rejects a published reference that, compared with itself, has an unmeasurable metric for a participating hand (direction excepted) or any feedback.

**Hand size:** after recording, the median longest side of the detected hands' image boxes inside the signing interval is compared with 10% of the frame height (course-1 references: 13–19%); below it, the learner is asked to come closer and record again.

## Explainable feedback

English/Korean feedback distinguishes observed differences, missing tracking and potential sign-meaning changes requiring qualified KSL review. Specific claims require their **own component** to have enough evidence and three distinct successive matched samples in both clips, with no >300 ms supporting gap. Display heuristics are a lower hand by >0.16 shoulder widths, palm angle >25°, index inter-phalangeal bend sum smaller by >25°, or path residual >0.2 shoulder widths. Current spatial text claims use estimated 3D evidence; image-only residuals are labeled visually without pretending to establish depth.

Clicking feedback seeks the matched times and highlights the anatomical hand. The temporal plot displays selected intervals and the actual mapping; avatars, attached videos and measured wrist paths follow the alignment. No message and low residuals do not prove correct KSL. Facial grammar, meaning and linguistic validity are unassessed.

## Automated checks and measured evidence

Current checks: `npm run typecheck`, `npm test` (**114 passed**), `npm run build`. Browser validation: **25 passed** with Chromium 156, including four opt-in external-asset tests; routine CI runs 21 and skips those four. CI/Pages workflows are unchanged.

```sh
npm run typecheck
npm test
npm run build
CHROMIUM_PATH=/path/to/chrome-headless-shell \
  PRACTICE_VISION_TEST=1 PRACTICE_BENCHMARK=1 \
  VISION_TEST_VIDEO=/path/to/public-photo-smoke.mp4 \
  VISION_EXPECT_HANDS=1 npm run test:browser
```

Tests cover identical/resampled/reversed/incomplete motion, finger/palm errors, anatomical swaps and mirrored pixels, missing/ambiguous tracking, independent components, hip-visible versus cropped clips, head/shoulders, upward/rolled camera, moving head and near-face hands, different shoulder/finger scale, time-aware DTW, irregular/long gaps, and schema compatibility. Existing detector tests retain iOS routing, worker fallback and cleanup. Mock capture tests verify failures, late permission resolution, cancellation, disconnect/mute, frozen delivery, orientation changes, finalization timeout and retries.

Real browser encoding/decoding tests show a saved synthetic stream retaining **30.0 Hz media-time evidence while mocked inference runs at 6.6 FPS**. A 15 FPS encoded fixture requested at 30 Hz yields exactly 15 observations; a VFR fixture yields 48 original observations and skips 12 duplicate requests. Actual unchanged MediaPipe runs on the public static-photo fixture at both sampling rates/resolution caps. See [the full measured report](docs/UPPER_BODY_CAPTURE.md) for exact numbers, frame-PTS inspection, source dimensions and limitations.

**Mock cameras, synthetic estimates, emulated user agents and still photos do not establish physical-device performance or KSL validity.** The user reports working inference around 6.6 FPS on iPhone 15 Pro / iOS 27.0.1 / Safari after the preceding mobile fix. Encoded FPS and post-change real-device performance remain unmeasured. Physical Android/Safari behavior, permissions/codecs, thermal/memory behavior, diverse moving-sign recordings and expert linguistic review remain necessary. No personal recording or model binary is committed, and no fixed 30 FPS recording rate is promised.

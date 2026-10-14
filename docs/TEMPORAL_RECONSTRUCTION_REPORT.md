# Phase 6 — Evidence-aware temporal hand reconstruction

Date: 2026-10-14. Based on `main` at `94da9cb` (including the new learning screens).

## Scope and evidence contract

The existing 0.2.0 reconstruction engine remains pass 1. Pass 2 produces a separate,
disposable `TemporalMotion`, without changing the input MotionClip's detections,
coordinates, timestamps, scores, assignments, quality, poses, or manual edits.
MotionClip schema 1 stays compatible. A new optional frame `discontinuity: "cut"`
hint survives import/export; older clips need no migration. A duplicate left/right
assignment of the same detection is now rejected at import.

The Motion Lab offers **원본 복원 / 시간 복원** on one video clock and seek position.
The enhanced display uses explicit observed/interpolated/held/unavailable evidence,
with separate position, orientation, and finger availability. Interpolated palms
are purple. Unavailable fingers are hidden and explicitly labeled **손가락 사용 불가**.
Manual wrist edits apply after either reconstruction. Export still contains the
original MotionClip and edits, never inferred tracking observations. Temporal
results are recomputed locally when a clip is opened; they are not lesson assets.

Practice features, tracking coverage, component metrics, DTW, active boundaries,
and published reference content still consume original observations. Tests compare
all metrics, alignment pairs, features and boundaries before/after reconstruction.
No inferred pose is promoted to learner or reference scoring evidence. Publication
rights, reconstruction review and linguistic review checks remain unchanged.

The supplied video and MotionClip were evaluated privately. No benchmark media,
landmarks, reconstructed clip, or lesson was committed or published.

## Algorithms and conservative decisions

* **Identity:** enumerate one-to-one assignments for at most two detections in each
  direction through a sequence. Costs combine anatomical image wrists, detector
  wrist locations, a timestamp-aware bounded velocity predictor, an acceleration
  allowance, and weak handedness-label support. Predictions expire after 150 ms.
  Contradictory anatomy vetoes continuity; strong, close anatomical anchors can
  override a stale predictor during a sharp measured movement. Agreement between
  forward and reverse passes is required. Close alternatives or conflicting
  directions remain ambiguous and cannot anchor a bridge. This is a small linear
  two-pass optimization, not an unconstrained global smoother or semantic model.
* **Segments:** reset at nonfinite/nonincreasing timestamps, sample gaps over
  150 ms, explicit cuts, and large jointly observed shoulder displacement. New
  extraction also checks a 16×9 RGB thumbnail for a large appearance cut. Landmark
  and thumbnail heuristics cannot identify every edit, especially in old JSON.
* **Gap duration:** at most 150 ms **between surrounding observed anchors**. At
  30 Hz this permits up to three missing frames (133.3 ms anchor span), but rejects
  five missing frames (200 ms span). Endpoints require quality ≥0.6 and visible
  in-image wrists. No leading/trailing extrapolation or missing-torso bridge.
* **Position:** retain measured arm/wrist positions. If the wrist is also missing,
  interpolate the target and elbow pole at the actual timestamp, then solve the
  existing fixed 0.28/0.26 m arm IK. Reject unstable poles or >20 mm reach correction.
  Unsupported translation above 3 m/s is rejected; above 1.5 m/s the gap must be
  ≤80 ms. Those speed guards apply to inferred positions, so they do not erase a
  directly measured rapid trajectory.
* **Orientation:** shortest-path quaternion SLERP of world palms, converted through
  the current forearm. Allocate forearm roll with the same function as pass 1,
  avoiding a wrist-local twist discontinuity. Reject >75° endpoint palm change,
  >80° upper-arm direction change, or >115° inferred wrist swing.
* **Fingers:** quaternion interpolation of local joints only when every endpoint
  joint change is ≤45°. Check inferred flexion/spread against the existing broad
  anatomical ranges. A recoverable palm can remain visible while incompatible or
  anatomically unsupported fingers remain unavailable. An unusual **observed**
  pose is preserved, not clamped into a guessed sign.
* **Hold:** the original comparison preserves its 200 ms hold. Enhanced mode allows
  at most 80 ms from an observed anchor with a measured, visible arm; it never
  holds through a rejected bridge, ambiguous crossing or cut. Holds carry no new
  measured confidence.
* **Runtime:** one shared generator powers synchronous evaluation and asynchronous
  browser reconstruction. Browser execution yields every 16 work items, checks
  cancellation, and reports progress. It runs after extraction, never during camera
  recording, and adds no model, backend, cloud inference, or paid API dependency.
  The experimental `optimizePoleWindow` smoother remains disabled.

## Repeatable evaluation

```sh
npm run evaluate:temporal -- --motion /path/to/private/benchmark.motion.json --consent --thresholds --output work/evaluation/real-temporal.json
npm run evaluate:temporal -- --synthetic --output work/evaluation/synthetic-temporal.json
```

Input MotionClip SHA-256: `12f18ff75db8b8eea9229663e60e8bfce26f73ac8f72fac065f3f4dca8d8d2b7`.
The uploaded video was independently checked with ffprobe: 1920×1080, 30/1 fps,
63 encoded frames, 2.099 s. The stored clip contains 63 observations at 0–2066.7 ms.
We reuse those exact detector observations; this evaluation does not rerun MediaPipe
or claim that its world coordinates are calibrated ground truth.

The controlled evaluator hides each eligible 1/2/3/5-frame window, separately for
each hand. All frames and both anchors must have an observed hand with quality
≥0.6. It removes the detection **before rebuilding pass 1**, so old pose rotations,
assignments, and holds cannot leak withheld evidence into pass 2. A second experiment
also hides the corresponding pose wrist. Every trial uses original timestamps.
Overlapping windows contribute repeated **trial-frame samples**, not independent
subjects. Complete and partial recovery have separate denominators.

Errors compare against the withheld detector-driven reconstruction: wrist position
in fixed-avatar millimeters, wrist-local and world-palm geodesic angles, and mean
world finger-segment direction error. These are engineering proxies, not KSL
correctness or physical capture accuracy. Missing baseline hands have null errors,
never an error computed from their invisible neutral placeholder.

## Controlled occlusion: supplied real observations

Hand detections hidden; measured pose wrists retained. Error columns use the same
completely reconstructed samples for before/after comparison. Palm-only recovery
is excluded from these complete-hand error means.

| Hidden frames | Trials / masked samples | Full hands / palm samples | Palm error ° before → after | Finger direction error ° before → after | Wrist-local error ° before → after |
|---:|---:|---:|---:|---:|---:|
| 1 | 45 / 45 | 22 / 45 | 8.17 → 6.08 | 8.71 → 6.09 | 90.58 → 3.74 |
| 2 | 38 / 76 | 36 / 76 | 9.12 → 6.42 | 10.31 → 8.25 | 95.49 → 4.60 |
| 3 | 33 / 99 | 51 / 99 | 10.23 → 7.05 | 12.87 → 9.71 | 98.45 → 4.66 |
| 5 | 23 / 115 | 0 / 0 | — | — | — |

Wrist-position error is approximately zero in this experiment because its body
observation remains available; this is **not** an improvement in 3D position accuracy.
The large baseline wrist-local error reflects a different allocation of forearm
roll during its hold. World-palm error is the more interpretable orientation metric;
the new pass preserves the roll allocation used by observed frames.

When both the hand and its pose wrist are hidden:

| Hidden frames | Reconstructed wrists / attempts | Mean wrist error mm | Complete hands |
|---:|---:|---:|---:|
| 1 | 45 / 45 | 16.19 | 22 |
| 2 | 72 / 76 | 18.48 | 35 |
| 3 | 99 / 99 | 25.96 | 51 |
| 5 | 0 / 115 | — | 0 |

Pass 1 has no visible hand/arm in the masked frames of that experiment, so its
corresponding pose-error and continuity metrics are unavailable. The position error
above includes all reconstructed wrists, including partial hands; full-hand counts
are smaller where fingers are deliberately unavailable.

### Continuity and lag

Continuity windows include two observed steps outside each end of the bridge, so
entry/exit acceleration changes are included. Values below are means of per-window
maxima on completely available windows, not whole-video smoothness scores.

| Hidden frames | Windows | Max palm step ° before → after | Max angular velocity jump °/s before → after |
|---:|---:|---:|---:|
| 1 | 16 | 17.34 → 14.57 | 429.34 → 312.83 |
| 2 | 12 | 18.50 → 13.52 | 502.90 → 291.41 |
| 3 | 12 | 16.42 → 10.33 | 466.56 → 209.63 |

Measured wrist trajectories are intentionally unchanged: for 1/2/3-frame gaps,
mean maximum wrist velocity jumps remain 1.44/1.59/1.64 m/s and acceleration jumps
55.94/65.61/74.11 m/s² in this detector-derived avatar space. Better palm continuity
does not establish linguistic accuracy.

A bounded ±3-frame local pose-matching proxy gives baseline→enhanced lag of
33.33→−3.03 ms, 50.93→−0.93 ms, and 64.05→0.00 ms for the complete 1/2/3-frame samples.
Small negative values mean the estimate resembles a later observation; these
short, noisy windows do not establish a precise phase-lag guarantee. Timestamp
shift is exactly **0 ms** in all modes. Actual phase error on genuinely unobserved
frames and camera-to-screen capture latency are **not measured**.

Assigned remaining observations agreed with supplied baseline identities in all
211/216/220/201 evaluated cases for 1/2/3/5-frame masking respectively (per experiment).
This is baseline agreement, not independent identity ground truth. Separate synthetic
crossing, ambiguity, reordered-detection and missing-wrist tests have known identities.

### Threshold comparison

At 100 and 125 ms, the 1/2-frame results above are identical and all 3/5-frame gaps
are rejected. At 150 ms, 51 of 99 three-frame samples have complete hands and all
99 have palm reconstruction. Five-frame gaps are still rejected. We retain 150 ms
with the separate fast-unsupported-position guard. This is a conservative initial
choice from one clip, not a tuned or validated threshold for KSL generally.

## Synthetic analytic trajectory

The synthetic fixture is a fixed-length articulated hand with known smooth palm
rotation, finger flexion and a mild wrist trajectory. It is **not a signing sample**.

| Hidden frames | Complete / attempted | Palm error ° before → after | Finger direction error ° before → after |
|---:|---:|---:|---:|
| 1 | 122 / 122 | 0.55 → <0.00001 | 0.42 → 0.000059 |
| 2 | 240 / 240 | 0.83 → <0.00001 | 0.64 → 0.000119 |
| 3 | 354 / 354 | 1.11 → <0.00001 | 0.85 → 0.000198 |
| 5 | 0 / 570 | — | — |

For hand-and-wrist masking, mean wrist errors are 0.032/0.066/0.111 mm for 1/2/3
frames. These tiny errors are specific to this deliberately simple analytic curve
and should not be extrapolated to real footage. Synthetic complete-hand phase lag
is 0 ms versus the baseline hold's 33.33/50.00/66.67 ms. Sharp observed turns remain
bit-for-bit anchors in separate tests; no global smoothing is enabled.

## Real-video inspection and evidence coverage

Frames 0, 8, 18, 26–29, 45, 50 and 62 were inspected from the supplied video. The
central dropout has overlapping hands and visible motion blur. At the beginning
and end the hands are partly/entirely below the image. These are qualitative visual
observations, not finger-angle annotations or linguistic review.

| Evidence category (63 frames per side) | Left | Right |
|---|---:|---:|
| Original tracked | 31 | 33 |
| Original held | 8 | 8 |
| Original missing | 24 | 22 |
| Enhanced observed | 31 | 30 |
| Enhanced interpolated, complete hand | 0 | 2 |
| Enhanced interpolated, palm only | 3 | 0 |
| Enhanced held | 1 | 2 |
| Enhanced unavailable | 28 | 29 |

The right hand has four ambiguous identity frames; three formerly tracked,
low-quality frames are no longer displayed as reliable observed hands. No accepted
assignment contradicts an existing baseline assignment. Raw tracked coverage
remains **31/63 and 33/63** for scoring; reconstructed coverage is never added.

Successful full bridges:

* Right 600 ms, bounded by observations at 566.7 and 633.3 ms.
* Right 900 ms, bounded by observations at 866.7 and 933.3 ms.

Partial recovery / intentional abstention:

* Left 900 and 933.3 ms: palm interpolated between 866.7 and 966.7 ms; fingers
  unavailable because an endpoint joint change exceeds the 45° shape guard.
* Left 1466.7 ms: palm only; incompatible finger endpoints at 1433.3/1500 ms.
* Left 633.3/666.7 ms: the preceding observation has quality below 0.6; no bridge.
* Right 400–466.7 ms: weak endpoint evidence; no invented handshape.
* Beginning without a prior hand anchor and the final out-of-frame region remain
  unreconstructed; enhanced holds last only where a visible measured arm supports
  the 80 ms hold. No temporal hand is extrapolated from a one-sided endpoint.

No geometric accuracy claim is made for these naturally missing observations.
The visible improvement is supported continuity with explicit uncertainty, not
proof that either inferred hand performed the correct Korean sign.

## Performance and compatibility

Measured locally on Linux x86_64, Node v24.19.0; 20 warm repetitions, 63 frames.
Timings exclude detector inference, decoding and rendering.

| Measurement | Time |
|---|---:|
| Original pass 1, median / p95 | 5.87 / 8.21 ms |
| Additional temporal pass, median / p95 | 8.49 / 11.55 ms |
| Temporal cold call | 35.36 ms |
| Cooperative asynchronous temporal call | 41.13 ms |

The asynchronous wall time includes cooperative yields, not just computation. The
serialized derived visualization is about 203 KiB versus about 985 KiB of original
MotionClip JSON; this is a size proxy, **not** a heap or peak-memory measurement.
Work and storage scale linearly with sequence length. No phone hardware or mobile
battery benchmark was performed; mobile browser layout, cancellation, camera
recording separation and slow-detector workflows are covered by automated tests.

## Validation record

* TypeScript: passed.
* Unit tests: 209 passed across 18 files, including 23 temporal/evaluation tests.
* Production build, published-content validation, and demo-content leakage check: passed.
* Browser suite on current main: 40 passed; 6 optional tests skipped (four local-model/video tests and two screenshot-review suites). Chromium on Linux, including 390 px mobile layouts.
* The existing opt-in real-MediaPipe tests were not run: this task uses the supplied frozen detector observations for its real benchmark. No extra models were downloaded.
* GitHub Actions runs the full typecheck, content validation, unit suite, new controlled synthetic occlusion benchmark, production build and Chromium browser suite for this PR. Remote result is recorded on the PR checks.

Automated coverage includes temporal identity and crossing, a missing pose wrist,
sharp supported motion, timestamp-aware short gaps, fixed bone lengths, anatomical
rejection, quaternion antipodes, invalid/long gaps, cuts, one-hand absence, preview
mirroring, provenance, schema-1 roundtrip, score/DTW/boundary invariance, partial
rendering, manual edits, cancellation and responsive playback controls. Existing
content and reconstruction tests remain enabled. No private test fixture is needed
for CI; aggregate real results are documented here.

## Remaining limitations

* Single-camera detector depth and identity remain estimates. Crossing failures can
  still be ambiguous; rejecting an assignment can reduce displayed coverage.
* One short benchmark clip does not represent different signers, cameras, skin
  tones, signing rates, or the full range of KSL articulation.
* Similar endpoints can hide a meaningful intermediate motion. Duration and shape
  gates reduce risk but cannot prove the missing sign. Interpolated components
  must never be used as verified lesson/scoring evidence.
* Per-component availability can produce a visible palm without fingers. This is
  deliberate and labeled; recovering the left-hand fingers at 900–933.3 ms remains
  unresolved by this conservative implementation.
* Position, orientation and shape have independent checks, but the method does not
  solve contact, two-hand collision, or joint occlusion from the image itself.
* Thumbnail/torso discontinuity guards can miss visually similar cuts or reject
  large lighting changes. Legacy clips do not contain thumbnail cut evidence.
* The parameter limits are broad engineering priors, not subject-specific anatomy
  or linguistically validated sign-transition constraints.
* Processing is asynchronous, but still runs on the browser main thread in small
  batches. Physical-device latency and peak memory remain to be measured.

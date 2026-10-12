# Phase 2: reconstruction fidelity and motion diagnostics

Date: 2026-10-12. Solver: **0.2.0**, motion schema: **1**. Baseline: commit `b8339e777250aeabdce88dad51606eb89d842da9`, frozen solver 0.1.0 in `src/motion/legacy/`. [Phase 1 report, retained as historical evidence](docs/PHASE1_REPORT.md).

## Result and scope

The corrected solver reproduces supported estimated finger segment directions through the **actual rendered hierarchy**, including mirrored hands, flexion plus abduction, thumb opposition and palm rotation. The same-detection public-photo experiment reduced mean segment direction residual from **6.0171° to <0.00001°** over 900 matched segments. Endpoint residual fell only from **35.61 to 34.82 mm**: fixed proportions, body/hand registration and estimated monocular depth remain substantial limitations.

This establishes improved consistency with source estimates, **not correct anatomy, motion, or KSL**. No real signing footage, calibrated ground truth or qualified KSL review was available. No KSL accuracy claim is supported. Temporal jitter is not uniformly improved: preserving estimates removes smoothing bias but can reveal more tracking noise. The existing application and deployment architecture remain in place; no paid API, backend or GPU is introduced.

## Critical review: confirmed errors and weaknesses

| Location | Confirmed finding | Consequence / implemented response |
|---|---|---|
| `reconstruct.ts`, finger loop | The emitted rotation is `Rx(flex) Rz(spread)`, but the next joint's estimated parent is reset to a minimal swing from palm +Y to the source segment. Those rotations share a segment direction but generally differ in axial roll. Renderer children inherit the emitted rotation, not the replacement. | The next local rotation is expressed in the wrong frame. Accumulate the **exact emitted parent quaternion**. A regression isolates this error with clamping disabled. |
| Finger constraints | Old PIP/DIP spread bounds ±5°, non-thumb flexion minimum 0°, MCP spread ±25°, and thumb base spread ±75° are applied in frames with the above mismatch. | Small estimation deviations or a wrong basis trigger repeated changes. Use broad inspection flags without overwriting well-conditioned directions. Genuine impossible estimates may be preserved and flagged; the flags are not proof of validity. |
| Wrist/palm | Palm-relative finger angles are calculated from the source palm, while the rendered wrist may have already been clamped to a different palm orientation. Forearm roll is carried inside the wrist and bounded as combined swing/twist. | Entire hand directions can disagree even when finger-local angles are correct. Allocate the available axial roll to the forearm and use its exact inverse to compute wrist rotation. Preserve their product as the source palm. |
| Temporal filtering | Independently smoothing local torso, upper/lower arm, wrist and finger quaternions after fitting changes their world-space products and endpoints. | Removes the guarantee that reconstructed fingers and wrists match that frame's evidence. Remove automatic joint-quaternion smoothing; expose discontinuities. Playback interpolation remains between reliable adjacent samples. |
| `math.ts`, arm singularity | The fallback `X × direction` becomes zero for an X-aligned reach if the measured and previous poles are also parallel. A hard 25 mm unstable/stable threshold can abruptly admit opposite poles. | Use an adaptive nonparallel axis and project the previous pole into the current reach plane. Blend only when transverse elbow evidence is weak; suppress unsupported reversal near extension. Well-supported movement, including reversal, is retained and flagged. |
| Palm frame | Normalizing a very small cross product accepts an ill-conditioned palm as a stable basis. | Check relative cross-product conditioning and physical separation before normalization; withhold degenerate palms. Do not force every normal into its previous hemisphere, which would erase real palm turns. |
| `tracking.ts` | Ambiguity rejection only applies when two candidate hands are assigned. One hand equally close to two crossed wrists can be assigned by the weak handedness label alone. | Compare alternative assignments for each side, including missing-hand alternatives; withhold ambiguous sides even with one detection. |
| Held hand | Holding only a wrist-local rotation while the forearm changes changes world palm orientation. | Retain the previous world palm and recompute its wrist-local rotation; preserve shape for ≤200 ms at zero confidence. Reset continuity after gaps, reversed timestamps and arm/torso loss. |
| `Avatar.tsx` / rig geometry | Renderer hierarchy itself is consistent (+Y bones, three joints per digit); fixed palm offsets and lengths differ from source landmarks. | Extract shared rig constants and independent FK. Keep endpoint errors visible, rather than calling zero angular error a correct handshape. Thumb starts at CMC (landmark 1), then MCP and IP; its base has two observed swing DOFs. No unobservable axial twist or contact is invented. |
| `video.ts` | Sampling uses browser seeking, requested timestamps, 960 px maximum dimension and independent pose/hand world estimates. | Decode/inference path is preserved and exercised in-browser. Repeated source frames, VFR timing, scale and depth ambiguity remain explicit; exact decoded PTS and calibrated camera registration are not claimed. |

Parent composition is `Qworld_child = Qworld_parent × Qlocal_child`; inversion is on the **left** when solving a local joint. The body upper/lower-arm composition in Phase 1 was already correct. The confirmed hand error was substituting a different parent frame, not reversing all quaternion multiplication orders.

The inverse direction equations are retained correctly: for local unit vector `d`, `flex = atan2(d.z,d.y)`, `spread = -atan2(d.x,hypot(d.y,d.z))`. `Rx(flex)Rz(spread)` maps +Y to `(-sin(spread), cos(spread)cos(flex), cos(spread)sin(flex))`. No independently observable finger axial twist exists in a single segment direction.

## Implemented reconstruction and confidence behavior

- Finger frames accumulate actual emitted rotations through all three bones. `inspectFrame` performs FK after reconstruction and flags residuals above 5°. Tests also construct an independent Three.js `Object3D` hierarchy, avoiding a self-validating solver-only check.
- Palm basis uses wrist→middle MCP and handedness-adjusted index/pinky spread. Nearly collinear or too-small palms and degenerate (<3 mm or >100 mm) finger segments withhold hand reconstruction. Legitimate 180° palm rotation is retained; abrupt changes are reported, not silently flipped back.
- Thumb opposition is represented by the observed CMC segment's two swing degrees of freedom plus relative MCP/IP articulation. The 75° base clamp is removed. Fixed CMC position, axial twist, coupled saddle-joint biomechanics and fingertip contacts remain approximate.
- Forearm roll allocation preserves `lower × wrist = detected palm`. It is a gauge choice from the combined orientation, **not a measured separation** of radius/ulna and wrist rotation. Unusual wrist swing above 100° is flagged without overriding source evidence.
- Fixed upper/forearm lengths remain 0.28/0.26 m. Reach permits approximately 0.1°–165° elbow flexion, avoiding a perfectly singular frame while allowing near extension and deep flexion. Every applied reach correction above 0.01 mm is recorded. There is no shoulder-elevation cone or front-of-torso constraint. Behind-torso depth is preserved with the existing warning.
- Weak elbow poles use projected temporal continuity and visibility-weighted transverse evidence. A first ambiguous frame still requires a deterministic geometric fallback, explicitly flagged as underdetermined. This cannot establish true elbow depth.
- Hand confidence remains an uncalibrated proxy: minimum arm visibility, handedness classification score and palm conditioning for 0.2. It is not per-finger confidence. Missing hands are held at zero confidence for at most 200 ms, then hidden. Invalid arms are hidden. Missing torso withholds reconstruction; video processing still fails visibly if all torso frames are unreliable.
- Existing rapid wrist-jump, depth, missing-tracking and correction warnings remain. New warnings distinguish unusual preserved articulation, sudden rotations, potential identity changes and elbow instability. No correction is recorded unless the solver actually changes a pose estimate.

## Investigation of the historical 443 corrections

The Phase 1 report recorded **443 corrections / 30 frames**, but its exact decoded video and detection export were not committed. The exact number cannot be reconstructed from the report alone. We downloaded the same public `male_full_height_hands.jpg` asset, encoded a fresh two-second 15 fps H.264/yuv420p video, ran actual MediaPipe, and sent its single detection sequence through both solvers. **This fresh baseline gives 534, not 443.** Encoding/runtime/detection differences preclude claiming an exact rerun of the historical sequence.

On these 30 frames:

- **504 finger angular clamps**: 115 flexion and **389 spread** violations. Some joints produce two records per frame (flexion and spread); a count is neither unique joints nor independent failures. Most corrections repeat the same static-hand deviation.
- **30 right-arm reach clamps** account for the rest, reflecting disagreement between normalized detected arm length and fixed rig reach.
- With all finger clamps disabled but the **old parent-frame substitution retained**, mean segment error is **1.1413°**, maximum **6.5515°**. This isolates a real mathematical inconsistency independently of anatomical limits.
- Correcting parent composition while evaluating the **same old limit thresholds** leaves **477** finger violations rather than 504. Therefore the coordinate error is a contributor, but cannot explain the majority of clamps. Restrictive spread/flexion thresholds dominate this fixture.
- The improved pipeline applies **30 reach corrections**, preserves finger evidence, and emits **59 unusual-articulation flags** plus **29 near-singular elbow-plane events**. Warnings are not optimized away. The change in elbow events follows permitting near-full extension where the old 5° floor concealed a near-singular bend plane.

Fixed palm/phalange geometry explains much of the remaining **position** mismatch; it does not explain all old angular clamps because that loop does not use rig lengths to derive angles. Detection noise is directly visible even on a static photo (nonzero wrist paths below). Without ground truth or anatomical review we cannot separate detection error from unusual or impossible source estimates, or claim the 59 unusual flags are true anatomical violations.

## Before/after measurements

All values below are **proxies**, measured against identical MediaPipe estimates. Missing/held joints are excluded from residuals and reported in coverage; paired metrics use the intersection of available joints. Source hand points are anchored to the **detected normalized body wrist**, not the corrected IK wrist, so position error is not artificially removed.

| Measure | Original 0.1.0 | Improved 0.2.0 |
|---|---:|---:|
| Body tracked frames | 30/30 | 30/30 |
| Left / right hand tracked frames | 30/30 each | 30/30 each |
| Raw detected hand sets / paired segments | 60 / 900 | Same |
| Segment direction mean | 6.0171° | <0.00001° |
| Segment direction P95 | 21.0817° | <0.00001° |
| Handshape, palm-local direction mean | 6.0161° | <0.00001° |
| Palm orientation residual mean | 0.00991° | <0.00001° |
| Finger endpoint residual mean | 35.6075 mm | 34.8175 mm |
| Wrist anchor residual mean | 8.0927 mm | 7.7774 mm |
| Applied corrections | 534 | 30 |
| Sudden rotations / potential identity events | 0 / 0 | 0 / 0 |
| Elbow-plane instability events | 0 | 29 |
| Left wrist path length (static input; tracking jitter proxy) | 0.07863 m | 0.08254 m |
| Right wrist path length (same caveat) | 0.05879 m | 0.06087 m |
| Left / right peak wrist speed | 0.33615 / 0.25681 m/s | 0.34511 / 0.26648 m/s |

The static jitter proxies slightly worsen after removing automatic smoothing. This is an explicit tradeoff, not evidence of improved natural motion. Zero segment/palm residual is expected from the corrected kinematic solve and **does not validate the source estimates**. The rig's hand proportions, depth, contact and sign intelligibility are not solved by this result.

An independent analytic flexion/abduction/opposition fixture (3 frames, 90 paired segments, **not signing data**) gives **30.2326° → <0.00001°** mean direction error. Separate tests cover a zero-limit parent-frame mismatch, mirrored hands, MCP extension/splay outside old bounds, palm flips, single-hand crossings, X-aligned singularities and supported versus unsupported pole reversals.

## Short-window optimization experiment

`temporal.ts` implements an experimental five-frame least-squares pole fit: visibility/evidence-weighted data residual plus adjacent vector differences, followed by normalization. Strong observations (weight ≥0.8) are retained exactly; gaps over 200 ms break the problem, and wholly missing windows return no estimate. It is **not enabled in the reconstruction UI or default solver**.

On a controlled weak-pole jitter sequence, the middle-sample deviation decreases from **10.3132° to 1.3454°**. On a real-turn-shaped analytic step given uniformly low confidence, the same fit causes **25.4633°** distortion at the turn. A five-frame centered window also uses up to two future frames (~67 ms at 30 Hz). Visibility is not calibrated uncertainty, and depth branches can be fundamentally ambiguous. This evidence supports further constrained, confidence-calibrated experiments on consented clips, not automatic smoothing of sign motion. The production change uses only weak-pole temporal continuity and preserves high-evidence turns and hand articulation.

## Diagnostics laboratory and interchange

The optional technical mode extends the existing interface. It provides:

- Original/stored/improved solver selection from **one immutable detection sequence**; exact sampled-frame display and previous/next frame controls. Manual edits are excluded from comparison. “Use selected reconstruction” explicitly adopts the solver result and clears edits.
- Detected yellow skeletons beside rendered white skeletons, per-joint positions/vectors in avatar coordinates, and per-segment global and palm-local angular residuals.
- Joint flexion/spread timelines with missing intervals broken, angular wrapping disclosed, selected-frame inspection, and discontinuity warnings based on quaternion distance (>35° and >720°/s).
- Whole-video detection/tracking/hold coverage, paired residuals, possible identity events, elbow-plane events, wrist path descriptors, simultaneous two-hand coverage, unusual articulation flags, and per-joint correction magnitudes. Radians and meters are never added together.
- Proxy-only summary export and a local evaluation CLI with input hashes and model/settings provenance. Raw body/hand data is not included in these summary reports. Derived outputs may still be sensitive; no sharing is authorized by export.

Schema **1**, 38 rig joint names, raw observations, source metadata and manual edits remain compatible. No schema migration is required. Old imports keep their poses and their old wrist-edit clamping semantics. New 0.2 edits apply the bounded user offset without re-clamping the original supported palm; a zero edit leaves it unchanged. Export/import round trips are tested for both versions. Video upload/processing, worker MediaPipe inference, orbit presets, playback/video clock, JSON interchange and GitHub Actions/Pages workflow remain supported.

## Tests actually executed

- `npm ci --no-audit --no-fund` with a workspace-local cache; locked dependency versions retained.
- `npm run typecheck` / strict TypeScript via the production build.
- `npm test`: **42 numerical/data tests** across three test files. Includes independent Object3D FK, relative joint angles, mirrored articulation, opposition, flips, missing geometry, deep flexion/overhead/behind-torso poses, ambiguous single-hand identity, finite singularity fallback, temporal gaps, weak-pole reversal, source immutability, missing metric denominators, schema compatibility and zero-edit preservation.
- `npm run build`: optimized Vite production build.
- Chromium browser suite: upload-first state, visible WebGL rig, camera/skeleton controls, desktop/mobile layout, old-motion import, timeline, manual edit/export, play/pause, invalid JSON, new laboratory comparison/step/timeline/summary export/adoption and source preservation. Mobile populated-quality-card overflow and a 2 px workflow-row overflow under the Linux DejaVu Sans fallback were found and fixed. The latter was reproduced locally using the CI Chromium 156 build before the CSS fix, and the browser regression now exercises that fallback font.
- Opt-in browser integration: **actual Pose + Hand Landmarker inference** on the fresh public-photo MP4 (30 body frames, 60 hand sets), production-import validation of export, video-master scrubbing and 0.5× playback, and cancellation during model initialization. Exact downloaded models and installed WASM are locally routed at their original URLs; predictions are not mocked. This does not prove external CDN availability on other networks.
- Local evaluation CLI on that exported sequence, with identical detections used for both solvers. Analytic ablation/window experiments reported above were executed locally.

No real KSL motion, multiview calibration, human intelligibility study, qualified anatomical review, Safari/mobile-device inference benchmark, or learned backend evaluation was performed. Public photo/video/model assets, derived raw motion and browser screenshots stay in ignored `work/`; none is committed.

## Remaining work requiring real footage and review

1. Use [the consented evaluation workflow](docs/EVALUATION.md) with qualified KSL reviewers. Evaluate handshape, palm orientation, position, movement path, two-hand coordination, temporal stability and anatomy **separately**, preserving unreviewable intervals. No combined linguistic score is generated.
2. Calibrate hand/body orientation, bone proportions and camera scale/depth; solve thumb contact and finger collisions with independent evidence. Shared camera axes and fixed rig offsets are assumptions, not calibration.
3. Distinguish genuine fast turns and brief handshapes from tracking noise; validate thresholds, crossing/occlusion identity and confidence calibration on real motion. Raw hand arrays do not provide persistent IDs. Label/proximity changes are only candidate events.
4. Evaluate an optimization objective with per-joint evidence and source-fit bounds. Do not accept reduced jitter that distorts signing, invents occluded handshape, or moves a hand to the front of the torso.
5. Add exact decoded timestamps, signer-specific calibration, contact annotations and independent ground truth where available. Improve low-resolution/blur/occlusion estimates before inferring linguistic accuracy from geometric agreement.
6. Preserve facial expression, mouthings, gaze and other nonmanual grammar. Existing head approximation and neutral body presentation are insufficient for a KSL instructor.

The optional learned-backend research in the historical report remains unexecuted. This phase makes no new performance or accuracy claims for DexAvatar, SAM 3D Body or HaMeR. PR validation leaves the existing deployment workflow intact; opening a PR does not deploy to production.

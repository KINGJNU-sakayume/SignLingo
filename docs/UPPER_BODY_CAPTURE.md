# Upper-body comparison and recording-first capture

This follow-up starts from `main` **c0b50e4**, including merged Practice PR #3 and mobile PR #4. The iOS Canvas/main-thread routing, worker fallback, detector cleanup, native phone-video input, reconstruction rig, Motion Lab, CI and Pages deployment are retained. No MediaPipe runtime/model/delegate change is made.

## Real-device baseline and what changed

The user reports **approximately 6.6 processed FPS on iPhone 15 Pro, iOS 27.0.1, Safari**, with inference now working after the previous mobile fix. This is a user-reported inference measurement, not an independently measured camera/encoder rate. The earlier implementation ran sequential live inference during recording, rejected severely undersampled attempts, and used hip-dependent positions. The recording itself was not inspected, so it is unknown whether its encoded frames were also lost.

| Before on main | This change |
|---|---|
| Live inference competes with recording; inference samples constitute the only motion evidence | Record first, release camera, then seek/analyze the retained original file; detector is not created during recording |
| Camera requests 15 FPS; a processed-FPS display can be mistaken for recording FPS | Camera requests an **ideal** 30 FPS; request, track setting, observed preview delivery, encoded-rate availability, inference throughput and media-time sampling are separately labeled |
| Native phone-video extraction hardcoded to 15 Hz | Shared extraction supports 30 Hz (default) and 15 Hz; analysis may take longer than recording |
| Full-torso reference and hip-cropped learner cannot compare palm frames or positions | Both use the same shoulder origin/scale and upper-body orientation, independent of hips |
| Finger geometry can suppress otherwise valid palm/position measurements | Handshape, palm, wrist and face evidence are independently gated; observed 2D relationships remain separate from estimated 3D |
| DTW band/downsampling depend on frame indices | Band and bounded subsampling use real timestamp progress; metric means/coverage account for observed time support |

These changes do **not** establish improved physical iPhone recording FPS or KSL validity. A new test on the user's phone is still required.

## Upper-body coordinate frame

`upperBody.ts` uses shoulder midpoint as origin and shoulder span as the scale for **all three axes**. Hips are never read by practice normalization, so full-body and cropped clips are compatible. MotionClip schema 1 and existing imported clips are retained.

The anatomical shoulder axis supplies lateral direction. Camera image up is projected perpendicular to that axis to handle modest camera roll while preserving shoulder yaw. Two shoulders do **not** determine pitch about their own axis. An optional, bounded calibration estimates one constant pitch from a reliable ear-midpoint-to-shoulder vector: at least five observations over 250 ms, median absolute deviation below 3°, central 80% range below 6°, and pitch within ±25°. If these checks fail or the head is missing/moving, camera-up is used. No per-frame head motion drives a rigid torso axis. Nose motion remains directly available for hand-to-face comparisons.

Small shoulder-frame jitter (<2° rotation or <2.5% span change) receives a 35 ms exponential filter. Larger changes are adopted immediately, and >300 ms gaps reset it. The shoulder midpoint and raw wrist/finger observations are not temporally smoothed by this comparison layer. This avoids freezing meaningful body/head motion or inventing intermediate finger poses.

Stable-head pitch calibration is an approximation, **not camera calibration**. A sustained head posture can bias it; severe foreshortening, back views, large perspective differences and arbitrary body proportions are not corrected. The component display labels 3D depth as uncertain. The original reconstructor retains its existing optional-hip behavior for rendering; metrics use raw observations in the new common frame.

Image-plane measurements independently use shoulder midpoint/span in pixels, aspect-corrected by the source width/height, with an image shoulder axis and perpendicular image up. They require no world coordinates. A missing world coordinate remains absent, never becomes `z = 0`. If a 3D metric lacks sufficient evidence but 2D is supported, the metric explicitly switches to **2D image plane · no depth**; otherwise 2D residuals appear separately within the same card. Wrist paths label their selected space too. Image-plane measurements are observed relationships, not guaranteed anatomical accuracy or perspective invariance.

### Component evidence

Existing confidence gates (≥0.6, hand-label fallback ≥0.9, palm conditioning ≥0.6) are not relaxed. Image reference points must also lie within the image. Ambiguous crossing-hand assignments are not replaced with handedness labels when a pose exists.

| Component | Required observations; no hips required |
|---|---|
| Handshape | Reliable anatomical assignment (or explicit hand-only label fallback), measured palm basis, valid 21-point geometry and all 15 finger segments; independent of shoulders/arm reconstruction |
| Palm orientation | Measured nondegenerate palm and reliable world/image shoulders; a degenerate finger does not remove a valid palm |
| Hand / shoulders | Reliable shoulders and wrist; world observations yield estimated 3D, image observations independently yield 2D |
| Hand / face | Position requirements plus reliable nose in the corresponding space; no face/hip substitution |
| Trajectory | Reliable selected-interval starting wrist plus subsequent shoulder-relative positions |
| Direction | Displacement over an observed 100–300 ms window, >0.015 shoulder widths; never bridge missing tracking or adjacent gaps >300 ms |
| Coordination | Simultaneous left/right wrist positions in the same space; both hands share one DTW path |

Pose wrists may still support location when handshape is missing. Such partial attempts are retained: the initial extraction gate requires three frames and 20% coverage of any observed component, while each comparison metric retains its own stricter evidence gate. Palm measurements require reliable wrist/MCP landmarks, not unrelated fingertips. No held avatar handshape is treated as a hand observation. Each unavailable metric explains its requirements; a missing component does not zero the whole attempt. Diagnostics distinguish **current analyzed frame availability** from **whole-attempt handshape coverage** and each metric's paired coverage.

## Recording, optional framing, and saved-video analysis

1. Enable camera. Preview and optional **Check framing** use the existing detector for a **single snapshot before recording**, then close it. This is not continuous live tracking.
2. Start the countdown and record. No MediaPipe model loading/inference occurs during the recording or countdown. MediaRecorder receives the original camera stream without a canvas-copy/inference bottleneck. Preview mirroring remains CSS-only; pixel unmirroring happens during later analysis.
3. Stop (or reach the 20-second cap). Finalize the blob and stop camera tracks independently of analysis. Camera permission cancellation, late-arriving streams, mute/disconnect, frozen delivery, orientation changes and recorder failures retain explicit handling.
4. Store the completed recording in memory before analysis. Use the **same `processPracticeVideo` → `processVideo` → existing detector/reconstructor** pipeline used by the native-phone input. Cancel/model failure/insufficient tracking does not erase a completed recording. It can be downloaded explicitly or reanalyzed with another setting. Exiting Practice or reloading clears it; there is no automatic upload/persistence/audio.
5. Choose 30/15 Hz and a 960/640-pixel maximum analysis dimension. The 960 default preserves detail. Lower resolution is an explicit tradeoff, not a claim of faster or accurate tracking on every phone. Keep the established CPU backend and iOS routing; GPU performance has not been inferred from desktop results.

A persistent recording in browser memory consumes resources; save it explicitly before leaving if needed. Unsupported codecs, interruption before a complete blob and tab closure can still prevent recovery.

## What each rate measures

| Display | Meaning / limitation |
|---|---|
| Camera request: 30 FPS | Ideal getUserMedia constraint; never labeled measured |
| Track setting | Browser `getSettings().frameRate`; negotiated/reported, not proof of encoded delivery |
| Observed preview delivery | Callback observations divided by media-time span. Uses `requestVideoFrameCallback`; callback skips are counted separately. This can undercount camera delivery if rendering misses callbacks. Older browsers use explicitly labeled 100 ms video-clock polling, not a sensor FPS estimate |
| Encoded recording FPS | **Unavailable from browser APIs** in this implementation. Neither recorder chunk frequency, inference rate nor preview FPS substitutes for an encoded-frame count. Independent container/frame inspection can measure it in a benchmark |
| Offline sampling request | 15/30 Hz requested sample grid in video time, independent of analysis wall-clock speed |
| Observed media-time sampling | Unique extracted observations / their presentation-time span; a measured sample rate, not a claim that every encoded frame was inspected |
| Inference throughput | Successful detections divided by elapsed time inside the sequential detector calls (including its backend scheduling) |
| Analysis throughput | Observations divided by total extraction wall time, including model setup, seeking and reconstruction |

The UI reports duplicate/unconfirmed decoded requests, irregular intervals, large gaps and maximum gap. Camera callback skips and cadence anomalies are not asserted to be encoder frame loss: variable frame-rate recordings are legitimate.

## Accurate decoding and temporal evidence

Practice requests `requestVideoFrameCallback` metadata **before each seek** and uses the decoded presentation timestamp, not the seek target, for evidence. Repeated presentation times are skipped; an unconfirmed callback is withheld and counted rather than treated as a fresh frame. A 15 FPS recording analyzed on a 30 Hz grid therefore contributes 15 distinct frames per second, not 30 invented handshapes. Gaps and variable intervals remain in the MotionClip.

Without frame callbacks, the fallback explicitly labels timestamps **requested-time-unverified** and withholds exact repeated pixel snapshots. This conservative fallback can remove legitimate static holds; it does not pretend to recover exact timing and may reject an attempt. Modern Safari/Chromium with frame callbacks is preferred. No video decoder callback can prove model landmark accuracy.

Unfinalized WebM duration is resolved by seeking to the decoded end; a duration measured by this app's own recorder is a bounded fallback. Untrusted uploaded files do not get an invented duration. The optional schema-1 `source.timeOffset` stores the first observed media presentation time; clip timestamps start at zero, and both Practice and Motion Lab add/subtract the offset for original-video synchronization. Existing files without it behave exactly as before.

DTW continues to match geometry, not equal timestamps. Its ±45% progress band now uses normalized **elapsed times**. At most 180 existing observations are selected near uniform time bins; none are interpolated. Residual means weight each match by the average supported time of its two frames, dividing by the number of repeated DTW matches per frame. Coverage is the minimum of distinct-frame coverage and supported-time coverage in either clip. Half-neighbor support is capped at 150 ms on each side; a long gap cannot count as a long reliable hold. At least three samples and 65% paired coverage remain required. Harmless global speed changes have no score penalty; there is still no overall KSL correctness score.

## Measurements performed for this change

Environment: managed Linux workspace, headless Chromium **156**, CPU MediaPipe Tasks Vision **1.1.0**, unchanged model bytes. These are **not iPhone/Android hardware measurements**.

### Recording separated from a slow detector

An actual browser MediaRecorder encoded a **synthetic canvas** stream requested at 30 Hz. The test asserted that no detector worker/model was requested until recording stopped, then used explicitly mocked detections delayed 150 ms each (~6.6 FPS).

- Preview observed 44 callbacks at 30.3 FPS; track setting reported 30 (not a measured encoder rate).
- Offline analysis retained **43 distinct observations from 43 requests**, measured **30.0 Hz in media time**, while inference throughput was **6.6 FPS** and total analysis throughput **5.9 FPS**.
- Independent `ffprobe -show_frames -count_frames` on the saved VP8 file found **45 encoded frames**, presentation span **0.000–1.433 s**. Median positive interval was **33 ms** (~30.3 FPS); count/span rate was **30.7 FPS**, affected by the initial 14 ms interval. The container's `r_frame_rate=1000/1` and missing average rate were **not** treated as actual FPS. The fixed 30 Hz sampling grid intentionally did not claim every encoded frame (including short startup intervals).
- This demonstrates preserved recorded evidence with slow processing, not physical sensor quality. No synthetic hand detections are presented as model-accuracy evidence.

### Real MediaPipe resolution/sampling exploration

Same two-second public still-photo video, encoded at 30 FPS; actual MediaPipe outputs, original model/WASM bytes. File is 640×1004; the 960/640 caps yield 612×960 and 408×640 inference inputs. Each row is one exploratory run, with setup included in overall analysis rate; not a statistically stable performance comparison.

| Requested analysis | Unique observations | Observed sampling | Inference throughput | Overall analysis throughput | Handshape coverage L/R |
|---|---:|---:|---:|---:|---:|
| 30 Hz, 960 px maximum | 60 / 60 | 30.0 Hz | 8.1 FPS | 5.5 FPS | 100% / 100% |
| 30 Hz, 640 px maximum | 60 / 60 | 30.0 Hz | 8.7 FPS | 5.8 FPS | 100% / 100% |
| 15 Hz, 960 px maximum | 30 / 30 | 15.0 Hz | 8.7 FPS | 5.1 FPS | 100% / 100% |

The smaller input showed 8.7 versus 8.1 FPS in one run, but setup/order/cache and run-to-run variation were not controlled sufficiently to establish a general speedup. Static-photo coverage cannot establish preserved finger accuracy during motion. The firm finding is preserved 15/30 Hz evidence despite <9 FPS inference. Repeated hardware measurements and consented moving hands are needed before changing the default resolution or backend; neither was changed based on these exploratory results.

### Sampling and compatibility regressions

- A real encoded 1-second **15 FPS** synthetic H.264 fixture requested at 30 Hz produced exactly **15** observations.
- A 2-second VFR synthetic pattern created by removing frames 12–23 from a 30 Hz source (keeping original PTS) produced **48** observations, **12 duplicate requests skipped**, and **one irregular interval**. No intermediate landmarks were invented.
- Numerical tests cover visible-hip reference versus cropped learner, both cropped, stable head/shoulders, modest upward/rolled camera, moving head, hands near the face, shoulder scale/finger proportions, missing world coordinates with separate 2D evidence, partial geometry, anatomical swaps, different rates, time-based DTW/downsampling, long gaps and schema compatibility. Fixtures are analytic, not real signers.
- Browser tests preserve desktop Motion Lab, mirrored input, native-phone fallback, optional framing overlay, permission/recording failures, retained-file retry, cancellation and localization/mobile layout. iOS-selected main-thread Tasks tests and Android user-agent worker tests run in Chromium with mocked APIs/detections; they are **not Safari/Android engine validation**.

See `PRACTICE_EVALUATION.md` for final test counts and commands. Baseline mobile runtime tests remain; the old live-inference capture tests were replaced with recording-only lifecycle tests because inference is deliberately no longer part of capture.

## Reproduce / next physical-device check

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
# Optional: exact assets in ignored work/, as in prior reports.
PRACTICE_VISION_TEST=1 VISION_TEST_VIDEO=work/public-photo-smoke.mp4 npm run test:browser
PRACTICE_BENCHMARK=1 npm run test:browser -- tests/browser/recording-first.spec.ts
```

The benchmark expects `work/public-photo-30fps.mp4` plus the existing public photo/model files. The photo is `https://storage.googleapis.com/mediapipe-assets/male_full_height_hands.jpg`; no real signing or personal recording is committed. Synthetic encoded fixtures are labeled in their test files.

On **iPhone 15 Pro / iOS 27.0.1 / Safari**, repeat the same complete sign with hips fully cropped. Record requested/track/preview rates, save the original file and inspect its frame PTS independently, then analyze at 30 and 15 Hz. Compare handshape/palm/location/path availability against the hip-visible reference; check permission, interruption, retries, thermal throttling and repeated-session memory. Repeat on Android hardware. Head pitch, severe perspective, occlusion and real KSL interpretation still need consented expert review. There is no certified assessment claim or fixed 30 FPS promise.

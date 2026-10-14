# Consented signing-clip evaluation

No real KSL clip or qualified signer review is included in this repository. Analytic tests and photo-derived smoke tests are not linguistic validation. Follow this workflow for footage you have permission to process, including permission from everyone identifiable in it. Keep permission records and footage outside Git.

1. Keep local inputs in `private-data/` and outputs in `work/evaluation/` (both ignored). Record a private pseudonymous clip ID, provenance, permission scope, signer/camera/session, whether the file is mirrored, and which signs/contrasts a qualified KSL reviewer expects. Do not put names, consent forms, videos, or personal motion JSON in a PR.
2. Include isolated signs and short continuous clips. Choose varied handshapes, palm orientations, face/body contact, crossed hands, brief holds, depth motion, fingerspelling where relevant, fast transitions and legitimate overhead/behind-torso positions. Use a qualified reviewer to select linguistically meaningful examples. Do not label procedural motion as signing.
3. Upload locally in Motion Lab. Choose the correct mirrored flag and 30 fps when source rate supports it. Model downloads are network requests; video and predictions stay in the browser. Review missed frames rather than discarding them from the dataset.
4. Export the motion JSON into the private directory. Open **Technical inspection mode** to compare the frozen 0.1.0 and improved 0.2.0 solvers on the exact same stored detections, not two different model runs. Yellow lines show detected estimates; white lines show the articulated rig. Scrub uncertain frames and use the front/side/first-person/hand close-up views. Manual edits are excluded from comparisons; applying a comparison pipeline clears them explicitly. Old schema-1 motion remains importable and unchanged until you choose a reconstruction.
5. Generate the reproducible local summary:

   ```sh
   npm ci
   npm run evaluate -- --motion private-data/clip.motion.json --video private-data/clip.mp4 --consent --output work/evaluation/clip.evaluation.json
   ```

   `--consent` is the operator's confirmation of authorized local evaluation, not a substitute for obtaining permission. `--video` is optional and adds a SHA-256 fingerprint; it does not rerun inference. The script also reruns the old finger thresholds in old versus corrected frames and measures old parent composition with clamps disabled (`ablation`). It records motion/video hashes, model URLs, detector ID, pipeline versions, resolution, sampling and mirroring. No raw joints, source filename, or video is written into the summary. Derived summaries can still be personal data and are not approved for publication by this command. CLI output defaults to ignored `work/`.
6. Use the review template below separately for each pipeline, with order concealed/randomized by the reviewer when feasible. Attach private timecoded notes for failures, not just an average score. Compare coverage first, then paired residuals only on their common valid joints. Preserve failures and missing intervals. Reuse identical inputs and settings across versions.
7. Share only explicitly authorized artifacts. A numerical improvement against MediaPipe is agreement with an estimate; it is not improvement against ground truth. Keep `linguisticReview: not performed` in automatic reports; record human review separately with actual reviewer qualifications, date, scope and evidence.

## Separate evaluation dimensions

| Dimension | Automatic proxy available | Required independent review or reference |
|---|---|---|
| Handshape consistency | Mean/P95 segment direction residual and palm-local residual; endpoint mismatch | Digit configuration, contacts, thumb opposition, meaning-changing contrasts and hold fidelity |
| Palm orientation | Quaternion residual vs detected palm; abrupt world-palm rotation events | Annotated orientation or multiview reference; normal flips and contact orientation |
| Hand position | Wrist and finger endpoint residuals in normalized avatar meters | Calibrated/world or image annotations with coordinate definitions; signer-relative locations |
| Movement path | Tracked wrist path length, valid interval count, peak speed | Time-aligned trajectory annotations, path shape and acceleration relevant to each sign |
| Two-hand coordination | Simultaneous tracked-frame coverage, possible identity events | Relative position/orientation, contact, lead/lag and coordinated transitions |
| Temporal stability | Sudden rotations >35° and >720°/s, elbow-plane events, timelines | Distinguish real fast signing from tracking jitter; inspect gaps, latency and hold duration |
| Anatomical plausibility | Broad unusual-articulation flags, applied reach corrections and magnitudes | Anatomical review, self-contact/interpenetration and signer-specific range/proportions |

There is no combined “accuracy” score. Handedness classification and pose visibility are uncalibrated confidence proxies, not landmark error bars. Raw detection arrays have no persistent hand IDs; label/proximity changes indicate possible identity failures only. Detector ordering changes alone do not count as swaps.

Automatic source hand points are translated to the **detected normalized body wrist**. The renderer uses the constrained IK wrist. This makes reach/registration error visible. Segment angles compare unit vectors in common avatar axes; handshape angles remove each palm's orientation before comparison. Fixed rig offsets/lengths contribute to endpoint error; zero angular residual cannot imply correct proportions, thumb contact, depth or anatomy. Missing/held samples are excluded from residuals and remain in coverage denominators. Paired metrics use the same timestamp, side and joint in both pipelines. No scores are imputed for missing frames. Path metrics skip gaps over 200 ms and missing endpoints; they are descriptive, not target-path accuracy.

Video sampling uses seek time, not exact decoded presentation timestamps; variable-frame-rate and repeated-frame effects remain unresolved. A source hash helps reproduce a run but does not establish timestamp accuracy. Save exports from the same inference run to isolate solver changes from model/runtime variation.

## Private human-review template

Copy this into `work/evaluation/clip-review.md`. Do not fill unknown fields with assumed success.

- Clip ID / permission record reference:
- Motion SHA-256 / optional video SHA-256:
- Pipeline, sample rate, mirroring, model/runtime:
- Reviewer qualifications and KSL experience / date:
- Ground truth type and calibration (or “unavailable”):
- Handshape: **not reviewed** — timecodes, observable mismatches, impact:
- Palm orientation: **not reviewed** — timecodes, evidence:
- Hand position: **not reviewed** — timecodes, evidence:
- Movement path: **not reviewed** — timecodes, evidence:
- Two-hand coordination: **not reviewed** — timecodes, evidence:
- Temporal stability: **not reviewed** — timecodes, evidence:
- Anatomical plausibility: **not reviewed** — timecodes, evidence:
- Nonmanual information absent or incorrect:
- Unreviewable intervals / ambiguity / reviewer disagreement:
- Authorized scope for sharing results:

Use descriptive judgments (“preserved”, “distorted”, “unreviewable”) with evidence for each dimension. Numerical ground-truth errors require a defined annotation protocol and calibrated coordinate system; the automated workflow intentionally does not manufacture them.

## Reproduce infrastructure smoke testing

Download the exact model URLs from `src/motion/types.ts` into `work/pose_landmarker_full.task` and `work/hand_landmarker.task`. Supply a **consented** video:

```sh
npm run build
CHROMIUM_PATH=/path/to/chromium VISION_TEST_VIDEO=/private/clip.mp4 npm run test:browser
```

This exercises real local MediaPipe CPU inference and exports `work/vision-result.motion.json`. Predictions are not mocked; tests serve the upstream model/WASM bytes through local URL interception. `VISION_EXPECT_HANDS=1` additionally requires at least one tracked frame on each side; `VISION_MIRRORED=1` selects pixel unmirroring. The optional vision test expects a clip of at least 0.5 seconds, enough upper-body detections, and duration ≤120 seconds. Routine CI skips inference if no video is supplied.

The public `male_full_height_hands.jpg` MediaPipe asset can be looped into a two-second, 15 fps MP4 for an infrastructure comparison. Record the video hash because re-encoding changes detector outputs. It remains a static photo experiment, **not real signing data**.

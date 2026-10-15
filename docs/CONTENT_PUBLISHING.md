# Preparing and publishing Korean Sign Language content

The app uses a static, versioned catalog and the existing MotionClip v1 parser, MediaPipe reconstruction, diagnostics, wrist correction, avatar and Practice Mode. There is no backend, paid service, database, Git LFS or automatic dataset crawler.

## Files and commands

- `src/content/catalog.json`: typed research/production registry. Candidates have no playable asset.
- `src/content/schema.ts`: Zod contract and inferred TypeScript types, schema `signlingo.content`, version 1.
- `public/content/manifest.json`: generated published expressions plus upcoming course metadata. Only this manifest is loaded by learners.
- `public/content/assets/<expression-id>/v<revision>/`: approved, immutable assets only.
- `public/content/releases.json`: prior published versions, retained with their exact metadata and assets for compatibility.
- `docs/content-reviews/`: redacted permission and expert-review evidence. No actual approvals exist yet.
- `private-data/`: ignored operator working packages, original recordings and inspection reports. Never commit these.

```sh
npm run content -- register ksl-thanks private-data/ksl-thanks
npm run content -- transition private-data/ksl-thanks/entry.json source-approved
npm run content -- transition private-data/ksl-thanks/entry.json motion-processing-required
npm run content -- prepare private-data/ksl-thanks private-data/original.mp4 private-data/export.motion.json
npm run content -- constrain private-data/ksl-thanks docs/constraints/ksl-thanks.constraints.json   # optional
npm run content -- subject private-data/ksl-thanks/entry.json
npm run content -- transition private-data/ksl-thanks/entry.json linguistic-review-required
npm run content -- transition private-data/ksl-thanks/entry.json ready-to-publish
npm run content -- publish private-data/ksl-thanks
npm run content:validate
npm run typecheck
npm test
npm run build
npm run test:browser
```

These commands are sequential milestones, **not a script that approves a candidate**. Supply the real records described below before each transition. The publication command creates repository files locally; it does not commit, push or deploy them.

## 1. Register and obtain rights before processing

Register a candidate, then edit its private `entry.json`. Confirm the source owner, exact entry ID, sense and variant; internal IDs such as `ksl-thanks` are not linguistic glosses. Leave a gloss null if the source/reviewer does not supply one.

Establish the actual selected video's SHA-256 (for example `sha256sum private-data/original.mp4`) and record it as `source.videoSha256`. Record authorized acquisition and set provenance to `authorized-video` only when that has happened. `source.originalVideoUrl` is optional provenance; it never automatically embeds or downloads a video.

Record independent `allowed` / `denied` / `unknown` decisions for `importVideo`, `deriveMotion`, `publishMotion`, `publishVideo`, `externalVideo`, `publicRepository`, `publicWebsite`. Unknown never means yes. Specify the asset-specific license and conditions, not only a site-wide policy. The permission approval includes `sourceSha256` matching the authorized source and this evidence structure:

```json
{
  "reviewer": "Actual reviewer name",
  "qualification": "Actual role or relevant credentials",
  "date": "YYYY-MM-DD",
  "reference": "Permission or review record identifier",
  "notes": "Specific permission scope or findings; unresolved restrictions",
  "document": {
    "path": "docs/content-reviews/actual-record.md",
    "sha256": "64 lowercase hex characters for that exact redacted record"
  }
}
```

This is a shape example, not valid approval evidence. Provide a readable redacted document describing the rights holder, source hash, permission scope, conditions and evidence location. Do not commit private signatures/contact details/consent originals without authorization. The validator requires the file to exist with the recorded hash. Human maintainers must authenticate the grant and qualifications: static JSON and hashes cannot prove that a reviewer is truthful or authorized.

## 2. Reuse Motion Lab to process, inspect and correct

After source approval, open **동작 복원**, select the authorized local video and run **동작 추출 및 복원** (existing 30 Hz offline pipeline). Compare original video and avatar. Use **기술 진단 모드**, hand tracking status, suspect-frame navigation, joint direction/length diagnostics and original/improved reconstruction comparison. Use wrist edits or reprocess a clearer recording where appropriate. Export the final JSON using **JSON 내보내기**. No pipeline or MotionClip schema has been replaced.

`prepare` checks the source hash, export filename/size, MotionClip parser, frame count and synthetic markers. It writes the reviewed-motion candidate into the private package and generates `inspection.json`: missing/held-hand timestamps, warnings, joint corrections and review subject hash. These diagnostics identify places to inspect, never linguistic approval. Compare finger occlusion, swapped hands, contact, axes, temporal gaps and corrections manually. If the JSON is edited or re-exported, run preparation again and invalidate reviews.

**로컬 자료로 학습 흐름 점검** under Motion Lab retains Phase 4's upload-based observation/practice loop for operators. It never changes a publication status. Its legacy progress remains under `first-expression`, separate from published expression/version records.

### Optional: constraint correction

Constraint documents ([docs/CONSTRAINTS.md](CONSTRAINTS.md)) correct a finished motion, e.g. "the hands meet at the same height". Preview them in Motion Lab's **제약 조건 보정** panel, then apply them to the package:

```sh
npm run content -- constrain private-data/ksl-meet docs/constraints/ksl-meet.constraints.json
```

- The source is the package's motion asset (or, for a published revision, the identical `public/` file, read only), checked against its recorded SHA-256. A corrected (version-2) source is solved again from its original observations, so constraints never stack.
- **Revision**: the catalog (`src/content/catalog.json`), not the private `entry.json`, says what is published. If the entry is published and the package revision is not above it, the corrected motion becomes revision *published + 1*. A package that is already at a higher unpublished revision keeps it and only its private asset is rebuilt; re-running `constrain` never increments again. Other private assets (a local video) are copied to the new revision path; `public/` is never written.
- The motion is written to `content/assets/<id>/v<revision>/reference.motion.json` inside the package, the applied document is saved as `constraints.json`, and the entry records `constraints: { sha256, count }`. That field is part of the review subject, so every earlier approval stops verifying. Status returns to `reconstruction-review-required` and both reviews to `pending`; `license.approval` (bound to the video hash), description, variant and movement notes are kept.
- `inspection.json` is regenerated with the constraint hash, changed frames and joints, hands whose values were produced without an observation (`constrained`), residuals and notes.
- `prepare` with a version-2 export (from `motion:batch --constraints` or Motion Lab's 보정본 내보내기) records the same `constraints` field. `parseLessonMotion` reads version 2 and rejects a motion whose constraint hash differs from the entry. Publishing at or below the published revision is refused as before.

## 3. Complete package metadata before approving it

Set expert-written Korean meaning, description and movement notes; identify the chosen source entry and variant; record whether camera practice is suitable. Set the exact reconstruction pipeline version from the export. This is a separate field from publication state. The MotionClip's `nonmanual.linguisticValidation: not-performed` remains intact: AI reconstruction never becomes a linguistic validator.

A local video is optional. To publish one, set `assets.video` with `content/assets/<id>/v<revision>/original.mp4` (or WebM), correct media type, byte count, SHA-256 and revision, and copy it **only into the private package**. The source hash must match and video/public-hosting permissions must be allowed. `prepare` never copies the original video to `public/`.

For larger videos, a licensed stable HTTPS external host can be recorded instead. It must permit browser fetching with CORS and unauthenticated playback, have a versioned immutable URL, and pass a byte/hash check during packaging and playback. Do not use expiring links, third-party embeds or cookies. Source-video permissions do not automatically permit motion distribution. MotionClips stay on the static site for reliable Practice loading.

## 4. Record two independent approvals

**Owner feedback (from 2026-10-15).** Under [the review rule](content-reviews/review-process.md) the repository owner's approving feedback on a candidate is the result of both reviews. Record it in one step instead of the manual steps below:

```sh
npm run content -- approve --publish --feedback "<feedback, verbatim>" private-data/ksl-meet private-data/ksl-thanks
```

It computes each package's subject, motion and constraint hashes, writes `docs/content-reviews/review-<date>[-n].md`, approves both reviews against that record (reviewer names from `src/content/reviewers.json`), moves the package to `ready-to-publish` and publishes it with `--publish`. The revision is the package's own; nothing is typed by hand.

The manual flow:

Run `subject` **after** finalizing metadata and assets. Each approved review needs `status: approved`, a full `evidence` record above and `subjectSha256` from this command. The record document should identify the subject hash, findings and explicit approval. Changing review evidence does not recursively change the subject; changing source, asset bytes/hash, license, description, variant, revision or pipeline does.

- Reconstruction reviewer: compare original and final rendered avatar; document hand tracking gaps, finger/palm/joint errors, timing, corrections, remaining limits and acceptability.
- KSL reviewer: document relevant qualifications and examine the exact original plus avatar, selected sense/variant, grammar, nonmanual signals, handshape/movement notes, learner explanation and webcam suitability. Authoritative source provenance alone is insufficient.

The reviews have distinct records and approval fields; the schema does not assume two different people always have to perform them. The operator cannot publish by toggling a UI flag. Transitions are ordered:

`candidate → rights-review-required → source-approved → motion-processing-required → reconstruction-review-required → linguistic-review-required → ready-to-publish → published`

Returning to rights review is allowed. Review digests and evidence documents are rechecked by packaging, build and loader. Missing linguistic approval, inadequate camera suitability, unresolved variants, absent assets, unknown distribution rights, synthetic markers and stale approvals all fail publication.

## 5. Export a static release and review the PR

`publish` validates the entire private package, rights/reviews and any external video before copying approved assets. It updates the source registry and generates the manifest, setting the top-level `updatedAt` of both to the release day (the operator's local date, never earlier than the published entry or the previous catalog). The compatibility check compares published entries only, so a newer top-level date passes `content:validate` locally and in CI. Inspect the diff and run all checks. To include approved `.motion.json`/video files, stage only the exact validated paths with `git add -f`; broad force-adds could expose private data. Normal ignores intentionally continue protecting arbitrary motion exports and videos.

The build scans `public/content/` for unregistered files and symlinks and checks local asset bytes, hashes, MotionClip compatibility and evidence documents. Do not put content media elsewhere under `public/` to evade this contract. Asset updates need a new positive revision and new versioned path; existing files are never overwritten by the publisher. Previously published metadata/bytes are retained in releases and checked against the PR base or pre-push commit in CI, and `origin/main` locally (full-history checkout in CI; override `CONTENT_BASE_REF` only for an explicit comparison base).

An urgent rights withdrawal is different from an ordinary content update: remove access promptly, then make an explicitly reviewed migration of the compatibility baseline/validator and any retained asset. The normal publisher deliberately will not silently delete previously published content.

## Learner behavior and failure handling

Learners start on the Korean learning path. Only published, validated entries can load a 3D lesson; upcoming categories have no start button. Lesson playback supports 0.5× speed, repeat, A–B section repeat, scrub, front/side/first-person/hand close-up views, a per-device mirror view and camera rotation. Learner screens steady the torso and fill missing handshapes for display only; the published MotionClip, its hash and its reviews are unaffected ([display pipeline](DISPLAY_PIPELINE.md)). A reviewed constraint-corrected motion shows its constrained hands in blue with the legend "보정한 손 모양"; hand filling never overwrites or hides them. Practice receives the reference automatically, retains mobile recording/offline processing, and returns to the selected lesson. Feedback describes observed movement differences, not a KSL correctness percentage. Recognition/observation and repetition are the core flow; no additional scoring system is introduced.

Local progress keeps the original v1 storage key and legacy records. New records use expression ID, revision and asset hash, with at most 20 practice summaries and 8 Korean feedback notes per summary. Raw recordings/landmarks are never persisted in progress. Missing/blocked storage does not break learning. Missing, offline, oversized or hash-mismatched motion disables practice and exposes retry; an unavailable original video does not block a valid 3D demonstration. Offline caching and cross-device progress synchronization are not implemented.

## Verification and limits

Unit tests cover schema, duplicate IDs, licensing, stage prerequisites, approval digests/documents, paths, missing/corrupt assets, orphan public files, immutable releases, v1 MotionClips and progress migration. Browser tests intercept synthetic fixtures only at test time to exercise automatic reference loading, playback, Practice return, persistence, phone navigation, forged states and retry. They never put synthetic lessons into production assets. Existing reconstruction/Practice/browser tests still run.

Actual linguistic acceptance, authorized media acquisition, physical-device validation with real KSL and opt-in real MediaPipe model/video tests require the owner's real assets and expert reviewers. Passing the software suite does not complete those reviews.

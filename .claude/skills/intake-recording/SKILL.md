---
name: intake-recording
description: 새로 촬영한 한국수어 영상(자체 촬영·재촬영, 권리자 허락이 있는 영상)을 받아 변환·해시·이용 허락 기록·동작 추출·검수 패키지 준비까지 한다. 유튜브나 사전 영상처럼 허락이 없는 영상은 받지 않는다.
argument-hint: "<영상 파일...> [표현 id]"
---

# 새 촬영 영상 받기

## 0. 받기 전에
- **권리 확인**: 촬영자·출연자의 허락 범위가 있는 영상만 받습니다. 유튜브·국립국어원 사전 영상은 권리자의 서면 허락(또는 CC BY와 출연자 확인) 없이는 받지 않습니다(`docs/KSL_CONTENT_RESEARCH.md`).
- 원본은 `private-data/videos-hq/originals/`(또는 `private-data/videos/`)에 그대로 두고, 편집하지 않습니다. 파일 이름에 실명을 쓰지 않습니다.
- 원본과 변환본은 공개 저장소에 커밋하지 않습니다.

## 1. 변환과 해시
- iPhone `.mov`(HEVC)는 Chromium이 디코딩하지 못하므로 VP9 WebM으로 옮깁니다(`docs/MOTION_BATCH.md`):
  ```sh
  ffmpeg -i in.mov -an -c:v libvpx-vp9 -crf 18 -b:v 0 -row-mt 1 -pix_fmt yuv420p private-data/videos-hq/<id>.webm
  ```
- `sha256sum`으로 원본과 변환본의 해시를 모두 구합니다. 동작 추출과 콘텐츠의 원본 해시는 **변환본(WebM)**입니다.
- `ffprobe`로 해상도·fps·길이를 기록합니다.

## 2. 촬영 기준 점검 (`docs/RECORDING_GUIDE.md` 체크리스트)
- 좌우 반전 여부(저장 파일 기준). 반전이면 추출에 `--mirrored`.
- 해상도, 손 크기(펼친 손이 화면 높이 15% 이상), 시작·끝 정지 구간, 손이 화면 안에 있는지.
- 기준에 크게 못 미치면 재촬영을 권하고 이유를 수치로 말합니다.

## 3. 이용 허락 기록
- `docs/content-reviews/own-recording-rights-<날짜>.md`를 기존 기록(`own-recording-rights-2026-10-16.md`)과 같은 형식으로 씁니다: 기록 번호, 권리자·출연자(가명), 파일 이름·바이트·SHA-256(원본과 변환본), 허락 범위 7개 항목, 범위 밖 사항.
- 권리 결정은 사용자가 말한 범위만 씁니다. 모르면 `unknown`이고, unknown은 허락이 아닙니다.

## 4. 동작 추출과 확인
```sh
npm run motion:batch -- private-data/videos-hq/<id>.webm --out private-data/exports/<run> [--constraints docs/constraints] [--mirrored]
```
- `work/batch-report.md`에서 좌·우 손 누락률(전체·동작 구간), 화면 밖·화면 안 실패를 봅니다. 이전 영상과 비교표를 만들어 사용자에게 보여 줍니다.
- 이 클라우드 Chromium은 H.264 MP4를 디코딩하지 못합니다. WebM을 쓰거나, 로컬 PC에서는 `--channel chrome`.
- 대안(본체 PC, `.mov` 직접): `tools/extract/extract.py` → `npm run motion:import -- <detections 폴더> --out <폴더> --videos <원본 폴더>`. 추출에 쓴 파일이 권리 기록의 해시 파일과 같아야 합니다(`docs/LOCAL_EXTRACTION.md`).

## 5. 패키지 준비
- 새 후보: `npm run content -- register <id> private-data/<id>` 뒤 `entry.json`에 권리·해시를 적고 단계를 옮깁니다(`docs/CONTENT_PUBLISHING.md`).
- 원본을 바꾸는 재촬영: `npm run content -- transition private-data/<id>/entry.json rights-review-required`(두 검수 초기화) → 권리 기록 반영 → `source-approved` → `motion-processing-required`.
- `npm run content -- prepare private-data/<id> private-data/videos-hq/<id>.webm private-data/exports/<run>/<id>.motion.json`
- 새 영상의 수어 형태가 이전 설명과 다르면 `description`을 고치고, 바뀐 점을 후보 기록에 적습니다.
- 이어서 `review-candidate`로 제약 조건 적용·화면 확인·기록을 합니다.

# SignLingo 작업 메모

## 콘텐츠 검수 (중요)

- 저장소 소유자의 승인 피드백("좋다", "충분하다", "공개")은 그 개정판 후보의 **두 검수(3D 복원·한국수어) 승인**입니다. 검수자가 따로 확인했는지 다시 묻지 않습니다. 규칙: `docs/content-reviews/review-process.md`.
- 승인은 `npm run content -- approve --publish --feedback "<피드백 원문>" private-data/<id>...`로 기록하고 공개합니다. 해시·개정판 번호를 손으로 적지 않습니다.
- 수정 요청은 고친 뒤 비공개 패키지(`private-data/`, 비공개 저장소 `signlingo-private`)를 다시 만들고(`npm run content -- constrain …`) 화면을 보여 줍니다. 공개된 개정판은 바꾸지 않습니다.
- `private-data/`는 공개 저장소에 커밋하지 않습니다. 비공개 저장소의 `private-data/`와 같은 내용으로 맞춥니다.

## 검증

`npm run typecheck`, `npm test`, `npm run build`(콘텐츠 검증 포함), `npx playwright test`(이 클라우드 환경의 Chromium은 영상 디코딩이 안 되어 Practice·recording-first·temporal 일부가 원래 실패합니다).

## 표시 계층

학습 화면 표시는 `src/motion/display/`의 단계(시간 복원 → 몸통 고정 → 흔들림 줄이기 → 손 채우기 → 쉬는 자세 → 손 겹침 해소)가 바꿉니다. 저장된 동작과 검수 대상 해시는 바뀌지 않으므로 재검수가 필요 없습니다. `docs/DISPLAY_PIPELINE.md`.

## 자동화 (`.claude/`)

- 클라우드 세션이 시작되면 `.claude/hooks/session-start.sh`가 `npm ci`(잠금 파일이 바뀐 경우만), `CHROMIUM_PATH` 지정, 비어 있는 `private-data/`를 `../signlingo-private/private-data`에서 복사하고 검수 대기 패키지를 알려 줍니다. 로컬 PC에서는 아무것도 하지 않습니다.
- 콘텐츠 작업 스킬: `intake-recording`(새 촬영 영상 → 패키지) → `review-candidate`(수정 요청 → 후보·화면) → `approve-publish`(승인 피드백 → 기록·공개).
- 검수 화면 그림: `npm run dev` 뒤 `npm run review:shots -- <id>` → `work/screens/review-<id>-<view>.png`.
- 본체 PC 로컬 추출: `tools/extract/extract.py --backend mediapipe|wilor|sam3d`(`.mov` 직접) → `npm run motion:import` → `content prepare`. 좌표 변환 테스트: `python -m unittest tools/extract/test_convert.py tools/extract/test_backends.py`. `docs/LOCAL_EXTRACTION.md`.

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

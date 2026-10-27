---
name: approve-publish
description: 저장소 소유자가 검수 후보에 승인 피드백("좋다", "충분하다", "공개")을 남겼을 때 그 피드백을 두 검수 승인으로 기록하고 개정판을 공개한다. 수정 요청이 담긴 피드백에는 쓰지 않는다.
argument-hint: "\"<피드백 원문>\" <package-id>..."
---

# 승인 기록과 공개

규칙: `CLAUDE.md`, `docs/content-reviews/review-process.md`. 소유자의 승인 피드백은 그 개정판 후보의 **두 검수(3D 복원·한국수어) 승인**입니다. 검수자가 따로 확인했는지 다시 묻지 않습니다.

## 1. 대상 정하기
- 피드백이 가리키는 표현의 `private-data/<id>/entry.json` **현재 개정판**이 대상입니다. 개정판 번호를 따로 묻지 않습니다.
- 피드백에 수정 요청이 섞여 있으면, 승인된 표현만 여기서 처리하고 나머지는 `review-candidate`로 넘깁니다.

## 2. 기록·공개
```sh
npm run content -- approve --publish --feedback "<피드백 원문 그대로>" private-data/<id> [private-data/<id2> ...]
```
- 명령이 대상 해시를 계산해 `docs/content-reviews/review-<날짜>[-n].md`를 만들고, 두 검수를 승인하고, 공개 자산·manifest를 씁니다.
- 해시·개정판 번호를 손으로 적지 않습니다. 피드백 원문은 고치지 않습니다.
- 승인된 동작의 제약 조건 문서가 바뀌었으면 `docs/constraints/<id>.constraints.json` 예시도 공개본으로 바꿉니다(이전 공개 때와 같게).

## 3. 검증
```sh
npm run typecheck && npm test && npm run build
```
`build`가 콘텐츠 검증(권리·검수·해시·공개 게이트의 자기 비교)을 포함합니다. 실패하면 공개하지 말고 원인을 보고합니다.

## 4. 커밋
- 공개 저장소: `public/content/`, `src/content/catalog.json`, `docs/content-reviews/review-*.md`, 바뀐 `docs/constraints/`만. `private-data/`는 절대 커밋하지 않습니다.
- 후보 기록 문서(`course1-*-candidates-*.md` 등)의 "후속" 절에 피드백 원문과 결과 한 줄을 더합니다.
- 비공개 저장소: `cp -a private-data/<id>/. ../signlingo-private/private-data/<id>/`로 맞추고, `README.md`의 공개 상태·검수 대기 줄을 고쳐 커밋·푸시합니다.
- 공개는 `main`에 머지되어 Pages 배포가 끝나야 사이트에 보입니다.

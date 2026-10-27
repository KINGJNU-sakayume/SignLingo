---
name: review-candidate
description: 한국수어 표현의 수정 요청(검토 소견)을 받아 새 개정판 후보를 만들고 학습 화면 그림으로 보여 준다. "손이 겹친다", "두 번 대야 한다", "이 구간이 어색하다" 같은 피드백이나 새로 준비한 패키지를 검수에 올릴 때 쓴다.
argument-hint: "<package-id> [피드백 원문]"
---

# 검수 후보 만들고 보여 주기

규칙의 원본은 `CLAUDE.md`와 `docs/content-reviews/review-process.md`입니다. 공개된 개정판(`public/content/assets/`)은 바꾸지 않습니다. 해시·개정판 번호는 명령 출력만 옮깁니다.

## 0. 준비
- `private-data/<id>/entry.json`이 있는지 봅니다. 없으면 세션 훅이 비공개 저장소에서 복사했는지 확인합니다(`../signlingo-private/private-data`).
- 피드백 원문을 그대로 보관합니다. 표현마다 따로 판단합니다(하나는 승인, 하나는 수정일 수 있음).
- 승인 피드백("좋다", "충분하다", "공개")이면 이 스킬이 아니라 `approve-publish`입니다.

## 1. 원인 찾기
- 표시 문제(몸통 흔들림, 손 채우기, 쉬는 자세, 손 겹침의 화면 표시)인지, 저장 동작 문제인지 나눕니다. 표시 문제는 `src/motion/display/`만 고치며 재검수가 필요 없습니다(`docs/DISPLAY_PIPELINE.md`).
- 저장 동작 문제는 제약 조건으로 고칩니다. 잔차는 `npm run motion:constrain-report -- <motion.json> <constraints.json>`으로 잽니다.

## 2. 제약 조건 고치기
- `docs/CONSTRAINTS.md`의 "0. LLM 출력 규칙"을 지킵니다. 특히 시각을 지어내지 않고(반복 접촉은 `approaches`), 비수지 신호는 조건으로 만들지 않습니다.
- 현재 문서는 `private-data/<id>/constraints.json`(없으면 `docs/constraints/<id>.constraints.json`)입니다. 프레임 구간은 그 패키지 동작에서 잰 값만 씁니다.

## 3. 후보 만들기
```sh
npm run content -- constrain private-data/<id> <constraints.json>
npm run content -- subject private-data/<id>/entry.json
npm run content:validate
```
`constrain`은 공개된 개정판 번호를 다시 쓰지 않고 다음 개정판을 만들며, 두 검수를 다시 `pending`으로 둡니다.

## 4. 화면으로 보여 주기
```sh
npm run dev &        # 개발 서버(검수 미리보기는 개발 빌드에서만 동작)
npm run review:shots -- <id> [--frames 6] [--views front,side,first,hands]
```
- 결과: `work/screens/review-<id>-<view>.png`(시점마다 한 장, 시각 표시). 원본 영상 프레임은 찍지 않습니다.
- 그림을 사용자에게 보내고, 무엇이 바뀌었는지와 **검수자에게 확인할 것**을 짧게 씁니다. 옆 시점에서만 보이는 한계(단안 깊이)는 숨기지 않습니다.
- 사용자가 직접 보려면: `npm run dev` → `http://localhost:5173/?review=1`.

## 5. 기록과 동기화
- `docs/content-reviews/<내용>-<날짜>.md`에 후보 기록을 씁니다(기존 `course1-hq-candidates-2026-10-16.md` 형식: 기록 성격, 입력, 바뀐 점, 측정, 명령이 계산한 대상 해시 표, 검수자에게 확인할 것).
- 공개 저장소: 기록 문서와 코드만 커밋합니다. `private-data/`는 커밋하지 않습니다.
- 비공개 저장소와 맞춥니다: `cp -a private-data/<id>/. ../signlingo-private/private-data/<id>/` 뒤 비공개 저장소에서 커밋·푸시하고, `README.md`의 "검수 대기 후보" 줄을 고칩니다.
- 검증: `npm run typecheck && npm test && npm run build`.

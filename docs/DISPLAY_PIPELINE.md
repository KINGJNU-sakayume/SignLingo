# 표시 후처리 파이프라인 (`src/motion/display/`)

3D 시범을 **화면에 보여 주는 방식만** 바꾸는 계층입니다. 저장된 MotionClip, `public/content/assets/`의 공개 자산, 검수 기록과 MotionClip 스키마는 바꾸지 않습니다. 그래서 이 계층을 바꿔도 재검수가 필요하지 않습니다.

```
MotionClip (+ 시간 복원 결과) ──► baseFrames ──► [단계 1] ──► [단계 2] ──► … ──► DisplayClip
   저장값 · 수정 금지              editedPose()     순수 함수     순수 함수             표시용 프레임 + 프레임별 주석
```

## 불변식

- **입력은 읽기만 합니다.** 각 단계는 새 프레임을 만들어 돌려주고 입력 객체를 바꾸지 않습니다. 테스트에서 클립을 깊게 `freeze`해서 확인합니다.
- **표시 전용입니다.** 저장·내보내기, Practice 비교(`compareMotion`, `features`), 검수 진단(`inspection.json`), Motion Lab의 시간 복원 근거 패널은 모두 원래 클립과 원래 `pose.evidence`를 그대로 씁니다.
- **추정은 숨기지 않습니다.** 채워 넣은 손은 `filled`로 주석을 달고, 반투명 주황색으로 그리며, 범례 "추정으로 채운 손 모양"을 함께 보여 줍니다.
- `reconstruct.ts`의 200 ms 손 모양 유지 규칙, 시간 복원 알고리즘과 저장 데이터는 그대로입니다.

## 인터페이스 (`types.ts`)

| 타입 | 내용 |
| --- | --- |
| `DisplayInput` | `{ clip, temporal? }`. 시간 복원 결과는 Motion Lab에서만 넘깁니다. |
| `DisplayFrame` | `{ timestamp, segment, pose, annotation }`. `segment`는 `sequenceBoundary()`(장면 전환·150 ms 넘는 검출 공백)에서 바뀌며, 어떤 단계도 segment를 넘어 값을 잇지 않습니다. |
| `DisplayAnnotation` | `hands[side] = { state, fill?, anchors? }`. state는 `observed / interpolated / held / filled / missing`입니다. `torso?`(모드·편차·손목 잔차·팔꿈치 이동)와 이 프레임을 바꾼 단계 id 목록 `stages`가 붙습니다. |
| `DisplayClip` | `{ frames, stages, reports }`. `reports[stageId]`에 단계별 클립 단위 요약이 들어갑니다. |
| `DisplayStage` | `{ id, run(display, input) => DisplayClip }`. 클립 전체를 받습니다(통계와 양방향 필터에 필요). |

- `runDisplayPipeline(input, stages)`는 `baseFrames`에서 시작해 단계를 목록 순서대로 실행합니다. 기준 프레임에는 `editedPose()`(손목 수동 보정 반영)를 씁니다.
- `sampleDisplay(display, t)`는 `samplePose()`와 같은 규칙으로 보간합니다. 200 ms 넘는 간격, 몸통 없는 프레임, segment 경계에서는 보간하지 않습니다. 차이는 `filled` 손도 보간 대상이라는 점 하나입니다. 단계가 없으면 결과가 `samplePose()`와 정확히 같습니다(회귀 테스트).
- `displayPose(display, i)`는 Practice처럼 프레임 번호로 재생하는 화면에서 씁니다.
- `handFocus(displays)`는 "손 확대" 시점의 고정 구도입니다. 관측된 손목·손끝 위치의 5–95 백분위 상자를 씁니다. 카메라가 매 프레임 손을 따라가면 그 자체가 멀미를 일으키므로, 클립(또는 한 문제의 클립 묶음)마다 한 번만 정합니다.

### 새 단계 추가하기 (예: 제약 조건 보정)

```ts
const constraints: DisplayStage = {
  id: 'anatomical-constraints',
  run(display) {
    const frames = display.frames.map(frame => needsFix(frame) ? withPose(frame, fixed(frame.pose), 'anatomical-constraints') : frame);
    return { ...display, frames, reports: { ...display.reports, 'anatomical-constraints': summary } };
  },
};
runDisplayPipeline({ clip }, [stabilizeTorso(), constraints, fillHands()]);
```

`withPose()`가 주석에 단계 id를 남깁니다. 바꾸지 않은 프레임은 같은 객체를 그대로 돌려주면 됩니다. 새 단계에서도 위의 불변식(입력 불변, 표시 전용, 추정 표시)을 지킵니다. `tests/display-pipeline.test.ts`에 끼워 넣기 테스트가 있습니다.

## 단계 1 · 몸통 고정 `torso-stabilize` (멀미 방지)

1. 몸통이 있는 프레임(`quality.body > 0`)에서 torso 회전의 **기하 중앙값**(Weiszfeld)을 구합니다. 각 프레임의 편차를 구하고, 그 90번째 백분위를 변동량으로 씁니다.
2. 변동량이 **8° 이하**이면 추정 잡음으로 보고 중앙값 하나로 고정합니다(`fixed`). 더 크면 실제 몸 기울임이 섞였다고 보고, 시간 기반 1차 저역 통과(1 Hz)를 **앞으로 한 번, 뒤로 한 번** 적용합니다(`smoothed`). 두 방향의 지연이 서로 상쇄되므로 위상 지연이 없습니다.
3. root 위치도 같은 방식으로 처리합니다(중앙값, 1 cm 기준). 현재 복원기는 root를 항상 `[0, 1.3, 0]`으로 두므로 실제로는 바뀌지 않습니다.
4. 프레임마다 보정합니다.
   - 머리: `head' = q_s⁻¹ · q_o · head`. 월드 방향이 원래와 같습니다.
   - 팔: 먼저 `upper' = q_s⁻¹ · q_o · upper`를 적용합니다. 이 공식은 팔과 손의 **월드 방향**을 정확히 보존하지만 **위치**는 보존하지 않습니다. 어깨가 root에서 ±0.19 m 떨어져 있어서 torso가 θ만큼 바뀌면 어깨가 `2·0.19·sin(θ/2)`만큼 움직이고 손도 같이 움직이기 때문입니다. 양손은 서로 반대 방향으로 움직이므로, 손이 맞닿는 수어(예: ksl-meet "손이 맞닿아야 함")에서는 접촉이 벌어질 수 있습니다.
   - 그래서 보이는 팔은 **새 어깨에서 원래 손목 위치로** 고정 길이 2관절 IK(`solveArm`)를 다시 풉니다. 원래 팔꿈치를 굽힘 평면의 pole로 씁니다. 원래 손바닥의 월드 방향은 `distributeForearmRoll`로 다시 붙입니다(복원기와 같은 roll 배분이며, 시간 복원의 `bridgePose`와 같은 방식입니다). 손가락은 손바닥 기준 회전이라 그대로 둡니다.
   - 결과적으로 손목 위치, 손바닥 방향과 모든 손가락 끝이 원래 복원값과 같고 팔꿈치만 조금 움직입니다. 고정 팔 길이 때문에 손목에 닿지 못하는 프레임은 잔차를 주석(`wristResidual`)과 보고서에 남깁니다.
   - 팔이 숨겨진 쪽은 공식만 적용합니다. 몸통이 없는 프레임은 같은 segment에서 가장 가까운 안정 torso를 씁니다.

### 공개 코스 1 측정값

`displayFor(clip, 'learner')` 결과입니다. `tests/display-pipeline.test.ts`가 같은 값을 읽기 전용으로 확인합니다.

| 클립 | 변동량(p90) | 모드 | 표시 torso의 최대 편차 | 손목 잔차 최대 | 팔꿈치 이동 최대 | 프레임 간 torso 흔들림 (deg², 전→후) | 채운 손 (왼손 / 오른손: 앞·중간·뒤) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ksl-thanks | 6.5° | fixed | 9.2° | 1.5 mm | 3.5 cm | 2.87 → 0 | 38·0·31 / 35·8·29 |
| ksl-sorry | 18.4° | smoothed | 5.7° | 1.5 mm | 3.8 cm | 6.44 → 0.36 | 42·12·26 / 29·14·4 |
| ksl-meet | 4.2° | fixed | 7.2° | 0 | 2.4 cm | 1.51 → 0 | 5·5·5 / 2·4·5 |

- 공식만 썼다면 손이 쪽마다 최대 2.8 / 6.5 / 2.3 cm 움직였을 것입니다.
- IK 보정을 쓰면 양손이 모두 관측된 프레임에서 두 검지 끝 사이 거리 변화가 2 mm보다 작습니다. ksl-meet에서는 수치 오차 수준(10⁻¹⁵ m)입니다.

## 단계 2 · 손 채우기 `hand-fill`

팔이 보이는데 손이 `held` 또는 `missing`인 프레임을 채웁니다(손가락이 없는 시간 보간 프레임은 손가락만 채웁니다).

| 구간 | 채우는 값 | 주석 |
| --- | --- | --- |
| 첫 관측 이전 | 첫 관측 손 모양 | `fill: 'lead'` |
| 마지막 관측 이후 | 마지막 관측 손 모양 | `fill: 'trail'` |
| 중간 공백 | 앞뒤 관측 손 모양을 시간 비율 t로 slerp | `fill: 'gap'`, `anchors` |

- **손 모양**은 손가락 15개의 회전과 **손목의 상대 회전**입니다.
- 상대 회전은 roll을 뺀 아래팔 프레임 기준입니다. 이 프레임은 팔 형상에서 `solveArm`과 같은 방식(`boneQuaternion(아래팔 방향, 위팔×아래팔)`)으로 다시 계산합니다. 채운 뒤에는 `distributeForearmRoll`로 아래팔 roll과 손목에 다시 나눕니다. 따라서 손은 팔의 움직임을 따라가고, 손목 끝 위치는 바뀌지 않습니다.
- 기준(anchor)은 관측된 손입니다(시간 보간 손은 손가락까지 있을 때만 씁니다). segment를 넘지 않고, 팔이 숨겨진 프레임은 채우지 않습니다.
- `reconstruct.ts`의 200 ms 유지 규칙과 저장된 `held` 상태는 그대로이며, Motion Lab 진단 패널은 원래 상태(예: "임시 유지")를 그대로 보여 줍니다.

## 화면별 적용 (`presets.ts`)

| 화면 | preset | 단계 |
| --- | --- | --- |
| 레슨(`LessonPlayer`), 표현 카드(`LessonDetail`), 로컬 학습 흐름 점검 | `learner` | 몸통 고정 → 손 채우기 |
| Practice 기준 아바타 | `learner` | 몸통 고정 → 손 채우기 |
| Practice 내 시도 아바타 | `attempt` | 몸통 고정만. 추적 공백이 그대로 보여야 피드백과 맞습니다. |
| Motion Lab | `lab-original` (기본) / `lab-stabilized` | 기본은 원본 그대로입니다. "몸통 고정" 체크박스로 켤 수 있고, 기술 진단 모드에서는 꺼집니다. 손 채우기는 쓰지 않습니다. |

`displayFor(clip, preset)`는 클립 객체마다 결과를 캐시합니다(불러온 클립은 바꾸지 않으므로).

## 파이프라인 밖의 표시 옵션 (`components/Avatar.tsx`)

- **상반신만** 그립니다. 다리·골반·바닥 격자와 그림자는 그리지 않습니다.
- 시점
  - **정면 / 측면**: 상반신 중심 구도입니다.
  - **1인칭**: 눈 바로 아래(y 1.47)에서 수어 공간을 앞쪽 아래로 내려다봅니다. 머리와 목은 숨깁니다. 방위 ±20°, 극각 ±12°만 돌릴 수 있고 이동·확대는 막습니다. 카메라가 +z를 보므로 해부학적 오른손이 화면 오른쪽에 옵니다. 실제 시야와 마찬가지로 이마·얼굴 근처의 동작(예: ksl-sorry의 이마 위치)은 1인칭에서 보이지 않으므로 정면·측면과 함께 봅니다.
  - **손 확대**: `handFocus` 구도를 씁니다.
- **거울 모드**는 학습자 설정입니다(학습 저장소 `settings.mirror`, 기기별, 기본 꺼짐). 장면을 x축으로 반사해 렌더링할 뿐 포즈·색·해부학적 좌우·Practice 비교는 바뀌지 않습니다. 1인칭에는 적용하지 않습니다. 켜져 있으면 "거울 모드" 배지가 시범 위에 항상 보입니다.

## 테스트와 스크린샷

- `tests/display-pipeline.test.ts`
  - 흔들림을 넣은 합성 클립에서 torso 분산이 줄어드는지(고정·평활 두 경로, 평활은 위상 지연 없음)
  - 손목·손끝 월드 위치와 손바닥 방향이 보존되는지
  - 첫 등장 전·중간 공백·마지막 이후가 채워지는지
  - 입력이 바뀌지 않는지, 단계를 끼워 넣을 수 있는지, `samplePose`와 같은 결과인지
  - 공개 코스 1 측정값
- 브라우저 테스트(`tests/browser/content.spec.ts`, `learn.spec.ts`, `app.spec.ts`): 시점 버튼, 거울 모드 배지와 유지, 설명 위치(390 px), 채점 문항의 설명 공개 시점, A–B 반복, Motion Lab 기본값
- 디자인 캡처: `SCREENSHOTS=1 npx playwright test screens`. 표현 카드의 정면·측면·1인칭·손 확대가 포함됩니다.
- 검수 미리보기(`npm run dev` → `/?review=1`)는 무시 대상인 `private-data/`의 패키지를 같은 화면과 같은 `learner` preset으로 보여 줍니다.

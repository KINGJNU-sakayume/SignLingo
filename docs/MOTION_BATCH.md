# 동작 일괄 처리와 파이프라인 0.3.0

영상 여러 개를 Motion Lab과 **같은 처리 경로**로 한 번에 처리하고, 클립마다 추적 지표를 보고서로 남깁니다. 파이프라인 0.2.0과 0.3.0을 같은 조건에서 비교할 수도 있습니다. 결과는 추적·표시 지표일 뿐이며, 한국수어로서 맞는지는 알려 주지 않습니다. 촬영 방법은 [촬영 안내](RECORDING_GUIDE.md)를 봅니다.

## 명령

| 명령 | 하는 일 | 결과 위치 |
| --- | --- | --- |
| `npm run motion:batch -- <영상 또는 폴더...> --out <폴더> [--hz 30\|15] [--pipeline 0.3.0\|0.2.0] [--mirrored]` | 영상마다 MotionClip JSON을 만듭니다 | `<폴더>/<영상 이름>.motion.json`, `work/batch-report.json`, `work/batch-report.md` |
| `npm run motion:compare -- <영상 폴더 또는 영상...> [--hz 30\|15] [--mirrored]` | 영상마다 0.2.0과 0.3.0을 모두 실행하고 비교표를 만듭니다 | `work/compare/0.2.0/`, `work/compare/0.3.0/`, `work/compare-report.json`, **`work/compare-report.md`** |
| `npm run motion:report -- <motion.json 또는 폴더...>` | 이미 있는 JSON의 지표만 계산합니다(추론 없음) | `work/motion-report.json`, `work/motion-report.md` |

- 기본값은 30 Hz, 파이프라인 0.3.0, 좌우 반전 없음입니다. 보고서 경로는 `--report <파일>.json`으로 바꿀 수 있으며, 같은 이름의 `.md`도 함께 만듭니다.
- 폴더를 주면 그 안의 `.mp4`/`.webm`(report는 `.json`)을 이름순으로 처리합니다. 하위 폴더는 보지 않습니다. Windows 셸은 `*.mp4`를 펼치지 않으므로 폴더를 주는 쪽이 편합니다.
- `--mirrored`는 **저장된 파일**이 좌우 반전된 경우에만 씁니다. 목록의 모든 영상에 똑같이 적용되므로, 반전 여부가 다른 영상은 따로 실행합니다.
- 영상 하나가 실패해도 나머지는 계속 처리하고, 실패 내용은 보고서에 남깁니다. 실패가 하나라도 있으면 종료 코드는 1입니다.
- 출력 JSON의 `source.name`·`source.size`는 원본 파일과 같습니다. 도구가 내보낸 직후 `importMotion`으로 다시 읽고 이 두 값을 확인합니다(`content prepare`와 같은 검사).

## 준비 (Windows · macOS · Linux)

```sh
npm ci
npx playwright install chromium    # 처음 한 번
npm run motion:compare -- private-data/videos
```

- Node 22.12 이상(CI는 Node 24)이 필요합니다. 셸 스크립트를 쓰지 않으므로 Windows PowerShell, macOS 터미널, Linux에서 같은 명령으로 실행됩니다.
- **H.264 MP4**: Playwright의 Chromium은 특허 코덱을 디코딩하지 못합니다. MP4가 "could not decode"로 실패하면 설치된 Chrome이나 Edge를 씁니다: `--channel chrome`(또는 `--channel msedge`). WebM(VP8/VP9)은 기본 Chromium으로 됩니다.
- 다른 Chromium을 쓰려면 `CHROMIUM_PATH=<실행 파일 경로>`를 지정합니다.
- 프록시 뒤에서는 Node 내장 fetch가 프록시 변수를 읽도록 `NODE_USE_ENV_PROXY=1`을 함께 설정합니다(모델을 처음 받을 때만 필요).

## 같은 처리 경로와 로컬 전용 실행

- Motion Lab의 "동작 추출 및 복원"과 일괄 처리는 같은 함수 `extractMotion()`(`src/motion/extract.ts`)을 부릅니다. 그 아래 `processVideo` → `MediaPipeDetector`(worker) → `Reconstructor` → `exportMotion`도 같습니다.
- 도구는 처리용 페이지(`src/batch/harness/`)를 앱과 같은 Vite 워커 설정으로 `work/motion-tool/`에 빌드합니다. 이 페이지를 `127.0.0.1`에서 띄우고 헤드리스 Chromium으로 엽니다. 영상은 파일 입력으로 넘기므로 브라우저가 보는 파일 이름과 크기가 원본과 같습니다. 이 페이지는 배포 빌드(`dist/`)에 들어가지 않습니다.
- 모델 URL은 캐시된 파일로, Tasks Vision WASM URL은 `node_modules/@mediapipe/tasks-vision/wasm`(package-lock으로 고정된 1.1.0)으로 답합니다. **그 밖의 외부 요청은 모두 차단**하므로 영상과 랜드마크가 컴퓨터 밖으로 나가지 않습니다. 실행해 보면 MediaPipe가 `odml.pa.googleapis.com/v1/log`로 사용 기록을 보내려 하는데, 이 요청도 차단되고 실행 끝에 개수가 출력됩니다.

## 모델 캐시와 SHA-256

- README에 고정된 두 모델 URL에서 처음 한 번 받아 `work/models/`에 저장합니다(git 제외).
- 처음 받을 때 `work/models/models.lock.json`에 URL, 크기, SHA-256, 받은 시각을 기록합니다. 이후 실행은 캐시 파일을 그 기록과 대조합니다. 파일이 없어 다시 받는 경우에도 기록과 대조합니다. **다르면 실행을 멈춥니다.**
- 모델을 의도적으로 바꿀 때만 `work/models/`를 지우고 다시 받습니다.
- 이 저장소 작업 중(2026-10-14) 처음 받은 값은 다음과 같습니다. 로컬 기록과 다르면 원인을 확인하세요.

| 모델 | 크기 | SHA-256 |
| --- | ---: | --- |
| `pose_landmarker_full.task` (float16/1) | 9,398,198 B | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| `hand_landmarker.task` (float16/1) | 7,819,105 B | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |

## 보고서 항목

| 항목 | 정의 |
| --- | --- |
| 프레임 수 | 저장된 프레임 수 |
| 좌·우 손 누락률 | 저장된 손 상태가 `tracked`가 아닌 프레임(held 포함) ÷ 전체 프레임 |
| held | 복원기가 마지막 손 모양을 ≤200 ms 유지한 프레임(신뢰도 0) |
| 누락 원인 | `torso`(몸통 없음), `arm`(팔 랜드마크 불확실), `degenerate`(손바닥·손가락 형상 퇴화), `ambiguous`(교차 손목에서 신원 불확실), `no-detection`(검출된 손 없음), `unassociated`(검출됐지만 손목과 연결 안 됨) |
| 영역 재검출로 추적 | 추적된 프레임 중 배정된 손이 영역 재검출(0.3.0)에서 온 프레임 |
| 경고 종류별 개수 | 경고 문장을 종류(`unusual-articulation`, `hand-held` 등)로 묶은 개수. 한 프레임에 같은 종류가 여러 번 나올 수 있습니다. |
| 보정 횟수 | 저장된 관절 보정 기록 수와 종류별 개수(예: `reach-clamp-meters`) |
| 보간 | `displayFor(clip, 'learner')`에서 시간 복원이 앞뒤 관측 사이를 메운 프레임(0.3.0 클립) |
| 채움 앞·중간·뒤 | 같은 학습자 표시에서 손 채우기가 첫 관측 전·관측 사이·마지막 관측 후를 추정으로 채운 프레임. 보간과 겹치지 않습니다. |

보고서에는 랜드마크가 들어가지 않지만, 비공개 원본에서 나온 파생 자료이므로 커밋하거나 공유하지 않습니다.

## 파이프라인 0.3.0

복원기(풀이)는 0.2.0과 같습니다. 바뀐 것은 **손 검출**과 **학습자 표시의 시간 복원 기본 적용**입니다.

### 손 영역 재검출 (`src/motion/handRegions.ts`)

1. 프레임마다 먼저 기존처럼 전체 화면에서 Pose와 Hand를 검출합니다(VIDEO 모드, 0.2.0과 같은 960 px 분석 화면).
2. 각 손목에 대해 pose 손목·팔꿈치 랜드마크로 손 영역(정사각형)을 예측합니다.
   - 크기 = `sizeToForearm` × 팔뚝 길이(화면 픽셀, 가로세로 비율 반영). 팔이 카메라 쪽을 향해 짧아 보이면 어깨 너비 × `minShoulderFraction`을 하한으로 씁니다.
   - 중심 = 손목 + `centerAlongHand` × 팔뚝 길이만큼 손 방향. 방향은 pose의 새끼·검지 랜드마크가 보이면 그쪽, 아니면 팔꿈치→손목입니다.
   - 화면 안에 들어가면 안쪽으로 밀어 넣고, 화면보다 크면 검은 여백을 둡니다.
3. 그 영역을 디코딩된 원본 프레임(최대 1920 px)에서 잘라 `cropSize` px로 확대합니다. 그다음 별도의 IMAGE 모드 HandLandmarker로 다시 검출합니다. 영역이 매 프레임 움직이므로 VIDEO 모드 추적은 쓰지 않습니다.
4. 결과 좌표를 원본 좌표계로 되돌립니다: `x = (x0 + x'·s)/W`, `y = (y0 + y'·s)/H`, `z = z'·s/W`. 월드 좌표(미터, 손 중심)는 그대로 씁니다.
5. **융합**
   - 전체 화면 결과와 영역 결과를 handedness 점수 순으로 정렬합니다. 점수가 같으면 전체 화면 결과가 앞섭니다.
   - 이미 고른 손과 같은 손이면 버립니다. 같은 손의 기준: 21개 랜드마크의 평균 거리가 손바닥 길이의 `sameHand` 배 미만입니다. 손 라벨이 다르면 `sameHandOppositeLabel` 배 미만이어야 합니다.
   - 상자 겹침(IoU)은 쓰지 않으므로 서로 닿은 두 손은 둘 다 남습니다. 최대 2개를 남깁니다.
   - 두 추정을 평균하지 않습니다. 평균은 어느 모델도 본 적 없는 손을 만듭니다.
6. 왼손·오른손 배정은 바꾸지 않았습니다. 융합된 손은 기존 `tracking.ts`의 손목 연관 규칙을 그대로 거칩니다(손목 거리, 교차 시 보류).

기록되는 값(`clip.pipeline.handRegions`, 기본값):

| 파라미터 | 값 | 의미 |
| --- | --- | --- |
| `method` | `pose-forearm-roi-v1` | 영역 예측 방식 |
| `cropSize` | 320 | 확대한 잘라낸 영역의 한 변(px) |
| `sizeToForearm` | 1.6 | 영역 한 변 ÷ 팔뚝 길이 |
| `centerAlongHand` | 0.35 | 손목에서 손 쪽으로 옮긴 중심(팔뚝 길이 배) |
| `minShoulderFraction` | 0.55 | 팔뚝 길이 하한(어깨 너비 배) |
| `minWristConfidence` / `minGuideConfidence` | 0.3 / 0.3 | 손목 / 팔꿈치·어깨·손가락 랜드마크 신뢰도 하한 |
| `minRegionPixels` | 32 | 이보다 작은 영역은 건너뜀 |
| `cropSourceMaxDimension` | 1920 | 잘라낼 원본 프레임의 긴 변 상한 |
| `fusion` | `max-score-landmark-nms`, 0.35, 0.15, 최대 2 | 위 융합 규칙 |
| `landmarker` | IMAGE, 손 2개, 검출·존재 신뢰도 0.5 | 영역 검출기 설정 |

### 기록과 호환성

- 스키마는 1 그대로입니다. 0.3.0 클립에는 `pipeline.version: "0.3.0"`, `pipeline.handRegions`, `pipeline.temporal`(학습자 표시 정책)이 붙습니다. 손마다 `origin: "frame" | "region"`도 붙습니다. 모두 선택 필드라서 이전 앱은 무시하고 읽습니다.
- 0.1.0/0.2.0 클립은 읽기·재생·손목 보정 의미가 그대로입니다. 공개된 v1 자산은 바꾸지 않았습니다.
- Motion Lab의 추출은 이제 0.3.0입니다. Practice(학습자 녹화 분석)는 휴대폰 처리 시간을 늘리지 않도록 0.2.0 그대로입니다.
- 비용: 손 검출이 프레임당 최대 세 번(전체 1 + 영역 2) 돕니다. 아래 스모크 실행에서 추론 처리량은 약 2–2.5배 느려졌습니다.

### 학습자 표시의 시간 복원

`learner` preset의 첫 단계로 시간 복원을 넣었습니다: 시간 복원 → 몸통 고정 → 손 채우기. 적용 조건은 다음과 같습니다.

- `pipeline.temporal`이 있음(0.3.0)
- `sampleHz ≥ 15`
- 프레임 3–1800개

그래서 공개 v1(0.2.0)은 검수받은 화면 그대로입니다. `attempt` preset, 저장 JSON, Practice 비교, Motion Lab에는 넣지 않았습니다. 자세한 내용은 [표시 후처리](DISPLAY_PIPELINE.md)에 있습니다.

### 한계

- 영역은 pose 손목이 있어야 예측됩니다. 팔 랜드마크가 불확실한 프레임은 손을 찾아도 복원기가 팔을 숨기므로 나아지지 않습니다. 보고서의 누락 원인 `arm`이 이 경우입니다.
- handedness 점수는 분류 점수일 뿐, 위치 정확도가 아닙니다. 융합 순서를 정하는 대리 지표로만 씁니다.
- 손이 얼굴이나 다른 손 앞을 지나는 프레임, 움직임 번짐이 큰 프레임은 확대해도 복원되지 않을 수 있습니다.

## 로컬 평가 절차 (0.2.0 vs 0.3.0)

`private-data/`는 저장소와 CI에 없습니다. 실제 영상 평가는 로컬에서만 합니다.

1. 영상을 `private-data/videos/`에 둡니다(커밋 금지).
2. `npm run motion:compare -- private-data/videos`를 실행합니다. 반전된 영상이 섞여 있으면 반전 여부별로 나눠 두 번 실행합니다(`--report`로 이름을 다르게).
3. `work/compare-report.md`의 표에는 클립별 좌·우 손 누락률, held, 학습자 표시의 보간·채움(앞·중간·뒤)이 들어 있습니다. 이 표를 PR의 "로컬 실행 대기" 칸에 붙입니다. 클립 이름에 실명이 없는지 먼저 확인합니다.
4. 코스 1의 revision 2 후보는 `npm run motion:batch -- <코스 1 원본 3개> --out private-data/exports/rev2-candidates`로 만들어 비공개로 보관합니다. `content prepare`, 검수 기록, 단계 전환, 공개는 검수를 시작할 때 따로 합니다([콘텐츠 준비·검수·공개](CONTENT_PUBLISHING.md)).

공개된 v1의 0.2.0 기준값은 저장소 안에서 바로 계산할 수 있습니다.

```sh
npm run motion:report -- public/content/assets/ksl-thanks/v1/reference.motion.json public/content/assets/ksl-sorry/v1/reference.motion.json public/content/assets/ksl-meet/v1/reference.motion.json
```

| 클립 (v1, 0.2.0) | 프레임 | 왼손 누락률 | 오른손 누락률 | held 왼/오 | 검출된 손이 없는 프레임 | 채움 왼손 앞·중간·뒤 | 채움 오른손 앞·중간·뒤 |
| --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| ksl-thanks | 120 | 57.5% | 60.0% | 5 / 14 | 63 | 38·0·31 | 35·8·29 |
| ksl-sorry | 101 | 80.2% | 49.5% | 14 / 18 | 37 | 42·12·26 | 29·14·4 |
| ksl-meet | 111 | 46.8% | 46.8% | 10 / 9 | 50 | 5·5·5 | 2·4·5 |

## 공개 사진 스모크 실행 (엔지니어링 확인, 수어 아님)

실제 MediaPipe가 이 도구 안에서 동작하는지 확인했습니다. 재료는 공개 MediaPipe 사진 `male_full_height_hands.jpg`를 ffmpeg로 3초 VP9 영상(700×466, 좌우로 천천히 이동)으로 만든 것입니다. 정지한 사람이라 **수어 동작이나 실제 촬영 영상에 대한 근거가 아닙니다.** 환경은 관리형 Linux, 헤드리스 Chromium 141, CPU 추론입니다. 영상과 결과는 `work/`에만 있고 커밋하지 않았습니다.

| 영상(사람 크기) | 0.2.0 왼손 / 오른손 누락률 | 0.3.0 왼손 / 오른손 누락률 | 0.3.0에서 영역 재검출로 추적(왼/오) | 추론 처리량 0.2.0 → 0.3.0 |
| --- | --- | --- | --- | --- |
| 상반신 확대 | 0% / 0% | 0% / 0% | 46 / 1 | 3.9 → 1.8 FPS |
| 전신의 80% | 0% / 0% | 0% / 0% | 26 / 3 | 4.5 → 1.8 FPS |
| 전신(손 작음) | 60.0% / 0% | 0% / 0% | 82 / 19 | 4.1 → 1.9 FPS |
| 전신, 더 작게 | 100% / 0% | 0% / 0% | 90 / 33 | 3.8 → 1.7 FPS |
| 상반신 1080p | 0% / 0% | 0% / 0% | 0 / 0 | 3.5 → 1.8 FPS |

0.3.0에서 새로 추적된 손의 손목은 pose 손목에서 중앙값 약 2 px 떨어져 있었습니다. 0.2.0 실행 결과는 이전 Motion Lab 내보내기와 같은 필드(`version`, `detector`, `models`)만 가졌습니다. H.264 MP4는 기본 Chromium에서 디코딩 오류가 났고, 도구가 `--channel chrome` 안내를 출력했습니다.

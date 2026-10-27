# 로컬 추출기 (본체 PC에서 레퍼런스 동작 만들기)

브라우저 밖, 운영자 PC에서 레퍼런스 영상의 랜드마크를 뽑고, 그 결과를 Motion Lab과 **같은 복원기**로 MotionClip으로 바꿉니다. 영상과 랜드마크는 PC 밖으로 나가지 않습니다(모델을 처음 받을 때만 인터넷이 필요합니다).

```
영상(.webm/.mp4/.mov) ──► tools/extract/extract.py ──► <이름>.detections.json ──► npm run motion:import ──► <이름>.motion.json ──► content prepare
                          (Python, MediaPipe 1.1.0)      (signlingo.detections v1)    (Motion Lab 복원기 0.2.0)   (Motion Lab 내보내기와 같은 형식)
```

## 무엇이 다른가 (브라우저 `motion:batch`와 비교)

| | 브라우저(`motion:batch`, Motion Lab) | 로컬 추출기 |
| --- | --- | --- |
| 실행 | 헤드리스 Chromium, MediaPipe Tasks Vision 1.1.0(WASM, CPU) | Python, MediaPipe 1.1.0(같은 버전의 Python 판) |
| 몸 모델 | pose_landmarker **full** | **heavy**(기본) 또는 full |
| 손 모델 | hand_landmarker | 같음 |
| 분석 크기 | 긴 변 960 px | 긴 변 **1920 px**(기본, `--max-dimension 0`이면 원본) |
| 디코딩 | 브라우저(H.264는 Chrome 필요, HEVC 불가) | OpenCV(**iPhone HEVC `.mov`를 변환 없이** 엶) |
| 복원 | 0.2.0 | 같은 복원기(`motion:import`), 파이프라인 0.2.0으로 기록 |
| 기록 | `pipeline.detector = mediapipe-tasks-vision@1.1.0` | `pipeline.detector = mediapipe-python@1.1.0/pose-heavy`, 모델 URL |

**정직한 측정 결과(2026-10-27, 코스 1 고화질 재촬영 3개, 30 Hz)**: 손 누락률은 브라우저와 비슷했습니다. 손 모델이 같기 때문입니다.

| 클립 | 브라우저 0.2.0 (full, 960 px) | 로컬 heavy, 1920 px 상한 | 로컬 full, 960 px |
| --- | --- | --- | --- |
| 고맙다 | 4.4% / 17.6% | 4.4% / 18.7% | 4.4% / 18.7% |
| 미안 | 8.0% / 11.4% | 1.1% / 18.2% | 1.1% / 17.0% |
| 만나다 | 24.6% / 24.6% | 24.6% / 26.2% | 23.1% / 26.2% |

(손 누락률 왼/오, 클립 전체. 같은 모델 설정에서도 디코딩·축소 방식 차이로 프레임마다 결과가 조금 다릅니다.) 따라서 이 도구의 지금 이점은 **품질 향상이 아니라** 작업 흐름입니다: `.mov`를 바로 처리, 브라우저 없이 일괄 처리, 그리고 앞으로 다른 추출기(RTMW, WiLoR 등)를 같은 형식으로 끼워 넣을 자리.

## 설치 (Windows, 한 번)

1. [Python 3.12](https://www.python.org/downloads/windows/)를 설치합니다("Add python.exe to PATH" 체크).
2. Node 22.12 이상과 저장소는 이미 있다고 가정합니다(`npm ci`).
3. 저장소 폴더의 PowerShell에서:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r tools\extract\requirements.txt
```

macOS·Linux는 `python3 -m venv .venv` 뒤 `.venv/bin/python -m pip install -r tools/extract/requirements.txt`입니다. 헤드리스 Linux(WSL 포함)에서 `libEGL.so.1`이 없다는 오류가 나면 `sudo apt-get install -y libegl1 libgles2`를 설치합니다.

## 사용

```powershell
# 1. 랜드마크 추출 (모델은 처음 한 번 work\models\에 받고 SHA-256을 확인합니다)
.venv\Scripts\python tools\extract\extract.py private-data\videos-hq\ksl-okay.mov --out private-data\exports\local
#    옵션: --hz 30|15  --pose heavy|full  --max-dimension 1920(0=원본)  --mirrored(저장 파일이 반전된 경우만)  --delegate cpu|gpu

# 2. MotionClip으로 복원 (원본 영상의 이름·크기·SHA-256 확인, 제약 조건은 선택)
npm run motion:import -- private-data\exports\local --out private-data\exports\local\motion --videos private-data\videos-hq [--constraints docs\constraints]

# 3. 결과 확인: work\import-report.md (motion:batch와 같은 표: 누락률, 화면 밖/안 실패, held, 채움)

# 4. 검수 패키지 준비 (권리 기록의 원본 해시와 같은 파일이어야 합니다)
npm run content -- prepare private-data\ksl-okay private-data\videos-hq\ksl-okay.mov private-data\exports\local\motion\ksl-okay.motion.json
```

- 이어지는 검수·공개는 Claude Code 스킬 `review-candidate` → `approve-publish`로 합니다. PC에 Claude Code CLI를 설치하면 같은 스킬을 로컬에서도 씁니다.
- `content prepare`는 동작의 `source.name`·`source.size`가 넘긴 영상과 같아야 받아 줍니다. 추출에 쓴 파일(예: `.mov` 원본)과 이용 허락 기록의 해시 파일이 같아야 합니다. 이전처럼 VP9 WebM으로 변환해서 권리 기록을 남겼다면 그 WebM으로 추출합니다.
- 결과 파일(`*.detections.json`, `*.motion.json`)은 비공개 파생 자료입니다. `.gitignore`에 있으며 공개 저장소에 커밋하지 않습니다.

## GPU (NVIDIA)

- `--delegate gpu`는 MediaPipe의 GPU 위임을 시도하고, 실패하면 CPU로 다시 실행합니다. MediaPipe Python의 GPU 위임은 Linux(OpenGL ES) 중심이라 **Windows에서는 대개 CPU로 돌아갑니다**. MediaPipe heavy는 CPU에서도 오프라인 처리에 충분히 빠릅니다(이 저장소 환경에서 3초 영상 약 6–8초).
- NVIDIA GPU가 실제로 쓰이는 것은 PyTorch 기반 추출기(RTMW·SDPose 2D, WiLoR·HaMeR 3D 손)를 붙일 때입니다. 그때는 WSL2 Ubuntu + CUDA를 쓰는 것을 권합니다. 같은 `signlingo.detections` 형식만 쓰면 `motion:import` 이후는 그대로입니다(아래).

## `signlingo.detections` v1 (다른 추출기를 붙일 때)

`src/motion/external.ts`의 스키마가 원본입니다. `LandmarkDetector`가 브라우저에서 돌려주는 `Detection`과 같은 계약입니다.

```jsonc
{
  "format": "signlingo.detections", "version": 1,
  "detector": "mediapipe-python@1.1.0/pose-heavy",          // MotionClip pipeline.detector로 기록
  "models": { "pose": "<URL>", "hand": "<URL>" }, "modelSha256": { ... },   // 선택
  "source": { "name": "ksl-okay.mov", "size": 123, "sha256": "...", "duration": 3.03, "timeOffset": 0,
              "width": 1180, "height": 1540, "mirrored": false, "sampleHz": 30 },
  "analysis": { ... },                                       // 자유 기록(MotionClip에는 들어가지 않음)
  "frames": [ { "timestamp": 0,                              // ms, 0부터 엄격히 증가
                "body": [33개 {x,y,z,visibility?,presence?}], // 정규화 이미지 좌표(반전 해제된 픽셀 기준), 없으면 []
                "bodyWorld": [33개],                          // 추정 월드 미터(MediaPipe pose world)
                "hands": [ { "image": [21개], "world": [21개], "label": "Left", "score": 0.98 } ],  // 최대 2개
                "discontinuity": "cut" } ]                   // 선택: 장면 전환
}
```

- 관절 번호는 **MediaPipe pose 33점과 손 21점**입니다. 다른 관절 규약의 모델(COCO-WholeBody 133점 등)은 이 번호로 바꿔 써야 합니다. 손 21점은 COCO-WholeBody 손과 순서가 같고, 몸은 일부 점만 대응합니다.
- 복원기에는 **월드 좌표(미터)**가 필요합니다(`bodyWorld`, 손 `world`). 2D만 내는 모델(RTMW 2D 등)은 그대로 쓸 수 없고, 깊이 추정 단계(3D 변형 모델이나 별도 lifting)를 거쳐야 합니다. 이것이 다음 단계의 핵심 작업입니다.
- 손의 `label`(Left/Right)은 MediaPipe와 같은 규칙이어야 하지만, 좌우 배정은 pose 손목 거리로 하고 label은 약한 보조로만 씁니다(`src/motion/tracking.ts`).
- 같은 영상의 다른 추출기 결과를 비교하려면 둘 다 `motion:import`로 바꾼 뒤 `npm run motion:report -- <폴더들>`로 같은 표를 만듭니다.

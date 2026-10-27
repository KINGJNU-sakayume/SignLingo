# 로컬 추출기 (본체 PC에서 레퍼런스 동작 만들기)

브라우저 밖, 운영자 PC에서 레퍼런스 영상의 랜드마크를 뽑고, 그 결과를 Motion Lab과 **같은 복원기**로 MotionClip으로 바꿉니다. 영상과 랜드마크는 PC 밖으로 나가지 않습니다(모델을 처음 받을 때만 인터넷이 필요합니다).

```
영상(.webm/.mp4/.mov) ──► tools/extract/extract.py ──► <이름>.detections.json ──► npm run motion:import ──► <이름>.motion.json ──► content prepare
                          (Python, --backend 아래 3종)   (signlingo.detections v1)    (Motion Lab 복원기 0.2.0)   (Motion Lab 내보내기와 같은 형식)
```

| `--backend` | 몸 | 손 | 필요한 것 | 라이선스 |
| --- | --- | --- | --- | --- |
| `mediapipe`(기본) | MediaPipe pose heavy/full | MediaPipe hand(브라우저와 같음) | Python 3.12, CPU | Apache-2.0 |
| `wilor` | MediaPipe pose heavy/full | **WiLoR**(CVPR 2025) 3D 손 | Python 3.10, PyTorch(NVIDIA 권장), 직접 받은 `MANO_RIGHT.pkl` | WiLoR 가중치 CC BY-NC-ND, MANO 비상업 |
| `sam3d` | **SAM 3D Body** | SAM 3D Body 손 디코더 | Python 3.11, **CUDA GPU**, Hugging Face 접근 승인 | SAM License(상업 이용 허용, 제한 조항) |

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

(손 누락률 왼/오, 클립 전체. 같은 모델 설정에서도 디코딩·축소 방식 차이로 프레임마다 결과가 조금 다릅니다.) 따라서 `mediapipe` 백엔드의 이점은 **품질 향상이 아니라** 작업 흐름입니다(`.mov`를 바로 처리, 브라우저 없이 일괄 처리). 손 품질을 바꿀 수 있는 것은 손 모델이 다른 `wilor`·`sam3d`입니다(아래).

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
#    옵션: --backend mediapipe|wilor|sam3d  --hz 30|15  --pose heavy|full  --max-dimension 1920(0=원본)  --mirrored(저장 파일이 반전된 경우만)  --delegate cpu|gpu

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
- NVIDIA GPU가 실제로 쓰이는 것은 PyTorch 기반 백엔드(`wilor`, `sam3d`)입니다. 아래처럼 **WSL2 Ubuntu + CUDA**에서 백엔드마다 따로 가상 환경을 만듭니다(파이썬 버전과 PyTorch 버전이 서로 다릅니다).

## 고급 백엔드: `wilor`, `sam3d`

둘 다 프레임마다 독립적으로 추론합니다(시간 모델 없음). 좌우 배정, 짧은 공백 처리, 표시 계층은 MediaPipe와 똑같이 SignLingo 쪽에서 합니다. 출력 좌표는 `tools/extract/convert.py`가 MediaPipe 순서(pose 33, 손 21)로 바꿉니다.

**공통 준비(WSL2)**: Windows에 최신 NVIDIA 드라이버를 깔고, PowerShell에서 `wsl --install -d Ubuntu`. Ubuntu 안에서 저장소를 클론하거나 `/mnt/c/...` 경로로 엽니다. `sudo apt-get install -y libegl1 libgles2 git`.

### `wilor` (MediaPipe 몸 + WiLoR 손)

```bash
uv venv -p 3.10 .venv-wilor   # 또는 python3.10 -m venv .venv-wilor
.venv-wilor/bin/pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121
.venv-wilor/bin/pip install -r tools/extract/requirements-wilor.txt
.venv-wilor/bin/python tools/extract/extract.py private-data/videos-hq/*.webm --out private-data/exports/wilor \
  --backend wilor --mano ~/MANO_RIGHT.pkl
```

- `MANO_RIGHT.pkl`은 https://mano.is.tue.mpg.de 에 가입하고 라이선스에 동의한 뒤 받습니다. 인터넷의 제3자 사본은 쓰지 않습니다(WiLoR-mini 패키지가 자동으로 받는 사본도 쓰지 않도록, 추출기가 받은 파일을 그 폴더에 먼저 넣습니다).
- WiLoR 가중치(`wilor_final.ckpt` 2.4 GB, `detector.pt`)는 저자 공식 배포에서 처음 한 번 받고 SHA-256을 확인합니다.
- 손 검출 신뢰도 하한은 WiLoR 기본값 0.3(`--hand-conf`)이고, 신뢰도 순으로 손 2개까지 씁니다. 복원기는 점수 0.5 미만 손을 추적에 쓰지 않습니다.

### `sam3d` (SAM 3D Body)

```bash
git clone https://github.com/facebookresearch/sam-3d-body ../sam-3d-body
git -C ../sam-3d-body checkout b5c765a0d89d789985e186d396315e7590887b94
uv venv -p 3.11 .venv-sam3d
# PyTorch(CUDA) 설치 뒤 ../sam-3d-body/INSTALL.md 3–4단계(pip 목록, detectron2)를 그대로 실행
.venv-sam3d/bin/pip install -r tools/extract/requirements-sam3d.txt
# Hugging Face에서 facebook/sam-3d-body-dinov3 접근 요청 → 승인 뒤
hf auth login && hf download facebook/sam-3d-body-dinov3 --local-dir checkpoints/sam-3d-body-dinov3
.venv-sam3d/bin/python tools/extract/extract.py private-data/videos-hq/*.webm --out private-data/exports/sam3d \
  --backend sam3d --sam3d-repo ../sam-3d-body --sam3d-checkpoint checkpoints/sam-3d-body-dinov3
```

- 한 화면에 사람이 한 명이라고 보고 화면 전체를 사람 상자로 씁니다. 결과가 여럿이면 가장 큰 사람을 씁니다.
- SAM 3D Body는 점마다 신뢰도를 내지 않고 가려진 부분까지 몸 전체를 완성합니다. 그래서 다음 대리값을 씁니다(추정을 관측처럼 보이지 않게 하려는 장치):
  - 몸 점의 visibility: 화면 안 0.95, 화면 밖 0.05(복원기 기준 0.45에서 화면 밖 팔이 숨겨짐). 입꼬리(9·10)는 MHR70에 없어 0.
  - 손: 21점이 모두 화면 안에 있고 손 크기가 20 px 이상일 때만 내보내며, 점수는 상수 0.9입니다(모델 신뢰도가 아님).

### 세 백엔드를 같은 영상으로 비교

```bash
for b in mediapipe wilor sam3d; do
  npm run motion:import -- private-data/exports/$b --out private-data/exports/$b/motion --videos private-data/videos-hq --report work/import-$b.json
done
npm run motion:report -- private-data/exports/mediapipe/motion private-data/exports/wilor/motion private-data/exports/sam3d/motion --report work/backend-compare.json
```

`work/backend-compare.md`의 한 표에서 백엔드별 손 누락률(전체·동작 구간), 화면 안 실패, held, 채움을 나란히 봅니다. 손 모양이 나아졌는지는 이 표가 알려 주지 않습니다. 같은 제약 조건 문서로 `npm run motion:constrain-report`의 **보정 전 잔차**(예: 고맙다 "편 손" 각도)를 비교하고, `npm run review:shots`로 화면을 보고, 마지막은 검수자가 판단합니다.

### 이 환경에서 확인한 것과 못 한 것 (2026-10-27)

- 확인: 좌표 변환(`convert.py`) 단위 테스트, 백엔드 `detect()` 연결을 가짜 모델로 확인하는 테스트(`python -m unittest tools/extract/test_convert.py tools/extract/test_backends.py`). 실제 MediaPipe 손을 MHR70 번호로 옮겼다가 되돌려 복원했을 때 손가락 관절 855개의 회전이 원래와 같았습니다(최대 0.000°). 즉 번호 대응이 맞습니다.
- 못 한 것: WiLoR와 SAM 3D Body의 **실제 추론**. 이 클라우드 환경에는 GPU가 없고, MANO는 가입한 사람만 받을 수 있으며, SAM 3D Body 가중치는 접근 승인이 필요합니다. 첫 실행은 본체 PC에서 하고, 결과 표를 이 문서에 기록합니다.

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

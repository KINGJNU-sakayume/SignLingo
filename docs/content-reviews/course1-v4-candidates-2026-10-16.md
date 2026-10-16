# 코스 1 v4 후보 — 2026-10-16

- 기록 성격: **후보 준비 기록**입니다. 승인 기록이 아닙니다.
- 입력: 개정판 3 검토 소견([course1-v2-feedback-2026-10-15.md](course1-v2-feedback-2026-10-15.md) 후속), 2026-10-16 기술 진행 보고서(비공개 저장소 `reports/2026-10-16-tech-progress-report.md`).
- 결과: 해결기 v3(`signlingo-constraint-solver-v3`)로 `ksl-thanks` 개정판 4, `ksl-sorry` 개정판 3 후보를 다시 만들었습니다. 두 검수를 받아야 공개됩니다. `ksl-meet`는 공개된 개정판 3을 유지합니다(해결기 v3로 다시 계산해도 손목은 같고 팔꿈치 차이가 1.6 cm 이하라 새 개정판을 만들 이유가 없습니다).

## 해결기 v3

| 변경 | 이유 |
| --- | --- |
| 손목을 옮긴 팔의 팔꿈치를 **정면에서 본 관측 팔꿈치에 가장 가까운 곳**으로 고릅니다(`projectedElbow`). | 손이 조금 움직일 때 관측 팔 각도가 남습니다. |
| `contact`에 `along: "image"`: 정면 카메라에서 보이는 위치만 맞추고 복원 깊이는 그대로 둡니다. | 미안 개정판 3 후보는 이마까지 3D로 약 38 cm 옮겨 팔꿈치가 옆으로 꺾였고(정면 편차 최대 19.8 cm), 검토자는 개정판 2의 팔 각도를 더 좋게 보았습니다. 고정 길이 팔로는 손을 이마에 붙이면서 그 팔 각도를 지킬 수 없음을 확인했습니다(3D 접촉에 팔꿈치 규칙만 바꾼 시험도 19.8 cm). |
| `contact`에 `approaches: n`: 구간 안에서 두 점이 가장 가까워지는 n번의 순간에만 닿게 하고 그 사이에는 관측대로 손을 듭니다. | 고맙다 개정판 3은 오른손 손날과 왼 손등이 가장 가까울 때도 11.7 cm 떨어져 "두 번 댄다"가 닿지 않았습니다. 시각을 지어내지 않고 횟수로 씁니다. |

## 후보

| 표현 | 바뀐 점 | 측정 |
| --- | --- | --- |
| ksl-thanks 개정판 4 | `thanks-tap`(`approaches: 2`, 오른손 손날 → 왼 손등) 추가. 손 모양·방향 조건은 개정판 3과 같습니다. | 2.10 s·2.30 s에 닿음(최소 1.5 cm, 사이 최대 9.5 cm로 다시 듦). 손 겹침 0. |
| ksl-sorry 개정판 3 | `sorry-forehead`를 `along: "image"`, 이동 상한 20 cm로. 손 모양 구간(동그라미 36–68, 펴기 56–90)은 지난 후보와 같습니다. | 정면 이마 거리 2.5 cm(개정판 2: 7.2 cm). 팔꿈치 정면 편차 최대 8.8 cm(개정판 2: 5.9 cm, 지난 후보: 19.8 cm). 깊이는 복원값 그대로(이마 앞 약 38 cm). |

명령이 계산한 대상 해시(`npm run content -- subject`, 패키지 `entry.json`):

| 표현 | 개정판 | 대상 해시 | 동작 파일 SHA-256 | 제약 조건 SHA-256 (개수) |
| --- | --- | --- | --- | --- |
| ksl-thanks | 4 | aef86ea02a949d17e883676180d2be303367f11cdeb511857253c92349f7db14 | 73ac679dc68c1bf446981fec55d2cd5dbc25ce1ac5566f07e89aeedbf4b71e28 | b9a4ed747ba18fffcb5cd0279d1856bddd789be21681912b56f814b4950a8cf8 (5) |
| ksl-sorry | 3 | f30517c56caffb88d43350704d027ec0e977b1cdc5c0e2cf22ead1f5d5d20c6b | 8a2961e85e04e7c187aab6b11be8ed6c55228e1d3aa34b2a96278545669820ec | 7e9ce861638c88adf0000cdf9b662da0c78aa4b1c0bf67946c82c278e2db8cc6 (3) |

패키지는 비공개 저장소 `private-data/ksl-thanks/`, `private-data/ksl-sorry/`에 있습니다(상태 `reconstruction-review-required`, 두 검수 `pending`). `npm run dev` → `/?review=1`. 승인은 [검수 규칙](review-process.md)대로 `npm run content -- approve --publish --feedback "<피드백 원문>" private-data/<id>`로 기록합니다.

## 검수자에게 확인할 것

- ksl-thanks: 2.10 s·2.30 s 두 번 닿는 시점이 원본 영상의 두 번 대는 장면과 맞는지, 오른손이 내려와 닿는 모양이 자연스러운지.
- ksl-sorry: 정면에서 동그라미가 이마에 닿아 보이고 팔 각도가 개정판 2와 비슷한지. 옆에서 보면 손이 얼굴 앞에 떨어져 있습니다(깊이를 고치지 않은 대가).

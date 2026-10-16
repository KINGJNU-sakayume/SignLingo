# 자체 촬영 영상 이용 허락 기록 — 2026-10-16

- 기록 번호: SL-REC-2026-10-16
- 기록일: 2026-10-16
- 권리자·촬영자: 저장소 소유자
- 출연(수어): 출연자 A
- 근거: 권리자(저장소 소유자)의 2026-10-16 진술 — 새 영상 3개에 [2026-10-14 기록](own-recording-rights-2026-10-14.md)과 **같은 허락 범위**가 적용된다.
- 개인 정보: 출연자·검수자·권리자의 실명은 공개하지 않습니다. 실명·연락처·서명은 이 공개 기록에 싣지 않습니다.
- 이 문서는 이용 허락 기록입니다. 3D 복원·한국수어 검수 승인이 아닙니다.

## 대상 영상

코스 1의 세 표현을 다시 촬영한 고화질 영상입니다. 권리자가 iPhone 화면 녹화 파일(`.mov`, HEVC)로 제공했고, 동작 추출에는 같은 내용을 VP9 WebM으로 옮긴 파일을 씁니다(추출 도구의 Chromium이 HEVC를 디코딩하지 못함). 해시는 두 파일 각각의 SHA-256입니다. 콘텐츠의 원본 해시(`source.videoSha256`)는 동작을 추출한 WebM입니다.

| 후보 ID | 제공 원본 | 바이트 | SHA-256 | 추출용 WebM | 바이트 | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| ksl-thanks | ksl-thanks-2026-10-16.mov | 1838345 | 403a56a7d20f1d4ec9e1bcfe1d8180aab26e48fac83a45dd45440a7809715141 | ksl-thanks.webm | 760453 | 3f1e02bd849f0a175e08c72576eff80feed2db8f694d73debd652b0d21306486 |
| ksl-sorry | ksl-sorry-2026-10-16.mov | 1718678 | 82fe4143144f89ac6e41999990462e22d1886f23b250b6204a3aca3f3e3cd1c6 | ksl-sorry.webm | 736116 | 2fc6eeb9fb03017bdb01d7d46a288477e7306a5cebb06e314d0042787b363d3f |
| ksl-meet | ksl-meet-2026-10-16.mov | 3634623 | 51fe6d200ccc2f6c255a72468fe105619d92dc626ec72e44d89bb2e4526cabd7 | ksl-meet.webm | 545838 | fab417a696a366589dcc205e0c9e79550e7e3eb54fc2ee252b69e671b2c5aab6 |

WebM 변환: `ffmpeg -i <원본>.mov -an -c:v libvpx-vp9 -crf 18 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p <id>.webm` (소리 제거, 해상도·프레임률 유지).

## 허락 범위 (출연자 동의 범위, 권리자 진술)

| 항목 | 결정 |
| --- | --- |
| 원본 영상을 로컬에서 처리 (importVideo) | 허락 |
| 3D 동작으로 변환·보정 (deriveMotion) | 허락 |
| 변환된 동작 파일 배포 (publishMotion) | 허락 |
| 공개 GitHub 저장소에 수록 (publicRepository) | 허락 |
| 공개 웹사이트(GitHub Pages)에서 제공 (publicWebsite) | 허락 |
| 원본 영상 자체 공개·배포 (publishVideo) | 불허 |
| 외부 호스팅 영상 재생 (externalVideo) | 불허 |

원본 영상과 변환본은 공개 저장소·웹사이트·외부 호스트 어디에도 올리지 않습니다. git에서 제외되는 `private-data/`와 비공개 저장소에서만 처리합니다.

## 범위 밖의 사항

- 이 기록은 이용 허락만 다룹니다. 표현의 뜻·변이·수형이 맞는지는 판단하지 않습니다.
- 새 고맙다·미안 영상은 이전 영상과 수어 형태가 다릅니다(고맙다: 오른손을 얼굴 옆으로 들었다가 고개를 숙이며 내려 왼 손등에 댐, 미안: 이마의 동그라미 뒤 왼 손등에 댐). 설명 변경과 두 검수는 별도로 받습니다.

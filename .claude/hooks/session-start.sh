#!/usr/bin/env bash
# Claude Code 클라우드 세션 준비: 의존성, Chromium 경로, 비공개 검수 패키지.
# 로컬 PC에서는 아무것도 하지 않습니다(CLAUDE_CODE_REMOTE가 true일 때만).
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
notes=()

# 1. 의존성: 잠금 파일보다 오래된 설치만 다시 합니다.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >&2
  notes+=("npm ci 실행함")
else
  notes+=("node_modules 최신")
fi

# 2. 미리 설치된 Chromium: Playwright 잠금 버전과 빌드 번호가 달라도 쓰도록 경로를 지정합니다.
if [ -z "${CHROMIUM_PATH:-}" ]; then
  chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | tail -n 1 || true)
  if [ -n "$chrome" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export CHROMIUM_PATH=\"$chrome\"" >> "$CLAUDE_ENV_FILE"
    notes+=("CHROMIUM_PATH=$chrome")
  fi
fi

# 3. 검수 패키지: 비어 있을 때만 비공개 저장소에서 복사합니다(작업 중인 내용은 덮어쓰지 않음).
private=../signlingo-private/private-data
if [ ! -e private-data ] && [ -d "$private" ]; then
  cp -a "$private" private-data
  notes+=("private-data를 비공개 저장소에서 복사함")
elif [ -d private-data ]; then
  notes+=("private-data 있음(복사 안 함). 바꾼 뒤에는 비공개 저장소와 맞출 것")
else
  notes+=("private-data 없음(비공개 저장소가 세션에 없음)")
fi

# 4. 검수 대기 패키지 요약과 안내를 Claude에게 넘깁니다.
NOTES=$(IFS=";"; echo "${notes[*]}") node --input-type=module -e '
import { readdirSync, readFileSync, existsSync } from "node:fs";
const pending = [];
if (existsSync("private-data")) for (const id of readdirSync("private-data")) {
  try {
    const e = JSON.parse(readFileSync(`private-data/${id}/entry.json`, "utf8"));
    if (String(e.status).endsWith("review-required")) pending.push(`${e.id} r${e.revision} (${e.status})`);
  } catch {}
}
const context = [
  `세션 준비(.claude/hooks/session-start.sh): Node ${process.version}; ${process.env.NOTES}`,
  `검수 대기 패키지: ${pending.length ? pending.join(", ") : "없음"}`,
  "이 환경의 Chromium은 영상 디코딩이 안 되어 Practice·recording-first·temporal 브라우저 테스트 일부가 원래 실패합니다.",
  "콘텐츠 작업 스킬: intake-recording(새 영상) → review-candidate(후보·화면) → approve-publish(승인·공개).",
].join("\n");
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
'

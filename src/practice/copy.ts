export const copy = {
  en: {
    title:'Watch, imitate, inspect.', intro:'Practice a reconstructed sign with local webcam capture and movement comparisons.',
    reference:'Reference', learner:'Your attempt', load:'Load reference MotionClip JSON', loadAttempt:'Load a local learner MotionClip (optional)', video:'Attach matching original video (optional)',
    privacy:'Video and landmarks stay in this browser. Models download on first use; recordings are never uploaded or saved automatically. Camera and microphone permissions are separate: no audio is requested.',
    caveat:'These are technical movement proxies, not a KSL correctness judgment. Facial grammar, meaning and linguistic validity are not assessed. A similar motion can still mean a different sign.',
    camera:'Enable camera', loading:'Opening camera and loading models…', ready:'Ready. Keep one signer, shoulders and hands visible. Hips improve torso-relative comparison.', start:'Start 3-second countdown', stop:'Stop recording', cancel:'End camera session', retry:'Try again', recording:'Recording locally', finishing:'Finishing motion extraction…',
    preview:'Mirror camera preview', pixels:'Actual camera pixels are mirrored (unmirror before tracking)', previewNote:'Preview mirroring does not swap anatomical left and right. Only enable the second option for a pre-mirrored virtual camera.',
    idle:'Load a reference, then enable your camera. Each attempt can record up to 20 seconds.', frames:'captured frames',
    intervals:'Signing intervals', intervalNote:'Check automatic boundaries. Include meaningful holds and the full sign; trim only surrounding idle time. Changes recompute alignment.', startTime:'Start (seconds)', endTime:'End (seconds)', auto:'Detect activity again',
    play:'Play comparison', pause:'Pause comparison', seek:'Aligned frame', alignment:'Temporal alignment', refTime:'Reference time', learnerTime:'Learner time', alignmentNote:'The line maps the selected reference interval to the learner interval using DTW. Repeated matches stretch time; every selected endpoint is included.',
    metrics:'Component differences', metricNote:'Lower residuals mean closer measured geometry, not better signing. Body units use shoulder width horizontally/depth and torso height vertically. Without hips, handshape remains available; approximate shoulder orientation uses camera-up and is compared only with the same frame type. Position needs a reliable torso. Coverage is the smaller fraction of distinct matched frames with usable evidence.',
    handshape:'Finger articulation', palm:'Palm orientation', position:'Hand / torso position', face:'Hand / face position', trajectory:'Movement path', direction:'Movement direction', coordination:'Two-hand coordination',
    left:'Left hand',right:'Right hand',both:'Both hands', degrees:'°', body:'body units', missingValue:'Insufficient tracking', coverage:'coverage',
    observed:'Observed movement differences', tracking:'Missing or uncertain tracking', noClaims:'No sustained differences exceeded the display heuristics in reliable samples. This does not establish KSL correctness.',
    timing:'Timing and sequence', timingNote:'Duration is descriptive, not penalized. DTW compensates for speed; a large local warp or unmatched endpoint can also indicate an incomplete gesture. Inspect the aligned replay.',
    speedRatio:'Learner / reference duration', warp:'Largest local time warp', path:'Body-relative wrist paths', pathNote:'Torso front view: reference solid green, learner dashed orange. Depth differences require the 3D view. Gaps mark unavailable tracking.',
    raw:'Avatars show stored reconstruction; metrics use original tracked landmarks and ignore manual pose edits. Green = anatomical left, gold = right; pink = selected feedback hand.',
    noVideo:'Motion-only reference. The JSON does not contain its original video.',
    safari:'Desktop Chromium is the tested target. Mobile layout is supported; physical mobile camera accuracy is unverified. iOS uses main-thread inference. Phone-video processing is available if live tracking is unreliable.',
    noDirection:'Not enough moving pairs', meaning:'Potential sign meaning differences — not assessed', meaningNote:'Handshape, palm, location, path and coordination can carry linguistic meaning. A qualified KSL reviewer must determine whether an observed difference changes a sign. No automatic meaning label is assigned.',
    failure:'The attempt could not be completed.', details:'Technical detail',
  },
  ko: {
    title:'보고, 따라 하고, 비교하세요.', intro:'재구성된 수어 동작을 보고 웹캠으로 연습한 뒤 움직임을 비교합니다.',
    reference:'기준 동작', learner:'내 연습', load:'기준 MotionClip JSON 불러오기', loadAttempt:'기존 연습 MotionClip 불러오기 (선택)', video:'일치하는 원본 영상 연결 (선택)',
    privacy:'영상과 관절 데이터는 브라우저 안에서 처리합니다. 첫 사용 시 모델을 내려받으며, 녹화는 자동 업로드하거나 저장하지 않습니다. 마이크 권한은 요청하지 않습니다.',
    caveat:'기술적인 움직임 비교이며 한국수어의 정답 판정이 아닙니다. 표정 문법·의미·언어적 타당성은 평가하지 않습니다. 비슷한 움직임도 다른 수어를 뜻할 수 있습니다.',
    camera:'카메라 켜기',loading:'카메라를 열고 모델을 불러오는 중…',ready:'준비됐습니다. 한 사람의 어깨와 손이 보이도록 해 주세요. 골반이 보이면 몸통 기준 비교가 가능합니다.',start:'3초 후 녹화 시작',stop:'녹화 중지',cancel:'카메라 종료',retry:'다시 연습',recording:'브라우저에서 녹화 중',finishing:'동작 추출을 마무리하는 중…',
    preview:'카메라 미리보기 좌우 반전',pixels:'실제 카메라 입력이 반전되어 있음 (추적 전 복원)',previewNote:'미리보기 반전은 신체의 왼손·오른손을 바꾸지 않습니다. 두 번째 설정은 입력 자체가 반전된 가상 카메라 등에만 사용하세요.',
    idle:'기준 동작을 불러온 뒤 카메라를 켜세요. 한 번에 최대 20초까지 녹화할 수 있습니다.',frames:'추출 프레임',
    intervals:'실제 수어 구간',intervalNote:'자동 구간을 확인하세요. 의미 있는 멈춤과 전체 수어를 포함하고 앞뒤 대기 시간만 제외하세요. 구간을 바꾸면 다시 정렬합니다.',startTime:'시작 (초)',endTime:'종료 (초)',auto:'활동 구간 다시 찾기',
    play:'비교 재생',pause:'비교 일시 정지',seek:'정렬된 프레임',alignment:'시간 정렬',refTime:'기준 시각',learnerTime:'연습 시각',alignmentNote:'선은 DTW로 대응시킨 기준 구간과 연습 구간입니다. 반복 대응은 속도 차이를 보정하며 선택한 양 끝점을 모두 포함합니다.',
    metrics:'항목별 움직임 차이',metricNote:'작은 값은 측정된 모양이 가깝다는 뜻이며 수어를 잘한다는 뜻은 아닙니다. 몸 기준 단위는 가로·깊이에 어깨 너비, 세로에 몸통 높이를 사용합니다. 관측률은 양쪽의 유효한 고유 프레임 비율 중 작은 값입니다.',
    handshape:'손가락 관절',palm:'손바닥 방향',position:'몸통 기준 손 위치',face:'얼굴 기준 손 위치',trajectory:'이동 경로',direction:'이동 방향',coordination:'양손 협응',left:'왼손',right:'오른손',both:'양손',degrees:'°',body:'몸 기준 단위',missingValue:'추적 근거 부족',coverage:'관측률',
    observed:'관측된 움직임 차이',tracking:'누락되거나 불확실한 추적',noClaims:'신뢰 가능한 연속 표본에서 표시 기준을 넘는 차이가 없었습니다. 한국수어의 정확성을 뜻하지는 않습니다.',
    timing:'속도와 순서',timingNote:'소요 시간 자체에는 감점이 없습니다. DTW가 속도 차이를 보정합니다. 큰 국소 시간 변화나 끝부분의 불일치는 동작 누락일 수도 있으므로 정렬 영상을 확인하세요.',speedRatio:'연습 / 기준 소요 시간',warp:'최대 국소 시간 변화',path:'몸 기준 손목 경로',pathNote:'몸통 정면: 기준은 녹색 실선, 연습은 주황색 점선입니다. 깊이 차이는 3D 화면에서 확인하세요. 추적 누락 구간은 선을 잇지 않습니다.',
    raw:'아바타는 저장된 재구성을 보여 줍니다. 비교는 원래 추적 좌표를 사용하며 수동 보정은 반영하지 않습니다. 녹색은 왼손, 금색은 오른손, 분홍색은 선택한 피드백의 손입니다.',noVideo:'동작만 불러왔습니다. JSON에는 원본 영상이 포함되어 있지 않습니다.',
    noDirection:'움직이는 대응 표본 부족', meaning:'수어 의미 차이 가능성 — 미평가', meaningNote:'손 모양·손바닥 방향·위치·경로·양손 협응은 언어적 의미를 가질 수 있습니다. 관측된 차이가 수어의 의미를 바꾸는지는 한국수어 전문가의 검토가 필요하며 자동으로 판정하지 않습니다.',
    safari:'데스크톱 Chromium에서 검증합니다. 모바일 화면을 지원하지만 실제 모바일 카메라 정확도는 미검증입니다. iOS는 메인 스레드에서 추론합니다. 실시간 추적이 불안정하면 휴대폰 영상을 선택해 처리하세요.',failure:'연습을 완료하지 못했습니다.',details:'기술 상세',
  },
};
export type Locale = keyof typeof copy;
export function feedbackText(locale: Locale,key: string,side: 'left'|'right') {
  const hand=copy[locale][side];
  return locale==='ko'?({low:`${hand}이 기준보다 낮게 관측됩니다.`,palm:`${hand}의 손바닥 방향이 다르게 관측됩니다.`,index:`${hand}의 검지가 기준보다 더 펴져 있습니다.`,path:`${hand}의 이동 경로가 다르게 관측됩니다.`,missing:`${hand}의 비교에 필요한 추적이 일부 누락되거나 불확실합니다.`}[key]??''):({low:`${hand} is observed lower than the reference.`,palm:`${hand} palm orientation differs.`,index:`${hand} index finger is more extended.`,path:`${hand} movement path differs.`,missing:`${hand} tracking is missing or uncertain in part of the comparison.`}[key]??'');
}

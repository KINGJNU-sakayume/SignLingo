export const koSide=(side:string)=>side==='left'?'왼손':side==='right'?'오른손':side;
export const koState=(state:string)=>({tracked:'정상 추적',held:'일시 유지',missing:'인식 안 됨',loading:'불러오는 중',ready:'준비됨',failed:'실패'} as Record<string,string>)[state]??state;
const exact:Record<string,string>={
'Opening video':'영상 여는 중','Loading pose & hand models':'신체 및 손 추적 모델을 불러오는 중',
'Extracting & reconstructing':'동작 추출 및 복원 중','Sampling decoded frames':'해독된 영상 프레임 추출 중','Waiting for distinct decoded frames':'서로 다른 영상 프레임 확인 중',
'Decoding saved video…':'저장된 영상 해독 중…',
'Monocular depth and shared hand/body camera axes are estimates, not calibrated geometry.':'단일 영상의 깊이와 신체·손 좌표축은 추정값이며 실제 측정값이 아닙니다.',
'Torso tracking unavailable; reconstruction withheld.':'몸통 추적이 불가능하여 동작 복원을 보류했습니다.',
'Head orientation unavailable; neutral head displayed.':'머리 방향을 알 수 없어 기본 머리 자세로 표시합니다.',
'No reliable upper-body pose was detected. Keep one signer, both shoulders and hands visible. No animation was generated.':'상체를 안정적으로 인식하지 못했습니다. 한 명의 수어 동작자와 양쪽 어깨·손이 보이게 촬영해 주세요.',
'No distinct decoded frames were observed. Try an H.264 MP4 or a current browser with video-frame callbacks.':'서로 다른 영상 프레임을 확인하지 못했습니다. H.264 MP4 영상이나 최신 브라우저를 사용해 주세요.',
'Playback failed':'재생 실패','Import rejected':'불러오기 실패','Reconstruction failed':'동작 복원 실패',
'Video decode failure':'영상 해독 실패','Model initialization failure':'모델 초기화 실패','Inference failure':'AI 추론 실패',
'Video capture failure':'영상 녹화 실패','Camera permission failure':'카메라 권한 요청 실패',
'Camera interrupted or muted. Reconnect and retry.':'카메라가 중단되었거나 음소거되었습니다. 다시 연결한 후 시도해 주세요.',
'No new camera frames for 2.5 seconds. Retry.':'2.5초 동안 새 카메라 프레임이 없어 녹화를 중단했습니다. 다시 시도해 주세요.',
'Model download failed':'모델 다운로드에 실패했습니다.',
'Camera requires HTTPS and getUserMedia support.':'HTTPS 환경과 카메라를 지원하는 브라우저가 필요합니다.',
'Camera permission was denied. Allow camera access in browser settings and retry.':'카메라 권한이 거부되었습니다. 브라우저 설정에서 허용한 후 다시 시도해 주세요.',
'No camera was found. Connect a camera and retry.':'카메라를 찾지 못했습니다. 카메라를 연결한 뒤 다시 시도해 주세요.',
'The camera is busy or unavailable. Close other camera applications and retry.':'카메라를 사용할 수 없습니다. 다른 카메라 앱을 종료한 뒤 다시 시도해 주세요.',
'The camera disconnected. Reconnect it and retry.':'카메라 연결이 끊겼습니다. 다시 연결해 주세요.',
'Video recording failed. Please retry.':'영상 녹화에 실패했습니다. 다시 시도해 주세요.',
'Model initialization timed out. Check model downloads and retry.':'모델 불러오기가 시간 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.',
'No reliable shoulder landmarks':'신뢰할 수 있는 어깨 관절 위치를 찾지 못했습니다.'
};
export function koMessage(input:string):string {
 if(!input)return input;
 if(exact[input])return exact[input];
 // Errors are composed as "Stage failure: detail"; translate each part separately.
 const split=/^([^:]+): ([\s\S]+)$/.exec(input);
 if(split&&exact[split[1]])return `${exact[split[1]]}: ${koMessage(split[2])}`;
 const capitalized=input[0].toUpperCase()+input.slice(1);
 if(exact[capitalized])return exact[capitalized];
 let out=input;
 const replacements:[RegExp,string][]=[
 [/\bleft\b/gi,'왼손'],[/\bright\b/gi,'오른손'],
 [/\bTorso\b/g,'몸통'],[/\bShoulders\b/gi,'어깨'],[/\bhips\b/gi,'골반'],
 [/\btracked\b/gi,'정상 추적'],[/\bmissing\b/gi,'누락'],[/\buncertain\b/gi,'불확실'],
 [/no reliable wrist-associated hand/gi,'손목과 연결되는 신뢰할 수 있는 손을 찾지 못했습니다'],
 [/arm landmarks unreliable/gi,'팔 관절 좌표의 신뢰도가 낮습니다'],
 [/elbow plane underdetermined; confidence-weighted temporal pole used where available/gi,'팔꿈치 굽힘 방향이 불명확하여 가능한 경우 이전 관측을 사용했습니다'],
 [/elbow plane near singularity/gi,'팔꿈치 굽힘 방향이 불안정합니다'],
 [/suspected elbow-plane flip; inspect supporting landmarks/gi,'팔꿈치 굽힘 방향이 갑자기 뒤집혔을 수 있습니다. 관절 좌표를 확인하세요'],
 [/last handshape held for ≤200 ms, confidence zero/gi,'손 추적이 끊겨 최대 200ms 동안 이전 손 모양을 임시 표시합니다. 신뢰도는 0입니다'],
 [/wrist behind torso; verify monocular depth \(position preserved\)/gi,'손목이 몸통 뒤로 추정되었습니다. 깊이를 확인하세요'],
 [/palm or finger geometry degenerate; hand reconstruction withheld/gi,'손바닥 또는 손가락 좌표가 불안정하여 손 복원을 보류했습니다'],
 [/unusual wrist swing; verify body\/hand alignment \(orientation preserved\)/gi,'손목 회전이 특이합니다. 몸과 손의 정렬을 확인하세요'],
 [/rapid image-space wrist jump; inspect frame/gi,'영상에서 손목 위치가 급격히 바뀌었습니다. 해당 프레임을 확인하세요'],
 [/fixed-rig reach correction\(s\); inspect position distortion/gi,'건의 팔 길이 보정이 적용되었습니다. 위치 왜곡을 확인하세요'],
 [/sudden rotation/gi,'갑작스러운 회전'],[/hand identity/gi,'손 구분'],[/finger/gi,'손가락'],[/wrist/gi,'손목'],[/elbow/gi,'팔꿈치'],
 [/Inference succeeded, but tracking is insufficient/gi,'AI 분석은 완료되었지만 추적 정보가 부족합니다'],
 [/Not enough processed frames/gi,'분석된 프레임이 부족합니다'],
 [/insufficient tracking/gi,'추적 근거 부족'],
 ];
 for(const [pattern,translation] of replacements)out=out.replace(pattern,translation);
 return out;
}

import type { TrackingDiagnostics } from './diagnostics';
import type { Locale } from './copy';
export function TrackingStatus({value,locale}:{value:TrackingDiagnostics;locale:Locale}) {
  const ko=locale==='ko';
  return <div className="practice-tracking" aria-label={ko?'실시간 추적 진단':'Live tracking diagnostics'}>
    <p>{ko?'모델 상태':'Model initialization'}: <strong>{value.model}</strong> · {value.backend.includes('main-thread')?'CPU · main thread':'CPU · worker'}</p>
    <p>{ko?'실제 처리 FPS':'Processed FPS'}: <strong>{value.fps.toFixed(1)}</strong> · {ko?'유효 특징 관측률':'Valid feature coverage'}: <strong>{Math.round(value.coverage*100)}%</strong></p>
    <p>{ko?'몸':'Body'}: {value.body} · {ko?'왼손':'Left hand'}: {value.left} · {ko?'오른손':'Right hand'}: {value.right}</p>
    {value.frame&&<p>{value.coverage===0?(ko?'추론 성공 · 추적 근거 부족':'Inference succeeded · insufficient tracking'):(ko?'추적 성공 · 비교에는 양쪽 영상의 충분한 근거가 필요합니다.':'Tracking succeeded · comparison requires sufficient evidence in both clips.')}</p>}
    {!!value.reasons.length&&<details open><summary>{ko?'누락된 관절 / 제한 사항':'Missing landmark reasons / limitations'}</summary><ul>{value.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
  </div>;
}

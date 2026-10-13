import type { TrackingDiagnostics } from './diagnostics';
import type { Locale } from './copy';
import { koMessage, koState } from '../i18n/ko';
export function TrackingStatus({value,locale}:{value:TrackingDiagnostics;locale:Locale}) {
  const ko=locale==='ko';
  return <div className="practice-tracking" aria-label="추적 진단">
    <p>{ko?'모델 상태':'Model initialization'}: <strong>{koState(value.model)}</strong> · {value.backend.includes('main-thread')?'CPU · 메인 스레드':'CPU · 백그라운드 작업자'}</p>
    <p>{ko?'추론 처리율':'Inference throughput'}: <strong>{value.fps.toFixed(1)}</strong> · {ko?'현재 분석 프레임 특징 관측률':'Current analyzed frame availability'}: <strong>{Math.round(value.coverage*100)}%</strong></p>
    <p>{ko?'몸':'Body'}: {koMessage(value.body)} · {ko?'왼손':'Left hand'}: {koMessage(value.left)} · {ko?'오른손':'Right hand'}: {koMessage(value.right)}</p>
    {value.frame&&<p>{value.coverage===0?(ko?'추론 성공 · 추적 근거 부족':'Inference succeeded · insufficient tracking'):(ko?'추적 성공 · 비교에는 양쪽 영상의 충분한 근거가 필요합니다.':'Tracking succeeded · comparison requires sufficient evidence in both clips.')}</p>}
    {value.attempt&&<p>{ko?'전체 시도 손 모양 관측률':'Whole-attempt handshape coverage'}: L {Math.round(value.attempt.left*100)}% · R {Math.round(value.attempt.right*100)}% · n={value.attempt.frames}</p>}
    {!!value.reasons.length&&<details open><summary>{ko?'누락된 관절 / 제한 사항':'Missing landmark reasons / limitations'}</summary><ul>{value.reasons.map(reason=><li key={reason}>{koMessage(reason)}</li>)}</ul></details>}
  </div>;
}

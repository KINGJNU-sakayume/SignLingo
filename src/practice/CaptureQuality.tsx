import type { CaptureMeasurements, ExtractionMeasurements } from '../motion/timing';
import type { Locale } from './copy';
const rate=(n:number|null|undefined)=>n==null?'—':n.toFixed(1);
export function CaptureQuality({capture,analysis,locale}:{capture:CaptureMeasurements|null;analysis:ExtractionMeasurements|null;locale:Locale}) {
  const ko=locale==='ko';if(!capture&&!analysis)return null;
  return <div className="practice-tracking" aria-label="녹화 및 분석 측정값">
    <h3>{ko?'녹화 / 분석 측정값':'Recording / analysis measurements'}</h3>
    {capture&&<><p>{ko?'카메라 요청':'Camera request'}: {capture.requestedCameraFps} FPS · {ko?'트랙 설정 (실측 아님)':'Track setting (not measured)'}: {rate(capture.reportedTrackFps)} FPS</p>
      <p>{ko?'미리보기 관측 전달률':'Observed preview delivery'}: {rate(capture.delivery.fps)} FPS · {capture.deliveryMethod==='video-frame-callback'?'영상 프레임 콜백':'영상 시간 확인'} · n={capture.delivery.samples}</p>
      <p>{ko?'인코딩된 녹화 FPS: 브라우저에서 직접 측정 불가':'Encoded recording FPS: unavailable from browser APIs'}. {ko?'미리보기 전달률은 녹화 프레임률의 증거가 아닙니다.':'Preview delivery is not an encoded frame-rate measurement.'}</p>
      <p>{ko?'전달 간격 이상 / 긴 간격 / 콜백 건너뜀':'Irregular delivery intervals / large gaps / skipped callbacks'}: {capture.delivery.irregularIntervals} / {capture.delivery.largeGaps} / {capture.delivery.callbackSkips} · {ko?'반복 시각':'Repeated timestamps'} {capture.delivery.duplicateTimes} · {ko?'최대 간격':'Max gap'} {capture.delivery.maxGapMs.toFixed(0)} ms</p></>}
    {analysis&&<><p>{ko?'오프라인 분석 요청':'Offline sampling request'}: {analysis.requestedHz} Hz · {analysis.maxDimension} px · {ko?'서로 다른 관측':'Distinct observations'}: {analysis.observations}/{analysis.requests}</p>
      <p>{ko?'영상 시간 기준 관측률':'Observed media-time sampling'}: {rate(analysis.cadence.fps)} Hz · {ko?'추론 처리율':'Inference throughput'}: {rate(analysis.inferenceFps)} FPS · {ko?'전체 분석 처리율':'Analysis throughput'}: {rate(analysis.analysisFps)} FPS</p>
      <p>{ko?'중복 / 시각 미확인 / 불규칙 간격':'Duplicate / unconfirmed timestamp / irregular interval'}: {analysis.duplicateDecodedFrames} / {analysis.unconfirmedFrames} / {analysis.cadence.irregularIntervals} · {analysis.timestampMethod==='decoded-presentation-time'?'영상 프레임 실제 시각':'요청 시각 (검증되지 않음)'} · {ko?'긴 시각 간격':'Large timestamp gaps'} {analysis.cadence.largeGaps} · {ko?'최대 간격':'Max gap'} {analysis.cadence.maxGapMs.toFixed(0)} ms</p>
      <p>{ko?'분석 중 원본 영상은 보존됩니다. 느린 처리율이 녹화 FPS를 의미하지 않습니다.':'The original recording is retained during analysis. Slow processing does not measure recording FPS.'}</p></>}
  </div>;
}

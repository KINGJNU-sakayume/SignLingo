import { useMemo, useState } from 'react';
import { diagnosticJoints, inspectClip, mean, pairedDirectionError, type SegmentDiagnostic } from '../motion/diagnostics';
import { SIDES, type MotionClip } from '../motion/types';
import { koSide, koMessage } from '../i18n/ko';
export type PipelineView = 'stored' | 'original' | 'improved';
const fixed = (value: number | null | undefined, digits=2) => value == null ? '해당 없음' : value.toFixed(digits);
const vector = (value: number[]) => value.map(x=>x.toFixed(3)).join(', ');
export function DiagnosticsLab({clips,view,onView,index,onSeek,onAdopt}:{clips:Record<PipelineView,MotionClip>;view:PipelineView;onView:(v:PipelineView)=>void;index:number;onSeek:(t:number)=>void;onAdopt:()=>void}) {
  const [joint,setJoint]=useState('left.index.1');
  const original=useMemo(()=>inspectClip(clips.original),[clips.original]);
  const improved=useMemo(()=>inspectClip(clips.improved),[clips.improved]);
  const stored=useMemo(()=>inspectClip(clips.stored),[clips.stored]);
  const active={original,improved,stored}[view],clip=clips[view],current=active.frames[index];
  const paired=useMemo(()=>pairedDirectionError(original,improved),[original,improved]);
  const side=joint.startsWith('left')?'left':'right';
  const selected=current.hands[side]?.segments.find(s=>s.joint===joint);
  const trace=active.frames.map(f=>({timestamp:f.timestamp,segment:f.hands[side]?.segments.find(s=>s.joint===joint)}));
  // Break traces at missing observations and >200ms gaps rather than drawing invented motion.
  const paths=(key:'flexDegrees'|'spreadDegrees')=>{
    let path='';return trace.map((f,i)=>{if(!f.segment){path='';return '';}const x=f.timestamp/(clip.source.duration*1000)*760,y=90-f.segment[key]/180*80;const start=!path||i===0||f.timestamp-trace[i-1].timestamp>200;path=`${start?'M':'L'}${x},${y}`;return path;}).join(' ');
  };
  function exportReport(){
    const payload={format:'signlingo.evaluation',version:1,metricStatus:'All automatic measures are geometric/tracking proxies, not KSL accuracy.',groundTruth:'not supplied',linguisticReview:'not performed',pipelineVersions:{original:clips.original.pipeline.version,improved:clips.improved.pipeline.version},source:{duration:clip.source.duration,sampleHz:clip.source.sampleHz,mirrored:clip.source.mirrored},paired,original:original.summary,improved:improved.summary};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='reconstruction-proxies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="diagnostics-lab" aria-label="복원 기술 진단">
    <div className="section-title"><h2>복원 기술 진단</h2><span className="small-tag">기하학적 참고 지표</span></div>
    <p>모든 복원 방식은 동일하게 저장된 추적 데이터를 사용합니다. 기존 방식은 0.1.0, 개선 방식은 0.2.0입니다. AI 추론을 다시 실행하지 않습니다. 저장된 프레임을 그대로 검사하며 직접 보정한 값은 측정에서 제외합니다.</p>
    <div className="lab-controls"><label>복원 방식 선택 <select aria-label="복원 방식 선택" value={view} onChange={e=>onView(e.target.value as PipelineView)}><option value="stored">저장된 복원 결과</option><option value="original">기존 방식 0.1.0</option><option value="improved">개선 방식 0.2.0</option></select></label><button className="button secondary" onClick={exportReport}>비교 요약 내보내기</button><button className="button secondary" disabled={view==='stored'} onClick={onAdopt}>선택한 복원 결과 적용</button><span>다른 복원 방식을 적용하면 저장된 손목 보정이 지워집니다. 원본 추적 데이터는 유지됩니다.</span></div>
    <p className="confidence-note">노란색 선은 추적된 관절 추정값, 흰색 선은 실제 3D 아바타 관절입니다. 깊이·손 정렬·뼈 길이에는 불확실성이 있습니다. 관절 위치가 일치한다고 수어가 정확하다는 의미는 아닙니다.</p>
    <div className="lab-scroll"><table><caption>전체 영상 비교 · 양쪽 방향 비교 표본: {paired.segments} · {fixed(paired.beforeDegrees)}° → {fixed(paired.afterDegrees)}°</caption><thead><tr><th>측정 항목</th><th>기존</th><th>개선</th></tr></thead><tbody>
      {([
        ['마디 방향 평균 / 95백분위 (°)',`${fixed(original.summary.directionMeanDegrees)} / ${fixed(original.summary.directionP95Degrees)}`,`${fixed(improved.summary.directionMeanDegrees)} / ${fixed(improved.summary.directionP95Degrees)}`],
        ['손 모양: 손바닥 기준 방향 평균 (°)',fixed(original.summary.handshapeMeanDegrees),fixed(improved.summary.handshapeMeanDegrees)],
        ['손바닥 방향 차이 평균 (°)',fixed(original.summary.palmMeanDegrees),fixed(improved.summary.palmMeanDegrees)],
        ['손가락 끝점 차이 평균 (mm)',fixed(original.summary.positionMeanMm),fixed(improved.summary.positionMeanMm)],
        ['손목 위치 차이 평균 (mm)',fixed(original.summary.wristMeanMm),fixed(improved.summary.wristMeanMm)],
        ['검출된 손 데이터 수 (동일 입력)',original.summary.detectedHandSets,improved.summary.detectedHandSets],
        ['유효한 손가락 마디 비교 수',original.summary.evaluatedSegments,improved.summary.evaluatedSegments],
        ['갑작스러운 회전 (>35° 및 >720°/초)',original.summary.suddenRotations,improved.summary.suddenRotations],
        ['좌우 구분 의심 / 모호한 프레임',`${original.summary.identityEvents} / ${original.summary.ambiguousIdentityFrames}`,`${improved.summary.identityEvents} / ${improved.summary.ambiguousIdentityFrames}`],
        ['팔꿈치 굽힘 방향 불안정',original.summary.elbowEvents,improved.summary.elbowEvents],
        ['적용된 보정 수 (정확도 아님)',original.summary.correctionCount,improved.summary.correctionCount],
        ['특이한 관절 움직임 경고 (신규)', '측정하지 않음', improved.summary.unusualArticulationFlags],
        ['양손 동시 추적 프레임',original.summary.bothHandsTrackedFrames,improved.summary.bothHandsTrackedFrames],
      ] as (string|number)[][]).map(([name,a,b])=><tr key={name}><th>{name}</th><td>{a}</td><td>{b}</td></tr>)}
      {SIDES.map(side=><tr key={side}><th>{koSide(side)} 추적률: 정상 / 유지 / 누락 (전체 {clip.frames.length}프레임)</th><td>{original.summary.coverage[side].tracked} / {original.summary.coverage[side].held} / {original.summary.coverage[side].missing}</td><td>{improved.summary.coverage[side].tracked} / {improved.summary.coverage[side].held} / {improved.summary.coverage[side].missing}</td></tr>)}
      {SIDES.map((side,i)=><tr key={`${side}-path`}><th>{koSide(side)} 이동 경로 길이 (m) / 최대 속도 (m/초)</th><td>{fixed(original.summary.paths[i].lengthMeters)} / {fixed(original.summary.paths[i].peakSpeedMetersPerSecond)}</td><td>{fixed(improved.summary.paths[i].lengthMeters)} / {fixed(improved.summary.paths[i].peakSpeedMetersPerSecond)}</td></tr>)}
    </tbody></table></div>
    <p>추적 누락 프레임은 오차 0으로 처리하지 않고 측정에서 제외합니다. 경로 길이와 동시 추적률은 움직임 및 인식 상태를 나타냅니다. 실제 수어의 정확성은 사람의 검토가 필요합니다.</p>
    <div className="lab-controls"><button className="button secondary" disabled={!index} onClick={()=>onSeek(clip.frames[index-1].timestamp/1000)}>이전 프레임</button><strong>검사 중인 프레임 {index+1} / {clip.frames.length} · {(current.timestamp/1000).toFixed(3)} s</strong><button className="button secondary" disabled={index===clip.frames.length-1} onClick={()=>onSeek(clip.frames[index+1].timestamp/1000)}>다음 프레임</button><label>관절 <select aria-label="검사할 관절" value={joint} onChange={e=>setJoint(e.target.value)}>{diagnosticJoints.map(j=><option key={j}>{j}</option>)}</select></label></div>
    <svg className="joint-timeline" viewBox="0 0 760 180" role="img" aria-label={`${joint} 관절 각도 변화: 굽힘 녹색, 벌림 주황색`}><title>관절 각도는 −180°~180°입니다. 선이 끊어진 부분은 관측값이 없습니다. 아래 버튼으로 프레임을 이동할 수 있습니다.</title><path d="M0 90H760" stroke="#617382"/><path d={paths('flexDegrees')} fill="none" stroke="#53d5c0" strokeWidth="2"/><path d={paths('spreadDegrees')} fill="none" stroke="#e6af68" strokeWidth="2"/><path d={`M${current.timestamp/(clip.source.duration*1000)*760} 0v180`} stroke="white"/></svg>
    <div className="trace-seek" aria-label="Joint timeline frames">{trace.filter((_,i)=>i%Math.max(1,Math.ceil(trace.length/100))===0).map(t=><button key={t.timestamp} className="text-button" onClick={()=>onSeek(t.timestamp/1000)}>{(t.timestamp/1000).toFixed(2)} s</button>)}</div>
    <p>선택한 관절: 굽힘 {fixed(selected?.flexDegrees)}° · 벌림 {fixed(selected?.spreadDegrees)}° · 방향 차이 {fixed(selected?.directionDegrees)}°. 녹색은 굽힘, 주황색은 벌림입니다. 아바타 기준의 각도이며 실제 관절 각도와 다를 수 있습니다. 그래프가 ±180°에서 연결되는 것은 움직임이 끊긴 것이 아닙니다.</p>
    <div className="lab-scroll"><table><caption>프레임별 마디 방향과 끝점 위치 (아바타 좌표계)</caption><thead><tr><th>관절</th><th>방향 (°)</th><th>손바닥 기준 (°)</th><th>끝점 (mm)</th><th>보정 (° / mm)</th></tr></thead><tbody>{SIDES.flatMap(side=>current.hands[side]?.segments??[]).map(s=><tr key={s.joint}><th><button className="text-button" onClick={()=>setJoint(s.joint)}>{s.joint}</button></th><td>{fixed(s.directionDegrees)}</td><td>{fixed(s.palmLocalDegrees)}</td><td>{fixed(s.positionMm)}</td><td>{fixed(s.correctionRadians*180/Math.PI)} / {fixed(s.correctionMeters*1000)}</td></tr>)}</tbody></table></div>
    {selected?<div className="lab-vectors"><strong>{joint} · 원본 및 아바타 벡터</strong>{(['detectedStart','reconstructedStart','detectedEnd','reconstructedEnd','detectedDirection','reconstructedDirection'] as (keyof SegmentDiagnostic)[]).map(key=><p key={key}>{key}: <code>{vector(selected[key] as number[])}</code></p>)}</div>:<p>현재 프레임에서 선택한 관절의 신뢰할 수 있는 추적값이 없습니다.</p>}
    <p>현재 손 모양 차이: {fixed(mean(SIDES.flatMap(side=>current.hands[side]?.segments.map(s=>s.palmLocalDegrees)??[])))}°.</p>
    <ul className="warning-list">{[...current.suddenRotations.map(c=>`${c.joint}: ${c.degrees.toFixed(1)}° · ${c.degreesPerSecond.toFixed(0)}°/초`),...current.identityEvents,...current.elbowEvents].map((w,i)=><li key={i}>{koMessage(w)}</li>)}</ul>
    <div className="lab-scroll"><table><caption>현재 프레임에 적용된 모든 보정 (원래 단위)</caption><thead><tr><th>관절</th><th>보정 종류</th><th>보정량</th></tr></thead><tbody>{clip.frames[index].corrections.map((c,i)=><tr key={i}><th>{c.joint}</th><td>{c.kind}</td><td>{c.amount.toFixed(6)}</td></tr>)}</tbody></table></div>
    <div className="lab-scroll"><table><caption>전체 영상 관절별 보정 합계 (단위별 분리)</caption><thead><tr><th>관절</th><th>횟수</th><th>각도</th><th>밀리미터</th></tr></thead><tbody>{Object.entries(active.summary.corrections).map(([joint,c])=><tr key={joint}><th>{joint}</th><td>{c.count}</td><td>{fixed(c.radians*180/Math.PI)}</td><td>{fixed(c.meters*1000)}</td></tr>)}</tbody></table></div>
  </section>;
}

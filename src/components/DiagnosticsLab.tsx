import { useMemo, useState } from 'react';
import { diagnosticJoints, inspectClip, mean, pairedDirectionError, type SegmentDiagnostic } from '../motion/diagnostics';
import { SIDES, type MotionClip } from '../motion/types';
export type PipelineView = 'stored' | 'original' | 'improved';
const fixed = (value: number | null | undefined, digits=2) => value == null ? 'N/A' : value.toFixed(digits);
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
  return <section className="diagnostics-lab" aria-label="Reconstruction diagnostics laboratory">
    <div className="section-title"><h2>Reconstruction diagnostics laboratory</h2><span className="small-tag">GEOMETRIC PROXIES</span></div>
    <p>Both pipelines use identical stored detections. Original = frozen 0.1.0; improved = 0.2.0. No inference rerun. Inspection displays exact sampled frames; manual edits are excluded from these measurements.</p>
    <div className="lab-controls"><label>Inspect pipeline <select aria-label="Inspect pipeline" value={view} onChange={e=>onView(e.target.value as PipelineView)}><option value="stored">Stored reconstruction</option><option value="original">Original 0.1.0</option><option value="improved">Improved 0.2.0</option></select></label><button className="button secondary" onClick={exportReport}>Export proxy summary</button><button className="button secondary" disabled={view==='stored'} onClick={onAdopt}>Use selected reconstruction</button><span>Using a pipeline clears saved wrist edits; original detections stay available.</span></div>
    <p className="confidence-note">Yellow lines = detected estimates at the body wrist anchor. White lines = rendered rig. Depth, hand/body alignment, and fixed bone lengths are uncertain. Matching landmarks does not establish anatomical or linguistic correctness.</p>
    <div className="lab-scroll"><table><caption>Whole-video comparison · paired direction samples: {paired.segments} · {fixed(paired.beforeDegrees)}° → {fixed(paired.afterDegrees)}°</caption><thead><tr><th>Proxy</th><th>Original</th><th>Improved</th></tr></thead><tbody>
      {([
        ['Segment direction mean / P95 (°)',`${fixed(original.summary.directionMeanDegrees)} / ${fixed(original.summary.directionP95Degrees)}`,`${fixed(improved.summary.directionMeanDegrees)} / ${fixed(improved.summary.directionP95Degrees)}`],
        ['Handshape: palm-local direction mean (°)',fixed(original.summary.handshapeMeanDegrees),fixed(improved.summary.handshapeMeanDegrees)],
        ['Palm orientation residual mean (°)',fixed(original.summary.palmMeanDegrees),fixed(improved.summary.palmMeanDegrees)],
        ['Finger endpoint residual mean (mm)',fixed(original.summary.positionMeanMm),fixed(improved.summary.positionMeanMm)],
        ['Wrist position residual mean (mm)',fixed(original.summary.wristMeanMm),fixed(improved.summary.wristMeanMm)],
        ['Raw detected hand sets (same input)',original.summary.detectedHandSets,improved.summary.detectedHandSets],
        ['Valid segment comparisons',original.summary.evaluatedSegments,improved.summary.evaluatedSegments],
        ['Sudden rotations (>35° and >720°/s)',original.summary.suddenRotations,improved.summary.suddenRotations],
        ['Potential identity events / ambiguous frames',`${original.summary.identityEvents} / ${original.summary.ambiguousIdentityFrames}`,`${improved.summary.identityEvents} / ${improved.summary.ambiguousIdentityFrames}`],
        ['Elbow-plane instability events',original.summary.elbowEvents,improved.summary.elbowEvents],
        ['Applied corrections (not accuracy)',original.summary.correctionCount,improved.summary.correctionCount],
        ['Unusual articulation flags (new heuristic)', 'Not measured', improved.summary.unusualArticulationFlags],
        ['Two-hand coordination: simultaneous tracked frames',original.summary.bothHandsTrackedFrames,improved.summary.bothHandsTrackedFrames],
      ] as (string|number)[][]).map(([name,a,b])=><tr key={name}><th>{name}</th><td>{a}</td><td>{b}</td></tr>)}
      {SIDES.map(side=><tr key={side}><th>{side} coverage: tracked / held / missing of {clip.frames.length}</th><td>{original.summary.coverage[side].tracked} / {original.summary.coverage[side].held} / {original.summary.coverage[side].missing}</td><td>{improved.summary.coverage[side].tracked} / {improved.summary.coverage[side].held} / {improved.summary.coverage[side].missing}</td></tr>)}
      {SIDES.map((side,i)=><tr key={`${side}-path`}><th>{side} movement path length (m) / peak speed (m/s)</th><td>{fixed(original.summary.paths[i].lengthMeters)} / {fixed(original.summary.paths[i].peakSpeedMetersPerSecond)}</td><td>{fixed(improved.summary.paths[i].lengthMeters)} / {fixed(improved.summary.paths[i].peakSpeedMetersPerSecond)}</td></tr>)}
    </tbody></table></div>
    <p>Missing samples are excluded, never scored as zero error. Paired samples use the intersection of tracked joints. Path length and simultaneous coverage describe motion and visibility; human review is required to judge movement and coordination.</p>
    <div className="lab-controls"><button className="button secondary" disabled={!index} onClick={()=>onSeek(clip.frames[index-1].timestamp/1000)}>Previous frame</button><strong>Inspection frame {index+1} / {clip.frames.length} · {(current.timestamp/1000).toFixed(3)} s</strong><button className="button secondary" disabled={index===clip.frames.length-1} onClick={()=>onSeek(clip.frames[index+1].timestamp/1000)}>Next frame</button><label>Joint <select aria-label="Inspection joint" value={joint} onChange={e=>setJoint(e.target.value)}>{diagnosticJoints.map(j=><option key={j}>{j}</option>)}</select></label></div>
    <svg className="joint-timeline" viewBox="0 0 760 180" role="img" aria-label={`${joint} joint angle timeline: flexion green, spread gold`}><title>Joint angles in degrees, −180 to 180; gaps mean unavailable. Use timeline buttons below to seek.</title><path d="M0 90H760" stroke="#617382"/><path d={paths('flexDegrees')} fill="none" stroke="#53d5c0" strokeWidth="2"/><path d={paths('spreadDegrees')} fill="none" stroke="#e6af68" strokeWidth="2"/><path d={`M${current.timestamp/(clip.source.duration*1000)*760} 0v180`} stroke="white"/></svg>
    <div className="trace-seek" aria-label="Joint timeline frames">{trace.filter((_,i)=>i%Math.max(1,Math.ceil(trace.length/100))===0).map(t=><button key={t.timestamp} className="text-button" onClick={()=>onSeek(t.timestamp/1000)}>{(t.timestamp/1000).toFixed(2)} s</button>)}</div>
    <p>Selected joint: flexion {fixed(selected?.flexDegrees)}° · spread {fixed(selected?.spreadDegrees)}° · direction residual {fixed(selected?.directionDegrees)}°. Green: flexion; gold: spread. These are rig coordinates, not clinical joint angles; ±180° chart wrapping is not itself a motion discontinuity.</p>
    <div className="lab-scroll"><table><caption>Frame segment directions and endpoint positions (avatar coordinates)</caption><thead><tr><th>Joint</th><th>Direction (°)</th><th>Palm-local (°)</th><th>Endpoint (mm)</th><th>Correction (° / mm)</th></tr></thead><tbody>{SIDES.flatMap(side=>current.hands[side]?.segments??[]).map(s=><tr key={s.joint}><th><button className="text-button" onClick={()=>setJoint(s.joint)}>{s.joint}</button></th><td>{fixed(s.directionDegrees)}</td><td>{fixed(s.palmLocalDegrees)}</td><td>{fixed(s.positionMm)}</td><td>{fixed(s.correctionRadians*180/Math.PI)} / {fixed(s.correctionMeters*1000)}</td></tr>)}</tbody></table></div>
    {selected?<div className="lab-vectors"><strong>{joint} · source and rig vectors</strong>{(['detectedStart','reconstructedStart','detectedEnd','reconstructedEnd','detectedDirection','reconstructedDirection'] as (keyof SegmentDiagnostic)[]).map(key=><p key={key}>{key}: <code>{vector(selected[key] as number[])}</code></p>)}</div>:<p>No tracked source estimate for this joint in this frame.</p>}
    <p>Current handshape residual: {fixed(mean(SIDES.flatMap(side=>current.hands[side]?.segments.map(s=>s.palmLocalDegrees)??[])))}°.</p>
    <ul className="warning-list">{[...current.suddenRotations.map(c=>`${c.joint}: ${c.degrees.toFixed(1)}° at ${c.degreesPerSecond.toFixed(0)}°/s`),...current.identityEvents,...current.elbowEvents].map((w,i)=><li key={i}>{w}</li>)}</ul>
    <div className="lab-scroll"><table><caption>Current frame: every applied correction, with original units</caption><thead><tr><th>Joint</th><th>Kind</th><th>Amount</th></tr></thead><tbody>{clip.frames[index].corrections.map((c,i)=><tr key={i}><th>{c.joint}</th><td>{c.kind}</td><td>{c.amount.toFixed(6)}</td></tr>)}</tbody></table></div>
    <div className="lab-scroll"><table><caption>Whole-video per-joint correction totals (different units kept separate)</caption><thead><tr><th>Joint</th><th>Count</th><th>Degrees</th><th>Millimeters</th></tr></thead><tbody>{Object.entries(active.summary.corrections).map(([joint,c])=><tr key={joint}><th>{joint}</th><td>{c.count}</td><td>{fixed(c.radians*180/Math.PI)}</td><td>{fixed(c.meters*1000)}</td></tr>)}</tbody></table></div>
  </section>;
}

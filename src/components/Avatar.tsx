import { Suspense, memo, useEffect, useMemo, useRef, Component, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { FINGERS, SIDES, type Side, type Quat, type MotionFrame, type Vec3 } from '../motion/types';
import type { AvatarPose as Pose, HandFocus } from '../motion/display/types';
import { fingerLengths, fingerOffsets, neutralRotations } from '../motion/rig';
import { LENGTHS, normalizeBody, alignHand, arr } from '../motion/math';
const ID: Quat=[0,0,0,1];
function Joint({radius=0.023,color='#8b9ca6',opacity=1}:{radius?:number;color?:string;opacity?:number}) { return <mesh><sphereGeometry args={[radius,16,12]}/><meshStandardMaterial color={color} roughness={0.4} transparent={opacity<1} opacity={opacity} depthWrite={opacity===1}/></mesh>; }
function Segment({length,radius,color,skeleton,markers,opacity=1}:{length:number;radius:number;color:string;skeleton:boolean;markers:boolean;opacity?:number}) {
  return <><mesh position={[0,length/2,0]}><capsuleGeometry args={[radius,Math.max(0.001,length-radius*2),5,12]}/><meshStandardMaterial color={color} roughness={0.48} metalness={0.12} transparent opacity={skeleton?0.25:opacity} depthWrite={!skeleton&&opacity===1}/></mesh>{skeleton&&<mesh position={[0,length/2,0]}><cylinderGeometry args={[0.003,0.003,length,8]}/><meshBasicMaterial color="#e9ffff" depthTest={false}/></mesh>}{markers&&<Joint radius={radius*0.55} color="#affff1"/>}</>;
}
function Fingers({side,rotations,color,skeleton,markers,opacity}:{side:Side;rotations:Record<string,Quat>;color:string;skeleton:boolean;markers:boolean;opacity:number}) {
  return <>{FINGERS.map(f=>{
    const lengths=fingerLengths[f], offset=[...fingerOffsets[f]] as [number,number,number];if(side==='right')offset[0]*=-1;
    return <group key={f} position={offset} quaternion={rotations[`${side}.${f}.0`]??ID}>
      <Segment length={lengths[0]} radius={f==='thumb'?0.010:0.008} {...{color,skeleton,markers,opacity}}/>
      <group position={[0,lengths[0],0]} quaternion={rotations[`${side}.${f}.1`]??ID}>
        <Segment length={lengths[1]} radius={0.007} {...{color,skeleton,markers,opacity}}/>
        <group position={[0,lengths[1],0]} quaternion={rotations[`${side}.${f}.2`]??ID}><Segment length={lengths[2]} radius={0.006} {...{color,skeleton,markers,opacity}}/></group>
      </group>
    </group>;
  })}</>;
}
// Upper body only, as in broadcast signing: torso, neck, head and arms. Legs, pelvis and floor are not drawn.
// A `ghost` draws only the arms and hands, white and translucent: the uncorrected pose under a constraint preview.
const GHOST='#f4f8fb',GHOST_OPACITY=.3,REST='#97a5ae';
/** Linear blend of two #rrggbb colors (t = 0: a, 1: b). */
function mix(a:string,b:string,t:number){if(t<=0)return a;if(t>=1)return b;const p=(c:string,i:number)=>parseInt(c.slice(1+2*i,3+2*i),16);return '#'+[0,1,2].map(i=>Math.round(p(a,i)+(p(b,i)-p(a,i))*t).toString(16).padStart(2,'0')).join('');}
function Mannequin({pose,skeleton,markers,highlightSide,hideHead,ghost=false}:{pose:Pose|null;skeleton:boolean;markers:boolean;highlightSide?:Side;hideHead:boolean;ghost?:boolean}) {
  const rotations=pose?.rotations??neutralRotations();
  const active=!pose || pose.quality.body>0;
  return <group position={pose?.root??[0,1.3,0]} quaternion={rotations.torso}>
    {!ghost&&<mesh position={[0,-0.2,0]} scale={[0.21,0.29,0.12]}><sphereGeometry args={[1,32,24]}/><meshStandardMaterial color={active?'#7d909d':'#34414b'} roughness={0.55} transparent opacity={skeleton?0.35:1}/></mesh>}
    <group visible={!hideHead&&!ghost}>
      <mesh position={[0,0.047,0]}><cylinderGeometry args={[0.045,0.055,0.13,20]}/><meshStandardMaterial color="#718591"/></mesh>
      <group position={[0,0.105,0]} quaternion={rotations.head}>
        <mesh position={[0,0.10,0]} scale={[0.09,0.12,0.087]}><sphereGeometry args={[1,32,24]}/><meshStandardMaterial color="#b4c4cb" roughness={0.6}/></mesh>
        <mesh position={[0,0.105,0.087]}><coneGeometry args={[0.016,0.03,12]}/><meshStandardMaterial color="#879fa9"/></mesh>
        {[-1,1].map(s=><mesh key={s} position={[s*0.033,0.126,0.077]}><sphereGeometry args={[0.007,12,8]}/><meshStandardMaterial color="#203642"/></mesh>)}
      </group>
    </group>
    {SIDES.map(side=>{
      const evidence=pose?.evidence?.[side], shown=pose?.hands?.[side];
      const state=shown ? (shown==='observed'?'tracked':shown) : evidence ? (evidence.state==='unavailable'?'missing':evidence.state==='observed'?'tracked':evidence.state) : pose?.quality[`${side}State`]??'tracked';
      const restArm=pose?.arms?.[side]==='rest';
      const visible=!pose || (active&&(pose.quality[`${side}Arm`]>0||evidence?.position==='interpolated'||restArm));
      // An arm or hand at rest before/after the sign (display only, not tracked) is drawn in the body's gray. While a
      // hand morphs between rest and the sign, its colors fade with the rest weight instead of switching.
      const blend=pose?.rest?.[side];
      const armOf=(s:string)=>restArm?'#75808a':s==='interpolated'?'#b49bea':pose ? (s==='tracked'?(side==='left'?'#53d5c0':'#e6af68'):'#75808a'):'#82949f';
      const handOf=(s:string)=>s==='held'||s==='filled'?'#f4b65f':s==='constrained'?'#5b9dff':s==='rest'?REST:armOf(s);
      const base:string=state==='rest'&&blend?.under?(blend.under==='observed'?'tracked':blend.under):state, fade=blend&&!restArm?Math.min(1,Math.max(0,blend.weight)):state==='rest'?1:0;
      const color=ghost?GHOST:highlightSide===side?'#ff79c6':mix(armOf(base),'#75808a',fade);
      // Held (≤200 ms, stored) and filled (display-only) handshapes are estimates: translucent orange.
      // A handshape a constraint set ("보정한 손 모양") is deliberate, not estimated: solid blue.
      const estimated=state==='held'||state==='filled', handColor=ghost?GHOST:mix(handOf(base),REST,fade);
      const opacity=ghost?GHOST_OPACITY:1, segment={color,skeleton:skeleton&&!ghost,markers:markers&&!ghost,opacity};
      return <group key={side} position={[side==='left'?0.19:-0.19,0,0]} visible={visible} quaternion={rotations[`${side}.upper`]}>
        <Joint radius={0.052} opacity={opacity} color={ghost?GHOST:undefined}/><Segment length={LENGTHS.upper} radius={0.042} {...segment}/>
        <group position={[0,LENGTHS.upper,0]} quaternion={rotations[`${side}.lower`]}>
          <Joint radius={0.034} opacity={opacity} color={ghost?GHOST:undefined}/><Segment length={LENGTHS.lower} radius={0.03} {...segment}/>
          <group position={[0,LENGTHS.lower,0]} quaternion={rotations[`${side}.wrist`]}>
            <Joint radius={0.022} color={ghost?GHOST:state==='missing'?'#e57b7b':color} opacity={opacity}/>
            <group visible={state!=='missing'}>
              <mesh position={[0,0.042,0]} scale={[0.037,0.047,0.014]}><sphereGeometry args={[1,20,16]}/><meshStandardMaterial color={handColor} transparent opacity={ghost?GHOST_OPACITY:estimated?0.45:skeleton?0.3:1} depthWrite={!estimated&&!ghost}/></mesh>
              {(state==='filled'||state==='constrained'||state==='rest'||!evidence||evidence.fingers!=='unavailable')&&<Fingers {...{side,rotations,skeleton:skeleton&&!ghost,markers:markers&&!ghost}} color={handColor} opacity={ghost?GHOST_OPACITY:estimated?0.6:1}/>}
            </group>
          </group>
        </group>
      </group>;
    })}
  </group>;
}
export type CameraView = 'front' | 'side' | 'first' | 'hands';
type Framing = { position: Vec3; target: Vec3; fov: number };
// Upper-body framing. The first-person eye sits just below eye level (eyes are at y≈1.53) and looks
// forward-down into the signing space: +z is forward, so the signer's right hand is on screen right.
const FRAMES: Record<Exclude<CameraView,'hands'>,Framing> = {
  front: { position: [0,1.28,1.55], target: [0,1.16,0.12], fov: 42 },
  side: { position: [1.55,1.28,0.12], target: [0,1.16,0.12], fov: 42 },
  first: { position: [0,1.47,0.07], target: [0,1.06,0.38], fov: 70 },
};
const HANDS_DEFAULT: HandFocus = { center: [0,1.08,0.3], radius: .25 };
function framing(view: CameraView, focus: HandFocus|null|undefined, mirror: boolean): Framing {
  if (view!=='hands') return FRAMES[view];
  const { center, radius } = focus ?? HANDS_DEFAULT, fov = 42;
  const distance = Math.max(.45, Math.min(1.4, radius/Math.tan(fov*Math.PI/360)*1.05));
  const target: Vec3 = [mirror?-center[0]:center[0], center[1], center[2]];
  return { position: [target[0], target[1]+.06, target[2]+distance], target, fov };
}
const LOOK = { azimuth: 20*Math.PI/180, polar: 12*Math.PI/180 };
function Camera({view,focus,mirror,resetKey}:{view:CameraView;focus?:HandFocus|null;mirror:boolean;resetKey:number}) {
  const controls=useRef<OrbitControlsImpl>(null);const {camera}=useThree();
  // Keyed on values, not object identity, so a re-render never re-frames the camera mid-playback.
  const [cx,cy,cz]=focus?.center??[],radius=focus?.radius;
  const frame=useMemo(()=>framing(view,radius===undefined?null:{center:[cx!,cy!,cz!],radius},mirror),[view,cx,cy,cz,radius,mirror]);
  useEffect(()=>{
    camera.position.set(...frame.position);
    const perspective=camera as PerspectiveCamera;perspective.fov=frame.fov;perspective.updateProjectionMatrix();
    controls.current?.target.set(...frame.target);controls.current?.update();
  },[camera,frame,resetKey]);
  // First person: a small look-around only, no pan or zoom out of the signer's own viewpoint.
  const first=view==='first',[dx,dy,dz]=frame.position.map((p,i)=>p-frame.target[i]);
  const azimuth=Math.atan2(dx,dz),polar=Math.acos(dy/Math.hypot(dx,dy,dz));
  return <OrbitControls ref={controls} makeDefault minDistance={first?0.05:0.35} maxDistance={first?2:3.5} enableDamping enablePan={!first} enableZoom={!first}
    minAzimuthAngle={first?azimuth-LOOK.azimuth:-Infinity} maxAzimuthAngle={first?azimuth+LOOK.azimuth:Infinity}
    minPolarAngle={first?polar-LOOK.polar:0} maxPolarAngle={first?polar+LOOK.polar:Math.PI}/>;
}
class WebGLError extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="canvas-error">3D rendering failed. Enable WebGL2 or try a current Chrome/Edge browser. Motion export is still available.</div>:this.props.children;}
}
function DetectedSkeleton({frame}:{frame:MotionFrame}) {
  const body=normalizeBody(frame.bodyWorld);
  if(!body)return null;
  return <group>{SIDES.map(side=>{
    const indices=side==='left'?[11,13,15]:[12,14,16];
    const anchor=body.points[indices[2]], index=frame.assignment[side];
    const hand=index===undefined?null:frame.hands[index];
    const points=hand&&anchor?alignHand(hand.world,anchor):null;
    return <group key={side}>{indices.every(i=>body.points[i])&&<Line points={indices.map(i=>arr(body.points[i]!))} color="#ffd84c" lineWidth={2}/>}{points&&FINGERS.map((f,i)=><Line key={f} points={[points[0],...points.slice(1+i*4,5+i*4)].map(arr)} color="#ffd84c" lineWidth={2}/>)}</group>;
  })}</group>;
}
// The learning screens use a light stage; Motion Lab and Practice keep the default dark one.
const THEMES={dark:{background:'#111e29'},light:{background:'#eef3f1'}};
/**
 * `mirror` reflects the rendered scene only (a learner's mirror view): poses, colors and
 * anatomical sides are unchanged, and it is never applied to the first-person view.
 */
export const Avatar = memo(function Avatar({pose,skeleton,markers,view,focus,mirror=false,resetKey=0,inspection,highlightSide,theme='dark',ghost}:{pose:Pose|null;skeleton:boolean;markers:boolean;view:CameraView;focus?:HandFocus|null;mirror?:boolean;resetKey?:number;inspection?:MotionFrame;highlightSide?:Side;theme?:'dark'|'light';ghost?:Pose|null}) {
  const colors=THEMES[theme],flip=mirror&&view!=='first';
  return <WebGLError><Canvas frameloop="demand" camera={{position:FRAMES.front.position,fov:FRAMES.front.fov}} dpr={[1,1.8]} gl={{antialias:true}} fallback={<div className="canvas-error">WebGL2 is required for the 3D viewer.</div>}>
    <color attach="background" args={[colors.background]}/><ambientLight intensity={1.2}/><directionalLight position={[3,5,4]} intensity={2.6}/><directionalLight position={[-3,2,-2]} color="#5fceb9" intensity={1.8}/>
    <Suspense fallback={null}><group scale={[flip?-1:1,1,1]}><Mannequin {...{pose,skeleton,markers,highlightSide}} hideHead={view==='first'}/>{ghost&&<Mannequin pose={ghost} skeleton={false} markers={false} hideHead ghost/>}{inspection&&<DetectedSkeleton frame={inspection}/>}</group></Suspense><Camera view={view} focus={focus} mirror={flip} resetKey={resetKey}/>
  </Canvas></WebGLError>;
});

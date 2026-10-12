import { Suspense, memo, useEffect, useRef, Component, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { FINGERS, SIDES, type Pose, type Side, type Quat, type MotionFrame } from '../motion/types';
import { fingerLengths, fingerOffsets, neutralRotations } from '../motion/rig';
import { LENGTHS, normalizeBody, alignHand, arr } from '../motion/math';
const ID: Quat=[0,0,0,1];
function Joint({radius=0.023,color='#8b9ca6'}:{radius?:number;color?:string}) { return <mesh><sphereGeometry args={[radius,16,12]}/><meshStandardMaterial color={color} roughness={0.4}/></mesh>; }
function Segment({length,radius,color,skeleton,markers}:{length:number;radius:number;color:string;skeleton:boolean;markers:boolean}) {
  return <><mesh position={[0,length/2,0]}><capsuleGeometry args={[radius,Math.max(0.001,length-radius*2),5,12]}/><meshStandardMaterial color={color} roughness={0.48} metalness={0.12} transparent opacity={skeleton?0.25:1} depthWrite={!skeleton}/></mesh>{skeleton&&<mesh position={[0,length/2,0]}><cylinderGeometry args={[0.003,0.003,length,8]}/><meshBasicMaterial color="#e9ffff" depthTest={false}/></mesh>}{markers&&<Joint radius={radius*0.55} color="#affff1"/>}</>;
}
function Fingers({side,rotations,color,skeleton,markers}:{side:Side;rotations:Record<string,Quat>;color:string;skeleton:boolean;markers:boolean}) {
  return <>{FINGERS.map(f=>{
    const lengths=fingerLengths[f], offset=[...fingerOffsets[f]] as [number,number,number];if(side==='right')offset[0]*=-1;
    return <group key={f} position={offset} quaternion={rotations[`${side}.${f}.0`]??ID}>
      <Segment length={lengths[0]} radius={f==='thumb'?0.010:0.008} {...{color,skeleton,markers}}/>
      <group position={[0,lengths[0],0]} quaternion={rotations[`${side}.${f}.1`]??ID}>
        <Segment length={lengths[1]} radius={0.007} {...{color,skeleton,markers}}/>
        <group position={[0,lengths[1],0]} quaternion={rotations[`${side}.${f}.2`]??ID}><Segment length={lengths[2]} radius={0.006} {...{color,skeleton,markers}}/></group>
      </group>
    </group>;
  })}</>;
}
function Mannequin({pose,skeleton,markers,highlightSide}:{pose:Pose|null;skeleton:boolean;markers:boolean;highlightSide?:Side}) {
  const rotations=pose?.rotations??neutralRotations();
  const active=!pose || pose.quality.body>0;
  return <group position={pose?.root??[0,1.3,0]} quaternion={rotations.torso}>
    <mesh position={[0,-0.2,0]} scale={[0.21,0.29,0.12]}><sphereGeometry args={[1,32,24]}/><meshStandardMaterial color={active?'#7d909d':'#34414b'} roughness={0.55} transparent opacity={skeleton?0.35:1}/></mesh>
    <mesh position={[0,-0.44,0]} scale={[0.16,0.11,0.105]}><sphereGeometry args={[1,24,16]}/><meshStandardMaterial color="#596d7a"/></mesh>
    <mesh position={[0,0.047,0]}><cylinderGeometry args={[0.045,0.055,0.13,20]}/><meshStandardMaterial color="#718591"/></mesh>
    <group position={[0,0.105,0]} quaternion={rotations.head}>
      <mesh position={[0,0.10,0]} scale={[0.09,0.12,0.087]}><sphereGeometry args={[1,32,24]}/><meshStandardMaterial color="#b4c4cb" roughness={0.6}/></mesh>
      <mesh position={[0,0.105,0.087]}><coneGeometry args={[0.016,0.03,12]}/><meshStandardMaterial color="#879fa9"/></mesh>
      {[-1,1].map(s=><mesh key={s} position={[s*0.033,0.126,0.077]}><sphereGeometry args={[0.007,12,8]}/><meshStandardMaterial color="#203642"/></mesh>)}
    </group>
    {SIDES.map(side=>{
      const state=pose?.quality[`${side}State`]??'tracked';
      const visible=!pose || (active&&pose.quality[`${side}Arm`]>0);
      const color=highlightSide===side?'#ff79c6':pose ? (state==='tracked'?(side==='left'?'#53d5c0':'#e6af68'):'#75808a'):'#82949f';
      return <group key={side} position={[side==='left'?0.19:-0.19,0,0]} visible={visible} quaternion={rotations[`${side}.upper`]}>
        <Joint radius={0.052}/><Segment length={LENGTHS.upper} radius={0.042} {...{color,skeleton,markers}}/>
        <group position={[0,LENGTHS.upper,0]} quaternion={rotations[`${side}.lower`]}>
          <Joint radius={0.034}/><Segment length={LENGTHS.lower} radius={0.03} {...{color,skeleton,markers}}/>
          <group position={[0,LENGTHS.lower,0]} quaternion={rotations[`${side}.wrist`]}>
            <Joint radius={0.022} color={state==='missing'?'#e57b7b':color}/>
            <group visible={state!=='missing'}>
              <mesh position={[0,0.042,0]} scale={[0.037,0.047,0.014]}><sphereGeometry args={[1,20,16]}/><meshStandardMaterial color={state==='held'?'#f4b65f':color} transparent opacity={state==='held'?0.45:skeleton?0.3:1}/></mesh>
              <Fingers {...{side,rotations,skeleton,markers}} color={state==='held'?'#f4b65f':color}/>
            </group>
          </group>
        </group>
      </group>;
    })}
    {[-1,1].map(s=><group key={s} position={[s*0.09,-0.47,0]} rotation={[0,0,Math.PI]}><Segment length={0.39} radius={0.059} color="#4a606e" skeleton={skeleton} markers={false}/><group position={[0,0.39,0]}><Segment length={0.36} radius={0.043} color="#4a606e" skeleton={skeleton} markers={false}/><mesh position={[0,0.36,0.035]} scale={[0.055,0.034,0.1]}><sphereGeometry args={[1,16,12]}/><meshStandardMaterial color="#334854"/></mesh></group></group>)}
  </group>;
}
function Camera({preset}:{preset:string}) {
  const controls=useRef<OrbitControlsImpl>(null);const {camera}=useThree();
  useEffect(()=>{camera.position.set(preset==='side'?2.4:0,1.45,preset==='rear'?-2.6:preset==='side'?0:2.6);controls.current?.target.set(0,1.10,0);controls.current?.update();},[camera,preset]);
  return <OrbitControls ref={controls} makeDefault target={[0,1.10,0]} minDistance={0.35} maxDistance={5} enableDamping/>;
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
export const Avatar = memo(function Avatar({pose,skeleton,markers,preset,inspection,highlightSide}:{pose:Pose|null;skeleton:boolean;markers:boolean;preset:string;inspection?:MotionFrame;highlightSide?:Side}) {
  return <WebGLError><Canvas frameloop="demand" camera={{position:[0,1.45,2.6],fov:42}} dpr={[1,1.8]} gl={{antialias:true}} fallback={<div className="canvas-error">WebGL2 is required for the 3D viewer.</div>}>
    <color attach="background" args={['#111e29']}/><ambientLight intensity={1.2}/><directionalLight position={[3,5,4]} intensity={2.6}/><directionalLight position={[-3,2,-2]} color="#5fceb9" intensity={1.8}/>
    <Suspense fallback={null}><Mannequin {...{pose,skeleton,markers,highlightSide}}/>{inspection&&<DetectedSkeleton frame={inspection}/>}<Grid position={[0,0.02,0]} args={[8,8]} cellSize={0.2} cellThickness={0.45} cellColor="#30434e" sectionColor="#3f5662" sectionSize={1} fadeDistance={6}/><ContactShadows position={[0,0.01,0]} opacity={0.35} scale={5} blur={2.5} far={3}/></Suspense><Camera preset={preset}/>
  </Canvas></WebGLError>;
});

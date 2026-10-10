import { useEffect,useRef } from 'react';
import type { MotionFrame } from '../motion/types';
const bodyEdges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
const handEdges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
export function Overlay({frame,width,height,mirrored}:{frame:MotionFrame|undefined;width:number;height:number;mirrored:boolean}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const ctx=ref.current?.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,width,height);if(!frame)return;
    const draw=(points:MotionFrame['body'],edges:number[][],color:string)=>{
      const px=(i:number)=>(mirrored?1-points[i].x:points[i].x)*width;
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1.5,width/500);
      for(const [a,b] of edges)if(points[a]&&points[b]&&(points[a].visibility??1)>0.4&&(points[b].visibility??1)>0.4){ctx.beginPath();ctx.moveTo(px(a),points[a].y*height);ctx.lineTo(px(b),points[b].y*height);ctx.stroke();}
      points.forEach((p,i)=>{if((p.visibility??1)<0.4)return;ctx.beginPath();ctx.arc(px(i),p.y*height,Math.max(2,width/280),0,Math.PI*2);ctx.fill();});
    };
    draw(frame.body,bodyEdges,'#b9cdd7');
    frame.hands.forEach((hand,i)=>draw(hand.image,handEdges,frame.assignment.left===i?'#53d5c0':frame.assignment.right===i?'#e6af68':'#ef7b87'));
  },[frame,width,height,mirrored]);
  return <canvas aria-hidden="true" ref={ref} width={width} height={height} className="landmarks"/>;
}

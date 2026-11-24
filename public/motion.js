// Frame-rate independent visual motion, separate from the authoritative server physics.
// Display ~100ms behind snapshots so a 60Hz canvas can interpolate between 20Hz samples.
export const RENDER_DELAY_MS=100;
const EXTRAPOLATE_MAX_MS=40;
const ANGLE_DELTA=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const position=(s)=>({x:s.x,y:s.y,angle:s.angle,speed:s.speed});

export function pushMotion(samples,car,at){
 const point={...position(car),at:Number(at)};
 if(!Number.isFinite(point.at)||!Number.isFinite(point.x)||!Number.isFinite(point.y))return samples||[];
 const old=samples||[],last=old.at(-1);
 if(last&&point.at<=last.at)return old;
 // A rescue is an intentional teleport, not a 100-ms drive across the grass.
 if(last&&(Math.hypot(point.x-last.x,point.y-last.y)>95||point.at-last.at>900))return [point];
 return [...old.slice(-7),point];
}

export function sampleMotion(samples,time){
 if(!samples?.length)return null;
 const first=samples[0];
 if(samples.length===1||time<=first.at)return position(first);
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i];
  if(time<=b.at){
   const u=Math.max(0,Math.min(1,(time-a.at)/(b.at-a.at)));
   return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,
    angle:a.angle+ANGLE_DELTA(a.angle,b.angle)*u,speed:a.speed+(b.speed-a.speed)*u};
  }
 }
 const last=samples.at(-1),prev=samples.at(-2);
 const lead=Math.max(0,Math.min(EXTRAPOLATE_MAX_MS,time-last.at));
 const span=last.at-prev.at;
 // Only predict briefly, and never extrapolate after a paused or stationary sample.
 if(span<=0||lead<=0)return position(last);
 const dx=last.x-prev.x,dy=last.y-prev.y;
 return {x:last.x+dx/span*lead,y:last.y+dy/span*lead,
  angle:last.angle+ANGLE_DELTA(prev.angle,last.angle)/span*lead,
  speed:last.speed};
}

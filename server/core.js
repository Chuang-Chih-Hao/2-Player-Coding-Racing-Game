// Shared, deliberately non-evaluating Scratch-style program model and race simulation.
export const TOPICS = {
  max: "最高速度（變數）", accel: "加速度（變數）",
  curve: "彎道 if / else（條件）", item: "道具事件（事件）", free: "自由設計"
};
export const TRACKS = ["rookie", "curves", "items"];
export const PARAMS = {
  set_max: [70, 230], set_accel: [3, 16], set_steer: [1, 6],
  set_brake: [2, 12], set_target: [35, 230], change_speed: [-40, 40]
};
export const EVENTS = ["start", "line", "curve_enter", "curve_leave", "collision", "pickup", "boost_zone", "key", "finish"];
export const CONDITIONS = ["curve", "speed_gt", "collision", "has_item", "obstacle_near", "item_kind"];
export const ACTIONS = [...Object.keys(PARAMS), "use_item", "play_sound"];
export const ITEMS = ["nitro", "shield", "grip", "jammer"];
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function defaultProgram() {
  return [
    {type:"event",event:"start",id:"default-start",body:[
      {type:"action",op:"set_max",value:150,id:"default-max"},
      {type:"action",op:"set_accel",value:8,id:"default-accel"},
      {type:"action",op:"set_steer",value:3,id:"default-steer"},
      {type:"action",op:"set_brake",value:5,id:"default-brake"},
      {type:"action",op:"set_target",value:230,id:"default-target"}
    ]},
    {type:"event",event:"curve_enter",id:"default-curve",body:[
      {type:"if",id:"default-if",condition:{type:"condition",kind:"curve",id:"default-cond"},then:[
        {type:"action",op:"set_target",value:75,id:"default-curve-target"}
      ],else:[{type:"action",op:"set_target",value:145,id:"default-curve-else"}]}
    ]},
    {type:"event",event:"curve_leave",id:"default-leave",body:[
      {type:"action",op:"set_target",value:230,id:"default-leave-target"}
    ]},
    {type:"event",event:"key",key:"Space",id:"default-key",body:[
      {type:"if",id:"default-item-if",condition:{type:"condition",kind:"has_item",id:"default-has-item"},
        then:[{type:"action",op:"use_item",id:"default-use-item"}],else:[]}
    ]},
    {type:"event",event:"pickup",id:"default-pickup",body:[
      {type:"action",op:"play_sound",id:"default-sound"}
    ]}
  ];
}
function fail(message) { throw new Error(message); }
export function validateProgram(source, topic="free") {
  if (!Array.isArray(source) || source.length>18) fail("事件積木數量過多，最多 18 組");
  let count=0; const ids=new Set();
  function idCheck(n) {
    if(typeof n.id!=="string" || n.id.length<1 || n.id.length>110 || /[\u0000-\u001f<>]/.test(n.id)) fail("積木識別資料有誤，請重新放置積木");
    if(ids.has(n.id)) fail("積木有重複識別碼，請重新拖曳");
    ids.add(n.id);
    if(++count>100) fail("一次最多使用 100 個積木");
  }
  function body(list,depth) {
    if(!Array.isArray(list) || list.length>24 || depth>8) fail("積木巢狀太深或數量太多");
    for(const n of list) {
      if(!n || typeof n!=="object") fail("找到無法辨認的積木");
      idCheck(n);
      if(n.type==="action") {
        if(!ACTIONS.includes(n.op)) fail("這個動作積木尚未開放");
        if(PARAMS[n.op]) {
          if(typeof n.value!=="number" || !Number.isFinite(n.value)) fail("請輸入有效的數字");
          const [lo,hi]=PARAMS[n.op];
          if(n.value<lo || n.value>hi) fail("數值超出合理範圍：" + n.op + "（" + lo + "～" + hi + "）");
        }
      } else if(n.type==="if") {
        if(!n.condition || n.condition.type!=="condition" || !CONDITIONS.includes(n.condition.kind)) fail("如果積木需要正確的六角形條件");
        idCheck(n.condition);
        if(["speed_gt","obstacle_near"].includes(n.condition.kind) && (!Number.isFinite(n.condition.value) || n.condition.value<0 || n.condition.value>250)) fail("條件數值必須介於 0 到 250");
        if(n.condition.kind==="item_kind" && !ITEMS.includes(n.condition.item)) fail("請選擇有效的道具種類");
        body(n.then,depth+1);body(n.else,depth+1);
      } else fail("動作區只能放入動作或如果／否則積木");
    }
  }
  for(const e of source) {
    if(!e || e.type!=="event" || !EVENTS.includes(e.event)) fail("程式最外層必須是事件帽子積木");
    idCheck(e);
    if(e.event==="key" && !["Space","Shift","e"].includes(e.key)) fail("按鍵事件只能選擇空白、Shift 或 E");
    body(e.body,0);
  }
  if(topic!=="free" && !Object.hasOwn(TOPICS,topic)) fail("未知的課程主題");
  if(topic!=="free") {
    // Compare the code's syntax tree to the baseline, allowing only the assigned learning target.
    const normalized=(v)=>{
      if(Array.isArray(v))return v.map(normalized);
      if(v && typeof v==="object") {
        const out={};
        for(const k of Object.keys(v).sort())if(k!=="id")out[k]=normalized(v[k]);
        return out;
      }
      return v;
    };
    const copy=normalized(source), baseline=normalized(defaultProgram());
    if(topic==="max" || topic==="accel") {
      const op=topic==="max"?"set_max":"set_accel";
      const change=(tree)=>{for(const e of tree)for(const n of e.body||[])if(n.op===op)n.value="EDITABLE";};
      change(copy);change(baseline);
      if(JSON.stringify(copy)!==JSON.stringify(baseline)) fail("本回合只能修改指定的 " + TOPICS[topic] + " 積木；其他積木請保留原樣");
    } else {
      const eventAllowed=topic==="curve"?["curve_enter"]:["pickup","key"];
      const scrub=(tree)=>tree.map(e=>eventAllowed.includes(e.event)?{event:e.event,type:"event",key:e.key||null}:e);
      if(JSON.stringify(scrub(copy))!==JSON.stringify(scrub(baseline)))fail("本回合僅能修改指定事件的積木，其他設定請保留原樣");
    }
  }
  return JSON.parse(JSON.stringify(source));
}
export function makeTrack(which="rookie") {
  const path=[], points=360;
  for(let i=0;i<points;i++) {
    const t=i*2*Math.PI/points;
    const wave=which==="rookie"?0:which==="curves"?65:40;
    const inner=which==="curves"?55:20;
    path.push({
      x:500+(285+wave*Math.sin(3*t)+inner*Math.cos(5*t))*Math.cos(t),
      y:343+(206+wave*.65*Math.cos(3*t)+inner*.5*Math.sin(4*t))*Math.sin(t)
    });
  }
  const obstacles=(which==="rookie"?[68,211]:which==="curves"?[55,115,209,280]:[75,180,260,335]).map((idx,i)=>({
    x:path[idx].x+(i%2?15:-18), y:path[idx].y+(i%2?15:-18), r:17
  }));
  const pickups=(which==="items"?[30,94,158,225,302]:[80,255]).map((idx,i)=>({
    x:path[idx].x,y:path[idx].y,kind:ITEMS[i%ITEMS.length],idx
  }));
  const zones=(which==="items"?[52,203]:[115]).map(idx=>({idx,length:12}));
  return {id:which,path,obstacles,pickups,zones,width:105};
}
export function nearest(track,x,y) {
  let best=Infinity,idx=0;
  for(let i=0;i<track.path.length;i++) {
    const p=track.path[i],d=(p.x-x)**2+(p.y-y)**2;
    if(d<best){best=d;idx=i;}
  }
  return {idx,distance:Math.sqrt(best)};
}
export function isCurve(track,idx) {
  const n=track.path.length, a=track.path[(idx+n-9)%n],b=track.path[idx],c=track.path[(idx+9)%n];
  const ang1=Math.atan2(b.y-a.y,b.x-a.x),ang2=Math.atan2(c.y-b.y,c.x-b.x);
  const diff=Math.atan2(Math.sin(ang2-ang1),Math.cos(ang2-ang1));
  return Math.abs(diff)>(track.id==="rookie"?.37:.47);
}
export function createCar(id,name,slot,track,program=defaultProgram()) {
  const p=track.path[slot*3], q=track.path[slot*3+1];
  const heading=Math.atan2(q.y-p.y,q.x-p.x), norm=heading+Math.PI/2;
  return {
    id,name,slot,x:p.x+Math.cos(norm)*(slot?25:-25),y:p.y+Math.sin(norm)*(slot?25:-25),
    angle:heading,speed:0,progress:0,laps:0,checkpoint:false,curve:false,offroad:false,
    ready:false,finished:false,finishedAt:null, collisions:0,avgAccumulator:0,samples:0,
    peak:0,events:0,boostUntil:0,shieldUntil:0,gripUntil:0,jammedUntil:0,
    item:null,itemCount:0,lastHit:0,picked:new Set(),zoneInside:false,
    input:{up:false,down:false,left:false,right:false},program,
    tuning:{max:150,accel:8,steer:3,brake:5,target:150},
    trace:[],logs:[],lastDiagnostic:"", help:false
  };
}
export function simpleCar(c) {
  return {id:c.id,name:c.name,slot:c.slot,x:c.x,y:c.y,angle:c.angle,speed:Math.round(c.speed),
    progress:c.progress,laps:c.laps,finished:c.finished,finishedAt:c.finishedAt,
    collisions:c.collisions,average:c.samples?Math.round(c.avgAccumulator/c.samples):0,
    peak:Math.round(c.peak),events:c.events,item:c.item,ready:c.ready,
    curve:c.curve,offroad:c.offroad,boost:c.boostUntil>0,shield:c.shieldUntil>0,
    grip:c.gripUntil>0,jammed:c.jammedUntil>0,
    tuning:{...c.tuning},trace:c.trace.slice(-6),lastDiagnostic:c.lastDiagnostic,
    help:c.help};
}
export function execute(c,event,ctx={},now=Date.now(),emit=()=>{}) {
  const matched=c.program.filter(e=>e.event===event && (event!=="key"||e.key===ctx.key));
  for(const evt of matched) {
    let steps=0;
    function log(n,message) {
      const info={id:n.id,event,message,at:now};
      c.trace.push(info);if(c.trace.length>35)c.trace.shift();
      emit(info);
    }
    function act(list) {
      for(const node of list) {
        if(++steps>120)return;
        if(node.type==="if") {
          const condition=node.condition;
          let yes=false;
          if(condition.kind==="curve")yes=c.curve;
          else if(condition.kind==="speed_gt")yes=c.speed>condition.value;
          else if(condition.kind==="collision")yes=!!ctx.collision;
          else if(condition.kind==="has_item")yes=!!c.item;
          else if(condition.kind==="obstacle_near")yes=(ctx.obstacleDistance??999)<condition.value;
          else if(condition.kind==="item_kind")yes=c.item===condition.item;
          log(condition,yes?"條件成立，執行「那麼」":"條件不成立，執行「否則」");
          log(node,yes?"走入「那麼」":"走入「否則」");
          act(yes?node.then:node.else);
        } else if(node.type==="action") {
          if(node.op==="set_max")c.tuning.max=node.value;
          if(node.op==="set_accel")c.tuning.accel=node.value;
          if(node.op==="set_steer")c.tuning.steer=node.value;
          if(node.op==="set_brake")c.tuning.brake=node.value;
          if(node.op==="set_target")c.tuning.target=node.value;
          if(node.op==="change_speed")c.speed=clamp(c.speed+node.value,0,c.tuning.max);
          if(node.op==="use_item" && c.item) {
            const used=c.item;c.item=null;c.itemCount=0;
            if(used==="nitro")c.boostUntil=now+3200;
            if(used==="shield")c.shieldUntil=now+6500;
            if(used==="grip")c.gripUntil=now+6500;
            if(used==="jammer")emit({effect:"jammer",actor:c.id,at:now});
            log(node,"已使用道具：" + used);
          } else log(node,node.op==="use_item"?"目前沒有可用道具":node.op+" 已執行");
        }
      }
    }
    c.events++;log(evt,"事件觸發：" + event);act(evt.body);
  }
}
export function stepCar(c,track,dt,now,emit=()=>{},difficulty=2) {
  if(c.finished)return;
  const near0=nearest(track,c.x,c.y);
  const nearObstacle=Math.min(...track.obstacles.map(o=>Math.hypot(o.x-c.x,o.y-c.y)),999);
  if(c.input.up) c.speed+=c.tuning.accel*4.2*dt;
  else c.speed-=19*dt;
  if(c.input.down)c.speed-=c.tuning.brake*13*dt;
  const boosted=c.boostUntil>now;
  const gripped=c.gripUntil>now;
  const jammed=c.jammedUntil>now;
  const max= Math.min(c.tuning.max,c.tuning.target)+(boosted?55:0);
  c.speed=clamp(c.speed,0,Math.max(35,max));
  const turn=(Number(c.input.right)-Number(c.input.left));
  c.angle+=turn*c.tuning.steer*.57*dt*(.35+.65*Math.min(1,c.speed/110))*(jammed?.55:1);
  const gripFactor=gripped?1:Math.max(.7,1-(c.tuning.steer-3)*.055);
  c.x+=Math.cos(c.angle)*c.speed*dt*gripFactor;
  c.y+=Math.sin(c.angle)*c.speed*dt*gripFactor;
  const near=nearest(track,c.x,c.y);
  c.progress=near.idx;
  c.offroad=near.distance>track.width/2;
  if(c.offroad)c.speed=Math.max(0,c.speed-(gripped?20:difficulty===1?55:difficulty===3?110:82)*dt);
  const curve=isCurve(track,near.idx);
  if(curve!==c.curve) {
    c.curve=curve;execute(c,curve?"curve_enter":"curve_leave",{obstacleDistance:nearObstacle},now,emit);
    if(curve&&!c.program.some(e=>e.event==="curve_enter"))c.lastDiagnostic="進入彎道了，試試放入「當進入彎道時」的事件積木";
  }
  for(let i=0;i<track.obstacles.length;i++) {
    const o=track.obstacles[i];
    if(Math.hypot(c.x-o.x,c.y-o.y)<o.r+10 && now-c.lastHit>1700) {
      c.lastHit=now;
      if(c.shieldUntil<=now){c.speed*=difficulty===1?.35:difficulty===3?.16:.24;c.collisions++;c.lastDiagnostic="撞到障礙物！可使用條件判斷或防護盾";}
      execute(c,"collision",{collision:true},now,emit);
    }
  }
  track.pickups.forEach((p,i)=>{
    if(!c.picked.has(i)&&Math.hypot(c.x-p.x,c.y-p.y)<24) {
      c.picked.add(i);c.item=p.kind;c.itemCount=1;
      execute(c,"pickup",{item:p.kind},now,emit);
    }
  });
  if(c.picked.size===track.pickups.length)c.picked.clear();
  const zone=track.zones.some(z=>Math.abs(near.idx-z.idx)<z.length);
  if(zone&&!c.zoneInside){c.zoneInside=true;c.speed=Math.min(c.tuning.max+25,c.speed+22);execute(c,"boost_zone",{},now,emit);}
  if(!zone)c.zoneInside=false;
  if(near.idx>155 && near.idx<205)c.checkpoint=true;
  const crossed=c.progress<22 && near0.idx>track.path.length-25;
  if(crossed && c.checkpoint) {
    c.checkpoint=false;c.laps++;execute(c,"line",{},now,emit);
  }
  c.avgAccumulator+=c.speed;c.samples++;c.peak=Math.max(c.peak,c.speed);
  c.boostUntil=c.boostUntil>now?c.boostUntil:0;
  c.shieldUntil=c.shieldUntil>now?c.shieldUntil:0;
  c.gripUntil=c.gripUntil>now?c.gripUntil:0;
  c.jammedUntil=c.jammedUntil>now?c.jammedUntil:0;
}
export function finishIfNeeded(c,laps,elapsed,now,emit=()=>{}) {
  if(!c.finished && c.laps>=laps) {
    c.finished=true;c.finishedAt=Math.round(elapsed*100)/100;
    execute(c,"finish",{},now,emit);
    return true;
  }
  return false;
}

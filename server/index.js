import express from "express";
import {createServer as nodeServer} from "node:http";
import {randomBytes} from "node:crypto";
import {Server} from "socket.io";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {ACTIONS,PARAMS,TOPICS,TRACKS,clamp,createCar,defaultProgram,
  execute,finishIfNeeded,makeTrack,rescueCarToTrack,simpleCar,stepCar,validateProgram} from "./core.js";

const secret=()=>randomBytes(24).toString("hex");
const roomCode=()=>randomBytes(3).toString("hex").toUpperCase();
const dirname=path.dirname(fileURLToPath(import.meta.url));
const cleanName=(name)=>String(name||"學生").trim().slice(0,16).replace(/[<>]/g,"")||"學生";
const clone=x=>JSON.parse(JSON.stringify(x));
const rooms=new Map();
const error=(ack,message)=>typeof ack==="function"&&ack({ok:false,error:message});
const okay=(ack,data={})=>typeof ack==="function"&&ack({ok:true,...data});

function makeRoom(code,teacherToken) {
  return {code,teacherToken,teacherSocket:null,students:[null,null],phase:"tuning",
    topic:"max",track:"rookie",laps:2,difficulty:1,free:false,
    version:0,cars:[],startAt:0,elapsed:0,pausedAt:0,round:1,history:[],
    countdownAt:0,lastTick:Date.now(),created:Date.now(),messages:[]};
}
function playerView(s) {
  return s?{id:s.id,name:s.name,connected:!!s.socketId,ready:s.ready,
    locked:s.locked,help:!!s.help,draft:s.draft,
    lastError:s.lastError,version:s.version,attempts:s.attempts,
    errors:s.errors,fixes:s.fixes,modified:s.modified}:null;
}
function view(room,teacher=false) {
  return {code:room.code,phase:room.phase,topic:room.topic,track:room.track,
    laps:room.laps,difficulty:room.difficulty,free:room.free,
    round:room.round,elapsed:room.elapsed,countdownAt:room.countdownAt,
    version:room.version,students:room.students.map(s=>teacher?playerView(s):
      s?{id:s.id,name:s.name,connected:!!s.socketId,ready:s.ready,locked:s.locked,help:!!s.help}:null),
    cars:room.cars.map(simpleCar),history:teacher?room.history:room.history.slice(-4),
    messages:room.messages.slice(-12)};
}
function notify(io,room) {
  io.to(room.code).emit("room:update",view(room,false));
  if(room.teacherSocket)io.to(room.teacherSocket).emit("teacher:update",view(room,true));
}
function restart(room) {
  room.phase="tuning";room.round++;
  room.elapsed=0;room.startAt=0;room.pausedAt=0;room.countdownAt=0;
  room.cars=[];
  room.students.forEach(s=>{if(s){s.ready=false;s.locked=false;s.practice=null;s.help=false;}});
  room.version++;
}
function summary(room) {
  const previous=room.history.at(-1);
  return {round:room.round,topic:room.topic,track:room.track,laps:room.laps,
    cars:room.cars.map(c=>{
      const student=room.students[c.slot];
      const older=previous?.cars.find(p=>p.id===c.id);
      return {id:c.id,name:c.name,finished:c.finished,time:c.finishedAt,
        average:c.samples?Math.round(c.avgAccumulator/c.samples):0,
        peak:Math.round(c.peak),collisions:c.collisions,rescues:c.rescueCount||0,events:c.events,
        program:clone(student?.program||defaultProgram()),modified:student?.modified||[],
        attempts:student?.attempts||0,errors:student?.errors||0,fixes:student?.fixes||0,
        previousTime:older?.time??null,previousAverage:older?.average??null};
    })};
}
export function createGameServer(options={}) {
  const app=express();
  app.disable("x-powered-by");
  app.get("/api/health",(_req,res)=>res.json({ok:true,name:"雙人程式賽車：極速工程師",rooms:rooms.size}));
  app.use("/vendor/blockly",express.static(path.join(dirname,"../node_modules/blockly"),{maxAge:"7d"}));
  app.use(express.static(path.join(dirname,"../public"),{extensions:["html"]}));
  app.get("*",(_req,res)=>res.sendFile(path.join(dirname,"../public/index.html")));
  const http=nodeServer(app);
  const io=new Server(http,{cors:{origin:false},maxHttpBufferSize:150000,pingTimeout:18000});
  function joinSocket(socket,room,role,slot=null) {
    if(socket.data.code)socket.leave(socket.data.code);
    socket.join(room.code);
    socket.data={code:room.code,role,slot};
  }
  function inside(socket,ack,role) {
    const room=rooms.get(socket.data.code);
    if(!room||socket.data.role!==role){error(ack,"沒有這項操作權限");return null;}
    if(role==="teacher"&&room.teacherSocket!==socket.id){error(ack,"教師權限已失效，請重新進入房間");return null;}
    if(role==="student"&&room.students[socket.data.slot]?.socketId!==socket.id){error(ack,"連線已轉移到其他裝置");return null;}
    return room;
  }
  function trace(room,car,entry) {
    const session=room.students[car.slot];
    if(session?.socketId)io.to(session.socketId).emit("block:trace",entry);
    if(room.teacherSocket)io.to(room.teacherSocket).emit("block:trace",{...entry,playerId:car.id});
    if(entry.effect==="jammer")for(const other of room.cars)if(other.id!==car.id)other.jammedUntil=Date.now()+2500;
  }
  function buildCars(room) {
    const track=makeTrack(room.track);
    room.cars=room.students.filter(Boolean).map(s=>{
      const car=createCar(s.id,s.name,s.slot,track,clone(s.program));
      return car;
    });
    return track;
  }
  function finish(room) {
    if(room.phase==="results")return;
    room.phase="results";
    room.history.push(summary(room));
    if(room.history.length>40)room.history.shift();
    room.version++;
    notify(io,room);
  }
  io.on("connection",socket=>{
    socket.on("room:create",(_payload,ack)=>{
      let code=roomCode();while(rooms.has(code))code=roomCode();
      const token=secret(),room=makeRoom(code,token);
      rooms.set(code,room);room.teacherSocket=socket.id;joinSocket(socket,room,"teacher");
      okay(ack,{code,token,role:"teacher",room:view(room,true)});
      notify(io,room);
    });
    socket.on("room:join",(data={},ack)=>{
      const code=String(data.code||"").trim().toUpperCase();
      const room=rooms.get(code);
      if(!room)return error(ack,"找不到房間，請確認六位代碼");
      const token=String(data.token||"");
      if(token&&token===room.teacherToken) {
        const old=room.teacherSocket;
        if(old&&old!==socket.id)io.to(old).emit("session:replaced");
        room.teacherSocket=socket.id;joinSocket(socket,room,"teacher");
        okay(ack,{code,token,role:"teacher",room:view(room,true)});
        notify(io,room);return;
      }
      let slot=room.students.findIndex(s=>s&&s.token===token&&token.length>10);
      if(slot<0){
        slot=room.students.findIndex(s=>!s);
        if(slot<0)return error(ack,"房間已滿（最多兩位學生）");
        const id="p"+(slot+1);
        room.students[slot]={id,slot,name:cleanName(data.name),token:secret(),
          socketId:null,ready:false,locked:false,help:false,
          draft:defaultProgram(),program:defaultProgram(),version:0,
          attempts:0,errors:0,fixes:0,lastError:"",modified:[],practice:null};
      }
      const student=room.students[slot];
      if(student.socketId&&student.socketId!==socket.id)io.to(student.socketId).emit("session:replaced");
      student.socketId=socket.id;
      if(data.name)student.name=cleanName(data.name);
      joinSocket(socket,room,"student",slot);
      okay(ack,{code,token:student.token,role:"student",playerId:student.id,
        program:student.draft,room:view(room,false)});
      notify(io,room);
    });
    socket.on("teacher:set",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      if(!["tuning","results"].includes(room.phase))return error(ack,"比賽進行時不能變更課程設定");
      const topicChanged=data.topic!==undefined && data.topic!==room.topic;
      if(data.topic!==undefined) {
        if(!Object.hasOwn(TOPICS,data.topic))return error(ack,"未知課程主題");
        room.topic=data.topic;
      }
      if(data.track!==undefined) {
        if(!TRACKS.includes(data.track))return error(ack,"沒有這張賽道");
        room.track=data.track;
      }
      if(data.laps!==undefined) {
        if(!Number.isInteger(data.laps)||data.laps<1||data.laps>5)return error(ack,"圈數只能是 1～5");
        room.laps=data.laps;
      }
      if(data.difficulty!==undefined) {
        if(!Number.isInteger(data.difficulty)||data.difficulty<1||data.difficulty>3)return error(ack,"難度只能是 1～3");
        room.difficulty=data.difficulty;
      }
      if(topicChanged) {
        room.students.forEach(s=>{if(s){s.locked=false;s.ready=false;s.draft=defaultProgram();s.program=defaultProgram();s.version++;if(s.socketId)io.to(s.socketId).emit("program:replace",{program:s.draft,reason:"老師已切換主題，載入預設積木"});}});
      }
      room.version++;okay(ack,{room:view(room,true)});notify(io,room);
    });
    socket.on("program:draft",(data={},ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      if(!["tuning","results"].includes(room.phase)||s.locked)return error(ack,"程式已鎖定或賽車正在進行");
      try {
        const draft=validateProgram(data.program,room.topic);
        s.draft=draft;s.version++;s.lastError="";s.modified=calculateModified(draft);
        if(s.errors>0)s.fixes++;okay(ack,{version:s.version});
        notify(io,room);
      }catch(e){s.errors++;s.lastError=e.message;error(ack,e.message);notify(io,room);}
    });
    socket.on("program:lock",(data={},ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      if(room.phase!=="tuning")return error(ack,"目前不是程式調校階段");
      try {
        const validated=validateProgram(data.program,room.topic);
        s.draft=validated;s.program=clone(validated);s.locked=true;s.ready=true;
        s.attempts++;s.modified=calculateModified(validated);s.version++;
        okay(ack,{ready:true});notify(io,room);
      }catch(e){s.errors++;s.lastError=e.message;error(ack,e.message);notify(io,room);}
    });
    socket.on("program:unlock",(_data,ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      if(room.phase!=="tuning")return error(ack,"正式比賽中不可解除鎖定");
      s.ready=false;s.locked=false;okay(ack);notify(io,room);
    });
    socket.on("teacher:race",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      const action=data.action;
      if(action==="start") {
        if(room.phase!=="tuning" && room.phase!=="results")return error(ack,"目前無法開始新比賽");
        if(room.students.filter(Boolean).length===0)return error(ack,"至少一名學生加入後才能開始");
        if(room.students.filter(Boolean).some(s=>!s.ready))return error(ack,"請等待已加入的學生鎖定積木並準備");
        room.students.forEach(s=>{if(s)s.practice=null;});
        buildCars(room);room.elapsed=0;room.phase="countdown";room.countdownAt=Date.now()+3000;
      }else if(action==="pause" && ["racing","countdown"].includes(room.phase)){
        room.pausedAt=Date.now();room.pausedPhase=room.phase;room.phase="paused";
      }else if(action==="resume"&&room.phase==="paused"){
        const duration=Date.now()-room.pausedAt;
        if(room.pausedPhase==="countdown")room.countdownAt+=duration;
        room.phase=room.pausedPhase||"racing";
      }else if(action==="restart"){
        restart(room);
      }else if(action==="finish"&&room.phase==="racing"){
        finish(room);
      }else return error(ack,"這個時間點不能執行此指令");
      room.version++;okay(ack);notify(io,room);
    });
    socket.on("drive",(data={})=>{
      const room=inside(socket,null,"student");if(!room)return;
      const s=room.students[socket.data.slot],input={};
      for(const key of ["up","down","left","right"])input[key]=data[key]===true;
      if(s.practice)s.practice.input=input;
      const car=room.cars.find(c=>c.id===s.id);
      if(car&&room.phase==="racing")car.input=input;
    });
    socket.on("key:event",(data={},ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      const key=String(data.key||"");
      if(!["Space","Shift","e"].includes(key))return error(ack,"這個按鍵尚未開放");
      const car=s.practice||room.cars.find(c=>c.id===s.id);
      if(!car || (room.phase!=="racing"&&!s.practice))return error(ack,"請先開始練習或比賽");
      execute(car,"key",{key},Date.now(),entry=>trace(room,car,entry));
      okay(ack);
    });
    socket.on("student:rescue",(_data,ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      const practice=room.phase==="tuning"&&!!s.practice;
      if(!practice&&room.phase!=="racing")return error(ack,"僅練習或正式競速時可以回賽道");
      const car=practice?s.practice:room.cars.find(c=>c.id===s.id);
      if(!car||car.finished)return error(ack,"目前沒有進行中的賽車");
      const now=Date.now();
      if(now-car.lastRescue<1500)return error(ack,"稍等一下再回賽道");
      rescueCarToTrack(car,makeTrack(room.track),now);
      if(practice){if(s.socketId)io.to(s.socketId).emit("practice:update",simpleCar(car));}
      else io.to(room.code).emit("race:snapshot",{phase:room.phase,elapsed:room.elapsed,at:now,countdownAt:room.countdownAt,cars:room.cars.map(simpleCar)});
      okay(ack,{rescueCount:car.rescueCount});
    });
    socket.on("student:test",(data={},ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];
      if(room.phase!=="tuning")return error(ack,"只有調校時可以測試");
      if(data.stop){s.practice=null;okay(ack);notify(io,room);return;}
      try {
        const program=validateProgram(data.program,room.topic);
        const car=createCar(s.id,s.name,s.slot,makeTrack(room.track),program);
        s.practice=car;execute(car,"start",{},Date.now(),entry=>trace(room,car,entry));
        okay(ack);notify(io,room);
      }catch(e){s.lastError=e.message;s.errors++;error(ack,e.message);notify(io,room);}
    });
    socket.on("student:help",(_data,ack)=>{
      const room=inside(socket,ack,"student");if(!room)return;
      const s=room.students[socket.data.slot];s.help=true;
      room.messages.push({by:s.name,text:"請求老師協助",at:Date.now(),type:"help"});
      okay(ack);notify(io,room);
    });
    socket.on("teacher:hint",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      const student=room.students.find(s=>s&&s.id===data.playerId);
      if(!student)return error(ack,"找不到學生");
      const message=String(data.message||"").trim().slice(0,180);
      if(!message)return error(ack,"請先輸入提示內容");
      const item={by:"老師",to:student.id,text:message,blockId:String(data.blockId||"").slice(0,110),at:Date.now(),type:"hint"};
      room.messages.push(item);
      if(student.socketId)io.to(student.socketId).emit("teacher:message",item);
      student.help=false;okay(ack);notify(io,room);
    });
    socket.on("teacher:assist",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      if(room.phase!=="tuning")return error(ack,"只有調校階段才能協助修改");
      const s=room.students.find(v=>v&&v.id===data.playerId);
      if(!s)return error(ack,"找不到指定學生");
      if(!PARAMS[data.op])return error(ack,"只能協助調整數值積木");
      const value=Number(data.value),[a,b]=PARAMS[data.op];
      if(!Number.isFinite(value)||value<a||value>b)return error(ack,"調整值超出 " + a + "～" + b + " 範圍");
      const candidate=clone(s.draft);
      let done=false;
      function edit(arr){for(const n of arr){if(n.type==="action"&&n.op===data.op&&!done){n.value=value;done=true;}if(n.type==="if"){edit(n.then);edit(n.else);}}}
      candidate.filter(e=>room.topic==="curve"?e.event==="curve_enter":room.topic==="item"?["pickup","key"].includes(e.event):true).forEach(e=>edit(e.body));
      if(!done)return error(ack,"學生尚未放置這個數值積木");
      try{s.draft=validateProgram(candidate,room.topic);s.locked=false;s.ready=false;
        s.version++;s.modified=calculateModified(s.draft);
        const reason="老師協助修改了 " + data.op + " → " + value;
        room.messages.push({by:"老師",to:s.id,text:reason,type:"assist",at:Date.now()});
        if(s.socketId)io.to(s.socketId).emit("program:replace",{program:s.draft,reason});
        okay(ack);notify(io,room);
      }catch(e){error(ack,e.message);}
    });
    socket.on("teacher:reset",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      if(room.phase!=="tuning")return error(ack,"只有調校階段可重設學生積木");
      const s=room.students.find(v=>v&&v.id===data.playerId);
      if(!s)return error(ack,"找不到指定學生");
      s.draft=defaultProgram();s.program=defaultProgram();s.ready=false;s.locked=false;s.lastError="";s.version++;s.modified=[];
      if(s.socketId)io.to(s.socketId).emit("program:replace",{program:s.draft,reason:"老師已恢復預設程式"});
      okay(ack);notify(io,room);
    });
    socket.on("teacher:stopTest",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      const s=room.students.find(v=>v&&v.id===data.playerId);
      if(!s)return error(ack,"找不到學生");
      s.practice=null;if(s.socketId)io.to(s.socketId).emit("practice:stopped");
      okay(ack);notify(io,room);
    });
    socket.on("teacher:rescue",(data={},ack)=>{
      const room=inside(socket,ack,"teacher");if(!room)return;
      const car=room.cars.find(v=>v.id===data.playerId);
      if(!car)return error(ack,"找不到賽車");
      rescueCarToTrack(car,makeTrack(room.track),Date.now());
      okay(ack);notify(io,room);
    });
    socket.on("disconnect",()=>{
      const room=rooms.get(socket.data.code);if(!room)return;
      if(socket.data.role==="teacher" && room.teacherSocket===socket.id)room.teacherSocket=null;
      if(socket.data.role==="student"){
        const s=room.students[socket.data.slot];if(s&&s.socketId===socket.id){s.socketId=null;if(s.practice)s.practice.input={up:false,down:false,left:false,right:false};}
      }
      notify(io,room);
    });
  });
  function calculateModified(program) {
    const base=defaultProgram(),out=[];
    const values=(source)=>{
      const map=new Map();
      function walk(body){
        for(const n of body||[]){
          if(n.type==="action" && PARAMS[n.op] && !map.has(n.op))map.set(n.op,n.value);
          if(n.type==="if"){walk(n.then);walk(n.else);}
        }
      }
      for(const e of source)walk(e.body);
      return map;
    };
    const before=values(base),after=values(program);
    for(const [op,value] of after){
      if(before.has(op)&&before.get(op)!==value){
        const label={set_max:"最高速度",set_accel:"加速度",set_steer:"轉向靈敏度",
          set_brake:"煞車強度",set_target:"目標速度",change_speed:"速度"}[op]||op;
        out.push(label+": "+before.get(op)+" → "+value);
      }
    }
    const canonical=x=>JSON.stringify(x,(key,value)=>key==="id"?undefined:value);
    if(!out.length&&canonical(program)!==canonical(base))out.push("事件／條件積木已調整");
    return out;
  }
  let ticks=0;
  const timer=setInterval(()=>{
    ticks++;
    const now=Date.now();
    for(const room of rooms.values()){
      const dt=clamp((now-room.lastTick)/1000,0,.09);
      room.lastTick=now;
      if(room.phase==="countdown"&&now>=room.countdownAt){
        room.phase="racing";room.startAt=now;room.elapsed=0;
        room.cars.forEach(c=>execute(c,"start",{},now,entry=>trace(room,c,entry)));
        notify(io,room);
      }
      if(room.phase==="racing"){
        room.elapsed+=(dt);
        const track=makeTrack(room.track);
        for(const c of room.cars){
          stepCar(c,track,dt,now,entry=>trace(room,c,entry),room.difficulty);
          finishIfNeeded(c,room.laps,room.elapsed,now,entry=>trace(room,c,entry));
        }
        if(room.cars.length&& (room.cars.every(c=>c.finished)||room.elapsed>200))finish(room);
      }
      if(room.phase==="tuning"){
        const track=makeTrack(room.track);
        room.students.forEach(s=>{
          if(!s?.practice)return;
          stepCar(s.practice,track,dt,now,entry=>trace(room,s.practice,entry),room.difficulty);
          if(s.socketId)io.to(s.socketId).emit("practice:update",{...simpleCar(s.practice),at:now});
        });
      }
      if(["racing","paused","countdown"].includes(room.phase)){
        io.to(room.code).emit("race:snapshot",{phase:room.phase,elapsed:room.elapsed,at:now,
          countdownAt:room.countdownAt,cars:room.cars.map(simpleCar)});
      }
    }
    if(ticks%2400===0){for(const [key,r]of rooms)if(!r.teacherSocket&&!r.students.some(s=>s?.socketId)&&Date.now()-r.created>6*60*60*1000)rooms.delete(key);}
  },50);
  return {app,http,io,rooms,
    start:(port=process.env.PORT||3000)=>new Promise(resolve=>http.listen(port,"0.0.0.0",()=>resolve(http.address().port))),
    close:()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>http.close(()=>resolve()));})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const game=createGameServer();
  game.start().then(port=>console.log("Coding Racing online at port "+port));
}

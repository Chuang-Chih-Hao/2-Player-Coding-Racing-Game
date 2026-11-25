import test from "node:test";
import assert from "node:assert/strict";
import {io as connect} from "socket.io-client";
import {createGameServer} from "../server/index.js";
import {createCar,defaultProgram,execute,makeTrack,missingDriveBlocks,nearest,rescueCarToTrack,stepCar,finishIfNeeded,validateProgram} from "../server/core.js";

function builtProgram(){
 const act=(op,value,id)=>({type:"action",op,value,id});
 return [{type:"event",event:"start",id:"default-start",body:[act("set_max",150,"max"),act("set_accel",8,"accel"),act("set_steer",3,"steer"),act("set_brake",5,"brake"),act("set_target",230,"target")]},
 {type:"event",event:"curve_enter",id:"curve",body:[act("set_target",75,"curve-target")]},
 {type:"event",event:"curve_leave",id:"leave",body:[act("set_target",230,"leave-target")]},
 {type:"event",event:"key",key:"Space",id:"key",body:[{type:"action",op:"use_item",id:"use"}]},
 {type:"event",event:"pickup",id:"pickup",body:[{type:"action",op:"play_sound",id:"sound"}]}];
}

test("safe interpreter validates input and permits editing events in any lesson",()=>{
 const p=builtProgram();
 assert.equal(validateProgram(p,"max").length,5);
 assert.throws(()=>validateProgram([{type:"event",event:"start",id:"e",body:[{type:"action",op:"run_js",id:"bad"}]}]),/尚未開放/);
 assert.throws(()=>validateProgram([{type:"event",event:"start",id:"e",body:[{type:"action",op:"set_max",value:99999,id:"bad"}]}]),/範圍/);
 const altered=structuredClone(p);altered[0].body[1].value=11;
 assert.equal(validateProgram(altered,"max")[0].body[1].value,11);
 assert.equal(defaultProgram("max").length,1);
 assert.equal(validateProgram([...defaultProgram("max"),{type:"event",id:"added",event:"pickup",body:[]}],"max").length,2);
 assert.equal(validateProgram([],"max").length,0);
 assert.equal(validateProgram(altered,"accel")[0].body[1].value,11);
 assert.throws(()=>validateProgram([...p,...p],"free"),/重複/);
});
test("real car dynamics respond to Scratch blocks and conditions",()=>{
 const track=makeTrack("rookie"),p1=builtProgram(),p2=builtProgram();
 p1[0].body[0].value=210;p2[0].body[0].value=95;
 const a=createCar("a","A",0,track,p1),b=createCar("b","B",1,track,p2);
 execute(a,"start");execute(b,"start");
 assert.equal(a.tuning.max,210);assert.equal(b.tuning.max,95);
 a.input.up=true;b.input.up=true;
 let now=Date.now();
 for(let i=0;i<150;i++){
  // Hold both cars on the same stretch of legal asphalt to isolate top-speed behavior.
  const p=track.path[90],q=track.path[91];
  for(const c of [a,b]){c.x=p.x;c.y=p.y;c.angle=Math.atan2(q.y-p.y,q.x-p.x);}
  now+=50;stepCar(a,track,.05,now);stepCar(b,track,.05,now);
 }
 assert.ok(a.peak>b.peak,"higher configured speed must affect physical speed");
 a.curve=true;execute(a,"curve_enter");
 assert.equal(a.tuning.target,75);
 a.curve=false;execute(a,"curve_leave");
 assert.equal(a.tuning.target,230);
 a.item="nitro";execute(a,"key",{key:"Space"},now);
 assert.ok(a.boostUntil>=now+3000);assert.equal(a.item,null);
 assert.ok(a.events>=3);assert.ok(a.trace.length>0);
});
test("a simulated keyboard driver can drive a real checkpointed lap",()=>{
 const track=makeTrack("rookie"),car=createCar("lap","Lap driver",0,track,builtProgram());
 execute(car,"start",{},Date.now());
 let now=Date.now(),steps=0;
 for(;steps<2400&&car.laps<1;steps++){
   const {idx}=nearest(track,car.x,car.y);
   const dest=track.path[(idx+11)%track.path.length];
   const desired=Math.atan2(dest.y-car.y,dest.x-car.x);
   const delta=Math.atan2(Math.sin(desired-car.angle),Math.cos(desired-car.angle));
   car.input={up:true,down:Math.abs(delta)>1.1,left:delta<-.045,right:delta>.045};
   now+=50;stepCar(car,track,.05,now);
 }
 assert.ok(car.laps>=1,"Keyboard-like steering must complete a real lap; got "+car.laps+" after "+steps+" steps at "+car.x+","+car.y);
 assert.equal(finishIfNeeded(car,1,steps*.05,now),true);
 assert.ok(car.finishedAt>0);
 assert.ok(car.peak>80,"a real lap must involve a noticeable racing speed; peak="+car.peak);
 console.log("模擬完整一圈：秒數="+(steps*.05).toFixed(1)+"，極速="+Math.round(car.peak)+"，碰撞="+car.collisions);
});
test("repeated road rescues keep progress, avoid obstacles, and restore steering",()=>{
 const track=makeTrack("rookie"),car=createCar("stranded","Stranded",0,track,builtProgram());
 const now=Date.now();execute(car,"start",{},now);
 car.laps=1;car.checkpoint=true;car.progress=180;car.x=500;car.y=343;car.speed=0;
 assert.equal(rescueCarToTrack(car,track,now),true);
 assert.equal(car.laps,1);assert.equal(car.checkpoint,true);
 assert.ok(nearest(track,car.x,car.y).distance<1);
 assert.equal(car.rescueCount,1);assert.equal(car.speed,35);
 assert.ok(track.obstacles.every(o=>Math.hypot(o.x-car.x,o.y-car.y)>48));
 car.x=480;car.y=300;car.speed=0;
 assert.equal(rescueCarToTrack(car,track,now+1800),true);
 assert.equal(car.rescueCount,2);assert.equal(car.laps,1);
 assert.ok(nearest(track,car.x,car.y).distance<1);
 car.input.up=true;execute(car,"start",{},now);
 stepCar(car,track,.05,now+1900);
 assert.ok(car.speed>35,"car must drive again immediately after rescue");
});
test("Socket.IO two-player room, permissions, program locking, race, reconnect and report",async(t)=>{
 const game=createGameServer();
 const port=await game.start(0);
 t.after(async()=>{await game.close();});
 const url="http://127.0.0.1:"+port;
 const clients=[];
 function client(){const c=connect(url,{transports:["websocket"],forceNew:true,reconnection:false});clients.push(c);return c;}
 t.after(()=>clients.forEach(c=>c.disconnect()));
 const emit=(s,name,data={})=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error("socket timeout "+name)),4000);
   s.emit(name,data,result=>{clearTimeout(timer);resolve(result);});
 });
 const teacher=client(),studentA=client(),studentB=client(),outsider=client();
 await Promise.all([teacher,studentA,studentB,outsider].map(c=>new Promise(r=>c.on("connect",r))));
 const health=await fetch(url+"/api/health");assert.equal(health.status,200);
 assert.equal((await health.json()).ok,true);
 const created=await emit(teacher,"room:create");assert.equal(created.ok,true);
 assert.match(created.code,/^[A-F0-9]{6}$/);
 const A=await emit(studentA,"room:join",{code:created.code,name:"閃電 A"});
 const B=await emit(studentB,"room:join",{code:created.code,name:"閃電 B"});
 assert.equal(A.ok,true);assert.equal(B.ok,true);assert.notEqual(A.playerId,B.playerId);
 const denied=await emit(outsider,"room:join",{code:created.code,name:"第三人"});assert.equal(denied.ok,false);
 const illegal=await emit(studentA,"teacher:race",{action:"restart"});assert.equal(illegal.ok,false);
 assert.equal((await emit(outsider,"student:rescue")).ok,false);
 assert.equal((await emit(studentA,"student:rescue")).ok,false);
 const update=await emit(teacher,"teacher:set",{topic:"max",track:"rookie",laps:1});assert.equal(update.ok,true);
 const p1=builtProgram(),p2=builtProgram();p1[0].body[0].value=175;p2[0].body[0].value=90;
 assert.equal((await emit(studentA,"program:lock",{program:defaultProgram()})).ok,false);
 assert.equal((await emit(studentA,"program:draft",{program:p1})).ok,true);
 assert.equal((await emit(studentB,"program:draft",{program:p2})).ok,true);
 assert.equal((await emit(studentA,"program:lock",{program:p1})).ok,true);
 assert.equal((await emit(studentB,"program:lock",{program:p2})).ok,true);
 assert.equal((await emit(teacher,"teacher:race",{action:"start"})).ok,true);
 await new Promise(r=>setTimeout(r,3250));
 const room=game.rooms.get(created.code);
 assert.equal(room.phase,"racing");
 assert.equal(room.cars.length,2);
 const raceFrames=[];
 studentA.on("race:snapshot",pkt=>raceFrames.push(pkt));
 studentA.emit("drive",{up:true,left:false,right:false,down:false});
 studentB.emit("drive",{up:true,left:false,right:false,down:false});
 await new Promise(r=>setTimeout(r,800));
 assert.ok(room.cars[0].speed>0);
 assert.ok(room.cars[1].speed>0);
 assert.ok(raceFrames.length>=8,"20Hz time-stamped snapshots should arrive; count="+raceFrames.length);
 assert.ok(raceFrames.every(pkt=>Number.isFinite(pkt.at)));
 assert.ok(raceFrames.slice(1).every((pkt,i)=>pkt.at>=raceFrames[i].at));
 const rescued=await emit(studentA,"student:rescue");
 assert.equal(rescued.ok,true);assert.equal(rescued.rescueCount,1);
 assert.ok(nearest(makeTrack(room.track),room.cars[0].x,room.cars[0].y).distance<10);
 assert.equal((await emit(studentA,"student:rescue")).ok,false,"cooldown prevents rapid abuse");
 assert.equal((await emit(teacher,"teacher:race",{action:"pause"})).ok,true);
 assert.equal((await emit(studentA,"student:rescue")).ok,false,"rescue is paused along with race");
 assert.equal(room.phase,"paused");
 assert.equal((await emit(teacher,"teacher:race",{action:"resume"})).ok,true);
 assert.equal((await emit(teacher,"teacher:race",{action:"finish"})).ok,true);
 assert.equal(room.history.length,1);
 assert.ok(room.history[0].cars[0].events>0);
 assert.equal((await emit(teacher,"teacher:race",{action:"restart"})).ok,true);
 const assisted=await emit(teacher,"teacher:assist",{playerId:"p1",op:"set_max",value:170});
 assert.equal(assisted.ok,true);
 assert.equal(room.students[0].draft[0].body[0].value,170);
 studentA.disconnect();
 const rejoined=client();await new Promise(r=>rejoined.on("connect",r));
 const returning=await emit(rejoined,"room:join",{code:created.code,token:A.token});
 assert.equal(returning.ok,true);assert.equal(returning.playerId,"p1");
 assert.equal(room.students[0].socketId,rejoined.id);
 let practiceStamp=null;
 rejoined.on("practice:update",pkt=>{practiceStamp=pkt.at;});
 const practice=await emit(rejoined,"student:test",{program:room.students[0].draft});
 assert.equal(practice.ok,true);
 await new Promise(r=>setTimeout(r,125));
 assert.ok(Number.isFinite(practiceStamp),"practice packets must also carry server timestamps");
 assert.equal((await emit(rejoined,"student:rescue")).ok,true,"practice rescue is permitted");
 assert.equal(room.students[0].practice.rescueCount,1);
 assert.equal((await emit(rejoined,"student:test",{stop:true})).ok,true);
 const fake=await emit(outsider,"teacher:hint",{playerId:"p1",message:"x"});
 assert.equal(fake.ok,false);
});

test("student-created yellow events have real effects, and removing a rule removes the effect",()=>{
 const track=makeTrack("rookie"),car=createCar("a","A",0,track,[]);
 car.program=validateProgram([...builtProgram().slice(0,1),{type:"event",id:"when-pickup",event:"pickup",body:[{type:"action",id:"gain",op:"change_speed",value:20}]}],"max");execute(car,"start");
 car.speed=70;execute(car,"pickup");assert.equal(car.speed,90);
 car.program=[];execute(car,"pickup");assert.equal(car.speed,90);
 car.item="nitro";execute(car,"key",{key:"Space"},1000);assert.equal(car.boostUntil,0);assert.equal(car.item,"nitro");
});

test("empty and disconnected functions cannot drive; connected blocks individually enable controls",()=>{
 const track=makeTrack("rookie"),now=Date.now(),blank=createCar("blank","Blank",0,track,defaultProgram());
 execute(blank,"start");blank.input={up:true,down:true,left:false,right:true};
 const x=blank.x,y=blank.y,angle=blank.angle;
 for(let i=0;i<30;i++)stepCar(blank,track,.05,now+i*50,()=>{},1);
 assert.equal(blank.speed,0);assert.equal(blank.x,x);assert.equal(blank.y,y);assert.equal(blank.angle,angle);
 assert.equal(missingDriveBlocks(defaultProgram()).length,4);
 rescueCarToTrack(blank,track,now);assert.equal(blank.speed,0);
 const p=builtProgram();p[0].body=p[0].body.filter(n=>n.op==="set_max"||n.op==="set_accel");
 const partial=createCar("partial","Partial",0,track,p);execute(partial,"start");
 partial.input={up:true,down:false,left:false,right:true};const heading=partial.angle;
 for(let i=0;i<20;i++)stepCar(partial,track,.05,now+i*50,()=>{},1);
 assert.ok(partial.speed>0);assert.equal(partial.angle,heading);assert.equal(partial.tuning.brake,0);
 assert.equal(missingDriveBlocks(p).length,2);
 const full=createCar("full","Full",0,track,builtProgram());execute(full,"start");
 assert.equal(missingDriveBlocks(full.program).length,0);full.speed=60;full.input={up:false,down:true,left:false,right:true};
 const initial=full.angle;stepCar(full,track,.05,now,()=>{},1);assert.ok(full.speed<60-19*.05);assert.notEqual(full.angle,initial);
 full.item="nitro";execute(full,"key",{key:"Space"},now);assert.ok(full.boostUntil>now);
});

/* 雙人程式賽車：學生只接觸彩色 Blockly 積木，從不執行積木產生的 JavaScript。 */
import {RENDER_DELAY_MS,pushMotion,sampleMotion} from './motion.js';
const $=id=>document.getElementById(id);
const roomNames={rookie:"新手練習賽道",curves:"彎道技術賽道",items:"道具競速賽道"};
const topicText={
 max:"本回合只修改「最高速度」積木，看看直線速度提高會發生什麼事。",
 accel:"本回合只修改「加速度」積木，比較起跑與過彎時的反應。",
 curve:"調整「當進入彎道時」的 if / else 事件，讓賽車學會彎道減速。",
 item:"修改「當取得道具」或「當按下按鍵」的程式，決定道具何時使用。",
 free:"自由組合事件、變數與條件判斷，設計自己的賽車策略."
};
const lessonGuide={
 max:"① 找到「當比賽開始時」 ② 點「將最高速度設為」的白色數字 ③ 練習測試",
 accel:"① 找到「當比賽開始時」 ② 點「將加速度設為」的白色數字 ③ 比較起步",
 curve:"① 找到「當進入彎道時」 ② 找「如果／否則」 ③ 調整過彎速度",
 item:"① 找「當按下空白鍵時」 ② 看「如果有道具」 ③ 練習啟動道具",
 free:"可以自由組合不同事件，按「展開全部」查看其餘預設積木。"
};
const opLabels={set_max:"最高速度",set_accel:"加速度",set_steer:"轉向靈敏度",set_brake:"煞車強度",set_target:"目標速度",change_speed:"速度改變"};
const params={set_max:[70,230,150],set_accel:[3,16,8],set_steer:[1,6,3],set_brake:[2,12,5],set_target:[35,230,150],change_speed:[-40,40,10]};
const eventLabels={start:"當比賽開始時",line:"當通過起跑線時",curve_enter:"當進入彎道時",curve_leave:"當離開彎道時",
 collision:"當碰到障礙物時",pickup:"當取得道具時",boost_zone:"當進入加速區時",key:"當按下指定按鍵時",finish:"當通過終點線時"};
const conditionLabels={curve:"目前在彎道",speed_gt:"速度大於",collision:"碰到障礙物",has_item:"有道具",obstacle_near:"距離障礙物小於",item_kind:"道具種類等於"};
const itemLabels={nitro:"氮氣加速",shield:"防護盾",grip:"抓地力",jammer:"干擾器"};
const eventMeanings={
 start:"賽車開始時執行一次下方指令。預設會設定最高速度、加速度、轉向與煞車。",
 line:"完成一圈通過起跑線時才執行，適合設定每圈的變化。",
 curve_enter:"車子開進彎道時才執行，例如把「目標速度」調低，減少衝出彎道。",
 curve_leave:"離開彎道回到直線時執行，預設會把目標速度恢復為 230。",
 collision:"車子碰撞橘色路障時觸發，可以設定碰撞後要做的反應。",
 pickup:"碰到賽道上的黃色道具方塊時觸發；預設會播放提示音。",
 boost_zone:"經過賽道上的青色加速區時觸發。",
 key:"玩家按下這個積木指定的按鍵時才執行，預設空白鍵會嘗試使用道具。",
 finish:"車子跑完設定圈數後執行一次。"
};
function explainBlocklyBlock(block){
 if(!block)return "🟨 黃色積木是事件：發生指定情況才執行裡面的動作。";
 if(block.type.startsWith("event_"))return "🟨 事件｜"+eventMeanings[block.type.slice(6)]+(block.isCollapsed()?" 目前已收合；按上方「展開全部」查看裡面的指令。":"");
 if(block.type.startsWith("act_")){
  const op=block.type.slice(4);
  if(op==="use_item")return "🟪 道具｜使用目前攜帶的道具；必須先撿到道具才有作用。";
  if(op==="play_sound")return "🟪 音效｜觸發此事件時播放提示音，不會改變賽車速度。";
  return "🟧 設定動作｜"+opLabels[op]+"會改變賽車的能力或目前速度；點白色數字修改。";
 }
 if(block.type==="ctrl_ifelse")return "🟦 如果／否則｜先檢查綠色條件，成立做「那麼」，不成立做「否則」。";
 if(block.type.startsWith("cond_"))return "🟩 偵測條件｜判斷「"+conditionLabels[block.type.slice(5)]+"」是否成立，交給藍色的「如果／否則」決定下一步。";
 return "選取不同顏色的積木，可以在這裡查看用途。";
}
const socket=io({reconnection:true,reconnectionDelay:500});
const state={role:null,code:null,token:null,playerId:null,room:null,
  workspace:null,monitor:null,selected:"p1",markBlockId:null,visual:new Map(),cars:[],practice:null,testing:false,
  lastProgramStr:"",lastTeacherProgramStr:"",suppress:false,ready:false,connected:false,topicShown:null,
  lastTrace:"",lastServerError:"",blocksMode:"focus",lastRescue:0,clockOffset:NaN,renderPhase:null};
const canvas=$("raceCanvas"),ctx=canvas.getContext("2d");
const localKey="coding-racing-session-v1";
function toast(message,ms=2700){
  const t=$("toast");t.textContent=message;t.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),ms);
}
function explain(message){$("codeFeedback").textContent=message;
 if(/錯誤|修正|無法|老師提示|超出|未正確/.test(message))$("feedbackPanel").open=true;
}
function call(name,payload={}){
  return new Promise(resolve=>socket.emit(name,payload,result=>{
    if(!result?.ok){const msg=result?.error||"伺服器沒有回應";toast(msg);state.lastServerError=msg;resolve(null);}
    else resolve(result);
  }));
}
function resizeGame(){
  const scale=Math.min(innerWidth/1600,innerHeight/900);
  $("shell").style.width=1600*scale+"px";
  $("shell").style.height=900*scale+"px";
  $("stage").style.zoom=String(scale);
  if(state.workspace)Blockly.svgResize(state.workspace);
  if(state.monitor)Blockly.svgResize(state.monitor);
}
window.addEventListener("resize",resizeGame);resizeGame();
let currentRole="student";
function toggleRole(role){
 currentRole=role;
 $("roleStudent").classList.toggle("active",role==="student");
 $("roleTeacher").classList.toggle("active",role==="teacher");
 $("studentForm").hidden=role!=="student";
 $("teacherForm").hidden=role!=="teacher";
 $("loginError").textContent="";
}
$("roleStudent").onclick=()=>toggleRole("student");
$("roleTeacher").onclick=()=>toggleRole("teacher");
const query=new URLSearchParams(location.search);
$("roomCodeInput").value=(query.get("room")||"").toUpperCase().slice(0,6);
$("joinButton").onclick=async()=>{
 const code=$("roomCodeInput").value.trim().toUpperCase(),name=$("studentName").value.trim();
 if(code.length!==6||!name){$("loginError").textContent="請填入暱稱與六位房間代碼";return;}
 const answer=await call("room:join",{code,name});
 if(answer)enter(answer);
};
$("createButton").onclick=async()=>{const answer=await call("room:create");if(answer)enter(answer);};
socket.on("connect",async()=>{
 state.connected=true;$("statusOnline").textContent="● 已連線";$("statusOnline").classList.remove("off");
 if(state.token && state.code){
   const r=await call("room:join",{code:state.code,token:state.token,name:$("studentName").value});
   if(r)enter(r);
 }
});
socket.on("disconnect",()=>{
 state.connected=false;$("statusOnline").textContent="● 正在重新連線";$("statusOnline").classList.add("off");
});
socket.on("session:replaced",()=>toast("你的登入已轉移到其他裝置，本頁停止控制"));
function enter(answer){
 const previously=state.role;
 state.role=answer.role;state.code=answer.code;state.token=answer.token;
 state.playerId=answer.playerId||null;state.room=answer.room;
 localStorage.setItem(localKey,JSON.stringify({code:answer.code,token:answer.token,role:answer.role}));
 $("home").hidden=true;$("game").hidden=false;
 $("studentPanel").hidden=state.role!=="student";
 $("teacherPanel").hidden=state.role!=="teacher";
 $("roomBadge").textContent="房間 "+state.code;
 if(state.role==="student"){
   if(!state.workspace){initBlockly();loadProgram(answer.program||defaultProgram());}
   else if(answer.program && JSON.stringify(programAstSafe())!==JSON.stringify(answer.program))loadProgram(answer.program);
   explain("拖曳 Scratch 積木，按下練習測試觀察實際效果");
 }else {
   $("teacherCode").textContent=state.code;
   if(!state.monitor)initMonitor();
 }
 updateRoom();
 requestAnimationFrame(()=>{resizeGame();if(state.workspace)Blockly.svgResize(state.workspace);if(state.monitor)Blockly.svgResize(state.monitor);});
}
try{
 const saved=JSON.parse(localStorage.getItem(localKey)||"null");
 if(saved?.code && saved?.token){state.code=saved.code;state.token=saved.token;}
}catch{}
function defineBlockly(){
 if(!window.Blockly){toast("Blockly 程式庫載入失敗，請確認網路或重新整理");return false;}
 if(Blockly.Blocks.event_start)return true;
 const eventColor="#f0af36",variableColor="#fb913a",controlColor="#5987d5",conditionColor="#59a46f",actionColor="#8c67d7";
 for(const [event,label]of Object.entries(eventLabels)){
   Blockly.Blocks["event_"+event]={init:function(){
     this.appendDummyInput().appendField(label);
     if(event==="key")this.appendDummyInput().appendField(new Blockly.FieldDropdown([["空白鍵","Space"],["Shift","Shift"],["E","e"]]),"KEY");
     this.appendStatementInput("BODY").setCheck("Action");
     this.setColour(eventColor);this.setTooltip(eventMeanings[event]+"（黃色是「觸發時機」，不是速度數值）");
   }};
 }
 for(const [op,label]of Object.entries(opLabels)){
   Blockly.Blocks["act_"+op]={init:function(){
     this.appendDummyInput().appendField(op==="change_speed"?"將速度改變":"將"+label+"設為")
       .appendField(new Blockly.FieldNumber(params[op][2],params[op][0],params[op][1],1),"VALUE");
     this.setPreviousStatement(true,"Action");this.setNextStatement(true,"Action");this.setColour(variableColor);
     this.setTooltip("改變車輛的實際物理參數，並受數值範圍限制");
   }};
 }
 Blockly.Blocks.act_use_item={init:function(){
   this.appendDummyInput().appendField("啟動目前的道具");
   this.setPreviousStatement(true,"Action");this.setNextStatement(true,"Action");this.setColour(actionColor);
 }};
 Blockly.Blocks.act_play_sound={init:function(){
   this.appendDummyInput().appendField("播放提示音效");
   this.setPreviousStatement(true,"Action");this.setNextStatement(true,"Action");this.setColour(actionColor);
 }};
 Blockly.Blocks.ctrl_ifelse={init:function(){
   this.appendValueInput("COND").setCheck("Boolean").appendField("如果");
   this.appendStatementInput("DO").setCheck("Action").appendField("那麼");
   this.appendStatementInput("ELSE").setCheck("Action").appendField("否則");
   this.setPreviousStatement(true,"Action");this.setNextStatement(true,"Action");
   this.setColour(controlColor);this.setTooltip("條件為真執行那麼，否則執行另一組積木");
 }};
 for(const [kind,label]of Object.entries(conditionLabels)){
   Blockly.Blocks["cond_"+kind]={init:function(){
     const i=this.appendDummyInput().appendField(label);
     if(kind==="speed_gt"||kind==="obstacle_near")i.appendField(new Blockly.FieldNumber(kind==="speed_gt"?100:50,0,250,1),"VALUE");
     if(kind==="item_kind")i.appendField(new Blockly.FieldDropdown(Object.entries(itemLabels).map(([v,name])=>[name,v])),"ITEM");
     this.setOutput(true,"Boolean");this.setColour(conditionColor);
     this.setTooltip("會依照賽車當下狀態得到成立或不成立");
   }};
 }
 return true;
}
function toolbox(topic="free"){
 const categories=[
  {kind:"category",name:"事件（何時執行）",colour:"#f0af36",contents:Object.keys(eventLabels).map(k=>({kind:"block",type:"event_"+k}))},
  {kind:"category",name:"變數（改數字）",colour:"#fb913a",contents:Object.keys(params).map(k=>({kind:"block",type:"act_"+k}))},
  {kind:"category",name:"控制（如果）",colour:"#5987d5",contents:[{kind:"block",type:"ctrl_ifelse"}]},
  {kind:"category",name:"偵測（條件）",colour:"#59a46f",contents:Object.keys(conditionLabels).map(k=>({kind:"block",type:"cond_"+k}))},
  {kind:"category",name:"道具／音效",colour:"#8c67d7",contents:[{kind:"block",type:"act_use_item"},{kind:"block",type:"act_play_sound"}]}
 ];
 if(topic==="max"||topic==="accel")return {kind:"categoryToolbox",contents:[categories[1]]};
 if(topic==="curve")return {kind:"categoryToolbox",contents:[categories[0],categories[2],categories[3],categories[1]]};
 if(topic==="item")return {kind:"categoryToolbox",contents:[categories[0],categories[2],categories[3],categories[4]]};
 return {kind:"categoryToolbox",contents:categories};
}
function initBlockly(){
 if(!defineBlockly())return;
 state.workspace=Blockly.inject("blocklyDiv",{toolbox:toolbox(state.room?.topic),trashcan:true,
   grid:{spacing:22,length:2,colour:"#ccd8e4",snap:true},
   zoom:{controls:true,wheel:true,startScale:.77,maxScale:1.8,minScale:.4,scaleSpeed:1.15},
   move:{scrollbars:true,drag:true,wheel:true},sounds:false,renderer:"zelos",theme:Blockly.Themes.Classic});
 state.workspace.addChangeListener(e=>{
   if(e.type===Blockly.Events.SELECTED){
     const block=e.newElementId?state.workspace.getBlockById(e.newElementId):null;
     $("selectedBlockHelp").textContent=explainBlocklyBlock(block);
     return;
   }
   if(state.suppress||e.type===Blockly.Events.UI||e.isUiEvent)return;
   clearTimeout(initBlockly.timer);
   initBlockly.timer=setTimeout(sendDraft,430);
 });
}
function initMonitor(){
 if(!defineBlockly())return;
 state.monitor=Blockly.inject("teacherBlockly",{readOnly:true,toolbox:null,scrollbars:true,
   zoom:{controls:true,wheel:true,startScale:.55,maxScale:1.5,minScale:.35},renderer:"zelos",sounds:false});
 state.monitor.addChangeListener(e=>{
   if(e.type===Blockly.Events.SELECTED && e.newElementId){
     state.markBlockId=e.newElementId;
     $("markedBlock").textContent="已標記積木："+e.newElementId;
   }
 });
}
function astActionChain(block){
 const out=[];let n=block,count=0;
 while(n&&count++<100){
   if(n.type.startsWith("act_")) {
     const op=n.type.slice(4);
     const node={type:"action",op,id:n.id};
     if(params[op])node.value=Number(n.getFieldValue("VALUE"));
     out.push(node);
   }else if(n.type==="ctrl_ifelse"){
     const cond=n.getInputTargetBlock("COND");
     const condition=cond&&cond.type.startsWith("cond_")?{
       type:"condition",kind:cond.type.slice(5),id:cond.id,
       ...(["speed_gt","obstacle_near"].includes(cond.type.slice(5))?{value:Number(cond.getFieldValue("VALUE"))}:{}),
       ...(cond.type==="cond_item_kind"?{item:cond.getFieldValue("ITEM")}:{})
     }:null;
     out.push({type:"if",id:n.id,condition,then:astActionChain(n.getInputTargetBlock("DO")),
       else:astActionChain(n.getInputTargetBlock("ELSE"))});
   }else throw new Error("有積木未正確拼接：請把動作放在事件帽子或控制積木裡");
   n=n.getNextBlock();
 }
 return out;
}
function programAst(){
 if(!state.workspace)return [];
 const order=["start","curve_enter","curve_leave","key","pickup","line","collision","boost_zone","finish"];
 const top=state.workspace.getTopBlocks(true).sort((a,b)=>order.indexOf(a.type.slice(6))-order.indexOf(b.type.slice(6))),events=[];
 for(const block of top){
   if(!block.type.startsWith("event_"))throw new Error("積木必須接在「當……時」事件帽子下方，不能單獨放在工作區");
   const event=block.type.slice(6);
   const node={type:"event",event,id:block.id,body:astActionChain(block.getInputTargetBlock("BODY"))};
   if(event==="key")node.key=block.getFieldValue("KEY");
   events.push(node);
 }
 return events;
}
function programAstSafe(){try{return programAst();}catch{return null;}}
function addBlockly(ws,node,x=15,y=15){
 let type;
 if(node.type==="event")type="event_"+node.event;
 else if(node.type==="action")type="act_"+node.op;
 else if(node.type==="if")type="ctrl_ifelse";
 else if(node.type==="condition")type="cond_"+node.kind;
 if(!Blockly.Blocks[type])throw new Error("未知積木 "+type);
 const b=ws.newBlock(type,node.id);
 b.initSvg();
 if(node.type==="action"&&params[node.op])b.setFieldValue(String(node.value),"VALUE");
 if(node.type==="event"&&node.event==="key")b.setFieldValue(node.key||"Space","KEY");
 if(node.type==="condition"){
   if(["speed_gt","obstacle_near"].includes(node.kind))b.setFieldValue(String(node.value),"VALUE");
   if(node.kind==="item_kind")b.setFieldValue(node.item||"nitro","ITEM");
 }
 if(node.type==="event")connectList(ws,node.body,b.getInput("BODY").connection);
 if(node.type==="if"){
   if(node.condition){const cond=addBlockly(ws,node.condition);b.getInput("COND").connection.connect(cond.outputConnection);}
   connectList(ws,node.then,b.getInput("DO").connection);
   connectList(ws,node.else,b.getInput("ELSE").connection);
 }
 b.render();
 if(node.type==="event")b.moveBy(x,y);
 return b;
}
function connectList(ws,list,head){
 let connection=head;
 for(const node of list||[]){
   const child=addBlockly(ws,node);
   if(child.previousConnection && connection)connection.connect(child.previousConnection);
   connection=child.nextConnection;
 }
}
function arrangeBlocks(ws=state.workspace,topic=state.room?.topic||"free"){
 if(!ws)return;
 // Keep the learning target expanded; fold unrelated stock events.
 const relevant={max:["start"],accel:["start"],curve:["curve_enter"],item:["pickup","key"]}[topic];
 const order=Object.keys(eventLabels);
 const blocks=ws.getTopBlocks(false).sort((a,b)=>{
  const ia=order.indexOf(a.type.slice(6)),ib=order.indexOf(b.type.slice(6));
  return (ia<0?999:ia)-(ib<0?999:ib);
 });
 const suppressBefore=state.suppress;
 if(ws===state.workspace)state.suppress=true;
 Blockly.Events.disable();
 try{
  let y=25;
  for(const b of blocks){
   if(b.type.startsWith("event_"))b.setCollapsed(ws===state.workspace&&state.blocksMode==="all"?false:!!relevant&&!relevant.includes(b.type.slice(6)));
   const p=b.getRelativeToSurfaceXY();
   b.moveBy(35-p.x,y-p.y);
   y+=Math.max(40,b.getHeightWidth().height)+30;
  }
 }finally{Blockly.Events.enable();state.suppress=suppressBefore;}
 Blockly.svgResize(ws);
}
function loadProgram(program,ws=state.workspace){
 if(!ws)return;
 if(ws===state.workspace)state.suppress=true;
 Blockly.Events.disable();
 try{
   ws.clear();
   (program||[]).forEach(evt=>addBlockly(ws,evt,35,25));
   arrangeBlocks(ws);
 }catch(e){toast("重建積木遇到問題："+e.message);}
 finally{Blockly.Events.enable();if(ws===state.workspace)state.suppress=false;}
 Blockly.svgResize(ws);
 if(ws===state.workspace)state.lastProgramStr=JSON.stringify(program||[]);
}
async function sendDraft(){
 if(!state.workspace||!state.room||state.role!=="student"||state.ready||!["tuning","results"].includes(state.room.phase))return;
 try{
   const program=programAst(),json=JSON.stringify(program);
   if(json===state.lastProgramStr)return;
   const result=await call("program:draft",{program});
   if(result){state.lastProgramStr=json;explain("積木已同步到老師控制台，可繼續調整或練習。");}
   else explain("積木組合需要修正："+state.lastServerError);
 }catch(e){explain(e.message);}
}
function defaultProgram(){
 return [
  {type:"event",event:"start",body:[
   {type:"action",op:"set_max",value:150},
   {type:"action",op:"set_accel",value:8},
   {type:"action",op:"set_steer",value:3},
   {type:"action",op:"set_brake",value:5},
   {type:"action",op:"set_target",value:230}
  ]},
  {type:"event",event:"curve_enter",body:[{type:"if",condition:{type:"condition",kind:"curve"},
    then:[{type:"action",op:"set_target",value:75}],else:[{type:"action",op:"set_target",value:145}]}]},
  {type:"event",event:"curve_leave",body:[{type:"action",op:"set_target",value:230}]} ,
  {type:"event",event:"key",key:"Space",body:[{type:"if",condition:{type:"condition",kind:"has_item"},
    then:[{type:"action",op:"use_item"}],else:[]}]},
  {type:"event",event:"pickup",body:[{type:"action",op:"play_sound"}]}
 ];
}
function storeProgram(){
 try{const p=programAst();localStorage.setItem("coding-racing-program-"+state.code,JSON.stringify(p));toast("程式已儲存在本機，並可提交給老師");sendDraft();}
 catch(e){toast(e.message);}
}
$("undoButton").onclick=()=>state.workspace?.undo(false);
$("redoButton").onclick=()=>state.workspace?.undo(true);
$("arrangeButton").onclick=()=>{arrangeBlocks();toast("積木已整理，不會互相重疊");};
$("allBlocksButton").onclick=()=>{
 state.blocksMode=state.blocksMode==="all"?"focus":"all";
 $("allBlocksButton").textContent=state.blocksMode==="all"?"只看本回合":"展開全部";
 $("blockViewNote").textContent=state.blocksMode==="all"?"全部事件積木已展開，可以上下捲動查看；按「只看本回合」會收起其他功能。":"其他黃色事件收成一行，並沒有刪除；按「展開全部」查看裡面的動作。";
 arrangeBlocks();
 toast(state.blocksMode==="all"?"全部積木已展開，可以上下捲動":"已收起其他功能，保留本回合積木");
};
$("resetButton").onclick=()=>{loadProgram(defaultProgram());sendDraft();toast("已恢復預設積木，沒有重設正式比賽");};
function toggleEditor(force){
 const expanded=force??!$("stage").classList.contains("editor-focus");
 $("stage").classList.toggle("editor-focus",expanded);
 $("expandEditor").textContent=expanded?"⤢ 返回賽道畫面":"⛶ 放大積木";
 $("expandEditor").setAttribute("aria-pressed",String(expanded));
 requestAnimationFrame(()=>{resizeGame();if(state.workspace)Blockly.svgResize(state.workspace);});
}
$("expandEditor").onclick=()=>toggleEditor();
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("stage").classList.contains("editor-focus"))toggleEditor(false);});
$("clearButton").onclick=()=>{if(state.workspace){state.workspace.clear();sendDraft();}};
$("saveButton").onclick=storeProgram;
$("lockButton").onclick=async()=>{
 try{
   const program=programAst();
   const result=await call("program:lock",{program});
   if(result){state.ready=true;toast("已鎖定程式，等待老師開始比賽");updateRoom();}
 }catch(e){toast(e.message);}
};
$("unlockButton").onclick=async()=>{if(await call("program:unlock")){state.ready=false;updateRoom();}};
async function startPractice(retry=false){
 try{const program=programAst();if(await call("student:test",{program})){
    state.testing=true;state.practice=null;
    toast(retry?"已回到起點，重新開始練習":"練習開始！使用方向鍵駕駛");
    $("retryTestButton").hidden=false;$("stopTestButton").hidden=false;$("testButton").hidden=true;
 }}catch(e){toast(e.message);}
}
$("testButton").onclick=()=>startPractice(false);
$("retryTestButton").onclick=()=>startPractice(true);
$("stopTestButton").onclick=stopTest;
async function stopTest(){
 if(await call("student:test",{stop:true})){state.testing=false;state.practice=null;$("stopTestButton").hidden=true;$("retryTestButton").hidden=true;$("testButton").hidden=false;}
}
$("helpButton").onclick=async()=>{if(await call("student:help")){toast("已向老師舉手求助，老師可查看你的積木");explain("已向老師發出求助通知。這裡會顯示積木執行紀錄、錯誤及老師提示。");}};
socket.on("practice:stopped",()=>{state.testing=false;state.practice=null;$("stopTestButton").hidden=true;$("retryTestButton").hidden=true;$("testButton").hidden=false;toast("老師已暫停你的練習");});
socket.on("practice:update",data=>{state.practice=data;recordMotion(data,data.at);});
socket.on("program:replace",data=>{if(state.role==="student"){state.ready=false;loadProgram(data.program);explain(data.reason);toast(data.reason);}});
socket.on("teacher:message",item=>{
 toast("老師："+item.text,6500);explain("老師提示："+item.text);
 if(item.blockId&&state.workspace){
   try{state.workspace.highlightBlock(item.blockId);setTimeout(()=>state.workspace?.highlightBlock(null),2000);}catch{}
 }
});
socket.on("block:trace",entry=>{
 if(state.role==="student" || entry.playerId===state.selected){
   state.lastTrace=entry.message||"";if(entry.message)explain(entry.message);
   const target=state.role==="student"?state.workspace:state.monitor;
   if(target&&entry.id){
     try{target.highlightBlock(entry.id);clearTimeout(onTrace.timer);
       onTrace.timer=setTimeout(()=>target.highlightBlock(null),620);
     }catch{}
   }
   if(entry.message?.includes("play_sound")||entry.message?.includes("播放"))beep();
 }
});
function onTrace(){}
let audioContext;
function beep(){
 try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
  const osc=audioContext.createOscillator(),g=audioContext.createGain();
  osc.frequency.value=660;g.gain.value=.035;osc.connect(g);g.connect(audioContext.destination);
  osc.start();osc.stop(audioContext.currentTime+.12);
 }catch{}
}
const driveKeys={ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down",
  ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right"};
const input={up:false,down:false,left:false,right:false};
function sendInput(){if(state.role==="student")socket.emit("drive",{...input});}
async function returnToTrack(){
 if(!state.connected||Date.now()-state.lastRescue<1500)return;
 const result=await call("student:rescue");
 if(result){state.lastRescue=Date.now();state.visual.delete(state.playerId);toast("已回安全賽道！按 ↑ / W 加速（本場第 "+result.rescueCount+" 次回賽道）");}
}
$("rescueButton").onclick=returnToTrack;
document.addEventListener("keydown",e=>{
 if(state.role!=="student"||!state.room||["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;
 if(e.key.toLowerCase()==="r"&&!e.repeat&&(state.testing||state.room.phase==="racing")){returnToTrack();e.preventDefault();}
 if(driveKeys[e.key]){if(!input[driveKeys[e.key]]){input[driveKeys[e.key]]=true;sendInput();}e.preventDefault();}
 if([" ","Shift","e"].includes(e.key)&&!e.repeat){const key=e.key===" "?"Space":e.key;socket.emit("key:event",{key});e.preventDefault();}
});
document.addEventListener("keyup",e=>{
 if(driveKeys[e.key]){input[driveKeys[e.key]]=false;sendInput();e.preventDefault();}
});
window.addEventListener("blur",()=>{for(const k of Object.keys(input))input[k]=false;sendInput();});
socket.on("room:update",room=>{state.room=room;updateRoom();});
socket.on("teacher:update",room=>{if(state.role==="teacher"){state.room=room;updateRoom();}});
function recordMotion(car,at){
 const stamp=Number(at)||Date.now();
 const offset=performance.now()-stamp;
 if(!Number.isFinite(state.clockOffset))state.clockOffset=offset;
 else state.clockOffset+=Math.max(-8,Math.min(8,offset-state.clockOffset))*.12;
 state.visual.set(car.id,pushMotion(state.visual.get(car.id),car,stamp));
}
socket.on("race:snapshot",snap=>{
 if(state.room){state.room.phase=snap.phase;state.room.elapsed=snap.elapsed;state.room.countdownAt=snap.countdownAt;}
 state.cars=snap.cars;
 const ids=new Set(snap.cars.map(c=>c.id));
 for(const c of snap.cars)recordMotion(c,snap.at);
 for(const id of state.visual.keys())if(!ids.has(id))state.visual.delete(id);
});
function updateRoom(){
 const r=state.room;if(!r)return;
 if(r.phase!==state.renderPhase){
  if(r.phase==="countdown"){state.visual.clear();state.cars=[];}
  state.renderPhase=r.phase;
 }
 // Previous race snapshots must not leave a stranded-looking ghost car in a new lesson.
 if(r.phase==="tuning"&&(!r.cars||!r.cars.length)&&state.cars.length){state.cars=[];state.visual.clear();}
 $("roomBadge").textContent="房間 "+r.code;
 const phase={tuning:"積木調校階段",countdown:"起跑倒數",racing:"正式比賽中",paused:"課堂暫停中",results:"賽後分析"};
 $("phaseBadge").textContent=phase[r.phase]||"等待中";
 $("trackTitle").textContent=roomNames[r.track];
 $("missionTag").textContent=(r.topic==="free"?"自由設計":r.topic==="curve"?"條件判斷":r.topic==="item"?"事件觸發":"變數任務");
 $("missionDescription").textContent=topicText[r.topic]||"";
 $("lessonGuide").textContent=lessonGuide[r.topic]||"";
 if(state.role==="student")$("selectedBlockHelp").textContent=state.workspace?explainBlocklyBlock(state.workspace.getSelected()):"🟨 黃色積木是事件：發生指定情況才執行裡面的動作。";
 if(state.role==="student"){
   const my=r.students.find(s=>s?.id===state.playerId);
   state.ready=!!my?.ready;
   const editable=(r.phase==="tuning"||r.phase==="results")&&!state.ready;
   if(state.workspace){
     state.workspace.setVisible(true);
     const disallowed=state.workspace.options.readOnly; // Blockly editor stays visible during the race, controls are locked.
     for(const b of state.workspace.getAllBlocks(false))b.setEditable(editable);
     if(state.topicShown!==r.topic){state.workspace.updateToolbox(toolbox(r.topic));arrangeBlocks(state.workspace,r.topic);state.topicShown=r.topic;}
     Blockly.svgResize(state.workspace);
   }
   $("lockButton").disabled=!editable||r.phase!=="tuning";
   $("testButton").disabled=!editable||r.phase!=="tuning";
   $("retryTestButton").disabled=!editable||r.phase!=="tuning";
   $("unlockButton").hidden=!state.ready||r.phase!=="tuning";
   $("lockButton").hidden=state.ready&&r.phase==="tuning";
   for(const id of ["resetButton","clearButton","saveButton","undoButton","redoButton","arrangeButton"])$(id).disabled=!editable;
 }else if(state.role==="teacher"){
   $("teacherCode").textContent=r.code;
   $("topicSelect").value=r.topic;$("trackSelect").value=r.track;
   $("lapsSelect").value=String(r.laps);$("difficultySelect").value=String(r.difficulty);
   const anyPlayers=r.students.some(Boolean);
   $("startRace").disabled=!anyPlayers||!["tuning","results"].includes(r.phase)||r.students.some(s=>s&&!s.ready);
   $("pauseRace").disabled=!["racing","countdown"].includes(r.phase);
   $("resumeRace").disabled=r.phase!=="paused";
   $("finishRace").disabled=r.phase!=="racing";
   $("applySettings").disabled=!["tuning","results"].includes(r.phase);
   showStudent();
 }
 const students=r.students;
 for(let i=0;i<2;i++){
   const s=students[i];
   $("name"+(i+1)).textContent=s?.name||"等待學生 "+(i===0?"A":"B");
   $("meta"+(i+1)).textContent=s?(s.connected?"● 已連線 · ":"○ 已離線 · ")+(s.ready?"準備完成":"積木調校中"):"未進入";
 }
 if(r.phase!=="tuning"&&state.testing){state.testing=false;state.practice=null;$("stopTestButton").hidden=true;$("retryTestButton").hidden=true;$("testButton").hidden=false;}
 if(r.phase==="results")renderResults(r);
}
function renderResults(r){
 const overlay=$("raceOverlay");
 if(r.phase!=="results")return;
 const latest=r.history?.at(-1);
 overlay.replaceChildren();
 const board=document.createElement("div");
 board.className="results-board";
 const title=document.createElement("h2");
 title.textContent="🏆 第 "+r.round+" 回合 · 賽後分析";
 board.append(title);
 if(latest?.cars){
   for(const record of latest.cars){
     const section=document.createElement("section");
     const heading=document.createElement("h3");heading.textContent=record.name;
     const summary=document.createElement("p");
     summary.textContent="完成時間："+(record.time===null?"未完成":record.time+" 秒")+
       "　平均速度："+record.average+"　最高速度："+record.peak;
     const detail=document.createElement("p");
     detail.textContent="碰撞："+record.collisions+" 次　回賽道救援："+(record.rescues||0)+" 次　積木事件："+record.events+
       " 次　除錯嘗試："+record.attempts+" 次";
     const changes=document.createElement("p");
     changes.textContent="程式修改："+(record.modified?.join("、")||"保持原設定");
     section.append(heading,summary,detail,changes);
     if(record.previousAverage!==null){
       const compare=document.createElement("p");
       compare.textContent="與上回合平均速度差異："+(record.average-record.previousAverage>0?"+":"")+
         (record.average-record.previousAverage);
       section.append(compare);
     }
     board.append(section);
   }
 }else{
   const p=document.createElement("p");p.textContent="比賽完成，老師可查看詳細回合紀錄。";board.append(p);
 }
 overlay.append(board);
}
function showStudent(){
 const r=state.room;if(!r||state.role!=="teacher")return;
 $("selectP1").classList.toggle("active",state.selected==="p1");
 $("selectP2").classList.toggle("active",state.selected==="p2");
 const s=r.students.find(p=>p?.id===state.selected);
 if(!s){$("studentDetails").textContent="等待此學生加入...";if(state.monitor)state.monitor.clear();return;}
 $("studentDetails").textContent=s.name+" · "+(s.connected?"已連線":"已離線")+" · "+(s.ready?"已鎖定":"編輯中")+
  (s.help?" · ❗需要協助":"")+" · 修改 "+(s.modified||[]).join("、")+" · 嘗試 "+s.attempts+" 次 · 錯誤 "+s.errors+" 次"+
  (s.lastError?" · 最近錯誤："+s.lastError:"");
 if(state.monitor){
   const json=JSON.stringify(s.draft);
   if(json!==state.lastTeacherProgramStr){state.lastTeacherProgramStr=json;loadProgram(s.draft,state.monitor);}
 }
 $("teacherMessages").replaceChildren();
 for(const m of [...(r.messages||[])].reverse().slice(0,8)){
   const a=document.createElement("article");
   a.textContent=new Date(m.at).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})+
    " · "+m.by+"："+m.text;
   $("teacherMessages").append(a);
 }
 const reports=r.history||[];
 $("report").replaceChildren();
 for(const result of [...reports].reverse().slice(0,5)){
   const sec=document.createElement("section");
   const heading=document.createElement("strong");heading.textContent="第 "+result.round+" 回合 · "+(topicText[result.topic]||result.topic);
   sec.append(heading);
   for(const c of result.cars){
     const p=document.createElement("p");
     p.textContent=c.name+"｜"+(c.finished?c.time+" 秒":"未完成")+"｜平均 "+c.average+
       "｜極速 "+c.peak+"｜碰撞 "+c.collisions+"｜救援 "+(c.rescues||0)+"｜事件 "+c.events+
       "｜修改："+c.modified.join("、")+(c.previousAverage!==null?"｜上次平均 "+c.previousAverage:"");
     sec.append(p);
   }
   $("report").append(sec);
 }
}
$("selectP1").onclick=()=>{state.selected="p1";state.markBlockId=null;$("markedBlock").textContent="未選取積木";state.lastTeacherProgramStr="";showStudent();};
$("selectP2").onclick=()=>{state.selected="p2";state.markBlockId=null;$("markedBlock").textContent="未選取積木";state.lastTeacherProgramStr="";showStudent();};
$("applySettings").onclick=async()=>{if(await call("teacher:set",{topic:$("topicSelect").value,track:$("trackSelect").value,
  laps:Number($("lapsSelect").value),difficulty:Number($("difficultySelect").value)}))toast("本回合設定已更新");};
for(const [id,action]of Object.entries({startRace:"start",pauseRace:"pause",resumeRace:"resume",
 restartRace:"restart",finishRace:"finish"})){
 $(id).onclick=async()=>{if(await call("teacher:race",{action}))toast("已執行："+$(id).textContent);};
}
$("copyInvite").onclick=async()=>{
 const link=location.origin+"/?room="+state.code;
 try{await navigator.clipboard.writeText(link);toast("已複製學生邀請連結");}
 catch{prompt("複製邀請連結",link);}
};
$("assistApply").onclick=async()=>{
 if(await call("teacher:assist",{playerId:state.selected,op:$("assistOp").value,value:Number($("assistValue").value)}))toast("已同步修改積木，學生會立即看到變更");
};
$("teacherReset").onclick=async()=>{if(await call("teacher:reset",{playerId:state.selected}))toast("已恢復學生預設程式");};
$("teacherStopTest").onclick=async()=>{if(await call("teacher:stopTest",{playerId:state.selected}))toast("已停止練習");};
$("rescueCar").onclick=async()=>{if(await call("teacher:rescue",{playerId:state.selected}))toast("已將賽車移回路線");};
$("sendHint").onclick=async()=>{
 const message=$("teacherHint").value;
 if(await call("teacher:hint",{playerId:state.selected,message,blockId:state.markBlockId||""})){toast("提示已傳送");$("teacherHint").value="";}
};
function pathFor(track){
 const points=[];
 for(let i=0;i<360;i++){
  const t=i*2*Math.PI/360,wave=track==="rookie"?0:track==="curves"?65:40,inner=track==="curves"?55:20;
  points.push({x:500+(285+wave*Math.sin(3*t)+inner*Math.cos(5*t))*Math.cos(t),
    y:343+(206+wave*.65*Math.cos(3*t)+inner*.5*Math.sin(4*t))*Math.sin(t)});
 }
 return points;
}
const trackCache={};
function getTrack(which){
 if(trackCache[which])return trackCache[which];
 const path=pathFor(which),ids=which==="rookie"?[68,211]:which==="curves"?[55,115,209,280]:[75,180,260,335],
  pickupIds=which==="items"?[30,94,158,225,302]:[80,255],
  zoneIds=which==="items"?[52,203]:[115];
 return trackCache[which]={path,obstacles:ids.map((idx,i)=>({x:path[idx].x+(i%2?15:-18),y:path[idx].y+(i%2?15:-18)})),
   pickups:pickupIds.map((idx,i)=>({...path[idx],kind:Object.keys(itemLabels)[i%4]})),zones:zoneIds};
}
function drawTrack(which){
 const {path,obstacles,pickups,zones}=getTrack(which);
 ctx.fillStyle="#143d37";ctx.fillRect(0,0,1000,686);
 ctx.save();
 ctx.globalAlpha=.28;
 for(let i=0;i<20;i++){
   ctx.fillStyle=i%3===0?"#326d48":"#245647";
   ctx.beginPath();ctx.arc((i*171+37)%995,(i*113+17)%684,20+i%5*8,0,Math.PI*2);ctx.fill();
 }
 ctx.restore();
 function stroke(width,color,dash=[]){
  ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
  ctx.lineWidth=width;ctx.strokeStyle=color;ctx.lineJoin="round";ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
 }
 stroke(121,"#b1c1b0");stroke(111,"#344349");stroke(101,"#4b5961");stroke(3,"#d3dfc7",[15,23]);
 ctx.lineWidth=6;ctx.strokeStyle="#eebd60";ctx.beginPath();
 const z=path[0],q=path[1],ang=Math.atan2(q.y-z.y,q.x-z.x)+Math.PI/2;
 ctx.moveTo(z.x+Math.cos(ang)*53,z.y+Math.sin(ang)*53);
 ctx.lineTo(z.x-Math.cos(ang)*53,z.y-Math.sin(ang)*53);ctx.stroke();
 ctx.fillStyle="#e2eef7";ctx.font="bold 14px Arial";ctx.fillText("START",z.x+12,z.y-18);
 for(const idx of zones){
   for(let k=0;k<11;k+=3){
     const p=path[(idx+k)%path.length];
     ctx.strokeStyle="#58fad9";ctx.lineWidth=5;ctx.beginPath();
     ctx.moveTo(p.x-7,p.y-6);ctx.lineTo(p.x+7,p.y+6);ctx.stroke();
   }
 }
 for(const o of obstacles){
   ctx.fillStyle="#201e24";ctx.beginPath();ctx.ellipse(o.x,o.y+4,22,17,0,0,7);ctx.fill();
   ctx.fillStyle="#f58b54";ctx.beginPath();ctx.arc(o.x,o.y,15,0,7);ctx.fill();
   ctx.fillStyle="#fff0b3";ctx.fillRect(o.x-10,o.y-3,20,6);
 }
 for(const p of pickups){
   ctx.save();ctx.translate(p.x,p.y);ctx.rotate(performance.now()/800);
   ctx.fillStyle="#f9cc5b";ctx.shadowColor="#ffe589";ctx.shadowBlur=16;ctx.fillRect(-12,-12,24,24);ctx.restore();
 }
}
function renderCar(car){
 const c=state.visual.get(car.id)||car;
 if(c.tx!==undefined){c.x+=(c.tx-c.x)*.22;c.y+=(c.ty-c.y)*.22;
   const delta=Math.atan2(Math.sin(c.ta-c.angle),Math.cos(c.ta-c.angle));c.angle+=delta*.22;
   Object.assign(c,{...c.other,x:c.x,y:c.y,angle:c.angle});
 }
 const color=car.slot===0?"#53caff":"#ff79a1";
 ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.angle);
 if(c.boost){ctx.fillStyle="#ffcb5d";ctx.beginPath();ctx.moveTo(-21,0);ctx.lineTo(-56,-9);ctx.lineTo(-45,0);ctx.lineTo(-56,9);ctx.fill();}
 // Minimal speed streaks make acceleration visually readable from the fixed camera.
 if(c.speed>80){
  const power=Math.min(1,(c.speed-80)/120);
  ctx.strokeStyle="rgba(162,239,255,"+(.26+.5*power)+")";ctx.lineWidth=2+power*2;
  for(const y of [-14,0,14]){ctx.beginPath();ctx.moveTo(-33,y);ctx.lineTo(-33-12-power*34,y);ctx.stroke();}
 }
 if(c.shield){ctx.strokeStyle="#9de9ff";ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,33,0,7);ctx.stroke();}
 if(c.grip){ctx.strokeStyle="#79f8b8";ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,29,0,7);ctx.stroke();}
 ctx.fillStyle="#091827";ctx.fillRect(-18,-18,30,8);ctx.fillRect(-18,10,30,8);
 ctx.shadowColor=color;ctx.shadowBlur=12;ctx.fillStyle=color;
 ctx.beginPath();ctx.moveTo(23,0);ctx.lineTo(12,-13);ctx.lineTo(-20,-11);ctx.lineTo(-24,0);ctx.lineTo(-20,11);ctx.lineTo(12,13);ctx.closePath();ctx.fill();
 ctx.shadowBlur=0;ctx.fillStyle="#122744";ctx.fillRect(-4,-8,12,16);
 ctx.fillStyle="#f0faff";ctx.fillRect(12,-9,6,5);ctx.fillRect(12,4,6,5);ctx.restore();
 ctx.save();ctx.textAlign="center";ctx.font="bold 14px sans-serif";ctx.fillStyle="#fff";
 ctx.shadowColor="#000";ctx.shadowBlur=5;ctx.fillText(c.name,c.x,c.y-29);ctx.restore();
}
function formatTime(n){
 if(!Number.isFinite(n))n=0;
 return String(Math.floor(n/60)).padStart(2,"0")+":"+String(Math.floor(n%60)).padStart(2,"0")+"."+
  Math.floor((n%1)*10);
}
function animationFrame(){
 requestAnimationFrame(animationFrame);
 const r=state.room;
 if(!r)return;
 drawTrack(r.track);
 let cars=state.cars.length?state.cars:r.cars;
 if(state.role==="student"&&state.testing&&state.practice){
   cars=[...cars.filter(c=>c.id!==state.playerId),state.practice];
   state.visual.set(state.playerId,{...state.practice});
 }
 for(const c of cars)renderCar(c);
 $("raceClock").textContent=formatTime(r.elapsed);
 if(r.phase==="countdown"||r.phase==="paused"&&r.countdownAt>Date.now()){
   $("countdown").hidden=false;
   $("countdown").textContent=String(Math.max(1,Math.ceil((r.countdownAt-Date.now())/1000)));
 }else $("countdown").hidden=true;
 $("raceOverlay").hidden=!["paused","results"].includes(r.phase);
 if(r.phase==="paused")$("raceOverlay").textContent="⏸ 教師已暫停比賽";
 if(r.phase==="results"&&!$("raceOverlay").childElementCount)renderResults(r);
 const my=state.role==="student"?cars.find(c=>c.id===state.playerId):cars.find(c=>c.id===state.selected);
 const sorted=[...cars].sort((a,b)=>(b.laps*360+b.progress)-(a.laps*360+a.progress));
 $("lapDisplay").textContent=my?(my.laps+1>r.laps?r.laps:my.laps+1)+"/"+r.laps:"—";
 $("speedDisplay").textContent=String(my?.speed??0);
 const rescueAvailable=state.role==="student"&&(state.testing||r.phase==="racing")&&!my?.finished;
 $("rescueButton").hidden=!rescueAvailable;
 $("rescueButton").disabled=!rescueAvailable||Date.now()-state.lastRescue<1500;
 $("itemDisplay").textContent=my?.item?itemLabels[my.item]:"—";
 $("rankDisplay").textContent=my?String(sorted.findIndex(c=>c.id===my.id)+1)+"/"+cars.length:"—";
}
requestAnimationFrame(animationFrame);

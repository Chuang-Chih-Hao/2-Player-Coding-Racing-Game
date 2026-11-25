import {test,expect} from "@playwright/test";
test("three actual browser sessions: visual blocks, teacher monitoring, synchronized race, rejoin and scaling",async({browser})=>{
 const teacher=await browser.newContext({viewport:{width:1600,height:900}});
 const s1=await browser.newContext({viewport:{width:1280,height:720}});
 const s2=await browser.newContext({viewport:{width:1024,height:768}});
 const t=await teacher.newPage(),a=await s1.newPage(),b=await s2.newPage();
 await t.goto("/");
 await t.locator("#roleTeacher").click();
 await t.locator("#createButton").click();
 await expect(t.locator("#teacherCode")).toHaveText(/^[A-F0-9]{6}$/);
 const code=(await t.locator("#teacherCode").innerText()).trim();
 for(const [p,name]of [[a,"A 車手"],[b,"B 車手"]]){
  await p.goto("/?room="+code);
  await p.locator("#studentName").fill(name);
  await p.locator("#joinButton").click();
  await expect(p.locator("#blocklyDiv .blocklySvg")).toBeVisible();
 }
 // Student focus is readable without overlapping default stacks or clipped guidance.
 await expect(a.locator("#helpButton")).toBeVisible();
 await expect(a.locator("#feedbackPanel")).toBeVisible();
 await expect(a.locator("#lessonGuide")).toContainText("最高速度");
 await expect(a.locator(".block-color-key")).toContainText("黃色＝何時執行");
 await expect(a.locator(".block-color-key")).toContainText("藍色＝如果／否則");
 const blockHelp=await a.evaluate(()=>{
   const w=Blockly.getMainWorkspace(),event=w.getTopBlocks(false).find(x=>x.type==="event_start");
   return {tooltip:event.getTooltip(),color:event.getColour(),
    yellowEvents:w.getTopBlocks(false).filter(x=>x.type.startsWith("event_")).length};
 });
 expect(blockHelp.tooltip).toContain("賽車開始時");
 expect(blockHelp.yellowEvents).toBe(1);
 await expect(a.locator("#buildCount")).toHaveText("0/4");
 await a.locator("#quickDrive").click();
 await expect(a.locator("#retryTestButton")).toBeVisible();
 await a.keyboard.down("ArrowUp");await a.waitForTimeout(400);await a.keyboard.up("ArrowUp");
 await expect(a.locator("#speedDisplay")).toHaveText("0");
 await expect(a.locator("#driveTip")).toContainText("尚未啟用");
 await a.locator("#stopTestButton").click();
 await a.locator("#lockButton").click();
 await expect(a.locator("#toast")).toContainText("請先");
 const freshMotion=await a.evaluate(async()=>{
   const {pushMotion,sampleMotion}=await import("/motion.js");
   let q=pushMotion([],{x:0,y:0,angle:0,speed:80},1000);
   q=pushMotion(q,{x:10,y:0,angle:0,speed:80},1050);
   return sampleMotion(q,1025).x;
 });
 expect(freshMotion).toBe(5);
 await expect(a.locator("#blockViewNote")).toContainText("黃色事件");
 const compact=await a.evaluate(()=>{
  const panel=document.querySelector("#rightPanel").getBoundingClientRect();
  const help=document.querySelector("#helpButton").getBoundingClientRect();
  const consoleBox=document.querySelector("#feedbackPanel").getBoundingClientRect();
  const blocks=Blockly.getMainWorkspace().getTopBlocks(false);
  const positions=blocks.map(b=>({type:b.type,y:b.getRelativeToSurfaceXY().y,height:b.getHeightWidth().height}));
  return {panelBottom:panel.bottom,helpBottom:help.bottom,consoleBottom:consoleBox.bottom,
    positions,collapsed:blocks.filter(b=>b.isCollapsed()).length};
 });
 expect(compact.helpBottom).toBeLessThanOrEqual(compact.panelBottom+2);
 expect(compact.consoleBottom).toBeLessThanOrEqual(compact.panelBottom+2);
 expect(compact.collapsed).toBe(0);
 const byY=[...compact.positions].sort((a,b)=>a.y-b.y);
 for(let i=1;i<byY.length;i++)expect(byY[i].y).toBeGreaterThanOrEqual(byY[i-1].y+byY[i-1].height-1);
 await a.locator("#expandEditor").click();
 await expect(a.locator("#stage")).toHaveClass(/editor-focus/);
 expect(await a.locator("#blocklyDiv").evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(700);
 await a.locator("#eventType").selectOption("pickup");
 await a.locator("#addEventButton").click();
 await expect.poll(()=>a.evaluate(()=>Blockly.getMainWorkspace().getTopBlocks(false).some(b=>b.type==="event_pickup"))).toBe(true);
 await a.locator("#deleteBlockButton").click();
 await expect.poll(()=>a.evaluate(()=>Blockly.getMainWorkspace().getTopBlocks(false).some(b=>b.type==="event_pickup"))).toBe(false);
 await a.locator("#arrangeButton").click();
 await a.locator("#expandEditor").click();
 await expect(a.locator("#stage")).not.toHaveClass(/editor-focus/);
 await expect(a.locator("#quickDrive")).toBeVisible();
 await expect(t.locator("#name1")).toContainText("A 車手");
 await expect(t.locator("#name2")).toContainText("B 車手");
 await t.locator("#topicSelect").selectOption("free");
 await t.locator("#applySettings").click();
 await expect(a.locator("#missionTag")).toHaveText("自由設計");
 const build=async page=>page.evaluate(()=>{
  const w=Blockly.getMainWorkspace(),hat=w.getTopBlocks(false).find(b=>b.type==="event_start");
  let connection=hat.getInput("BODY").connection;
  for(const [type,value] of [["act_set_max",198],["act_set_accel",8],["act_set_steer",3],["act_set_brake",5]]){
    const b=w.newBlock(type);b.initSvg();b.setFieldValue(String(value),"VALUE");b.render();
    connection.connect(b.previousConnection);connection=b.nextConnection;
  }
 });
 await build(a);await build(b);
 await expect(a.locator("#buildCount")).toHaveText("4/4");
 await expect(t.locator("#studentDetails")).toContainText("最高速度");
 const blockCount=await a.evaluate(()=>Blockly.getMainWorkspace().getAllBlocks(false).length);
 const scaled=await a.evaluate(()=>{
  const stage=document.querySelector("#stage").getBoundingClientRect();
  const left=document.querySelector("#trackPanel").getBoundingClientRect();
  const right=document.querySelector("#rightPanel").getBoundingClientRect();
  return {width:stage.width,leftY:left.y,rightY:right.y,rightX:right.x,screen:innerWidth};
 });
 expect(Math.abs(scaled.width-scaled.screen)).toBeLessThan(3);
 expect(Math.abs(scaled.leftY-scaled.rightY)).toBeLessThan(2);
 expect(scaled.rightX).toBeLessThan(scaled.screen);
 // Blockly must remain a functional editor at non-native zoom.
 await a.locator("#blocklyDiv .blocklyToolboxCategory").filter({hasText:"變數"}).first().click();
 const visibleFlyout=a.locator("#blocklyDiv .blocklyFlyout").last();
 await expect(visibleFlyout).toBeVisible();
 const fly=visibleFlyout.locator(".blocklyDraggable").first();
 await expect(fly).toBeVisible();
 const src=await fly.boundingBox(),target=await a.locator("#blocklyDiv").boundingBox();
 await a.mouse.move(src.x+src.width/2,src.y+src.height/2);
 await a.mouse.down();
 await a.mouse.move(target.x+target.width*.73,target.y+target.height*.41,{steps:15});
 await a.mouse.up();
 expect(await a.evaluate(()=>Blockly.getMainWorkspace().getAllBlocks(false).length)).toBeGreaterThanOrEqual(blockCount);
 // A loose block must be connected or deleted before committing. Restore defaults and adjust the one target.
 await a.locator("#resetButton").click();
 await build(a);
 await expect(a.locator("#buildCount")).toHaveText("4/4");
 await a.locator("#testButton").click();
 await expect(a.locator("#retryTestButton")).toBeVisible();
 await expect(a.locator("#rescueButton")).toBeVisible();
 await a.locator("#rescueButton").click();
 await expect(a.locator("#toast")).toContainText("安全賽道");
 await a.keyboard.down("ArrowUp");
 await expect.poll(async()=>Number((await a.locator("#speedDisplay").innerText()).trim())).toBeGreaterThan(0);
 await a.keyboard.up("ArrowUp");
 await a.locator("#retryTestButton").click();
 await expect(a.locator("#toast")).toContainText("回到起點");
 await a.locator("#stopTestButton").click();
 await expect(a.locator("#testButton")).toBeVisible();
 await a.locator("#lockButton").click();
 await b.locator("#lockButton").click();
 await expect(t.locator("#startRace")).toBeEnabled();
 await t.locator("#startRace").click();
 await expect(t.locator("#phaseBadge")).toContainText("倒數");
 await expect(t.locator("#phaseBadge")).toContainText("正式比賽",{timeout:8000});
 await a.keyboard.down("ArrowUp");
 await b.keyboard.down("ArrowUp");
 await expect.poll(async()=>Number((await a.locator("#speedDisplay").innerText()).trim())).toBeGreaterThan(0);
 await expect.poll(async()=>Number((await b.locator("#speedDisplay").innerText()).trim())).toBeGreaterThan(0);
 await a.keyboard.up("ArrowUp");await b.keyboard.up("ArrowUp");
 await t.locator("#pauseRace").click();
 await expect(t.locator("#phaseBadge")).toContainText("暫停");
 await t.locator("#resumeRace").click();
 await t.locator("#finishRace").click();
 await expect(t.locator("#report")).toContainText("第 1 回合");
 await expect(a.locator("#raceOverlay")).toContainText("賽後分析");
 await t.locator("#restartRace").click();
 await a.reload();
 await expect(a.locator("#roomBadge")).toContainText(code);
 await t.locator("#assistOp").selectOption("set_max");
 await t.locator("#assistValue").fill("170");
 await t.locator("#assistApply").click();
 await expect.poll(()=>a.evaluate(()=>Number(Blockly.getMainWorkspace().getAllBlocks(false).find(b=>b.type==="act_set_max").getFieldValue("VALUE")))).toBe(170);
 await t.locator("#teacherHint").fill("請觀察最大速度和加速度的差異");
 await t.locator("#sendHint").click();
 await expect(a.locator("#codeFeedback")).toContainText("老師提示");
 await teacher.close();await s1.close();await s2.close();
});

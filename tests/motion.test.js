import test from "node:test";
import assert from "node:assert/strict";
import {RENDER_DELAY_MS,pushMotion,sampleMotion} from "../public/motion.js";

test("server positions interpolate continuously between 20Hz snapshots",()=>{
 assert.equal(RENDER_DELAY_MS,100);
 let samples=pushMotion([],{x:0,y:0,angle:0,speed:80},1000);
 samples=pushMotion(samples,{x:10,y:5,angle:Math.PI/2,speed:100},1050);
 assert.deepEqual(sampleMotion(samples,1000),{x:0,y:0,angle:0,speed:80});
 const p=sampleMotion(samples,1025);
 assert.ok(Math.abs(p.x-5)<1e-6);
 assert.ok(Math.abs(p.y-2.5)<1e-6);
 assert.ok(Math.abs(p.angle-Math.PI/4)<1e-6);
 assert.ok(Math.abs(p.speed-90)<1e-6);
 assert.deepEqual(sampleMotion(samples,1050),{x:10,y:5,angle:Math.PI/2,speed:100});
 // Interpolation is based on time, not a fixed 0.22 easing at variable monitor FPS.
 assert.ok(sampleMotion(samples,1016.67).x<sampleMotion(samples,1033.33).x);
});

test("visual extrapolation is short and angle interpolation follows shortest arc",()=>{
 const a=Math.PI-.1,b=-Math.PI+.1;
 let samples=pushMotion([],{x:0,y:0,angle:a,speed:100},2000);
 samples=pushMotion(samples,{x:5,y:0,angle:b,speed:100},2050);
 const mid=sampleMotion(samples,2025);
 assert.ok(Math.abs(Math.abs(mid.angle)-Math.PI)<.01,"should turn 0.2 rad rather than spin full circle");
 assert.ok(Math.abs(sampleMotion(samples,2090).x-9)<1e-6);
 assert.ok(Math.abs(sampleMotion(samples,2180).x-9)<1e-6,"extrapolation is capped at 40ms");
});

test("rescues snap to a new path and stale packets cannot rewind animation",()=>{
 let samples=pushMotion([],{x:100,y:100,angle:0,speed:0},1000);
 samples=pushMotion(samples,{x:105,y:100,angle:0,speed:80},1050);
 samples=pushMotion(samples,{x:600,y:250,angle:1,speed:35},1100);
 assert.equal(samples.length,1,"a teleport must not be animated across the grass");
 assert.equal(sampleMotion(samples,1100).x,600);
 const stale=pushMotion(samples,{x:0,y:0,angle:0,speed:0},1050);
 assert.strictEqual(stale,samples);
});

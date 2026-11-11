import test from 'node:test';
import assert from 'node:assert/strict';
import {canScroll,dragAxis,flingSpeed,nextFlingSpeed,MIN_FLING_SPEED} from '../src/core/builders/PageBuilder/previewDragScroll';

const box=(top:number,left=0)=>({scrollTop:top,scrollLeft:left,scrollHeight:1000,scrollWidth:300,clientHeight:400,clientWidth:300});

test('drag picks the main axis and only scrolls what can still move',()=>{
 assert.equal(dragAxis(3,-40),'y');
 assert.equal(dragAxis(-50,10),'x');
 assert.equal(canScroll(box(0),'y',10),true);
 assert.equal(canScroll(box(0),'y',-10),false,'already at the top');
 assert.equal(canScroll(box(600),'y',10),false,'already at the bottom');
 assert.equal(canScroll(box(0),'x',10),false,'no sideways overflow');
});

test('fling speed from the last 100ms and friction stops it',()=>{
 const samples=[{t:0,x:0,y:0},{t:150,x:0,y:-10},{t:200,x:0,y:-60},{t:250,x:0,y:-110}];
 assert.equal(flingSpeed(samples,'y'),-1,'(-110 - -10) px / 100 ms');
 assert.equal(flingSpeed([{t:5,x:0,y:0}],'y'),0);
 let speed=2,frames=0;
 while(speed&&frames<1000){speed=nextFlingSpeed(speed,16);frames++;}
 assert.equal(speed,0);
 assert.ok(frames>20&&frames<200,'slows down over a short time: '+frames);
 assert.equal(nextFlingSpeed(MIN_FLING_SPEED/2,16),0);
});

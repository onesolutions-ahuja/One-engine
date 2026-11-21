import test from 'node:test';
import assert from 'node:assert/strict';
import {clearPageTimings,markPageOpen,notePageRows,noteLiveDrawn,pageTimings,setTimingClock,startTap} from '../src/core/pages/PageCompiler/pageTimings.ts';
import {createCompiledDataLayer} from '../src/core/pages/PageCompiler/compiledPageStore.ts';

let now=0;
setTimingClock(()=>now);

test('page open: first local rows and first server rows are timed once each',()=>{
 clearPageTimings();
 now=100;markPageOpen('till');
 now=112;notePageRows('till','local');
 now=130;notePageRows('till','local');
 now=340;notePageRows('till','server');
 now=400;notePageRows('till','server');
 assert.deepEqual(pageTimings().map(item=>[item.kind,item.ms]),[['open→local rows',12],['open→server rows',240]]);
});

test('a tap is timed to the screen change and to the save; live changes to drawn',()=>{
 clearPageTimings();
 now=0;const tap=startTap('till','grid:click');
 now=8;tap.shown(true);
 now=9;tap.shown(false);
 now=290;tap.saved();
 now=1000;noteLiveDrawn('display',994,'CartLine');
 assert.deepEqual(pageTimings().map(item=>[item.kind,item.ms,item.detail]),
  [['tap→screen',8,'predicted grid:click'],['tap→saved',290,'grid:click'],['live→drawn',6,'CartLine']]);
});

test('only the last 50 timings are kept',()=>{
 clearPageTimings();
 for(let index=0;index<70;index++)noteLiveDrawn('p',now,'X');
 assert.equal(pageTimings().length,50);
});

test('the data layer reports when a page first draws server rows',async()=>{
 clearPageTimings();
 const compiled={apiName:'grid',components:[],dataSources:[{id:'P#1',objectApiName:'P',components:[],scope:{kind:'none'},
  complete:false,filters:null,filterLogic:'AND',filterFormula:'',stateInputs:[]}]} as never;
 now=0;markPageOpen('grid');
 const layer=createCompiledDataLayer(compiled,async()=>{now=55;return {records:[{Id:'a'}],total:1,predictable:true,paged:true};},()=>({}));
 await layer.start();
 assert.deepEqual(pageTimings().map(item=>[item.page,item.kind,item.ms]),[['grid','open→server rows',55]]);
});

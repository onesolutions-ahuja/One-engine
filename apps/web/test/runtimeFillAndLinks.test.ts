import test from 'node:test';
import assert from 'node:assert/strict';
import {brokenPageLinks,linkedPages,screenTargetsIn} from '../src/core/builders/PageBuilder/pageLinkCheck';
import {runtimeAppScreenScale,runtimeCanvasExtra,runtimeVerticalComponentStyle} from '../src/core/pages/PageRuntime/runtimeCanvasSizing';
import type {PageComponentMetadata} from '../src/core/metadata/Definitions/metadata';

test('SCREEN, Navigate and @navigate links are found at any depth',()=>{
 assert.deepEqual(screenTargetsIn('=SCREEN(Dashboard)'),['Dashboard']);
 assert.deepEqual(screenTargetsIn('=IF(@x=1,SCREEN("Pay",popup),SCREEN(Kitchen))'),['Pay','Kitchen']);
 assert.deepEqual(screenTargetsIn('@a := 1; SCREEN(Reports, current)'),['Reports']);
 assert.deepEqual(screenTargetsIn('=SUM(1,2)'),[]);
 assert.deepEqual(linkedPages({items:[{action:{formula:'=SCREEN(Dashboard)'}}],
  actionFlows:{click:{actionType:'Navigate',navigationTargetType:'App Page',navigationPageApiName:'Tables'}},
  other:'@navigate.page := "SMARTTILL/Kitchen"'}).sort(),['Dashboard','Kitchen','Tables']);
});

test('only links to pages that no longer exist are broken (any letter case)',()=>{
 const components=[
  {id:'dock',label:'Dock',properties:{navigatorName:'Dock',items:[{formula:'=SCREEN(Dashboard)'},{formula:'=SCREEN(till)'}]}},
  {id:'ok',label:'Ok',properties:{formula:'=SCREEN(Till)'}},
 ];
 const broken=brokenPageLinks(components,[{apiName:'till'}]);
 assert.equal(broken.length,1);
 assert.equal(broken[0].componentId,'dock');
 assert.equal(broken[0].page,'Dashboard');
 assert.match(broken[0].message,/no longer exists/);
});

const at=(id:string,x:number,y:number,width:number,height:number):PageComponentMetadata=>
 ({id,type:'Custom:smart_label',label:id,visible:true,properties:{},position:{x,y,width,height}});
const page={canvasWidth:1920,canvasHeight:1080,components:[] as PageComponentMetadata[]};

test('a screen a little shorter than the page fits it; a much taller page still scrolls',()=>{
 assert.equal(runtimeAppScreenScale(1920,1080,1920,1080),1);
 assert.equal(runtimeAppScreenScale(1920,1080,1920,1000),1000/1080);
 assert.equal(runtimeAppScreenScale(1440,3000,1440,900),1);
 assert.deepEqual(runtimeCanvasExtra(1920,1080,1,1920,1200),{x:0,y:120});
 assert.deepEqual(runtimeCanvasExtra(1920,1080,1000/1080,1920,1000),{x:153,y:0});
});

test('extra height moves bottom bars down and grows tall surfaces only',()=>{
 assert.deepEqual(runtimeVerticalComponentStyle(page,at('dock',360,975,1100,85)),
  {top:'calc(975px + var(--md-runtime-canvas-extra-y, 0px))'});
 assert.deepEqual(runtimeVerticalComponentStyle(page,at('grid',10,150,1200,790)),
  {height:'calc(790px + var(--md-runtime-canvas-extra-y, 0px))'});
 assert.deepEqual(runtimeVerticalComponentStyle(page,at('tabs',20,85,1190,50)),{});
 assert.deepEqual(runtimeVerticalComponentStyle(page,{...at('nested',0,975,10,10),parentId:'x'}),{});
});

test('notices about something to fix are red and stay; ordinary ones fade',async()=>{
 const {isProblemNotice}=await import('../src/core/workspace/SetupShell/toastTone');
 for(const text of ['Not published (saved as version 3). 13 broken links …','Saved app version 2. 1 broken link (red on the canvas)',
  'Unable to publish the app','Saved. 2 formula errors to fix: x'])assert.equal(isProblemNotice(text),true,text);
 for(const text of ['Saved app version 4','Page layout published','Published app version 5'])assert.equal(isProblemNotice(text),false,text);
});

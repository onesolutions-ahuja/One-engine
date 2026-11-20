import test from 'node:test';
import assert from 'node:assert/strict';
import {componentLayer,layerShows,pageLayerNumbers,layerCaption,layerNumber} from '../src/core/pages/PageRuntime/pageLayers.ts';
import {parseScreenAction,compileActionPlan} from '../../server/src/expression-engine/ActionFormulas.ts';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode.ts';
import {exportInventoryCsv,applyInventoryCsv} from '../../server/src/system-support/page-inventory-csv.ts';

const c=(id:string,properties:Record<string,unknown>={})=>({id,properties:{navigatorName:id,...properties}});
const components=[c('Cart'),c('PayOverlay',{pageLayer:1}),c('PayAmount',{layoutParentId:'PayOverlay'}),
 c('ThanksBox',{pageLayer:3}),c('Header',{pageLayer:0})];

test('a component is on its own layer, else its container\'s, else 0',()=>{
 assert.deepEqual(components.map(item=>componentLayer(item,components)),[0,1,1,3,0]);
 assert.deepEqual(pageLayerNumbers(components),[0,1,3]);
 assert.equal(layerCaption(0,components),'Default');
 assert.equal(layerCaption(3,components),'ThanksBox');
 assert.equal(layerNumber('2'),2);assert.equal(layerNumber(10),null);assert.equal(layerNumber(-1),null);
});

test('layer 0 always shows; one other layer shows on top only while it is current',()=>{
 assert.equal(layerShows(0,3),true);
 assert.equal(layerShows(3,3),true);
 assert.equal(layerShows(1,3),false);
 assert.equal(layerShows(1,0),false);
});

test('SCREEN(page, n) opens or switches page to layer n; modes still work',()=>{
 assert.deepEqual(parseScreenAction('SCREEN(smart_till_customer_display, 3)'),
  {page:'smart_till_customer_display',mode:'current',record:undefined,layer:3});
 assert.equal(parseScreenAction('SCREEN(Payment, popup)').mode,'popup');
 assert.equal(parseScreenAction('SCREEN(Payment, popup)').layer,undefined);
 assert.throws(()=>parseScreenAction('SCREEN(Payment, 12)'));
 // Inside ACTIONS(...) too, e.g. when a sale is complete.
 const plan=compileActionPlan('=ACTIONS(SCREEN(smart_till_customer_display, 3))') as unknown as Array<{name:string;values:Array<{value:unknown}>}>;
 assert.equal(plan[0]?.name,'SCREEN');assert.equal(plan[0]?.values[0]?.value,3);
 // Server-built page code passes the layer on to the browser, which reads it as SCREEN(page,3).
 assert.match(compileActionFormula('=SCREEN(smart_till_customer_display, 3)','').js,/\$\.ui\("SCREEN", "smart_till_customer_display", "3"\)/);
});

test('Upload CSV reads and writes the page layer of a component',()=>{
 const page={apiName:'display',layoutMode:'free-canvas',components:[
  {id:'a',type:'Custom:smart_text',label:'t',visible:true,position:{x:0,y:0,width:10,height:10},properties:{navigatorName:'Thanks',pageLayer:3}},
  {id:'b',type:'Custom:smart_text',label:'t',visible:true,position:{x:0,y:0,width:10,height:10},properties:{navigatorName:'Cart'}}]};
 const csv=exportInventoryCsv(page as never,new Map(),'Custom');
 assert.match(csv,/display,smart_text,Thanks,pageLayer,3,Custom/);
 assert.match(csv,/display,smart_text,Cart,pageLayer,0,Custom/);
 const upload='pageapi,component_type,component_name,propertyid,value,layout\r\ndisplay,smart_text,Cart,pageLayer,2,Custom\r\n';
 const result=applyInventoryCsv(page as never,upload,new Map(),'Custom' as never);
 assert.deepEqual(result.issues,[]);
 assert.equal(result.page.components.find(item=>item.id==='b')?.properties.pageLayer,2);
 const bad=applyInventoryCsv(page as never,upload.replace(',2,',',12,'),new Map(),'Custom' as never);
 assert.equal(bad.valid,false,'layers are 0-9');
});

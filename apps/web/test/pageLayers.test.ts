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
 assert.equal(layerCaption(0),'Default');
 assert.equal(layerCaption(3),'Screen');
 assert.equal(layerNumber('2'),2);assert.equal(layerNumber(10),null);assert.equal(layerNumber(-1),null);
});

test('layers are separate screens: only the current layer shows, layer 0 included',()=>{
 assert.equal(layerShows(0,3),false);
 assert.equal(layerShows(0,0),true);
 assert.equal(layerShows(3,3),true);
 assert.equal(layerShows(1,3),false);
 assert.equal(layerShows(1,0),false);
});

test('SCREEN(page, n) opens or switches page to layer n; modes still work',()=>{
 assert.deepEqual(parseScreenAction('SCREEN(smart_till_customer_display, 3)'),
  {page:'smart_till_customer_display',mode:'current',record:undefined,layer:3,modeGiven:false});
 assert.equal(parseScreenAction('SCREEN(Payment, popup)').mode,'popup');
 assert.equal(parseScreenAction('SCREEN(Payment, popup)').layer,undefined);
 assert.throws(()=>parseScreenAction('SCREEN(Payment, 12)'));
 // Inside ACTIONS(...) too, e.g. when a sale is complete.
 const plan=compileActionPlan('=ACTIONS(SCREEN(smart_till_customer_display, 3))') as unknown as Array<{name:string;values:Array<{value:unknown}>}>;
 assert.equal(plan[0]?.name,'SCREEN');assert.equal(plan[0]?.values[2]?.value,3);
 // Server-built page code passes the layer on to the browser, which reads it as SCREEN(page,3).
 // No mode: blank, so the browser only switches the page where it shows (never leaves this screen).
 assert.match(compileActionFormula('=SCREEN(smart_till_customer_display, 3)','').js,/\$\.ui\("SCREEN", "smart_till_customer_display", "", "", "3"\)/);
 assert.match(compileActionFormula('=SCREEN(smart_till_customer_display, current, 3)','').js,/\$\.ui\("SCREEN", "smart_till_customer_display", "current", "", "3"\)/);
 assert.equal(parseScreenAction('SCREEN(smart_till_customer_display, current, 3)').modeGiven,true);
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

test('SCREEN inputs after the page come in any order, blanks allowed; old formulas unchanged',()=>{
 const want={page:'Payment',mode:'popup',record:'ThisPage.Cart.recordId',layer:2,modeGiven:true};
 for(const formula of ['SCREEN(Payment, popup, @ThisPage.Cart.recordId, 2)','SCREEN(Payment, 2, popup, @ThisPage.Cart.recordId)',
  'SCREEN(Payment, @ThisPage.Cart.recordId, 2, popup)']){
  const parsed=parseScreenAction(formula);
  assert.deepEqual({...parsed,record:parsed.record?.replace(/^@/,'')},want,formula);
 }
 assert.deepEqual(parseScreenAction('SCREEN(Payment, popup, , 2)'),{page:'Payment',mode:'popup',record:undefined,layer:2,modeGiven:true});
 assert.deepEqual(parseScreenAction('SCREEN(Payment, , , 2)'),{page:'Payment',mode:'current',record:undefined,layer:2,modeGiven:false});
 assert.deepEqual(parseScreenAction('SCREEN(Payment, second, 3)'),{page:'Payment',mode:'second',record:undefined,layer:3,modeGiven:true});
 // Existing formulas: same result as before.
 assert.deepEqual(parseScreenAction('SCREEN(Payment)'),{page:'Payment',mode:'current',record:undefined});
 assert.deepEqual(parseScreenAction('SCREEN(Payment, popup)'),{page:'Payment',mode:'popup',record:undefined});
 assert.equal(parseScreenAction('SCREEN(edit, popup, @event.recordId)').mode,'popup');
 assert.ok(parseScreenAction('SCREEN(edit, popup, @event.recordId)').record);
 assert.equal(parseScreenAction('SCREEN(Payment, 2, 3)').seconds,3); // layer, then seconds
 assert.throws(()=>parseScreenAction('SCREEN(Payment, popup, second)'),/two modes/);
 assert.throws(()=>parseScreenAction('SCREEN(Payment, 12)'),/0-9/);
 // Server-built code passes page, mode, record, layer in that fixed order.
 assert.match(compileActionFormula('=SCREEN(Payment, 2, popup)','').js,/\$\.ui\("SCREEN", "Payment", "popup", "", "2"\)/);
 assert.match(compileActionFormula('=SCREEN(Payment, popup, , 2)','').js,/\$\.ui\("SCREEN", "Payment", "popup", "", "2"\)/);
 assert.match(compileActionFormula('=SCREEN(Payment, popup)','').js,/\$\.ui\("SCREEN", "Payment", "popup"\)/);
 const plan=compileActionPlan('=ACTIONS(SCREEN(Payment, 1, popup))') as unknown as Array<{values:Array<{value:unknown}>}>;
 assert.deepEqual(plan[0]?.values.map(item=>item.value),['popup',null,1]);
});

test('a page opened on a layer in a new window keeps ?layer= through the address tidy',async()=>{
 const {keepScreenParams}=await import('../src/core/workspace/Navigation/appRouting.ts');
 assert.equal(keepScreenParams('/une/apps/X/pages/pay','?layer=2&junk=1'),'/une/apps/X/pages/pay?layer=2');
 assert.equal(keepScreenParams('/une/apps/X/pages/pay','?layer=22'),'/une/apps/X/pages/pay');
});

test('SCREEN(page, layer, seconds): show the layer that long, then layer 0',()=>{
 assert.equal(parseScreenAction('SCREEN(Disp, 5, 4)').seconds,4);
 assert.equal(parseScreenAction('SCREEN(Disp, 5, 4)').layer,5);
 assert.equal(parseScreenAction('SCREEN(Disp, 5)').seconds,undefined);
 assert.throws(()=>parseScreenAction('SCREEN(Disp, 5, 99)'),/1-60/);
 assert.throws(()=>parseScreenAction('SCREEN(Disp, popup, 5, 4)'),/seconds/);
});

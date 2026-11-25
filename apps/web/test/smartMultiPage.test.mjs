import test from 'node:test';
import assert from 'node:assert/strict';
import {pageKeyList,shownPages,activePage,tabBarLook} from '../src/component-libraries/smart_multipage/multiPageModel.js';

const pages=['Cash','Card','PayPal','GiftCard'].map(key=>({key,label:key}));
test('visible tabs keep formula order and ignore blanks/duplicates',()=>{
 assert.deepEqual(pageKeyList(' paypal, Cash ,,cash'),['paypal','Cash']);
 assert.deepEqual(shownPages(pages,'PayPal,Cash').map(p=>p.key),['PayPal','Cash']);
 assert.equal(shownPages(pages,'').length,4);
 assert.equal(shownPages(pages,'Cash',true).length,4);
 assert.deepEqual(shownPages(pages,'Klarna'),[]);
});
test('tab bar look: blank is macOS segmented (centred, medium, rounded); values are case-insensitive',()=>{
 assert.deepEqual(tabBarLook({}),{align:'center',size:'medium',shape:'rounded'});
 assert.deepEqual(tabBarLook({multiPageTabAlign:'stretch',multiPageTabSize:'Large',multiPageTabShape:'PILL'}),{align:'stretch',size:'large',shape:'pill'});
 assert.deepEqual(tabBarLook({multiPageTabAlign:'middle'}).align,'center','unknown values fall back');
});
test('open page: builder selection, then tapped tab, then Active tab, then first',()=>{
 const shown=shownPages(pages,'Cash,PayPal');
 assert.equal(activePage(shown,{}).key,'Cash');
 assert.equal(activePage(shown,{active:'paypal'}).key,'PayPal');
 assert.equal(activePage(shown,{active:'PayPal',picked:'Cash'}).key,'Cash');
 assert.equal(activePage(shown,{active:'Card'}).key,'Cash');
 assert.equal(activePage(pages,{picked:'Cash',selected:'GiftCard'}).key,'GiftCard');
 assert.equal(activePage([],{}),null);
});

test('page CSV puts a component inside a container by name (component.parent)',async()=>{
 const {exportInventoryCsv,applyInventoryCsv}=await import('../../server/src/system-support/page-inventory-csv.ts');
 const box=(id,type,name)=>({id,type,label:name,visible:true,position:{x:0,y:0,width:10,height:10},properties:{navigatorName:name}});
 const page={apiName:'pay',layoutMode:'free-canvas',components:[
  box('m','Custom:smart_multipage','PayHelper'),box('c','Custom:smart_container','CashPage'),box('t','Custom:smart_text','Note')]};
 const csv='pageapi,component_type,component_name,propertyid,value,layout\r\n'+
  'pay,smart_container,CashPage,component.parent,PayHelper,Custom\r\npay,smart_text,Note,component.parent,CashPage,Custom\r\n';
 const done=applyInventoryCsv(page,csv,new Map(),'Custom');
 assert.deepEqual(done.issues,[]);
 const byId=id=>done.page.components.find(c=>c.id===id);
 assert.equal(byId('c').properties.layoutParentId,'m');
 assert.equal(byId('t').properties.layoutParentId,'c');
 assert.match(exportInventoryCsv(done.page,new Map(),'Custom'),/pay,smart_text,Note,component\.parent,CashPage,Custom/);
 const loop=applyInventoryCsv(done.page,'pageapi,component_type,component_name,propertyid,value,layout\r\npay,smart_container,CashPage,component.parent,Note,Custom\r\n',new Map(),'Custom');
 assert.equal(loop.valid,false,'Note is a text, not a container');
 const out=applyInventoryCsv(done.page,'pageapi,component_type,component_name,propertyid,value,layout\r\npay,smart_text,Note,component.parent,none,Custom\r\n',new Map(),'Custom');
 assert.equal(out.page.components.find(c=>c.id==='t').properties.layoutParentId,undefined);
});

test('children of a container keep their own position, counted from the container',async()=>{
 const {nestedCanvasStyle,containerCanvasSize}=await import('../src/core/pages/TemplatePageRuntime/pageComponentLayout.ts');
 const {translateCanvasSelection}=await import('../src/core/builders/PageBuilder/canvasSelectionInteractions.ts');
 const c=(id,type,position,parent)=>({id,type,label:id,position,properties:parent?{layoutParentId:parent}:{}});
 const items=[c('box','Custom:smart_container',{x:100,y:100,width:300,height:200}),
  c('btn','Custom:smart_button',{x:10,y:20,width:80,height:40},'box'),
  c('mp','Custom:smart_multipage',{x:0,y:0,width:400,height:300}),c('cash','Custom:smart_container',{x:5,y:5,width:10,height:10},'mp')];
 assert.deepEqual(nestedCanvasStyle(items,items[1]),{position:'absolute',left:10,top:20,width:80,height:40});
 assert.equal(nestedCanvasStyle(items,items[3]).width,'100%','a MultiPage page fills the page area');
 assert.deepEqual(containerCanvasSize(items,'cash'),{width:400,height:300});
 const moved=translateCanvasSelection(items,['btn'],500,5,containerCanvasSize(items,'box'));
 assert.deepEqual(moved.find(x=>x.id==='btn').position,{x:220,y:25,width:80,height:40},'stays inside its container');
});

test('page Excel: one workbook (Pages, Guide, Sample) round-trips the page data',async()=>{
 const {inventoryWorkbook,inventoryCsvFromWorkbook}=await import('../../server/src/system-support/page-inventory-xlsx.ts');
 const {readLoaderWorkbook}=await import('../../server/src/system-support/metadata-loader-xlsx.ts');
 let csv='pageapi,component_type,component_name,propertyid,value,layout,ribbon_tab\r\n';
 for(let i=0;i<9500;i++)csv+='p,smart_text,T'+i+',textSource,"=""a, b""",Custom,Data\r\n';
 const book=inventoryWorkbook(csv);
 assert.deepEqual(readLoaderWorkbook(book).map(s=>s.name),['Pages','Pages 2','Guide','Sample']);
 assert.equal(inventoryCsvFromWorkbook(book),csv);
});

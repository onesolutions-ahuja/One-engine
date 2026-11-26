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

// Page Builder: MultiPage tabs are opened by click, added with +, renamed in place,
// and new components go INTO the open tab (not a new tab each time).
const tabsPage=()=>{
 const c=(id,type,label,parent,extra={})=>({id,type,label,visible:true,position:{x:0,y:0,width:100,height:80},
  properties:{...(parent?{layoutParentId:parent}:{}),...extra}});
 return [c('mp','Custom:smart_multipage','Pay'),c('cash','Custom:smart_container','Cash','mp'),
  c('card','Custom:smart_container','Card','mp'),c('btn','Custom:smart_button','Button','card'),
  c('label','Custom:smart_label','Label',null,{visibleFormula:'=@ThisPage.payTab="Card"'})];
};
test('builder: open tab follows the selection, else the remembered tab, else the first',async()=>{
 const {openMultiPageTab,multiPageTabsHolding}=await import('../src/core/builders/PageBuilder/multiPageBuilder.ts');
 const all=tabsPage();
 assert.equal(openMultiPageTab(all,'mp',null)?.id,'cash');
 assert.equal(openMultiPageTab(all,'mp',null,'card')?.id,'card');
 assert.equal(openMultiPageTab(all,'mp','btn','cash')?.id,'card','a selected component opens its tab');
 assert.deepEqual(multiPageTabsHolding(all,'btn'),{mp:'card'});
 assert.deepEqual(multiPageTabsHolding(all,'label'),{});
});
test('builder: inserting into a MultiPage goes into the open tab; Add tab makes a tab',async()=>{
 const {multiPageInsertParent,nextTabName}=await import('../src/core/builders/PageBuilder/multiPageBuilder.ts');
 const all=tabsPage();
 assert.equal(multiPageInsertParent(all,'mp',{}),'cash');
 assert.equal(multiPageInsertParent(all,'mp',{mp:'card'}),'card');
 assert.equal(multiPageInsertParent(all,'mp',{mp:'card'},true),'mp');
 assert.equal(multiPageInsertParent(all,'card',{}),'card');
 assert.equal(multiPageInsertParent(all,null,{}),null);
 assert.equal(nextTabName(all,'mp'),'Page 3');
});
test('builder: rename a tab; a key used by a formula is kept as its Page key',async()=>{
 const {renameMultiPageTab,moveMultiPageTab}=await import('../src/core/builders/PageBuilder/multiPageBuilder.ts');
 const all=tabsPage();
 const cash=renameMultiPageTab(all,'cash','Cash money');
 assert.equal(cash.components.find(x=>x.id==='cash').label,'Cash money');
 assert.equal(cash.components.find(x=>x.id==='cash').properties.pageKey,undefined);
 const card=renameMultiPageTab(all,'card','Card payment');
 assert.equal(card.components.find(x=>x.id==='card').properties.pageKey,'Card','formula keeps working');
 assert.match(renameMultiPageTab(all,'cash','card').error,/already/);
 assert.match(renameMultiPageTab(all,'cash','  ').error,/name/);
 assert.match(renameMultiPageTab(all,'btn','X').error,/tab/);
 assert.deepEqual(moveMultiPageTab(all,'card',-1).map(x=>x.id).slice(0,3),['mp','card','cash']);
 assert.equal(moveMultiPageTab(all,'cash',-1),all,'first tab cannot move left');
});
test('builder: a shape already outside its container moves from where it is (no jump)',async()=>{
 const {reachableMoveArea,translateCanvasSelection}=await import('../src/core/builders/PageBuilder/canvasSelectionInteractions.ts');
 const {canvasBoundPosition}=await import('../src/core/pages/PageRuntime/pageCanvas.ts');
 const original={x:1152,y:426,width:120,height:40};
 const area=reachableMoveArea({width:560,height:380},original);
 assert.deepEqual(area,{width:1272,height:466});
 assert.deepEqual(canvasBoundPosition({...original,x:1160},area,false),{x:1152,y:426},'cannot go further out');
 assert.deepEqual(canvasBoundPosition({...original,x:1100,y:400},area,false),{x:1100,y:400});
 const parts=[{id:'mp',type:'X',label:'c',properties:{},position:{x:0,y:0,width:560,height:380}},
  {id:'b',type:'X',label:'b',properties:{layoutParentId:'mp'},position:original}];
 const moved=translateCanvasSelection(parts,['b'],-40,-20,area);
 assert.deepEqual(moved[1].position,{...original,x:1112,y:406});
});
test('builder: data previews redraw only when what they show changed',async()=>{
 const {sameBuilderBinding}=await import('../src/core/builders/PageBuilder/builderBindingMemo.ts');
 const properties={a:1};
 const component={id:'x',type:'T',label:'L',visible:true,properties,position:{x:0,y:0,width:1,height:1}};
 const base={builderPreview:true,component,pageComponents:[component],availableFlows:[1],onNavigate:()=>1};
 assert.equal(sameBuilderBinding(base,{...base,component:{...component,position:{x:9,y:9,width:1,height:1}},
  pageComponents:[{...component,position:{x:9,y:9,width:1,height:1}}],availableFlows:[1],onNavigate:()=>2}),true);
 assert.equal(sameBuilderBinding(base,{...base,component:{...component,properties:{a:2}}}),false);
 assert.equal(sameBuilderBinding({...base,builderPreview:false},{...base,builderPreview:false}),false,'never in the live page');
});

test('actions may set a component look: BackgroundColor, TextColor, BorderColor, IconColor, Icon',async()=>{
 const {uiProperty,uiPropertyValue,uiPropertyProps,readComponentProperty,withComponentProperties}=
  await import('../../server/src/expression-engine/FormulaComponentState.ts');
 const {assignedProperty}=await import('../../server/src/expression-engine/PageReferences.ts');
 const node=(left)=>({kind:'binary',operator:'=',left:{kind:'reference',value:left},right:{kind:'literal',value:'#34C759'}});
 assert.deepEqual(assignedProperty(node('@ThisPage.PayBtn.backgroundcolor')),{name:'PayBtn',property:'BackgroundColor'});
 assert.deepEqual(assignedProperty(node('@ThisPage.PayBtn.Caption')),{name:'PayBtn',property:'Caption'});
 assert.equal(assignedProperty(node('@ThisPage.PayBtn.Value')),null,'Value stays a component value');
 assert.equal(uiProperty('ICON'),'Icon');
 assert.equal(uiPropertyValue('BackgroundColor','green'),'green');
 assert.equal(uiPropertyValue('TextColor',' #fff '),'#fff');
 assert.equal(uiPropertyValue('BorderColor',''),'','blank = back to the design');
 assert.throws(()=>uiPropertyValue('BackgroundColor','red;background:url(x)'),/colour/);
 assert.equal(uiPropertyValue('Icon','check'),'check');
 assert.throws(()=>uiPropertyValue('Icon','../x'),/icon/i);
 const state=withComponentProperties({},'PayBtn','set',{BackgroundColor:'#34C759',Icon:'check'});
 assert.equal(readComponentProperty(state,'paybtn','BackgroundColor'),'#34C759');
 assert.deepEqual(uiPropertyProps({BackgroundColor:'#34C759',TextColor:'#fff',Icon:'check'},'smart_button'),
  {backgroundColor:'#34C759',shapeFill:'#34C759',labelColor:'#fff',shapeId:'check'});
 assert.deepEqual(uiPropertyProps({Icon:'spinner',IconColor:'#ff9500'},'smart_icon'),{iconFillColor:'#ff9500',iconId:'spinner'});
 assert.deepEqual(uiPropertyProps({Caption:'x',Disabled:true},'smart_button'),{});
});
test('MultiPage tabs show each tab icon; the open tab uses the selected icon colour; spinner icon turns',async()=>{
 const fs=await import('node:fs');const vm=await import('node:vm');const React=(await import('react')).default;
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {buildBundledComponent}=await import('../../../scripts/component-catalog.mjs');
 const descriptor=JSON.parse(fs.readFileSync(new URL('../src/component-libraries/smart_multipage/component.json',import.meta.url),'utf8'));
 const built=await buildBundledComponent(descriptor);
 const sandbox={React,module:{exports:{}},Date,Intl,URL,crypto:globalThis.crypto};
 vm.runInNewContext(built.compiledJs,sandbox);
 const kid=(key,icon)=>React.createElement('div',{key,'data-page-key':key,'data-page-label':key,'data-page-icon':icon},key);
 const html=renderToStaticMarkup(React.createElement(sandbox.module.exports.default,{
  multiPageSelectedIconColor:'#ff0000',multiPageIconColor:'#00ff00',children:[kid('Cash','banknote'),kid('Card','credit-card'),kid('Gift')]}));
 assert.match(html,/smart-multipage-tab-icon[^>]*background-color:#ff0000[^>]*banknote/);
 assert.match(html,/smart-multipage-tab-icon[^>]*background-color:#00ff00[^>]*credit-card/);
 assert.equal((html.match(/smart-multipage-tab-icon/g)||[]).length,2,'a tab without an icon shows none');
 const {smartIconPaint}=await import('../src/component-libraries/smart_icon/iconPaint.js');
 assert.match(String(smartIconPaint('spinner','#000').animation),/smart-spin/);
 assert.equal(smartIconPaint('check','#000').animation,undefined);
});

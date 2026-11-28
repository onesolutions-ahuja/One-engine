import test from 'node:test';
import assert from 'node:assert/strict';
import {exportInventoryCsv,inventoryCsvPageGroups,isFormulaInventoryValue} from '../../server/src/system-support/page-inventory-csv';

const page=(apiName:string)=>({apiName,layoutMode:'free-canvas',components:[
 {id:'b1',type:'Custom:smart_button',label:'smart_button',visible:true,position:{x:0,y:0,width:80,height:40},
  properties:{navigatorName:'PayButton',label:'Pay',actionFlows:{click:{actionType:'Formula',formula:'=CLOSESCREEN()'}}}},
 {id:'c1',type:'Custom:smart_cart',label:'smart_cart',visible:true,position:{x:0,y:0,width:80,height:40},
  properties:{navigatorName:'SaleCart',filterFormula:'@CartLine.Status = "Open"',radius:12}}]});

test('formula rows: "=…" and @ references, nothing else',()=>{
 assert.equal(isFormulaInventoryValue('=SUM(1)'),true);
 assert.equal(isFormulaInventoryValue('@Product.Name'),true);
 assert.equal(isFormulaInventoryValue('12'),false);
 assert.equal(isFormulaInventoryValue('Pay'),false);
 assert.equal(isFormulaInventoryValue('a@b'),false,'an email-like text is not a formula');
});

test('Download all formulas: one CSV of every page, and Upload CSV reads every page back',()=>{
 const one=exportInventoryCsv(page('till') as never,new Map(),'Custom',{formulasOnly:true});
 const two=exportInventoryCsv(page('payment') as never,new Map(),'Custom',{formulasOnly:true});
 const lines=(csv:string)=>csv.trim().split(/\r?\n/);
 assert.ok(lines(one).slice(1).every(line=>/=CLOSESCREEN|@CartLine/.test(line)),lines(one).join('\n'));
 assert.ok(!one.includes('radius')&&!one.includes(',Pay,'));
 assert.equal(lines(one).length,3);
 // The client keeps the header from the first page only.
 const all=[lines(one).join('\r\n'),lines(two).slice(1).join('\r\n')].join('\r\n')+'\r\n';
 const {groups,issues}=inventoryCsvPageGroups(all);
 assert.deepEqual(issues,[]);
 assert.deepEqual(groups.map(group=>[group.pageapi,group.variant]),[['till','Custom'],['payment','Custom']]);
 // Full export still has every row.
 assert.ok(exportInventoryCsv(page('till') as never,new Map(),'Custom').includes('radius'));
});

test('Smart Dock: one CSV row per item with its own On Click formula; blank = no action',async()=>{
 const {applyInventoryCsv}=await import('../../server/src/system-support/page-inventory-csv');
 const dock={apiName:'till',layoutMode:'free-canvas',components:[
  {id:'d1',type:'Custom:smart_dock',label:'smart_dock',visible:true,position:{x:0,y:0,width:300,height:60},
   properties:{navigatorName:'TestDock',dockItemCount:3,actionFlows:{
    start:{actionType:'Formula',formula:'=1'},
    dockItem1:{actionType:'Flow',flowApiName:'metadata:f1'},
    dockItem2:{actionType:'Navigate',navigationTargetType:'App Page',navigationAppId:'SMARTTILL',navigationPageApiName:'kitchen'}}}}]};
 const csv=exportInventoryCsv(dock as never,new Map(),'Desktop',{flowNames:new Map([['f1','OpenTill']])});
 assert.match(csv,/TestDock,dockItem1\.onClick,=FLOW\(OpenTill\)/);
 assert.match(csv,/TestDock,dockItem2\.onClick,"@navigate\.page := ""SMARTTILL\/kitchen"""/);
 assert.match(csv,/TestDock,dockItem3\.onClick,,/);
 assert.ok(!/dockItem1"?:/.test(csv.split('\n').find(line=>line.includes(',actionFlows,'))??''),'shared actions cell has no item actions');
 const upload=['pageapi,component_type,component_name,propertyid,value',
  'till,smart_dock,TestDock,dockItem1.onClick,=FLOW(OpenTill)',
  'till,smart_dock,TestDock,dockItem2.onClick,',
  'till,smart_dock,TestDock,dockItem3.onClick,"@navigate.home := ""SMARTTILL"""',
  'till,smart_dock,TestDock,actionFlows,"{""start"":{""actionType"":""Formula"",""formula"":""=2""}}"'].join('\r\n')+'\r\n';
 const result=applyInventoryCsv(dock as never,upload);
 assert.deepEqual(result.issues,[]);
 const actions=result.page.components[0].properties.actionFlows as Record<string,{actionType:string;formula?:string}>;
 assert.deepEqual(actions.dockItem1,{actionType:'Formula',formula:'=FLOW(OpenTill)'});
 assert.equal(actions.dockItem2,undefined,'blank row: the button does nothing');
 assert.deepEqual(actions.dockItem3,{actionType:'Formula',formula:'@navigate.home := "SMARTTILL"'});
 assert.equal(actions.start.formula,'=2');
});

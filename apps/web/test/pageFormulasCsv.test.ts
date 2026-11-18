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

import test from 'node:test';
import assert from 'node:assert/strict';
import {pageKeyList,shownPages,activePage} from '../src/component-libraries/smart_multipage/multiPageModel.js';

const pages=['Cash','Card','PayPal','GiftCard'].map(key=>({key,label:key}));
test('visible tabs keep formula order and ignore blanks/duplicates',()=>{
 assert.deepEqual(pageKeyList(' paypal, Cash ,,cash'),['paypal','Cash']);
 assert.deepEqual(shownPages(pages,'PayPal,Cash').map(p=>p.key),['PayPal','Cash']);
 assert.equal(shownPages(pages,'').length,4);
 assert.equal(shownPages(pages,'Cash',true).length,4);
 assert.deepEqual(shownPages(pages,'Klarna'),[]);
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

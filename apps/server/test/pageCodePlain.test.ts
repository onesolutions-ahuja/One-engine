import test from 'node:test';
import assert from 'node:assert/strict';
import {withFieldTypes,compileActionFormula,compileDisplayFormula} from '../src/page-compiler/code/generateCode.js';
import {assertCodeParses} from '../src/page-compiler/code/pageCode.js';
import {auditPageCode} from '../src/page-compiler/source/pageCodeAudit.js';

/** Field types of the till's Objects (as Object Manager keeps them). */
const objects=[
 {apiName:'Cart',fields:[{apiName:'Status',dataType:'picklist'},{apiName:'SessionKey',dataType:'string'},{apiName:'Subtotal',dataType:'currency'},
  {apiName:'Total',dataType:'currency'},{apiName:'Tax',dataType:'currency'},{apiName:'discount__c',dataType:'currency'},{apiName:'DiscountPercent',dataType:'percent'},
  {apiName:'payment_method__c',dataType:'picklist'},{apiName:'age_verified__c',dataType:'boolean'},{apiName:'Customer',dataType:'reference'},{apiName:'Note',dataType:'string'}]},
 {apiName:'CartLine',fields:[{apiName:'Cart',dataType:'reference'},{apiName:'Status',dataType:'picklist'},{apiName:'Name',dataType:'string'},{apiName:'LineTotal',dataType:'currency'},
  {apiName:'Quantity',dataType:'number'},{apiName:'VatRate',dataType:'number'},{apiName:'DiscountAmount',dataType:'currency'},{apiName:'OriginalUnitPrice',dataType:'currency'},{apiName:'UnitPrice',dataType:'currency'},{apiName:'session_key__c',dataType:'string'}]},
 {apiName:'Customer',fields:[{apiName:'Name',dataType:'string'},{apiName:'CreditLimit',dataType:'currency'},{apiName:'AccountBalance',dataType:'currency'}]},
 {apiName:'cash_count__c',fields:[{apiName:'count_type__c',dataType:'picklist'},{apiName:'till__c',dataType:'string'}]},
 {apiName:'Product',fields:[{apiName:'AgeRestricted',dataType:'boolean'},{apiName:'TrackStock',dataType:'boolean'},{apiName:'StockLevel',dataType:'number'},{apiName:'Price',dataType:'currency'},{apiName:'Name',dataType:'string'}]}];
const pay='=IF(AND(NOT(ISBLANK(@ThisPage.Till.Name)), COUNTIFS(cash_count__c, count_type__c, "Opening", Name, "Open", till__c, @ThisPage.Till.Name) = 0), SCREEN(smart_till_confirm, popup, 1), ACTIONS(GETRECORD(Cart, Status, "Open", SessionKey, @ThisPage.Session.Id, AS(sc)), IF(OR(ISBLANK(sc.Id), COUNTIFS(CartLine, Cart, sc.Id, Status, "Open") = 0), "", ACTIONS(IF(COUNTIFS(CartLine, Cart, sc.Id, Status, "Open", Name, "Card surcharge") = 0, "", ACTIONS(FOREACH(CartLine, Cart, sc.Id, Status, "Open", Name, "Card surcharge", AS(x), DELETERECORD(CartLine, x.Id)), GETRECORD(Cart, Id, sc.Id, AS(c)), UPDATERECORD(Cart, c.Id, Subtotal, SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open"), discount__c, IF(BLANKVALUE(c.DiscountPercent, 0) > 0, ROUND(SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open") * c.DiscountPercent / 100, 2), MIN(BLANKVALUE(c.discount__c, 0), SUMIFS(CartLine, LineTotal, Cart, c.Id, Status, "Open")))), GETRECORD(Cart, Id, sc.Id, AS(t)), UPDATERECORD(Cart, t.Id, Total, MAX(0, t.Subtotal - BLANKVALUE(t.discount__c, 0)), Tax, ROUND(MAX(0, t.Subtotal - BLANKVALUE(t.discount__c, 0)) / 6, 2)))), UPDATERECORD(Cart, sc.Id, payment_method__c, "Split"), IF(OR(COUNTIFS(CartLine, Cart, sc.Id, Status, "Open", Product.AgeRestricted, TRUE) = 0, sc.age_verified__c), SCREEN(smart_till_payment, popup, sc.Id), SCREEN(smart_till_age_check, popup, sc.Id))))))';
const start='=ACTIONS(@ThisPage.row.Value = 1, GETRECORD(Cart, Status, "Open", SessionKey, @ThisPage.Session.Id, AS(sc)), IF(ISBLANK(sc.Customer), ACTIONS(@ThisPage.CuName.Value = "", @ThisPage.CuLimit.Value = 0), ACTIONS(GETRECORD(Customer, Id, sc.Customer, AS(cu)), @ThisPage.CuName.Value = BLANKVALUE(cu.Name, "Customer"), @ThisPage.CuLimit.Value = BLANKVALUE(cu.CreditLimit, 0))), IF(ISBLANK(sc.Id), "", UPDATERECORD(Cart, sc.Id, Tax, ROUND((SUMIFS(CartLine, LineTotal, Cart, sc.Id, Status, "Open", VatRate, 20) / 6 + SUMIFS(CartLine, LineTotal, Cart, sc.Id, Status, "Open", VatRate, 5) / 21) * IF(sc.Subtotal > 0, sc.Total / sc.Subtotal, 1), 2))), FOREACH(Cart, DeviceKey, @ThisPage.Device.Key, Status, "Paid", AS(old), UPDATERECORD(Cart, old.Id, Status, "Closed")))';

const HELPER=/\bO\.(?:b|t|s|u|out|blank)\(|\$\.f\(|(^|[^A-Za-z0-9_$.])v\[/;

test('the till\'s Pay and payment-popup actions are plain JavaScript (no formula helpers)',()=>withFieldTypes(objects as never,()=>{
 for(const source of [pay,start]){
  const js=assertCodeParses(compileActionFormula(source,'').js);
  assert.doesNotMatch(js,HELPER,js);
 }
 const js=compileActionFormula(pay,'').js;
 assert.match(js,/let sc, c, t;/);
 assert.match(js,/sc = await \$\.getRecord\("Cart", \{Status: "Open", SessionKey: \$\.sessionId\}\);/);
 assert.match(js,/Total: Math\.max\(0, \(\(t\?\.Subtotal \?\? 0\) - \(t\?\.discount__c \?\? 0\)\)\)/);
 assert.match(js,/\(sc\?\.age_verified__c === true\)/);
 assert.match(js,/await \$\.count\("CartLine", \{Cart: \(sc\?\.Id \?\? ""\), Status: "Open"\}\)/);
}));

test('display formulas are plain JavaScript; a blank number counts as 0 in maths and shows blank',()=>withFieldTypes(objects as never,()=>{
 const badge=compileDisplayFormula('=IF(@Product.AgeRestricted, "18+", IF(AND(@Product.TrackStock, @Product.StockLevel <= 0), "Out", ""))','Product').js;
 assert.equal(badge,'(row, $) => ((row?.AgeRestricted === true) ? "18+" : (((row?.TrackStock === true) && ((row?.StockLevel ?? 0) <= 0)) ? "Out" : ""))');
 const qty=compileDisplayFormula('@CartLine.Quantity','CartLine').js;
 assert.equal(qty,'(row, $) => (row?.Quantity ?? "")');
 const run=(js:string,row:Record<string,unknown>)=>(new Function('F','O','return '+js)({},{}) as (row:unknown,$:unknown)=>unknown)(row,{});
 assert.equal(run(badge,{AgeRestricted:false,TrackStock:true,StockLevel:null}),'Out');
 assert.equal(run(badge,{AgeRestricted:true}),'18+');
 assert.equal(run(qty,{}),'');
}));

test('the rebuild check lists what is not plain code, and nothing for a converted page',()=>{
 const clean={'p.formulas.ts':'export const formulas = {};','p.actions.ts':'export const actions = {\n  Pay: {\n    click: {\n      run: async ($) => {}\n    },\n  },\n};',
  'p.data.ts':'','p.tsx':'<Button className="Pay" text="=TABLE(@Order)" />','manifest.json':'{"names":{"ui":{},"components":{}}}'};
 assert.deepEqual(auditPageCode(clean,'p'),[]);
 const old={...clean,'p.formulas.ts':'run: (row, $) => O.out($.f(row, "Name"))',
  'p.actions.ts':'export const actions = {\n  Dock: {\n    item1: {\n      issue: "Not converted"\n    },\n  },\n};','p.tsx':'<Text className="T" text="=UNKNOWN()" />'};
 assert.deepEqual(auditPageCode(old,'p'),['1 × number check helper O.out()','1 × field read helper $.f()','Action not converted: Dock.item1','Formula not converted: text']);
});

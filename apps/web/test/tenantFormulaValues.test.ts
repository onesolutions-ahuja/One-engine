import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePageReference} from '../../server/src/expression-engine/PageReferences.ts';
import {compileDisplayFormula} from '../../server/src/page-compiler/code/generateCode.ts';
import {permissionNames} from '../../server/src/system-support/tenant-formula-values.ts';
import {receiptSettingError} from '../../server/src/system-support/company-receipt-settings.ts';
import {runFormulaText} from '../src/core/pages/PageCompiler/formulaText';
import {setTenantBrand} from '../src/component-libraries/shared/TenantBrand.js';
import {setAuthenticatedFormulaBindingContext} from '../src/core/components/RegisteredComponent/fieldExpressionRuntime';

test('@ThisTenant.User / Company / Permission parse to the right kinds',()=>{
 assert.deepEqual(parsePageReference('@ThisTenant.User.Name'),{kind:'user',field:'Name'});
 assert.deepEqual(parsePageReference('@ThisTenant.User.RefundLimit'),{kind:'userField',field:'RefundLimit'});
 assert.deepEqual(parsePageReference('@ThisTenant.Company.vatnumber'),{kind:'company',field:'VatNumber'});
 assert.deepEqual(parsePageReference('@ThisTenant.Company.SomethingNew'),{kind:'company',field:'SomethingNew'});
 assert.deepEqual(parsePageReference('@ThisTenant.Permission.Till.Refund'),{kind:'permission',name:'Till.Refund'});
 assert.throws(()=>parsePageReference('@ThisTenant.Other.X'),/Unknown tenant value/);
});

test('page code reads them through the session, tenant and permission calls',()=>{
 const code=compileDisplayFormula('=IF(@ThisTenant.Permission.Till.Refund, @ThisTenant.User.RefundLimit, @ThisTenant.Company.Currency)').js;
 assert.match(code,/\$\.permission\("Till\.Refund"\)/);
 assert.match(code,/\$\.session\("user\.field\.RefundLimit"\)/);
 assert.match(code,/\$\.tenant\("currency"\)/);
 assert.deepEqual(permissionNames(code),['Till.Refund']);
});

test('browser formulas show company values, user limits and permissions',()=>{
 setTenantBrand({name:'Corner Shop',logo:'',company:{vatnumber:'GB123',currency:'GBP',receiptautoprint:true,cashroundingstep:0.05}});
 setAuthenticatedFormulaBindingContext({id:'u1',displayName:'Sam',email:'s@x.io',timeZone:'Europe/London',locale:'en-GB',
  tenantId:'t1',tenantName:'Corner Shop',customFields:{RefundLimit:50},
  customPermissions:{names:{'Till.Refund':true,'Till.CashOut':false},others:false}});
 assert.equal(runFormulaText('=@ThisTenant.Company.VatNumber',{}).value,'GB123');
 assert.equal(runFormulaText('=@ThisTenant.Company.Currency',{}).value,'GBP');
 assert.equal(runFormulaText('=IF(@ThisTenant.Company.ReceiptAutoPrint, "print", "no")',{}).value,'print');
 assert.equal(runFormulaText('=@ThisTenant.Company.CashRoundingStep * 2',{}).value,0.1);
 assert.equal(runFormulaText('=@ThisTenant.Company.NotSet',{}).value,'');
 assert.equal(runFormulaText('=@ThisTenant.User.RefundLimit + 1',{}).value,51);
 assert.equal(runFormulaText('=@ThisTenant.Permission.Till.Refund',{}).value,true);
 assert.equal(runFormulaText('=@ThisTenant.Permission.Till.CashOut',{}).value,false);
 assert.equal(runFormulaText('=@ThisTenant.Permission.Till.Unknown',{}).value,false);
 setAuthenticatedFormulaBindingContext(null);
});

test('Receipts settings are typed',()=>{
 assert.equal(receiptSettingError('receiptAutoPrint',true),null);
 assert.match(String(receiptSettingError('receiptAutoPrint','yes')),/Yes or No/);
 assert.equal(receiptSettingError('cashRoundingStep',0.05),null);
 assert.match(String(receiptSettingError('cardSurchargePercent',150)),/number/);
 assert.match(String(receiptSettingError('nope','x')),/Unknown/);
});

test('server actions check limits and permissions from SQL, not the browser',async()=>{
 const {buildPageCode,serverPageCode}=await import('../../server/src/page-compiler/code/pageCode');
 const {executePageCodeAction}=await import('../../server/src/system-support/page-code-runtime');
 const cartId='22222222-2222-4222-8222-222222222222';
 const code=buildPageCode({apiName:'refund',components:[{id:'btn',objectApiName:'Cart',formulas:[],
  actions:[{event:'click',kind:'Formula',formula:'=IF(AND(@ThisTenant.Permission.Till.Refund, 30 <= @ThisTenant.User.RefundLimit), '+
   'UPDATERECORD(Cart, "'+cartId+'", Status, @ThisTenant.Company.Currency), INFOSCREEN("Over your refund limit"))'}]}]} as never);
 assert.deepEqual(code.issues,[]);
 const source=code.actions.find(action=>action.key==='btn:click')!.js;
 const cart:Record<string,unknown>={Id:cartId,Status:'Open'};
 const records={async get(){return {...cart};},async list(){return {records:[],total:0};},
  async update(_t:string,_u:string,_o:string,_id:string,values:Record<string,unknown>){Object.assign(cart,values);},
  async create(){return 'x';},async remove(){}};
 let limit=50,allowed=true;
 const db={transaction:async<T>(run:()=>Promise<T>)=>run(),query:async(sql:string)=>{
  if(/FROM md_users u LEFT JOIN/.test(sql))return {rows:[{email:'s@x.io',display_name:'Sam',time_zone:'UTC',locale:'en-GB',currency_iso_code:null,manager_id:null,manager_name:null}]};
  if(/custom_fields->f.api_name/.test(sql))return {rows:[{api_name:'RefundLimit',value:limit}]};
  if(/md_tenant_settings/.test(sql))return {rows:[{setting_key:'currencies',properties:{corporateCurrency:'GBP',standardVatRate:20}}]};
  if(/FROM md_tenants/.test(sql))return {rows:[{name:'Shop'}]};
  return {rows:[]};
 }};
 const rbac={allowedMany:async(_t:string,_u:string,checks:Array<{resource:string}>)=>
  checks.map(check=>check.resource==='CustomPermission:Till.Refund'&&allowed)};
 const run=()=>executePageCodeAction({db,records,rbac} as never,{tenant_id:'t',user_id:'u'},serverPageCode(code),'btn:click',
  {sessionId:'s',state:{},rowObject:'Cart',event:{}},source);
 const ok=await run();
 assert.equal(ok.ok,true,ok.error);
 assert.equal(cart.Status,'GBP');
 cart.Status='Open';limit=20;
 const over=await run();
 assert.deepEqual(over.effects.map(effect=>effect.args[0]),['Over your refund limit']);
 assert.equal(cart.Status,'Open');
 limit=50;allowed=false;
 await run();
 assert.equal(cart.Status,'Open');
});

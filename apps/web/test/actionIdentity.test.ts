import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPageCode} from '../../server/src/page-compiler/code/pageCode';
import {needsIdentity} from '../../server/src/system-support/page-code-runtime';

const actionJs=(formula:string)=>buildPageCode({apiName:'pay',components:[{id:'b1',objectApiName:'',formulas:[],
 actions:[{event:'click',kind:'Formula',formula}]}]} as never).actions[0].js;

test('an action that reads the user or company loads the signed-in identity (generated code, not @mentions)',()=>{
 for(const formula of ['=CREATERECORD(Invoice, StaffName, @ThisTenant.User.Name)',
  '=@ThisPage.x.Value = @ThisTenant.User.Id','=@ThisPage.x.Value = @ThisTenant.Company.Name',
  '=IF(ISBLANK(@ThisTenant.User.Manager), @ThisPage.e.Value = "none", "")']){
  const js=actionJs(formula);
  assert.ok(!/@ThisTenant/.test(js),'generated code has no @mentions');
  assert.equal(needsIdentity(js),true,formula);
 }
 assert.equal(needsIdentity(actionJs('=@ThisPage.x.Value = 1')),false);
 assert.equal(needsIdentity(actionJs('=@ThisPage.x.Value = @ThisPage.Session.Id')),false);
});

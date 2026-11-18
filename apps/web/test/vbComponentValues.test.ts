import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPageCode,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {executePageCodeAction} from '../../server/src/system-support/page-code-runtime';
import {parsePageReference,COMPONENT_VALUES} from '../../server/src/expression-engine/PageReferences';

const page=(formula:string)=>buildPageCode({apiName:'cash',components:[{id:'key1',objectApiName:'',formulas:[],
 actions:[{event:'click',kind:'Formula',formula}]}]} as never);
const run=(code:ReturnType<typeof page>,state:Record<string,unknown>={})=>executePageCodeAction(
 {db:{transaction:async<T>(go:()=>Promise<T>)=>go(),query:async()=>({rows:[]})},records:{}} as never,
 {tenant_id:'t',user_id:'u'},serverPageCode(code),'key1:click',{sessionId:'s',state,rowObject:'',event:{}},'');

test('@ThisPage.CashBox.Value reads what the component holds',()=>{
 assert.deepEqual(parsePageReference('@ThisPage.CashBox.Value'),{kind:'selected',name:'CashBox',field:'Value'});
 assert.deepEqual(parsePageReference('@ThisPage.CashBox.text'),{kind:'selected',name:'CashBox',field:'Text'});
 assert.deepEqual(parsePageReference('@ThisPage.Input.err'),{kind:'input',key:'err'});
});

test('VB style: CashBox.Value = CashBox.Value & "1", no STATE',async()=>{
 const code=page('=@ThisPage.CashBox.Value = @ThisPage.CashBox.Value & "1"');
 assert.deepEqual(code.issues,[]);
 assert.match(code.actions[0].js,/\$\.setValue\("CashBox", /);
 const result=await run(code,{collectionSelections:{CashBox:{Id:'7',Name:'7',Value:'7',Text:'7',Field:'',Criteria:''}}});
 assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.state[COMPONENT_VALUES],{CashBox:'71'});
});

test('Assignments inside ACTIONS and IF; a later step reads the new value',async()=>{
 const code=page('=ACTIONS(CashBox.Value = "", IF(@ThisPage.CashBox.Value = "", @ThisPage.ErrorText.Text = "Enter an amount", ""))');
 assert.deepEqual(code.issues,[]);
 const result=await run(code);
 assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.state[COMPONENT_VALUES],{CashBox:'',ErrorText:'Enter an amount'});
});

test('An IF test stays a comparison',async()=>{
 const code=page('=IF(@ThisPage.CashBox.Value = "5", @ThisPage.Note.Value = "five", @ThisPage.Note.Value = "other")');
 assert.deepEqual(code.issues,[]);
 const five=await run(code,{collectionSelections:{CashBox:{Id:'5',Name:'5',Value:'5',Text:'5',Field:'',Criteria:''}}});
 assert.deepEqual(five.state[COMPONENT_VALUES],{Note:'five'});
});

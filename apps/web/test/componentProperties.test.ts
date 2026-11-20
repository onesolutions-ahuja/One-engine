import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPageCode,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {executePageCodeAction} from '../../server/src/system-support/page-code-runtime';
import {COMPONENT_PROPERTIES,readComponentProperty,withComponentProperties} from '../../server/src/expression-engine/FormulaComponentState';
import {createCompiledPageStore} from '../src/core/pages/PageCompiler/compiledPageStore';

const page=(formula:string)=>buildPageCode({apiName:'pay',components:[{id:'b2',objectApiName:'',formulas:[],
 actions:[{event:'click',kind:'Formula',formula}]}]} as never);
const run=(code:ReturnType<typeof page>,state:Record<string,unknown>={})=>executePageCodeAction(
 {db:{transaction:async<T>(go:()=>Promise<T>)=>go(),query:async()=>({rows:[]})},records:{}} as never,
 {tenant_id:'t',user_id:'u'},serverPageCode(code),'b2:click',{sessionId:'s',state,rowObject:'',event:{}},'');

test('Button2.click: IF(Button1.Disabled, …) reads what the page worked out',async()=>{
 const code=page('=IF(@ThisPage.Button1.Disabled, @ThisPage.Note.Value = "off", @ThisPage.Note.Value = "on")');
 assert.deepEqual(code.issues,[]);
 assert.match(code.actions[0].js,/\$\.property\("Button1", "Disabled"\)/);
 const off=await run(code,{[COMPONENT_PROPERTIES]:{button1:{auto:{Disabled:true}}}});
 assert.equal(off.ok,true,off.error);
 assert.deepEqual(off.state.componentValues,{Note:'off'});
 const on=await run(code,{});
 assert.deepEqual(on.state.componentValues,{Note:'on'});
});

test('Caption / Disabled / Visible can be set; a later step reads the new value',async()=>{
 const code=page('=ACTIONS(@ThisPage.Button2.Caption = "Pay " & "£5.00", @ThisPage.Button1.Disabled = TRUE,'
  +' IF(@ThisPage.Button1.Disabled, @ThisPage.Box.Visible = FALSE, ""))');
 assert.deepEqual(code.issues,[]);
 const result=await run(code);
 assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.state[COMPONENT_PROPERTIES],{
  button2:{set:{Caption:'Pay £5.00'}},button1:{set:{Disabled:true}},box:{set:{Visible:false}}});
});

test('A value an action set wins over Disable when; defaults otherwise',()=>{
 const state={[COMPONENT_PROPERTIES]:{pay:{set:{Disabled:false},auto:{Disabled:true,Caption:'Pay'}}}};
 assert.equal(readComponentProperty(state,'Pay','Disabled'),false);
 assert.equal(readComponentProperty(state,'Pay','Caption'),'Pay');
 assert.equal(readComponentProperty({},'Other','Visible'),true);
 assert.equal(readComponentProperty({},'Other','Disabled'),false);
 assert.equal(withComponentProperties(state,'pay','auto',{Disabled:true}),state,'no change keeps the same state');
});

test('Setting a property redraws only that component and the formulas naming it',()=>{
 const compiled={stateReaders:{},components:[
  {id:'b1',mode:'compiled',searchText:'=@thispage.total.value'},
  {id:'b2',mode:'compiled',searchText:'=if(@thispage.button1.disabled,"a","b")'},
  {id:'b3',mode:'compiled',searchText:'"hello"'}]} as never;
 const store=createCompiledPageStore(compiled);
 const drawn:string[]=[];
 for(const id of ['b1','b2','b3'])store.subscribeComponent(id,()=>drawn.push(id));
 assert.equal(store.setProperties('button1','b1','set',{Disabled:true}),true);
 assert.deepEqual(drawn.sort(),['b1','b2']);
 drawn.length=0;
 assert.equal(store.setProperties('button1','b1','set',{Disabled:true}),false,'same value: nothing redraws');
 assert.deepEqual(drawn,[]);
});

import {F,O} from '../../server/src/page-compiler/code/formulaLibrary';
import {pageCodeModule} from '../../server/src/page-compiler/code/pageCode';
import {createPageCodeRuntime,type PageCode} from '../src/core/pages/PageCompiler/pageCodeRuntime';
import {componentStateFromEvent} from '../../server/src/expression-engine/FormulaComponentState';

test('Fast taps 1-2-3-3 give 1233 (each tap reads the previous one)',async()=>{
 const keys=['1','2','3'].map(digit=>({id:'k'+digit,objectApiName:'',formulas:[],
  actions:[{event:'click',kind:'Formula',formula:'=@ThisPage.q.Value = (@ThisPage.q.Value & "'+digit+'")'}]}));
 const module=pageCodeModule(buildPageCode({apiName:'pad',components:keys} as never));
 const code=(new Function('F','O',module.replace(/export /g,'')+'\nreturn createCode(F, O);') as (f:typeof F,o:typeof O)=>PageCode)(F,O);
 let state:Record<string,unknown>={};
 const rt=createPageCodeRuntime(code,{endpoint:'/apps/X',build:{buildId:'b'},sessionId:()=>'s',state:()=>state,
  request:(async()=>({ok:true,sets:{}})) as never});
 const io={show:(update:{state:Record<string,unknown>})=>{
  const given=update.state.componentValues as Record<string,unknown>|undefined;
  for(const [name,value] of Object.entries(given??{}))
   state={...state,collectionSelections:{...(state.collectionSelections as object),[name]:componentStateFromEvent(value)}};
 },effects:async()=>{}};
 await Promise.all(['1','2','3','3'].map(digit=>rt.run('k'+digit+':click',{},'',io as never)));
 assert.equal((state.collectionSelections as Record<string,{Value:unknown}>).q.Value,'1233');
});

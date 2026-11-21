import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOps,diffComponents,updateEditors,PRESENCE_MS} from '../src/core/builders/PageBuilder/editor/management/pageCoEditing.ts';
import {LiveChangeHub,readPageEdit} from '../../server/src/system-support/live-changes.ts';
import {LiveFrameParser} from '../src/core/pages/PageCompiler/liveChanges.ts';

const c=(id:string,x=0)=>({id,type:'Custom:smart_text',label:id,position:{x,y:0,width:10,height:10},properties:{}}) as never;

test('only what changed is sent, and other designers\' edits merge by component',()=>{
 const start=diffComponents(new Map(),[c('a'),c('b')]).next;
 const {ops}=diffComponents(start,[c('a',50),c('c')]);
 assert.deepEqual(ops.upsert.map((item:{id:string})=>item.id),['a','c']);
 assert.deepEqual(ops.remove,['b']);
 // Here: a, b, mine. Theirs: a moved, b removed, c added. Mine stays.
 const merged=applyOps([c('a'),c('b'),c('mine')],ops);
 assert.deepEqual(merged.map((item:{id:string})=>item.id),['a','mine','c']);
 assert.equal((merged[0] as {position:{x:number}}).position.x,50);
});

test('presence keeps designers heard from recently, newest state per designer',()=>{
 const now=Date.now();
 let editors=updateEditors([],{clientId:'k1',name:'Ana',selection:['a'],seenAt:now},now);
 editors=updateEditors(editors,{clientId:'k1',name:'Ana',selection:['b'],seenAt:now},now);
 assert.deepEqual(editors.map(editor=>editor.selection),[['b']]);
 assert.equal(updateEditors(editors,null,now+PRESENCE_MS+1).length,0,'gone after 25 s of silence');
});

test('live edits go to designers who may read pages, checked on the way in',async()=>{
 assert.throws(()=>readPageEdit({page:'bad name',variant:'Custom',clientId:'abcdefgh-1'}),/page/);
 assert.throws(()=>readPageEdit({page:'p',variant:'Wide',clientId:'abcdefgh-1'}),/layout/);
 assert.throws(()=>readPageEdit({page:'p',variant:'Custom',clientId:'abcdefgh-1',ops:{upsert:[{}]}}),/Invalid page edit/);
 const edit=readPageEdit({page:'p',variant:'Custom',clientId:'abcdefgh-1',ops:{upsert:[{id:'a'}],remove:['b']},selection:['a',5]});
 assert.deepEqual(edit,{page:'p',variant:'Custom',clientId:'abcdefgh-1',ops:{upsert:[{id:'a'}],remove:['b']},selection:['a']});
 const hub=new LiveChangeHub({pool:{connect:()=>new Promise(()=>undefined)}} as never,
  {allowed:async(_t:string,user:string,resource:string)=>resource==='PageDefinition'&&user!=='cashier'} as never);
 const got:unknown[]=[];let cashier=0;
 hub.subscribe({tenant_id:'T',user_id:'designer2'},(event,data)=>got.push([event,data]));
 hub.subscribe({tenant_id:'T',user_id:'cashier'},()=>{cashier++;});
 assert.equal(await hub.pageEdit({tenant_id:'T',user_id:'designer1'},{...edit,name:'Ana'}),1);
 assert.equal(cashier,0);
 const events:unknown[]=[];
 new LiveFrameParser(event=>events.push(event)).append('event: page-edit\ndata: '+JSON.stringify((got[0] as [string,unknown])[1])+'\n\n');
 assert.deepEqual(events,[{kind:'page-edit',edit:{page:'p',variant:'Custom',clientId:'abcdefgh-1',name:'Ana',selection:['a'],
  ops:{upsert:[{id:'a'}],remove:['b']}}}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompiledDataLayer,type LocalCopyOptions} from '../src/core/pages/PageCompiler/compiledPageStore.ts';
import {fingerprint} from '../src/core/pages/PageCompiler/localCopy.ts';

const compiled={apiName:'till',components:[],dataSources:[{id:'Product#grid',objectApiName:'Product',components:[],
 scope:{kind:'none'},complete:false,filters:null,filterLogic:'AND',filterFormula:'',stateInputs:['category']}]} as never;

function memory(){
 const saved=new Map<string,unknown>();
 const local:LocalCopyOptions&{saved:typeof saved}={saved,owner:()=>'user-1',context:()=>['session-1'],fingerprint,
  read:async(owner,key)=>saved.get(owner+'|'+key) as never,write:(owner,key,value)=>{saved.set(owner+'|'+key,value);}};
 return local;
}

test('a page opens with the rows kept from last time, then takes the server answer',async()=>{
 const local=memory();
 const rows=[{Id:'p1',Name:'Pepsi'}];
 let answer:(value:unknown)=>void=()=>undefined;
 const first=createCompiledDataLayer(compiled,async()=>({records:rows,total:1,predictable:true,paged:true}),()=>({category:'Drinks'}),undefined,local);
 await first.start();
 assert.equal(local.saved.size,1,'the server answer is kept');
 // Next open: the server is slow; the kept rows show at once.
 const second=createCompiledDataLayer(compiled,()=>new Promise(resolve=>{answer=resolve as never;}),()=>({category:'Drinks'}),undefined,local);
 void second.start();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(second.get('Product#grid').records,rows);
 assert.equal(second.get('Product#grid').loading,false);
 answer({records:[...rows,{Id:'p2',Name:'Cola'}],total:2,predictable:true,paged:true});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(second.get('Product#grid').records.length,2,'then the server answer replaces them');
});

test('kept rows are never used for another user, session or filter value',async()=>{
 const local=memory();
 const first=createCompiledDataLayer(compiled,async()=>({records:[{Id:'p1'}],total:1,predictable:true,paged:true}),()=>({category:'Drinks'}),undefined,local);
 await first.start();
 for(const other of [{...local,owner:()=>'user-2'},{...local,context:()=>['session-2']}]){
  const layer=createCompiledDataLayer(compiled,()=>new Promise(()=>undefined),()=>({category:'Drinks'}),undefined,other);
  void layer.start();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(layer.get('Product#grid').loading,true);
 }
 const snacks=createCompiledDataLayer(compiled,()=>new Promise(()=>undefined),()=>({category:'Snacks'}),undefined,local);
 void snacks.start();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(snacks.get('Product#grid').loading,true,'another category: no kept rows');
 const signedOut=createCompiledDataLayer(compiled,()=>new Promise(()=>undefined),()=>({category:'Drinks'}),undefined,{...local,owner:()=>undefined});
 void signedOut.start();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(signedOut.get('Product#grid').loading,true,'nobody signed in: nothing read');
});

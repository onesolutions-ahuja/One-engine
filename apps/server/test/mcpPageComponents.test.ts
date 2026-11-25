import test from 'node:test';
import assert from 'node:assert/strict';
import {applyComponentChanges,summarizeComponents,pageVariants,primaryVariant,updatePageComponents,type PageComponent} from '../src/system-support/mcp-page-components.js';

const page=():PageComponent[]=>[
 {id:'c1',type:'Custom:smart_container',label:'Panel',properties:{navigatorName:'Panel',radius:12}},
 {id:'c2',type:'Custom:smart_lookup',label:'smart_lookup',parentId:'c1',position:{x:1,y:2,width:3,height:4},
  properties:{navigatorName:'SaleSearch',textSource:'@Invoice.Name',layoutParentId:'c1'}},
 {id:'c3',type:'Custom:smart_label',label:'smart_label',properties:{navigatorName:'Footer',label:'=1'}}
];

test('sets, unsets and nests properties by navigator name or id without touching others', ()=>{
 const before=page();
 const {components,matched,unmatched}=applyComponentChanges(before,[
  {component:'SaleSearch',set:{textSource:'@Invoice.DocumentNumber','actionFlows.select.formula':'=1'},position:{width:10}},
  {component:'c3',unset:['label'],visible:false},
  {component:'Missing',set:{a:1}}
 ]);
 assert.deepEqual(matched,['SaleSearch','c3']);
 assert.deepEqual(unmatched,['Missing']);
 const search=components.find(c=>c.id==='c2')!;
 assert.equal(search.properties!.textSource,'@Invoice.DocumentNumber');
 assert.deepEqual(search.properties!.actionFlows,{select:{formula:'=1'}});
 assert.deepEqual(search.position,{x:1,y:2,width:10,height:4});
 const footer=components.find(c=>c.id==='c3')!;
 assert.equal('label' in footer.properties!,false);
 assert.equal(footer.visible,false);
 assert.equal(before[1].properties!.textSource,'@Invoice.Name','input is not mutated');
});

test('removing a container removes its children; ambiguous names and unsafe paths are refused', ()=>{
 assert.deepEqual(applyComponentChanges(page(),[{component:'Panel',remove:true}]).components.map(c=>c.id),['c3']);
 const twins=[...page(),{id:'c4',type:'x',properties:{navigatorName:'Footer'}}];
 assert.throws(()=>applyComponentChanges(twins,[{component:'Footer',set:{a:1}}]),/names 2 components/);
 assert.throws(()=>applyComponentChanges(page(),[{component:'c1',set:{'__proto__.x':1}}]),/Invalid property path/);
 assert.throws(()=>applyComponentChanges(page(),[],[{id:'c1',type:'x'}]),/already exists/);
});

test('summary lists names by default and full properties on request', ()=>{
 assert.deepEqual(summarizeComponents(page()).map(c=>c.name),['Panel','SaleSearch','Footer']);
 const detail=summarizeComponents(page(),{components:['SaleSearch'],properties:['textSource']});
 assert.equal(detail.length,1);
 assert.deepEqual((detail[0] as {properties:object}).properties,{textSource:'@Invoice.Name'});
 assert.deepEqual(summarizeComponents(page(),{search:'=1'}).map(c=>c.id),['c3']);
});

test('variants: Desktop first, then the page devices; Phone maps to Mobile', ()=>{
 assert.deepEqual(pageVariants(['Custom']),['Desktop','Custom']);
 assert.deepEqual(pageVariants(['Desktop','Phone']),['Desktop','Mobile']);
 assert.equal(primaryVariant(['Custom','Desktop']),'Custom');
 assert.equal(primaryVariant(undefined),'Desktop');
});

test('update edits Desktop, re-bases an inheriting device layout and publishes both', async()=>{
 const calls:string[]=[];
 const drafts:Record<string,{components:PageComponent[];draftRevision:number;inheritsDesktop?:boolean}>={
  Desktop:{components:page(),draftRevision:1},
  Custom:{components:page(),draftRevision:3,inheritsDesktop:true}
 };
 const pages={
  editor:async(_t:string,_p:string,v:string)=>({devices:['Custom'],...structuredClone(drafts[v])}),
  metadata:async()=>({devices:['Custom']}),
  saveLayoutDraft:async(_t:string,_p:string,v:string,payload:unknown)=>{
   calls.push('save '+v);
   const p=payload as {components:PageComponent[]};
   drafts[v]={...drafts[v],components:p.components,draftRevision:drafts[v].draftRevision+1};
   return {draftRevision:drafts[v].draftRevision,publishedRevision:0};
  },
  publishLayout:async(_t:string,_p:string,v:string,expected?:number)=>{calls.push(`publish ${v} ${expected}`);return {publishedRevision:expected};}
 };
 const result=await updatePageComponents(pages,'t','u',{page:'p',publish:true,
  changes:[{component:'SaleSearch',set:{textSource:'@Invoice.DocumentNumber'}}]});
 assert.deepEqual(calls,['save Desktop','save Custom','publish Desktop 2','publish Custom 4']);
 assert.equal(drafts.Desktop.components[1].properties!.textSource,'@Invoice.DocumentNumber');
 assert.deepEqual(result.unmatched,[]);
 await assert.rejects(updatePageComponents(pages,'t','u',{page:'p',publish:false,changes:[{component:'Nope',set:{a:1}}]}),/No component found/);
});

test('a standalone device layout is edited directly; Desktop without the component is left alone', async()=>{
 const saved:string[]=[];
 const pages={
  editor:async(_t:string,_p:string,v:string)=>({devices:['Custom'],draftRevision:5,components:v==='Desktop'?[]:page(),inheritsDesktop:false}),
  metadata:async()=>({devices:['Custom']}),
  saveLayoutDraft:async(_t:string,_p:string,v:string)=>{saved.push(v);return {draftRevision:6};},
  publishLayout:async()=>({publishedRevision:6})
 };
 const result=await updatePageComponents(pages,'t','u',{page:'p',publish:false,changes:[{component:'Footer',set:{label:'=2'}}]});
 assert.deepEqual(saved,['Custom']);
 assert.equal(result.variants.find(v=>v.variant==='Desktop')!.saved,false);
});

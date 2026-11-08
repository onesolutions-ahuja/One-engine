import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  PageFormulaScope,usePageFormulaScope,useComponentFormulaState,
  useFormulaDependencyVersion,PublishedFormulaProperties,publishComponentInput
} from '../src/core/components/RegisteredComponent/PageFormulaScope';
import {loadFlowScreenRecordPage,apiRequest} from '../src/core/authentication/Client/authClient';
import {runSerializedPageAction,planReadWriteObjects} from '../src/core/pages/PageRuntime/pageActionCoordinator';
import {executePageFormulaAction} from '../src/core/pages/PageRuntime/formulaAction';
import {shouldInvalidatePageComponent,type PageMutationDetail} from '../src/core/pages/PageRuntime/pageMutationScope';
import {useSharedRendererStyle} from '../src/core/components/RegisteredComponent/sharedRendererStyle';
import type {LibraryComponentMetadata} from '../src/core/metadata/Definitions/metadata';

const counterId='11111111-1111-4111-8111-111111111111';
const textItems=Array.from({length:50},(_,i)=>({
  id:'text-'+i,type:'Custom:smart_text',
  properties:{navigatorName:'Text'+i,
    ...(i===0?{value:1}:{}),
    textSource:i===0?'=$component.Text0.value':
      '=$component.Text'+(i-1)+'.text + 1'}
}));
const cartItems=Array.from({length:3},(_,i)=>({
  id:'cart-'+i,type:'Custom:smart_cart',
  properties:{navigatorName:'Cart'+i,label:i===0?'=UPPER("hello")':'Cart '+i}
}));
const gridItems=Array.from({length:3},(_,i)=>({
  id:'grid-'+i,type:'Custom:smart_card_grid',
  properties:{navigatorName:'Grid'+i,label:'Grid '+i}
}));
const components=[...textItems,...cartItems,...gridItems];
const catalog=[
  {apiName:'smart_text',propertyDefinitions:[
    {propertyKey:'textSource',kind:'TEXT'},{propertyKey:'value',kind:'NUMBER'}]},
  {apiName:'smart_cart',propertyDefinitions:[
    {propertyKey:'subtotalValue',kind:'TEXT'},{propertyKey:'totalValue',kind:'TEXT'}]},
  {apiName:'smart_card_grid',propertyDefinitions:[{propertyKey:'label',kind:'TEXT'}]}
] as unknown as LibraryComponentMetadata[];
const counts:Record<string,number>={};
function CartDataSubscriber({name}:{name:string}){
 const [total,setTotal]=useState<number|null>(null);
 useEffect(()=>{
  let active=true;
  const sync=(event:Event)=>{
   const detail=(event as CustomEvent<PageMutationDetail>).detail;
   if(!shouldInvalidatePageComponent(detail,'fixture-page','fixture-session',['CartLine']))return;
   void loadFlowScreenRecordPage('CartLine',{limit:100})
    .then(page=>{if(active)setTotal(page.total);});
  };
  window.addEventListener('metadrive:page-flow-mutated',sync);
  return ()=>{active=false;window.removeEventListener('metadrive:page-flow-mutated',sync);};
 },[]);
 return <span data-cart-total={name}>{total===null?'—':total}</span>;
}
function Instance({item}:{item:typeof components[number]}){
  const scope=usePageFormulaScope();
  useComponentFormulaState({},item.properties);
  // Each component kind has one trusted stylesheet regardless of instances.
  useSharedRendererStyle('.fixture-'+item.type.slice(7)+'{box-sizing:border-box}');
  const name=String(item.properties.navigatorName);
  useFormulaDependencyVersion(scope,{reference:'$component.'+name+'.text'});
  useFormulaDependencyVersion(scope,{reference:'$component.'+name+'.label'});
  counts[name]=(counts[name]??0)+1;
  const text=scope?.entries.some(entry=>entry.token===name&&entry.keys.includes('text'))
    ?scope.read(name,'text'):'';
  const sqlCaption=name==='Cart0'?scope?.read(name,'label'):'';
  return <div data-component={name} data-renders={counts[name]}>
    <PublishedFormulaProperties id={item.id} values={item.properties} rendered={{}}/>
    <span data-display={name}>{String(text)}</span>
    {name==='Cart0'&&<span data-sql-caption={name}>{String(sqlCaption??'')}</span>}
    {item.type==='Custom:smart_cart'&&<CartDataSubscriber name={name}/>}
  </div>;
}
const formula='=ACTIONS(GETRECORD(Counter, Name, "current", AS(row)), '+
  'UPDATERECORD(Counter, row.Id, Count, row.Count + 1))';
async function readTest(){
  const first=loadFlowScreenRecordPage('CartLine',{limit:100});
  // A late subscriber should reuse the existing network request, not just the
  // exact same JavaScript microtask.
  await new Promise(resolve=>setTimeout(resolve,25));
  const second=loadFlowScreenRecordPage('CartLine',{limit:2});
  const third=loadFlowScreenRecordPage('CartLine',{limit:100});
  const before=await Promise.all([first,second,third]);
  await apiRequest('/records/CartLine',{
    method:'POST',body:JSON.stringify({Quantity:2})
  });
  const postWriteAt=performance.now();
  window.dispatchEvent(new CustomEvent('metadrive:page-flow-mutated',{
   detail:{pageSessionKey:'fixture-page',sessionId:'fixture-session',objectApiNames:['CartLine']}
  }));
  const after=await Promise.all([
    loadFlowScreenRecordPage('CartLine',{limit:100}),
    loadFlowScreenRecordPage('CartLine',{limit:2})
  ]);
  return {postWriteAt,before:before.map(p=>({total:p.total,rows:p.records.length})),
    after:after.map(p=>({total:p.total,rows:p.records.length}))};
}
async function tenActions(){
  const objects=[{apiName:'Counter',fields:[]}];
  const keys=planReadWriteObjects({actionType:'Formula',formula},'Counter',objects);
  const runs=Array.from({length:10},()=>runSerializedPageAction(
    'isolated-fixture',keys,()=>executePageFormulaAction(apiRequest,
      {actionType:'Formula',formula},{},{},objects,'Counter')));
  const results=await Promise.all(runs);
  return {writes:results.filter(result=>result.recordChanged).length,
    keys,results:results.map(result=>result.recordChanged)};
}
declare global {
  interface Window {
    __runtimeStress?:{
      ready:boolean;readTest:typeof readTest;tenActions:typeof tenActions;
      renderCount:(name:string)=>number;
      setInput:(value:number)=>void;
      unmount:()=>void;
    };
  }
}
function Fixture(){
  useEffect(()=>{
    window.__runtimeStress={
      ready:true,readTest,tenActions,
      renderCount:(name:string)=>counts[name]??0,
      setInput:(value:number)=>publishComponentInput('text-0',value),
      unmount:()=>root.unmount()
    };
    return()=>{delete window.__runtimeStress;};
  },[]);
  return <div>
    <h1>Isolated formula runtime stress fixture</h1>
    <button type="button" onClick={()=>publishComponentInput('text-0',10)}>
      Change root input
    </button>
    <div id="fixture-canvas">
      {components.map(item=><Instance key={item.id} item={item}/>)}
    </div>
    <p aria-label="Cart binding contract">Unbound Cart amounts: —</p>
    <span id="fixture-count">{components.length}</span>
    <span id="counter-id" hidden>{counterId}</span>
  </div>;
}
const root=createRoot(document.getElementById('root')!);
root.render(
  <PageFormulaScope components={components} catalog={catalog}>
    <Fixture/>
  </PageFormulaScope>
);

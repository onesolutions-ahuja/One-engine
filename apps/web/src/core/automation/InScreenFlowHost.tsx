import {useEffect,useRef} from 'react';
import {ApiRequestError,apiRequest} from '../authentication/Client/authClient';
import {consumePlatformEventStream} from './platformEventStream';
import {matchesPlatformEventTarget} from './platformEventTarget';
import {getAuthenticatedFormulaBindingContext} from '../components/RegisteredComponent/fieldExpressionRuntime';
import type {FlowDefinitionMetadata} from '../metadata/Definitions/metadata';
type Signal={pageSessionKey?:string;componentId?:string;event?:string;value?:unknown;recordId?:string};
type Props={flows:ReadonlyArray<Pick<FlowDefinitionMetadata,'apiName'|'flowType'|'status'|'startConfig'|'resources'>>;appApiName:string;pageApiName:string;
 pageRecordId?:string;onLaunchFlow:(apiName:string,inputs?:Record<string,unknown>)=>void};
const objectValue=(value:unknown):Record<string,unknown>=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** Existing Flow runtime evaluates every business rule; this host only routes UI events. */
export default function InScreenFlowHost({flows,appApiName,pageApiName,pageRecordId,onLaunchFlow}:Props){
 const firstLoad=useRef(new Set<string>()),recent=useRef(new Map<string,number>());
 const scope=appApiName+':'+pageApiName;
 useEffect(()=>{
  const active=flows.filter(flow=>flow.flowType==='In-Screen Flow'&&flow.status==='Active'
    &&(!flow.startConfig.targetAppApiName||flow.startConfig.targetAppApiName===appApiName)
    &&(!flow.startConfig.targetPageApiName||flow.startConfig.targetPageApiName===pageApiName));
  if(!active.length)return;
  const currentContexts=new Map<string,string>();
  let contextAlive=true;
  const loadContexts=async()=>{
   try{
    const {contexts}=await apiRequest<{contexts:Array<{apiName:string}>}>('/contexts/definitions');
    const next=new Map<string,string>();
    await Promise.all(contexts.map(async context=>{
     const result=await apiRequest<{record?:{Id?:string}|null}>(
      '/contexts/current/'+encodeURIComponent(context.apiName));
     if(result.record&&typeof result.record.Id==='string')next.set(context.apiName,result.record.Id);
    }));
    if(contextAlive){currentContexts.clear();next.forEach((value,key)=>currentContexts.set(key,value));}
   }catch{if(contextAlive)currentContexts.clear();}
  };
  void loadContexts();
  const reloadContexts=()=>{void loadContexts();};
  window.addEventListener('metadrive:page-flow-mutated',reloadContexts);
  const launch=(trigger:string,detail:Signal)=>{
   if(detail.pageSessionKey&&detail.pageSessionKey!==scope)return;
   for(const flow of active){
    const settings=flow.startConfig;
    if(String(settings.launchTrigger??'manual')!==trigger)continue;
    if(trigger==='component-event'&&settings.launchEventName&&settings.launchEventName!==detail.event)continue;
    if(trigger==='platform-event'&&settings.platformEventApiName!==detail.event)continue;
    const key=scope+':'+flow.apiName,now=Date.now();
    if(trigger==='page-load'&&firstLoad.current.has(key))continue;
    let sessionKey='';
    try{sessionKey=window.sessionStorage.getItem('metadrive-page-session:'+scope)??'';}catch{/* optional */}
    const onceKey='metadrive-in-screen-once:'+sessionKey+':'+key;
    let alreadyShown=false;
    try{alreadyShown=window.sessionStorage.getItem(onceKey)==='yes';}catch{/* optional */}
    if(settings.oncePerSession===true&&alreadyShown)continue;
    if(trigger==='platform-event'&&!matchesPlatformEventTarget(settings,objectValue(detail.value),{
      pageSessionKey:sessionKey,recordId:pageRecordId,
      contextRecordId:currentContexts.get(String(settings.matchContextApiName??'')),
      userId:getAuthenticatedFormulaBindingContext()?.user?.Id as string|undefined
    }))continue;
    if(now-(recent.current.get(key)??0)<Math.max(250,Math.min(3600,Number(settings.cooldownSeconds??0))*1000))continue;
    const payload=objectValue(detail.value),record=objectValue(payload.record);
    const candidate=detail.recordId??payload.recordId??record.Id??record.id;
    const values:Record<string,unknown>={appApiName,pageApiName,sessionKey,eventName:detail.event??trigger,
      componentId:detail.componentId??'',recordId:typeof candidate==='string'?candidate:''};
    const sourceValues:Record<string,unknown>={
      'page.sessionKey':sessionKey,'page.apiName':pageApiName,'app.apiName':appApiName,
      'event.recordId':values.recordId,'event.componentId':values.componentId,
      'event.name':values.eventName,'event.value':detail.value
    };
    for(const [apiName,id] of currentContexts)sourceValues['context.'+apiName+'.recordId']=id;
    const mapping=objectValue(settings.inputBindings);
    const inputs:Record<string,unknown>={};
    for(const resource of flow.resources??[]){
     if(!resource.availableForInput)continue;
     const source=mapping[resource.name];
     const value=typeof source==='string'&&source!=='auto'
       ?sourceValues[source]:values[resource.name];
     if(value===undefined||value==='')continue;
     if(typeof value==='object'&&JSON.stringify(value).length>8192)continue;
     inputs[resource.name]=value;
    }
    onLaunchFlow(flow.apiName,inputs);
    recent.current.set(key,now);
    if(trigger==='page-load')firstLoad.current.add(key);
    if(settings.oncePerSession===true){
     try{window.sessionStorage.setItem(onceKey,'yes');}catch{/* optional */}
    }
    break; // One shared Screen interview at a time; no competing modal engines.
   }
  };
  const component=(event:Event)=>{const d=(event as CustomEvent<Signal>).detail;if(d)launch('component-event',d);};
  const updated=(event:Event)=>{const d=(event as CustomEvent<Signal>).detail;if(d)launch('page-updated',d);};
  window.addEventListener('metadrive:in-screen-action',component);
  window.addEventListener('metadrive:page-component-interaction',component);
  window.addEventListener('metadrive:page-flow-mutated',updated);
  const feeds=[...new Set(active.filter(flow=>flow.startConfig.launchTrigger==='platform-event')
    .map(flow=>flow.startConfig.platformEventApiName).filter((name):name is string=>
      typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(name)))].slice(0,8);
  const controllers=feeds.map(()=>new AbortController());
  let live=true;
  const timers=new Set<number>();
  const follow=async(name:string,index:number)=>{
   const signal=controllers[index].signal;
   let cursor='-1',retries=0;
   while(live&&!signal.aborted){
    try{
     await consumePlatformEventStream(name,cursor,signal,message=>{
      if(!live||signal.aborted)return;
      // Update cursor before launching. Replayed events are never processed twice.
      if(cursor!=='-1'&&BigInt(message.replayId)<=BigInt(cursor))return;
      cursor=message.replayId;
      const payload=objectValue(message.payload);
      const recordId=typeof payload.recordId==='string'?payload.recordId:
       typeof payload.RecordId==='string'?payload.RecordId:'';
      launch('platform-event',{pageSessionKey:scope,event:name,value:payload,recordId});
     });
     retries=0;
    }catch(error){
     if(!live||signal.aborted)return;
     if(error instanceof ApiRequestError&&[401,403,404].includes(error.status))return;
     retries++;
    }
    if(!live||signal.aborted)return;
    const delay=Math.min(30000,1000*2**Math.min(retries,5));
    await new Promise<void>(resolve=>{
     const timer=window.setTimeout(()=>{timers.delete(timer);resolve();},delay);
     timers.add(timer);
     signal.addEventListener('abort',()=>{window.clearTimeout(timer);timers.delete(timer);resolve();},{once:true});
    });
   }
  };
  feeds.forEach((name,index)=>{void follow(name,index);});
  launch('page-load',{pageSessionKey:scope});
  return()=>{
   contextAlive=false;window.removeEventListener('metadrive:page-flow-mutated',reloadContexts);
   live=false;controllers.forEach(controller=>controller.abort());timers.forEach(timer=>window.clearTimeout(timer));
   window.removeEventListener('metadrive:in-screen-action',component);
   window.removeEventListener('metadrive:page-component-interaction',component);
   window.removeEventListener('metadrive:page-flow-mutated',updated);
  };
 },[flows,scope,appApiName,pageApiName,pageRecordId,onLaunchFlow]);
 return null;
}

import {useEffect, useRef, useState} from 'react';

type Api = <T>(path:string, init?:RequestInit)=>Promise<T>;
type StateValue = Record<string, unknown> | null;
type Outputs = {outputs?:Record<string, unknown>};
export type FlowStateChannel = {
  key:string; ready:boolean; exists:boolean; value:StateValue; error:string;
  publish:(value:Record<string,unknown>)=>void; refresh:()=>void;
};
const validName=(value:unknown)=>typeof value==='string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value);

/** Reusable, authenticated state binding. Mutations always use configured Flows. */
export function useFlowStateChannel(
  properties:Record<string,unknown>, sessionId:string, api:Api, disabled:boolean
):FlowStateChannel|undefined {
  const config={
    read:String(properties.stateReadFlowApiName??''),
    write:String(properties.stateWriteFlowApiName??''),
    object:String(properties.stateObjectApiName??''),
    field:String(properties.stateValueFieldApiName??''),
    versionField:String(properties.stateVersionFieldApiName??''),
    keyInput:String(properties.stateKeyInput??'Key'),
    valueInput:String(properties.stateValueInput??'Value'),
    valueOutput:String(properties.stateValueOutput??'Value'),
    versionOutput:String(properties.stateVersionOutput??'Version'),
    recordOutput:String(properties.stateRecordIdOutput??'RecordId'),
    query:String(properties.stateSessionQueryParam??''),
    interval:Math.min(30000,Math.max(750,Number(properties.statePollIntervalMs)||1500))
  };
  const enabled=properties.stateSyncEnabled===true && !disabled;
  const key=config.query ? new URLSearchParams(window.location.search).get(config.query)??'' : sessionId;
  const [state,setState]=useState<{ready:boolean;exists:boolean;value:StateValue;error:string}>({
    ready:false,exists:false,value:null,error:''
  });
  const requestRef=useRef<(value:Record<string,unknown>)=>void>(()=>{});
  const refreshRef=useRef<()=>void>(()=>{});
  const signature=JSON.stringify(config);
  useEffect(()=>{
    if(!enabled)return;
    let active=true,busy=false,recordId='',version=0;
    let pending:{value:string;id:string}|undefined;
    const settings=JSON.parse(signature) as typeof config;
    const parse=(value:unknown):StateValue=>{
      if(value===null || value===undefined || value==='')return null;
      const parsed=typeof value==='string'?JSON.parse(value):value;
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw Error('State must be a JSON object');
      return parsed as Record<string,unknown>;
    };
    const apply=(outputs:Record<string,unknown>)=>{
      const nextVersion=Number(outputs[settings.versionOutput]??0);
      if(!Number.isSafeInteger(nextVersion)||nextVersion<0)throw Error('Invalid state revision');
      if(nextVersion<version)return;
      version=nextVersion;
      const id=outputs[settings.recordOutput];
      if(typeof id==='string' && id)recordId=id;
      const value=parse(outputs[settings.valueOutput]);
      if(active)setState(previous=>({
        ready:true,exists:Boolean(recordId),
        value:pending?previous.value:JSON.stringify(previous.value)===JSON.stringify(value)?previous.value:value,
        error:''
      }));
    };
    const invoke=async(flow:string,inputs:Record<string,unknown>)=>{
      if(!validName(flow))throw Error('Choose a registered state Flow');
      const result=await api<Outputs>('/flows/'+encodeURIComponent(flow)+'/execute',{
        method:'POST',body:JSON.stringify(inputs)
      });
      if(!result.outputs)throw Error('State Flow must complete without a screen');
      return result.outputs;
    };
    const refresh=async()=>{
      if(!active||busy||!key)return;
      busy=true;
      try {
        if(pending) {
          if(!settings.write)throw Error('This display is read-only');
          const request=pending;
          const outputs=await invoke(settings.write,{
            [settings.keyInput]:key,[settings.valueInput]:request.value,
            RequestId:request.id,ExpectedVersion:version
          });
          if(outputs.Status!=='Updated' && outputs.Status!=='Unchanged') {
            if(outputs.Status==='Conflict') {pending=undefined;apply(outputs);}
            throw Error(String(outputs.Message??'State update was refused'));
          }
          if(pending===request)pending=undefined;
          apply(outputs);
        } else if(recordId && validName(settings.object) && validName(settings.field)
            && validName(settings.versionField)) {
          const response=await api<{record:Record<string,unknown>}>(
            '/records/'+encodeURIComponent(settings.object)+'/'+encodeURIComponent(recordId));
          apply({
            [settings.valueOutput]:response.record[settings.field],
            [settings.versionOutput]:response.record[settings.versionField],
            [settings.recordOutput]:response.record.Id
          });
        } else {
          apply(await invoke(settings.read,{[settings.keyInput]:key}));
        }
      } catch(error) {
        if(active)setState(previous=>({...previous,ready:true,
          error:error instanceof Error?error.message:'Unable to synchronise state'}));
      } finally {
        busy=false;
        if(active && pending)setTimeout(()=>{void refresh();},settings.interval);
      }
    };
    setState({ready:false,exists:false,value:null,error:''});
    requestRef.current=value=>{
      if(!active||!settings.write)return;
      const json=JSON.stringify(value);
      if(json.length>120000){setState(previous=>({...previous,error:'State exceeds the configured storage limit'}));return;}
      pending={value:json,id:crypto.randomUUID()};
      void refresh();
    };
    refreshRef.current=()=>{void refresh();};
    void refresh();
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('online',visible);
    window.addEventListener('focus',visible);
    document.addEventListener('visibilitychange',visible);
    const timer=window.setInterval(visible,settings.interval);
    return ()=>{
      active=false;pending=undefined;window.clearInterval(timer);
      window.removeEventListener('online',visible);window.removeEventListener('focus',visible);
      document.removeEventListener('visibilitychange',visible);
      requestRef.current=()=>{};refreshRef.current=()=>{};
    };
  },[enabled,key,signature,api]);
  return enabled ? {...state,key,publish:value=>requestRef.current(value),refresh:()=>refreshRef.current()} : undefined;
}

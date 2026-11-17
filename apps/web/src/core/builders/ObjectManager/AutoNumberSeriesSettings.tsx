import {useEffect,useState} from 'react';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

/**
 * Auto Number field: "Number separately for each <field>" (e.g. each Location) and the next
 * number of each series. A series only moves forward; the split is fixed once numbers exist.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Settings={scopeField:string;locked:boolean;scopeOptions:Array<{apiName:string;label:string}>;
 series:Array<{value:string;next:number}>};

export default function AutoNumberSeriesSettings({request,object,objects,fieldApi,onNotify}:{
 request:Request;object:ObjectMetadata;objects:readonly ObjectMetadata[];fieldApi:string;onNotify:(message:string)=>void;
}){
 const base='/metadata/objects/'+encodeURIComponent(object.apiName)+'/fields/'+encodeURIComponent(fieldApi)+'/auto-number';
 const [settings,setSettings]=useState<Settings|null>(null);
 const [values,setValues]=useState<Array<{value:string;label:string}>>([]);
 const [edits,setEdits]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  void request<Settings>(base).then(result=>{if(active)setSettings(result);})
   .catch(error=>onNotify(error instanceof Error?error.message:'Auto Number settings could not be loaded'));
  return ()=>{active=false;};
 },[base]);
 // The values a series can be for: the related records (Lookup) or the picklist values.
 useEffect(()=>{
  const scope=object.fields.find(field=>field.apiName===settings?.scopeField);
  if(!scope){setValues([]);return;}
  if(scope.picklistValues?.length){setValues(scope.picklistValues.map(value=>({value,label:value})));return;}
  const target=scope.relationship?.targetObject;
  if(!target||!objects.some(item=>item.apiName===target)){setValues([]);return;}
  let active=true;
  void request<{records?:Array<Record<string,unknown>>}>('/records/'+encodeURIComponent(target)+'?limit=200')
   .then(result=>{if(active)setValues((result.records??[]).map(row=>({value:String(row.Id),
    label:String(row.Name??row.Id)+(row.Code?' ('+String(row.Code)+')':'')})));})
   .catch(()=>{if(active)setValues([]);});
  return ()=>{active=false;};
 },[settings?.scopeField,object,objects]);
 if(!settings)return null;
 const save=async(path:string,body:unknown)=>{
  setBusy(true);
  try{return await request<unknown>(path,{method:'PUT',body:JSON.stringify(body)});}
  catch(error){onNotify(error instanceof Error?error.message:'Not saved');return null;}
  finally{setBusy(false);}
 };
 const nextOf=(value:string)=>settings.series.find(row=>row.value===value)?.next??1;
 return <fieldset className="form-options" aria-label="Auto Number series">
  <label className="form-label">Number separately for each
   <select className="form-control" value={settings.scopeField} disabled={busy||settings.locked}
    title={settings.locked?'Numbers were already given: the series can no longer be split differently':undefined}
    onChange={async event=>{
     const result=await save(base,{scopeField:event.target.value});
     if(result)setSettings(result as Settings);
    }}>
    <option value="">— One series for all records —</option>
    {settings.scopeOptions.map(option=><option key={option.apiName} value={option.apiName}>{option.label}</option>)}
   </select>
  </label>
  {settings.scopeField&&values.length>0&&<table className="records-table"><thead><tr>
    <th scope="col">{settings.scopeOptions.find(option=>option.apiName===settings.scopeField)?.label}</th>
    <th scope="col">Next number</th><th scope="col"><span className="sr-only">Save</span></th></tr></thead>
   <tbody>{values.map(item=><tr key={item.value}>
    <td>{item.label}</td>
    <td><input className="form-control" type="number" min={nextOf(item.value)} step={1}
     aria-label={'Next number for '+item.label} value={edits[item.value]??String(nextOf(item.value))}
     onChange={event=>setEdits({...edits,[item.value]:event.target.value})}/></td>
    <td><button className="btn" type="button" disabled={busy||!edits[item.value]||Number(edits[item.value])===nextOf(item.value)}
     onClick={async()=>{
      const result=await save(base+'/series',{value:item.value,next:Number(edits[item.value])});
      if(!result)return;
      const next=(result as {next:number}).next;
      setSettings({...settings,series:[...settings.series.filter(row=>row.value!==item.value),{value:item.value,next}]});
      setEdits(({[item.value]:_,...rest})=>rest);
     }}>Save</button></td>
   </tr>)}</tbody></table>}
  {settings.scopeField&&<p className="form-help">Numbers only move forward. A record must have its {settings.scopeOptions.find(option=>option.apiName===settings.scopeField)?.label} filled in to be saved.</p>}
 </fieldset>;
}

/** Object setting "Records can't be deleted": numbered documents are set to Cancelled instead. */
export function PreventDeleteSetting({request,objectApi,onNotify}:{request:Request;objectApi:string;onNotify:(message:string)=>void}){
 const path='/metadata/objects/'+encodeURIComponent(objectApi)+'/prevent-delete';
 const [value,setValue]=useState<boolean|null>(null);
 useEffect(()=>{
  let active=true;
  void request<{preventDelete:boolean}>(path).then(result=>{if(active)setValue(result.preventDelete);}).catch(()=>undefined);
  return ()=>{active=false;};
 },[path]);
 if(value===null)return null;
 return <dl className="object-definition-facts"><div className="metadata-row"><dt>Records can't be deleted</dt><dd>
  <label><input type="checkbox" checked={value} aria-label="Records can't be deleted (set them to Cancelled instead)"
   onChange={async event=>{
    const next=event.target.checked;
    try{await request(path,{method:'PUT',body:JSON.stringify({preventDelete:next})});setValue(next);}
    catch(error){onNotify(error instanceof Error?error.message:'Not saved');}
   }}/> {value?'Yes: set records to Cancelled instead':'No'}</label></dd></div></dl>;
}

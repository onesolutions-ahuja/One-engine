import {useEffect,useState} from 'react';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

/**
 * Auto Number field: "Number separately for each <field>" (e.g. each Location, or each
 * Location and Invoice Type) and the next number of each series. A series only moves
 * forward; the split is fixed once numbers exist.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
type Settings={scopeField:string;scopeFields:string[];locked:boolean;scopeOptions:Array<{apiName:string;label:string}>;
 series:Array<{value:string;next:number}>};
type Choice={value:string;label:string};
const BLANK='\u2205';

export default function AutoNumberSeriesSettings({request,object,objects,fieldApi,onNotify}:{
 request:Request;object:ObjectMetadata;objects:readonly ObjectMetadata[];fieldApi:string;onNotify:(message:string)=>void;
}){
 const base='/metadata/objects/'+encodeURIComponent(object.apiName)+'/fields/'+encodeURIComponent(fieldApi)+'/auto-number';
 const [settings,setSettings]=useState<Settings|null>(null);
 const [choices,setChoices]=useState<Record<string,Choice[]>>({});
 const [pick,setPick]=useState<string[]>([]);
 const [nextNumber,setNextNumber]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  void request<Settings>(base).then(result=>{if(active)setSettings(result);})
   .catch(error=>onNotify(error instanceof Error?error.message:'Auto Number settings could not be loaded'));
  return ()=>{active=false;};
 },[base]);
 // The values a series can be for: related records (Lookup) or picklist values.
 useEffect(()=>{
  let active=true;
  setPick([]);
  void Promise.all((settings?.scopeFields??[]).map(async name=>{
   const scope=object.fields.find(field=>field.apiName===name);
   if(scope?.picklistValues?.length)return [name,scope.picklistValues.map(value=>({value,label:value}))] as const;
   const target=scope?.relationship?.targetObject;
   if(!target)return [name,[]] as const;
   const result=await request<{records?:Array<Record<string,unknown>>}>('/records/'+encodeURIComponent(target)+'?limit=200')
    .catch(()=>({records:[]}));
   return [name,(result.records??[]).map(row=>({value:String(row.Id),
    label:String(row.Name??row.Id)+(row.Code?' ('+String(row.Code)+')':'')}))] as const;
  })).then(rows=>{if(active)setChoices(Object.fromEntries(rows));});
  return ()=>{active=false;};
 },[settings?.scopeField,object]);
 if(!settings)return null;
 const label=(name:string)=>settings.scopeOptions.find(option=>option.apiName===name)?.label??name;
 const nameOf=(field:string,value:string)=>value===BLANK?'(blank)':choices[field]?.find(choice=>choice.value===value)?.label??value;
 const describe=(key:string)=>key.split('|').map((value,index)=>nameOf(settings.scopeFields[index]??'',value)).join(' · ');
 const save=async(path:string,body:unknown)=>{
  setBusy(true);
  try{return await request<unknown>(path,{method:'PUT',body:JSON.stringify(body)});}
  catch(error){onNotify(error instanceof Error?error.message:'Not saved');return null;}
  finally{setBusy(false);}
 };
 const setScope=async(index:number,value:string)=>{
  const fields=[...settings.scopeFields];
  fields[index]=value;
  const result=await save(base,{scopeField:fields.filter(Boolean).join(',')});
  if(result)setSettings(result as Settings);
 };
 const lockedTitle=settings.locked?'Numbers were already given: the series can no longer be split differently':undefined;
 return <fieldset className="form-options" aria-label="Auto Number series">
  {[0,1].map(index=>(index===0||settings.scopeFields[0])&&<label className="form-label" key={index}>
   {index===0?'Number separately for each':'…and for each'}
   <select className="form-control" value={settings.scopeFields[index]??''} disabled={busy||settings.locked} title={lockedTitle}
    onChange={event=>void setScope(index,event.target.value)}>
    <option value="">{index===0?'— One series for all records —':'— Nothing else —'}</option>
    {settings.scopeOptions.filter(option=>!settings.scopeFields.includes(option.apiName)||settings.scopeFields[index]===option.apiName)
     .map(option=><option key={option.apiName} value={option.apiName}>{option.label}</option>)}
   </select></label>)}
  {settings.scopeFields.length>0&&<>
   <p className="form-help">Tip: put a field in the format to show it in the number, e.g. {'{InvoiceType}-{0}'}. Numbers only move forward; a blank value has its own series.</p>
   {settings.series.length>0&&<table className="records-table"><thead><tr><th scope="col">Series</th><th scope="col">Next number</th></tr></thead>
    <tbody>{settings.series.map(row=><tr key={row.value}><td>{describe(row.value)}</td><td>{row.next}</td></tr>)}</tbody></table>}
   <div className="form-options" role="group" aria-label="Set the next number of a series">
    {settings.scopeFields.map((name,index)=><label className="form-label" key={name}>{label(name)}
     <select className="form-control" value={pick[index]??''} onChange={event=>{const next=[...pick];next[index]=event.target.value;setPick(next);}}>
      <option value="">Choose…</option>
      {(choices[name]??[]).map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}
     </select></label>)}
    <label className="form-label">Next number<input className="form-control" type="number" min={1} step={1}
     value={nextNumber} onChange={event=>setNextNumber(event.target.value)}/></label>
    <button className="btn" type="button" disabled={busy||!nextNumber||settings.scopeFields.some((_,index)=>!pick[index])}
     onClick={async()=>{
      const result=await save(base+'/series',{values:settings.scopeFields.map((_,index)=>pick[index]),next:Number(nextNumber)});
      if(!result)return;
      const saved=result as {value:string;next:number};
      setSettings({...settings,series:[...settings.series.filter(row=>row.value!==saved.value),saved]});
      setNextNumber('');
     }}>Set next number</button>
   </div>
  </>}
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

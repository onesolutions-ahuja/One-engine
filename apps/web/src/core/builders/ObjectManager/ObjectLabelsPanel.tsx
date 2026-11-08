import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

type Values={language:string;revision:number;values:Record<string,string>};
const isLocale=(value:string)=>/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(value);
export default function ObjectLabelsPanel({object}: {object:ObjectMetadata}){
 const [language,setLanguage]=useState('en-gb');
 const [revision,setRevision]=useState(0);
 const [values,setValues]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const base='/metadata/objects/'+encodeURIComponent(object.apiName)+'/translations';
 useEffect(()=>{
  let alive=true;setValues({});setRevision(0);setError('');setNotice('');
  if(!isLocale(language))return;
  void apiRequest<Values>(base+'?language='+encodeURIComponent(language))
   .then(x=>{if(alive){setRevision(x.revision);setValues(x.values);}})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load labels');});
  return()=>{alive=false;};
 },[base,language]);
 const save=async()=>{
  setBusy(true);setError('');setNotice('');
  try{
   const clean=Object.fromEntries(Object.entries(values).filter(([,value])=>value.trim()));
   const result=await apiRequest<{saved:boolean;revision:number}>(base,{
    method:'PUT',body:JSON.stringify({language,revision,values:clean})
   });
   if(!result.saved)throw new Error('Labels were not saved');
   setRevision(result.revision);
   setNotice('Translations saved. Published API names and default labels are unchanged.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save translated labels');}
  finally{setBusy(false);}
 };
 const fields=[{apiName:'',label:'Object label',defaultValue:object.label},
  {apiName:'*',label:'Plural object label',defaultValue:object.pluralLabel},
  ...object.fields.map(field=>({apiName:field.apiName,
   label:'Field · '+field.label,defaultValue:field.label}))];
 return <section className="metadata-card" aria-label="Object and field translations">
  <div className="section-toolbar"><div><h3>Language & translations</h3>
   <p>Localise object and field labels without changing shared SQL field names,
    published page IDs, Flows, or integrations.</p></div></div>
  <label className="form-label">Language (for example: fr or en-gb)
   <input className="form-control" value={language} maxLength={35}
    onChange={event=>setLanguage(event.target.value.trim().toLowerCase())}/>
  </label>
  {!isLocale(language)&&<p role="alert">Enter a valid language code.</p>}
  {isLocale(language)&&<>
   {fields.map(field=><label className="form-label" key={field.apiName}>
    {field.label}
    <input className="form-control" value={values[field.apiName]??''}
     maxLength={255} placeholder={field.defaultValue}
     onChange={event=>setValues(current=>({...current,[field.apiName]:event.target.value}))}/>
   </label>)}
   <button type="button" className="btn btn-brand" disabled={busy} onClick={()=>void save()}>
    {busy?'Saving…':'Save translations'}</button>
   <p className="properties-help">Preview translated object metadata using
    <code> /api/metadata/objects?language={language}</code>. Original labels remain canonical.</p>
  </>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}

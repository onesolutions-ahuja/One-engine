import {useEffect,useState} from 'react';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {appRoutePath,type AppRoute} from '../../workspace/Navigation/appRouting';
import {formatRecordValue} from '../../records/RecordWorkspace/recordCsvUtils';
import {parseSafeRichText} from './safeRichText';
import {resolveStandardListColumns} from './standardListColumns';
import {standardListQuery} from './standardListQuery';

/** Existing generic Record API is the source of truth for permission-checked rows. */
export function StandardRecordList({
  object,request,appId,onNavigate,columns,pageSize=25,recordFilter,savedViewId,extraFilter,initialSort,initialDirection
}:{
  object:ObjectMetadata|undefined;
  request:<T>(path:string,init?:RequestInit)=>Promise<T>;
  appId:string;onNavigate:(route:AppRoute)=>void;
  columns:string[];pageSize?:number;savedViewId?:string;
  extraFilter?:{field:string;value:string;operator:'Equals'|'Includes'|'Excludes'};
  initialSort?:string;initialDirection?:'asc'|'desc';
  recordFilter?:{field:string;recordId:string};
}) {
  const [offset,setOffset]=useState(0);
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState(initialSort??'');
  const [direction,setDirection]=useState<'asc'|'desc'>(initialDirection??'asc');
  useEffect(()=>{setSort(initialSort??'');setDirection(initialDirection??'asc');setOffset(0);},[initialSort,initialDirection]);
  const [rows,setRows]=useState<Array<Record<string,unknown>>>([]);
  const [total,setTotal]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [savedColumns,setSavedColumns]=useState<string[]>([]);
  useEffect(()=>{
    if(!savedViewId||!object?.apiName){setSavedColumns([]);return;}
    let active=true;setSavedColumns([]);
    void request<{view:{columns?:string[]}}>(
      '/records/'+encodeURIComponent(object.apiName)+'/list-views/'+encodeURIComponent(savedViewId))
      .then(result=>{if(active)setSavedColumns(Array.isArray(result.view?.columns)
        ?result.view.columns.filter(name=>typeof name==='string'):[]);})
      .catch(()=>{if(active)setSavedColumns([]);});
    return()=>{active=false;};
  },[object?.apiName,savedViewId,request]);
  const limit=Math.max(1,Math.min(100,Math.trunc(pageSize)||25));
  // Display only fields returned through the object metadata accessible to this
  // session. A saved view ID affects the server query, not field-level grants.
  const allowedNames=new Set(object?.fields.map(field=>field.apiName)??[]);
  const names=resolveStandardListColumns(columns,savedColumns,[...allowedNames],
    object?.fields.slice(0,4).map(field=>field.apiName)??[]);
  useEffect(()=>setOffset(0),[object?.apiName,savedViewId,limit,recordFilter?.field,recordFilter?.recordId]);
  useEffect(()=>{
    if(!object?.apiName){setRows([]);return;}
    let active=true;
    setBusy(true);setError('');
    const params=standardListQuery({limit,offset,search,sort,direction,savedViewId,recordFilter,extraFilter});
    void request<{records:Array<Record<string,unknown>>;total:number}>(
      '/records/'+encodeURIComponent(object.apiName)+'?'+params)
      .then(result=>{if(active){setRows(result.records??[]);setTotal(result.total??0);}})
      .catch(reason=>{if(active){setRows([]);setError(reason instanceof Error?reason.message:'Records unavailable');}})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[object?.apiName,request,limit,offset,search,sort,direction,
    recordFilter?.field,recordFilter?.recordId,savedViewId,
    extraFilter?.field,extraFilter?.value,extraFilter?.operator]);
  if(!object)return <p role="status">Select an Object in block settings.</p>;
  return <section className="record-fields-card surface" aria-label={object.pluralLabel}>
    <div className="record-fields-heading">
      <h2>{object.pluralLabel}</h2>
      <span>{total} records</span>
    </div>
    <label className="form-label">Search records
      <input className="form-control" type="search" value={search}
        onChange={event=>{setOffset(0);setSearch(event.target.value);}}/>
    </label>
    <label className="form-label">Sort
      <select className="form-control" value={sort}
        onChange={event=>{setSort(event.target.value);setOffset(0);}}>
        <option value="">Default</option>
        {names.map(name=><option value={name} key={name}>{object.fields.find(field=>field.apiName===name)?.label??name}</option>)}
      </select>
    </label>
    {sort&&<button type="button" className="btn" onClick={()=>setDirection(old=>old==='asc'?'desc':'asc')}>
      {direction==='asc'?'Ascending':'Descending'}</button>}
    {error&&<p role="alert">{error}</p>}
    {busy?<p role="status">Loading records…</p>
      :<div className="records-table-wrap"><table className="slds-table records-table">
        <thead><tr>{names.map(name=><th key={name}>{object.fields.find(field=>field.apiName===name)?.label??name}</th>)}</tr></thead>
        <tbody>{rows.map(row=><tr key={String(row.Id)}>{names.map((name,index)=><td key={name}>
          {index===0&&typeof row.Id==='string'
            ?<a href={appRoutePath({kind:'record-detail',objectApiName:object.apiName,recordId:row.Id,appId})}
              onClick={event=>{
                if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
                event.preventDefault();
                onNavigate({kind:'record-detail',objectApiName:object.apiName,recordId:String(row.Id),appId});
              }}>{formatRecordValue(row[name]??row.Id)}</a>
            :formatRecordValue(row[name])}
        </td>)}</tr>)}</tbody>
      </table>{!rows.length&&<p className="records-empty">No readable matching records.</p>}</div>}
    <nav className="records-pagination" aria-label={object.pluralLabel+' pages'}>
      <button type="button" className="btn" disabled={offset===0||busy}
        onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</button>
      <span>{total?offset+1:0}–{Math.min(offset+rows.length,total)} of {total}</span>
      <button type="button" className="btn" disabled={busy||offset+limit>=total}
        onClick={()=>setOffset(offset+limit)}>Next</button>
    </nav>
  </section>;
}

/** A constrained formatted-text renderer, never raw HTML or uncontrolled DOM. */
export function StandardRichText({text}:{text:string}) {
  return <div className="record-fields-card surface" style={{whiteSpace:'pre-wrap'}}>
    {parseSafeRichText(text).map((token,index)=> {
      if(token.kind==='bold')return <strong key={index}>{token.text}</strong>;
      if(token.kind==='italic')return <em key={index}>{token.text}</em>;
      if(token.kind==='underline')return <u key={index}>{token.text}</u>;
      if(token.kind==='link'&&token.href)return <a key={index} href={token.href}
        rel="noopener noreferrer">{token.text}</a>;
      return <span key={index}>{token.text}</span>;
    })}
  </div>;
}

export function StandardFlowLauncher({
  label,flowApiName,flows,recordId,inputRecordIdAs,onLaunchFlow
}:{
  label:string;flowApiName:string;
  flows:ReadonlyArray<{apiName:string;status:string;flowType:string}>;
  recordId?:string;inputRecordIdAs?:string;
  onLaunchFlow:(flowApiName:string,inputs?:Record<string,unknown>)=>void;
}) {
  const flow=flows.find(item=>item.apiName===flowApiName);
  const available=flow?.status==='Active'&&flow.flowType==='Screen Flow';
  return <section className="record-fields-card surface">
    <button type="button" className="btn btn-brand" disabled={!available} onClick={()=>{
      if(!available)return;
      const inputs=recordId&&inputRecordIdAs&&/^[A-Za-z][A-Za-z0-9_]*$/.test(inputRecordIdAs)
        ?{[inputRecordIdAs]:recordId}:{};
      onLaunchFlow(flowApiName,inputs);
    }}>{label}</button>
    {!available&&<p role="status">Select an active Screen Flow in block settings.</p>}
  </section>;
}

export function StandardRecordPath({
  label,values,value,canEdit,onAdvance,guidanceByStage,keyFieldsByStage,record,readableFields
}:{
  label:string;values:readonly string[];value:unknown;canEdit:boolean;
  guidanceByStage?:Readonly<Record<string,string>>;
  keyFieldsByStage?:Readonly<Record<string,readonly string[]>>;
  record?:Readonly<Record<string,unknown>>;
  readableFields?:ReadonlyArray<{apiName:string;label:string}>;
  onAdvance:(nextValue:string)=>Promise<void>;
}) {
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const [selected,setSelected]=useState('');
  const current=String(value??'');
  const chosen=selected||current;
  return <section className="record-fields-card surface" aria-label={label}>
    <div className="record-fields-heading"><h2>{label}</h2></div>
    <ol className="record-path" style={{display:'flex',flexWrap:'wrap',gap:8,padding:0,listStyle:'none'}}>
      {values.map((step,index)=><li key={step}><button type="button" className="btn"
        aria-current={step===current?'step':undefined} aria-pressed={step===chosen}
        disabled={!canEdit||pending} onClick={()=>setSelected(step)}>
        {index+1}. {step}{step===current?' ✓':''}
      </button></li>)}
    </ol>
    {typeof guidanceByStage?.[chosen]==='string'&&Boolean(guidanceByStage[chosen])&&<p className="records-message">{guidanceByStage[chosen]}</p>}
    {Array.isArray(keyFieldsByStage?.[chosen])&&Boolean(keyFieldsByStage[chosen].length)&&record&&<dl className="record-fields-grid">
      {keyFieldsByStage[chosen].filter(name=>readableFields?.some(field=>field.apiName===name))
        .map(name=><div key={name}><dt>{readableFields?.find(field=>field.apiName===name)?.label??name}</dt>
          <dd>{formatRecordValue(record[name])}</dd></div>)}
    </dl>}
    {canEdit&&selected&&selected!==current&&<button type="button" className="btn btn-brand"
      disabled={pending} onClick={()=>{setPending(true);setError('');
        void onAdvance(selected).then(()=>setSelected(''))
          .catch(e=>setError(e instanceof Error?e.message:'Unable to update stage'))
          .finally(()=>setPending(false));
      }}>{pending?'Updating…':'Mark '+selected+' as current'}</button>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

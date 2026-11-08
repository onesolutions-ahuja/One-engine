import {useCallback, useEffect, useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName,apiNameIsValid} from '../../metadata/Definitions/metadataApiNames';

type GlobalValueSet={
  id:string;
  apiName:string;
  label:string;
  description:string;
  values:Array<{value:string;label:string;active:boolean;sortOrder:number}>;
};

export default function GlobalValueSetManager(){
  const [valueSets,setValueSets]=useState<GlobalValueSet[]>([]);
  const [mode,setMode]=useState<'list'|'view'|'edit'>('list');
  const [selectedId,setSelectedId]=useState('');
  const [apiName,setApiName]=useState('');
  const [label,setLabel]=useState('');
  const [description,setDescription]=useState('');
  const [values,setValues]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [manualName,setManualName]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const result=await apiRequest<{valueSets:GlobalValueSet[]}>('/metadata/global-value-sets');
      setValueSets(result.valueSets);
      setError('');
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Unable to load Global Value Sets');
    }finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{void load();},[load]);

  const choose=(valueSet:GlobalValueSet)=>{
    setSelectedId(valueSet.id);
    setApiName(valueSet.apiName);
    setManualName(true);
    setLabel(valueSet.label);
    setDescription(valueSet.description);
    setValues(valueSet.values.map(item=>item.value).join('\n'));
    setError('');
    setMode('view');
  };
  const reset=()=>{
    setSelectedId('');
    setApiName('');
    setManualName(false);
    setLabel('');
    setDescription('');
    setValues('');
    setError('');
    setMode('edit');
  };
  const save=async()=>{
    if(!apiNameIsValid(apiName)||(!selectedId&&metadataNameConflict(apiName,valueSets.map(item=>item.apiName)))){setError('Enter a valid, unused API Name');return;}
    const nextValues=values.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    const current=valueSets.find(item=>item.id===selectedId);
    setSaving(true);
    try{
      const body={apiName,label,description,values:nextValues.map(value=>{
        const existing=current?.values.find(item=>item.value===value);
        return existing?{value,label:existing.label,active:existing.active}:{value};
      })};
      const result=selectedId
        ?await apiRequest<{valueSet:GlobalValueSet}>(`/metadata/global-value-sets/${encodeURIComponent(selectedId)}`,
          {method:'PUT',body:JSON.stringify(body)})
        :await apiRequest<{valueSet:GlobalValueSet}>('/metadata/global-value-sets',
          {method:'POST',body:JSON.stringify(body)});
      await load();
      choose(result.valueSet);
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Unable to save Global Value Set');
    }finally{
      setSaving(false);
    }
  };
  const remove=async()=>{
    if (!selectedId || !confirmDestructiveAction('Delete', 'Global Value Set "' + (label||selectedId) + '"',
      'Referenced sets cannot be deleted. Cancel keeps the value set unchanged.')) return;
    if(!selectedId)return;
    setSaving(true);
    try{
      await apiRequest(`/metadata/global-value-sets/${encodeURIComponent(selectedId)}`,{method:'DELETE'});
      reset();
      setMode('list');
      await load();
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Unable to delete Global Value Set');
    }finally{
      setSaving(false);
    }
  };

  return <section className="surface object-setting-surface">
    <div className="section-toolbar"><div><h2>Global Value Sets</h2><p>Share picklist values across fields in this tenant.</p></div>
      {mode==='list'&&<button className="btn btn-brand" type="button" onClick={reset}>New Value Set</button>}</div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {mode==='list'&&(loading?<div className="empty-state">Loading Global Value Sets…</div>:<div className="metadata-card">
      <div className="table-scroll" role="region" aria-label="Global value sets" tabIndex={0}><table className="slds-table"><thead><tr><th scope="col">Label</th><th scope="col">API Name</th><th scope="col">Values</th></tr></thead>
        <tbody>{valueSets.map(valueSet=><tr key={valueSet.id}>
          <td><button className="btn" type="button" onClick={()=>choose(valueSet)}>{valueSet.label}</button></td>
          <td className="api-name">{valueSet.apiName}</td><td>{valueSet.values.length}</td>
        </tr>)}</tbody></table></div>
      {!valueSets.length&&<div className="empty-state">No Global Value Sets are defined.</div>}
    </div>)}
    {mode==='view'&&<div className="metadata-card">
      <div className="section-toolbar"><div><h3>{label}</h3><p>Read only</p></div>
        <div className="toolbar-actions"><button className="btn" type="button" onClick={()=>setMode('list')}>Back to list</button>
          <button className="btn btn-brand" type="button" onClick={()=>setMode('edit')}>Edit</button></div></div>
      <div className="metadata-row"><span>API name</span><strong>{apiName}</strong></div>
      <div className="metadata-row"><span>Description</span><strong>{description||'—'}</strong></div>
      <div className="metadata-row"><span>Values</span><strong>{values.split(/\r?\n/).filter(Boolean).length}</strong></div>
      <div className="metadata-row"><span>Choices</span><strong>{values.split(/\r?\n/).filter(Boolean).join(', ')}</strong></div>
    </div>}
    {mode==='edit'&&<div className="object-edit-form">
      <div className="toolbar-actions"><button className="btn" type="button"
        onClick={()=>setMode(selectedId?'view':'list')}>Cancel</button></div>
      <label className="form-label">Label<input className="form-control" maxLength={120} value={label} onChange={event=>{setLabel(event.target.value);if(!selectedId&&!manualName)setApiName(generateMetadataApiName(event.target.value));}} /></label>
      <details><summary>Advanced: API Name</summary><label className="form-label">API Name<input className="form-control api-name" maxLength={80} value={apiName} disabled={Boolean(selectedId)} onChange={event=>{setManualName(true);setApiName(event.target.value.toLowerCase());}} /></label></details>
      {!selectedId&&<p className="permission-help">API Name: {apiName||'Generated from label'}</p>}
      {!selectedId&&metadataNameConflict(apiName,valueSets.map(item=>item.apiName))&&<p role="alert" className="form-error">API Name already exists. <button type="button" className="btn" onClick={()=>{setManualName(true);setApiName(suggestMetadataApiName(apiName,valueSets.map(item=>item.apiName)));}}>Use suggested name</button></p>}
      <label className="form-label">Description<textarea className="form-control" maxLength={4000} rows={2} value={description} onChange={event=>setDescription(event.target.value)} /></label>
      <label className="form-label">Values<textarea className="form-control" rows={8} value={values} onChange={event=>setValues(event.target.value)} placeholder={'North\\nSouth\\nWest'} /></label>
      <p className="permission-help">Enter one value per line. Values already used by records cannot be removed; referenced sets cannot be deleted.</p>
      <div className="toolbar-actions"><button className="btn btn-brand" type="button" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save Value Set'}</button>
        {selectedId&&<button className="btn" type="button" disabled={saving} onClick={()=>void remove()}>Delete</button>}</div>
    </div>}
  </section>;
}

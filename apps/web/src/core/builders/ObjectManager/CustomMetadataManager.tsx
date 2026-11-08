import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {confirmDestructiveAction} from '../../components/ConfirmAction/confirmDestructiveAction';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName,apiNameIsValid} from '../../metadata/Definitions/metadataApiNames';

type FieldDefinition={apiName:string;label:string;dataType:'text'|'number'|'boolean'|'date'|'datetime';required:boolean;maxLength?:number};
type Definition={apiName:string;label:string;description:string;fields:FieldDefinition[];protected?:boolean};
type MetadataRecord={id:string;recordKey:string;masterLabel:string;values:Record<string,string|number|boolean>};
const emptyField=():FieldDefinition=>({apiName:'value',label:'Value',dataType:'text',required:false});

export default function CustomMetadataManager({setting}:{setting:string}) {
  const [labels,setLabels]=useState<Array<{apiName:string;language:string;label:string;value:string}>>([]);
  const [mode,setMode]=useState<'list'|'view'|'edit'|'new'>('list');
  const [definitions,setDefinitions]=useState<Definition[]>([]);
  const [selectedApi,setSelectedApi]=useState('');
  const [records,setRecords]=useState<MetadataRecord[]>([]);
  const [labelDraft,setLabelDraft]=useState({apiName:'',language:'en',label:'',value:''});
  const [definitionDraft,setDefinitionDraft]=useState<Definition>({apiName:'',label:'',description:'',fields:[emptyField()],protected:false});
  const [recordDraft,setRecordDraft]=useState({recordKey:'',masterLabel:'',values:{} as Record<string,unknown>});
  const [scope,setScope]=useState<'organization'|'profile'|'user'>('organization');
  const [ownerId,setOwnerId]=useState('');
  const [settingValues,setSettingValues]=useState<Record<string,unknown>>({});
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [advancedName,setAdvancedName]=useState(false);
  const [nameEdited,setNameEdited]=useState(false);
  const isNew=mode==='new';
  const existingNames=setting==='Custom Labels'?labels.filter(item=>item.language===labelDraft.language).map(item=>item.apiName):definitions.map(item=>item.apiName);
  const proposedName=setting==='Custom Labels'?labelDraft.apiName:definitionDraft.apiName;
  const duplicate=isNew&&metadataNameConflict(proposedName,existingNames);
  const suggestion=suggestMetadataApiName(proposedName,existingNames);

  const refresh=async()=>{
    setError('');
    if(setting==='Custom Labels'){
      const result=await apiRequest<{labels:typeof labels}>('/metadata/custom-labels');
      setLabels(result.labels);
      return;
    }
    const route=setting==='Custom Metadata Types'?'/metadata/custom-metadata-types':'/metadata/custom-settings';
    const result=await apiRequest<{types?:Definition[];settings?:Definition[]}>(route);
    const items=result.types??result.settings??[];
    setDefinitions(items);
    if(items.length&&!items.some((item)=>item.apiName===selectedApi))setSelectedApi(items[0].apiName);
  };

  useEffect(()=>{
    setSelectedApi('');
    setMode('list');
    void refresh().catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to load metadata'));
  },[setting]);
  useEffect(()=>{
    if(!selectedApi||setting==='Custom Labels')return;
    let active=true;
    const load=async()=>{
      if(setting==='Custom Metadata Types'){
        const result=await apiRequest<{records:MetadataRecord[]}>(`/metadata/custom-metadata-types/${encodeURIComponent(selectedApi)}/records`);
        if(active)setRecords(result.records);
      }else{
        if(scope!=='organization'&&!ownerId){if(active)setSettingValues({});return;}
        const query=new URLSearchParams({scope,...(scope==='organization'?{}:{ownerId})});
        const result=await apiRequest<{values:Record<string,unknown>}>(`/metadata/custom-settings/${encodeURIComponent(selectedApi)}/values?${query}`);
        if(active)setSettingValues(result.values);
      }
    };
    void load().catch((failure:unknown)=>{if(active)setError(failure instanceof Error?failure.message:'Unable to load values');});
    return()=>{active=false;};
  },[selectedApi,setting,scope,ownerId]);

  const saveLabel=async()=>{
    await apiRequest(`/metadata/custom-labels/${encodeURIComponent(labelDraft.apiName)}`,{
      method:'PUT',body:JSON.stringify({...labelDraft,createOnly:mode==='new'})
    });
    setNotice('Custom Label saved');
    setMode('view');
    await refresh();
  };
  const deleteLabel=async(apiName:string,language:string)=>{
    if (!confirmDestructiveAction('Delete', 'Custom Label "'+apiName+'" ('+language+')')) return;
    await apiRequest(`/metadata/custom-labels/${encodeURIComponent(apiName)}?${new URLSearchParams({language})}`,{method:'DELETE'});
    setNotice('Custom Label deleted');
    setMode('list');
    await refresh();
  };
  const saveDefinition=async()=>{
    const endpoint=setting==='Custom Metadata Types'?'/metadata/custom-metadata-types':'/metadata/custom-settings';
    const payload=await apiRequest<{type?:Definition;setting?:Definition}>(endpoint,{
      method:'POST',body:JSON.stringify(definitionDraft)
    });
    const created=payload.type??payload.setting;
    if(created){setSelectedApi(created.apiName);setDefinitions((current)=>[...current,created]);}
    setDefinitionDraft({apiName:'',label:'',description:'',fields:[emptyField()],protected:false});
    setNotice(`${setting.slice(0,-1)} created`);
    setMode('view');
  };
  const saveMetadataRecord=async()=>{
    if(!selectedApi)return;
    await apiRequest(`/metadata/custom-metadata-types/${encodeURIComponent(selectedApi)}/records/${encodeURIComponent(recordDraft.recordKey)}`,{
      method:'PUT',body:JSON.stringify(recordDraft)
    });
    setRecordDraft({recordKey:'',masterLabel:'',values:{}});
    const result=await apiRequest<{records:MetadataRecord[]}>(`/metadata/custom-metadata-types/${encodeURIComponent(selectedApi)}/records`);
    setRecords(result.records);
    setNotice('Custom Metadata record saved');
  };
  const deleteMetadataRecord=async(recordKey:string)=>{
    if (!confirmDestructiveAction('Delete', 'Custom Metadata record "'+recordKey+'"')) return;
    await apiRequest(`/metadata/custom-metadata-types/${encodeURIComponent(selectedApi)}/records/${encodeURIComponent(recordKey)}`,{method:'DELETE'});
    setRecords((current)=>current.filter((record)=>record.recordKey!==recordKey));
  };
  const saveSettingValues=async()=>{
    if(!selectedApi)return;
    const body={scope,...(scope==='organization'?{}:{ownerId}),values:settingValues};
    await apiRequest(`/metadata/custom-settings/${encodeURIComponent(selectedApi)}/values`,{
      method:'PUT',body:JSON.stringify(body)
    });
    setNotice('Custom Setting values saved');
  };
  const fieldEditor=(fields:FieldDefinition[],onChange:(fields:FieldDefinition[])=>void)=>(
    <div className="metadata-card">
      {fields.map((field,index)=><div className="metadata-row" key={`${index}-${field.apiName}`}>
        <label className="form-label">Label<input className="form-control" value={field.label}
          onChange={(event)=>onChange(fields.map((item,i)=>i===index?{...item,label:event.target.value,
            apiName:item.label===item.apiName||item.apiName===generateMetadataApiName(item.label)?generateMetadataApiName(event.target.value):item.apiName}:item))}/></label>
        <details><summary>Advanced: API Name</summary><label className="form-label">API Name<input className="form-control" value={field.apiName}
          onChange={(event)=>onChange(fields.map((item,i)=>i===index?{...item,apiName:mode==='new'?event.target.value.toLowerCase():event.target.value}:item))}/></label></details>
        {metadataNameConflict(field.apiName,fields.filter((_,i)=>i!==index).map(item=>item.apiName))&&
          <p role="alert" className="formula-validation-error">Duplicate field API Name.
          <button type="button" className="btn" onClick={()=>onChange(fields.map((item,i)=>i===index?{...item,apiName:suggestMetadataApiName(field.apiName,fields.filter((_,j)=>j!==index).map(x=>x.apiName))}:item))}>Use suggested name</button></p>}
        <label className="form-label">Type<select className="form-control" value={field.dataType}
          onChange={(event)=>onChange(fields.map((item,i)=>i===index?{...item,dataType:event.target.value as FieldDefinition['dataType']}:item))}>
          {['text','number','boolean','date','datetime'].map((type)=><option key={type}>{type}</option>)}
        </select></label>
        {field.dataType==='text'&&<label className="form-label">Max Length<input className="form-control" type="number" min={1} max={10000}
          value={field.maxLength??''} onChange={(event)=>onChange(fields.map((item,i)=>i===index?{...item,maxLength:event.target.value?Number(event.target.value):undefined}:item))}/></label>}
        <label className="checkbox-row"><input type="checkbox" checked={field.required}
          onChange={(event)=>onChange(fields.map((item,i)=>i===index?{...item,required:event.target.checked}:item))}/>Required</label>
        {fields.length>1&&<button className="btn" type="button" onClick={()=>onChange(fields.filter((_,i)=>i!==index))}>Remove field</button>}
      </div>)}
      <button className="btn" type="button" onClick={()=>onChange([...fields,emptyField()])}>Add Field</button>
    </div>
  );

  return <section className="surface object-setting-surface">
    <div className="section-toolbar"><div><h2>{setting}</h2><p>Tenant-scoped metadata definitions and values.</p></div>
      <div className="toolbar-actions"><button className="btn" onClick={()=>void refresh().catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to reload metadata'))}>Refresh</button>
        {mode==='list'&&<button className="btn btn-brand" onClick={()=>{
          if(setting==='Custom Labels')setLabelDraft({apiName:'',language:'en',label:'',value:''});
          else setDefinitionDraft({apiName:'',label:'',description:'',fields:[emptyField()],protected:false});
          setAdvancedName(false);setNameEdited(false);setError('');setNotice('');
          setMode('new');
        }}>New</button>}
      </div></div>
    {error&&<p className="formula-validation-error" role="alert">{error}</p>}
    {notice&&<p className="formula-validation-success" role="status">{notice}</p>}
    {mode==='list'&&<div className="table-scroll" role="region" aria-label="Custom metadata records" tabIndex={0}><table className="slds-table">
      <thead><tr><th scope="col">Name</th><th scope="col">API name</th><th scope="col">Details</th><th scope="col">Action</th></tr></thead>
      <tbody>{setting==='Custom Labels'
        ?labels.map(item=><tr key={item.apiName+':'+item.language}>
          <td><button type="button" className="field-link" onClick={()=>{
            setLabelDraft(item);setMode('view');
          }}>{item.label}</button></td><td>{item.apiName}</td><td>{item.language}</td>
          <td><button className="btn" onClick={()=>{setLabelDraft(item);setMode('view')}}>View</button></td>
        </tr>)
        :definitions.map(item=><tr key={item.apiName}>
          <td><button type="button" className="field-link" onClick={()=>{
            setSelectedApi(item.apiName);setMode('view');
          }}>{item.label}</button></td><td>{item.apiName}</td>
          <td>{item.fields.length} fields{setting==='Custom Settings'&&item.protected?' · Protected':''}</td>
          <td><button className="btn" onClick={()=>{setSelectedApi(item.apiName);setMode('view')}}>View</button></td>
        </tr>)}</tbody>
    </table></div>}
    {mode==='view'&&<div className="metadata-card">
      <div className="section-toolbar"><div><h3>{setting==='Custom Labels'?labelDraft.label:
        definitions.find(item=>item.apiName===selectedApi)?.label??selectedApi}</h3><p>Read only</p></div>
        <div className="toolbar-actions"><button className="btn" onClick={()=>setMode('list')}>Back to list</button>
          <button className="btn btn-brand" onClick={()=>setMode('edit')}>Edit</button></div></div>
      {setting==='Custom Labels'?<>
        <div className="metadata-row"><span>API name</span><strong>{labelDraft.apiName}</strong></div>
        <div className="metadata-row"><span>Language</span><strong>{labelDraft.language}</strong></div>
        <div className="metadata-row"><span>Value</span><strong>{labelDraft.value}</strong></div>
      </>:<>
        <div className="metadata-row"><span>API name</span><strong>{selectedApi}</strong></div>
        <div className="metadata-row"><span>Description</span><strong>{definitions.find(item=>item.apiName===selectedApi)?.description||'—'}</strong></div>
        {setting==='Custom Settings'&&<div className="metadata-row"><span>Access</span><strong>{definitions.find(item=>item.apiName===selectedApi)?.protected?'Protected (manage permission required)':'Public (read permission)'}</strong></div>}
        <div className="metadata-row"><span>Fields</span><strong>{definitions.find(item=>item.apiName===selectedApi)?.fields.map(field=>field.label).join(', ')||'None'}</strong></div>
        {setting==='Custom Metadata Types'&&<div className="metadata-card">
          <h4>Records</h4>{records.map(record=><div className="metadata-row" key={record.id}>
            <span>{record.masterLabel}</span><button className="btn" onClick={()=>{
              setRecordDraft({recordKey:record.recordKey,masterLabel:record.masterLabel,values:record.values});
              setMode('edit');
            }}>Edit record</button>
          </div>)}
          {!records.length&&<p>No metadata records yet.</p>}
        </div>}
      </>}
    </div>}
    {(mode==='edit'||mode==='new')&&(setting==='Custom Labels'?<>
      <div className="metadata-card">
        <h3>Label</h3>
        <label className="form-label">Label Name<input className="form-control" value={labelDraft.label} onChange={(event)=>{
          const label=event.target.value;
          setLabelDraft(current=>({...current,label,...(mode==='new'&&!nameEdited?{apiName:generateMetadataApiName(label)}:{})}));
        }}/></label>
        <label className="form-label">Language<input className="form-control" value={labelDraft.language} onChange={(event)=>setLabelDraft({...labelDraft,language:event.target.value})}/></label>
        <label className="form-label">Value<textarea className="form-control" value={labelDraft.value} onChange={(event)=>setLabelDraft({...labelDraft,value:event.target.value})} maxLength={4000} rows={3}/></label>
        {mode==='new'?<><button type="button" className="btn" onClick={()=>setAdvancedName(!advancedName)} aria-expanded={advancedName}>Advanced: API Name</button>
          {advancedName&&<label className="form-label">API Name<input className="form-control" value={labelDraft.apiName} onChange={(event)=>{setNameEdited(true);setLabelDraft({...labelDraft,apiName:event.target.value.toLowerCase()});}}/></label>}
          {!advancedName&&<p>API Name (generated): <code>{labelDraft.apiName||'Enter a label'}</code></p>}
          {duplicate&&<p role="alert" className="formula-validation-error">API Name already exists for this language.
            {suggestion&&<button type="button" className="btn" onClick={()=>{setNameEdited(true);setLabelDraft({...labelDraft,apiName:suggestion});}}>Use {suggestion}</button>}</p>}
        </>:<p>API Name (unchanged): <code>{labelDraft.apiName}</code></p>}
        <button className="btn btn-brand" disabled={!apiNameIsValid(labelDraft.apiName)||!labelDraft.label.trim()||duplicate} onClick={()=>void saveLabel().catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to save Custom Label'))}>Save Label</button>
      </div>
      {labels.map((label)=><div className="metadata-row" key={`${label.apiName}:${label.language}`}>
        <span><strong>{label.label}</strong><small>{label.apiName} · {label.language} · {label.value}</small></span>
        <button className="btn" onClick={()=>setLabelDraft(label)}>Edit</button>
        <button className="btn" onClick={()=>void deleteLabel(label.apiName,label.language).catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to delete label'))}>Delete</button>
      </div>)}
    </>:<>
      {mode==='new'&&<div className="metadata-card">
        <h3>Create Definition</h3>
        {setting==='Custom Settings'&&<label className="checkbox-row">
          <input type="checkbox" checked={definitionDraft.protected===true}
            onChange={event=>setDefinitionDraft({...definitionDraft,protected:event.target.checked})}/>
          Protected values: only OneEngine manage access may read values
        </label>}
        <label className="form-label">Label<input className="form-control" value={definitionDraft.label} onChange={(event)=>setDefinitionDraft({...definitionDraft,label:event.target.value,apiName:nameEdited?definitionDraft.apiName:generateMetadataApiName(event.target.value)})}/></label>
        <button type="button" className="btn" onClick={()=>setAdvancedName(!advancedName)} aria-expanded={advancedName}>Advanced: API Name</button>
        {advancedName?<label className="form-label">API Name<input className="form-control" value={definitionDraft.apiName} onChange={(event)=>{setNameEdited(true);setDefinitionDraft({...definitionDraft,apiName:event.target.value.toLowerCase()});}}/></label>:<p>API Name (generated): <code>{definitionDraft.apiName||'Enter a label'}</code></p>}
        {duplicate&&<p role="alert" className="formula-validation-error">API Name already exists.
          {suggestion&&<button type="button" className="btn" onClick={()=>{setNameEdited(true);setDefinitionDraft({...definitionDraft,apiName:suggestion});}}>Use {suggestion}</button>}</p>}
        <label className="form-label">Description<textarea className="form-control" value={definitionDraft.description} onChange={(event)=>setDefinitionDraft({...definitionDraft,description:event.target.value})}/></label>
        {fieldEditor(definitionDraft.fields,(fields)=>setDefinitionDraft({...definitionDraft,fields}))}
        <button className="btn btn-brand" disabled={!apiNameIsValid(definitionDraft.apiName)||!definitionDraft.label.trim()||duplicate||definitionDraft.fields.some((field,index)=>!apiNameIsValid(field.apiName)||metadataNameConflict(field.apiName,definitionDraft.fields.filter((_,i)=>i!==index).map(item=>item.apiName)))} onClick={()=>void saveDefinition().then(refresh).catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to create definition'))}>Create</button>
      </div>}
      {mode==='edit'&&<label className="form-label">Definition<select className="form-control" value={selectedApi} onChange={(event)=>setSelectedApi(event.target.value)}>
        <option value="">Select a definition</option>{definitions.map((item)=><option key={item.apiName} value={item.apiName}>{item.label} ({item.apiName})</option>)}
      </select></label>}
      {mode==='edit'&&selectedApi&&setting==='Custom Metadata Types'&&<>
        <div className="metadata-card">
          <h3>New Record</h3>
          <label className="form-label">Record Key<input className="form-control" value={recordDraft.recordKey} onChange={(event)=>setRecordDraft({...recordDraft,recordKey:event.target.value})}/></label>
          <label className="form-label">Master Label<input className="form-control" value={recordDraft.masterLabel} onChange={(event)=>setRecordDraft({...recordDraft,masterLabel:event.target.value})}/></label>
          {definitions.find((item)=>item.apiName===selectedApi)?.fields.map((field)=><label className="form-label" key={field.apiName}>{field.label}
            {field.dataType==='boolean'
              ?<input type="checkbox" checked={recordDraft.values[field.apiName]===true}
                onChange={(event)=>setRecordDraft({...recordDraft,values:{...recordDraft.values,[field.apiName]:event.target.checked}})}/>
              :<input className="form-control" type={field.dataType==='number'?'number':field.dataType==='date'?'date':field.dataType==='datetime'?'datetime-local':'text'}
                value={String(recordDraft.values[field.apiName]??'')} onChange={(event)=>setRecordDraft({...recordDraft,values:{...recordDraft.values,[field.apiName]:field.dataType==='number'?(event.target.value===''?undefined:Number(event.target.value)):event.target.value}})}/>}
          </label>)}
          <button className="btn btn-brand" onClick={()=>void saveMetadataRecord().catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to save record'))}>Save Record</button>
        </div>
        {records.map((record)=><div className="metadata-row" key={record.id}><span><strong>{record.masterLabel}</strong><small>{record.recordKey}</small></span>
          <button className="btn" onClick={()=>setRecordDraft({recordKey:record.recordKey,masterLabel:record.masterLabel,values:record.values})}>Edit</button>
          <button className="btn" onClick={()=>void deleteMetadataRecord(record.recordKey).catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to delete record'))}>Delete</button>
        </div>)}
      </>}
      {mode==='edit'&&selectedApi&&setting==='Custom Settings'&&<>
        <div className="metadata-card">
          <h3>Hierarchical Values</h3>
          <label className="form-label">Scope<select className="form-control" value={scope} onChange={(event)=>setScope(event.target.value as typeof scope)}>
            <option value="organization">Organization</option><option value="profile">Profile</option><option value="user">User</option>
          </select></label>
          {scope!=='organization'&&<label className="form-label">{scope==='profile'?'Profile':'User'} ID<input className="form-control" value={ownerId} onChange={(event)=>setOwnerId(event.target.value)}/></label>}
          {definitions.find((item)=>item.apiName===selectedApi)?.fields.map((field)=><label className="form-label" key={field.apiName}>{field.label}
            {field.dataType==='boolean'?<input type="checkbox" checked={settingValues[field.apiName]===true} onChange={(event)=>setSettingValues({...settingValues,[field.apiName]:event.target.checked})}/>
              :<input className="form-control" type={field.dataType==='number'?'number':field.dataType==='date'?'date':field.dataType==='datetime'?'datetime-local':'text'}
                value={String(settingValues[field.apiName]??'')} onChange={(event)=>setSettingValues({...settingValues,[field.apiName]:field.dataType==='number'?(event.target.value===''?undefined:Number(event.target.value)):event.target.value})}/>}
          </label>)}
          <button className="btn btn-brand" onClick={()=>void saveSettingValues().catch((failure:unknown)=>setError(failure instanceof Error?failure.message:'Unable to save settings'))}>Save Values</button>
        </div>
      </>}
    </>)}
    {(mode==='edit'||mode==='new')&&<button className="btn" type="button" onClick={()=>setMode(mode==='edit'?'view':'list')}>Cancel / Back</button>}
  </section>;
}

import {useEffect,useState} from 'react';
import {apiRequest} from '../../authentication/Client/authClient';
import {generateMetadataApiName,metadataNameConflict,suggestMetadataApiName} from '../../metadata/Definitions/metadataApiNames';
import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import SmartFieldInput from '../../../component-libraries/shared/primitives/SmartFieldInput/SmartFieldInput';

type Field={apiName:string;label:string;dataType:string};
type Rule={apiName:string;label:string;expression:string;errorMessage:string;errorFieldApi:string|null;active:boolean;sortOrder:number;revision:number};
type Default={fieldApi:string;expression:string;revision:number};
const initial:Rule={apiName:'',label:'',expression:'',errorMessage:'',errorFieldApi:null,active:false,sortOrder:0,revision:0};

export default function DeclarativeRulesPanel({objectApi,fields,objects}:{objectApi:string;fields:Field[];objects:ObjectMetadata[]}) {
  const [rules,setRules]=useState<Rule[]>([]);
  const [defaults,setDefaults]=useState<Default[]>([]);
  const [draft,setDraft]=useState<Rule>(initial);
  const [mode,setMode]=useState<'list'|'view'|'edit'>('list');
  const [selectedKind,setSelectedKind]=useState<'rule'|'default'>('rule');
  const [target,setTarget]=useState('');
  const [formula,setFormula]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [history,setHistory]=useState<Array<Record<string,unknown>>>([]);
  const [historyTarget,setHistoryTarget]=useState<{kind:'rule'|'default';apiName:string}|null>(null);
  const base='/metadata/objects/'+encodeURIComponent(objectApi);
  const reload=async()=>{
    const [r,d]=await Promise.all([
      apiRequest<{rules:Rule[]}>(base+'/validation-rules'),
      apiRequest<{defaults:Default[]}>(base+'/default-formulas')
    ]);
    setRules(r.rules);
    setDefaults(d.defaults);
  };
  useEffect(()=>{
    let active=true;
    Promise.all([
      apiRequest<{rules:Rule[]}>(base+'/validation-rules'),
      apiRequest<{defaults:Default[]}>(base+'/default-formulas')
    ]).then(([r,d])=>{if(active){setRules(r.rules);setDefaults(d.defaults);setError('');}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load rules');});
    setDraft(initial);
    setMode('list');
    setTarget('');
    setFormula('');
    setHistory([]);setHistoryTarget(null);
    return ()=>{active=false;};
  },[base]);
  const perform=async(action:()=>Promise<unknown>)=>{
    setBusy(true);setError('');
    try{await action();await reload();setDraft(initial);setMode('list');setHistoryTarget(null);setHistory([]);}
    catch(e){setError(e instanceof Error?e.message:'Unable to save rule');}
    finally{setBusy(false);}
  };
  const saveRule=()=>perform(async()=>{
    if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(draft.apiName))
      throw new Error('Enter a valid rule API name');
    if(!ruleSelected&&metadataNameConflict(draft.apiName,rules.map(rule=>rule.apiName)))throw new Error('Duplicate API Name');
    await apiRequest(base+'/validation-rules/'+encodeURIComponent(draft.apiName),{
      method:'PUT',
      body:JSON.stringify({label:draft.label,expression:draft.expression,
        errorMessage:draft.errorMessage,errorFieldApi:draft.errorFieldApi,
        active:draft.active,sortOrder:draft.sortOrder,revision:draft.revision})
    });
  });
  const loadHistory=async(kind:'rule'|'default',apiName:string)=>{
    setBusy(true);setError('');
    try{
      const route=kind==='rule'?'validation-rules':'default-formulas';
      const data=await apiRequest<{history:Array<Record<string,unknown>>}>(
        base+'/'+route+'/'+encodeURIComponent(apiName)+'/history');
      setHistory(data.history);setHistoryTarget({kind,apiName});
    }catch(e){setError(e instanceof Error?e.message:'Unable to load history');}
    finally{setBusy(false);}
  };
  const writable=fields.filter(f=>!['Formula','Roll-Up Summary','Auto Number','AutoNumber',
    'Text (Encrypted)'].includes(f.dataType)&&!f.dataType.includes('Relationship'));

  const ruleSelected=rules.find(item=>item.apiName===draft.apiName);
  const defaultSelected=defaults.find(item=>item.fieldApi===target);
  const beginRule=(rule?:Rule)=>{
    setSelectedKind('rule');setDraft(rule?{...rule}:initial);setMode(rule?'view':'edit');
    setHistory([]);setHistoryTarget(null);
  };
  const beginDefault=(fieldApi?:string)=>{
    const current=defaults.find(item=>item.fieldApi===fieldApi);
    setSelectedKind('default');setTarget(fieldApi??'');setFormula(current?.expression??'');
    setMode(current?'view':'edit');setHistory([]);setHistoryTarget(null);
  };
  return <section className="surface object-setting-surface">
    <div className="section-toolbar"><div><h2>Validation Rules</h2>
      <p>Control record validation and formula defaults without changing existing rules until Save.</p></div>
      {mode==='list'&&<div className="toolbar-actions">
        <button type="button" className="btn" onClick={()=>beginDefault()}>New Formula Default</button>
        <button type="button" className="btn btn-brand" onClick={()=>beginRule()}>New Rule</button>
      </div>}
    </div>
    {error&&<p role="alert" className="permission-help">{error}</p>}
    {mode==='list'&&<>
      <h3>Rules</h3>
      <div className="table-scroll"><table className="slds-table"><thead>
        <tr><th>Name</th><th>API name</th><th>Status</th><th>Action</th></tr>
      </thead><tbody>{rules.map(rule=><tr key={rule.apiName}>
        <td><button type="button" className="field-link" onClick={()=>beginRule(rule)}>{rule.label}</button></td>
        <td className="api-name">{rule.apiName}</td><td>{rule.active?'Active':'Inactive'}</td>
        <td><button type="button" className="btn" onClick={()=>beginRule(rule)}>View</button></td>
      </tr>)}</tbody></table></div>
      {!rules.length&&<p className="empty-state">No validation rules have been created.</p>}
      <h3>Formula Defaults</h3>
      <div className="table-scroll"><table className="slds-table"><thead>
        <tr><th>Field</th><th>Expression</th><th>Action</th></tr>
      </thead><tbody>{defaults.map(item=><tr key={item.fieldApi}>
        <td><button type="button" className="field-link" onClick={()=>beginDefault(item.fieldApi)}>
          {fields.find(field=>field.apiName===item.fieldApi)?.label??item.fieldApi}</button></td>
        <td>{item.expression}</td><td><button className="btn" type="button"
          onClick={()=>beginDefault(item.fieldApi)}>View</button></td>
      </tr>)}</tbody></table></div>
    </>}
    {mode==='view'&&<div className="metadata-card">
      <div className="section-toolbar"><div><h3>{selectedKind==='rule'?ruleSelected?.label:
        fields.find(field=>field.apiName===target)?.label??target}</h3><p>Read only</p></div>
        <div className="toolbar-actions"><button className="btn" type="button"
          onClick={()=>setMode('list')}>Back to list</button>
          <button className="btn btn-brand" type="button" onClick={()=>setMode('edit')}>Edit</button>
        </div></div>
      {selectedKind==='rule'&&ruleSelected&&<>
        <div className="metadata-row"><span>API name</span><strong>{ruleSelected.apiName}</strong></div>
        <div className="metadata-row"><span>Status</span><strong>{ruleSelected.active?'Active':'Inactive'}</strong></div>
        <div className="metadata-row"><span>Formula</span><strong>{ruleSelected.expression}</strong></div>
        <div className="metadata-row"><span>Error message</span><strong>{ruleSelected.errorMessage}</strong></div>
        <div className="metadata-row"><span>Evaluation order</span><strong>{ruleSelected.sortOrder}</strong></div>
      </>}
      {selectedKind==='default'&&defaultSelected&&
        <div className="metadata-row"><span>Formula</span><strong>{defaultSelected.expression}</strong></div>}
      <div className="toolbar-actions">
        <button className="btn" type="button" disabled={busy} onClick={()=>{
          const kind=selectedKind==='rule'?'rule':'default';
          const name=selectedKind==='rule'?draft.apiName:target;
          void loadHistory(kind,name);
        }}>Version history</button>
        <button className="btn" type="button" disabled={busy} onClick={()=>{
          const name=selectedKind==='rule'?draft.apiName:target;
          if(!window.confirm('Delete '+name+'? This change will affect record validation.'))return;
          if(selectedKind==='rule'&&ruleSelected)void perform(()=>apiRequest(
            base+'/validation-rules/'+encodeURIComponent(name),
            {method:'DELETE',headers:{'If-Match':'"'+ruleSelected.revision+'"'}}));
          if(selectedKind==='default'&&defaultSelected)void perform(()=>apiRequest(
            base+'/default-formulas/'+encodeURIComponent(name),
            {method:'DELETE',headers:{'If-Match':'"'+defaultSelected.revision+'"'}}));
        }}>Delete</button>
      </div>
      {historyTarget&&<div className="metadata-card"><h4>Saved versions</h4>
        {!history.length&&<p>No earlier versions yet.</p>}
        {history.map(version=><div className="metadata-row" key={String(version.revision)}>
          <span>Revision {String(version.revision)}</span>
          <button className="btn" type="button" onClick={()=>{
            if(selectedKind==='rule'&&ruleSelected)setDraft({...ruleSelected,
              label:String(version.label),expression:String(version.expression),
              errorMessage:String(version.errorMessage),
              errorFieldApi:typeof version.errorFieldApi==='string'?version.errorFieldApi:null,
              active:version.active===true,sortOrder:Number(version.sortOrder)});
            if(selectedKind==='default')setFormula(String(version.expression));
            setMode('edit');
          }}>Edit from version</button></div>)}
      </div>}
    </div>}
    {mode==='edit'&&selectedKind==='rule'&&<div className="metadata-card">
      <h3>{ruleSelected?'Edit rule':'New rule'}</h3>
      <label className="form-label">Label<input className="form-control"
        value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value,apiName:ruleSelected||draft.apiName!==generateMetadataApiName(draft.label)?draft.apiName:generateMetadataApiName(e.target.value)})}/></label>
      <details><summary>Advanced: API Name</summary><label className="form-label">Rule API Name<input className="form-control"
        value={draft.apiName} disabled={Boolean(ruleSelected)}
        onChange={e=>setDraft({...draft,apiName:e.target.value})}/></label></details>
      {!ruleSelected&&metadataNameConflict(draft.apiName,rules.map(rule=>rule.apiName))&&
        <p role="alert" className="form-error">API Name already exists.
          <button type="button" className="btn" onClick={()=>setDraft({...draft,apiName:suggestMetadataApiName(draft.apiName,rules.map(rule=>rule.apiName))})}>Use suggested name</button>
        </p>}
      <label className="form-label">Formula (TRUE blocks save)
        <SmartFieldInput multiline rows={3} kind="formula" objects={objects} primaryObjectApiName={objectApi}
          value={draft.expression} onChange={value=>setDraft({...draft,expression:value})}/></label>
      <label className="form-label">Error message<input className="form-control"
        value={draft.errorMessage} onChange={e=>setDraft({...draft,errorMessage:e.target.value})}/></label>
      <label className="form-label">Error location<select className="form-control"
        value={draft.errorFieldApi??''} onChange={e=>setDraft({...draft,errorFieldApi:e.target.value||null})}>
        <option value="">Top of form</option>
        {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
      </select></label>
      <label className="form-label">Evaluation order<input type="number" className="form-control"
        value={draft.sortOrder} onChange={e=>setDraft({...draft,sortOrder:Number(e.target.value)})}/></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.active}
        onChange={e=>setDraft({...draft,active:e.target.checked})}/>Active</label>
      <div className="toolbar-actions"><button className="btn" type="button"
        onClick={()=>{setMode(ruleSelected?'view':'list');if(ruleSelected)setDraft(ruleSelected);}}>Cancel</button>
        <button className="btn btn-brand" type="button"
          disabled={busy||!draft.label.trim()||!draft.expression.trim()||!draft.errorMessage.trim()}
          onClick={saveRule}>Save rule</button>
      </div>
    </div>}
    {mode==='edit'&&selectedKind==='default'&&<div className="metadata-card">
      <h3>{defaultSelected?'Edit Formula Default':'New Formula Default'}</h3>
      <label className="form-label">Target field<select className="form-control"
        value={target} onChange={e=>{setTarget(e.target.value);setFormula(defaults.find(x=>x.fieldApi===e.target.value)?.expression??'');}}>
        <option value="">Select field</option>
        {writable.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
      </select></label>
      <label className="form-label">Default formula
        <SmartFieldInput multiline rows={3} kind="formula" objects={objects} primaryObjectApiName={objectApi}
          value={formula} onChange={setFormula}/></label>
      <div className="toolbar-actions"><button className="btn" onClick={()=>setMode(defaultSelected?'view':'list')}>Cancel</button>
        <button type="button" className="btn btn-brand" disabled={busy||!target||!formula.trim()}
          onClick={()=>perform(()=>apiRequest(base+'/default-formulas/'+encodeURIComponent(target),{
            method:'PUT',body:JSON.stringify({expression:formula,
              revision:defaults.find(item=>item.fieldApi===target)?.revision??0})}))}>Save default</button>
      </div>
    </div>}
  </section>;
}

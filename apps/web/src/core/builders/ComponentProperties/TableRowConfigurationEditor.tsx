import type {ObjectMetadata} from '../../metadata/Definitions/metadata';

type RowAction={event:string;label:string;field?:string;title?:string};
type Props={
  properties:Record<string,unknown>;
  object?:ObjectMetadata;
  onChange:(next:Record<string,unknown>)=>void;
};
const valid=/^[A-Za-z][A-Za-z0-9_]*$/;

/** Metadata-only table columns and row buttons. No business-specific action logic. */
export default function TableRowConfigurationEditor({properties,object,onChange}:Props){
  const fields=object?.fields??[];
  const rawColumns=Array.isArray(properties.columns)?properties.columns:[];
  const columns=rawColumns.filter((value):value is string=>typeof value==='string');
  const rawActions=Array.isArray(properties.rowActions)?properties.rowActions:[];
  const actions=rawActions.filter((value):value is RowAction=>Boolean(value)
    &&typeof value==='object'&&!Array.isArray(value)&&typeof value.event==='string'
    &&typeof value.label==='string');
  const saveColumns=(next:string[])=>onChange({...properties,columns:next});
  const saveActions=(next:RowAction[])=>onChange({...properties,rowActions:next});
  const action=(index:number,patch:Partial<RowAction>)=>
    saveActions(actions.map((item,i)=>i===index?{...item,...patch}:item));
  const addAction=()=>{
    const used=new Set(actions.map(item=>item.event));
    let n=1;
    while(used.has('rowAction'+n))n++;
    const event='rowAction'+n;
    const rawBindings=properties.actionFlows;
    const bindings=rawBindings&&typeof rawBindings==='object'&&!Array.isArray(rawBindings)
      ?rawBindings as Record<string,unknown>:{};
    onChange({...properties,rowActions:[...actions,{event,label:'Action'}],
      actionFlows:{...bindings,...(bindings[event]?{}:{[event]:{actionType:'Flow',flowApiName:'',inputs:{}}})}});
  };
  return <section className="metadata-table-row-editor" aria-label="Table columns and row actions">
    <div className="properties-section-title">Table columns</div>
    <p className="properties-help">Choose fields and their display order. Leave empty to use the available record fields.</p>
    {columns.map((name,index)=><div key={index} className="flow-config-row">
      <select className="form-control" aria-label={'Table column '+(index+1)}
        value={name} onChange={event=>saveColumns(columns.map((item,i)=>i===index?event.target.value:item))}>
        <option value="">Choose field</option>
        {name==='Id'&&<option value="Id">Record ID</option>}
        {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
        {name&&!fields.some(field=>field.apiName===name)&&name!=='Id'
          &&<option value={name} disabled>Missing: {name}</option>}
      </select>
      <button type="button" className="btn btn-small" aria-label={'Move table column '+(index+1)+' up'}
        disabled={index===0} onClick={()=>{const next=[...columns];[next[index-1],next[index]]=[next[index],next[index-1]];saveColumns(next);}}>↑</button>
      <button type="button" className="btn btn-small" aria-label={'Move table column '+(index+1)+' down'}
        disabled={index===columns.length-1} onClick={()=>{const next=[...columns];[next[index+1],next[index]]=[next[index],next[index+1]];saveColumns(next);}}>↓</button>
      <button type="button" className="btn btn-small" onClick={()=>saveColumns(columns.filter((_,i)=>i!==index))}>Remove</button>
    </div>)}
    <button type="button" className="btn btn-small" disabled={!fields.length}
      onClick={()=>saveColumns([...columns,fields.find(field=>!columns.includes(field.apiName))?.apiName??fields[0].apiName])}>
      Add column
    </button>
    <div className="properties-section-title">Row action buttons</div>
    <p className="properties-help">Each action sends the current row to a configured event → Flow binding.
      Place buttons alongside a field (for example, Quantity), or in an Actions column.
      The Flow receives the row ID as an Event property named Id.</p>
    {actions.map((item,index)=><div className="home-page-assignment" key={index}>
      <label className="form-label">Button text
        <input className="form-control" value={item.label} maxLength={32}
          onChange={event=>action(index,{label:event.target.value})}/>
      </label>
      <label className="form-label">Event name
        <input className="form-control" value={item.event} aria-invalid={!valid.test(item.event)}
          readOnly title="Flow event names are stable. Remove and add an action to change its name."/>
      </label>
      <label className="form-label">Place beside field
        <select className="form-control" value={item.field??''}
          onChange={event=>action(index,{field:event.target.value})}>
          <option value="">Separate Actions column</option>
          {columns.map(name=><option key={name} value={name}>{fields.find(f=>f.apiName===name)?.label??name}</option>)}
        </select>
      </label>
      <label className="form-label">Accessible tooltip
        <input className="form-control" value={item.title??''}
          onChange={event=>action(index,{title:event.target.value})}/>
      </label>
      {!valid.test(item.event)&&<p className="auth-error">Choose a valid event name.</p>}
      <button type="button" className="btn btn-small" onClick={()=>saveActions(actions.filter((_,i)=>i!==index))}>Remove action</button>
    </div>)}
    <button type="button" className="btn btn-small" onClick={addAction}>Add row action</button>
    {actions.length>0&&<p className="properties-help">Open Event → Flow bindings to choose an Active Flow
      for each action. Event property Id is the clicked row's record ID.</p>}
  </section>;
}

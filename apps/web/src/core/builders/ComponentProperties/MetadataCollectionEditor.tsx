import type {ComponentSettingDefinition} from '../../components/Properties/componentSettingDefinitions';
import type {FieldMetadata} from '../../metadata/Definitions/metadata';

/** Shared no-code editor for metadata COLLECTION properties and their declared row fields.
 * Every edit writes the same property shape that the Property Engine validates and persists.
 * This component has no app-specific field names or runtime handlers. */
export default function MetadataCollectionEditor({
  definition, value, fields, onChange
}: {
  definition:ComponentSettingDefinition;
  value:unknown;
  fields:readonly FieldMetadata[];
  onChange:(next:Record<string,unknown>[])=>void;
}) {
  const entries=Array.isArray(value)?value.filter((entry):entry is Record<string,unknown> =>
    Boolean(entry)&&typeof entry==='object'&&!Array.isArray(entry)):[];
  const rowDefinitions=definition.fields??[];
  const update=(index:number,key:string,next:unknown)=>onChange(entries.map((entry,i)=>
    i===index?{...entry,[key]:next}:entry));
  const createRow=()=>Object.fromEntries(rowDefinitions.map(field=>[field.propertyKey,
    field.defaultValue??(field.kind==='BOOLEAN'?false:field.kind==='NUMBER'?0:'')]));
  const move=(index:number,direction:-1|1)=>{
    const target=index+direction;
    if(target<0||target>=entries.length)return;
    const next=[...entries];[next[index],next[target]]=[next[target],next[index]];
    onChange(next);
  };
  return <section className="metadata-collection-editor" aria-label={definition.label}>
    <div className="properties-section-title">{definition.label}</div>
    {definition.helpText&&<p className="properties-help">{definition.helpText}</p>}
    {entries.length===0&&<p className="properties-help">No items. Add one to configure its content.</p>}
    {entries.map((entry,index)=><div className="home-page-assignment metadata-collection-row" key={index}>
      <div className="row" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
        <strong>{definition.label} {index+1}</strong>
        <div className="row" style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          <button type="button" className="btn btn-small" disabled={index===0}
            onClick={()=>move(index,-1)} aria-label={'Move item '+(index+1)+' up'}>Move up</button>
          <button type="button" className="btn btn-small" disabled={index===entries.length-1}
            onClick={()=>move(index,1)} aria-label={'Move item '+(index+1)+' down'}>Move down</button>
          <button type="button" className="btn btn-small" onClick={()=>onChange(entries.filter((_,i)=>i!==index))}
            aria-label={'Remove item '+(index+1)}>Remove</button>
        </div>
      </div>
      <div className="metadata-collection-fields">
        {rowDefinitions.map(field=>{
          const key=field.propertyKey;
          const selected=entry[key];
          const label=field.label||key;
          if(field.kind==='OBJECT_FIELD')return <label key={key} className="form-label">{label}
            <select className="form-control" aria-label={label+' for item '+(index+1)}
              value={String(selected??'')} onChange={event=>update(index,key,event.target.value)}>
              <option value="">Choose a field…</option>
              {Boolean(selected)&&!fields.some(candidate=>candidate.apiName===selected)
                &&<option value={String(selected)} disabled>Unavailable: {String(selected)}</option>}
              {fields.map(field=><option key={field.apiName} value={field.apiName}>
                {field.label}</option>)}
            </select>
          </label>;
          if(field.kind==='SELECT'&&field.choices?.length)return <label key={key} className="form-label">{label}
            <select className="form-control" aria-label={label+' for item '+(index+1)}
              value={String(selected??'')} onChange={event=>update(index,key,event.target.value)}>
              <option value="">Choose…</option>
              {field.choices.map(choice=><option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </select>
          </label>;
          if(field.kind==='BOOLEAN')return <label key={key} className="checkbox-row">
            <input type="checkbox" checked={selected===true}
              onChange={event=>update(index,key,event.target.checked)}/>{label}
          </label>;
          return <label key={key} className="form-label">{label}
            <input className="form-control" aria-label={label+' for item '+(index+1)}
              type={field.kind==='NUMBER'||field.kind==='CURRENCY'?'number':'text'}
              value={typeof selected==='number'||typeof selected==='string'?selected:''}
              min={field.min} max={field.max} maxLength={field.maxLength}
              onChange={event=>update(index,key,field.kind==='NUMBER'||field.kind==='CURRENCY'
                ?Number(event.target.value):event.target.value)}/>
          </label>;
        })}
      </div>
    </div>)}
    <button type="button" className="btn btn-small" disabled={entries.length>=(definition.maxItems??500)}
      onClick={()=>onChange([...entries,createRow()])}>Add {definition.label.toLowerCase().replace(/s$/,'')}</button>
  </section>;
}

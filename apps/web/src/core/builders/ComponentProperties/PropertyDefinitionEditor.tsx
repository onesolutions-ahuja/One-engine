import {propertyKinds,validateComponentDefinitions,type ComponentSettingDefinition,type PropertyDevice} from '../../components/Properties/componentSettingDefinitions';
import {pageBehaviorSchemas} from '../../components/Properties/pagePropertyContract';
import CustomComponentPropertyEditor from './CustomComponentPropertyEditor';
/** Schema authoring uses the same recursive definitions as instance editing. */
export default function PropertyDefinitionEditor({value,onChange,depth=0}:{
 value:ComponentSettingDefinition[];onChange:(next:ComponentSettingDefinition[])=>void;depth?:number;
}){
 const patch=(index:number,change:Partial<ComponentSettingDefinition>)=>onChange(value.map((d,i)=>i===index?{...d,...change}:d));
 return <section aria-label="Property definitions">
  {value.map((d,index)=><fieldset className="metadata-array-property" key={index}>
   <legend>{d.label||'Property '+(index+1)}</legend>
   <label className="form-label">Property API name<input className="form-control" value={d.propertyKey} onChange={e=>patch(index,{propertyKey:e.target.value})}/></label>
   <label className="form-label">Property label<input className="form-control" value={d.label} onChange={e=>patch(index,{label:e.target.value})}/></label>
   <label className="form-label">Property type<select className="form-control" value={d.kind} onChange={e=>{
    const kind=e.target.value as ComponentSettingDefinition['kind'];
    patch(index,{kind,defaultValue:undefined,fields:kind==='GROUP'||kind==='COLLECTION'?[]:undefined,
     choices:kind==='SELECT'?[{key:'option',label:'Option'}]:undefined});
   }}>{propertyKinds.filter(k=>depth<5||!['GROUP','COLLECTION'].includes(k)).map(k=><option key={k}>{k}</option>)}</select></label>
   <label className="checkbox-row"><input type="checkbox" checked={d.required===true} onChange={e=>patch(index,{required:e.target.checked})}/>Required</label>
   <label className="checkbox-row"><input type="checkbox" checked={d.isBindable===true} onChange={e=>patch(index,{isBindable:e.target.checked})}/>Allow data binding</label>
   <label className="form-label">Help text<input className="form-control" value={d.helpText??''} onChange={e=>patch(index,{helpText:e.target.value})}/></label>
   <label className="form-label">Available from component version<input className="form-control" type="number" min={1} value={d.sinceVersion??''}
     onChange={e=>patch(index,{sinceVersion:e.target.value?Number(e.target.value):undefined})}/></label>
   <fieldset><legend>Devices (none selected means all)</legend>{(['Mobile','Desktop','Tablet','Custom'] as PropertyDevice[]).map(device=><label className="checkbox-row" key={device}>
    <input type="checkbox" checked={d.devices?.includes(device)??false} onChange={e=>{
     const devices=e.target.checked?[...(d.devices??[]),device]:(d.devices??[]).filter(x=>x!==device);
     patch(index,{devices:devices.length?devices:undefined});
    }}/>{device}</label>)}</fieldset>
   {(d.kind==='NUMBER'||d.kind==='CURRENCY')&&(['min','max'] as const).map(key=><label className="form-label" key={key}>{key==='min'?'Minimum':'Maximum'}
    <input className="form-control" type="number" value={d[key]??''} onChange={e=>patch(index,{[key]:e.target.value?Number(e.target.value):undefined})}/></label>)}
   {['COLLECTION','STRING_LIST','FIELD_LIST','COLUMNS','OPTIONS','RECORD_LIST'].includes(d.kind)&&(['minItems','maxItems'] as const).map(key=><label className="form-label" key={key}>{key==='minItems'?'Minimum rows':'Maximum rows'}
    <input className="form-control" type="number" min={0} max={500} value={d[key]??''} onChange={e=>patch(index,{[key]:e.target.value?Number(e.target.value):undefined})}/></label>)}
   {['TEXT','COLOR','IMAGE','OBJECT','OBJECT_FIELD','FLOW','STRING_LIST'].includes(d.kind)&&<label className="form-label">Maximum text length
    <input className="form-control" type="number" min={0} max={20000} value={d.maxLength??''} onChange={e=>patch(index,{maxLength:e.target.value?Number(e.target.value):undefined})}/></label>}
   {d.kind==='SELECT'&&<fieldset><legend>Choices</legend>{(d.choices??[]).map((c,i)=><div className="flow-config-row" key={i}>
    <input className="form-control" aria-label="Choice value" value={c.key} onChange={e=>patch(index,{choices:d.choices!.map((x,j)=>i===j?{...x,key:e.target.value}:x)})}/>
    <input className="form-control" aria-label="Choice label" value={c.label} onChange={e=>patch(index,{choices:d.choices!.map((x,j)=>i===j?{...x,label:e.target.value}:x)})}/>
    <button type="button" className="btn btn-small" onClick={()=>patch(index,{choices:d.choices!.filter((_,j)=>i!==j)})}>Remove choice</button>
   </div>)}<button type="button" className="btn btn-small" onClick={()=>patch(index,{choices:[...(d.choices??[]),{key:'',label:''}]})}>Add choice</button></fieldset>}
   {(d.kind==='GROUP'||d.kind==='COLLECTION')&&depth<6&&<PropertyDefinitionEditor value={[...(d.fields??[])]} depth={depth+1} onChange={fields=>patch(index,{fields})}/>}
   <details><summary>Default value</summary><CustomComponentPropertyEditor
    idPrefix={'schema-'+depth+'-'+index} definitions={[{...d,required:false}]} properties={d.defaultValue===undefined?{}:{[d.propertyKey]:d.defaultValue}}
    onChange={next=>patch(index,{defaultValue:next[d.propertyKey] as ComponentSettingDefinition['defaultValue']})}/></details>
   <button type="button" className="btn btn-small" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Remove property</button>
  </fieldset>)}
  <button type="button" className="btn btn-small" disabled={value.length>=500} onClick={()=>{
   let n=value.length+1;while(value.some(d=>d.propertyKey==='setting'+n))n++;
   onChange([...value,{propertyKey:'setting'+n,label:'Setting '+n,kind:'TEXT',schemaVersion:1}]);
  }}>Add property</button>
  {depth===0&&<label className="form-label">Add shared behaviour schema
   <select className="form-control" value="" onChange={e=>{
    const selected=pageBehaviorSchemas[e.target.value];
    if(selected&&!value.some(d=>d.propertyKey===selected.propertyKey))onChange([...value,{...structuredClone(selected),schemaVersion:1}]);
   }}><option value="">Choose a schema…</option>{Object.values(pageBehaviorSchemas).map(d=><option key={d.propertyKey} value={d.propertyKey} disabled={value.some(x=>x.propertyKey===d.propertyKey)}>{d.label}</option>)}</select>
   <small>Schema templates define configuration. The component renderer must support the selected behaviour.</small>
  </label>}
  {validateComponentDefinitions(value).map((issue,i)=><p key={i} role="alert">{issue.path}: {issue.message}</p>)}
 </section>;
}

import type {ComponentSettingDefinition} from '../../components/Properties/componentSettingDefinitions';
type Props={
  properties:Record<string,unknown>;
  definitions?:readonly ComponentSettingDefinition[];
  onChange:(next:Record<string,unknown>)=>void;
};
const valid=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const blocked=new Set(['objectApiName','actionFlows','columns','rowActions',
  'stateBindings','filters','sessionId','records','onAction','onChange','children','key','ref']);
/** Page state is populated by declared Flow outputs; map display properties without code. */
export default function PageStatePropertyBindingsEditor({properties,onChange,definitions=[]}:Props){
  const raw=properties.stateBindings;
  const bindings=raw&&typeof raw==='object'&&!Array.isArray(raw)
    ?raw as Record<string,unknown>:{};
  const entries=Object.entries(bindings).filter(([key,value])=>valid.test(key)
    &&!blocked.has(key)&&typeof value==='string');
  const targets=Array.from(new Set(['value','subtitle','title','label',
     ...(typeof properties.objectApiName==='string'||'items' in properties||'items' in bindings?['items']:[]),
     ...definitions.filter(def=>!blocked.has(def.propertyKey)
       && ['RECORD_LIST','TEXT','NUMBER','BOOLEAN','SELECT','COLOR'].includes(def.kind)).map(def=>def.propertyKey),
    ...Object.entries(properties).filter(([key,value])=>valid.test(key)
      &&!blocked.has(key)&&(['string','number','boolean'].includes(typeof value)||Array.isArray(value))).map(([key])=>key)]));
  const update=(items:string[][])=>onChange({...properties,stateBindings:
    Object.fromEntries(items.filter(([target,key])=>valid.test(target)&&!blocked.has(target)&&valid.test(key)))});
  return <section className="metadata-state-bindings" aria-label="Page state property bindings">
    <div className="properties-section-title">Flow output → component property</div>
    <p className="properties-help">Bind a display property to a page state key updated by a Flow output.
      A missing key uses the component's configured default value.</p>
    {entries.map(([target,key],index)=><div className="flow-config-row" key={target}>
      <label className="form-label">Property
        <select className="form-control" value={target}
          onChange={event=>update(entries.map((entry,i)=>i===index?[event.target.value,String(entry[1])]:[entry[0],String(entry[1])] ))}>
          {targets.map(option=><option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="form-label">Page state key
        <input className="form-control" value={String(key)}
          onChange={event=>update(entries.map((entry,i)=>i===index?[entry[0],event.target.value]:[entry[0],String(entry[1])]))}
          placeholder="CartTotal" />
      </label>
      <button type="button" className="btn btn-small"
        onClick={()=>update(entries.filter((_,i)=>i!==index).map(([a,b])=>[a,String(b)]))}>Remove</button>
    </div>)}
    <button type="button" className="btn btn-small" onClick={()=>{
      const target=targets.find(name=>!entries.some(([t])=>t===name));
      if(target)update([...entries.map(([a,b])=>[a,String(b)] as [string,string]),[target,'NewStateKey']]);
    }}>Add property binding</button>
  </section>;
}

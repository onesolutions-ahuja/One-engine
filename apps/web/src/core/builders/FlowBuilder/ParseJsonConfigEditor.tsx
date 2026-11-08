import {useId,useMemo,useState} from 'react';
import type {FlowResourceMetadata} from '../../metadata/Definitions/metadata';
import {jsonSampleScalarPaths} from './jsonSampleScalarPaths';

type Mapping={path:string;outputVariable:string};
type Props={
 config:Record<string,unknown>;
 resources:FlowResourceMetadata[];
 onChange:(name:string,value:unknown)=>void;
};
const mappings=(value:unknown):Mapping[]=>Array.isArray(value)
 ?value.filter((item):item is Mapping=>Boolean(item&&typeof item==='object'
  &&!Array.isArray(item))).map(item=>({
   path:typeof item.path==='string'?item.path:'',
   outputVariable:typeof item.outputVariable==='string'?item.outputVariable:''
  })).slice(0,50):[];

/** Visual editor for the existing shared Parse JSON runtime; no raw configuration editing. */
export default function ParseJsonConfigEditor({config,resources,onChange}:Props){
 const [example,setExample]=useState('');
 const id=useId();
 const result=useMemo(()=>{
  try{return {paths:jsonSampleScalarPaths(example),error:''};}
  catch(error){return {paths:[] as string[],error:error instanceof Error?error.message:'Invalid example'};}
 },[example]);
 const selected=mappings(config.assignments);
 const source=typeof config.source==='string'?config.source:'';
 const eligible=resources.filter(item=>item.type==='Variable'
  &&!item.isCollection&&['Text','Number','Checkbox','Boolean','Date','DateTime'].includes(item.dataType));
 const sources=resources.filter(item=>['Variable','Text Template'].includes(item.type)
  &&!item.isCollection&&item.dataType==='Text');
 const update=(index:number,name:keyof Mapping,value:string)=>{
  onChange('assignments',selected.map((item,i)=>i===index?{...item,[name]:value}:item));
 };
 return <section className="flow-config-list" aria-label="Parse incoming JSON">
  <label className="form-label">JSON input
   <select className="form-control" value={source} onChange={event=>onChange('source',event.target.value)}>
    <option value="">Choose a Text Flow resource</option>
    {sources.map(item=><option key={item.name} value={'@'+item.name}>
     {item.label||item.name} ({item.name})</option>)}
   </select>
  </label>
  <p className="settings-panel-copy">The webhook or HTTP response must be stored in a Text resource. Mapped values are available to the next Flow actions.</p>
  <details>
   <summary>Discover fields from an example payload (optional)</summary>
   <label className="form-label">Example JSON (used only while editing)
    <textarea className="form-control" rows={5} value={example}
     onChange={event=>setExample(event.target.value)} placeholder="Paste an example to choose fields from a list"/>
   </label>
   {result.error&&<p role="alert">{result.error}</p>}
  </details>
  <div className="flow-config-list">
   <strong>Field mappings</strong>
   {selected.map((mapping,index)=><div className="metadata-card" key={index}>
    <label className="form-label">Incoming field path
     <input className="form-control" list={id+'-paths'} value={mapping.path}
      onChange={event=>update(index,'path',event.target.value)}
      placeholder="Select an example field or enter a field path" />
    </label>
    <label className="form-label">Store value in
     <select className="form-control" value={mapping.outputVariable}
      onChange={event=>update(index,'outputVariable',event.target.value)}>
      <option value="">Choose a Flow variable</option>
      {eligible.map(item=><option key={item.name} value={item.name}>{item.label||item.name} ({item.name})</option>)}
     </select>
    </label>
    <button type="button" className="btn btn-small" onClick={()=>onChange('assignments',selected.filter((_,i)=>i!==index))}>
     Remove mapping
    </button>
   </div>)}
   <datalist id={id+'-paths'}>{result.paths.map(path=><option key={path} value={path}/>)}</datalist>
   <button type="button" className="btn" disabled={selected.length>=50}
    onClick={()=>onChange('assignments',[...selected,{path:'',outputVariable:''}])}>
    Add field mapping
   </button>
   {!eligible.length&&<p className="settings-panel-copy">Create a Text, Number or Checkbox Variable in Flow Resources first.</p>}
  </div>
 </section>;
}

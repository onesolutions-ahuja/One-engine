import {useEffect,useMemo,useState} from 'react';
import type {FlowDefinitionMetadata,FieldMetadata} from '../../metadata/Definitions/metadata';
import {decodeInputSource,encodeInputSource,declaredFlowInputs,declaredFlowOutputs,mappedInputNames,sessionInputFields,
 type InputSourceKind} from '../../automation/FlowScreen/flowInputBindings';

const kinds:Array<{value:Exclude<InputSourceKind,'Legacy'>;label:string}>=[
 {value:'Unmapped',label:'Not mapped'},
 {value:'Event Field',label:'Event property'},
 {value:'Event',label:'Entire event payload'},
 {value:'Record Field',label:'Record field'},
 {value:'Page State',label:'Page State / Flow output'},
 {value:'Numeric Page State',label:'Numeric page state'},
 {value:'Record Collection',label:'Record collection'},
 {value:'Session',label:'Current session'},
 {value:'Literal',label:'Fixed value'}
];
type Resource={name:string;label?:string;dataType:string};
/** Compact two-row presentation over the existing typed Flow mapping format.
 * All declared variables remain accessible by selection, including old saved
 * mappings. No automatic guessing of tenant business IDs or silent overrides. */
export default function CompactActionFlowBindings({
 flow,enabled,inputs,outputs,fields,onInputsChange,onOutputsChange
}:{
 flow?:FlowDefinitionMetadata;enabled:boolean;
 inputs:Record<string,unknown>;outputs:Record<string,unknown>;
 fields:FieldMetadata[];onInputsChange:(value:Record<string,unknown>)=>void;
 onOutputsChange:(value:Record<string,unknown>)=>void;
}) {
 const resources=useMemo(()=>declaredFlowInputs(flow),[flow]);
 const outputsAvailable=useMemo(()=>declaredFlowOutputs(flow),[flow]);
 const names=mappedInputNames(flow,inputs);
 const [inputName,setInputName]=useState('');
 const [outputName,setOutputName]=useState('');
 const [pendingKind,setPendingKind]=useState<InputSourceKind|null>(null);
 const [error,setError]=useState('');
 const chosenInput=names.includes(inputName)?inputName:names[0]??'';
 const chosenOutput=outputsAvailable.some(item=>item.name===outputName)
   ?outputName:outputsAvailable[0]?.name??'';
 const resource=(resources as Resource[]).find(item=>item.name===chosenInput);
 const selected=decodeInputSource(inputs[chosenInput],
   Object.prototype.hasOwnProperty.call(inputs,chosenInput));
 const kind=pendingKind??selected.kind;
 useEffect(()=>{setPendingKind(null);setError('');},[chosenInput,flow?.apiName]);
 const write=(valueKind:Exclude<InputSourceKind,'Legacy'>,detail:string)=>{
   if(!enabled||!chosenInput)return;
   try{
     const encoded=encodeInputSource(valueKind,detail,fields,resource?.dataType);
     const next={...inputs};
     if(valueKind==='Unmapped')delete next[chosenInput];else next[chosenInput]=encoded;
     onInputsChange(next);setPendingKind(null);setError('');
   }catch(e){setError(e instanceof Error?e.message:'Invalid Flow mapping');}
 };
 const changeKind=(next:InputSourceKind)=>{
   if(next==='Legacy')return;
   if(next==='Session'){write(next,'id');return;}
    if(next==='Unmapped'||next==='Event'){
     write(next,'');return;
   }
   if(next==='Record Field'&&fields.length){write(next,fields[0].apiName);return;}
   setPendingKind(next);setError('');
 };
 const updateOutput=(next:string)=>{
   if(!enabled||!chosenOutput||next&&!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(next))return;
   const mapped={...outputs};
   if(next)mapped[chosenOutput]=next;else delete mapped[chosenOutput];
   onOutputsChange(mapped);
 };
 const outputTarget=typeof outputs[chosenOutput]==='string'?String(outputs[chosenOutput]):'';
 return <>
   <section className="page-action-compact-group page-action-compact-flow" aria-label="Flow inputs">
     <div className="page-action-compact-rows">
       <label className="page-action-compact-mapping"><span>Input</span>
         <select aria-label="Flow input variable" value={chosenInput} disabled={!enabled||!names.length}
           onChange={event=>{setInputName(event.target.value);setPendingKind(null);}}>
           {!chosenInput&&<option value="">Select variable…</option>}
           {names.map(name=><option value={name} key={name}>{resources.find(item=>item.name===name)?.label??name}</option>)}
         </select>
       </label>
       <label className="page-action-compact-mapping"><span>Source</span>
         <select aria-label="Flow input source" disabled={!enabled||!chosenInput}
           value={kind} onChange={event=>changeKind(event.target.value as InputSourceKind)}>
           {kinds.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}
           {kind==='Legacy'&&<option value="Legacy">Saved legacy value</option>}
         </select>
       </label>
       <label className="page-action-compact-mapping"><span>Value</span>
         {kind==='Record Field'?<select aria-label="Flow input record field"
           value={selected.kind==='Record Field'?selected.detail:''}
           disabled={!enabled||!chosenInput||!fields.length}
           onChange={event=>write('Record Field',event.target.value)}>
           <option value="">Choose field…</option>
           {fields.map(field=><option key={field.apiName} value={field.apiName}>{field.label}</option>)}
         </select>:
         kind==='Session'?<select aria-label="Flow input session field"
           disabled={!enabled||!chosenInput}
           value={selected.kind==='Session'?selected.detail||'id':'id'}
           onChange={event=>write('Session',event.target.value)}>
           {sessionInputFields.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}
         </select>:
         <input aria-label="Flow input value" type="text" disabled={!enabled||!chosenInput||
           ['Unmapped','Session','Event','Legacy'].includes(kind)}
           placeholder={kind==='Event Field'?'item.id':kind==='Page State'?'cartId':
             kind==='Record Collection'?'cartItems:Quantity,Price':kind==='Legacy'?'Existing mapping':'Value'}
           value={pendingKind?'':(['Unmapped','Session','Event'].includes(kind)?'':selected.detail)}
           onChange={event=>write(kind as Exclude<InputSourceKind,'Legacy'>,event.target.value)}/>}
       </label>
     </div>
     <span className="page-action-section-caption">Flow inputs</span>
     {error&&<span className="page-action-mapping-error" role="alert">{error}</span>}
   </section>
   <section className="page-action-compact-group page-action-compact-outputs" aria-label="Flow outputs">
     <div className="page-action-compact-rows">
       <label className="page-action-compact-mapping"><span>Output</span>
         <select aria-label="Flow output variable" disabled={!enabled||!outputsAvailable.length}
           value={chosenOutput} onChange={event=>setOutputName(event.target.value)}>
           {!chosenOutput&&<option value="">Select variable…</option>}
           {outputsAvailable.map(item=><option value={item.name} key={item.name}>{item.label??item.name}</option>)}
         </select>
       </label>
       <label className="page-action-compact-mapping"><span>Page State</span>
         <input aria-label="Flow output Page State target" type="text" value={outputTarget}
           placeholder="Automatic if same name" disabled={!enabled||!chosenOutput}
           onChange={event=>updateOutput(event.target.value)}/>
       </label>
     </div>
     <span className="page-action-section-caption">Flow outputs</span>
   </section>
 </>;
}

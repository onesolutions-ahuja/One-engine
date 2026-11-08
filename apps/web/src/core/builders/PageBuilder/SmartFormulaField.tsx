import {actionArgumentSuggestions} from './actionArgumentSuggestions';
import {isScreenAction,parseScreenAction,compileActionPlan,isActionPlan,normalizeFlowCalls} from '../../../../../server/src/expression-engine/ActionFormulas.js';
import {usePageFormulaScope} from '../../components/RegisteredComponent/PageFormulaScope';
import {useState,useRef,useEffect,useLayoutEffect,useId,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {relationshipFormulaFields} from './relationshipFormulaFields';
import {formulaDollarSuggestions} from './formulaDollarSuggestions';
import {formulaSignatureAt} from './formulaSignatureHelp';
import {Parser} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {formulaFunctionPrefix,matchingFormulaFunctions,getFormulaNamesForEditor,validateFormulaFunctions} from '../../../../../server/src/expression-engine/FormulaFunctionRegistry.js';
import type {MentionKind} from '../../../component-libraries/shared/primitives/SmartFieldInput/smartFieldMentions';
// Styles are loaded by the Page Builder entrypoint so this reusable editor
// can also render in lightweight server-side ribbon contract tests.
/** Presentation tokenizer; the shared bounded expression evaluator owns semantics.
 * Quoted operators (+ - * / &) and @names are literal strings, never formulas.
 */
export function splitSmartFormula(value:string){
 const parts:{value:string;kind:'field'|'string'|'operator'|'text'}[]=[];
 const token=/("(?:[^"]|"")*"|@[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*|\$component(?:\.[A-Za-z_][A-Za-z0-9_]*){1,2}|\$state\.[A-Za-z][A-Za-z0-9_]*|\$flow\.[A-Za-z][A-Za-z0-9_]*|\$session(?:\.[A-Za-z][A-Za-z0-9_]*){0,2}|[+*\/&-])/g;
 let cursor=0;let match:RegExpExecArray|null;
 while((match=token.exec(value))){
  if(match.index>cursor)parts.push({value:value.slice(cursor,match.index),kind:'text'});
  parts.push({value:match[0],kind:match[0].startsWith('"')?'string':
   (match[0].startsWith('@')||match[0].startsWith('$'))?'field':'operator'});
  cursor=match.index+match[0].length;
 }
 if(cursor<value.length)parts.push({value:value.slice(cursor),kind:'text'});
 return parts;
}
function tokenEndsInComponentPrefix(source:string){
 return /\$component(?:\.[A-Za-z_][A-Za-z0-9_]*)?\.$/.test(source);
}
export default function SmartFormulaField({value,onChange,fields,disabled,label,objects=[],rootObjectApiName='',singleFieldOnly=false,selectedSourceObjects,mentionKind='text',validate,stateOptions=[],flowReferences,actionPages=[],actionCredentials=[]}:{
 value:string;onChange:(next:string)=>void;fields:readonly FieldMetadata[];disabled:boolean;label:string;
 objects?:readonly ObjectMetadata[];rootObjectApiName?:string;singleFieldOnly?:boolean;selectedSourceObjects?:readonly ObjectMetadata[];mentionKind?:MentionKind;
 validate?:(formula:string)=>string|null;
 stateOptions?:readonly {source:'PageState'|'CollectionState';key:string;label:string}[];
 /** Action formula bar only: runnable Flows offered as $flow.ApiName. Omitted
  * everywhere else, so normal formula bars never suggest or accept $flow. */
 actionPages?:readonly {apiName:string;label:string;pageType:string;status:string}[];
 actionCredentials?:readonly {apiName:string;label:string}[];
 flowReferences?:readonly {apiName:string;label:string}[]
}){
 const scope=usePageFormulaScope();
 const input=useRef<HTMLInputElement>(null);
 const [draft,setDraft]=useState(value);
 const [validationError,setValidationError]=useState<string|null>(null);
 useEffect(()=>{setDraft(value);setValidationError(null)},[value]);
 const [matches,setMatches]=useState<{start:number;end:number;query:string;prefix:'@'|'$'|''}|null>(null);
 const [popup,setPopup]=useState<{top:number;left:number;width:number;above:boolean}|null>(null);
 const [caret,setCaret]=useState(value.length);
 const [focused,setFocused]=useState(false);
 const [confirmIncomplete,setConfirmIncomplete]=useState(false);
 const [functionMatch,setFunctionMatch]=useState<{start:number;end:number;query:string}|null>(null);
 const [activeSuggestion,setActiveSuggestion]=useState(0);
 const suggestionListId=useId();
 useEffect(()=>setActiveSuggestion(0),[matches?.query,functionMatch?.query]);
 const functions=getFormulaNamesForEditor(flowReferences?'action':'data');
 const functionSuggestions=functionMatch?matchingFormulaFunctions(functions,functionMatch.query):[];
 const [hintPosition,setHintPosition]=useState<{top:number;left:number;above:boolean}|null>(null);
 const hint=focused?formulaSignatureAt(draft,caret,Boolean(flowReferences)):null;
 useLayoutEffect(()=>{
  if(!hint||!input.current){setHintPosition(null);return;}
  const reposition=()=>{
   const rect=input.current?.getBoundingClientRect();
   if(rect){
    const above=window.innerHeight-rect.bottom<90;
    setHintPosition({left:Math.max(6,Math.min(rect.left,window.innerWidth-380)),
     top:above?rect.top-5:rect.bottom+5,above});
   }
  };
  reposition();window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
  return()=>{window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true)};
 },[hint?.name,hint?.argument]);
 useLayoutEffect(()=>{
  if((!matches&&!functionMatch)||!input.current){setPopup(null);return;}
  const recalc=()=>{
   const rect=input.current?.getBoundingClientRect();
   if(!rect)return;
   const above=window.innerHeight-rect.bottom<220;
   setPopup({top:above?Math.max(6,rect.top-210):rect.bottom+3,
     left:Math.max(6,Math.min(rect.left,window.innerWidth-240)),width:Math.max(210,rect.width),above});
  };
  recalc();
  window.addEventListener('resize',recalc);
  window.addEventListener('scroll',recalc,true);
  return()=>{window.removeEventListener('resize',recalc);window.removeEventListener('scroll',recalc,true)};
 },[matches,functionMatch]);
 const sourceRoots=selectedSourceObjects!==undefined
  ?selectedSourceObjects.map(source=>source.apiName)
  :rootObjectApiName?[rootObjectApiName]:[];
 const collectionMentions=stateOptions.filter(entry=>entry.source==='CollectionState')
  .map(entry=>({reference:'@'+entry.key,label:entry.label}));
 const collectionNames=[...new Set(stateOptions.filter(entry=>entry.source==='CollectionState')
  .map(entry=>entry.key.split('.')[0]))].map(name=>({reference:'@'+name,label:name+' Collection'}));
 const dollarMentions=matches?.prefix==='$'
  ?[...formulaDollarSuggestions(stateOptions,matches.query,flowReferences),...componentMentions()]:[];
 function componentMentions(){
  const entries=scope?.entries??[];
  if(!entries.length||!matches)return [];
  const path=matches.query.split('.');
  if(path.length===1)return [{reference:'$component.',label:'Components on this page'}];
  if(path[0]!=='component')return [];
  if(path.length===2)return entries.map(item=>({reference:'$component.'+item.token+'.',label:item.name}));
  const entry=entries.find(item=>item.token===path[1]);
  return (entry?.keys??[]).map(key=>({reference:'$component.'+path[1]+'.'+key,label:key}));
 }
 // Inside TABLE(@Object, ...), field choices follow that Object, not the
 // Page Builder's first object or another selected independent source.
 const tableOpen=/\bTABLE\s*\(\s*@([A-Za-z][A-Za-z0-9_]*)\s*,([^)]*)$/i.exec(draft.slice(0,caret));
 const tableObject=tableOpen?objects.find(object=>object.apiName.toLowerCase()===tableOpen[1].toLowerCase()):undefined;
 const tableSourcePrompt=/\bTABLE\s*\(\s*@[A-Za-z0-9_]*$/i.test(draft.slice(0,caret));
 const tableSources=selectedSourceObjects??objects;
 const recordMentions:{reference:string;label:string}[]=tableSourcePrompt&&matches
  ?tableSources.map(object=>({reference:'@'+object.apiName,label:object.label+' Object source'}))
  :tableObject&&matches
  ?tableObject.fields.map(field=>({reference:field.apiName,label:tableObject.label+' → '+field.label}))
  :objects.length&&sourceRoots.length
  ?relationshipFormulaFields(objects,sourceRoots,matches?.query??'',mentionKind,singleFieldOnly)
    .map(({reference,label})=>({reference,label}))
  :fields.filter(field=>(!singleFieldOnly||/^(Checkbox|Boolean)$/i.test(field.dataType)))
    .map(field=>({reference:'@'+field.apiName,label:field.label}));
 // TABLE's first argument is an @Object. Subsequent arguments are bare
 // field API names: TABLE(@Product,Name,Price). Do not show unrelated mentions.
 const tableArg=Boolean(tableSourcePrompt||tableObject);
 const actionArgs=flowReferences? actionArgumentSuggestions(draft.slice(0,caret),objects,flowReferences,actionPages,actionCredentials):null;
 const availableMentions=actionArgs&&matches?.prefix===''?actionArgs.choices.map(item=>({reference:item.apiName,label:item.label})):matches?.prefix==='$'
  ?tableArg?[]:dollarMentions
  :tableArg?recordMentions:[...recordMentions,...collectionMentions,...collectionNames];
 const filtered=matches?availableMentions
    .filter(item=>item.reference.toLowerCase().includes(
       (matches.prefix==='$'?'$':(tableArg||actionArgs)?'':'@')+matches.query.toLowerCase())||
      item.label.toLowerCase().includes(matches.query.toLowerCase()))
    .slice(0,200):[];
 const isFormulaDraft=(source:string)=>source.startsWith('=')||
  /^\$(?:component\.|flow\.|state\.|session(?:\b|\.))/.test(source)||
  /^@[A-Za-z][A-Za-z0-9_.]*\s*(?:==|=|<>|!=|>=|<=|>|<)/.test(source);
 const errorFor=(next:string):string|null=>{
  if(!flowReferences&&/\$flow\b/i.test(next))return '$flow is only available in the Action formula bar';
  const custom=validate?.(next);
  if(custom)return custom;
  if(flowReferences&&isScreenAction(next)){
   try{const {page,mode}=parseScreenAction(next);
    if(!actionPages.some(item=>item.apiName===page&&item.status==='Active'&&(item.pageType==='App Page'||mode==='popup'&&item.pageType==='In-Screen Page')))return 'Choose a published page available for this window mode';
    return null;}catch(error){return error instanceof Error?error.message:'Invalid screen';}
  }
  if(flowReferences&&isActionPlan(next)){
   try{
    for(const step of compileActionPlan(next)){
     if(['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(step.name)){
      const object=objects.find(item=>item.apiName===step.object);
      if(!object)return 'Unknown object: '+step.object;
      for(const field of step.fields.keys())if(!object.fields.some(item=>item.apiName===field))return 'Unknown field: '+step.object+'.'+field;
     }
     if(['PRINT','CREATEPDF'].includes(step.name)&&!actionPages.some(item=>item.apiName===step.object&&item.pageType==='Print Template'&&item.status==='Active'))return 'Unknown published Print Template: '+step.object;
     if(step.name==='FLOW'&&!flowReferences.some(item=>item.apiName===step.object))return 'Unknown active Flow: '+step.object;
     if(['EMAIL','SMS','WHATSAPP'].includes(step.name)&&!actionCredentials.some(item=>item.apiName===step.object))return 'Choose an enabled Named Credential';
    }
    return null;}catch(error){return error instanceof Error?error.message:'Invalid action';}
  }
  const source=next.trim();
  if(!isFormulaDraft(source))return null;
  if(tokenEndsInComponentPrefix(source))return 'Select a component and property';
  if(!source.slice(source.startsWith('=')?1:0).trim())return 'Complete the formula after =';
  const functionPrefix=/^=\s*([A-Za-z][A-Za-z0-9_]*)$/.exec(source);
  if(functionPrefix&&functions.some(name=>name.startsWith(functionPrefix[1].toUpperCase())))
    return 'Complete the function with arguments';
  try{
   const expression=new Parser(tokenize(source.startsWith('=')?source.slice(1):source)).parse();
   validateFormulaFunctions(flowReferences?normalizeFlowCalls(expression):expression,'ribbon_binding');
   return null;
  }catch(error){return error instanceof Error?error.message:'Incomplete formula';}
 };
 const suggest=(next:string,caret:number)=>{
   const before=next.slice(0,caret);
   const openString=(before.match(/"/g)||[]).length%2===1;
   const mention=!openString?/@([A-Za-z0-9_.]*)$/.exec(before):null;
   const dollar=!openString&&!mention?/\$([A-Za-z0-9_.]*)$/.exec(before):null;
   const tablePart=!openString&&!mention
    ?/\bTABLE\s*\(\s*@[A-Za-z][A-Za-z0-9_]*\s*,([^)]*)$/i.exec(before):null;
   const last=tablePart?.[1].split(',').at(-1)?.trim()??'';
   // Existing @Field spellings can still be edited, but selection inserts
   // the canonical bare field name with no @.
   const tableField=tablePart&&/^@?[A-Za-z0-9_]*$/.test(last)
    ?{start:caret-last.length,end:caret,query:last.replace(/^@/,'')}:null;
   const args=flowReferences?actionArgumentSuggestions(before,objects,flowReferences,actionPages,actionCredentials):null;
   setMatches(args?{start:caret-args.query.length,end:caret,query:args.query,prefix:''}:mention?{start:caret-mention[0].length,end:caret,query:mention[1],prefix:'@'}:
    dollar?{start:caret-dollar[0].length,end:caret,query:dollar[1],prefix:'$'}:
    tableField?{...tableField,prefix:''}:null);
   const name=next.trimStart().startsWith('=')?formulaFunctionPrefix(before):null;
   setFunctionMatch(tablePart||args||!name?null:{start:caret-name.length,end:caret,query:name});
 };
 const update=(next:string,caret:number)=>{
  setDraft(next);
  const error=errorFor(next);
  setValidationError(null);
  if(!error)onChange(next);
  setCaret(caret);
  suggest(next,caret);
 };
 const insert=(reference:string)=>{
  if(!matches)return;
  const next=draft.slice(0,matches.start)+reference+draft.slice(matches.end);
  const end=matches.start+reference.length;
  setDraft(next);
  const error=errorFor(next);
  setValidationError(null);
  if(!error)onChange(next);
  setCaret(end);setMatches(null);setFunctionMatch(null);
  if(reference.startsWith('$component.')&&reference.endsWith('.'))suggest(next,end);
  requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(end,end)});
 };
 const insertFunction=(name:string)=>{
  if(!functionMatch)return;
  const next=draft.slice(0,functionMatch.start)+name+'('+draft.slice(functionMatch.end);
  const end=functionMatch.start+name.length+1;
  update(next,end);setFunctionMatch(null);setMatches(null);
  requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(end,end)});
 };
 // The formula input always takes priority over contextual assistance. When both
 // autocomplete and argument help exist, render them in ONE anchored dropdown
 // below the field rather than floating the signature over the typing caret.
 const suggestionsOpen=Boolean(popup&&((functionMatch&&functionSuggestions.length)||
  (matches&&filtered.length)));
 const signatureContent=hint?<><strong>{hint.name}</strong><span>(</span>
  {hint.parameters.slice(0,Math.min(hint.maximumArguments,
   Math.max(hint.minimumArguments,hint.argument+2,4))).map((parameter,index)=>
    <span key={index} className={index===hint.argument?'is-current':''}>
      {index?', ':''}{parameter.name}{parameter.optional?'?':''}
    </span>)}
  {hint.maximumArguments>Math.max(hint.minimumArguments,hint.argument+2,4)&&<span>, …</span>}
  <span>)</span></>:null;
 const inlineSignature=hint&&signatureContent?<div className="smart-formula-signature smart-formula-signature-inline"
   role="status" aria-label="Formula argument help">{signatureContent}</div>:null;

 const finishEdit=()=>{
  const error=errorFor(draft);
  setValidationError(error);
  if(error&&isFormulaDraft(draft.trim()))setConfirmIncomplete(true);
 };
 const keyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
  const options=functionMatch?functionSuggestions:matches?filtered:[];
  if(event.key==='Escape'){
   if(!functionMatch&&!matches)return;
   event.preventDefault();setMatches(null);setFunctionMatch(null);setFocused(false);return;
  }
  if((event.key==='ArrowDown'||event.key==='ArrowUp')&&options.length){
   event.preventDefault();
   setActiveSuggestion(current=>(current+(event.key==='ArrowDown'?1:options.length-1))%options.length);
   return;
  }
  if(event.key==='Enter'&&options.length){
   event.preventDefault();
   if(functionMatch)insertFunction(functionSuggestions[Math.min(activeSuggestion,functionSuggestions.length-1)]);
   else if(matches)insert(filtered[Math.min(activeSuggestion,filtered.length-1)].reference);
   return;
  }
  if(event.key==='Enter')finishEdit();
 };
 return <div className="smart-formula" title={singleFieldOnly?'Select a Boolean field, e.g. @IsActive':'Formula: @Field, + - * / and &; quoted symbols are text'}>
  <div className="smart-formula-highlight" aria-hidden="true">{splitSmartFormula(draft).map((part,i)=>
    <span key={i} className={'smart-formula-'+part.kind}>{part.value}</span>)}</div>
  <input ref={input} type="text" role="combobox" aria-label={label} aria-autocomplete="list"
   aria-expanded={Boolean(popup&&((functionMatch&&functionSuggestions.length)||(matches&&filtered.length)))}
   aria-controls={suggestionListId}
   aria-activedescendant={popup&&((functionMatch&&functionSuggestions.length)||(matches&&filtered.length))?suggestionListId+'-option-'+activeSuggestion:undefined}
   value={draft} spellCheck={false} autoComplete="off"
   placeholder={singleFieldOnly?'@BooleanField':'@Field & "text"'} disabled={disabled} onKeyDown={keyDown}
   onFocus={e=>{setFocused(true);setCaret(e.currentTarget.selectionStart??draft.length)}}
   onClick={e=>setCaret(e.currentTarget.selectionStart??draft.length)}
   onKeyUp={e=>setCaret(e.currentTarget.selectionStart??draft.length)}
   onBlur={()=>{setMatches(null);setFunctionMatch(null);setFocused(false);finishEdit();}}
   onChange={e=>update(e.currentTarget.value,e.currentTarget.selectionStart??e.currentTarget.value.length)}/>

  {hint&&hintPosition&&!suggestionsOpen&&createPortal(<div
    className="smart-formula-signature" role="status" aria-label="Formula argument help"
    style={{position:'fixed',top:hintPosition.top,left:hintPosition.left,zIndex:6100,
      transform:hintPosition.above?'translateY(-100%)':undefined}}>
    {signatureContent}
   </div>,document.body)}
  {confirmIncomplete&&createPortal(<div className="smart-formula-confirm-backdrop">
    <section role="dialog" aria-modal="true" aria-label="Incomplete formula"
      className="smart-formula-confirm">
      <strong>Incomplete formula</strong><p>{validationError}</p>
      <button type="button" autoFocus onClick={()=>{
        setConfirmIncomplete(false);requestAnimationFrame(()=>input.current?.focus());
      }}>Complete Formula</button>
      <button type="button" onClick={()=>{
        setDraft(value);setValidationError(null);setConfirmIncomplete(false);
      }}>Discard Changes</button>
    </section>
  </div>,document.body)}
  {functionSuggestions.length>0&&functionMatch&&popup&&createPortal(<div id={suggestionListId} className="smart-formula-list"
    role="listbox" aria-label="Formula functions"
    style={{position:'fixed',left:popup.left,top:popup.top,minWidth:popup.width,maxHeight:200,zIndex:6000}}>
    {inlineSignature}
    {functionSuggestions.map((name,index)=><button id={suggestionListId+'-option-'+index}
      type="button" role="option" aria-selected={index===activeSuggestion} key={name}
      className={index===activeSuggestion?'is-active':''}
      ref={index===activeSuggestion?node=>node?.scrollIntoView({block:'nearest'}):undefined}
      onMouseEnter={()=>setActiveSuggestion(index)}
      onMouseDown={event=>{event.preventDefault();insertFunction(name)}}>{name}(</button>)}
  </div>,document.body)}
  {matches&&filtered.length>0&&popup&&createPortal(<div id={suggestionListId} className="smart-formula-list" role="listbox"
    style={{position:'fixed',left:popup.left,top:popup.top,minWidth:popup.width,maxHeight:200,zIndex:6000}}>
   {inlineSignature}
   {filtered.map((item,index)=><button key={item.reference} id={suggestionListId+'-option-'+index}
     type="button" role="option" aria-selected={index===activeSuggestion}
     className={index===activeSuggestion?'is-active':''}
     ref={index===activeSuggestion?node=>node?.scrollIntoView({block:'nearest'}):undefined}
     onMouseEnter={()=>setActiveSuggestion(index)}
     onMouseDown={e=>{e.preventDefault();insert(item.reference)}}>{item.reference} · {item.label}</button>)}
  </div>,document.body)}
 </div>;
}

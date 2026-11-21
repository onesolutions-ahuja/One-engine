import {Parser,formulaTruth,type Expression} from './FormulaParser.js';
import {screenArguments,screenLayerArg} from './screenLayer.js';
export {screenLayerArg};
import {tokenize} from './FormulaTokenizer.js';
import {FLOW_MARKER,isFlowMarker,isBrowserOnlyReference,parsePageReference,savedValueKey,assignedComponent,assignedProperty,COMPONENT_VALUES} from './PageReferences.js';
import {COMPONENT_PROPERTIES,uiPropertyValue,withComponentProperties} from './FormulaComponentState.js';
import {validateFormulaFunctions} from './FormulaFunctionRegistry.js';
import {runDeviceCommand} from './ActionDevices.js';
import {actionFormulaFunctions} from './FormulaCategories.js';
import {SQL_SCALAR_FORMULAS,serializeFormulaSqlExpression} from './FormulaCategories.js';

const recordIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
function nameOf(node:Expression|undefined,label:string):string {
 const name=node?.kind==='reference'||node?.kind==='literal'?node.value:null;
 if(typeof name!=='string'||!identifier.test(name))throw Error('Invalid '+label);
 return name;
}

const fieldPath=/^[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]{0,79})?$/;
/** Field/value criteria for GETRECORD and COUNTIFS: Field or one-level Lookup.Field paths. */
function recordCriteria(args:readonly Expression[],label:string):Map<string,Expression>{
 if(!args.length||args.length%2||args.length>40)throw Error(label+' requires field and value pairs');
 const criteria=new Map<string,Expression>();
 for(let i=0;i<args.length;i+=2){
  const node=args[i];
  const field=node?.kind==='reference'||node?.kind==='literal'?node.value:null;
  if(typeof field!=='string'||!fieldPath.test(field))throw Error('Invalid '+label+' field '+String(field));
  if(criteria.has(field))throw Error('Duplicate field '+field);
  validateFormulaFunctions(args[i+1],'ribbon_binding');
  criteria.set(field,args[i+1]);
 }
 return criteria;
}
/** Record API equality filters: blank values match blank fields; booleans and numbers as text. */
function criteriaFilters(criteria:Map<string,Expression>,evaluate:(node:Expression)=>unknown){
 return [...criteria].map(([field,node])=>{
  const value=evaluate(node);
  if(value===''||value===null||value===undefined)return {field,operator:'isBlank',value:''};
  if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))
   throw Error('Criteria for '+field+' must be a scalar value');
  return {field,operator:'eq',value:String(value)};
 });
}
const recordQueryPath=(object:string,filters:unknown[],limit=1,cursor?:string)=>
 '/records/'+encodeURIComponent(object)+'?limit='+limit+'&filters='+encodeURIComponent(JSON.stringify(filters))
  +(cursor?'&cursor='+encodeURIComponent(cursor):'');
/** Record aggregates resolved through the Record API (RBAC and field security apply). */
export const recordAggregateFunctions:ReadonlySet<string>=new Set(['COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS']);
/** Functions that need a server round-trip before the synchronous evaluator runs. */
export const serverFormulaFunctions:ReadonlySet<string>=new Set([...recordAggregateFunctions,'VERIFYPIN']);
const maxAggregateRecords=5000,maxLoopIterations=500;
/** True when an expression uses a server-resolved function (aggregates, VERIFYPIN). */
export function usesRecordCount(node:Expression|undefined):boolean{
 if(!node)return false;
 if(node.kind==='call')return serverFormulaFunctions.has(node.name)||node.args.some(usesRecordCount);
 if(node.kind==='binary')return usesRecordCount(node.left)||usesRecordCount(node.right);
 if(node.kind==='unary')return usesRecordCount(node.value);
 return false;
}
async function listMatching(request:ActionServices['request'],object:string,filters:unknown[],max:number,label:string){
 const rows:Record<string,unknown>[]=[];
 let cursor:string|undefined;
 for(;;){
  const page=await request<{records?:Record<string,unknown>[];total?:number;nextCursor?:string}>(
   recordQueryPath(object,filters,100,cursor));
  const records=Array.isArray(page.records)?page.records:[];
  if(typeof page.total==='number'&&page.total>max)throw Error(label+' matches more than '+max+' records; narrow the criteria');
  rows.push(...records);
  if(rows.length>max)throw Error(label+' matches more than '+max+' records; narrow the criteria');
  if(records.length<100||!page.nextCursor||typeof page.total==='number'&&rows.length>=page.total)return rows;
  cursor=page.nextCursor;
 }
}
const aggregateNumber=(value:unknown):number|null=>{
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value==='string'&&value.trim()!==''){const n=Number(value);return Number.isFinite(n)?n:null;}
 return null;
};

/** Translate authoring syntax in the parsed tree so quoted text is preserved. */
export function normalizeFlowCalls(node:Expression):Expression {
 if(node.kind==='call'){
  if(node.name==='FLOW'){
   if(node.args.length!==1)throw Error('FLOW requires one Flow API name');
   return {kind:'reference',value:FLOW_MARKER+nameOf(node.args[0],'Flow API name')};
  }
  return {...node,args:node.args.map(normalizeFlowCalls)};
 }
 if(node.kind==='binary')return {...node,left:normalizeFlowCalls(node.left),right:normalizeFlowCalls(node.right)};
 if(node.kind==='unary')return {...node,value:normalizeFlowCalls(node.value)};
 return node;
}

export const actionFunctionNames:readonly string[]=[...actionFormulaFunctions].filter(name=>name!=='AS');
export const isActionPlan=(source:string):boolean=>{
 if(/^\s*=?\s*(?:ACTIONS|CREATERECORD|UPDATERECORD|DELETERECORD|GETRECORD|STATE|LOCATION|RECORDPAYMENT|FOREACH|CLOSESCREEN|CONFIRMSCREEN|INFOSCREEN|LOCKSCREEN|PAIRDISPLAY|PRINT|CREATEPDF|WAIT|EMAIL|WHATSAPP|SMS)\s*\(/i.test(source))return true;
 if(!/^\s*=?\s*IF\s*\(/i.test(source))return false;
 try{
  const root=new Parser(tokenize(source)).parse();
  const hasAction=(node:Expression):boolean=>node.kind==='call'?
   actionFunctionNames.includes(node.name)||node.args.some(hasAction):
   node.kind==='binary'?hasAction(node.left)||hasAction(node.right):
   node.kind==='unary'?hasAction(node.value):false;
  return hasAction(root);
 }catch{return false;}
};
export type ActionStep={
 name:string;object:string;id?:Expression;values?:Expression[];fields:Map<string,Expression>;alias?:string;
 guards?:readonly {condition:Expression;expected:boolean}[];
 /** FOREACH: the loop body, and a TABLE()/COLLECTION() source instead of record criteria. */
 body?:ActionStep[];source?:Expression;
 /** CONFIRMSCREEN: the steps run when the user answers No. */
 elseBody?:ActionStep[]
};
const reservedAliases=['state','event','session','constructor','prototype','repeat'];

export function compileActionPlan(source:string):ActionStep[] {
 const aliases=new Set<string>();
 const takeAlias=(node:Expression|undefined,label:string)=>{
  if(node?.kind!=='call'||node.name!=='AS'||node.args.length!==1)throw Error(label);
  const alias=nameOf(node.args[0],'result variable');
  if(reservedAliases.includes(alias))throw Error('Reserved result variable '+alias);
  if(aliases.has(alias))throw Error('Duplicate result variable '+alias);
  aliases.add(alias);
  return alias;
 };
 function add(steps:ActionStep[],node:Expression,guards:ActionStep['guards'],loop:boolean){
  if(node.kind==='literal'&&(node.value===''||node.value===null))return;
  if(node.kind==='call'&&node.name==='IF'){
   if(node.args.length!==3)throw Error('IF requires condition, true action and false action');
   validateFormulaFunctions(node.args[0],'ribbon_binding');
   add(steps,node.args[1],[...(guards??[]),{condition:node.args[0],expected:true}],loop);
   add(steps,node.args[2],[...(guards??[]),{condition:node.args[0],expected:false}],loop);
   return;
  }
  // `@ThisPage.Button2.Caption = …` / `.Disabled = …` / `.Visible = …`.
  const property=node.kind==='binary'?assignedProperty(node as never):null;
  if(property&&node.kind==='binary'){
   validateFormulaFunctions(node.right,'ribbon_binding');
   steps.push({name:'PROPERTY',object:property.name+'.'+property.property,values:[node.right],fields:new Map(),guards});
   return;
  }
  // `@ThisPage.CashBox.Value = …`: the component is given a new value.
  const assigned=assignedComponent(node,aliases);
  if(assigned&&node.kind==='binary'){
   validateFormulaFunctions(node.right,'ribbon_binding');
   steps.push({name:'VALUE',object:assigned,values:[node.right],fields:new Map(),guards});
   return;
  }
  if(node.kind!=='call'||!actionFunctionNames.includes(node.name))throw Error('Expected an action formula');
  const args=[...node.args];
  if(node.name==='ACTIONS'){
   if(!args.length)throw Error('ACTIONS requires at least one action');
   args.forEach(arg=>add(steps,arg,guards,loop));
   return;
  }
  if(node.name==='PAIRDISPLAY'){
  if(args.length!==1)throw Error('PAIRDISPLAY needs the page the screen shows');
  steps.push({name:node.name,object:nameOf(args[0],'PAIRDISPLAY page'),fields:new Map(),guards});
  return;
 }
 if(node.name==='CLOSESCREEN'||node.name==='LOCKSCREEN'){
   // CLOSESCREEN("second") closes the second-monitor screen; otherwise no arguments.
   const second=node.name==='CLOSESCREEN'&&args.length===1&&nameOf(args[0],'CLOSESCREEN target').toLowerCase()==='second';
   if(args.length&&!second)throw Error(node.name+' takes no arguments (CLOSESCREEN also accepts "second")');
   steps.push({name:node.name,object:second?'second':'',fields:new Map(),guards});
   return;
  }
  if(node.name==='CONFIRMSCREEN'||node.name==='INFOSCREEN'){
   // CONFIRMSCREEN(Message, ActionsOnYes, [ActionsOnNo], [YesLabel], [NoLabel]): a Yes/No box;
   // INFOSCREEN(Message, [ActionsAfterOk]): a message with OK. The box closes itself.
   const confirm=node.name==='CONFIRMSCREEN';
   if(confirm?args.length<2||args.length>5:args.length<1||args.length>2)
    throw Error(confirm?'CONFIRMSCREEN requires a message, actions on Yes, and optional actions on No and button labels'
     :'INFOSCREEN requires a message and optional actions after OK');
   const labels=confirm?[args[0],...args.slice(3)]:[args[0]];
   labels.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   const body:ActionStep[]=[],elseBody:ActionStep[]=[];
   if(args[1])add(body,args[1],[],loop);
   if(confirm&&args[2])add(elseBody,args[2],[],loop);
   steps.push({name:node.name,object:'',values:labels,fields:new Map(),guards,body,elseBody});
   return;
  }
  if(node.name==='WAIT'){
   if(loop)throw Error('WAIT cannot run inside FOREACH');
   if(args.length!==2)throw Error('WAIT requires minutes and seconds');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   steps.push({name:'WAIT',object:'',values:args,fields:new Map(),guards});
   return;
  }
  if(node.name==='RECORDPAYMENT'){
   // RECORDPAYMENT(InvoiceId, Amount, Method, [Note], [AS(pay)]): one server transaction
   // posts a CashLedger receipt and updates Invoice AmountPaid/Status. No Flow needed.
   let alias:string|undefined;
   const last=args.at(-1);
   if(last?.kind==='call'&&last.name==='AS'){alias=takeAlias(last,'AS requires one variable');args.pop();}
   if(args.length<3||args.length>4)throw Error('RECORDPAYMENT requires Invoice ID, Amount, Method and an optional Note');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   steps.push({name:'RECORDPAYMENT',object:'',values:args,fields:new Map(),alias,guards});
   return;
  }
  if(node.name==='CASHMOVE'){
   // CASHMOVE(Direction "IN"|"OUT", Amount, Reason, TillSession, [AS(x)]): one server
   // transaction posts a CashLedger cash in/out for the till session. No Flow needed.
   let alias:string|undefined;
   const last=args.at(-1);
   if(last?.kind==='call'&&last.name==='AS'){alias=takeAlias(last,'AS requires one variable');args.pop();}
   if(args.length!==4)throw Error('CASHMOVE requires Direction ("IN" or "OUT"), Amount, Reason and the till session');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   steps.push({name:'CASHMOVE',object:'',values:args,fields:new Map(),alias,guards});
   return;
  }
  if(node.name==='LOCATION'){
   // LOCATION(AS(loc)): the device's current GPS position for later steps,
   // read as loc.Latitude, loc.Longitude, loc.Accuracy (metres) and loc.CapturedAt.
   if(args.length!==1)throw Error('LOCATION requires AS(variable) for the captured position');
   const alias=takeAlias(args[0],'LOCATION requires AS(variable) for the captured position');
   steps.push({name:'LOCATION',object:'',fields:new Map(),alias,guards});
   return;
  }
  if(node.name==='STATE'){
   if(args.length!==2)throw Error('STATE requires a Page State key and a value');
   const key=nameOf(args[0],'Page State key');
   if(key.length>63)throw Error('Invalid Page State key');
   validateFormulaFunctions(args[1],'ribbon_binding');
   steps.push({name:'STATE',object:key,values:[args[1]],fields:new Map(),guards});
   return;
  }
  if(node.name==='FOREACH'){
   // FOREACH(Object, Field, Value..., AS(item), Action) or FOREACH(TABLE(...), AS(item), Action)
   if(loop)throw Error('FOREACH cannot be nested');
   const body=args.pop();
   if(!body)throw Error('FOREACH requires an action');
   const alias=takeAlias(args.pop(),'FOREACH requires AS(item) before the action');
   const first=args[0];
   const bodySteps:ActionStep[]=[];
   let step:ActionStep;
   if(first?.kind==='call'){
    if(args.length!==1)throw Error('FOREACH over a collection takes the collection, AS(item) and an action');
    validateFormulaFunctions(first,'ribbon_binding');
    step={name:'FOREACH',object:'',source:first,fields:new Map(),alias,guards,body:bodySteps};
   }else{
    const object=nameOf(args.shift(),'FOREACH object API name');
    step={name:'FOREACH',object,fields:args.length?recordCriteria(args,'FOREACH'):new Map(),alias,guards,body:bodySteps};
   }
   add(bodySteps,body,[],true);
   if(!bodySteps.length)throw Error('FOREACH requires an action');
   steps.push(step);
   return;
  }
  if(node.name==='LOOP'){
   // LOOP(Times, AS(i), Action): run the action Times times; i.Index is 1, 2, 3...
   if(loop)throw Error('LOOP cannot be nested inside FOREACH, LOOP or REPEAT');
   if(args.length!==3)throw Error('LOOP requires Times, AS(item) and an action');
   validateFormulaFunctions(args[0],'ribbon_binding');
   const alias=takeAlias(args[1],'LOOP requires AS(item) after Times');
   const bodySteps:ActionStep[]=[];
   add(bodySteps,args[2],[],true);
   if(!bodySteps.length)throw Error('LOOP requires an action');
   steps.push({name:'LOOP',object:'',source:args[0],fields:new Map(),alias,guards,body:bodySteps});
   return;
  }
  if(node.name==='REPEAT'){
   // REPEAT(Action, UntilCondition, EverySeconds, MaxTimes): run the action, stop when the
   // condition is TRUE, otherwise wait and run again (at most MaxTimes). For status checks.
   if(loop)throw Error('REPEAT cannot be nested inside FOREACH, LOOP or REPEAT');
   if(args.length!==4)throw Error('REPEAT requires Action, Until condition, Every seconds and Max times');
   args.slice(1).forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   const bodySteps:ActionStep[]=[];
   add(bodySteps,args[0],[],true);
   if(!bodySteps.length)throw Error('REPEAT requires an action');
   steps.push({name:'REPEAT',object:'',values:args.slice(1),fields:new Map(),guards,body:bodySteps});
   return;
  }
  if(node.name==='DEVICE'){
   // DEVICE("Receipt Printer", "Print", text) / DEVICE("Cash Drawer", "Open"): default Named Device.
   if(args.length<2||args.length>3)throw Error('DEVICE requires a device type, a command and optional text');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   steps.push({name:'DEVICE',object:'',values:args,fields:new Map(),guards});
   return;
  }
  if(node.name==='CALLOUT'){
   // CALLOUT('Connector.Operation', 'Field', Value, ..., AS(result)): the connector app holds
   // the URL, keys, method, path and body template; the formula only fills named blanks.
   const target=args.shift();
   const operation=target?.kind==='literal'||target?.kind==='reference'?String(target.value):'';
   if(!/^[A-Za-z][A-Za-z0-9_]{0,79}\.[A-Za-z][A-Za-z0-9_]{0,79}$/.test(operation))
    throw Error("CALLOUT needs 'Connector.Operation', for example 'SumUp.StartPayment'");
   let alias:string|undefined;
   const last=args.at(-1);
   if(last?.kind==='call'&&last.name==='AS'){alias=takeAlias(last,'AS requires one variable');args.pop();}
   if(args.length%2||args.length>80)throw Error('CALLOUT expects field and value pairs');
   const fields=new Map<string,Expression>();
   for(let i=0;i<args.length;i+=2){
    const field=nameOf(args[i],'CALLOUT field name');
    if(fields.has(field))throw Error('Duplicate field '+field);
    validateFormulaFunctions(args[i+1],'ribbon_binding');
    fields.set(field,args[i+1]);
   }
   steps.push({name:'CALLOUT',object:operation,fields,alias,guards});
   return;
  }
  const object=nameOf(args.shift(),'object API name');
  if(node.name==='GETRECORD'){
   const alias=takeAlias(args.at(-1),'GETRECORD requires AS(variable) for the found record');
   args.pop();
   steps.push({name:'GETRECORD',object,fields:recordCriteria(args,'GETRECORD'),alias,guards});
   return;
  }
  if(['EMAIL','WHATSAPP','SMS','FLOW','SCREEN'].includes(node.name)){
   const bounds:Record<string,[number,number]>={EMAIL:[3,23],WHATSAPP:[2,22],SMS:[2,2],FLOW:[0,0],SCREEN:[0,3]};
   const [min,max]=bounds[node.name];
   if(args.length<min||args.length>max)throw Error('Invalid '+node.name+' arguments');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   if(node.name==='SCREEN'){
    // Any order after the page; kept as [mode, record, layer] (blank = not given).
    const {mode,modeGiven,record:screenRecord,layer}=screenArguments(args);
    const none:Expression={kind:'literal',value:null};
    steps.push({name:node.name,object,fields:new Map(),guards,values:[
     modeGiven?{kind:'reference',value:mode}:none,screenRecord??none,layer!==undefined?{kind:'literal',value:layer}:none]});
    return;
   }
   steps.push({name:node.name,object,values:args,fields:new Map(),guards});
   return;
  }
  const id=node.name==='CREATERECORD'?undefined:args.shift();
  if(node.name!=='CREATERECORD'&&!id)throw Error('Record ID is required');
  if(id)validateFormulaFunctions(id,'ribbon_binding');
  const last=args.at(-1);
  let alias:string|undefined;
  if(last?.kind==='call'&&last.name==='AS'){
   if(last.args.length!==1)throw Error('AS requires one variable');
   alias=takeAlias(last,'AS requires one variable');
   args.pop();
  }
  if(['PRINT','CREATEPDF','DELETERECORD'].includes(node.name)&&args.length)
   throw Error('Unexpected extra arguments for '+node.name);
  if(node.name==='PRINT'&&alias)throw Error('PRINT does not capture a result; use CREATEPDF');
  if(!['PRINT','CREATEPDF','DELETERECORD'].includes(node.name)
     &&(args.length%2||(!args.length&&node.name==='UPDATERECORD')))
    throw Error('Expected field and value pairs');
  const fields=new Map<string,Expression>();
  for(let i=0;i<args.length;i+=2){
   const field=nameOf(args[i],'field API name');
   if(fields.has(field))throw Error('Duplicate field '+field);
   validateFormulaFunctions(args[i+1],'ribbon_binding');
   fields.set(field,args[i+1]);
  }
  steps.push({name:node.name,object,id,fields,alias,guards});
 }
 const steps:ActionStep[]=[];
 add(steps,new Parser(tokenize(source)).parse(),[],false);
 return steps;
}


/** Conservative, server-safe contiguous data prefix. A browser-only suffix
 * must be unconditional and cannot be followed by another DB action.
 * Unsafe/unsplittable formulas always retain the existing client path.
 */
export type ActionPlanDataSplit={dataSteps:number;totalSteps:number};
const serverDataNames=new Set(['GETRECORD','CREATERECORD','UPDATERECORD','DELETERECORD','FOREACH']);
const safeServerCalls=new Set(['IF','IFERROR','ISBLANK','ISNULL','ISNUMBER','NOT','AND','OR',
 'BLANKVALUE','NULLVALUE','VALUE','TEXT','LEN','ROUND','ROUNDUP','ROUNDDOWN',
 'SUM','MIN','MAX','COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS']);
function safeServerNode(node:Expression|undefined):boolean{
 if(!node)return true;
 if(node.kind==='literal')return true;
 if(node.kind==='reference'){
  let browserOnly=true;
  try{browserOnly=isBrowserOnlyReference(parsePageReference(node.value));}catch{browserOnly=true;}
  return !browserOnly&&!isFlowMarker(node.value)
   &&!/(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(node.value);
 }
 if(node.kind==='binary')return safeServerNode(node.left)&&safeServerNode(node.right);
 if(node.kind==='unary')return safeServerNode(node.value);
 return safeServerCalls.has(node.name)&&node.args.every(safeServerNode);
}
function safeServerStep(step:ActionStep):boolean{
 if(!serverDataNames.has(step.name))return false;
 if(step.name==='FOREACH'&&step.source)return false;
 if(step.body?.some(body=>!safeServerStep(body)))return false;
 return [...stepNodes(step),...(step.guards??[]).map(g=>g.condition)].every(safeServerNode);
}
export function splitServerDataActionPlan(formula:string):ActionPlanDataSplit|null{
 const steps=compileActionPlan(formula);
 const firstClient=steps.findIndex(step=>!safeServerStep(step));
 const count=firstClient===-1?steps.length:firstClient;
 if(count===0)return null;
 // Conditional browser suffixes can re-decide IF guards after the server
 // transaction; never split them or plans with intervening data actions.
 const writesData=(step:ActionStep):boolean=>serverDataNames.has(step.name)||(step.body??[]).some(writesData);
 if(steps.slice(count).some(step=>writesData(step)||(step.guards?.length??0)>0))
  return null;
 return {dataSteps:count,totalSteps:steps.length};
}

/** CONFIRMSCREEN / INFOSCREEN: the page shows the box and answers (Yes/OK = true). */
export function askMessageScreen(kind:'confirm'|'info',message:string,yesLabel='',noLabel=''):Promise<boolean>{
 return new Promise<boolean>((resolve,reject)=>{
  const host=globalThis as unknown as {dispatchEvent?:(event:unknown)=>boolean;
   CustomEvent?:new(type:string,init:{cancelable:boolean;detail:unknown})=>unknown};
  if(typeof host.dispatchEvent!=='function'||typeof host.CustomEvent!=='function')
   return reject(Error((kind==='confirm'?'CONFIRMSCREEN':'INFOSCREEN')+' runs only on a page'));
  const handled=!host.dispatchEvent(new host.CustomEvent('metadrive:message-screen',
   {cancelable:true,detail:{kind,message,yesLabel,noLabel,resolve}}));
  if(!handled)reject(Error('This page has no message box host'));
 });
}
export const isScreenAction=(source:string)=>/^\s*=?\s*SCREEN\s*\(/i.test(source);
export function parseScreenAction(source:string){
 const node=new Parser(tokenize(source)).parse();
 if(node.kind!=='call'||node.name!=='SCREEN'||node.args.length<1)
  throw Error('SCREEN requires a page API name, then optional mode, record and layer (any order)');
 const page=nameOf(node.args[0],'page API name');
 // After the page: mode, record and layer in any order (see screenArguments).
 const {mode,record:recordNode,layer}=screenArguments(node.args.slice(1));
 // The record the screen opens with, e.g. SCREEN(Payment,popup,@ThisPage.Cart2.recordId).
 // The caller evaluates it.
 if(recordNode)validateFormulaFunctions(recordNode,'ribbon_binding');
 const record=recordNode?serializeFormulaSqlExpression(recordNode):undefined;
 return {page,mode,record,...(layer!==undefined?{layer}:{})};
}

function readsResultField(node:Expression,alias:string):boolean{
 if(node.kind==='reference')return node.value.startsWith(alias+'.')&&node.value!==alias+'.Id';
 if(node.kind==='unary')return readsResultField(node.value,alias);
 if(node.kind==='binary')return readsResultField(node.left,alias)||readsResultField(node.right,alias);
 return node.kind==='call'&&node.args.some(arg=>readsResultField(arg,alias));
}
const stepNodes=(step:ActionStep):Expression[]=>[...(step.id?[step.id]:[]),...step.fields.values(),
 ...(step.values??[]),...(step.source?[step.source]:[])];

/** Value-only diagnostics: never include formula source, record values, URLs or errors. */
export type ActionPlanStepTiming={
 name:string;durationMs:number;requestCount:number;status:'completed'|'skipped'|'failed';
};
export type ActionPlanTiming={
 formulaName:string;durationMs:number;stepCount:number;executedStepCount:number;
 completedActionCount:number;requestCount:number;status:'completed'|'failed';
 /** A successful action can be read-only or skip every write via a guard. */
 recordChanged:boolean;writeStepCount:number;skippedWriteStepCount:number;
 steps:ActionPlanStepTiming[];
};
/** A previous record write was confirmed before a later plan step failed.
 * Metadata contains only Object API names, never record field values or tokens.
 * Consumers reconcile persisted state but MUST NOT replay non-idempotent steps.
 */
export class PartialActionError extends Error {
 readonly mutatedObjectApiNames:readonly string[];
 readonly completedActionCount:number;
 constructor(message:string,mutatedObjectApiNames:readonly string[],completedActionCount:number){
  super('Action partially completed: '+message);
  this.name='PartialActionError';
  this.mutatedObjectApiNames=[...new Set(mutatedObjectApiNames)];
  this.completedActionCount=completedActionCount;
 }
}

/** Browser GPS reading for LOCATION(AS(loc)). The browser asks the user for
 * permission; nothing is stored unless a later step saves the values. */
export function readDeviceLocation(timeoutMs=15000):Promise<{Latitude:number;Longitude:number;Accuracy:number;CapturedAt:string}>{
 const geo=(globalThis as {navigator?:{geolocation?:{getCurrentPosition:(ok:(p:{coords:{latitude:number;longitude:number;accuracy:number};timestamp:number})=>void,
  fail:(e:{code:number})=>void,options:Record<string,unknown>)=>void}}}).navigator?.geolocation;
 if(!geo)return Promise.reject(Error('LOCATION is not available on this device or browser'));
 return new Promise((resolve,reject)=>geo.getCurrentPosition(
  position=>resolve({Latitude:position.coords.latitude,Longitude:position.coords.longitude,
   Accuracy:Math.round(position.coords.accuracy),CapturedAt:new Date(position.timestamp||Date.now()).toISOString()}),
  error=>reject(Error(error.code===1?'Location permission was denied':
   error.code===3?'Location request timed out':'Location is unavailable')),
  {enableHighAccuracy:true,timeout:timeoutMs,maximumAge:30000}));
}
export type ActionServices={
 request:<T>(path:string,init?:{method:string;body?:string})=>Promise<T>;
 print?:(template:string,id:string)=>Promise<void>;
 createPdf?:(template:string,id:string)=>Promise<{FileId:string}>;
 runPageAction?:(name:string,target:string,mode?:string,recordId?:string,layer?:number)=>Promise<unknown>;
 /** Optional opt-in observer. Its errors must never affect action execution. */
 onTiming?:(timing:ActionPlanTiming)=>void;
 /** Stable metadata identifier, not the authored formula text or a field value. */
 formulaName?:string;
 /** SQL numeric aggregation through the existing permission-scoped Record Engine. */
 useSqlAggregates?:boolean;
 /** Optional metadata-bound actor context; never used to authorize client data. */
 sqlContext?:{objectApi?:string;recordId?:string;recordFields?:readonly string[];state?:Readonly<Record<string,unknown>>};
 /** Internal, validated server data execution segment. */
 planWindow?:{start:number;end:number;variables?:Record<string,unknown>;completedBefore?:number;includeVariables?:boolean};
};
type EvaluateValue=(node:Expression,scope:Record<string,unknown>,aliases?:readonly string[],
 state?:Readonly<Record<string,unknown>>)=>unknown;
export async function executeActionPlan(formula:string,record:Record<string,unknown>,
 evaluateValue:EvaluateValue,{request,print,createPdf,runPageAction,onTiming,formulaName,useSqlAggregates,sqlContext,planWindow}:ActionServices){
  const trace=typeof onTiming==='function';
  const started=trace?performance.now():0;
  const steps=compileActionPlan(formula);
  if(planWindow&&(!Number.isSafeInteger(planWindow.start)||!Number.isSafeInteger(planWindow.end)||
    planWindow.start<0||planWindow.end>steps.length||planWindow.end<planWindow.start||
    !Number.isSafeInteger(planWindow.completedBefore??0)||(planWindow.completedBefore??0)<0))
   throw Error('Invalid Formula execution segment');
  const selectedSteps=planWindow?steps.slice(planWindow.start,planWindow.end):steps;
  const countSteps=(list:readonly ActionStep[]):number=>list.reduce(
   (total,step)=>total+1+(step.body?countSteps(step.body):0),0);
  const stepCount=trace?countSteps(selectedSteps):0;
  const traceSteps:ActionPlanStepTiming[]=[];
  let requestCount=0;
  let activeStep:ActionPlanStepTiming|undefined;
  const trackedNetwork:typeof request=trace
   ?<T>(path:string,init?:{method:string;body?:string}):Promise<T>=>{
     requestCount++;
     if(activeStep)activeStep.requestCount++;
     return request<T>(path,init);
    }
   :request;
  // Request cache lives only for this plan, never across tenant or browser actions.
  const recordReads=new Map<string,Promise<unknown>>();
  const tracedRequest:typeof request=<T>(path:string,init?:{method:string;body?:string}):Promise<T>=>{
   const method=init?.method??'GET';
   if(method==='GET'&&path.startsWith('/records/')){
    const cached=recordReads.get(path);
    if(cached)return cached as Promise<T>;
    const pending=trackedNetwork<T>(path,init).catch(error=>{
     if(recordReads.get(path)===pending)recordReads.delete(path);
     throw error;
    });
    recordReads.set(path,pending);
    return pending;
   }
   return trackedNetwork<T>(path,init).then(response=>{
    if(['POST','PUT','PATCH','DELETE'].includes(method)&&path.startsWith('/records/')){
     const objectPath=path.split('?')[0].split('/').slice(0,3).join('/');
     for(const key of recordReads.keys())
      if(key===objectPath||key.startsWith(objectPath+'/')||key.startsWith(objectPath+'?'))
       recordReads.delete(key);
    }
    return response;
   });
  };
  // STATE results apply to the page when the plan finishes and are visible to later steps.
  const stateChanges:Record<string,unknown>=Object.create(null);
  const changes:Array<{key:string;value:unknown}>=[];
  const pins=new Map<string,boolean>();
  let completed=planWindow?.completedBefore??0;
  let recordChanged=false;
  const mutatedObjectApiNames=new Set<string>();
  const recordChanges:Array<{objectApiName:string;operation:'create'|'update'|'delete';
   record:Record<string,unknown>}> = [];
  let iterations=0;

  /** Runs one list of steps. Each IF condition is decided once, when its first step runs,
   * so an action inside an IF branch cannot flip the condition for the next action. */
  async function run(list:ActionStep[],variables:Record<string,unknown>,top:boolean):Promise<boolean>{
   const decided=new Map<Expression,boolean>();
   for(const [index,step] of list.entries()){
    const previousStep=activeStep;
    const stepTiming:ActionPlanStepTiming|undefined=trace
     ?{name:step.name,durationMs:0,requestCount:0,status:'completed'}:undefined;
    const stepStarted=stepTiming?performance.now():0;
    if(stepTiming){traceSteps.push(stepTiming);activeStep=stepTiming;}
    try{
     const scope={...record,...variables};
     const evaluateNow=(node:Expression):unknown=>evaluateValue(node,scope,Object.keys(variables),stateChanges);
     // Server functions (record aggregates, VERIFYPIN) resolve before the synchronous
     // evaluator runs; their results are substituted as literals.
     const resolved=new Map<Expression,unknown>();
     const substitute=(node:Expression):Expression=>{
      if(resolved.has(node))return {kind:'literal',value:resolved.get(node) as never};
      if(node.kind==='call')return {...node,args:node.args.map(substitute)};
      if(node.kind==='binary')return {...node,left:substitute(node.left),right:substitute(node.right)};
      if(node.kind==='unary')return {...node,value:substitute(node.value)};
      return node;
     };
     // PIN verification and action steps remain strictly ordered. Only independent,
     // side-effect-free aggregate trees may resolve concurrently.
     const parallelSafe=(node:Expression|undefined):boolean=>{
      if(!node)return true;
      if(node.kind==='binary')return parallelSafe(node.left)&&parallelSafe(node.right);
      if(node.kind==='unary')return parallelSafe(node.value);
      if(node.kind==='call')return node.name!=='VERIFYPIN'&&node.args.every(parallelSafe);
      return true;
     };
     /** Route SQL-capable scalar trees even for literal and Page State values.
      * UI-only references remain in their existing evaluator. */
     // SQL-selected scalar functions may bind permitted Record fields, trusted
     // session values, or already-resolved Action inputs as SQL parameters.
     // Record aggregate functions remain handled by the shared Record Engine.
     const sqlServerCandidate=(node:Expression):boolean=>
       Boolean(sqlContext)&&SQL_SCALAR_FORMULAS.has(node.kind==='call'?node.name:'');
     const resolveServer=async(node:Expression|undefined):Promise<void>=>{
      if(!node)return;
      if(node.kind==='binary'){
       // Match the scalar evaluator's short-circuit semantics before starting IO.
       if(node.operator==='AND'||node.operator==='OR'){
        await resolveServer(node.left);
        const truth=formulaTruth(evaluateNow(substitute(node.left)));
        if(node.operator==='AND'&&!truth||node.operator==='OR'&&truth){
         if(sqlContext)resolved.set(node,truth);
         return;
        }
        await resolveServer(node.right);
        if(sqlContext)resolved.set(node,formulaTruth(evaluateNow(substitute(node.right))));
       }else if(parallelSafe(node.left)&&parallelSafe(node.right))
        await Promise.all([resolveServer(node.left),resolveServer(node.right)]);
       else{await resolveServer(node.left);await resolveServer(node.right);}
       return;
      }
      if(node.kind==='unary'){await resolveServer(node.value);return;}
      if(node.kind!=='call')return;
      if(node.name==='IF'&&node.args.length===3){
       await resolveServer(node.args[0]);
       const selected=formulaTruth(evaluateNow(substitute(node.args[0])))?1:2;
       await resolveServer(node.args[selected]);
       if(sqlContext)resolved.set(node,evaluateNow(substitute(node.args[selected])));
       return;
      }
      if(node.name==='IFERROR'&&node.args.length===2){
       try{
        await resolveServer(node.args[0]);
        const first=evaluateNow(substitute(node.args[0]));
        if(sqlContext)resolved.set(node,first);
       }catch{
        await resolveServer(node.args[1]);
        // A server failure in the protected operand must become an ordinary
        // fallback value so the later synchronous IFERROR sees the same result.
        resolved.set(node,evaluateNow(substitute(node.args[1])));
       }
       return;
      }
      if((node.name==='BLANKVALUE'||node.name==='NULLVALUE')&&node.args.length===2){
       await resolveServer(node.args[0]);
       const first=evaluateNow(substitute(node.args[0]));
       if(first===null||first===undefined||node.name==='BLANKVALUE'&&first===''){
        await resolveServer(node.args[1]);
        if(sqlContext)resolved.set(node,evaluateNow(substitute(node.args[1])));
       }else if(sqlContext)resolved.set(node,first);
       return;
      }
      if(node.name==='AND'||node.name==='OR'){
       let result=node.name==='AND';
       for(const arg of node.args){
        await resolveServer(arg);
        const truth=formulaTruth(evaluateNow(substitute(arg)));
        if(node.name==='AND'&&!truth){result=false;break;}
        if(node.name==='OR'&&truth){result=true;break;}
       }
       if(sqlContext)resolved.set(node,result);
       return;
      }
      if(node.args.length>1&&node.args.every(parallelSafe))
       await Promise.all(node.args.map(resolveServer));
      else for(const arg of node.args)await resolveServer(arg);
      // The existing Page evaluator owns computed and named-collection SUM
      // operands. Keep direct metadata field SUM on the authorised SQL path.
      if(node.name==='SUM'&&sqlContext){
       const operand=node.args[0];
       let pageSource=operand?.kind!=='reference';
       if(!pageSource&&operand?.kind==='reference'&&!operand.value.includes('.')
         &&!sqlContext.recordFields?.includes(operand.value)){
        try{
         const candidate=evaluateNow(substitute(operand));
         pageSource=Array.isArray(candidate)||Boolean(candidate&&typeof candidate==='object'
          &&Array.isArray((candidate as {items?:unknown}).items));
        }catch{/* Unknown field/alias: SQL still owns metadata SUM and its errors. */}
       }
       if(pageSource){
        const value=evaluateNow(substitute(node));
        if(typeof value!=='number'||!Number.isFinite(value))
         throw Error('Computed SUM must return a finite number');
        resolved.set(node,value);
        return;
       }
      }
      if(sqlServerCandidate(node)){
       const state:Record<string,string|number|boolean|null>=Object.create(null);
       let index=0;
       const insert=(value:unknown):Expression=>{
        if(value!==null&&value!==undefined&&typeof value!=='string'&&
          typeof value!=='boolean'&&(typeof value!=='number'||!Number.isFinite(value)))
         throw Error('SQL Formula Action requires a scalar input');
        const key='SqlArgument'+index++;
        state[key]=value===undefined?null:value as string|number|boolean|null;
        return {kind:'reference',value:'ThisPage.Input.'+key};
       };
       const remap=(value:Expression,parent=''):Expression=>{
        if(value.kind==='reference'){
         const name=value.value;
         const page=parsePageReference(name);
         if(page?.kind==='user'||page?.kind==='company')
          return value;
         const savedKey=isBrowserOnlyReference(page)?null:savedValueKey(page);
         if(savedKey!==null){
          const key=savedKey;
          const current=Object.hasOwn(stateChanges,key)?stateChanges[key]:
            sqlContext!.state?.[key];
          if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key))
           throw Error('Invalid SQL Formula state name');
          state[key]=current===undefined?null:current as string|number|boolean|null;
          if(current!==null&&current!==undefined&&!['string','number','boolean'].includes(typeof current))
           throw Error('SQL Formula requires a scalar state value');
          return {kind:'reference',value:'ThisPage.Input.'+key};
         }
         const objectField=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(name);
         if(parent==='SUM'&&objectField)return value;
         if(sqlContext!.recordId&&sqlContext!.objectApi&&
           (sqlContext!.recordFields?.includes(name)||
            objectField&&objectField[1]===sqlContext!.objectApi&&
             sqlContext!.recordFields?.includes(objectField[2])))
          return value;
         if(isFlowMarker(name))throw Error('Flow calls do not execute in SQL');
         return insert(evaluateNow(value));
        }
        if(value.kind==='call')return {...value,args:value.args.map(arg=>remap(arg,value.name))};
        if(value.kind==='unary')return {...value,value:remap(value.value,parent)};
        if(value.kind==='binary')return {...value,left:remap(value.left,parent),
          right:remap(value.right,parent)};
        return value;
       };
       const expression=serializeFormulaSqlExpression(remap(substitute(node)));
       if(expression.length>4000||Object.keys(state).length>40)
        throw Error('SQL Formula expression is too large');
       const result=await tracedRequest<{value:unknown}>('/formulas/evaluate',{
        method:'POST',body:JSON.stringify({formula:expression,
         objectApi:sqlContext!.objectApi,recordId:sqlContext!.recordId,state})
       });
       resolved.set(node,result.value);
       return;
      }
      if(!serverFormulaFunctions.has(node.name)||resolved.has(node))return;
      if(node.name==='VERIFYPIN'){
       if(node.args.length<1||node.args.length>2)throw Error('VERIFYPIN requires a PIN, or a user ID and a PIN');
       const values=node.args.map(arg=>evaluateNow(substitute(arg)));
       const [userId,pin]=values.length===2?values:['',values[0]];
       const key=String(userId)+'\u0000'+String(pin);
       if(!pins.has(key)){
        const result=await tracedRequest<{valid?:boolean}>('/action-formulas/verify-pin',{method:'POST',
         body:JSON.stringify({userId:userId===''||userId==null?undefined:String(userId),pin:pin==null?'':String(pin)})});
        pins.set(key,result.valid===true);
       }
       resolved.set(node,pins.get(key));
       return;
      }
      const [objectNode,...rest]=node.args;
      const object=nameOf(objectNode,node.name+' object API name');
      if(node.name==='COUNTIFS'){
       const filters=criteriaFilters(recordCriteria(rest,'COUNTIFS'),value=>evaluateNow(substitute(value)));
       const result=await tracedRequest<{total?:number}>(recordQueryPath(object,filters));
       if(typeof result.total!=='number'||!Number.isFinite(result.total))throw Error('COUNTIFS count unavailable');
       resolved.set(node,result.total);
       return;
      }
      const field=nameOf(rest.shift(),node.name+' value field');
      const filters=rest.length?criteriaFilters(recordCriteria(rest,node.name),value=>evaluateNow(substitute(value))):[];
      if(useSqlAggregates===true){
       const route='/records/'+encodeURIComponent(object)+'/aggregate?field='+encodeURIComponent(field)+
        '&filters='+encodeURIComponent(JSON.stringify(filters));
       const aggregate=await tracedRequest<{
        eligible?:boolean;total?:number;numericCount?:number;sum?:number;min?:number;max?:number
       }>(route);
       if(aggregate.eligible===true){
        if(typeof aggregate.total!=='number'||!Number.isFinite(aggregate.total))
         throw Error(node.name+' count unavailable');
        if(aggregate.total>maxAggregateRecords)
         throw Error(node.name+' matches more than '+maxAggregateRecords+' records; narrow the criteria');
        const numeric=Number(aggregate.numericCount??0);
        const sum=Number(aggregate.sum??0);
        const value=!numeric?0:node.name==='SUMIFS'?Math.round(sum*1e9)/1e9:
         node.name==='AVERAGEIFS'?sum/numeric:node.name==='MINIFS'?Number(aggregate.min??0):
          Number(aggregate.max??0);
        if(!Number.isFinite(value))throw Error(node.name+' result unavailable');
        resolved.set(node,value);
        return;
       }
       throw Error(node.name+' requires an authorised SQL numeric aggregate field');
      }
      const rows=await listMatching(tracedRequest,object,filters,maxAggregateRecords,node.name);
      const numbers=rows.map(row=>aggregateNumber(row[field])).filter((value):value is number=>value!==null);
      const total=numbers.reduce((sum,value)=>sum+value,0);
      resolved.set(node,!numbers.length?0:node.name==='SUMIFS'?Math.round(total*1e9)/1e9:
       node.name==='AVERAGEIFS'?total/numbers.length:node.name==='MINIFS'?Math.min(...numbers):Math.max(...numbers));
     };
     const evaluate=(node:Expression):unknown=>evaluateNow(substitute(node));
     let skip=false;
     for(const guard of step.guards??[]){
      if(!decided.has(guard.condition)){
       await resolveServer(guard.condition);
       decided.set(guard.condition,formulaTruth(evaluate(guard.condition)));
      }
      if(decided.get(guard.condition)!==guard.expected){skip=true;break;}
     }
     if(skip){if(stepTiming)stepTiming.status='skipped';continue;}
     const nodes=stepNodes(step);
     if(nodes.length>1&&nodes.every(parallelSafe))await Promise.all(nodes.map(resolveServer));
     else for(const node of nodes)await resolveServer(node);
     if(step.name==='PROPERTY'){
      const [name,property]=step.object.split('.') as [string,'Caption'|'Disabled'|'Visible'];
      const next=withComponentProperties({[COMPONENT_PROPERTIES]:stateChanges[COMPONENT_PROPERTIES]},name,'set',
       {[property]:uiPropertyValue(property,evaluate(step.values![0]))});
      stateChanges[COMPONENT_PROPERTIES]=next[COMPONENT_PROPERTIES];
      changes.push({key:COMPONENT_PROPERTIES,value:next[COMPONENT_PROPERTIES]});
      completed++;
      continue;
     }
     if(step.name==='VALUE'){
      const value=evaluate(step.values![0]);
      if(value!==null&&!['string','number','boolean'].includes(typeof value))
       throw Error('A component value must be text, a number or TRUE/FALSE');
      const given={...(stateChanges[COMPONENT_VALUES] as Record<string,unknown>|undefined),[step.object]:value??''};
      stateChanges[COMPONENT_VALUES]=given;
      changes.push({key:COMPONENT_VALUES,value:given});
      completed++;
      continue;
     }
     if(step.name==='STATE'){
      const value=evaluate(step.values![0]);
      if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))
       throw Error('STATE value must be text, a finite number or TRUE/FALSE');
      stateChanges[step.object]=value;
      changes.push({key:step.object,value});
      completed++;
      continue;
     }
     if(step.name==='GETRECORD'){
      const filters=criteriaFilters(step.fields,evaluate);
      // Id filters use the Record API's system ID column and all supplied predicates.
      // Blank IDs match no record; the caller can branch on ISBLANK(alias.Id).
      const result=await tracedRequest<{records?:Record<string,unknown>[]}>(recordQueryPath(step.object,filters));
      // No match leaves an empty result so ISBLANK(alias.Id) selects the create branch.
      variables[step.alias!]=result.records?.[0]??{};
      completed++;
      continue;
     }
     if(step.name==='FOREACH'){
      let items:Record<string,unknown>[];
      if(step.source){
       const collection=evaluate(step.source) as {items?:unknown}|unknown[]|null;
       const list=Array.isArray(collection)?collection:collection&&typeof collection==='object'
        &&Array.isArray((collection as {items?:unknown}).items)?(collection as {items:unknown[]}).items:null;
       if(!list)throw Error('FOREACH requires a TABLE() or COLLECTION() source');
       items=list.map(item=>item&&typeof item==='object'&&!Array.isArray(item)
        ?item as Record<string,unknown>:{Id:item,Value:item});
      }else items=await listMatching(tracedRequest,step.object,criteriaFilters(step.fields,evaluate),maxLoopIterations,'FOREACH');
      if(items.length>maxLoopIterations)throw Error('FOREACH is limited to '+maxLoopIterations+' items');
      // Snapshot first, then act: deleting or updating rows cannot change the items visited.
      for(const item of items){
       if(++iterations>maxLoopIterations)throw Error('FOREACH is limited to '+maxLoopIterations+' iterations');
       const inner:Record<string,unknown>=Object.assign(Object.create(null),variables,{[step.alias!]:item});
       await run(step.body!,inner,false);
      }
      completed++;
      continue;
     }
     if(step.name==='LOOP'){
      const times=evaluate(step.source!);
      if(typeof times!=='number'||!Number.isInteger(times)||times<0||times>maxLoopIterations)
       throw Error('LOOP Times must be a whole number from 0 to '+maxLoopIterations);
      for(let index=1;index<=times;index++){
       if(++iterations>maxLoopIterations)throw Error('LOOP is limited to '+maxLoopIterations+' iterations');
       const inner:Record<string,unknown>=Object.assign(Object.create(null),variables,
        {[step.alias!]:{Index:index,Id:index,Value:index,IsFirst:index===1,IsLast:index===times}});
       await run(step.body!,inner,false);
      }
      completed++;
      continue;
     }
     if(step.name==='REPEAT'){
      const [every,max]=step.values!.slice(1).map(evaluate);
      if(typeof every!=='number'||!Number.isFinite(every)||every<1||every>60)
       throw Error('REPEAT Every seconds must be from 1 to 60');
      if(typeof max!=='number'||!Number.isInteger(max)||max<1||max>600)
       throw Error('REPEAT Max times must be a whole number from 1 to 600');
      for(let attempt=1;attempt<=max;attempt++){
       // The action's AS(...) results stay visible to the condition and to later steps.
       variables.repeat={Attempt:attempt,IsLast:attempt===max};
       await run(step.body!,variables,false);
       const until=evaluateValue(step.values![0],{...record,...variables},Object.keys(variables),stateChanges);
       if(formulaTruth(until))break;
       if(attempt<max)await new Promise(resolve=>setTimeout(resolve,every*1000));
      }
      completed++;
      continue;
     }
     if(step.name==='DEVICE'){
      const [type,command,text]=(step.values??[]).map(evaluate);
      await runDeviceCommand(tracedRequest,type,command,text);
      completed++;
      continue;
     }
     if(step.name==='CALLOUT'){
      const values=Object.fromEntries([...step.fields].map(([field,node])=>[field,evaluate(node)]));
      // One provider idempotency key per executed step, so a network retry never pays twice.
      const key='co'+(globalThis.crypto?.randomUUID?.().replace(/-/g,'')??(Date.now().toString(36)+Math.random().toString(36).slice(2)));
      const result=await tracedRequest<Record<string,unknown>>('/action-formulas/callout',{method:'POST',
       body:JSON.stringify({operation:step.object,values,key})});
      if(step.alias)variables[step.alias]=result;
      completed++;
      continue;
     }
     if(step.name==='CASHMOVE')throw Error('CASHMOVE runs as page code: open the page in the Page Builder and save it again');
     if(step.name==='RECORDPAYMENT'){
      const [invoiceId,amount,method,note]=(step.values??[]).map(evaluate);
      // One idempotency key per run: a retried request can never post the payment twice.
      const reference='pay-'+(globalThis.crypto?.randomUUID?.()??(Date.now().toString(36)+Math.random().toString(36).slice(2)));
      const result=await tracedRequest<Record<string,unknown>>('/action-formulas/record-payment',{method:'POST',
       body:JSON.stringify({invoiceId,amount,method,note:note??'',reference})});
      recordChanged=true;
      mutatedObjectApiNames.add('Invoice');mutatedObjectApiNames.add('CashLedger');
      if(step.alias)variables[step.alias]=result;
      completed++;
      continue;
     }
     if(step.name==='LOCATION'){
      variables[step.alias!]=await readDeviceLocation();
      completed++;
      continue;
     }
     if(step.name==='CONFIRMSCREEN'||step.name==='INFOSCREEN'){
      const [message,yesLabel,noLabel]=(step.values??[]).map(evaluate)
       .map(value=>value===null||value===undefined?'':String(value));
      const yes=await askMessageScreen(step.name==='CONFIRMSCREEN'?'confirm':'info',message,yesLabel,noLabel);
      completed++;
      const next=yes?step.body??[]:step.elseBody??[];
      if(next.length&&!(await run(next,variables,top)))return false;
      continue;
     }
     if(step.name==='CLOSESCREEN'||step.name==='LOCKSCREEN'||step.name==='PAIRDISPLAY'){
      if(!runPageAction)throw Error('Page runtime unavailable');
      await runPageAction(step.name,step.object);
      completed++;
      continue;
     }
     if(step.name==='WAIT'){
      const [minutes,seconds]=(step.values??[]).map(evaluate);
      if(typeof minutes!=='number'||typeof seconds!=='number'||
         !Number.isInteger(minutes)||!Number.isInteger(seconds)||
         minutes<0||seconds<0||seconds>=60||minutes>525600||
         minutes*60+seconds<1)throw Error('WAIT requires a positive duration (minutes, seconds)');
      if(index===list.length-1){completed++;continue;}
      if(!top)throw Error('WAIT cannot run inside FOREACH');
      await tracedRequest('/action-formulas/schedule',{method:'POST',body:JSON.stringify({
       formula,nextStep:index+1,seconds:minutes*60+seconds,
       scope:record,variables,sessionId:typeof record.sessionId==='string'?record.sessionId:null
      })});
      completed++;
      return false;
     }
     if(step.name==='FLOW'||step.name==='SCREEN'){
      if(!runPageAction)throw Error('Page runtime unavailable');
      const mode=step.values?.[0];
      // SCREEN(Page,popup,record): the record Id is evaluated here, so an alias
      // from an earlier step (sale.Id) or @ThisPage.Cart2.recordId both work.
      const given=(node?:Expression)=>node&&!(node.kind==='literal'&&node.value===null)?node:undefined;
      const record=step.name==='SCREEN'&&given(step.values?.[1])?evaluate(step.values![1]):undefined;
      const layer=step.name==='SCREEN'?given(step.values?.[2]):undefined;
      const modeNode=given(mode);
      await runPageAction(step.name,step.object,modeNode?.kind==='reference'?modeNode.value:modeNode?.kind==='literal'?String(modeNode.value):undefined,
       record===undefined||record===null?undefined:String(record),
       layer?.kind==='literal'&&typeof layer.value==='number'?layer.value:undefined);
      completed++;
      continue;
     }
     if(step.values){
      const values=step.values.map(evaluate);
      await tracedRequest('/action-formulas/communication',{method:'POST',body:JSON.stringify({
       channel:step.name,credential:step.object,values
      })});
      completed++;
      continue;
     }
     if(step.name==='CREATEPDF'){
      const id=step.id&&evaluate(step.id);
      if(typeof id!=='string'||!recordIdPattern.test(id)||!createPdf)
       throw Error('CREATEPDF requires a published Print Template and PDF file service');
      const pdf=await createPdf(step.object,id);
      if(step.alias)variables[step.alias]=pdf;
      completed++;continue;
     }
     if(step.name==='PRINT'){
      const id=step.id&&evaluate(step.id);
      if(typeof id!=='string'||!id||!print)throw Error('Print requires a template host and a record ID');
      await print(step.object,id);
      completed++;
      continue;
     }
     let path='/records/'+encodeURIComponent(step.object);
     if(step.id){
      const id=evaluate(step.id);
      if(typeof id!=='string'||!recordIdPattern.test(id))throw Error('Expected a record ID');
      path+='/'+encodeURIComponent(id);
     }
     const method=step.name==='CREATERECORD'?'POST':step.name==='UPDATERECORD'?'PUT':'DELETE';
     const values=Object.fromEntries([...step.fields].map(([field,node])=>[field,evaluate(node)]));
     const response=await tracedRequest<{record:Record<string,unknown>}>(path,{
      method,...(method==='DELETE'?{}:{body:JSON.stringify(values)})
     });
     completed++;
     recordChanged=true;
     mutatedObjectApiNames.add(step.object);
     const savedChange={objectApiName:step.object,
      operation:method==='POST'?'create' as const:method==='PUT'?'update' as const:'delete' as const,
      record:response.record??{}};
     recordChanges.push(savedChange);
     if(step.alias){
      const alias=step.alias;
      const later=(next:ActionStep):boolean=>[...stepNodes(next),...(next.guards??[]).map(g=>g.condition)]
       .some(node=>readsResultField(node,alias))||(next.body??[]).some(later);
      const requiredFields=new Set<string>();
      const collect=(node:Expression):void=>{
       if(node.kind==='reference'&&node.value.startsWith(alias+'.')&&node.value!==alias+'.Id')
        requiredFields.add(node.value.slice(alias.length+1));
       else if(node.kind==='unary')collect(node.value);
       else if(node.kind==='binary'){collect(node.left);collect(node.right);}
       else if(node.kind==='call')node.args.forEach(collect);
      };
      const scan=(next:ActionStep):void=>{
       [...stepNodes(next),...(next.guards??[]).map(g=>g.condition)].forEach(collect);
       next.body?.forEach(scan);
      };
      list.slice(index+1).forEach(scan);
      variables[alias]=response.record;
      const hasField=(name:string):boolean=>{
       let current:unknown=response.record;
       for(const part of name.split('.')){
        if(!current||typeof current!=='object'||!Object.hasOwn(current,part))return false;
        current=(current as Record<string,unknown>)[part];
       }
       return true;
      };
      if(list.slice(index+1).some(later)&&![...requiredFields].every(hasField)){
       const id=response.record.Id;
       if(typeof id!=='string'||!recordIdPattern.test(id))throw Error('Missing saved record ID');
       const read=await tracedRequest<{record:Record<string,unknown>}>('/records/'+step.object+'/'+encodeURIComponent(id));
       variables[alias]=read.record;
       savedChange.record=read.record;
      }
     }
    }catch(error){
     if(stepTiming)stepTiming.status='failed';
     if(error instanceof Error&&error.message.includes(' confirmed action(s). '))throw error;
     throw Error(step.name+' failed after '+completed+' confirmed action(s). '+(error instanceof Error?error.message:String(error)));
    }finally{
     if(stepTiming)stepTiming.durationMs=Math.max(0,performance.now()-stepStarted);
     activeStep=previousStep;
    }
   }
   return true;
  }
  let status:'completed'|'failed'='completed';
  try{
   const variables=Object.assign(Object.create(null) as Record<string,unknown>,planWindow?.variables??{});
   await run(selectedSteps,variables,true);
   return {changes,recordChanged,mutatedObjectApiNames:[...mutatedObjectApiNames],
    recordChanges,...(planWindow?.includeVariables?{variables,completedActionCount:completed}:{})};
  }catch(error){
   status='failed';
   if(recordChanged){
    if(error instanceof PartialActionError)throw error;
    throw new PartialActionError(error instanceof Error?error.message:String(error),
     [...mutatedObjectApiNames],completed);
   }
   throw error;
  }finally{
   if(trace){
    // The identifier is a trusted format, not a formula string or tenant-supplied prose.
    const safeName=typeof formulaName==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(formulaName)
     ?formulaName:'unnamed';
    const timing:ActionPlanTiming={
     formulaName:safeName,durationMs:Math.max(0,performance.now()-started),
     stepCount,executedStepCount:traceSteps.filter(step=>step.status!=='skipped').length,
     completedActionCount:completed,requestCount,status,
     recordChanged,
     writeStepCount:traceSteps.filter(step=>['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(step.name)).length,
     skippedWriteStepCount:traceSteps.filter(step=>['CREATERECORD','UPDATERECORD','DELETERECORD'].includes(step.name)&&step.status==='skipped').length,
     steps:traceSteps
    };
    try{onTiming!(timing);}catch{/* Diagnostics must not change successful or failed action behavior. */}
   }
  }
}

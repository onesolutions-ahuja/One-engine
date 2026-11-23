import {Parser,type Expression} from './FormulaParser.js';
import {screenArguments,screenLayerArg} from './screenLayer.js';
export {screenLayerArg};
import {tokenize,PAGE_FORMULA_LIMITS} from './FormulaTokenizer.js';
import {FLOW_MARKER,isFlowMarker,isBrowserOnlyReference,parsePageReference,assignedComponent,assignedProperty} from './PageReferences.js';
import {validateFormulaFunctions} from './FormulaFunctionRegistry.js';
import {actionFormulaFunctions} from './FormulaCategories.js';
import {serializeFormulaSqlExpression} from './FormulaCategories.js';

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
/** Record aggregates resolved through the Record API (RBAC and field security apply). */
export const recordAggregateFunctions:ReadonlySet<string>=new Set(['COUNTIFS','SUMIFS','AVERAGEIFS','MINIFS','MAXIFS']);
/** Functions that need a server round-trip before the synchronous evaluator runs. */
export const serverFormulaFunctions:ReadonlySet<string>=new Set([...recordAggregateFunctions,'VERIFYPIN']);
/** True when an expression uses a server-resolved function (aggregates, VERIFYPIN). */
export function usesRecordCount(node:Expression|undefined):boolean{
 if(!node)return false;
 if(node.kind==='call')return serverFormulaFunctions.has(node.name)||node.args.some(usesRecordCount);
 if(node.kind==='binary')return usesRecordCount(node.left)||usesRecordCount(node.right);
 if(node.kind==='unary')return usesRecordCount(node.value);
 return false;
}
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
 if(/^\s*=?\s*(?:ACTIONS|CREATERECORD|UPDATERECORD|DELETERECORD|GETRECORD|STATE|LOCATION|FOREACH|CLOSESCREEN|INFOSCREEN|LOCKSCREEN|PAIRDISPLAY|PRINT|CREATEPDF|WAIT|EMAIL|WHATSAPP|SMS)\s*\(/i.test(source))return true;
 if(!/^\s*=?\s*IF\s*\(/i.test(source))return false;
 try{
  const root=new Parser(tokenize(source,PAGE_FORMULA_LIMITS),PAGE_FORMULA_LIMITS.tokens).parse();
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
  // A Yes/No question is the builder's own popup page: SCREEN(page, popup).
  if(node.name==='CONFIRMSCREEN')throw Error('CONFIRMSCREEN was removed: open your own popup page with SCREEN(page, popup)');
  if(node.name==='INFOSCREEN'){
   // INFOSCREEN(Message, [ActionsAfterOk]): a message with OK. The box closes itself.
   if(args.length<1||args.length>2)throw Error('INFOSCREEN requires a message and optional actions after OK');
   validateFormulaFunctions(args[0],'ribbon_binding');
   const body:ActionStep[]=[];
   if(args[1])add(body,args[1],[],loop);
   steps.push({name:node.name,object:'',values:[args[0]],fields:new Map(),guards,body,elseBody:[]});
   return;
  }
  if(node.name==='WAIT'){
   if(loop)throw Error('WAIT cannot run inside FOREACH');
   if(args.length!==2)throw Error('WAIT requires minutes and seconds');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   steps.push({name:'WAIT',object:'',values:args,fields:new Map(),guards});
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
   const bounds:Record<string,[number,number]>={EMAIL:[3,23],WHATSAPP:[2,22],SMS:[2,2],FLOW:[0,0],SCREEN:[0,4]};
   const [min,max]=bounds[node.name];
   if(args.length<min||args.length>max)throw Error('Invalid '+node.name+' arguments');
   args.forEach(arg=>validateFormulaFunctions(arg,'ribbon_binding'));
   if(node.name==='SCREEN'){
    // Any order after the page; kept as [mode, record, layer] (blank = not given).
    const {mode,modeGiven,record:screenRecord,layer,seconds}=screenArguments(args);
    const none:Expression={kind:'literal',value:null};
    steps.push({name:node.name,object,fields:new Map(),guards,values:[
     modeGiven?{kind:'reference',value:mode}:none,screenRecord??none,layer!==undefined?{kind:'literal',value:layer}:none,
     ...(seconds!==undefined?[{kind:'literal' as const,value:seconds}]:[])]});
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
 add(steps,new Parser(tokenize(source,PAGE_FORMULA_LIMITS),PAGE_FORMULA_LIMITS.tokens).parse(),[],false);
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

export const isScreenAction=(source:string)=>/^\s*=?\s*SCREEN\s*\(/i.test(source);
export function parseScreenAction(source:string){
 const node=new Parser(tokenize(source,PAGE_FORMULA_LIMITS),PAGE_FORMULA_LIMITS.tokens).parse();
 if(node.kind!=='call'||node.name!=='SCREEN'||node.args.length<1)
  throw Error('SCREEN requires a page API name, then optional mode, record and layer (any order)');
 const page=nameOf(node.args[0],'page API name');
 // After the page: mode, record and layer in any order (see screenArguments).
 const {mode,modeGiven,record:recordNode,layer,seconds}=screenArguments(node.args.slice(1));
 // The record the screen opens with, e.g. SCREEN(Payment,popup,@ThisPage.Cart2.recordId).
 // The caller evaluates it.
 if(recordNode)validateFormulaFunctions(recordNode,'ribbon_binding');
 const record=recordNode?serializeFormulaSqlExpression(recordNode):undefined;
 // modeGiven only matters with a layer: SCREEN(page, n) switches, SCREEN(page, current, n) may also open.
 return {page,mode,record,...(layer!==undefined?{layer,modeGiven}:{}),...(seconds!==undefined?{seconds}:{})};
}

const stepNodes=(step:ActionStep):Expression[]=>[...(step.id?[step.id]:[]),...step.fields.values(),
 ...(step.values??[]),...(step.source?[step.source]:[])];

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

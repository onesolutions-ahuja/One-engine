import type {Expression} from '../expression-engine/FormulaParser.js';
import type {CompiledPage,CompiledFormula,CompiledAction} from './compilePage.js';

/**
 * Turns a compiled page into one readable JS/TS module: the "converted
 * version" of the page that the Builder downloads.
 *
 * - Operators, IF/AND/OR/NOT and references become real JavaScript.
 * - Other formula functions call the Une formula library (fx.call), which runs
 *   the same function catalogue as the server, so results match exactly.
 * - Data loads, who-redraws-what and actions are spelled out as plain code.
 *
 * The page's metadata stays the source of truth: download again after edits.
 */
export type ScriptLanguage='ts'|'js';

const q=(value:unknown)=>JSON.stringify(value);
const comment=(text:string)=>text.replace(/\*\//g,'*\\/').replace(/\r?\n/g,' ');

/** Lazy, short-circuit forms are compiled to JS control flow. */
export function expressionToJs(node:Expression,table:Expression[]):string{
 switch(node.kind){
  case 'literal':return q(node.value);
  case 'reference':return 'ref(ctx, '+q(node.value)+')';
  case 'unary':
   return node.operator==='NOT'?'!truth('+expressionToJs(node.value,table)+')'
    :'op('+q(node.operator)+', '+expressionToJs(node.value,table)+')';
  case 'binary':{
   const left=expressionToJs(node.left,table),right=expressionToJs(node.right,table);
   if(node.operator==='AND')return '(truth('+left+') && truth('+right+'))';
   if(node.operator==='OR')return '(truth('+left+') || truth('+right+'))';
   return 'bin('+q(node.operator)+', '+left+', '+right+')';
  }
  case 'call':{
   const args=node.args.map(arg=>expressionToJs(arg,table));
   if(node.name==='IF'&&args.length===3)return '(truth('+args[0]+') ? '+args[1]+' : '+args[2]+')';
   if(node.name==='IF'&&args.length===2)return '(truth('+args[0]+') ? '+args[1]+' : false)';
   if(node.name==='AND'&&args.length)return '('+args.map(a=>'truth('+a+')').join(' && ')+')';
   if(node.name==='OR'&&args.length)return '('+args.map(a=>'truth('+a+')').join(' || ')+')';
   if(node.name==='NOT'&&args.length===1)return '!truth('+args[0]+')';
   // The library needs the original call (some functions read Object or
   // collection names, not values). It is stored once in FORMULA_NODES.
   const index=table.push(node)-1;
   return 'fx.call(ctx, '+q(node.name)+', '+index+')';
  }
 }
}
function formulaFunction(id:string,formula:CompiledFormula,table:Expression[],ts:boolean,objectApiName:string):string{
 const header='  /** '+comment(formula.property)+': '+comment(formula.source)+' */\n';
 const signature=q(id)+': (ctx'+(ts?': FormulaContext':'')+')'+(ts?': unknown':'')+' => ';
 if(!formula.ast)return header+'  '+signature+'{ throw new Error('+q('Formula error: '+(formula.error??'invalid formula'))+'); },\n';
 // Generated JS/TS binds the actual component Object, just like the Page
 // renderer. @Product.Name must not depend on a caller manually supplying it.
 const body=expressionToJs(formula.ast,table);
 return header+'  '+signature+'((ctx) => '+body+')({...ctx,objectApiName:'+q(objectApiName)+'}),\n';
}
/** Scalar functions that compile to plain JavaScript for action values. Anything
 * else (SUMIFS, COLLECTION, TABLE, date/time zone functions…) asks the platform. */
export const PURE_ACTION_FUNCTIONS:ReadonlySet<string>=new Set(['IF','AND','OR','NOT','ROUND','ROUNDUP','ROUNDDOWN','ABS','MIN','MAX',
 'TEXT','VALUE','LEN','UPPER','LOWER','TRIM','CONCAT','CONCATENATE','LEFT','RIGHT','MID','ISBLANK',
 'BLANKVALUE','NULLVALUE','IFERROR','MOD','INT','FLOOR','CEILING','SUBSTITUTE','FIND','CONTAINS','BEGINS']);
const pureActionValue=(assignment:NonNullable<CompiledAction['assignment']>)=>Boolean(assignment.ast
 &&assignment.functions.every(name=>PURE_ACTION_FUNCTIONS.has(name))
 &&assignment.references.every(ref=>/^\$(?:state|event)\.[A-Za-z][A-Za-z0-9_.]*$|^\$session$/.test(ref)));
/** Declarative action input ($event.x, $state.x, $session, $record.F, literal) as JavaScript. */
export function actionInputToJs(source:unknown):string{
 if(source===undefined)return 'undefined';
 if(source&&typeof source==='object')return 'ctx.input('+q(source)+', event)';
 if(source==='$session')return 'ctx.sessionId';
 if(source==='$event')return 'event';
 if(typeof source==='string'){
  const event=/^\$event\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/.exec(source);
  if(event)return 'ctx.pick(event, '+q(event[1].split('.'))+')';
  const state=/^\$state\.(.+)$/.exec(source);
  if(state)return 'ctx.statePath('+q(state[1])+')';
  const record=/^\$record\.([A-Za-z][A-Za-z0-9_]*)$/.exec(source);
  if(record)return 'ctx.recordField('+q(record[1])+')';
 }
 return q(source);
}
function actionFunction(id:string,action:CompiledAction,table:Expression[],ts:boolean):string{
 const signature=q(id)+': async (ctx'+(ts?': ActionContext':'')+', event'+(ts?': EventPayload':'')+')'+(ts?': Promise<ActionResult>':'')+' => ';
 const formula=action.formula??'';
 const settings=q(action.binding);
 const doc=(text:string)=>'  /** '+comment(id)+': '+comment(text)+' */\n';
 if(action.error)return doc(formula||action.kind)+'  '+signature+'{ throw new Error('+q('Action error: '+action.error)+'); },\n';
 const value=(assignment:NonNullable<CompiledAction['assignment']>)=>pureActionValue(assignment)
  // Values are worked out here, in compiled JavaScript.
  ?'((ctx) => '+expressionToJs(assignment.ast!,table)+')(ctx.formulaScope(event))'
  // Database or time-zone functions: the platform evaluates them (same rules as the server).
  :'await ctx.platformValue('+q(assignment.kind)+', '+q(assignment.value)+', event)';
 switch(action.kind){
  case 'PageState':
   return doc('set page state '+(action.stateKey??''))
    +'  '+signature+'{ ctx.setState('+q(action.stateKey)+', '+actionInputToJs(action.binding.value)+'); return { updated: true }; },\n';
  case 'ActionPlan':{
   const server=action.serverDataSteps;
   const note=server
    ?server+' of '+action.totalSteps+' step(s) run on the server from ITS compiled copy of this page, in ONE request and ONE SQL transaction'
    :action.totalSteps+' step(s) run in the browser';
   return doc(note+': '+action.steps.map(step=>step.name+(step.object?'('+step.object+')':'')).join(', '))
    +'  '+signature+'ctx.save('+q(id)+', PLANS['+q(id)+'], event),\n';
  }
  case 'Formula':
   if(action.assignment?.kind==='state')
    return doc(formula)+'  '+signature+'{ ctx.setState('+q(action.assignment.key)+', '+value(action.assignment)+'); return { updated: true }; },\n';
   return doc(formula)+'  '+signature+'ctx.runFormula('+settings+', event),\n';
  case 'Navigate':
   if(action.assignment?.kind==='navigate')
    return doc(formula)+'  '+signature+'ctx.navigateTo('+q(action.assignment.key)+', '+value(action.assignment)+'),\n';
   return doc('open '+String(action.binding.navigationTargetType??'page'))+'  '+signature+'ctx.navigate('+settings+'),\n';
  case 'SetFilter':
   if(action.assignment?.kind==='filter')
    return doc(formula)+'  '+signature+'ctx.selectFilter('+q(action.assignment.key)+', '+value(action.assignment)+', event),\n';
   return doc('select filter '+String(action.binding.filterKey??'category'))
    +'  '+signature+'ctx.selectFilter('+q(String(action.binding.filterKey||'category'))+', ctx.pick(event, ["value"]) ?? ctx.pick(event, ["label"]) ?? "", event),\n';
  case 'AdjustNumber':
   return doc('adjust number')+'  '+signature+'ctx.adjustNumber('+settings+', event),\n';
  case 'Flow':
   return doc('run Flow '+(action.flowApiName??''))+'  '+signature+'ctx.runFlow('+settings+', event),\n';
  default:
   return doc('unsupported action')+'  '+signature+'{ throw new Error('+q('Unsupported action type for '+action.event)+'); },\n';
 }
}
export function generatePageScript(compiled:CompiledPage,language:ScriptLanguage='ts'):string{
 const ts=language==='ts';
 const table:Expression[]=[];
 const formulas=compiled.components.flatMap(component=>component.formulas.map(formula=>
  formulaFunction(component.id+':'+formula.property,formula,table,ts,component.objectApiName))).join('');
 const actions=compiled.components.flatMap(component=>component.actions.map(action=>
  actionFunction(component.id+':'+action.event,action,table,ts))).join('');
 const plans=Object.fromEntries(compiled.components.flatMap(component=>component.actions
  .filter(action=>action.kind==='ActionPlan'&&!action.error)
  .map(action=>[component.id+':'+action.event,{formula:action.formula,serverDataSteps:action.serverDataSteps,
   totalSteps:action.totalSteps,writes:action.writesObjects}])));
 // The runtime runs this exact plan: formula trees are not needed at run time.
 const runtimePlan={...compiled,components:compiled.components.map(component=>({...component,
  formulas:component.formulas.map(({ast:_ast,...rest})=>rest),
  actions:component.actions.map(({assignment,...rest})=>assignment?{...rest,assignment:{...assignment,ast:null}}:rest)}))};
 const components=compiled.components.map(component=>'  '+q({
  id:component.id,type:component.type,label:component.label,parentId:component.parentId,
  mode:component.mode,object:component.objectApiName||undefined,dataSource:component.dataSourceId,
  readsState:component.stateReads,readsObjects:component.objectReads,writesState:component.stateWrites,
  ...(component.legacyReasons.length?{legacyReasons:component.legacyReasons}:{})
 })+',\n').join('');
 const sources=compiled.dataSources.map(source=>'  '+q({id:source.id,object:source.objectApiName,
  usedBy:source.components,loads:source.complete?'all rows (collection)':'50 rows, next 50 on scroll',filters:source.filters,filterLogic:source.filterLogic,
  filterFormula:source.filterFormula,reloadWhenStateChanges:source.stateInputs})+',\n').join('');
 const s=compiled.stats;
 const types=ts?`
/* ---------- Host contract (implemented by the Une page runtime) ---------- */
export type Row = Record<string, unknown>;
export type EventPayload = { value?: unknown; [key: string]: unknown };
export type ActionResult = { updated?: boolean; [key: string]: unknown };
export type PageInfo = { apiName: string; label: string; pageType: string; layoutMode: string; compilerVersion: number };
export interface FormulaContext {
  /** Current record (list components: the row being drawn). */
  record: Row;
  state: Readonly<Record<string, unknown>>;
  sessionId: string;
  /** Object context is inserted by the saved-page compiler for each component. */
  objectApiName?: string;
}
export interface ActionContext {
  sessionId: string;
  setState(key: string, value: unknown): void;
  pick(event: EventPayload, path: string[]): unknown;
  statePath(path: string): unknown;
  recordField(field: string): unknown;
  input(source: unknown, event: EventPayload): unknown;
  formulaScope(event: EventPayload): FormulaContext;
  platformValue(kind: 'state' | 'filter' | 'navigate', formula: string, event: EventPayload): Promise<unknown>;
  /** Record saves: the server runs ITS compiled copy of this action (by key). */
  save(key: string, plan: { formula: string; serverDataSteps: number; totalSteps: number; writes: string[] }, event: EventPayload): Promise<ActionResult>;
  runFormula(settings: Record<string, unknown>, event: EventPayload): Promise<ActionResult>;
  navigate(settings: Record<string, unknown>): Promise<ActionResult>;
  navigateTo(kind: string, target: unknown): Promise<ActionResult>;
  selectFilter(key: string, value: unknown, event: EventPayload): Promise<ActionResult>;
  adjustNumber(settings: Record<string, unknown>, event: EventPayload): Promise<ActionResult>;
  runFlow(settings: Record<string, unknown>, event: EventPayload): Promise<ActionResult>;
}
export interface FormulaLibrary { call(ctx: FormulaContext, name: string, node: number): unknown }
export interface PageHost {
  /** RBAC-checked Record API read: one call per data source. */
  loadRecords(source: (typeof dataSources)[number], state: Readonly<Record<string, unknown>>): Promise<Row[]>;
  formulaLibrary(nodes: readonly unknown[]): FormulaLibrary;
  operators: { ref(ctx: FormulaContext, path: string): unknown; truth(value: unknown): boolean;
    bin(operator: string, left: unknown, right: unknown): unknown; op(operator: string, value: unknown): unknown };
  render(page: PageInfo, runtime: PageRuntimeApi): void;
}
export interface PageRuntimeApi {
  formulas: ReturnType<typeof createFormulas>; actions: ReturnType<typeof createActions>;
  readers: { state: typeof stateReaders; objects: typeof objectReaders; anyObject: typeof anyObjectReaders };
}
`:'';
 return `/**
 * ${comment(compiled.label)} (${comment(compiled.apiName)}) — compiled page script
 * Generated by the Une Page Compiler v${compiled.compilerVersion}${compiled.revision!==null?' from page revision '+compiled.revision:''}.
 *
 * THIS FILE RUNS THE PAGE. The server builds it from the saved page and Preview loads it:
 * the plan, the redraw rules and every action below are what executes. Record saves run
 * on the server from the server's own compiled copy of the page (never from this text).
 * Do not edit: change the page in the Page Builder and save; it is rebuilt on every save.
 *
 * What this page does at run time:
 *  - ${s.dataSources} data load(s) for ${s.componentsWithData} data component(s): each Object + filter is read once and shared;
 *    lists load 50 rows, then the next 50 as the user scrolls.
 *  - ${s.formulas} formula(s), parsed once at compile time.
 *  - ${s.aggregateCalls} aggregate call(s) (SUMIFS, COUNTIFS, ...) collapse into ${s.distinctAggregates} distinct one(s), each asked for once per page.
 *  - ${s.actions} action(s); record saves go to the server as one request per tap.
 *  - A state change or saved record redraws only the components listed as readers.
 *  - ${s.compiled} component(s) run compiled, ${s.static} are static${s.legacy?', '+s.legacy+' still use the previous runtime (see legacyReasons)':''}.
 */
${types}
export const page = {
  apiName: ${q(compiled.apiName)},
  label: ${q(compiled.label)},
  pageType: ${q(compiled.pageType)},
  layoutMode: ${q(compiled.layoutMode)},
  compilerVersion: ${compiled.compilerVersion},
}${ts?' as const':''};

/* ---------- Components ---------- */
export const components = [
${components}]${ts?' as const':''};

/* ---------- Data: one load per Object + filter ---------- */
export const dataSources = [
${sources}]${ts?' as const':''};

/* ---------- Who redraws when something changes ---------- */
export const stateReaders${ts?': Record<string, string[]>':''} = ${JSON.stringify(compiled.stateReaders,null,2)};
export const objectReaders${ts?': Record<string, string[]>':''} = ${JSON.stringify(compiled.objectReaders,null,2)};
export const anyObjectReaders${ts?': string[]':''} = ${q(compiled.anyObjectReaders)};

/* ---------- Formulas (compiled) ---------- */
export const FORMULA_NODES = ${JSON.stringify(table)};
export function createFormulas(host${ts?': PageHost':''}) {
  const { ref, truth, bin, op } = host.operators;
  const fx = host.formulaLibrary(FORMULA_NODES);
  return {
${formulas}  }${ts?' as Record<string, (ctx: FormulaContext) => unknown>':''};
}

/* ---------- Actions (compiled to code) ---------- */
export const PLANS = ${JSON.stringify(plans,null,2)};
export function createActions(host${ts?': PageHost':''}) {
  const { ref, truth, bin, op } = host.operators;
  const fx = host.formulaLibrary(FORMULA_NODES);
  void truth; void bin; void op; void fx; void ref;
  return {
${actions}  }${ts?' as Record<string, (ctx: ActionContext, event: EventPayload) => Promise<ActionResult>>':''};
}

/* ---------- The compiled plan the runtime executes ---------- */
export const plan = ${JSON.stringify(runtimePlan)};

/** Start the page on a host (the Une page runtime implements PageHost). */
export function mountPage(host${ts?': PageHost':''}) {
  const formulas = createFormulas(host);
  const actions = createActions(host);
  host.render(page, { formulas, actions, readers: { state: stateReaders, objects: objectReaders, anyObject: anyObjectReaders } }${ts?' as never':''});
  return { plan, formulas, actions };
}
`;
}

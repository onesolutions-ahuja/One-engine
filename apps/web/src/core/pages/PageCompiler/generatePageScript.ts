import type {Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import type {CompiledPage,CompiledFormula,CompiledAction} from './compilePage';

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
function formulaFunction(id:string,formula:CompiledFormula,table:Expression[],ts:boolean):string{
 const header='  /** '+comment(formula.property)+': '+comment(formula.source)+' */\n';
 const signature=q(id)+': (ctx'+(ts?': FormulaContext':'')+')'+(ts?': unknown':'')+' => ';
 if(!formula.ast)return header+'  '+signature+'{ throw new Error('+q('Formula error: '+(formula.error??'invalid formula'))+'); },\n';
 return header+'  '+signature+expressionToJs(formula.ast,table)+',\n';
}
function actionFunction(id:string,action:CompiledAction,ts:boolean):string{
 const signature=q(id)+': async (ctx'+(ts?': ActionContext':'')+', event'+(ts?': EventPayload':'')+')'+(ts?': Promise<ActionResult>':'')+' => ';
 const formula=action.formula??'';
 if(action.error)return '  '+signature+'{ throw new Error('+q('Action error: '+action.error)+'); },\n';
 switch(action.kind){
  case 'PageState':
   return '  // Sets page state "'+comment(action.stateKey??'')+'" (no server call)\n  '+signature+'{ ctx.setState('+q(action.stateKey)+', event.value); return { updated: true }; },\n';
  case 'ActionPlan':{
   const server=action.serverDataSteps;
   const note=server
    ?server+' of '+action.totalSteps+' step(s) run on the server in ONE request and ONE SQL transaction'
    :action.totalSteps+' step(s) run in the browser';
   return '  // '+note+': '+action.steps.map(step=>step.name+(step.object?'('+step.object+')':'')).join(', ')+'\n'
    +'  '+signature+'ctx.runActionPlan('+q(formula)+', event, { serverDataSteps: '+server+', writes: '+q(action.writesObjects)+' }),\n';
  }
  case 'Formula':
   return '  '+signature+'ctx.runFormulaAction('+q(formula)+', event),\n';
  case 'Navigate':
   return '  '+signature+'ctx.navigate('+(formula?q(formula):'null')+', event),\n';
  case 'AdjustNumber':
   return '  '+signature+'ctx.adjustNumber(event),\n';
  case 'Flow':
   return '  '+signature+'ctx.runFlow('+q(action.flowApiName??'')+', event),\n';
  default:
   return '  '+signature+'ctx.runLegacyAction('+q(action.event)+', event),\n';
 }
}

export function generatePageScript(compiled:CompiledPage,language:ScriptLanguage='ts'):string{
 const ts=language==='ts';
 const table:Expression[]=[];
 const formulas=compiled.components.flatMap(component=>component.formulas.map(formula=>
  formulaFunction(component.id+':'+formula.property,formula,table,ts))).join('');
 const actions=compiled.components.flatMap(component=>component.actions.map(action=>
  actionFunction(component.id+':'+action.event,action,ts))).join('');
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
}
export interface ActionContext {
  setState(key: string, value: unknown): void;
  runActionPlan(formula: string, event: EventPayload, plan: { serverDataSteps: number; writes: string[] }): Promise<ActionResult>;
  runFormulaAction(formula: string, event: EventPayload): Promise<ActionResult>;
  navigate(target: string | null, event: EventPayload): Promise<ActionResult>;
  adjustNumber(event: EventPayload): Promise<ActionResult>;
  runFlow(flowApiName: string, event: EventPayload): Promise<ActionResult>;
  runLegacyAction(event: string, payload: EventPayload): Promise<ActionResult>;
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
  formulas: ReturnType<typeof createFormulas>; actions: typeof actions;
  readers: { state: typeof stateReaders; objects: typeof objectReaders; anyObject: typeof anyObjectReaders };
}
`:'';
 return `/**
 * ${comment(compiled.label)} (${comment(compiled.apiName)}) — compiled page script
 * Generated by the Une Page Compiler v${compiled.compilerVersion}${compiled.revision!==null?' from page revision '+compiled.revision:''}.
 *
 * READABLE COPY FOR INSPECTION ONLY. The page does not run from this file: the same compiled
 * plan (see compilePage) is what the runtime executes. Edit the page in the Page Builder;
 * the page metadata is the source of truth and is recompiled on every save.
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

/* ---------- Actions (compiled) ---------- */
export const actions = {
${actions}}${ts?' as Record<string, (ctx: ActionContext, event: EventPayload) => Promise<ActionResult>>':''};

/** Start the page on a host (the Une page runtime implements PageHost). */
export function mountPage(host${ts?': PageHost':''}) {
  const formulas = createFormulas(host);
  host.render(page, { formulas, actions, readers: { state: stateReaders, objects: objectReaders, anyObject: anyObjectReaders } }${ts?' as never':''});
}
`;
}

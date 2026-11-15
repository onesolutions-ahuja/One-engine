/**
 * Page converter: a saved page -> its real code.
 *
 * For every Smart component on the page:
 *  - each display formula becomes one plain function   (row, $) => value
 *  - each action formula becomes one async function     async ($) => { ... }
 *    The browser runs it first on the rows on screen (the button function: the
 *    change shows at once); the server runs the same code on SQL in ONE
 *    transaction (the server function) and returns the saved rows.
 *  - the rows the page needs for instant taps and totals ("record sets") are
 *    listed once, so page open loads them with the first data.
 *
 * The code is generated from the page metadata in SQL (the master copy) on save
 * / publish and cached per page revision. The Builder never edits this code.
 */
import type {CompiledPage} from '../compilePage.js';
import {compileActionFormula,compileDisplayFormula,FormulaCodeError,type RecordSetNeed} from './generateCode.js';
import {F,O} from './formulaLibrary.js';

export const PAGE_CODE_VERSION=2;
export type PageCodeAction={key:string;componentId:string;event:string;objectApiName:string;js:string;
 data:boolean;reads:string[];writes:string[];ui:string[]};
export type PageCodeFormula={key:string;componentId:string;property:string;source:string;objectApiName:string;js:string};
export type PageCodeIssue={componentId:string;where:string;source:string;error:string};
export type PageCode={
 version:number;formulas:PageCodeFormula[];actions:PageCodeAction[];recordSets:RecordSetNeed[];
 /** Formulas/actions the converter could not turn into code (shown in the Builder). */
 issues:PageCodeIssue[];
};

/** Drop a held set when another set of the same rows has a subset of its criteria (it already holds them). */
function reduceSets(sets:RecordSetNeed[]):RecordSetNeed[]{
 const covers=(wide:RecordSetNeed,narrow:RecordSetNeed)=>wide!==narrow&&wide.object===narrow.object
  &&JSON.stringify(wide.parent??null)===JSON.stringify(narrow.parent??null)
  &&wide.criteria.length<narrow.criteria.length
  &&wide.criteria.every(c=>narrow.criteria.some(n=>n.field===c.field&&n.js===c.js));
 const kept=sets.filter(set=>!sets.some(other=>covers(other,set)));
 // Children of a dropped parent point at the set that holds those rows now.
 const replaced=new Map(sets.filter(set=>!kept.includes(set))
  .map(set=>[set.key,kept.find(other=>covers(other,set))!.key]));
 return kept.map(set=>set.parent&&replaced.has(set.parent.key)?{...set,parent:{...set.parent,key:replaced.get(set.parent.key)!}}:set);
}

export function buildPageCode(compiled:CompiledPage):PageCode{
 const formulas:PageCodeFormula[]=[],actions:PageCodeAction[]=[],issues:PageCodeIssue[]=[];
 const sets:RecordSetNeed[]=[];
 const addSets=(found:readonly RecordSetNeed[])=>{for(const set of found)if(!sets.some(s=>s.key===set.key))sets.push(set);};
 for(const component of compiled.components){
  const object=component.objectApiName??'';
  for(const formula of component.formulas){
   if(formula.property.startsWith('actionFlows.'))continue;
   try{
    const code=compileDisplayFormula(formula.source,object);
    formulas.push({key:component.id+':'+formula.property,componentId:component.id,property:formula.property,
     source:formula.source,objectApiName:object,js:code.js});
    addSets(code.sets);
   }catch(error){
    issues.push({componentId:component.id,where:formula.property,source:formula.source,
     error:error instanceof Error?error.message:String(error)});
   }
  }
  for(const action of component.actions){
   const source=action.formula??'';
   if(action.kind!=='Formula'&&action.kind!=='ActionPlan'&&action.kind!=='PageState'&&action.kind!=='Navigate')continue;
   if(!source.trim())continue;
   try{
    const code=compileActionFormula(source,object);
    actions.push({key:component.id+':'+action.event,componentId:component.id,event:action.event,objectApiName:object,
     js:code.js,data:code.data,reads:code.reads,writes:code.writes,ui:code.ui});
    addSets(code.sets);
   }catch(error){
    if(!(error instanceof FormulaCodeError)&&!(error instanceof Error))throw error;
    issues.push({componentId:component.id,where:'actionFlows.'+action.event,source,error:error instanceof Error?error.message:String(error)});
   }
  }
 }
 return {version:PAGE_CODE_VERSION,formulas,actions,recordSets:reduceSets(sets),issues};
}

const q=(value:unknown)=>JSON.stringify(value);
/** The object literal both the page module and the server evaluate. */
function codeBody(code:PageCode,withFormulas:boolean):string{
 const formulas=withFormulas?code.formulas.map(f=>'    /** '+f.property.replace(/\*\//g,'')+' */\n    '+q(f.key)+': '+f.js+',\n').join(''):'';
 const sources=withFormulas?code.formulas.map(f=>'    '+q(f.key)+': '+q(f.source)+',\n').join(''):'';
 const actions=code.actions.map(a=>'    '+q(a.key)+': {\n      data: '+a.data+', reads: '+q(a.reads)+', writes: '+q(a.writes)+', ui: '+q(a.ui)
  +',\n      run: '+a.js.replace(/\n/g,'\n      ')+'\n    },\n').join('');
 const sets=code.recordSets.map(set=>'    { key: '+q(set.key)+', object: '+q(set.object)+(set.parent?', parent: '+q(set.parent):'')
  +', criteria: ($) => ['+set.criteria.map(c=>'['+q(c.field)+', '+c.js+']').join(', ')+'] },\n').join('');
 return '{\n  formulas: {\n'+formulas+'  },\n  sources: {\n'+sources+'  },\n  actions: {\n'+actions+'  },\n  recordSets: [\n'+sets+'  ]\n}';
}
/** ES module text for the page file (appended to the page script the browser imports). */
export function pageCodeModule(code:PageCode):string{
 return `
/* ===================== Page code (v${code.version}) =====================
 * Generated from the saved page. Display formulas are plain functions; each
 * action is ONE function: the browser runs it on the rows on screen first (the
 * change shows at once), the server runs the same code in ONE SQL transaction.
 * ${code.issues.length} formula(s) could not be converted${code.issues.length?' (see codeIssues)':''}.
 */
export const codeVersion = ${code.version};
export const codeIssues = ${JSON.stringify(code.issues)};
export function createCode(F, O) {
  return ${codeBody(code,true).replace(/\n/g,'\n  ')};
}
`;
}
export type ServerPageCode={
 actions:Record<string,{data:boolean;reads:string[];writes:string[];ui:string[];run:(scope:unknown)=>Promise<void>}>;
 recordSets:Array<{key:string;object:string;parent?:{key:string;field:string};criteria:(scope:unknown)=>Array<[string,unknown]>}>;
};
/** The server's own copy of the page code (built from the saved page, never from the browser). */
export function serverPageCode(code:PageCode):ServerPageCode{
 // Generated by buildPageCode from validated formula trees only: names are checked
 // against strict patterns and every literal is JSON-encoded.
 // eslint-disable-next-line @typescript-eslint/no-implied-eval
 return new Function('F','O','return '+codeBody(code,false))(F,O) as ServerPageCode;
}

import {Parser} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';

/** The same formula written differently (spaces, brackets, "=" prefix, or rewritten by the
 * page runtime) has the same parsed form: converted page code is found by that form. */
const cache=new Map();
export function formulaShape(text){
 if(typeof text!=='string'||!text.trim()||text.length>4000)return null;
 if(cache.has(text))return cache.get(text);
 let shape=null;
 try{shape=JSON.stringify(new Parser(tokenize(text.trim().replace(/^=\s*/,''))).parse());}catch{shape=null;}
 if(cache.size>2000)cache.clear();
 cache.set(text,shape);
 return shape;
}
/** Converted function for a formula text: exact text first, then the same parsed form. */
export function convertedFormula(functions,text){
 if(!(functions instanceof Map)||typeof text!=='string')return null;
 const exact=functions.get(text.trim());
 if(exact)return exact;
 const shape=formulaShape(text);
 return shape?functions.get('shape:'+shape)??null:null;
}

/** True when a text is written as a formula ("=...", or an @Object.Field mention). */
const formulaLike=text=>typeof text==='string'&&(/^\s*=/.test(text)||/@[A-Za-z]/.test(text));
/** The page code function for a formula a component holds: the page file's function
 * first, else the host converts the text with the same converter (never an interpreter).
 * Returns null for plain text. Throws the converter's error for a formula it cannot convert. */
const CONVERTER=Symbol.for('une.formulaCompilers');
/** The converter for a component: the page's own (its `$`), else the one the app registered
 * (formulaText.ts: same converter, standalone `$` built from this component's page values). */
export function formulaConverter(p){
 const code=p&&p.__formulaCode;
 if(code&&typeof code.compile==='function')return code;
 const make=globalThis[CONVERTER];
 return typeof make==='function'?make(()=>({pageState:p?.pageState,sessionId:p?.sessionId,
  readComponent:p?.readComponent,rowObject:typeof p?.objectApiName==='string'?p.objectApiName:''})):null;
}
export function componentFormula(p,text){
 if(typeof text!=='string'||!text.trim())return null;
 const code=p&&p.__formulaCode;
 const found=code&&code.functions instanceof Map?convertedFormula(code.functions,text):null;
 if(found)return found;
 const converter=formulaConverter(p);
 if(converter)return converter.compile(text);
 if(formulaLike(text))throw Error('This formula is not converted: save the page again');
 return null;
}
/** Run a component formula on a row: {value} or {value:'', error}. Plain text comes back as written.
 * A total still loading (or over rows not on this page) shows blank, not an error. */
export function runComponentFormula(p,text,row){
 try{
  const run=componentFormula(p,text);
  if(!run)return {value:text??''};
  return {value:run(row||{})};
 }catch(error){
  if(error&&error.notHeld===true)return {value:''};
  return {value:'',error:error instanceof Error?error.message:'Formula failed'};
 }
}

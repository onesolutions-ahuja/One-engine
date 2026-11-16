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

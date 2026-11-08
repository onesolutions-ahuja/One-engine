import type {FlowNodeContext,FlowActionResult} from './NodeContext.js';

/** Generic no-code Flow JSON selector. Accepts only bounded, literal paths. */
const name=/^[A-Za-z][A-Za-z0-9_]*$/;
const jsonPath=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[(?:0|[1-9][0-9]{0,2})\])*$/;
export function extractJsonScalar(document:unknown,path:string):string|number|boolean|null {
 if(!jsonPath.test(path)||path.length>256)throw new Error('Invalid JSON selector path');
 const tokens=path.match(/[A-Za-z][A-Za-z0-9_]*|\d+/g)??[];
 let value:unknown=document;
 for(const token of tokens){
  if(!value||typeof value!=='object'||!Object.hasOwn(value,token))return null;
  value=(value as Record<string,unknown>)[token];
 }
 if(value===undefined||value===null)return null;
 if(typeof value==='string'){
  if(value.length>4096)throw new Error('JSON selector text exceeds limit');
  return value;
 }
 if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 throw new Error('JSON selector expected a scalar value');
}
/** Generic parsing and field-mapping node, reusable by all apps and providers. */
export function executeParseJsonNode(context:FlowNodeContext):FlowActionResult {
 const {node,vars,evaluate}=context;
 const source=evaluate(node.config.source);
 if(typeof source!=='string'||source.length>262144)throw new Error('JSON source must be bounded Text');
 let parsed:unknown;
 try{parsed=JSON.parse(source);}catch{throw new Error('Flow JSON source is invalid');}
 const assignments=node.config.assignments;
 if(!Array.isArray(assignments)||!assignments.length||assignments.length>50)
  throw new Error('Parse JSON needs 1 to 50 mappings');
 for(const entry of assignments){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))
   throw new Error('Invalid JSON field mapping');
  const {path,outputVariable}=entry as Record<string,unknown>;
  if(typeof path!=='string'||typeof outputVariable!=='string'||!name.test(outputVariable))
   throw new Error('Invalid JSON mapping');
  vars[outputVariable]=extractJsonScalar(parsed,path);
 }
 return {handled:true};
}

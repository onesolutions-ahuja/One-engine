import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import {componentFromElement,cssRules} from './pageSourceShape.js';
import {readNames,smartAttrs,uiImports,type PageCodeNames} from './pageCodeNames.js';
import type {PageComponentLike} from './generatePageSource.js';

/**
 * Code files -> the page they describe, WITHOUT running them (the server never runs code a
 * tenant may have edited). The .tsx is turned into plain JavaScript by esbuild and read as a
 * syntax tree (acorn); only plain values are taken. What is not a plain value (a function a
 * developer wrote) is reported: it still runs on the device, the server cannot use it.
 *
 * The page read back is what the server compiles: the screen plan, the record sets and its
 * own copy of every action (from each action's formula). generatePageSource + readPageSource
 * give back the page they started from.
 */
export type ReadPage={page:Record<string,unknown>&{components:PageComponentLike[]};issues:string[]};
type Node={type:string;[key:string]:any};
type Parse=(code:string,options:Record<string,unknown>)=>Node;
let parser:Parse|null=null;
function parse(code:string):Node{
 parser??=(createRequire(import.meta.url)('acorn') as {parse:Parse}).parse;
 return parser(code,{ecmaVersion:'latest',sourceType:'module'});
}
const NOT_PLAIN=Symbol('not a plain value');
import type {SourceRef as Ref} from './pageSourceShape.js';

/** A literal value (JSON-like) from the syntax tree, or a reference f[...] / a[...]. */
function valueOf(node:Node|null|undefined):unknown{
 if(!node)return NOT_PLAIN;
 switch(node.type){
  case 'Literal':return node.regex?NOT_PLAIN:node.value;
  case 'TemplateLiteral':return node.expressions.length?NOT_PLAIN:node.quasis.map((part:Node)=>part.value.cooked).join('');
  case 'UnaryExpression':{
   const value=valueOf(node.argument);
   if(node.operator==='-'&&typeof value==='number')return -value;
   if(node.operator==='!'&&typeof value==='number')return !value;
   return NOT_PLAIN;
  }
  case 'Identifier':return node.name==='undefined'?undefined:NOT_PLAIN;
  case 'ArrayExpression':{
   const out:unknown[]=[];
   for(const item of node.elements){const value=valueOf(item);if(value===NOT_PLAIN)return NOT_PLAIN;out.push(value);}
   return out;
  }
  case 'ObjectExpression':{
   const out:Record<string,unknown>={};
   for(const property of node.properties){
    if(property.type==='SpreadElement'){
     const spread=valueOf(property.argument);
     if(!spread||typeof spread!=='object'||Array.isArray(spread))return NOT_PLAIN;
     Object.assign(out,spread);continue;
    }
    if(property.computed||property.kind!=='init'||property.method)return NOT_PLAIN;
    const key=property.key.type==='Identifier'?property.key.name:String(property.key.value);
    const value=valueOf(property.value);
    if(value===NOT_PLAIN)return NOT_PLAIN;
    Object.defineProperty(out,key,{value,enumerable:true,writable:true,configurable:true});
   }
   return out;
  }
  case 'MemberExpression':{
   // f.pay.label / a.pay.click (by component name), or f["<id>:<property>"] (older files).
   const path:string[]=[];
   let at:Node=node;
   while(at.type==='MemberExpression'){
    const part=at.computed?(at.property.type==='Literal'&&typeof at.property.value==='string'?at.property.value:null)
     :at.property.type==='Identifier'?at.property.name:null;
    if(part===null)return NOT_PLAIN;
    path.unshift(part);at=at.object;
   }
   if(at.type==='Identifier'&&(at.name==='f'||at.name==='a')&&(path.length===1||path.length===2))
    return {ref:at.name,key:path.join('.')} satisfies Ref;
   return NOT_PLAIN;
  }
  default:return NOT_PLAIN;
 }
}

/** `export const <name> = { … }` as a syntax tree (the formulas / actions file). The file is
 * read as written (esbuild only removes the TypeScript; it may move the export to the end). */
function exportedObject(code:string,name:string):Node|null{
 if(!code.trim())return null;
 const tree=parse(transformSync(code,{loader:'ts',format:'esm'}).code);
 let found:Node|null=null,exported=false;
 for(const statement of tree.body){
  const declaration=statement.type==='ExportNamedDeclaration'?statement.declaration
   :statement.type==='VariableDeclaration'?statement:null;
  for(const item of declaration?.declarations??[])
   if(item.id?.name===name&&item.init?.type==='ObjectExpression'){
    found=item.init;
    if(statement.type==='ExportNamedDeclaration')exported=true;
   }
  if(statement.type==='ExportNamedDeclaration'&&!statement.declaration)
   for(const specifier of statement.specifiers??[])if(specifier.exported?.name===name&&specifier.local?.name===name)exported=true;
 }
 return exported?found:null;
}
const keyName=(property:Node):string=>property.key.type==='Identifier'?property.key.name:String(property.key.value);
/** The plain fields of each entry ({ source: "…", flow: {…}, … }); code fields are skipped.
 * Entries are grouped by component name ("pay.click"); older files are flat ("<id>:click"). */
function entries(code:string,name:string):Map<string,Record<string,unknown>>{
 const out=new Map<string,Record<string,unknown>>();
 const object=exportedObject(code,name);
 const fieldsOf=(entry:Node):Record<string,unknown>=>{
  const fields:Record<string,unknown>={};
  for(const field of entry.properties){
   if(field.type!=='Property')continue;
   const value=valueOf(field.value);
   if(value!==NOT_PLAIN)fields[keyName(field)]=value;
   else fields[keyName(field)+'#code']=true;
  }
  return fields;
 };
 for(const property of object?.properties??[]){
  if(property.type!=='Property'||property.value.type!=='ObjectExpression')continue;
  const group=keyName(property);
  if(group.includes(':')){out.set(group,fieldsOf(property.value));continue;}
  for(const part of property.value.properties){
   if(part.type!=='Property'||part.value.type!=='ObjectExpression')continue;
   const fields=fieldsOf(part.value);
   if(fields.event===undefined)fields.event=keyName(part);
   out.set(group+'.'+keyName(part),fields);
  }
 }
 return out;
}

/** The component elements of the page (<Button …/> from '@une/ui', or <Smart …/> in older
 * files), in order, with their attributes as plain values. */
function smartElements(tsx:string,names:PageCodeNames|null):Array<{attrs:Record<string,unknown>;notPlain:string[]}>{
 const tags=uiImports(tsx);
 const js=transformSync(tsx,{loader:'tsx',format:'esm',jsx:'transform',jsxFactory:'h',jsxFragment:'Fragment'}).code;
 const out:Array<{attrs:Record<string,unknown>;notPlain:string[]}>=[];
 const walk=(node:unknown):void=>{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)walk(item);return;}
  const n=node as Node;
  const tagName=n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='h'
   &&n.arguments[0]?.type==='Identifier'?String(n.arguments[0].name):'';
  if(tagName==='Smart'||tags.has(tagName)){
   const attrs:Record<string,unknown>={},notPlain:string[]=[];
   const props=n.arguments[1];
   const take=(object:Node)=>{
    for(const property of object.properties){
     if(property.type==='SpreadElement'){
      if(property.argument.type==='ObjectExpression')take(property.argument);
      else notPlain.push('...');
      continue;
     }
     const key=keyName(property),value=valueOf(property.value);
     if(value===NOT_PLAIN)notPlain.push(key);else attrs[key]=value;
    }
   };
   if(props?.type==='ObjectExpression')take(props);
   out.push({attrs:tagName==='Smart'?attrs:smartAttrs(tags.get(tagName)!,attrs,names),notPlain});
  }
  for(const [key,value] of Object.entries(n))if(key!=='type'&&value&&typeof value==='object')walk(value);
 };
 walk(parse(js));
 return out;
}

/** Read a page's code files (path -> content) back into the page. */
export function readPageSource(files:Record<string,string>,pageApi:string):ReadPage{
 const issues:string[]=[];
 const file=(suffix:string)=>files[pageApi+suffix]??'';
 let settings:Record<string,unknown>={};
 try{
  const manifest=JSON.parse(files['manifest.json']??'{}');
  if(manifest?.settings&&typeof manifest.settings==='object')settings=manifest.settings;
 }catch{issues.push('manifest.json is not valid JSON');}
 const formulas=entries(file('.formulas.ts'),'formulas');
 const actions=entries(file('.actions.ts'),'actions');
 const css=cssRules(file('.css'));
 const components:PageComponentLike[]=[];
 for(const {attrs,notPlain} of smartElements(file('.tsx'),readNames(files['manifest.json']))){
  const id=typeof attrs.id==='string'?attrs.id:'';
  for(const key of notPlain)issues.push((id||'?')+'.'+key+': not a plain value (it runs on the device; the server cannot use it)');
  const made=componentFromElement(attrs,css,{
   formula:key=>formulas.get(key)?.source,
   action:key=>{const entry=actions.get(key);return entry?{event:entry.event,flow:entry.flow}:undefined;}
  });
  issues.push(...made.issues);
  if(made.component)components.push(made.component);
 }
 return {page:{...settings,components},issues};
}

/** Values as the page stores them, for comparing a page with the page read back from its code. */
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){
  const out:Record<string,unknown>={};
  for(const key of Object.keys(value).sort()){
   const item=(value as Record<string,unknown>)[key];
   if(item!==undefined)out[key]=canonical(item);
  }
  return out;
 }
 return value;
}
const componentShape=(c:PageComponentLike)=>canonical({id:c.id,type:c.type,label:c.label,visible:c.visible!==false,
 region:c.region,position:c.position&&Object.keys(c.position).length?c.position:undefined,properties:c.properties??{}});

/** What differs between a page and the page read back from its code ([] = nothing lost). */
export function pageDifferences(original:{components?:PageComponentLike[]}&Record<string,unknown>,
 read:{components:PageComponentLike[]}&Record<string,unknown>):string[]{
 const out:string[]=[];
 const before=(original.components??[]).filter(c=>c&&typeof c==='object');
 if(before.length!==read.components.length)out.push('components: '+before.length+' -> '+read.components.length);
 before.forEach((component,index)=>{
  const after=read.components[index];
  const a=JSON.stringify(componentShape(component)),b=after?JSON.stringify(componentShape(after)):'';
  if(a===b)return;
  if(!after||after.id!==component.id){out.push('component '+index+': '+String(component.id)+' -> '+String(after?.id));return;}
  const pa=(componentShape(component) as {properties:Record<string,unknown>}).properties;
  const pb=(componentShape(after) as {properties:Record<string,unknown>}).properties;
  for(const key of new Set([...Object.keys(pa),...Object.keys(pb)]))
   if(JSON.stringify(pa[key])!==JSON.stringify(pb[key]))out.push(String(component.id)+'.'+key);
  const rest=(c:PageComponentLike)=>JSON.stringify({...componentShape(c) as object,properties:null});
  if(rest(component)!==rest(after))out.push(String(component.id)+': id/type/label/visible/position');
 });
 for(const key of Object.keys(original))if(key!=='components'&&!['draftRevision','readonlyVersion','updatedAt'].includes(key)
  &&JSON.stringify(canonical(original[key]))!==JSON.stringify(canonical(read[key])))out.push('page.'+key);
 return out;
}

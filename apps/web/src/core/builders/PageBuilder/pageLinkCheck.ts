import {Parser,type Expression} from '../../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';

/**
 * Broken links: a component that opens a page which no longer exists (deleted or renamed).
 * Looks at every saved property of a component, at any depth: Navigate actions
 * (navigationPageApiName), SCREEN(page, ...) in any formula, and @navigate.page := "app/page".
 * Used to mark the component red on the canvas and to stop Publish until it is fixed.
 */
type Component={id:string;label?:string;properties:Readonly<Record<string,unknown>>};
type KnownPage={apiName:string};
export type BrokenLink={componentId:string;component:string;page:string;message:string};

const parsedTargets=new Map<string,readonly string[]>();
/** Page names a formula opens with SCREEN(...) (only fixed names: a computed one cannot be checked). */
export function screenTargetsIn(formula:string):readonly string[]{
 if(!/SCREEN\s*\(/i.test(formula))return [];
 const cached=parsedTargets.get(formula);
 if(cached)return cached;
 const found=new Set<string>();
 const visit=(node:Expression|undefined):void=>{
  if(!node)return;
  if(node.kind==='call'){
   if(node.name.toUpperCase()==='SCREEN'){
    const first=node.args[0];
    const name=first?.kind==='reference'||first?.kind==='literal'?String(first.value??''):'';
    if(/^[A-Za-z][A-Za-z0-9_]*$/.test(name))found.add(name);
   }
   node.args.forEach(visit);
  }else if(node.kind==='unary')visit(node.value);
  else if(node.kind==='binary'){visit(node.left);visit(node.right);}
 };
 try{visit(new Parser(tokenize(formula.trim().replace(/^=\s*/,''))).parse());}
 catch{
  // Action plans (several steps, := assignments) do not parse as one formula: read each SCREEN(name.
  for(const match of formula.matchAll(/SCREEN\s*\(\s*["']?([A-Za-z][A-Za-z0-9_]*)/gi))found.add(match[1]);
 }
 const result=[...found];
 if(parsedTargets.size>2000)parsedTargets.clear();
 parsedTargets.set(formula,result);
 return result;
}

/** Every page a component's saved properties open. */
export function linkedPages(properties:Readonly<Record<string,unknown>>):string[]{
 const found=new Set<string>();
 const seen=new WeakSet<object>();
 const visit=(value:unknown,depth:number):void=>{
  if(depth>8||value===null||value===undefined)return;
  if(typeof value==='string'){
   for(const name of screenTargetsIn(value))found.add(name);
   for(const match of value.matchAll(/@navigate\.page\s*:=\s*["']([^"'/]*)\/([A-Za-z][A-Za-z0-9_]*)["']/gi))found.add(match[2]);
   return;
  }
  if(typeof value!=='object'||seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  const record=value as Record<string,unknown>;
  if(record.navigationTargetType==='App Page'&&typeof record.navigationPageApiName==='string'
   &&/^[A-Za-z][A-Za-z0-9_]*$/.test(record.navigationPageApiName))found.add(record.navigationPageApiName);
  for(const child of Object.values(record))visit(child,depth+1);
 };
 visit(properties,0);
 return [...found];
}

const resultCache=new WeakMap<readonly Component[],{pages:readonly KnownPage[];links:BrokenLink[]}>();
/** Broken links of one page's components, given every page that exists. */
export function brokenPageLinks(components:readonly Component[],pages:readonly KnownPage[]):BrokenLink[]{
 const cached=resultCache.get(components);
 if(cached&&cached.pages===pages)return cached.links;
 const known=new Set(pages.map(page=>page.apiName.toLowerCase()));
 const links:BrokenLink[]=[];
 for(const component of components){
  const name=typeof component.properties?.navigatorName==='string'&&component.properties.navigatorName
   ?component.properties.navigatorName:component.label||component.id;
  for(const page of linkedPages(component.properties??{})){
   if(known.has(page.toLowerCase()))continue;
   links.push({componentId:component.id,component:String(name),page,
    message:'Opens page "'+page+'", which no longer exists'});
  }
 }
 resultCache.set(components,{pages,links});
 return links;
}

/** Component ids with a broken link (for the red mark on the canvas). */
export function brokenLinkIds(components:readonly Component[],pages:readonly KnownPage[]):Map<string,string>{
 const ids=new Map<string,string>();
 for(const link of brokenPageLinks(components,pages))
  ids.set(link.componentId,(ids.get(link.componentId)?ids.get(link.componentId)+'\n':'')+link.message);
 return ids;
}

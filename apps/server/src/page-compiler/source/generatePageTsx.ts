import type {PageCode} from '../code/pageCode.js';
import type {PageComponentLike,SourceIssue} from './generatePageSource.js';
import {componentId,componentName,isFormula,propsOf,safeName,STYLE_KEYS} from './generatePageCss.js';

/** Properties that are never written as props (style keys are skipped only when they are not formulas). */
const SKIP_KEYS=new Set(['navigatorName','layoutParentId','libraryComponentId','editorLocked','actionFlows','pageLayer']);
const SKIP_PREFIXES=['pagePropertyContract','visibilityRules'];
const STYLE=new Set<string>(STYLE_KEYS);
/** Attributes the element already sets itself. */
const RESERVED=new Set(['type','name','className','key','ref','children','hidden','layer']);
const ATTR=/^[A-Za-z_][A-Za-z0-9_-]*$/;
const PLAIN_STRING=/^[^"\\&<>{}\r\n\u2028\u2029]*$/;

/** Single-quoted JS string, used for f['key'] and a['key']. */
const sq=(value:string):string=>"'"+value.replace(/[\\']/g,'\\$&').replace(/\n/g,'\\n').replace(/\r/g,'\\r')
 .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')+"'";
/** key={expr}; a key that is not a valid JSX attribute name goes through a spread so nothing is lost. */
const attr=(key:string,expr:string):string=>ATTR.test(key)?key+'={'+expr+'}':'{...{'+JSON.stringify(key)+':'+expr+'}}';
const strAttr=(key:string,value:string):string=>
 ATTR.test(key)&&PLAIN_STRING.test(value)?key+'="'+value+'"':attr(key,JSON.stringify(value));

function valueAttr(key:string,value:unknown):string|null{
 if(typeof value==='string')return strAttr(key,value);
 if(typeof value==='number')return Number.isFinite(value)?attr(key,String(value)):null;
 if(typeof value==='boolean')return attr(key,String(value));
 if(value===null)return attr(key,'null');
 if(typeof value==='object'){
  try{return attr(key,JSON.stringify(value));}catch{return null;}
 }
 return null;
}

export function generatePageTsx(input:{
 header:string;page:string;pageClass:string;components:PageComponentLike[];pageCode:PageCode;
},issues:SourceIssue[]):string{
 const formulaKeys=new Map<string,string>();
 for(const f of input.pageCode?.formulas??[])formulaKeys.set(f.componentId+'\u0000'+f.property,f.key);
 const actionKeys=new Map<string,string>();
 for(const a of input.pageCode?.actions??[])actionKeys.set(a.componentId+'\u0000'+a.event,a.key);

 const components=input.components.filter(c=>c&&typeof c==='object');
 const byId=new Map<string,PageComponentLike>();
 for(const c of components)if(!byId.has(componentId(c)))byId.set(componentId(c),c);

 // Parent of each component: only a real, different, non-cyclic container counts.
 const rawParent=(c:PageComponentLike):string|undefined=>{
  const p=propsOf(c).layoutParentId;
  return typeof p==='string'&&p?p:undefined;
 };
 const parentOf=new Map<PageComponentLike,string|undefined>();
 for(const c of components){
  const first=rawParent(c);
  if(first===undefined){parentOf.set(c,undefined);continue;}
  if(!byId.has(first)||first===componentId(c)){
   issues.push({componentName:componentName(c),message:'Parent container not found: '+first});
   parentOf.set(c,undefined);continue;
  }
  const seen=new Set<string>([componentId(c)]);
  let current:string|undefined=first,cycle=false;
  while(current!==undefined){
   if(seen.has(current)){cycle=true;break;}
   seen.add(current);
   const up:PageComponentLike|undefined=byId.get(current);
   current=up?rawParent(up):undefined;
   if(current!==undefined&&!byId.has(current))current=undefined;
  }
  if(cycle)issues.push({componentName:componentName(c),message:'Parent container loop: '+first});
  parentOf.set(c,cycle?undefined:first);
 }
 const children=new Map<string,PageComponentLike[]>();
 const roots:PageComponentLike[]=[];
 for(const c of components){
  const parent=parentOf.get(c);
  if(parent===undefined)roots.push(c);
  else children.set(parent,[...(children.get(parent)??[]),c]);
 }

 const emitted=new Set<PageComponentLike>();
 const out:string[]=[];
 const element=(c:PageComponentLike,depth:number)=>{
  if(emitted.has(c))return;
  emitted.add(c);
  const id=componentId(c),name=componentName(c),props=propsOf(c);
  const indent='  '.repeat(depth);
  const type=String(c.type??'').replace(/^Custom:/,'');
  if(!type)issues.push({componentName:name,message:'Component has no type'});
  const attrs:string[]=[strAttr('type',type),strAttr('name',name),'className="c-'+safeName(name)+'"'];
  if(c.visible===false)attrs.push('hidden');
  const layer=Number(props.pageLayer);
  if(props.pageLayer!==undefined&&Number.isFinite(layer)&&layer!==0)attrs.push('layer={'+layer+'}');
  // The component's own label is a prop too, unless properties already carry one.
  const entries:Array<[string,unknown]>=Object.entries(props);
  if(typeof c.label==='string'&&props.label===undefined)entries.unshift(['label',c.label]);
  for(const [key,value] of entries){
   if(SKIP_KEYS.has(key)||SKIP_PREFIXES.some(p=>key.startsWith(p)))continue;
   if(STYLE.has(key)&&!isFormula(value))continue;
   if(RESERVED.has(key)){issues.push({componentName:name,message:'Property name is reserved: '+key});continue;}
   if(isFormula(value)){
    const fk=formulaKeys.get(id+'\u0000'+key);
    if(fk!==undefined)attrs.push(attr(key,'f['+sq(fk)+']'));
    else{
     issues.push({componentName:name,message:'Formula not converted: '+key});
     attrs.push(strAttr(key,value));
    }
    continue;
   }
   const literal=valueAttr(key,value);
   if(literal!==null)attrs.push(literal);
   else if(value!==undefined)issues.push({componentName:name,message:'Property not written: '+key});
  }
  const flows=props.actionFlows;
  if(flows&&typeof flows==='object'&&!Array.isArray(flows)){
   for(const event of Object.keys(flows)){
    const ak=actionKeys.get(id+'\u0000'+event);
    if(ak===undefined){issues.push({componentName:name,message:'Action not converted: '+event});continue;}
    attrs.push(attr('on'+event.charAt(0).toUpperCase()+event.slice(1),'a['+sq(ak)+']'));
   }
  }
  const kids=children.get(id)??[];
  const open='<Smart '+attrs.join(' ');
  if(!kids.length){out.push(indent+open+' />');return;}
  out.push(indent+open+'>');
  for(const kid of kids)element(kid,depth+1);
  out.push(indent+'</Smart>');
 };
 for(const root of roots)element(root,3);

 return [
  input.header,
  "import {Smart} from '@une/smart';",
  "import {formulas as f} from './"+input.page+".formulas';",
  "import {actions as a} from './"+input.page+".actions';",
  "import './"+input.page+".css';",
  '',
  'export default function Page(){',
  '  return (',
  '    <div className="page-'+input.pageClass+'">',
  ...out,
  '    </div>',
  '  );',
  '}',
  ''
 ].join('\n');
}

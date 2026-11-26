import type {PageComponentLike,SourceIssue} from './generatePageSource.js';
import {classNames,componentId,componentName,cssStyleKeys,isFormula,propsOf} from './generatePageCss.js';
import {defaultLabel,uiTag,type PageCodeNames} from './pageCodeNames.js';

/**
 * The page as a React component, as a person would write it: one tag per component from
 * '@une/ui' (<Button>, <CardGrid>, …) in page order, its name as className, its settings as
 * props, formulas as f.<name>.<property> and actions as a.<name>.<event>.
 *
 *  - name, hidden, layer           the component itself (name only when it differs from className)
 *  - every other property          a literal prop, or f.<name>.<property> for a formula
 *  - on<Event>={a.<name>.<event>}  the component's actions (actions.ts holds the flow)
 *  - position and look             the .css file (className)
 *  - id, type, label, region       manifest.json "names" (the code does not need them)
 */
const ATTR=/^[A-Za-z_][A-Za-z0-9_]*$/;
const PLAIN_STRING=/^[^"\\&<>{}\r\n\u2028\u2029]*$/;
/** Attribute names the element itself uses: a property with one of these names is written as "prop:<name>". */
export const RESERVED_ATTRS=new Set(['id','type','name','className','key','ref','children','hidden','layer','parent',
 'componentLabel','region','position']);
/** Properties written elsewhere (layer, actions, name). layoutParentId stays a prop: the
 * components keep their exact page order (the order decides what is drawn on top). */
const ENCODED=new Set(['navigatorName','actionFlows','pageLayer']);

const attr=(key:string,expr:string):string=>ATTR.test(key)&&!RESERVED_ATTRS.has(key)?key+'={'+expr+'}'
 :'{...{'+JSON.stringify(RESERVED_ATTRS.has(key)?'prop:'+key:key)+': '+expr+'}}';
const strAttr=(key:string,value:string):string=>
 ATTR.test(key)&&!RESERVED_ATTRS.has(key)&&PLAIN_STRING.test(value)?key+'="'+value+'"':attr(key,JSON.stringify(value));
const elementAttr=(key:string,value:string):string=>
 PLAIN_STRING.test(value)?key+'="'+value+'"':key+'={'+JSON.stringify(value)+'}';

/** Event name -> handler attribute (click -> onClick). The flow's own event name is in actions.ts. */
export const handlerName=(event:string):string=>'on'+event.charAt(0).toUpperCase()+event.slice(1).replace(/[^A-Za-z0-9_]/g,'_');

export function generatePageTsx(input:{
 header:string;page:string;pageClass:string;components:PageComponentLike[];
 /** "<component id>\u0000<property or event>" -> the reference written in the .tsx (f.x.y / a.x.y). */
 formulaRefs:ReadonlyMap<string,string>;actionRefs:ReadonlyMap<string,string>;
 /** Filled here: tags and what the code does not show, for manifest.json. */
 names:PageCodeNames;
},issues:SourceIssue[]):string{
 const components=input.components.filter(c=>c&&typeof c==='object');
 const classes=classNames(components);
 const tagOfType=new Map<string,string>();
 const tagFor=(type:string):string=>{
  let tag=tagOfType.get(type);
  if(tag)return tag;
  const base=uiTag(type);
  tag=base;
  for(let n=2;Object.prototype.hasOwnProperty.call(input.names.ui,tag)||tag==='Fragment'||tag==='Page';n++)tag=base+n;
  tagOfType.set(type,tag);input.names.ui[tag]=type;
  return tag;
 };

 const nameOfId=new Map<string,string>();
 for(const c of components)if(componentId(c)&&!nameOfId.has(componentId(c)))nameOfId.set(componentId(c),classes.get(c)!);

 const emitted=new Set<PageComponentLike>();
 const out:string[]=[];
 const element=(c:PageComponentLike,depth:number)=>{
  if(emitted.has(c))return;
  emitted.add(c);
  const id=componentId(c),props=propsOf(c);
  const key=classes.get(c)!;
  const type=String(c.type??'');
  const tag=tagFor(type);
  const indent='  '.repeat(depth);
  const attrs:string[]=[elementAttr('className',key)];
  const kept:PageCodeNames['components'][string]={id};
  if(typeof props.navigatorName!=='string')kept.unnamed=true;
  else if(props.navigatorName!==key)attrs.push(elementAttr('name',props.navigatorName));
  if(c.label===undefined||c.label===null)kept.label=null;
  else if(c.label!==defaultLabel(type))kept.label=String(c.label);
  if(typeof (c as {region?:unknown}).region==='string')kept.region=String((c as {region?:string}).region);
  input.names.components[key]=kept;
  if(c.visible===false)attrs.push('hidden');
  if(props.pageLayer!==undefined)attrs.push('layer={'+JSON.stringify(props.pageLayer)+'}');
  // Position parts the .css file does not hold (anything but x, y, width, height).
  const position=c.position&&typeof c.position==='object'?c.position as Record<string,unknown>:null;
  if(position){
   const css=cssStyleKeys(c);
   const rest=Object.fromEntries(Object.entries(position).filter(([part])=>!css.position.has(part)));
   if(Object.keys(rest).length)attrs.push('position={'+JSON.stringify(rest)+'}');
  }
  const inCss=cssStyleKeys(c).properties;
  for(const [prop,value] of Object.entries(props)){
   if(ENCODED.has(prop)||inCss.has(prop)||value===undefined)continue;
   // The container it sits in, by name (parent="Box"), not by id.
   if(prop==='layoutParentId'&&typeof value==='string'&&nameOfId.has(value)){
    attrs.push(elementAttr('parent',nameOfId.get(value)!));continue;
   }
   // A list's data source (TABLE(@Order, …)) is a setting the list reads, not a formula to run.
   if(isFormula(value)&&!/^=\s*TABLE\s*\(/i.test(value)){
    const ref=input.formulaRefs.get(id+'\u0000'+prop);
    if(ref!==undefined){attrs.push(attr(prop,ref));continue;}
    issues.push({componentName:componentName(c),message:'Formula not converted: '+prop});
   }
   if(typeof value==='string'){attrs.push(strAttr(prop,value));continue;}
   try{attrs.push(attr(prop,JSON.stringify(value)));}
   catch{issues.push({componentName:componentName(c),message:'Property not written: '+prop});}
  }
  const flows=props.actionFlows;
  if(flows&&typeof flows==='object'&&!Array.isArray(flows)){
   for(const event of Object.keys(flows)){
    const ref=input.actionRefs.get(id+'\u0000'+event);
    if(ref===undefined){issues.push({componentName:componentName(c),message:'Action not in actions file: '+event});continue;}
    attrs.push(attr(handlerName(event),ref));
   }
  }
  out.push(indent+'<'+tag+' '+attrs.join(' ')+' />');
 };
 for(const c of components)element(c,3);

 const tags=[...new Set(tagOfType.values())].sort();
 const pageName=uiTag(input.page)+'Page';
 return [
  input.header,
  ...(tags.length?['import {'+tags.join(', ')+"} from '@une/ui';"]:[]),
  "import {formulas as f} from './"+input.page+".formulas';",
  "import {actions as a} from './"+input.page+".actions';",
  "import './"+input.page+".css';",
  '',
  'export default function '+pageName+'() {',
  '  return (',
  '    <div className="page-'+input.pageClass+'">',
  ...out,
  '    </div>',
  '  );',
  '}',
  ''
 ].join('\n');
}

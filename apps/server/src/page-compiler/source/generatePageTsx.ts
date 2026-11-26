import type {PageComponentLike,SourceIssue} from './generatePageSource.js';
import {classNames,componentId,componentName,cssStyleKeys,isFormula,propsOf} from './generatePageCss.js';

/**
 * The page as a React component: one <Smart> element per component, in page order (a
 * component inside a container names it with layoutParentId). The file is lossless: reading it back
 * (readPageSource.ts) gives the same components, so the app can run from it.
 *
 *  - id, type, name, className, layer, hidden  the component itself
 *  - every other property                      a literal prop (JSON), or f.<formula> for a formula
 *  - on<Event>={a[...]}                        the component's actions (actions.ts holds the flow)
 *  - position and look                         the .css file (className)
 */
const ATTR=/^[A-Za-z_][A-Za-z0-9_]*$/;
const PLAIN_STRING=/^[^"\\&<>{}\r\n\u2028\u2029]*$/;
/** Attribute names the element itself uses: a property with one of these names is written as "prop:<name>". */
export const RESERVED_ATTRS=new Set(['id','type','name','className','key','ref','children','hidden','layer',
 'componentLabel','region','position']);
/** Properties written elsewhere (layer, actions, name). layoutParentId stays a prop: the
 * components keep their exact page order (the order decides what is drawn on top). */
const ENCODED=new Set(['navigatorName','actionFlows','pageLayer']);

export const formulaRef=(key:string):string=>'f['+JSON.stringify(key)+']';
export const actionRef=(key:string):string=>'a['+JSON.stringify(key)+']';
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
 formulaKeys:ReadonlyMap<string,string>;actionKeys:ReadonlyMap<string,string>;
},issues:SourceIssue[]):string{
 const components=input.components.filter(c=>c&&typeof c==='object');
 const classes=classNames(components);

 const emitted=new Set<PageComponentLike>();
 const out:string[]=[];
 const element=(c:PageComponentLike,depth:number)=>{
  if(emitted.has(c))return;
  emitted.add(c);
  const id=componentId(c),props=propsOf(c);
  const indent='  '.repeat(depth);
  const attrs:string[]=[elementAttr('id',id),elementAttr('type',String(c.type??''))];
  if(typeof props.navigatorName==='string')attrs.push(elementAttr('name',props.navigatorName));
  attrs.push(elementAttr('className',classes.get(c)!));
  if(typeof c.label==='string')attrs.push(elementAttr('componentLabel',c.label));
  if(c.visible===false)attrs.push('hidden');
  if(typeof (c as {region?:unknown}).region==='string')attrs.push(elementAttr('region',String((c as {region?:string}).region)));
  if(props.pageLayer!==undefined)attrs.push('layer={'+JSON.stringify(props.pageLayer)+'}');
  // Position parts the .css file does not hold (anything but x, y, width, height).
  const position=c.position&&typeof c.position==='object'?c.position as Record<string,unknown>:null;
  if(position){
   const css=cssStyleKeys(c);
   const rest=Object.fromEntries(Object.entries(position).filter(([key])=>!css.position.has(key)));
   if(Object.keys(rest).length)attrs.push('position={'+JSON.stringify(rest)+'}');
  }
  const inCss=cssStyleKeys(c).properties;
  for(const [key,value] of Object.entries(props)){
   if(ENCODED.has(key)||inCss.has(key)||value===undefined)continue;
   if(isFormula(value)){
    const fk=input.formulaKeys.get(id+'\u0000'+key);
    if(fk!==undefined){attrs.push(attr(key,formulaRef(fk)));continue;}
    issues.push({componentName:componentName(c),message:'Formula not converted: '+key});
   }
   if(typeof value==='string'){attrs.push(strAttr(key,value));continue;}
   try{attrs.push(attr(key,JSON.stringify(value)));}
   catch{issues.push({componentName:componentName(c),message:'Property not written: '+key});}
  }
  const flows=props.actionFlows;
  if(flows&&typeof flows==='object'&&!Array.isArray(flows)){
   for(const event of Object.keys(flows)){
    const ak=input.actionKeys.get(id+'\u0000'+event);
    if(ak===undefined){issues.push({componentName:componentName(c),message:'Action not in actions file: '+event});continue;}
    attrs.push(attr(handlerName(event),actionRef(ak)));
   }
  }
  out.push(indent+'<Smart '+attrs.join(' ')+' />');
 };
 for(const c of components)element(c,3);

 return [
  input.header,
  "import {Smart} from '@une/smart';",
  "import {formulas as f} from './"+input.page+".formulas';",
  "import {actions as a} from './"+input.page+".actions';",
  "import './"+input.page+".css';",
  '',
  'export default function Page() {',
  '  return (',
  '    <div className="page-'+input.pageClass+'">',
  ...out,
  '    </div>',
  '  );',
  '}',
  ''
 ].join('\n');
}

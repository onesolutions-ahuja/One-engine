import {POSITION_RULES,STYLE_RULES} from './generatePageCss.js';
import type {PageComponentLike} from './generatePageSource.js';
import {flatEntries,smartAttrs,type PageCodeNames} from './pageCodeNames.js';

/**
 * One <Smart … /> element of a page's .tsx -> the page component it describes. Pure (no
 * Node, no DOM): the server uses it on the syntax tree it reads, the device on the elements
 * Page() returns. Both therefore get the same page from the same code.
 */
export type SourceRef={ref:'f'|'a';key:string};
export const isSourceRef=(value:unknown):value is SourceRef=>Boolean(value)&&typeof value==='object'&&
 ((value as SourceRef).ref==='f'||(value as SourceRef).ref==='a')&&typeof (value as SourceRef).key==='string'
 &&Object.keys(value as object).length===2;

/** `.class { prop: value; … }` rules of the .css file. */
export function cssRules(css:string):Map<string,Array<[string,string]>>{
 const rules=new Map<string,Array<[string,string]>>();
 const text=String(css??'').replace(/\/\*[\s\S]*?\*\//g,'');
 for(const match of text.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)){
  const list=rules.get(match[1])??[];
  for(const declaration of match[2].split(';')){
   const at=declaration.indexOf(':');
   if(at<0)continue;
   const prop=declaration.slice(0,at).trim().toLowerCase(),value=declaration.slice(at+1).trim();
   if(prop)list.push([prop,value]);
  }
  rules.set(match[1],list);
 }
 return rules;
}

const ELEMENT_ATTRS=new Set(['id','type','name','className','componentLabel','hidden','region','layer','position','children','key']);

export function componentFromElement(attrs:Record<string,unknown>,css:Map<string,Array<[string,string]>>,lookup:{
 formula:(key:string)=>unknown;action:(key:string)=>{event:unknown;flow:unknown}|undefined;
}):{component:PageComponentLike|null;issues:string[]}{
 const issues:string[]=[];
 const id=typeof attrs.id==='string'?attrs.id:'';
 if(!id)return {component:null,issues:['A <Smart> element has no id: skipped']};
 const properties:Record<string,unknown>={};
 const flows:Record<string,unknown>={};
 for(const [rawKey,value] of Object.entries(attrs)){
  if(ELEMENT_ATTRS.has(rawKey)||value===undefined)continue;
  const key=rawKey.startsWith('prop:')?rawKey.slice(5):rawKey;
  if(isSourceRef(value)){
   if(value.ref==='f'){
    const source=lookup.formula(value.key);
    if(typeof source==='string')properties[key]=source;
    else issues.push(id+'.'+key+': formula '+value.key+' is not in the formulas file');
   }else{
    const entry=lookup.action(value.key);
    if(entry&&typeof entry.event==='string'&&entry.flow!==undefined)flows[entry.event]=entry.flow;
    else issues.push(id+'.'+key+': action '+value.key+' is not in the actions file');
   }
   continue;
  }
  properties[key]=value;
 }
 if(typeof attrs.name==='string')properties.navigatorName=attrs.name;
 if(attrs.layer!==undefined)properties.pageLayer=attrs.layer;
 if(Object.keys(flows).length)properties.actionFlows=flows;
 const position:Record<string,unknown>=attrs.position&&typeof attrs.position==='object'&&!Array.isArray(attrs.position)
  ?{...attrs.position as object}:{};
 for(const [prop,value] of css.get(String(attrs.className??''))??[]){
  const place=POSITION_RULES.find(rule=>rule.css===prop);
  if(place){
   const number=/^(-?\d+(?:\.\d+)?)px$/.exec(value);
   if(number)position[place.key]=Number(number[1]);else issues.push(id+': '+prop+' must be in px');
   continue;
  }
  const style=STYLE_RULES.find(rule=>rule.css===prop);
  if(style){
   const read=style.read(value);
   if(read===undefined)issues.push(id+': '+prop+' '+value+' is not a value Page Builder can show');
   else properties[style.key]=read;
   continue;
  }
  if(prop!=='position')issues.push(id+': CSS '+prop+' is not used (Page Builder look properties only)');
 }
 return {issues,component:{id,type:String(attrs.type??''),
  ...(typeof attrs.componentLabel==='string'?{label:attrs.componentLabel}:{}),
  visible:attrs.hidden!==true,
  ...(typeof attrs.region==='string'?{region:attrs.region}:{}),
  ...(Object.keys(position).length?{position:position as PageComponentLike['position']}:{}),
  properties}};
}

/** What the device gets for one screen in the app package (its code, bundled). */
type FormulaEntry={source?:unknown;run?:unknown};
type ActionEntry={component?:unknown;event?:unknown;flow?:unknown;data?:unknown;reads?:unknown;writes?:unknown;ui?:unknown;run?:unknown};
export type PackageScreenCode={
 Page:()=>unknown;
 /** Grouped by component name ({ pay: { label: {…} } }), or flat ("<id>:label") in older files. */
 formulas:Record<string,unknown>;
 actions:Record<string,unknown>;
 recordSets:unknown[];css:string;settings:Record<string,unknown>;version?:number;
 /** manifest.json "names": component ids/labels and which type each '@une/ui' tag is. */
 names?:PageCodeNames|null;
};
type ElementLike={type?:unknown;props?:Record<string,unknown>};

/** A component of '@une/ui' (<Button>, <CardGrid>, …) carries its tag. */
export type UiComponent=((props:unknown)=>null)&{uneTag:string};
const uiTagOf=(type:unknown):string=>typeof type==='function'&&typeof (type as Partial<UiComponent>).uneTag==='string'
 ?(type as UiComponent).uneTag:'';

/**
 * Run the screen's Page() and turn its component elements (<Button …/>, or <Smart …/> in older files) into the page the runtime draws, and
 * its formulas / actions / record sets into the page code the runtime runs. A function a
 * developer put in the .tsx is not a page value: it is reported and left out.
 */
export function screenFromCode(screen:PackageScreenCode,smart:unknown):{
 page:Record<string,unknown>&{components:PageComponentLike[]};
 code:{version:2;formulas:Record<string,unknown>;sources:Record<string,string>;
  actions:Record<string,{data:boolean;reads:string[];writes:string[];ui:string[];run:unknown}>;recordSets:unknown[]};
 issues:string[];
}{
 const issues:string[]=[];
 const names=screen.names??null;
 const formulaList=flatEntries<FormulaEntry>(screen.formulas as Record<string,unknown>,names);
 const actionList=flatEntries<ActionEntry>(screen.actions as Record<string,unknown>,names);
 const formulaByFile=new Map(formulaList.map(item=>[item.fileKey,item])),actionByFile=new Map(actionList.map(item=>[item.fileKey,item]));
 const formulaKey=new Map<unknown,string>(),actionKey=new Map<unknown,string>();
 for(const item of formulaList)formulaKey.set(item.entry,item.fileKey);
 for(const item of actionList)actionKey.set(item.entry,item.fileKey);
 const css=cssRules(screen.css??'');
 const components:PageComponentLike[]=[];
 const visit=(node:unknown):void=>{
  if(Array.isArray(node)){for(const item of node)visit(item);return;}
  if(!node||typeof node!=='object')return;
  const element=node as ElementLike;
  const props=element.props??{};
  const tag=uiTagOf(element.type);
  if(element.type===smart||tag){
   let attrs:Record<string,unknown>={};
   for(const [key,value] of Object.entries(props)){
    if(key==='children')continue;
    if(formulaKey.has(value)){attrs[key]={ref:'f',key:formulaKey.get(value)};continue;}
    if(actionKey.has(value)){attrs[key]={ref:'a',key:actionKey.get(value)};continue;}
    if(typeof value==='function'){issues.push(String(props.id??'?')+'.'+key+': a function is not a page value: left out');continue;}
    attrs[key]=value;
   }
   if(tag)attrs=smartAttrs(tag,attrs,names);
   const made=componentFromElement(attrs,css,{
    formula:key=>formulaByFile.get(key)?.entry.source,
    action:key=>{const item=actionByFile.get(key);return item?{event:item.entry.event??item.part,flow:item.entry.flow}:undefined;}
   });
   issues.push(...made.issues);
   if(made.component)components.push(made.component);
  }
  visit(props.children);
 };
 visit(screen.Page());
 const formulas:Record<string,unknown>={},sources:Record<string,string>={};
 for(const {runtimeKey:key,entry} of formulaList){
  if(typeof entry?.run!=='function'||typeof entry.source!=='string')continue;
  formulas[key]=entry.run;sources[key]=entry.source;
 }
 const actions:Record<string,{data:boolean;reads:string[];writes:string[];ui:string[];run:unknown}>={};
 const list=(value:unknown)=>Array.isArray(value)?value.map(String):[];
 for(const {runtimeKey:key,entry} of actionList){
  if(typeof entry?.run!=='function')continue;
  actions[key]={data:entry.data===true,reads:list(entry.reads),writes:list(entry.writes),ui:list(entry.ui),run:entry.run};
 }
 return {page:{...(screen.settings??{}),components},
  code:{version:2,formulas,sources,actions,recordSets:Array.isArray(screen.recordSets)?screen.recordSets:[]},issues};
}

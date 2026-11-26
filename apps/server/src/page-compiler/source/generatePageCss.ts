import type {PageComponentLike,SourceIssue} from './generatePageSource.js';

/** Style properties that go to the .css file when their value reads back exactly. */
export const STYLE_KEYS=['backgroundColor','labelColor','borderColor','radius','textSize','headerBold',
 'labelAlignment','shadow'] as const;

export const componentId=(c:PageComponentLike):string=>typeof c.id==='string'?c.id:'';
export const propsOf=(c:PageComponentLike):Record<string,unknown>=>
 c.properties&&typeof c.properties==='object'&&!Array.isArray(c.properties)?c.properties as Record<string,unknown>:{};
/** The component name: navigatorName, or its id when it has none. */
export const componentName=(c:PageComponentLike):string=>{
 const n=propsOf(c).navigatorName;
 return typeof n==='string'&&n.trim()?n.trim():componentId(c);
};
/** Name as used in a CSS class: letters, digits, _ and - only. */
export const safeName=(name:string):string=>name.replace(/[^A-Za-z0-9_-]/g,'_');
export const isFormula=(value:unknown):value is string=>typeof value==='string'&&value.startsWith('=');

const SHADOWS:Record<string,string>={small:'0 1px 4px #0002',medium:'0 3px 9px #0003',large:'0 8px 20px #0003',none:'none'};
/** A CSS value must not be able to leave its declaration. */
const SAFE_VALUE=/^[^;{}<>\\\r\n\u2028\u2029:]*$/;
const cleanText=(v:unknown):v is string=>typeof v==='string'&&v!==''&&v===v.trim()&&!isFormula(v)&&SAFE_VALUE.test(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const fromPx=(v:string):number|undefined=>{const m=/^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());return m?Number(m[1]):undefined;};

/**
 * Look properties <-> CSS declarations. A value is written to the .css file only when
 * reading the file back gives the SAME value (so the app can run from the files and a
 * developer can change a colour in the .css). Anything else stays a prop in the .tsx.
 */
type StyleRule={key:string;css:string;write:(v:unknown)=>string|null;read:(css:string)=>unknown};
export const STYLE_RULES:StyleRule[]=[
 {key:'backgroundColor',css:'background',write:v=>cleanText(v)?v:null,read:v=>v},
 {key:'labelColor',css:'color',write:v=>cleanText(v)?v:null,read:v=>v},
 {key:'borderColor',css:'border',write:v=>cleanText(v)?'1px solid '+v:null,
  read:v=>v.startsWith('1px solid ')?v.slice('1px solid '.length):undefined},
 {key:'radius',css:'border-radius',write:v=>finite(v)?v+'px':null,read:fromPx},
 {key:'textSize',css:'font-size',write:v=>finite(v)?v+'px':null,read:fromPx},
 {key:'headerBold',css:'font-weight',write:v=>v===true?'700':null,read:v=>v==='700'?true:undefined},
 {key:'labelAlignment',css:'text-align',write:v=>cleanText(v)?v:null,read:v=>v},
 {key:'shadow',css:'box-shadow',write:v=>typeof v==='string'&&Object.prototype.hasOwnProperty.call(SHADOWS,v)?SHADOWS[v]:null,
  read:v=>Object.keys(SHADOWS).find(name=>SHADOWS[name]===v)}
];
export const POSITION_RULES:Array<{key:string;css:string}>=[
 {key:'x',css:'left'},{key:'y',css:'top'},{key:'width',css:'width'},{key:'height',css:'height'}];

/** Which properties / position parts of a component the .css file holds. */
export function cssStyleKeys(c:PageComponentLike):{properties:Set<string>;position:Set<string>}{
 const props=propsOf(c);
 const properties=new Set(STYLE_RULES.filter(rule=>rule.write(props[rule.key])!==null).map(rule=>rule.key));
 const position=c.position&&typeof c.position==='object'?c.position as Record<string,unknown>:{};
 return {properties,position:new Set(POSITION_RULES.filter(rule=>finite(position[rule.key])).map(rule=>rule.key))};
}

/** One class per component: its name (a repeated name gets -2, -3, …), in page order. */
export function classNames(components:readonly PageComponentLike[]):Map<PageComponentLike,string>{
 const used=new Set<string>(),out=new Map<PageComponentLike,string>();
 for(const c of components){
  if(!c||typeof c!=='object')continue;
  // The component's own name (the name it has in Page Builder): it is also its key in the
  // .formulas.ts / .actions.ts files. A name a class cannot start with gets "c-".
  const safe=safeName(componentName(c)||'component');
  const base=/^[A-Za-z_]/.test(safe)?safe:'c-'+safe;
  let name=base,n=1;
  while(used.has(name))name=base+'-'+(++n);
  used.add(name);out.set(c,name);
 }
 return out;
}

export function generatePageCss(input:{
 header:string;pageClass:string;canvasWidth?:number;canvasHeight?:number;components:PageComponentLike[];
},issues:SourceIssue[]):string{
 void issues;
 const lines:string[]=[input.header];
 const page:string[]=['position:relative'];
 if(finite(input.canvasWidth))page.push('width:'+input.canvasWidth+'px');
 if(finite(input.canvasHeight))page.push('height:'+input.canvasHeight+'px');
 lines.push('.page-'+input.pageClass+' { '+page.join('; ')+'; }');
 const classes=classNames(input.components);
 for(const c of input.components){
  if(!c||typeof c!=='object')continue;
  const props=propsOf(c),keys=cssStyleKeys(c);
  const d:string[]=[];
  const position=c.position&&typeof c.position==='object'?c.position as Record<string,unknown>:{};
  if(keys.position.size)d.push('position: absolute');
  for(const rule of POSITION_RULES)if(keys.position.has(rule.key))d.push(rule.css+': '+position[rule.key]+'px');
  for(const rule of STYLE_RULES)if(keys.properties.has(rule.key))d.push(rule.css+': '+rule.write(props[rule.key]));
  if(d.length)lines.push('.'+classes.get(c)+' { '+d.join('; ')+'; }');
 }
 return lines.join('\n')+'\n';
}

import type {PageComponentLike,SourceIssue} from './generatePageSource.js';

/** Style properties that go to the .css file (and never to the TSX props, unless they are formulas). */
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
const SAFE_VALUE=/^[^;{}<>\\\r\n\u2028\u2029]*$/;

function px(value:unknown):string|null{
 const n=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
 return Number.isFinite(n)?n+'px':null;
}

export function generatePageCss(input:{
 header:string;pageClass:string;canvasWidth?:number;canvasHeight?:number;components:PageComponentLike[];
},issues:SourceIssue[]):string{
 const lines:string[]=[input.header];
 const page:string[]=['position:relative'];
 const w=px(input.canvasWidth),h=px(input.canvasHeight);
 if(w)page.push('width:'+w);
 if(h)page.push('height:'+h);
 lines.push('.page-'+input.pageClass+'{'+page.join(';')+';}');

 const seen=new Set<string>();
 for(const c of input.components){
  if(!c||typeof c!=='object')continue;
  const name=componentName(c),props=propsOf(c);
  const cls=safeName(name);
  if(seen.has(cls))issues.push({componentName:name,message:'Duplicate component name: styles are shared'});
  seen.add(cls);
  const d:string[]=[];
  const pos=c.position;
  if(pos&&typeof pos==='object'){
   d.push('position:absolute');
   for(const [css,key] of [['left','x'],['top','y'],['width','width'],['height','height']] as const){
    const v=(pos as Record<string,unknown>)[key];
    if(v===undefined)continue;
    const p=px(v);
    if(p)d.push(css+':'+p);else issues.push({componentName:name,message:'Position not written: '+key});
   }
  }
  const text=(key:string,css:string,make:(v:string)=>string=v=>v)=>{
   const v=props[key];
   if(v===undefined||v===null||v===''||isFormula(v))return;
   if(typeof v!=='string'||!SAFE_VALUE.test(v)){issues.push({componentName:name,message:'Style not written: '+key});return;}
   d.push(css+':'+make(v.trim()));
  };
  const size=(key:string,css:string)=>{
   const v=props[key];
   if(v===undefined||v===null||v===''||isFormula(v))return;
   const p=px(v);
   if(p)d.push(css+':'+p);else issues.push({componentName:name,message:'Style not written: '+key});
  };
  text('backgroundColor','background');
  text('labelColor','color');
  text('borderColor','border',v=>'1px solid '+v);
  size('radius','border-radius');
  size('textSize','font-size');
  if(props.headerBold===true)d.push('font-weight:700');
  text('labelAlignment','text-align');
  const shadow=props.shadow;
  if(typeof shadow==='string'&&!isFormula(shadow)&&shadow!==''){
   if(Object.prototype.hasOwnProperty.call(SHADOWS,shadow))d.push('box-shadow:'+SHADOWS[shadow]);
   else issues.push({componentName:name,message:'Style not written: shadow'});
  }
  if(d.length)lines.push('.c-'+cls+'{'+d.join(';')+';}');
 }
 return lines.join('\n')+'\n';
}


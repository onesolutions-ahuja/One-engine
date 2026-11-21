import type {Expression} from './FormulaParser.js';

export const SCREEN_MODES=['current','popup','newwindow','second'] as const;

/** A layer number (0-9) given to SCREEN, else null. */
export function screenLayerArg(node:Expression|undefined):number|null{
 const value=node?.kind==='literal'?node.value:null;
 const number=typeof value==='number'?value:typeof value==='string'&&/^\d$/.test(value)?Number(value):NaN;
 return Number.isInteger(number)&&number>=0&&number<=9?number:null;
}
const modeOf=(node:Expression)=>{
 const text=node.kind==='reference'||node.kind==='literal'&&typeof node.value==='string'?String(node.value).toLowerCase():'';
 return (SCREEN_MODES as readonly string[]).includes(text)?text:null;
};
/**
 * SCREEN(Page, ...): after the page, the inputs may come in any order and may be blank.
 * Each is known by what it is: a mode word (current, popup, newwindow, second) is the
 * mode, a single number 0-9 is the layer, anything else is the record it opens with.
 *   SCREEN(Payment, popup, @ThisPage.Cart.recordId, 2) = SCREEN(Payment, 2, popup, ...)
 *   SCREEN(Payment, popup, , 2)  SCREEN(Payment, 3)
 */
export function screenArguments(args:readonly Expression[]):{mode:string;modeGiven:boolean;record?:Expression;layer?:number}{
 if(args.length>3)throw Error('SCREEN takes the page and up to 3 more: mode, record and layer');
 let mode:string|undefined,record:Expression|undefined,layer:number|undefined;
 for(const arg of args){
  if(arg.kind==='literal'&&arg.value===null)continue;
  const asLayer=screenLayerArg(arg);
  const asMode=asLayer===null?modeOf(arg):null;
  if(asLayer!==null){
   if(layer!==undefined)throw Error('SCREEN has two layer numbers');
   layer=asLayer;
  }else if(asMode){
   if(mode)throw Error('SCREEN has two modes');
   mode=asMode;
  }else{
   if(arg.kind==='literal'&&typeof arg.value==='number')throw Error('SCREEN layers are 0-9');
   if(record)throw Error('SCREEN has two records: use current, popup, newwindow or second for the mode');
   record=arg;
  }
 }
 return {mode:mode??'current',modeGiven:Boolean(mode),...(record?{record}:{}),...(layer!==undefined?{layer}:{})};
}

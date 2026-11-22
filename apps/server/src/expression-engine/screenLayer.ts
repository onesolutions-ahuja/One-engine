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
 * A second number after the layer is seconds: show that layer for so many seconds (1-60),
 * then go back to layer 0, unless another SCREEN for that page comes first:
 *   SCREEN(CustomerDisplay, 5, 4)
 */
export function screenArguments(args:readonly Expression[]):{mode:string;modeGiven:boolean;record?:Expression;layer?:number;seconds?:number}{
 if(args.length>4)throw Error('SCREEN takes the page and up to 4 more: mode, record, layer and seconds');
 let mode:string|undefined,record:Expression|undefined,layer:number|undefined,seconds:number|undefined;
 for(const arg of args){
  if(arg.kind==='literal'&&arg.value===null)continue;
  const asLayer=screenLayerArg(arg);
  const asMode=asLayer===null?modeOf(arg):null;
  const number=arg.kind==='literal'?typeof arg.value==='number'?arg.value
   :typeof arg.value==='string'&&/^\d{1,2}$/.test(arg.value)?Number(arg.value):NaN:NaN;
  if(layer!==undefined&&Number.isFinite(number)){
   if(seconds!==undefined)throw Error('SCREEN has too many numbers: layer, then seconds');
   if(!Number.isInteger(number)||number<1||number>60)throw Error('SCREEN seconds are 1-60');
   seconds=number;
  }else if(asLayer!==null){
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
 if(seconds!==undefined&&(mode&&mode!=='current'))throw Error('SCREEN seconds only switch a layer where the page shows');
 return {mode:mode??'current',modeGiven:Boolean(mode),...(record?{record}:{}),...(layer!==undefined?{layer}:{}),
  ...(seconds!==undefined?{seconds}:{})};
}

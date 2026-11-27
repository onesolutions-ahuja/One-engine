import type {Expression} from './FormulaParser.js';

export const SCREEN_MODES=['current','popup','newwindow','second'] as const;

const modeOf=(node:Expression)=>{
 const text=node.kind==='reference'||node.kind==='literal'&&typeof node.value==='string'?String(node.value).toLowerCase():'';
 return (SCREEN_MODES as readonly string[]).includes(text)?text:null;
};
/** A whole number written in the formula (2 or "2"), else null. */
function wholeNumber(node:Expression|undefined):number|null{
 const value=node?.kind==='literal'?node.value:null;
 const number=typeof value==='number'?value:typeof value==='string'&&/^\d{1,4}$/.test(value)?Number(value):NaN;
 return Number.isInteger(number)&&number>=0?number:null;
}
/** A plain component name (ReportsPages), never a dotted or @ value. */
function plainName(node:Expression|undefined):string|null{
 const value=node?.kind==='reference'?String(node.value):node?.kind==='literal'&&typeof node.value==='string'?node.value:'';
 return /^[A-Za-z][A-Za-z0-9_]*$/.test(value)&&!modeOf(node!)?value:null;
}
/**
 * SCREEN(Page, ...): after the page, the inputs may come in any order and may be blank.
 *  - a mode word (current, popup, newwindow, second) is the mode;
 *  - a MultiPage name followed by a tab id opens that tab of that MultiPage:
 *    SCREEN(Reports, ReportsPages, 1). The tab id is the tab's own number (like an Excel
 *    sheet id): renaming or moving the tab keeps it;
 *  - a number right after the tab id is seconds: show that tab so long (1-60), then tab 0;
 *  - anything else is the record the page opens with.
 *   SCREEN(Payment, popup, @ThisPage.Cart.recordId)   SCREEN(CustomerDisplay, Steps, 2, 5)
 */
export function screenArguments(args:readonly Expression[]):{mode:string;modeGiven:boolean;record?:Expression;
 multiPage?:string;tab?:number;seconds?:number}{
 if(args.length>5)throw Error('SCREEN takes the page and up to 5 more: mode, record, MultiPage, tab and seconds');
 let mode:string|undefined,record:Expression|undefined,multiPage:string|undefined,tab:number|undefined,seconds:number|undefined;
 for(let index=0;index<args.length;index++){
  const arg=args[index];
  if(arg.kind==='literal'&&arg.value===null)continue;
  const name=plainName(arg);
  const next=wholeNumber(args[index+1]);
  if(name&&next!==null&&multiPage===undefined){
   multiPage=name;tab=next;index++;
   const after=wholeNumber(args[index+1]);
   if(after!==null){
    if(after<1||after>60)throw Error('SCREEN seconds are 1-60');
    seconds=after;index++;
   }
   continue;
  }
  const asMode=modeOf(arg);
  if(asMode){
   if(mode)throw Error('SCREEN has two modes');
   mode=asMode;
   continue;
  }
  if(wholeNumber(arg)!==null)throw Error('SCREEN needs the MultiPage name before the tab number, e.g. SCREEN(Page, MyPages, 1)');
  if(record)throw Error('SCREEN has two records: use current, popup, newwindow or second for the mode');
  record=arg;
 }
 if(seconds!==undefined&&(mode&&mode!=='current'))throw Error('SCREEN seconds only switch a tab where the page shows');
 return {mode:mode??'current',modeGiven:Boolean(mode),...(record?{record}:{}),
  ...(multiPage!==undefined?{multiPage,tab}:{}),...(seconds!==undefined?{seconds}:{})};
}

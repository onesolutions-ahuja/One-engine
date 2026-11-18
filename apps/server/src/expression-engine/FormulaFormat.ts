import {formulaDateTimeParts} from './FormulaDate.js';
import {roundFormulaNumber} from './FormulaNumeric.js';

/**
 * FORMAT(value, pattern): one shared formatter for page code, the browser evaluator and Flows.
 *
 * Number patterns (Excel style):
 *   "0"        -> 3          "0.0"   -> 2.5        "0.00"    -> 2.50
 *   "#,##0.00" -> 1,234.50   "£0.00" -> £2.50      "0.00%"   -> 12.50% (value 0.125)
 *   A negative number keeps its sign in front of any prefix: -£3.30.
 * Date/time patterns (any of YYYY YY MMMM MMM MM M DD D HH H mm ss):
 *   "DD-MM-YYYY" -> 18-11-2026   "DD/MM/YYYY HH:mm" -> 18/11/2026 16:24   "HH:mm" -> 16:24
 *   MM is the month, mm the minutes (case matters, as in Excel/Moment).
 * A blank value gives "". A value that is not a number/date for its pattern is returned as text.
 */
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DATE_TOKEN=/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|mm|ss/g;
const NUMBER_PATTERN=/^([^0#.,]*?)([#,]*0[0,]*)(?:\.(0+))?(%?)([^0#]*)$/;

const plain=(value:unknown):string=>value===null||value===undefined?'':
  typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):
    value instanceof Date?value.toISOString():String(value);

function formatNumber(value:number,pattern:RegExpExecArray):string {
  const [,prefix,integerPattern,decimalPattern='',percent,suffix]=pattern;
  const decimals=decimalPattern.length;
  const scaled=percent?value*100:value;
  const rounded=roundFormulaNumber(scaled,decimals,'ROUND');
  const negative=rounded<0;
  const [whole,fraction='']=Math.abs(rounded).toFixed(decimals).split('.');
  const minimumWhole=(integerPattern.replace(/[^0]/g,'').length)||1;
  let digits=whole.padStart(minimumWhole,'0');
  if(integerPattern.includes(','))digits=digits.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return (negative?'-':'')+prefix+digits+(decimals?'.'+fraction:'')+percent+suffix;
}

function formatDate(value:string,pattern:string,timeZone:string):string {
  const parts=formulaDateTimeParts(value,timeZone);
  const two=(n:number)=>String(n).padStart(2,'0');
  return pattern.replace(DATE_TOKEN,token=>{
    switch(token){
      case 'YYYY':return String(parts.year).padStart(4,'0');
      case 'YY':return two(parts.year%100);
      case 'MMMM':return MONTHS[parts.month-1]!;
      case 'MMM':return MONTHS[parts.month-1]!.slice(0,3);
      case 'MM':return two(parts.month);
      case 'M':return String(parts.month);
      case 'DD':return two(parts.day);
      case 'D':return String(parts.day);
      case 'HH':return two(parts.hour);
      case 'H':return String(parts.hour);
      case 'mm':return two(parts.minute);
      case 'ss':return two(parts.second);
      default:return token;
    }
  });
}

export function formulaFormat(value:unknown,pattern:unknown,timeZone='UTC'):string {
  const format=plain(pattern);
  const source=value instanceof Date?value.toISOString():value;
  if(source===null||source===undefined||source==='')return '';
  if(!format)return plain(source);
  const numeric=NUMBER_PATTERN.exec(format);
  if(numeric){
    const number=typeof source==='number'?source:Number(String(source).trim());
    return Number.isFinite(number)&&String(source).trim()!==''?formatNumber(number,numeric):plain(source);
  }
  if(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/.test(format)){
    try{return formatDate(plain(source).trim(),format,timeZone);}
    catch{return plain(source);}
  }
  return plain(source);
}

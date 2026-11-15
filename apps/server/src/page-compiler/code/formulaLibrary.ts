/**
 * Une formula library: the plain functions that generated page code calls.
 *
 * The page converter (formulaDictionary.ts + generateCode.ts) turns every
 * formula into ordinary JavaScript. Operators, IF, AND, OR, NOT, BLANKVALUE and
 * IFERROR become JavaScript control flow; every other function becomes a call
 * to one function below, e.g. LEFT(@Product.Name, 3) -> F.LEFT($.f(row,"Name"), 3).
 *
 * Nothing here parses or interprets formula text. The same file runs in the
 * browser (display formulas, instant taps) and on the server (actions), so a
 * formula gives the same value in both places.
 */
import {evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth} from '../../expression-engine/FormulaParser.js';
import {roundFormulaNumber} from '../../expression-engine/FormulaNumeric.js';
import {matchesExcelWildcard,hasExcelWildcardCriteria} from '../../expression-engine/FormulaWildcard.js';
import {
 evaluateFormulaDateBinary,formulaAddDays,formulaAddMonths,formulaDateParts,formulaDateText,
 formulaDateTimeParts,formulaNowIsoDateTime,formulaTimeText,formulaWeekday,isFormulaDate,parseFormulaDateTime
} from '../../expression-engine/FormulaDate.js';
import {createNamedFormulaCollection,sumFormulaCollection} from '../../expression-engine/FormulaCollection.js';

/** What a time-aware function needs from the page (clock and the user's time zone). */
export type FormulaClock={now():Date;timeZone():string};

const text=(value:unknown):string=>value===null||value===undefined?'':String(value);
const formulaText=(value:unknown):string=>typeof value==='boolean'?(value?'TRUE':'FALSE'):text(value);
const points=(value:unknown):string[]=>Array.from(text(value));
const num=(value:unknown):number=>{
 const result=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 if(!Number.isFinite(result))throw Error('Expected a finite number');
 return result;
};
const finite=(value:number):number=>{
 if(!Number.isFinite(value))throw Error('Formula result must be finite');
 return value;
};
const isBlank=(value:unknown):boolean=>value===null||value===undefined||value==='';

/** Operators used by generated code. */
export const O={
 /** Formula truth: TRUE, 1 and "true" are true. */
 t:(value:unknown):boolean=>formulaTruth(value),
 /** Binary operator. `wildcard` is set when the left side is a record field, so
  * @Product.Name = "*cola*" matches like Excel. Dates compare and add as dates. */
 b(operator:string,left:unknown,right:unknown,wildcard=false,timeZone='UTC'):unknown{
  const temporal=evaluateFormulaDateBinary(operator,left,right,timeZone);
  if(temporal.handled)return temporal.value;
  return evaluateFormulaBinary(operator,left,right,wildcard);
 },
 u:(operator:string,value:unknown):unknown=>evaluateFormulaUnary(operator,value),
 /** Text join (&). */
 s:(value:unknown):string=>text(value),
 blank:isBlank,
 nul:(value:unknown):boolean=>value===null||value===undefined,
 /** IFERROR: the second value when the first throws. */
 tryOr<T>(first:()=>T,second:()=>T):T{try{return first();}catch{return second();}},
 async tryOrAsync<T>(first:()=>Promise<T>,second:()=>Promise<T>):Promise<T>{try{return await first();}catch{return second();}},
 /** FOREACH over COLLECTION()/TABLE(): its items. */
 items(collection:unknown):unknown[]{
  if(Array.isArray(collection))return collection;
  const items=(collection as {items?:unknown}|null)?.items;
  return Array.isArray(items)?items:[];
 },
 /** A finished formula value: numbers must be finite. */
 out(value:unknown):unknown{if(typeof value==='number')finite(value);return value;}
};

/** Criteria matching shared by GETRECORD, COUNTIFS, SUMIFS, FOREACH on rows in memory.
 * Same rules as the server Record API: blank matches blank, text compares
 * case-sensitively unless it has wildcards (* ?), numbers and booleans as text. */
export function criteriaMatch(rowValue:unknown,wanted:unknown):boolean{
 if(isBlank(wanted))return isBlank(rowValue);
 if(hasExcelWildcardCriteria(wanted))return matchesExcelWildcard(text(rowValue),wanted);
 if(isBlank(rowValue))return false;
 return text(rowValue)===text(wanted);
}
export const rowMatches=(row:Readonly<Record<string,unknown>>,criteria:ReadonlyArray<readonly [string,unknown]>)=>
 criteria.every(([field,wanted])=>criteriaMatch(fieldValue(row,field),wanted));
/** Field or one-level Lookup.Field value of a row (related values arrive as "Lookup.Field"). */
export function fieldValue(row:Readonly<Record<string,unknown>>|null|undefined,field:string):unknown{
 if(!row)return undefined;
 if(Object.prototype.hasOwnProperty.call(row,field))return row[field];
 const dot=field.indexOf('.');
 if(dot>0){
  const related=row[field.slice(0,dot)+'__r']??row[field.slice(0,dot)];
  if(related&&typeof related==='object'&&!Array.isArray(related))
   return (related as Record<string,unknown>)[field.slice(dot+1)];
 }
 return undefined;
}
/** Numeric aggregate over rows: SUMIFS, AVERAGEIFS, MINIFS, MAXIFS, COUNTIFS. */
export function aggregateRows(kind:string,rows:ReadonlyArray<Readonly<Record<string,unknown>>>,valueField:string):number{
 if(kind==='COUNTIFS')return rows.length;
 const values=rows.map(row=>fieldValue(row,valueField)).filter(value=>!isBlank(value)).map(num);
 if(kind==='SUMIFS')return finite(values.reduce((sum,value)=>sum+value,0));
 if(!values.length)return 0;
 if(kind==='AVERAGEIFS')return finite(values.reduce((sum,value)=>sum+value,0)/values.length);
 if(kind==='MINIFS')return Math.min(...values);
 if(kind==='MAXIFS')return Math.max(...values);
 throw Error('Unknown aggregate '+kind);
}

/** Every pure formula function, one plain function each. */
export const F={
 TEXT:(value:unknown)=>formulaText(value),
 VALUE:(value:unknown)=>num(value),
 UPPER:(value:unknown)=>text(value).toUpperCase(),
 LOWER:(value:unknown)=>text(value).toLowerCase(),
 PROPER:(value:unknown)=>text(value).toLowerCase()
  .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu,(_match:string,prefix:string,letter:string)=>prefix+letter.toUpperCase()),
 LEN:(value:unknown)=>points(value).length,
 CHAR(code:unknown){
  const value=Math.trunc(num(code));
  if(value<1||value>1114111)throw Error('CHAR needs a character code from 1 to 1114111');
  return String.fromCodePoint(value);
 },
 LEFT:(value:unknown,count:unknown=1)=>points(value).slice(0,Math.max(0,Math.trunc(num(count)))).join(''),
 RIGHT(value:unknown,count:unknown=1){
  const length=Math.max(0,Math.trunc(num(count)));
  return length===0?'':points(value).slice(-length).join('');
 },
 MID(value:unknown,start:unknown,count:unknown){
  const from=Math.max(1,Math.trunc(num(start)))-1;
  return points(value).slice(from,from+Math.max(0,Math.trunc(num(count)))).join('');
 },
 FIND(needle:unknown,haystack:unknown,start:unknown=1){
  const hay=points(haystack),find=points(needle);
  for(let index=Math.max(0,Math.trunc(num(start))-1);index<=hay.length-find.length;index++)
   if(find.every((point,offset)=>hay[index+offset]===point))return index+1;
  return 0;
 },
 SUBSTITUTE:(value:unknown,old:unknown,replacement:unknown)=>text(old)===''?text(value)
  :text(value).split(text(old)).join(text(replacement)),
 TRIM:(value:unknown)=>text(value).trim().replace(/\s+/g,' '),
 CONTAINS:(value:unknown,part:unknown)=>text(value).includes(text(part)),
 BEGINS:(value:unknown,part:unknown)=>text(value).startsWith(text(part)),
 CONCAT:(...values:unknown[])=>values.map(text).join(''),
 CONCATENATE:(...values:unknown[])=>values.map(text).join(''),
 ISPICKVAL:(value:unknown,option:unknown)=>text(value)===text(option),
 INCLUDES:(value:unknown,option:unknown)=>text(value).split(';').filter(Boolean).includes(text(option)),
 ISNUMBER:(value:unknown)=>typeof value==='number'&&Number.isFinite(value)
  ||typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)),
 ISBLANK:(value:unknown)=>isBlank(value),
 ISNULL:(value:unknown)=>value===null||value===undefined,
 ROUND:(value:unknown,digits:unknown=0)=>roundFormulaNumber(num(value),num(digits),'ROUND'),
 ROUNDUP:(value:unknown,digits:unknown=0)=>roundFormulaNumber(num(value),num(digits),'ROUNDUP'),
 ROUNDDOWN:(value:unknown,digits:unknown=0)=>roundFormulaNumber(num(value),num(digits),'ROUNDDOWN'),
 ABS:(value:unknown)=>Math.abs(num(value)),
 INT:(value:unknown)=>Math.floor(num(value)),
 FLOOR:(value:unknown)=>Math.floor(num(value)),
 CEILING:(value:unknown)=>Math.ceil(num(value)),
 MOD(value:unknown,divisor:unknown){
  const by=num(divisor);
  if(by===0)throw Error('Formula modulo by zero');
  return finite(num(value)%by);
 },
 MIN:(...values:unknown[])=>Math.min(...values.map(num)),
 MAX:(...values:unknown[])=>Math.max(...values.map(num)),
 DATE(year:unknown,month:unknown,day:unknown){
  const y=Math.trunc(num(year)),m=Math.trunc(num(month)),d=Math.trunc(num(day));
  if(y<1||y>9999||m<1||m>12||d<1||d>31)throw Error('Invalid DATE arguments');
  const value=String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  if(!isFormulaDate(value))throw Error('Invalid DATE arguments');
  return value;
 },
 DATEVALUE(clock:FormulaClock,value:unknown){
  const raw=text(value);
  if(isFormulaDate(raw))return raw;
  return formulaDateText(formulaDateParts(parseFormulaDateTime(raw,clock.timeZone()),clock.timeZone()));
 },
 TODAY:(clock:FormulaClock)=>formulaDateText(formulaDateParts(clock.now(),clock.timeZone())),
 /** Date and time to the minute (agreed: no seconds); TIMENOW keeps seconds. */
 NOW:(clock:FormulaClock)=>formulaNowIsoDateTime(clock.now()),
 TIMENOW:(clock:FormulaClock)=>formulaTimeText(clock.now(),clock.timeZone()),
 DAY:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).day,
 MONTH:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).month,
 YEAR:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).year,
 HOUR:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).hour,
 MINUTE:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).minute,
 SECOND:(clock:FormulaClock,value:unknown)=>formulaDateTimeParts(text(value),clock.timeZone()).second,
 WEEKDAY:(clock:FormulaClock,value:unknown)=>formulaWeekday(formulaDateTimeParts(text(value),clock.timeZone())),
 TIMEVALUE(clock:FormulaClock,value:unknown){
  const raw=text(value);
  const time=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(raw);
  if(time)return time[1]+':'+time[2]+':'+(time[3]??'00')+'.'+(time[4]??'').padEnd(3,'0');
  return formulaTimeText(parseFormulaDateTime(raw,clock.timeZone()),clock.timeZone());
 },
 ADDDAYS:(clock:FormulaClock,value:unknown,days:unknown)=>formulaAddDays(text(value),num(days),clock.timeZone()),
 ADDMONTHS:(clock:FormulaClock,value:unknown,months:unknown)=>formulaAddMonths(text(value),num(months),clock.timeZone()),
 GEOLOCATION(latitude:unknown,longitude:unknown){
  const lat=num(latitude),lon=num(longitude);
  if(lat< -90||lat>90||lon< -180||lon>180)throw Error('Invalid geolocation');
  return {latitude:lat,longitude:lon};
 },
 DISTANCE(first:unknown,second:unknown,unit:unknown){
  const point=(value:unknown)=>{
   const item=value as {latitude?:unknown;longitude?:unknown}|null;
   if(!item||typeof item!=='object')throw Error('Invalid geolocation');
   return F.GEOLOCATION(item.latitude,item.longitude);
  };
  const a=point(first),b=point(second),rad=(deg:number)=>deg*Math.PI/180;
  const lat=rad(b.latitude-a.latitude),lon=rad(b.longitude-a.longitude);
  const h=Math.sin(lat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(lon/2)**2;
  const km=6371.0088*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  const which=text(unit).toLowerCase();
  if(which==='km')return km;
  if(which==='mi')return km/1.609344;
  throw Error('DISTANCE unit must be km or mi');
 },
 COLLECTION:(name:unknown,...values:unknown[])=>createNamedFormulaCollection(name,values),
 SUM:(collection:unknown)=>sumFormulaCollection(collection,{})
};
export type FormulaFunctions=typeof F;

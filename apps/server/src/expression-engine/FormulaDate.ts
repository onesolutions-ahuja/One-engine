const DAY_MS=86400000;
export type FormulaDateParts={
  year:number;month:number;day:number;hour:number;minute:number;second:number;millisecond:number
};
type DateKind='date'|'datetime';
const formatterCache=new Map<string,Intl.DateTimeFormat>();

function utcMillis(parts:FormulaDateParts):number {
  const date=new Date(0);
  date.setUTCFullYear(parts.year,parts.month-1,parts.day);
  date.setUTCHours(parts.hour,parts.minute,parts.second,parts.millisecond);
  return date.getTime();
}

function formatter(timeZone:string):Intl.DateTimeFormat {
  let value=formatterCache.get(timeZone);
  if(!value){
    value=new Intl.DateTimeFormat('en-CA',{
      timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
      minute:'2-digit',second:'2-digit',hourCycle:'h23'
    });
    if(formatterCache.size>=32)formatterCache.delete(formatterCache.keys().next().value!);
    formatterCache.set(timeZone,value);
  }
  return value;
}

export function formulaDateParts(date:Date,timeZone='UTC'):FormulaDateParts {
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid formula date/time value');
  const values=Object.fromEntries(formatter(timeZone).formatToParts(date)
    .filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  if(values.year!<1||values.year!>9999)throw new Error('Formula date/time is out of range');
  return {
    year:values.year!,month:values.month!,day:values.day!,hour:values.hour!,
    minute:values.minute!,second:values.second!,millisecond:date.getUTCMilliseconds()
  };
}

export function formulaDateTimeParts(value:string,timeZone='UTC'):FormulaDateParts {
  if(isFormulaDate(value)){
    const [year,month,day]=value.split('-').map(Number);
    return {year,month,day,hour:0,minute:0,second:0,millisecond:0};
  }
  const time=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(value);
  if(time)return {year:1970,month:1,day:1,hour:Number(time[1]),minute:Number(time[2]),
    second:Number(time[3]??0),millisecond:Number((time[4]??'').padEnd(3,'0')||'0')};
  return formulaDateParts(parseFormulaDateTime(value,timeZone),timeZone);
}

export function formulaTimezoneOffset(date:Date,timeZone='UTC'):number {
  const parts=formulaDateParts(date,timeZone),represented=new Date(0);
  represented.setUTCFullYear(parts.year,parts.month-1,parts.day);
  represented.setUTCHours(parts.hour,parts.minute,parts.second,0);
  const wholeSecond=new Date(date);
  wholeSecond.setUTCMilliseconds(0);
  return represented.getTime()-wholeSecond.getTime();
}

export function formulaDateText(parts:Pick<FormulaDateParts,'year'|'month'|'day'>):string {
  return `${String(parts.year).padStart(4,'0')}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;
}

export function isFormulaDate(value:string):boolean {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match)return false;
  const [year,month,day]=match.slice(1).map(Number);
  return year>=1&&month>=1&&month<=12&&day>=1
    &&day<=new Date(utcMillis({year,month,day,hour:0,minute:0,second:0,millisecond:0})).getUTCDate()
    &&formulaDateText({year,month,day})===value
    &&new Date(utcMillis({year,month,day,hour:0,minute:0,second:0,millisecond:0})).getUTCMonth()+1===month;
}

function validDateParts(parts:FormulaDateParts):boolean {
  if(parts.year<1||parts.year>9999||parts.month<1||parts.month>12||parts.day<1||parts.day>31
    ||parts.hour<0||parts.hour>23||parts.minute<0||parts.minute>59
    ||parts.second<0||parts.second>59||parts.millisecond<0||parts.millisecond>999)return false;
  const date=new Date(utcMillis(parts));
  return date.getUTCFullYear()===parts.year&&date.getUTCMonth()+1===parts.month
    &&date.getUTCDate()===parts.day&&date.getUTCHours()===parts.hour
    &&date.getUTCMinutes()===parts.minute&&date.getUTCSeconds()===parts.second
    &&date.getUTCMilliseconds()===parts.millisecond;
}

function localDateTimeToInstant(parts:FormulaDateParts,timeZone:string):Date {
  if(!validDateParts(parts))throw new Error('Invalid formula date/time value');
  const target=utcMillis(parts),zone=formatter(timeZone),candidates=new Set<number>();
  for(let offset=-36;offset<=36;offset+=6){
    const instant=target+offset*60*60*1000;
    const displayed=Object.fromEntries(zone.formatToParts(instant)
      .filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const represented=utcMillis({
      year:displayed.year!,month:displayed.month!,day:displayed.day!,
      hour:displayed.hour!,minute:displayed.minute!,second:displayed.second!,millisecond:0
    });
    candidates.add(target-(represented-instant));
  }
  const matches=[...candidates].filter(instant=>{
    const actual=formulaDateParts(new Date(instant),timeZone);
    return actual.year===parts.year&&actual.month===parts.month&&actual.day===parts.day
      &&actual.hour===parts.hour&&actual.minute===parts.minute&&actual.second===parts.second
      &&actual.millisecond===parts.millisecond;
  }).sort((left,right)=>left-right);
  if(!matches.length)throw new Error('Formula local time does not exist in this time zone');
  return new Date(matches[0]);
}

export function parseFormulaDateTime(value:string,timeZone='UTC'):Date {
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  if(dateOnly){
    if(!isFormulaDate(value))throw new Error('Invalid formula date/time value');
    const [year,month,day]=value.split('-').map(Number);
    return localDateTimeToInstant({year,month,day,hour:0,minute:0,second:0,millisecond:0},timeZone);
  }
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if(!match)throw new Error('Invalid formula date/time value');
  const [,yearText,monthText,dayText,hourText,minuteText,secondText='00',fraction='',zone]=match;
  const parts:FormulaDateParts={
    year:Number(yearText),month:Number(monthText),day:Number(dayText),
    hour:Number(hourText),minute:Number(minuteText),second:Number(secondText),
    millisecond:Number(fraction.padEnd(3,'0')||'0')
  };
  if(!validDateParts(parts))throw new Error('Invalid formula date/time value');
  if(!zone)return localDateTimeToInstant(parts,timeZone);
  if(zone==='Z')return checkedInstant(new Date(utcMillis(parts)));
  const offset=/^([+-])(\d{2}):(\d{2})$/.exec(zone)!;
  const offsetHours=Number(offset[2]),offsetMinutes=Number(offset[3]);
  if(offsetHours>23||offsetMinutes>59)throw new Error('Invalid formula date/time value');
  const offsetMillis=(offsetHours*60+offsetMinutes)*60000*(offset[1]==='-'?-1:1);
  const instant=new Date(utcMillis(parts)-offsetMillis);
  return checkedInstant(instant);
}

function checkedInstant(date:Date):Date {
  const year=date.getUTCFullYear();
  if(!Number.isFinite(date.getTime())||year<1||year>9999)
    throw new Error('Invalid formula date/time value');
  return date;
}

export function formulaIsoDateTime(date:Date):string {
  checkedInstant(date);
  return date.toISOString();
}

export function formulaTimeText(date:Date,timeZone='UTC'):string {
  const parts=formulaDateParts(date,timeZone);
  return `${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')}:${String(parts.second).padStart(2,'0')}.${String(parts.millisecond).padStart(3,'0')}`;
}

export function formulaWeekday(parts:Pick<FormulaDateParts,'year'|'month'|'day'>):number {
  return new Date(utcMillis({...parts,hour:0,minute:0,second:0,millisecond:0})).getUTCDay()+1;
}

export function formulaIsoParts(parts:Pick<FormulaDateParts,'year'|'month'|'day'>) {
  const date=new Date(utcMillis({...parts,hour:0,minute:0,second:0,millisecond:0}));
  date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
  const year=date.getUTCFullYear();
  const firstThursday=new Date(utcMillis({year,month:1,day:4,hour:0,minute:0,second:0,millisecond:0}));
  firstThursday.setUTCDate(firstThursday.getUTCDate()+4-(firstThursday.getUTCDay()||7));
  return {year,week:1+Math.round((date.getTime()-firstThursday.getTime())/(7*DAY_MS))};
}

export function formulaAddDays(value:string,days:number,timeZone='UTC'):string {
  if(!Number.isSafeInteger(days)||Math.abs(days)>36500)
    throw new Error('ADDDAYS requires a whole number between -36500 and 36500');
  if(isFormulaDate(value)){
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(utcMillis({year,month,day,hour:0,minute:0,second:0,millisecond:0}));
    date.setUTCDate(date.getUTCDate()+days);
    if(date.getUTCFullYear()<1||date.getUTCFullYear()>9999)
      throw new Error('ADDDAYS date is out of range');
    return formulaDateText({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()});
  }
  const date=parseFormulaDateTime(value,timeZone);
  const parts=formulaDateParts(date,timeZone);
  const target=new Date(utcMillis(parts));
  target.setUTCDate(target.getUTCDate()+days);
  const adjusted={...parts,year:target.getUTCFullYear(),month:target.getUTCMonth()+1,
    day:target.getUTCDate()};
  if(adjusted.year<1||adjusted.year>9999)throw new Error('ADDDAYS date is out of range');
  return formulaIsoDateTime(localDateTimeToInstant(adjusted,timeZone));
}

export function formulaAddMonths(value:string,months:number,timeZone='UTC'):string {
  if(!Number.isSafeInteger(months)||Math.abs(months)>1200)
    throw new Error('ADDMONTHS requires a whole number between -1200 and 1200');
  const dateOnly=isFormulaDate(value);
  const original=dateOnly
    ?{year:Number(value.slice(0,4)),month:Number(value.slice(5,7)),day:Number(value.slice(8,10)),
      hour:0,minute:0,second:0,millisecond:0}
    :formulaDateParts(parseFormulaDateTime(value,timeZone),timeZone);
  const target=new Date(utcMillis({
    year:original.year,month:original.month+months,day:1,hour:0,minute:0,second:0,millisecond:0
  }));
  const year=target.getUTCFullYear(),month=target.getUTCMonth()+1;
  if(year<1||year>9999)throw new Error('ADDMONTHS date is out of range');
  const day=Math.min(original.day,new Date(utcMillis({
    year,month:month+1,day:0,hour:0,minute:0,second:0,millisecond:0
  })).getUTCDate());
  if(dateOnly)return formulaDateText({year,month,day});
  const date=localDateTimeToInstant({...original,year,month,day},timeZone);
  return formulaIsoDateTime(date);
}

function temporalKind(value:unknown,timeZone:string):{kind:DateKind;instant:Date}|null {
  if(typeof value!=='string')return null;
  if(isFormulaDate(value)){
    const [year,month,day]=value.split('-').map(Number);
    return {kind:'date',instant:new Date(utcMillis({year,month,day,hour:0,minute:0,second:0,millisecond:0}))};
  }
  if(!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;
  return {kind:'datetime',instant:parseFormulaDateTime(value,timeZone)};
}

export function evaluateFormulaDateBinary(
  operator:string,left:unknown,right:unknown,timeZone='UTC'
):{handled:boolean;value?:unknown} {
  const leftTemporal=temporalKind(left,timeZone),rightTemporal=temporalKind(right,timeZone);
  if(leftTemporal&&rightTemporal&&leftTemporal.kind===rightTemporal.kind){
    const delta=leftTemporal.instant.getTime()-rightTemporal.instant.getTime();
    if(operator==='-')return {handled:true,value:delta/DAY_MS};
    if(['=','==','!=','<>','<','<=','>','>='].includes(operator)){
      const equal=delta===0;
      const value=operator==='='||operator==='=='?equal:
        operator==='!='||operator==='<>'?!equal:
          operator==='<'?delta<0:operator==='<='?delta<=0:operator==='>'?delta>0:delta>=0;
      return {handled:true,value};
    }
    return {handled:false};
  }
  if(leftTemporal&&rightTemporal)
    throw new Error('Date and DateTime values must use matching types');
  const addTemporal=(temporal:{kind:DateKind;instant:Date},days:number,subtract:boolean)=>{
    if(temporal.kind==='date'){
      if(!Number.isSafeInteger(days))throw new Error('Date arithmetic requires a whole number of days');
      const date=new Date(temporal.instant);
      date.setUTCDate(date.getUTCDate()+(subtract?-days:days));
      if(date.getUTCFullYear()<1||date.getUTCFullYear()>9999)throw new Error('Formula date is out of range');
      return formulaDateText({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()});
    }
    const date=new Date(temporal.instant.getTime()+(subtract?-days:days)*DAY_MS);
    return formulaIsoDateTime(date);
  };
  if(leftTemporal&&typeof right==='number'&&(operator==='+'||operator==='-'))
    return {handled:true,value:addTemporal(leftTemporal,right,operator==='-')};
  if(rightTemporal&&typeof left==='number'&&operator==='+')
    return {handled:true,value:addTemporal(rightTemporal,left,false)};
  return {handled:false};
}

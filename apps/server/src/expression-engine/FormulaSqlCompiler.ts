import type {Expression} from './FormulaParser.js';
import {SQL_SCALAR_FORMULAS,SQL_RECORD_AGGREGATES} from './FormulaCategories.js';
export {SQL_SCALAR_FORMULAS,SQL_RECORD_AGGREGATES} from './FormulaCategories.js';

/** The 39 scalar/database functions selected for SQL decoding. Record aggregates
 * are resolved by the shared Record Engine; CRUD remains in its Action Engine. */
export type SqlFormulaBindings={
 /** All values are PostgreSQL parameters, never interpolated SQL literals. */
 bind(value:unknown):string;
 /** Only already authorised metadata fields may resolve to SQL. */
 field(reference:string):string;
 /** Record-scoped SUM uses the authorised Record Engine query. */
 sum(reference:string):string;
 timeZone:string;
 /** Stable transaction timestamp when supplied by a server Flow/rule. */
 now?:string;
};

const text=(value:string)=>'COALESCE(('+value+')::text,\'\')';
const number=(value:string)=>'(('+value+')::numeric)';
const integer=(value:string)=>'(trunc('+number(value)+')::integer)';
const date=(value:string)=>'(('+value+')::date)';
const datetime=(value:string)=>'(('+value+')::timestamptz)';
const count=(node:Extract<Expression,{kind:'call'}>,min:number,max=min)=>{
 if(node.args.length<min||node.args.length>max)throw Error('Invalid SQL formula argument count for '+node.name);
};
const bool=(value:string)=>'COALESCE(('+value+')::boolean,FALSE)';

/** Only fixed SQL templates are emitted; untrusted identifiers never become SQL. */
export function compileFormulaSql(node:Expression,bindings:SqlFormulaBindings):string {
 if(node.kind==='literal'){
  if(node.value===null)return 'NULL';
  const parameter=bindings.bind(node.value);
  return parameter+(typeof node.value==='number'?'::numeric':
    typeof node.value==='boolean'?'::boolean':'::text');
 }
 if(node.kind==='reference')return bindings.field(node.value);
 if(node.kind==='unary'){
  const value=compileFormulaSql(node.value,bindings);
  if(node.operator==='NOT')return '(NOT '+bool(value)+')';
  if(node.operator==='+'||node.operator==='-')return '('+node.operator+number(value)+')';
  throw Error('Unsupported SQL formula unary operator');
 }
 if(node.kind==='binary'){
  const left=compileFormulaSql(node.left,bindings),right=compileFormulaSql(node.right,bindings);
  const operator=node.operator.toUpperCase();
  if(operator==='AND'||operator==='OR')return '('+bool(left)+' '+operator+' '+bool(right)+')';
  if(operator==='&')return '('+text(left)+' || '+text(right)+')';
  if(['=','==','!=','<>','>','>=','<','<='].includes(operator)){
   const sign=operator==='=='?'=':operator==='!='?'<>' :operator;
   return '('+left+' '+sign+' '+right+')';
  }
  if(['+','-','*','/','%','^'].includes(operator)){
   const sign=operator==='^'?'^':operator==='%'?'%':operator;
   return '('+number(left)+' '+sign+' '+number(right)+')';
  }
  throw Error('Unsupported SQL formula binary operator');
 }
 const name=node.name;
 if(name==='SUM'){
  count(node,1);
  if(node.args[0].kind!=='reference')throw Error('SQL SUM requires a metadata Object.Field source');
  return bindings.sum(node.args[0].value);
 }
 if(SQL_RECORD_AGGREGATES.has(name))throw Error(name+' requires the shared Record Engine aggregate resolver');
 if(!SQL_SCALAR_FORMULAS.has(name)&&
   !['IF','AND','OR','NOT','BLANKVALUE','NULLVALUE'].includes(name))
  throw Error('Formula is not SQL-decodable: '+name);
 const args=node.args.map(arg=>compileFormulaSql(arg,bindings));
 const x=args[0]??'',y=args[1]??'',z=args[2]??'';
 const tz=bindings.timeZone;
 const now=bindings.now??'CURRENT_TIMESTAMP';
 switch(name){
  case 'IF':count(node,3);return '(CASE WHEN '+bool(x)+' THEN '+y+' ELSE '+z+' END)';
  case 'AND':count(node,1,20);return '('+args.map(bool).join(' AND ')+')';
  case 'OR':count(node,1,20);return '('+args.map(bool).join(' OR ')+')';
  case 'NOT':count(node,1);return '(NOT '+bool(x)+')';
  case 'BLANKVALUE':count(node,2);return '(CASE WHEN '+x+' IS NULL OR '+text(x)+"='' THEN "+y+' ELSE '+x+' END)';
  case 'NULLVALUE':count(node,2);return 'COALESCE('+x+','+y+')';
  case 'ISBLANK':count(node,1);return '('+x+' IS NULL OR '+text(x)+"='')";
  case 'ISNULL':count(node,1);return '('+x+' IS NULL)';
  case 'ISNUMBER':count(node,1);return '('+x+' IS NOT NULL AND '+text(x)+
    " ~ '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$')";
  case 'TEXT':count(node,1);return text(x);
  case 'VALUE':count(node,1);return number(x);
  case 'LEN':count(node,1);return 'char_length('+text(x)+')';
  case 'LOWER':count(node,1);return 'lower('+text(x)+')';
  case 'UPPER':count(node,1);return 'upper('+text(x)+')';
  case 'PROPER':count(node,1);return 'initcap(lower('+text(x)+'))';
  case 'LEFT':count(node,1,2);return 'left('+text(x)+',GREATEST(0,'+(args[1]?integer(y):'1')+'))';
  case 'RIGHT':count(node,1,2);return 'right('+text(x)+',GREATEST(0,'+(args[1]?integer(y):'1')+'))';
  case 'FIND':{
   count(node,2,3);
   const start=args[2]?'GREATEST(1,'+integer(z)+')':'1';
   const found='strpos(substr('+text(y)+','+start+'),'+text(x)+')';
   return '(CASE WHEN '+found+'=0 THEN 0 ELSE '+found+'+'+start+'-1 END)';
  }
  case 'CONTAINS':count(node,2);return '(strpos('+text(x)+','+text(y)+')>0)';
  case 'BEGINS':count(node,2);return 'starts_with('+text(x)+','+text(y)+')';
  case 'ISPICKVAL':count(node,2);return '('+text(x)+'='+text(y)+')';
  case 'INCLUDES':count(node,2);return '('+text(y)+'=ANY(string_to_array('+text(x)+",';')))";
  case 'ROUND':count(node,1,2);return 'round('+number(x)+','+(args[1]?integer(y):'0')+')';
  case 'ROUNDUP':
  case 'ROUNDDOWN':{
   count(node,1,2);
   const scale=args[1]?integer(y):'0';
   const factor='power(10::numeric,'+scale+')';
   const scaled='abs('+number(x)+')*'+factor;
   return '(sign('+number(x)+')*'+(name==='ROUNDUP'?'ceil':'floor')+'('+scaled+')/'+factor+')';
  }
  case 'MIN':count(node,1,20);return 'least('+args.map(number).join(',')+')';
  case 'MAX':count(node,1,20);return 'greatest('+args.map(number).join(',')+')';
  case 'DATE':count(node,3);return 'make_date('+integer(x)+','+integer(y)+','+integer(z)+')::text';
  case 'DATEVALUE':count(node,1);return '(CASE WHEN '+text(x)+
    " ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN "+date(x)+'::text ELSE (('+datetime(x)+
    ' AT TIME ZONE '+tz+')::date)::text END)';
  case 'TODAY':count(node,0);return '(('+now+' AT TIME ZONE '+tz+')::date)::text';
  // NOW() is to the minute (seconds 00), as in the browser and Flow runtimes.
  case 'NOW':count(node,0);return "to_char(date_trunc('minute',"+now+" AT TIME ZONE 'UTC'),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
  case 'DAY':case 'MONTH':case 'YEAR':case 'HOUR':case 'MINUTE':case 'SECOND':{
   count(node,1);
   const part=name.toLowerCase();
   const asDateTime='(('+text(x)+')::timestamp)';
   return 'extract('+part+' FROM '+asDateTime+')::integer';
  }
  case 'WEEKDAY':count(node,1);return '(extract(dow FROM '+date(x)+')::integer+1)';
  case 'ADDDAYS':count(node,2);return '('+date(x)+'+'+integer(y)+')::text';
  case 'ADDMONTHS':{
   count(node,2);
   const origin=date(x);
   const first="date_trunc('month',"+origin+"::timestamp)";
   const target='('+first+'+('+integer(y)+"||' months')::interval)";
   const finalDay="extract(day FROM ("+target+"+interval '1 month'-interval '1 day'))";
   return '(('+target+'+(least(extract(day FROM '+origin+'),'+finalDay+")-1)*interval '1 day')::date)::text";
  }
  case 'TIMEVALUE':count(node,1);return "to_char(("+text(x)+")::time,'HH24:MI:SS.MS')";
  case 'TIMENOW':count(node,0);return "to_char("+now+" AT TIME ZONE "+tz+",'HH24:MI:SS.MS')";
  case 'GEOLOCATION':{
   count(node,2);
   return "jsonb_build_object('latitude',"+number(x)+",'longitude',"+number(y)+')';
  }
  case 'DISTANCE':{
   count(node,3);
   const lat=(g:string)=>'('+g+"::jsonb->>'latitude')::numeric";
   const lon=(g:string)=>'('+g+"::jsonb->>'longitude')::numeric";
   const dLat='radians('+lat(y)+'-'+lat(x)+')';
   const dLon='radians('+lon(y)+'-'+lon(x)+')';
   const h='power(sin('+dLat+'/2),2)+cos(radians('+lat(x)+'))*cos(radians('+
    lat(y)+'))*power(sin('+dLon+'/2),2)';
   const kilometers='(6371.0088*2*asin(sqrt(least(1,greatest(0,'+h+')))))';
   return '(CASE lower('+text(z)+") WHEN 'km' THEN "+kilometers+
     " WHEN 'mi' THEN "+kilometers+'/1.609344 ELSE NULL END)';
  }
  default:throw Error('Unsupported SQL formula function: '+name);
 }
}



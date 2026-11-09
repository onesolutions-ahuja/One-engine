// Browser evaluation of SQL display formulas whose record aggregates can be
// answered from rows the page already holds (e.g. a till's open cart lines).
//
// Contract: the result must be byte-identical to the server path
// (formula-sql-runtime.ts + FormulaSqlCompiler.ts on PostgreSQL). The server
// resolves SUMIFS/COUNTIFS/... to JS numbers first, binds them as
// String(number)::numeric, then lets PostgreSQL evaluate the scalar remainder.
// This module mirrors exactly that: numeric values carry a PostgreSQL scale
// (digits after the point) so TEXT(ROUND(x,2)) prints "0.00" like the server.
//
// Anything outside the mirrored subset throws LocalSqlUnsupported, and the
// caller falls back to the server. Never guess.
import {SQL_RECORD_AGGREGATES} from '../../../../server/src/expression-engine/FormulaCategories.js';

export class LocalSqlUnsupported extends Error {}
const bail=reason=>{throw new LocalSqlUnsupported(reason);};

// ---- PostgreSQL numeric (unscaled BigInt + display scale) -----------------
const TEN=10n;
const pow10=n=>TEN**BigInt(n);
const dec=(n,s,inexact=false)=>({kind:'dec',n,s,inexact});
const isDec=v=>v!==null&&typeof v==='object'&&v.kind==='dec';

export function decFromString(text){
 const m=/^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(text).trim());
 if(!m||(m[2]===''&&(m[3]??'')===''))bail('Not a plain numeric literal');
 const frac=m[3]??'';
 let n=BigInt((m[2]||'0')+frac);
 if(m[1]==='-')n=-n;
 return dec(n,frac.length);
}
/** node-postgres binds a JS number as String(number). */
export function decFromNumber(value){
 if(typeof value!=='number'||!Number.isFinite(value))bail('Non-finite number');
 const text=String(value);
 if(/e/i.test(text))bail('Exponent notation');
 return decFromString(text);
}
const align=(a,b)=>{
 const s=Math.max(a.s,b.s);
 return [a.n*pow10(s-a.s),b.n*pow10(s-b.s),s];
};
/** Divide and round half away from zero (PostgreSQL numeric rounding). */
const divRound=(num,den)=>{
 if(den===0n)bail('Division by zero');
 const negative=(num<0n)!==(den<0n);
 const a=num<0n?-num:num,b=den<0n?-den:den;
 let q=a/b;const r=a%b;
 if(r*2n>=b)q+=1n;
 return negative?-q:q;
};
const absBig=n=>n<0n?-n:n;
/** PostgreSQL select_div_scale: weight and first digit in base-10000. */
const baseWeight=d=>{
 const a=absBig(d.n);
 if(a===0n)return {weight:0,first:0};
 let digits=a.toString();
 // Pad fraction to whole base-10000 groups.
 let s=d.s;
 if(s<0){digits=digits+'0'.repeat(-s);s=0;}
 const fracPad=(4-(s%4))%4;
 digits=digits+'0'.repeat(fracPad);
 const totalFrac=(s+fracPad)/4;
 const intLen=digits.length-totalFrac*4;
 const intDigits=intLen>0?digits.slice(0,intLen):'';
 const fracDigits=intLen>0?digits.slice(intLen):'0'.repeat(-intLen)+digits;
 const trimmedInt=intDigits.replace(/^0+/,'');
 if(trimmedInt.length){
  const lead=trimmedInt.length%4||4;
  return {weight:Math.ceil(trimmedInt.length/4)-1,first:Number(trimmedInt.slice(0,lead))};
 }
 for(let i=0;i<fracDigits.length;i+=4){
  const group=Number(fracDigits.slice(i,i+4));
  if(group)return {weight:-(i/4)-1,first:group};
 }
 return {weight:0,first:0};
};
const divScale=(a,b)=>{
 const w1=baseWeight(a),w2=baseWeight(b);
 let qweight=w1.weight-w2.weight;
 if(w1.first<=w2.first)qweight--;
 let rscale=16-qweight*4;
 rscale=Math.max(rscale,a.s,b.s,0);
 return Math.min(rscale,1000);
};
const D={
 add:(a,b)=>{const [x,y,s]=align(a,b);return dec(x+y,s,a.inexact||b.inexact);},
 sub:(a,b)=>{const [x,y,s]=align(a,b);return dec(x-y,s,a.inexact||b.inexact);},
 mul:(a,b)=>dec(a.n*b.n,a.s+b.s,a.inexact||b.inexact),
 div:(a,b)=>{
  if(b.n===0n)bail('Division by zero');
  const s=divScale(a,b);
  // a/b scaled to s: a.n*10^(s+b.s-a.s) / b.n
  return dec(divRound(a.n*pow10(s+b.s-a.s),b.n),s,a.inexact||b.inexact);
 },
 mod:(a,b)=>{
  const [x,y,s]=align(a,b);
  if(y===0n)bail('Division by zero');
  return dec(x-(x/y)*y,s,a.inexact||b.inexact);
 },
 neg:a=>dec(-a.n,a.s,a.inexact),
 cmp:(a,b)=>{const [x,y]=align(a,b);return x<y?-1:x>y?1:0;},
 round:(a,places)=>{
  if(places<0)bail('Negative ROUND places');
  if(places>=a.s)return dec(a.n*pow10(places-a.s),places);
  return dec(divRound(a.n,pow10(a.s-places)),places);
 },
 text:a=>{
  if(a.inexact)bail('Unrounded value of uncertain scale');
  const negative=a.n<0n;
  let digits=absBig(a.n).toString();
  if(a.s>0){
   digits=digits.padStart(a.s+1,'0');
   digits=digits.slice(0,-a.s)+'.'+digits.slice(-a.s);
  }
  return (negative?'-':'')+digits;
 },
 toNumber:a=>Number(D.text({...a,inexact:false}))
};

// ---- SQL-typed values: dec | string | boolean | null ----------------------
const typeOf=v=>v===null?'null':isDec(v)?'numeric':typeof v==='string'?'text':
 typeof v==='boolean'?'boolean':bail('Unsupported value');
const toNumeric=v=>{
 if(v===null)return null;
 if(isDec(v))return v;
 if(typeof v==='string')return decFromString(v);
 return bail('Boolean is not numeric');
};
const toText=v=>v===null?'':isDec(v)?D.text(v):typeof v==='boolean'?(v?'true':'false'):String(v);
const toBool=v=>{
 if(v===null)return false;
 if(typeof v==='boolean')return v;
 if(typeof v==='string'){
  const t=v.trim().toLowerCase();
  if(['true','t','yes','y','on','1'].includes(t))return true;
  if(['false','f','no','n','off','0'].includes(t))return false;
 }
 return bail('Not a boolean');
};
const integerOf=v=>{
 const d=toNumeric(v);
 if(d===null)bail('NULL integer');
 const t=d.n/pow10(d.s); // trunc toward zero
 return Number(t);
};

/** Evaluate a parsed formula whose aggregates are already literals. */
export function evaluateLocalSql(node,refs){
 const ev=n=>evaluateLocalSql(n,refs);
 if(node.kind==='literal'){
  const v=node.value;
  if(v===null)return null;
  if(typeof v==='number')return decFromNumber(v);
  if(typeof v==='boolean'||typeof v==='string')return v;
  return bail('Unsupported literal');
 }
 if(node.kind==='reference')return refs(node.value);
 if(node.kind==='unary'){
  const v=ev(node.value);
  if(node.operator==='NOT')return !toBool(v);
  const d=toNumeric(v);
  if(d===null)return null;
  if(node.operator==='-')return D.neg(d);
  if(node.operator==='+')return d;
  return bail('Unsupported unary operator');
 }
 if(node.kind==='binary'){
  const op=node.operator.toUpperCase();
  if(op==='AND'||op==='OR'){
   // PostgreSQL evaluates both sides; errors on either side matter.
   const l=toBool(ev(node.left)),r=toBool(ev(node.right));
   return op==='AND'?l&&r:l||r;
  }
  const left=ev(node.left),right=ev(node.right);
  if(op==='&')return toText(left)+toText(right);
  if(['=','==','!=','<>','>','>=','<','<='].includes(op)){
   if(left===null||right===null)return null;
   const lt=typeOf(left),rt=typeOf(right);
   if(lt!==rt)bail('Mixed-type comparison');
   let c;
   if(lt==='numeric')c=D.cmp(left,right);
   else if(lt==='text'){
    // Collation-dependent ordering is not mirrored; equality is exact.
    if(!['=','==','!=','<>'].includes(op))bail('Text ordering comparison');
    c=left===right?0:1;
   }else if(lt==='boolean'){
    if(!['=','==','!=','<>'].includes(op))bail('Boolean ordering comparison');
    c=left===right?0:1;
   }else return bail('Unsupported comparison');
   switch(op){
    case '=':case '==':return c===0;
    case '!=':case '<>':return c!==0;
    case '>':return c>0;case '>=':return c>=0;
    case '<':return c<0;case '<=':return c<=0;
   }
  }
  if(['+','-','*','/','%'].includes(op)){
   const a=toNumeric(left),b=toNumeric(right);
   if(a===null||b===null)return null;
   if(op==='+')return D.add(a,b);
   if(op==='-')return D.sub(a,b);
   if(op==='*')return D.mul(a,b);
   if(op==='/')return D.div(a,b);
   return D.mod(a,b);
  }
  return bail('Unsupported operator '+op);
 }
 if(node.kind!=='call')return bail('Unsupported node');
 const name=node.name;
 const args=node.args;
 const need=(min,max=min)=>{if(args.length<min||args.length>max)bail('Arity '+name);};
 switch(name){
  case 'IF':{
   need(3);
   // PostgreSQL resolves one CASE result type at plan time.
   const cond=toBool(ev(args[0]));
   const chosen=ev(cond?args[1]:args[2]);
   const other=ev(cond?args[2]:args[1]);
   if(chosen!==null&&other!==null&&typeOf(chosen)!==typeOf(other))bail('Mixed IF types');
   return chosen;
  }
  case 'AND':need(1,20);return args.map(a=>toBool(ev(a))).every(Boolean);
  case 'OR':need(1,20);return args.map(a=>toBool(ev(a))).some(Boolean);
  case 'NOT':need(1);return !toBool(ev(args[0]));
  case 'TEXT':need(1);return toText(ev(args[0]));
  case 'LEN':need(1);return decFromNumber([...toText(ev(args[0]))].length);
  case 'ISBLANK':{need(1);const v=ev(args[0]);return v===null||toText(v)==='';}
  case 'ISNULL':need(1);return ev(args[0])===null;
  case 'BLANKVALUE':{
   need(2);const v=ev(args[0]);const fallback=ev(args[1]);
   if(v!==null&&fallback!==null&&typeOf(v)!==typeOf(fallback))bail('Mixed BLANKVALUE types');
   return v===null||toText(v)===''?fallback:v;
  }
  case 'NULLVALUE':{
   need(2);const v=ev(args[0]);const fallback=ev(args[1]);
   if(v!==null&&fallback!==null&&typeOf(v)!==typeOf(fallback))bail('Mixed NULLVALUE types');
   return v===null?fallback:v;
  }
  case 'ROUND':{
   need(1,2);
   const d=toNumeric(ev(args[0]));
   const places=args[1]?integerOf(ev(args[1])):0;
   return d===null?null:D.round(d,places);
  }
  case 'ROUNDUP':case 'ROUNDDOWN':{
   need(1,2);
   const d=toNumeric(ev(args[0]));
   const places=args[1]?integerOf(ev(args[1])):0;
   if(d===null)return null;
   if(places<0)bail('Negative places');
   // Exact value of sign(x)*ceil|floor(abs(x)*10^k)/10^k; PostgreSQL's
   // display scale here comes from power()/division, so mark it inexact:
   // it may be compared or ROUNDed, but never printed unrounded.
   const scaled=D.round(dec(absBig(d.n),d.s),Math.max(d.s,places));
   const unit=pow10(scaled.s-places);
   let q=scaled.n/unit;
   if(name==='ROUNDUP'&&scaled.n%unit!==0n)q+=1n;
   return dec(d.n<0n?-q:q,places,true);
  }
  case 'MIN':case 'MAX':{
   need(1,20);
   let best=null;
   for(const arg of args){
    const d=toNumeric(ev(arg));
    if(d===null)continue; // greatest/least ignore NULLs
    if(best===null)best=d;
    else{const c=D.cmp(d,best);if(name==='MAX'?c>0:c<0)best=d;}
   }
   return best;
  }
  default:
   if(SQL_RECORD_AGGREGATES.has(name))return bail('Unresolved aggregate');
   return bail('Function not mirrored locally: '+name);
 }
}

// ---- Aggregates from locally held rows ----------------------------------
const plainName=/^[A-Za-z][A-Za-z0-9_]*$/;
const nameOf=node=>{
 if(node&&(node.kind==='reference'||node.kind==='literal')&&typeof node.value==='string'
   &&plainName.test(node.value))return node.value;
 return bail('Aggregate names must be plain metadata names');
};
/** Exact decimal sum of row values, as PostgreSQL SUM(numeric) would return it. */
const exactSum=values=>values.reduce((total,v)=>D.add(total,decFromNumber(v)),dec(0n,0));

/**
 * Replace every record aggregate with the number the server would bind.
 * criterionValue(node) resolves criterion expressions ($session, $state.x, literals).
 * rowsFor(object, filters) returns the complete matching rows or null.
 */
export async function substituteLocalAggregates(node,criterionValue,rowsFor){
 const walk=async n=>{
  if(n.kind==='call'){
   if(SQL_RECORD_AGGREGATES.has(n.name)){
    const isCount=n.name==='COUNTIFS';
    const object=nameOf(n.args[0]);
    const field=isCount?'':nameOf(n.args[1]);
    const criteria=n.args.slice(isCount?1:2);
    if(criteria.length%2||criteria.length>40)bail('Invalid criteria');
    const filters=[];
    for(let i=0;i<criteria.length;i+=2){
     const value=criterionValue(criteria[i+1]);
     if(value===null||value===undefined||!['string','number','boolean'].includes(typeof value))
      bail('Invalid criterion');
     const text=String(value);
     if(text==='')bail('Blank criterion');
     filters.push({field:nameOf(criteria[i]),operator:'eq',value:text});
    }
    const rows=await rowsFor(object,filters);
    if(!rows)bail('Rows not held locally');
    let value;
    if(isCount)value=rows.length;
    else{
     const numbers=[];
     for(const row of rows){
      if(!Object.prototype.hasOwnProperty.call(row,field))bail('Field not readable locally');
      const v=row[field];
      if(v===null||v===undefined||v==='')continue;
      if(typeof v!=='number')bail('Non-numeric aggregate value');
      numbers.push(v);
     }
     if(!numbers.length)value=0;
     else if(n.name==='SUMIFS'){
      const total=Number(D.text(exactSum(numbers)));
      value=Math.round(total*1e9)/1e9;
     }else if(n.name==='AVERAGEIFS')value=Number(D.text(exactSum(numbers)))/numbers.length;
     else if(n.name==='MINIFS')value=Math.min(...numbers);
     else value=Math.max(...numbers);
    }
    if(!Number.isFinite(value))bail('Non-finite aggregate');
    return {kind:'literal',value};
   }
   return {...n,args:await Promise.all(n.args.map(walk))};
  }
  if(n.kind==='unary')return {...n,value:await walk(n.value)};
  if(n.kind==='binary')return {...n,left:await walk(n.left),right:await walk(n.right)};
  return n;
 };
 return walk(node);
}

/** Plain JS value of a local SQL result, matching to_jsonb() of the server result. */
export function localSqlResultValue(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(isDec(value)){
  if(value.inexact)bail('Unrounded value of uncertain scale');
  return D.toNumber(value);
 }
 return bail('Unsupported result');
}

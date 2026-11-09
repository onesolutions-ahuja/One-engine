import {executeActionPlan,normalizeFlowCalls} from '../../../../server/src/expression-engine/ActionFormulas.js';
/** Bounded browser formula evaluator shared by page bindings and UNE renderers.
 * It reads only own properties of the already-authorised record and never evals code.
 */
import {
 evaluateFormulaBinary,evaluateFormulaUnary,formulaTruth,Parser
} from '../../../../server/src/expression-engine/FormulaParser.js';
import {tokenize} from '../../../../server/src/expression-engine/FormulaTokenizer.js';
import {getTenantBrand} from './TenantBrand.js';
import {createNamedFormulaCollection,createCriteriaFormulaCollection,deriveFormulaCollection,sumFormulaCollection,projectFormulaTable,matchesFormulaCollectionCriterion} from '../../../../server/src/expression-engine/FormulaCollection.js';
import {isExcelWildcardDataReference,matchesExcelWildcard,hasExcelWildcardCriteria} from '../../../../server/src/expression-engine/FormulaWildcard.js';
import {validateFormulaFunctions} from '../../../../server/src/expression-engine/FormulaFunctionRegistry.js';
import {roundFormulaNumber} from '../../../../server/src/expression-engine/FormulaNumeric.js';
import {parseComponentStateReference,readComponentState} from '../../../../server/src/expression-engine/FormulaComponentState.js';
import {
 evaluateFormulaDateBinary,formulaAddDays,formulaAddMonths,formulaDateParts,formulaDateText,
 formulaDateTimeParts,formulaIsoDateTime,formulaTimeText,
 formulaWeekday,isFormulaDate,parseFormulaDateTime
} from '../../../../server/src/expression-engine/FormulaDate.js';

// Authenticated public identity is shared by independently bundled Page components.
// It contains only the allowlisted profile fields, never tokens or credentials.
const SESSION_IDENTITY_KEY=Symbol.for('une.authenticatedFormulaIdentity');
export function setAuthenticatedFormulaSession(context){
 const user=context?.user,organization=context?.organization;
 globalThis[SESSION_IDENTITY_KEY]=user&&organization&&typeof user.Id==='string'
  &&typeof organization.Id==='string'
  ?Object.freeze({user:Object.freeze({Id:user.Id,Name:user.Name,Email:user.Email,
      TimeZone:user.TimeZone,Locale:user.Locale,CurrencyIsoCode:user.CurrencyIsoCode}),
    organization:Object.freeze({Id:organization.Id,Name:organization.Name})}):null;
}
const authenticatedSessionIdentity=context=>
 context?.user&&context?.organization
  ?{user:context.user,organization:context.organization}
  :globalThis[SESSION_IDENTITY_KEY];
const SESSION_USER_FIELDS=Object.freeze({id:'Id',name:'Name',email:'Email',
 timeZone:'TimeZone',locale:'Locale',currencyIsoCode:'CurrencyIsoCode'});
const text=value=>value==null?'':String(value);
const formulaText=value=>typeof value==='boolean'?value?'TRUE':'FALSE':text(value);
const textPoints=value=>Array.from(text(value));
const numeric=value=>{
 const result=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 if(!Number.isFinite(result))throw Error('Expected a finite number');
 return result;
};
const truth=formulaTruth;
const evaluateCall=(name,args,context)=>{
 const arity=(minimum,maximum=minimum)=>{
  if(args.length<minimum||args.length>maximum)throw Error(`Invalid ${name} argument count`);
 };
 switch(name){
  case 'TEXT':arity(1);return formulaText(args[0]);
  case 'VALUE':arity(1);return numeric(args[0]);
  case 'UPPER':arity(1);return text(args[0]).toUpperCase();
  case 'LOWER':arity(1);return text(args[0]).toLowerCase();
  case 'PROPER':arity(1);return text(args[0]).toLowerCase()
   .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu,(_match,prefix,letter)=>prefix+letter.toUpperCase());
  case 'LEN':arity(1);return textPoints(args[0]).length;
  case 'LEFT':arity(1,2);return textPoints(args[0])
   .slice(0,Math.max(0,Math.trunc(numeric(args.length===1?1:args[1])))).join('');
  case 'RIGHT':arity(1,2);{
   const value=textPoints(args[0]),length=Math.max(0,Math.trunc(numeric(args.length===1?1:args[1])));
   return length===0?'':value.slice(-length).join('');
  }
  case 'FIND':arity(2,3);{
   const haystack=textPoints(args[1]),needle=textPoints(args[0]);
   const start=Math.max(0,Math.trunc(numeric(args.length===2?1:args[2]))-1);
   let found=-1;
   for(let index=start;index<=haystack.length-needle.length;index++){
    if(needle.every((point,offset)=>haystack[index+offset]===point)){found=index;break;}
   }
   return found<0?0:found+1;
  }
   case 'BEGINS':case 'CONTAINS':arity(2);
   if(name==='BEGINS')return text(args[0]).startsWith(text(args[1]));
   if(name==='CONTAINS')return text(args[0]).includes(text(args[1]));

  case 'COLLECTION':arity(2,20);return createNamedFormulaCollection(args[0],args.slice(1));
  case 'SUM':arity(1);return sumFormulaCollection(args[0],context.collectionSources);
  case 'ISPICKVAL':arity(2);return text(args[0])===text(args[1]);
  case 'INCLUDES':arity(2);return text(args[0]).split(';').filter(Boolean).includes(text(args[1]));
  case 'ISNUMBER':arity(1);return typeof args[0]==='number'&&Number.isFinite(args[0])
   ||typeof args[0]==='string'&&args[0].trim()!==''&&Number.isFinite(Number(args[0]));
  case 'ISBLANK':arity(1);return args[0]===null||args[0]===undefined||args[0]==='';
  case 'ISNULL':arity(1);return args[0]===null||args[0]===undefined;
  case 'BLANKVALUE':arity(2);return args[0]===null||args[0]===undefined||args[0]===''?args[1]:args[0];
  case 'NULLVALUE':arity(2);return args[0]===null||args[0]===undefined?args[1]:args[0];
  case 'ROUND':case 'ROUNDUP':case 'ROUNDDOWN':{
   arity(1,2);
   const precision=args.length===1?0:numeric(args[1]);
   return roundFormulaNumber(numeric(args[0]),precision,name);
  }
  case 'MIN':arity(1,20);return Math.min(...args.map(numeric));
  case 'MAX':arity(1,20);return Math.max(...args.map(numeric));
  case 'DATE':arity(3);{
   const year=Math.trunc(numeric(args[0])),month=Math.trunc(numeric(args[1])),day=Math.trunc(numeric(args[2]));
   if(year<1||year>9999||month<1||month>12||day<1||day>31)throw Error('Invalid DATE arguments');
   const value=`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
   if(!isFormulaDate(value))throw Error('Invalid DATE arguments');
   return value;
  }
  case 'DATEVALUE':arity(1);{
   const value=text(args[0]);
   if(isFormulaDate(value))return value;
   return formulaDateText(formulaDateParts(parseFormulaDateTime(value,context.timeZone),context.timeZone));
  }
  case 'GEOLOCATION':arity(2);{
   const latitude=numeric(args[0]),longitude=numeric(args[1]);
   if(latitude< -90||latitude>90||longitude< -180||longitude>180)throw Error('Invalid geolocation');
   return {latitude,longitude};
  }
  case 'DISTANCE':arity(3);{
   const coordinates=value=>{
    if(!value||typeof value!=='object'||!('latitude'in value)||!('longitude'in value))throw Error('Invalid geolocation');
    const latitude=numeric(value.latitude),longitude=numeric(value.longitude);
    if(latitude< -90||latitude>90||longitude< -180||longitude>180)throw Error('Invalid geolocation');
    return {latitude,longitude};
   };
   const first=coordinates(args[0]),second=coordinates(args[1]),unit=text(args[2]).toLowerCase();
   const radians=degrees=>degrees*Math.PI/180,lat=radians(second.latitude-first.latitude),lon=radians(second.longitude-first.longitude);
   const haversine=Math.sin(lat/2)**2+Math.cos(radians(first.latitude))*Math.cos(radians(second.latitude))*Math.sin(lon/2)**2;
   const kilometers=6371.0088*2*Math.atan2(Math.sqrt(haversine),Math.sqrt(1-haversine));
   if(unit==='km')return kilometers;
   if(unit==='mi')return kilometers/1.609344;
   throw Error('DISTANCE unit must be km or mi');
  }
  case 'TODAY':arity(0);return formulaDateText(formulaDateParts(context.now,context.timeZone));
  case 'NOW':arity(0);return formulaIsoDateTime(context.now);
  case 'TIMENOW':arity(0);return formulaTimeText(context.now,context.timeZone);
  case 'DAY':case 'MONTH':case 'YEAR':{
   arity(1);const parts=formulaDateTimeParts(text(args[0]),context.timeZone);
   return name==='DAY'?parts.day:name==='MONTH'?parts.month:parts.year;
  }
  case 'HOUR':case 'MINUTE':case 'SECOND':arity(1);{
   const parts=formulaDateTimeParts(text(args[0]),context.timeZone);
   return name==='HOUR'?parts.hour:name==='MINUTE'?parts.minute:parts.second;
  }
  case 'TIMEVALUE':arity(1);{
   const value=text(args[0]);
   const time=/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(value);
   if(time){
    return `${time[1]}:${time[2]}:${time[3]??'00'}.${(time[4]??'').padEnd(3,'0')}`;
   }
   return formulaTimeText(parseFormulaDateTime(value,context.timeZone),context.timeZone);
  }
  case 'WEEKDAY':arity(1);{
   return formulaWeekday(formulaDateTimeParts(text(args[0]),context.timeZone));
  }
  case 'ADDDAYS':arity(2);{
   return formulaAddDays(text(args[0]),numeric(args[1]),context.timeZone);
  }
  case 'ADDMONTHS':arity(2);{
   return formulaAddMonths(text(args[0]),numeric(args[1]),context.timeZone);
  }

  default:throw Error(`Unsupported formula function: ${name}`);
 }
};
export const componentReaderKey=Symbol.for('metadrive.pageFormulaComponentReader');
// Cache only syntax trees, never tenant data, record values, or evaluated results.
// Bound memory and preserve NOW()/state/permission semantics on every evaluation.
const parseCache=new Map();
const timeZoneCache=new Set();
let cacheMisses=0;
export function formulaSyntaxCacheStats(){return {parses:cacheMisses,size:parseCache.size};}
function parsedSyntax(source){
 const cached=parseCache.get(source);
 if(cached){parseCache.delete(source);parseCache.set(source,cached);return cached;}
 const parsed=new Parser(tokenize(source)).parse();
 cacheMisses++;
 if(parseCache.size>=256)parseCache.delete(parseCache.keys().next().value);
 parseCache.set(source,parsed);
 return parsed;
}
function validateFormulaTimeZone(timeZone){
 if(timeZoneCache.has(timeZone))return;
 new Intl.DateTimeFormat('en',{timeZone});
 if(timeZoneCache.size>=48)timeZoneCache.delete(timeZoneCache.values().next().value);
 timeZoneCache.add(timeZone);
}
function parse(source,record,formulaContext){
 const parsed=parsedSyntax(source);
 const expression=formulaContext.flowReferences?normalizeFlowCalls(parsed):parsed;
 return evaluateParsedExpression(expression,record,formulaContext);
}
export function evaluateParsedExpression(expression,record,formulaContext){
 validateFormulaFunctions(expression,'ribbon_binding');
 const resolveReference=(reference,currentRecord=record)=>{
   // Page-local globals are scoped inputs; never read storage or arbitrary records.
   if(reference.startsWith('$component.')){
    const parts=reference.split('.');
    if(parts.length!==3||!formulaContext.readComponent)throw Error('Invalid component reference or missing page context');
    return formulaContext.readComponent(parts[1],parts[2]);
   }
   if(reference==='$session'||reference==='$session.id')
    return typeof formulaContext.sessionId==='string'?formulaContext.sessionId:'';
   if(reference.startsWith('$session.')){
    if(reference==='$session.cartId'){
     const id=formulaContext.pageState?.activeCartId;
     return typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)?id:'';
    }
    // Session identity is not an Object field and cannot be traversed freely.
    const identity=authenticatedSessionIdentity(formulaContext);
    const userKey=reference.startsWith('$session.user.')
     ?reference.slice('$session.user.'.length):'';
    if(Object.hasOwn(SESSION_USER_FIELDS,userKey)){
     if(!identity?.user)throw Error('Authenticated user is unavailable');
     return identity.user[SESSION_USER_FIELDS[userKey]]??'';
    }
    if(reference==='$session.tenant.id'){
     if(!identity?.organization)throw Error('Authenticated tenant is unavailable');
     return identity.organization.Id??'';
    }
    if(reference==='$session.tenant.name'){
     if(!identity?.organization)throw Error('Authenticated tenant is unavailable');
     return formulaContext.tenant?.name||getTenantBrand().name||identity.organization.Name||'';
    }
    if(reference==='$session.tenant.logo'){
     if(!identity?.organization)throw Error('Authenticated tenant is unavailable');
     return formulaContext.tenant?.logo??getTenantBrand().logo??'';
    }
    throw Error('Unsupported session reference: '+reference);
   }
   if(reference.startsWith('$state.')){
    const key=reference.slice(7);
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
     throw Error('Invalid Page State reference');
    const state=formulaContext.pageState;
    if(!state||typeof state!=='object'||Array.isArray(state))return '';
    const descriptor=Object.getOwnPropertyDescriptor(state,key);
    if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value')
      ||descriptor.value===undefined||descriptor.value===null)return '';
    const value=descriptor.value;
    if(!['string','number','boolean'].includes(typeof value)
      ||typeof value==='number'&&!Number.isFinite(value))
     throw Error('Page State formula value must be a finite scalar');
    return value;
   }
   // The signed-in tenant's public brand (Company Settings trading name and logo).
   if(reference.toLowerCase()==='$tenant.name'||reference.toLowerCase()==='$tenant.logo'){
    const tenant=formulaContext.tenant&&typeof formulaContext.tenant==='object'
     ?formulaContext.tenant:getTenantBrand();
    const value=reference.toLowerCase()==='$tenant.name'?tenant.name:tenant.logo;
    return typeof value==='string'?value:'';
   }
   if(/^\$tenant(?:\.|$)/i.test(reference))
    throw Error('Unsupported tenant reference: '+reference+' (use $tenant.name or $tenant.logo)');
   if(reference==='$state')
    throw Error('Unsupported Page State reference: '+reference);
   // $flow.ApiName exists only in the Action formula bar, which passes the runnable
   // Flow names. It evaluates to the text "$flow.ApiName" for the action runtime.
   if(/^\$flow(?:\.|$)/i.test(reference)){
    const flows=formulaContext.flowReferences;
    if(!Array.isArray(flows))
     throw Error('$flow is only available in the Action formula bar');
    const name=reference.slice(6);
    const match=flows.find(item=>typeof item==='string'&&item.toLowerCase()===name.toLowerCase());
    if(!match)throw Error('Unknown or inactive Flow: '+name);
    return '$flow.'+match;
   }
   // Named COLLECTION() results are no longer accessible via @CollectionName.
   // @ComponentName.state.Id/Value/Name/Text: what the user picked, typed or
   // toggled in that component, from the authorised page-session state.
   const selected=parseComponentStateReference(reference);
   if(selected)return readComponentState(formulaContext.namedCollectionSelections
     ??formulaContext.pageState?.collectionSelections,selected.name,selected.field);
   if(/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(reference)){
    if(Object.prototype.hasOwnProperty.call(formulaContext.collectionSources??{},reference))
     throw Error('Use @'+reference+' as a component Data Source, not a scalar field');
    throw Error('Bare @Field and named collection references are unsupported: @'+reference+'; use @Object.Field');
   }
   // Object.Field collection references can use only authorised records
   // supplied by the Page Runtime; a formula never performs a database query.
   const sourceRef=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(reference);
   const sources=formulaContext.collectionSources;
   // Multiple-record components still resolve each display property against
   // its current row, not against the entire collection of records.
   if(sourceRef&&formulaContext.collectionResult!==true
     &&sourceRef[1]===formulaContext.rootObjectApiName
     &&currentRecord&&typeof currentRecord==='object'&&!Array.isArray(currentRecord)
     &&Object.prototype.hasOwnProperty.call(currentRecord,sourceRef[2]))
    return currentRecord[sourceRef[2]]??'';
   if(sourceRef&&formulaContext.collectionResult===true
     &&!['state','event','session'].includes(sourceRef[1])
     &&(!sources||!Object.prototype.hasOwnProperty.call(sources,sourceRef[1])))
    throw Error('COLLECTION source unavailable: '+sourceRef[1]);
   if(sourceRef&&sources&&Object.prototype.hasOwnProperty.call(sources,sourceRef[1])
     &&formulaContext.collectionResult===true){
    const rows=sources[sourceRef[1]];
    if(!Array.isArray(rows))throw Error('COLLECTION source unavailable: '+sourceRef[1]);
    if(rows.length>200)throw Error('COLLECTION source exceeds 200 records');
    // An accessible field with an unset value may be omitted from Object API
    // records. Validate the field against authorised metadata (when supplied),
    // otherwise require it on at least one row; never expose an unknown field.
    const permitted=formulaContext.collectionSourceFields?.[sourceRef[1]];
    const known=Array.isArray(permitted)?permitted.includes(sourceRef[2]):
     rows.some(row=>row&&typeof row==='object'&&!Array.isArray(row)
       &&Object.prototype.hasOwnProperty.call(row,sourceRef[2]));
    if(!known)throw Error('COLLECTION field unavailable: '+reference);
    return rows.flatMap(row=>{
     if(!row||typeof row!=='object'||Array.isArray(row))
      throw Error('Invalid COLLECTION source record');
     if(!Object.prototype.hasOwnProperty.call(row,sourceRef[2])
       ||row[sourceRef[2]]===null||row[sourceRef[2]]===undefined
       ||row[sourceRef[2]]==='')return [];
     const value=row[sourceRef[2]];
     const id=row.Id??row.id;
     if(id===undefined||id===null||typeof id!=='string'&&typeof id!=='number')
      throw Error('COLLECTION source record has no ID');
     if(value!==null&&value!==undefined&&!['string','number','boolean'].includes(typeof value))
      throw Error('COLLECTION field must be scalar: '+reference);
     return [{label:String(value),
       value:String(id),record:row,objectApiName:sourceRef[1]}];
    });
   }
  if(!currentRecord||typeof currentRecord!=='object'||Array.isArray(currentRecord))return '';
  const parts=reference.split('.');
 if(parts.some(part=>!part||['__proto__','prototype','constructor'].includes(part)))throw Error('Invalid formula token');
  const ownValue=(source,key)=>{
   const descriptor=Object.getOwnPropertyDescriptor(source,key);
   return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')
    ?descriptor.value:undefined;
  };
  // Action results are returned by authorised Record/Files services and may
  // be referenced as AS(alias).Field without unrelated record mention hydration.
  // The runtime supplies the explicit aliases: never trust a page property to
  // declare which nested objects may be read.
  if(parts.length===2&&Array.isArray(formulaContext.actionAliases)&&
    formulaContext.actionAliases.includes(parts[0])){
   const result=ownValue(ownValue(currentRecord,parts[0])??{},parts[1]);
   if(result===undefined||result===null)return '';
   if(!['string','number','boolean'].includes(typeof result))
    throw Error('Action result field must be a permitted scalar');
   return result;
  }
  // Related values have been hydrated against Object Manager metadata and
  // read permissions by the Page Runtime; they are not arbitrary JS traversal.
  if(reference.includes('.')){
   const mentions=ownValue(currentRecord,'__mentionValues');
   if(mentions&&typeof mentions==='object'&&!Array.isArray(mentions)
    &&Object.getPrototypeOf(mentions)===Object.prototype){
    const resolved=ownValue(mentions,'@'+reference);
    if(resolved!==undefined)return resolved===null?'':resolved;
    // A missing hydrated path must not fall through into unverified nested data.
    return '';
   }
  }
  // The selected Object can be addressed as @Object.Field as well as @Field;
  // both read the same authorised currentRecord and do not execute another query.
  if(sourceRef&&sourceRef[1]===formulaContext.rootObjectApiName
    &&Object.prototype.hasOwnProperty.call(currentRecord,sourceRef[2]))
   return ownValue(currentRecord,sourceRef[2])??'';
  if(sourceRef&&sourceRef[1]!==formulaContext.rootObjectApiName
    &&!['state','event','session'].includes(sourceRef[1]))
   throw Error('Object field is not bound to the current record: @'+reference);
  if(Object.prototype.hasOwnProperty.call(currentRecord,reference))return ownValue(currentRecord,reference)??'';
  let value=currentRecord;
  for(const part of parts){
   if(!value||typeof value!=='object'||Array.isArray(value)
    ||!Object.prototype.hasOwnProperty.call(value,part))return '';
   value=ownValue(value,part);
  }
  return value??'';
 };
 // A Collection supports SUMIFS-like clauses:
 // name, caption, @Field, criterion, caption2, @Field2, criterion2...
 // A lone @Field or @Field = criterion expands authorised source records.
 // Legacy scalar items remain supported. No source is fetched by this evaluator.
 const evaluateCriteriaCollection=args=>{
  if(!args.length)throw Error('COLLECTION requires a name');
  const name=args[0].kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(args[0].value)
    ?args[0].value:evaluate(args[0]),items=[];
  if(args.length===3&&args[1].kind==='reference'){
   const sourceName=args[1].value;
   const owned=formulaContext.namedCollections&&Object.entries(formulaContext.namedCollections)
    .some(([key])=>key.toLowerCase()===sourceName.toLowerCase());
   if(owned)return deriveFormulaCollection(name,evaluate(args[1]),evaluate(args[2]));
   const root=formulaContext.rootObjectApiName;
   const rows=root&&formulaContext.collectionSources?.[root];
   const isField=Array.isArray(rows)&&rows.some(row=>row&&typeof row==='object'
     &&Object.prototype.hasOwnProperty.call(row,sourceName));
   // An unpublished/removed upstream collection must clear descendants instead
   // of retaining a previously rendered source under legacy syntax recovery.
   if(!isField&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(sourceName))
    throw Error('Named collection source unavailable: @'+sourceName);
  }
  const sourceField=node=>{
   if(node?.kind!=='reference')return null;
   const raw=node.value,parts=raw.split('.');
   if(parts.length!==2||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))return null;
   const object=parts[0];
   const field=parts.at(-1);
   const sources=formulaContext.collectionSources;
   if(!object||!sources||!Object.prototype.hasOwnProperty.call(sources,object))return null;
   return {object,field,reference:object+'.'+field};
  };
  const rowsFor=pointer=>{
   const rows=formulaContext.collectionSources[pointer.object];
   if(!Array.isArray(rows))throw Error('COLLECTION source unavailable: '+pointer.object);
   if(rows.length>200)throw Error('COLLECTION source exceeds 200 records');
   return rows;
  };
  const isCriteriaComparison=node=>node?.kind==='binary'
   &&['=','==','<>','!=','<','<=','>','>='].includes(node.operator)&&Boolean(sourceField(node.left));
  const sourceItems=(pointer,criterion,operator='')=>{
   const rows=rowsFor(pointer);
   const permitted=formulaContext.collectionSourceFields?.[pointer.object];
   const known=Array.isArray(permitted)?permitted.includes(pointer.field):
    rows.some(row=>row&&typeof row==='object'&&!Array.isArray(row)
      &&Object.prototype.hasOwnProperty.call(row,pointer.field));
   if(!known)throw Error('COLLECTION field unavailable: '+pointer.reference);
   for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))
     throw Error('Invalid COLLECTION source record');
    // Unset nullable/lookup fields are omitted by generic CRUD, not invalid.
    if(!Object.prototype.hasOwnProperty.call(row,pointer.field))continue;
    const value=row[pointer.field],id=row.Id??row.id;
    if(value===null||value===undefined||String(value).trim()==='')continue;
    if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')
     throw Error('COLLECTION field must be scalar: '+pointer.reference);
    if(id===null||id===undefined||String(id).trim()==='')
     throw Error('COLLECTION source record has no ID');
    if(operator&&!matchesFormulaCollectionCriterion(value,operator+String(criterion)))continue;
    items.push({label:String(value),value:String(id),criteriaField:pointer.reference,
     criteria:String(value),record:row,objectApiName:pointer.object});
    if(items.length>200)throw Error('COLLECTION exceeds 200 entries');
   }
  };
  for(let index=1;index<args.length;){
   const node=args[index];
   // A literal caption followed by a field and explicit criterion forms a clause.
   if(node.kind==='literal'&&typeof node.value==='string'&&index+2<args.length
     &&args[index+1].kind==='literal'&&args[index+1].value===''){
    // A blank Field explicitly targets the caption instead of an Object field.
    const criterion=evaluate(args[index+2]);
    if(matchesFormulaCollectionCriterion(node.value,criterion))items.push(node.value);
    index+=3;continue;
   }
   if(node.kind==='literal'&&typeof node.value==='string'&&
     index+2<args.length&&sourceField(args[index+1])){
    const pointer=sourceField(args[index+1]);
    const criterion=evaluate(args[index+2]);
    if(criterion!==''&&typeof criterion!=='string'&&typeof criterion!=='number'
      &&typeof criterion!=='boolean')throw Error('Invalid COLLECTION criterion for '+pointer.reference);
    const matching=criterion===''?'*':String(criterion);
    items.push({label:node.value,value:matching,criteriaField:pointer.reference,
      criteria:matching,objectApiName:pointer.object});
    index+=3;continue;
   }
   if(isCriteriaComparison(node)){
    const pointer=sourceField(node.left),criterion=evaluate(node.right);
    if(criterion===null||!['string','number','boolean'].includes(typeof criterion)
      ||typeof criterion==='number'&&!Number.isFinite(criterion))
     throw Error('COLLECTION field comparison requires a scalar criterion');
    sourceItems(pointer,criterion,node.operator);index++;continue;
   }
   const pointer=sourceField(node);
   if(pointer){sourceItems(pointer,'');index++;continue;}
   const result=evaluate(node);
   if(Array.isArray(result))items.push(...result);
   else items.push(result);
   index++;
  }
  return createCriteriaFormulaCollection(name,items);
 };
 const evaluate=(node,currentRecord=record)=>{
  let result;
  if(node.kind==='literal')result=node.value;
  else if(node.kind==='reference')result=resolveReference(node.value,currentRecord);
  else if(node.kind==='unary')result=evaluateFormulaUnary(node.operator,evaluate(node.value,currentRecord));
  else if(node.kind==='binary'){
   const left=evaluate(node.left,currentRecord);
   if(node.operator==='AND'&&!truth(left))return false;
   if(node.operator==='OR'&&truth(left))return true;
   const right=evaluate(node.right,currentRecord);
   const temporal=evaluateFormulaDateBinary(node.operator,left,right,formulaContext.timeZone);
   result=temporal.handled?temporal.value:evaluateFormulaBinary(node.operator,left,right,
    node.left.kind==='reference'&&isExcelWildcardDataReference(node.left.value));
  }else if(node.name==='IF'){
   result=truth(evaluate(node.args[0],currentRecord))?evaluate(node.args[1],currentRecord):evaluate(node.args[2],currentRecord);
  }else if(node.name==='NOT'){
   result=!truth(evaluate(node.args[0],currentRecord));
  }else if(node.name==='IFERROR'){
   try{result=evaluate(node.args[0],currentRecord);}catch{result=evaluate(node.args[1],currentRecord);}
  }else if(node.name==='BLANKVALUE'||node.name==='NULLVALUE'){
   const value=evaluate(node.args[0],currentRecord);
   result=value===null||value===undefined||node.name==='BLANKVALUE'&&value===''?
    evaluate(node.args[1],currentRecord):value;
  }else if(node.name==='AND'){
   result=true;
   for(const argument of node.args)if(!truth(evaluate(argument,currentRecord))){result=false;break;}
  }else if(node.name==='OR'){
   result=false;
   for(const argument of node.args)if(truth(evaluate(argument,currentRecord))){result=true;break;}
  }else if(node.name==='COLLECTION'){
   result=evaluateCriteriaCollection(node.args);
  }else if(node.name==='TABLE'){
   const first=node.args[0];
   if(first?.kind!=='reference'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(first.value))
    throw Error('TABLE first argument must be an Object source such as @Product');
   const object=Object.keys(formulaContext.collectionSources??{}).find(name=>
    name.toLowerCase()===first.value.toLowerCase())??first.value;
   const rows=formulaContext.collectionSources?.[object];
   const permitted=formulaContext.collectionSourceFields?.[object];
   if(!Array.isArray(rows)||!Array.isArray(permitted))
    throw Error('TABLE source is unavailable or not authorised: '+object);
   const columns=node.args.slice(1).map(argument=>{
    if(argument.kind!=='reference')
     throw Error('TABLE columns must be Object fields');
    const reference=argument.value;
    const parts=reference.split('.');
    if(parts.length>2||parts.length===2&&parts[0].toLowerCase()!==object.toLowerCase()
      ||parts.some(part=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(part)))
     throw Error('TABLE field does not belong to source '+object);
    return permitted.find(field=>field.toLowerCase()===parts.at(-1).toLowerCase())??parts.at(-1);
   });
   result=projectFormulaTable(object,rows,permitted,columns);
  }else if(node.name==='SUM'&&node.args.length===1){
   const operand=node.args[0];
   const rows=formulaContext.collectionRows;
   // A single row-field (or row expression) sums over the bounded, authorised
   // collection passed by the page runtime. This is universal, not Cart logic.
   const rowField=reference=>{
    const match=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(reference);
    return Boolean(match&&match[1]===formulaContext.rootObjectApiName
     &&Array.isArray(rows)&&rows.some(row=>row&&typeof row==='object'
       &&Object.prototype.hasOwnProperty.call(row,match[2])));
   };
   const usesRowField=part=>part.kind==='reference'?rowField(part.value):
    part.kind==='unary'?usesRowField(part.value):
    part.kind==='binary'?usesRowField(part.left)||usesRowField(part.right):
    part.kind==='call'&&part.name!=='SUM'?part.args.some(usesRowField):false;
   const objectField=operand.kind==='reference'
    ?/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(operand.value):null;
   const sourceRows=objectField?formulaContext.collectionSources?.[objectField[1]]:null;
   const permitted=objectField?formulaContext.collectionSourceFields?.[objectField[1]]:null;
   if(Array.isArray(sourceRows)&&(!Array.isArray(permitted)||!permitted.includes(objectField[2])))
    throw Error('COLLECTION field unavailable: '+objectField[0]);
   if(Array.isArray(sourceRows)&&sourceRows.length>200)
    throw Error('SUM requires a bounded numeric collection');
   const direct=Array.isArray(sourceRows)&&objectField
    ?sourceRows.map(row=>({objectApiName:objectField[1],record:row}))
    :operand.kind==='reference'?evaluate(operand,currentRecord):null;
   if(objectField&&Array.isArray(direct)
    &&direct.every(item=>item&&typeof item==='object'&&!Array.isArray(item)
      &&item.objectApiName===objectField[1]&&item.record&&typeof item.record==='object')){
    // @Object.Field was resolved against already-authorised rows and FLS.
    // Aggregate the numeric field, never the record IDs used for selections.
    result=sumFormulaCollection(direct.map(item=>item.record[objectField[2]]),
     formulaContext.collectionSources);
   }else if(Array.isArray(direct)||(direct&&typeof direct==='object'&&Array.isArray(direct.items))){
    result=sumFormulaCollection(direct,formulaContext.collectionSources);
   }else if(Array.isArray(rows)&&rows.length===0
    &&operand.kind==='reference'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(operand.value)){
    // A complete empty row set has a zero sum. A missing row set must still
    // fail instead of presenting an unloaded or partially loaded cart as zero.
    result=0;
   }else if(Array.isArray(rows)&&usesRowField(operand)){
    if(rows.length>200)throw Error('SUM requires a bounded numeric collection');
    const values=rows.map(row=>{
     const value=evaluate(operand,row);
     const number=typeof value==='number'?value:
      typeof value==='string'&&value.trim()?Number(value):NaN;
     if(!Number.isFinite(number))throw Error('SUM requires finite numeric collection values');
     return number;
    });
    result=sumFormulaCollection(values,formulaContext.collectionSources);
   }else{
    result=evaluateCall('SUM',[evaluate(operand,currentRecord)],formulaContext);
   }
  }else if(node.kind==='call'){
   result=evaluateCall(node.name,node.args.map(argument=>evaluate(argument,currentRecord)),formulaContext);
  }else throw Error('Invalid formula syntax');
  if(typeof result==='number'&&!Number.isFinite(result))
   throw Error('Formula result must be finite');
  return result;
 };
 return evaluate(expression);
}
export class FieldExpressionEvaluationError extends Error {
 constructor(message){super(message);this.name='FieldExpressionEvaluationError';}
}
export function evaluateFieldExpressionDetailed(expression,record,options={}){
 if(typeof expression!=='string')return {value:''};
 if(expression.length>4000)return {value:'',error:'Formula exceeds the 4000-character limit'};
 const entered=expression.trim();if(!entered)return {value:''};
 // Excel convention: '=' makes a formula; Collection(...) without '=' is plain text
 // in ordinary display properties. Preserve legacy metadata-only collection sources.
 const explicit=entered.startsWith('=');
 const input=explicit?entered.slice(1).trim():entered;
 if(explicit&&!input)return {value:'',error:'Complete the formula after ='};
 if(!explicit&&!options?.collectionResult&&/^COLLECTION\s*\(/i.test(input))
  return {value:expression};
 if(!/^(?:TRUE|FALSE|NULL|PI)$/i.test(input)&&!/@[A-Za-z]/.test(input)&&!input.startsWith('@')&&!/^\$(?:component|state|session|tenant|flow)(?:\.|$)/i.test(input)&&!/^[A-Za-z][A-Za-z0-9_]*\s*\(/.test(input)
  &&!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+(?:\s*\(|$)/.test(input)
  &&!/^(?:["(]|[-+]?\d+(?:\.\d+)?\s*[+*\/%^<>=!-])/.test(input)
  &&!/\s(?:[&+*/%^<>=!]|AND\b|OR\b)\s/i.test(input))return {value:expression};
 try{
  if(!options||typeof options!=='object'||Array.isArray(options))
   throw Error('Invalid formula evaluation context');
  const timeZone=options.timeZone??'UTC';
  if(typeof timeZone!=='string'||timeZone.length>100)throw Error('Invalid formula time zone');
  validateFormulaTimeZone(timeZone);
  const now=options.now===undefined?new Date():options.now instanceof Date
   ?new Date(options.now):typeof options.now==='string'
    ?parseFormulaDateTime(options.now,'UTC'):new Date(NaN);
  if(!Number.isFinite(now.getTime()))throw Error('Invalid formula evaluation time');
  const result=parse(input,record,{timeZone,now,collectionSources:options.collectionSources,
   collectionSourceFields:options.collectionSourceFields,
   collectionResult:options.collectionResult===true,
   namedCollections:options.namedCollections,
   namedCollectionSelections:options.namedCollectionSelections,
   collectionRows:options.collectionRows,
   readComponent:options.readComponent??options.pageState?.[componentReaderKey],
   pageState:options.pageState,sessionId:options.sessionId,tenant:options.tenant,
    user:options.user,organization:options.organization,
   flowReferences:options.flowReferences,
   rootObjectApiName:options.rootObjectApiName});
  if(options.collectionResult===true){
   if(!result||typeof result!=='object'||Array.isArray(result)
     ||typeof result.name!=='string'||!Array.isArray(result.items))
    return {value:null,error:'Collection formula must return a TABLE() or COLLECTION() dataset'}; 
   return {value:result};
  }
  if(result&&typeof result==='object'&&!Array.isArray(result)&&typeof result.name==='string'&&Array.isArray(result.items))
   return {value:'',error:'Use a dataset source for TABLE() or COLLECTION() results'};
  if(typeof result==='number'&&!Number.isFinite(result))return {value:'',error:'Formula result is not finite'};
  return {value:text(result)};
 }catch(failure){
  return {value:'',error:failure instanceof Error?failure.message:'Formula evaluation failed'};
 }
}
export function evaluateFieldExpression(expression,record,options){
 const result=evaluateFieldExpressionDetailed(expression,record,options);
 return result.error?'':result.value;
}

/** Returns a named, typed collection instead of coercing it to a text field. */
export function evaluateCollectionFormula(formula,sourceRecords={},context={}){
 const source=typeof formula==='string'?formula.trim().replace(/^=\s*/,''):'';
 if(!source)return {value:null,error:'Enter a collection formula'};
 return evaluateFieldExpressionDetailed(source,context?.record&&typeof context.record==='object'
   &&!Array.isArray(context.record)?context.record:{},
  {collectionSources:sourceRecords,collectionSourceFields:context?.collectionSourceFields,
   collectionResult:true,rootObjectApiName:context?.primaryObject,
   namedCollections:context?.namedCollections,
   pageState:context?.state,sessionId:context?.session?.id,
   namedCollectionSelections:context?.state?.collectionSelections});
}

/** Explicit action entry point. Ordinary field evaluation remains side-effect free. */
export function executeActionFormula(formula,record,context,services){
 return executeActionPlan(formula,{...record,sessionId:context?.sessionId??''},
  (node,scope,aliases,state)=>evaluateParsedExpression(node,scope,{...context,actionAliases:aliases,
   // Actions read the same page inputs as bindings: $component.X.prop and TABLE()/COLLECTION() sources.
   readComponent:context?.readComponent??context?.pageState?.[componentReaderKey],
   collectionSources:context?.collectionSources??{},
   pageState:state&&Object.keys(state).length?{...(context?.pageState??{}),...state}:context?.pageState}),services);
}

import {
 evaluateFieldExpressionDetailed,FieldExpressionEvaluationError,setAuthenticatedFormulaSession,
 type FormulaBindingContext
} from '../../../component-libraries/shared/FieldExpression.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {isSelectedSqlFormula} from '../../../component-libraries/shared/useSqlFormulaDisplay.js';

let authenticatedFormulaBindingContext:FormulaBindingContext|null=null;
export function setAuthenticatedFormulaBindingContext(user:unknown):void {
  if(!user||typeof user!=='object'||Array.isArray(user)){
    authenticatedFormulaBindingContext=null;
    setAuthenticatedFormulaSession(null);
    return;
  }
  const session=user as Record<string,unknown>;
  if(typeof session.timeZone!=='string'||!session.timeZone
    ||typeof session.locale!=='string'||!session.locale){
    authenticatedFormulaBindingContext=null;
    setAuthenticatedFormulaSession(null);
    return;
  }
  new Intl.DateTimeFormat('en',{timeZone:session.timeZone});
  authenticatedFormulaBindingContext=Object.freeze({
    timeZone:session.timeZone,locale:session.locale,
    currencyIsoCode:typeof session.currencyIsoCode==='string'?session.currencyIsoCode:null,
    user:Object.freeze({
      Id:session.id,Name:session.displayName,Email:session.email,TimeZone:session.timeZone,
      Locale:session.locale,CurrencyIsoCode:session.currencyIsoCode??null
    }),
    profile:Object.freeze({
      Id:session.profileId??null,Name:session.profileName??null,
      DeveloperName:session.profileApi??null
    }),
    organization:Object.freeze({Id:session.tenantId,Name:session.tenantName})
  });
  setAuthenticatedFormulaSession(authenticatedFormulaBindingContext);
}
export function getAuthenticatedFormulaBindingContext():FormulaBindingContext|null {
  return authenticatedFormulaBindingContext;
}

function isFieldExpression(value:string):boolean{
  const input=value.trim().replace(/^=\s*/,'');
  return /^(?:TRUE|FALSE|NULL|PI)$/i.test(input)||input.startsWith('(')||/^[+-]\d/.test(input)
    ||input.startsWith('@')||input.startsWith('{!')||/^\$(?:component|state|session)(?:\.|$)/.test(input)||/^"(?:[^"]|"")*"\s*&/.test(input)
    ||/^(?:\d+(?:\.\d+)?\s*[+\-*/%^<>]|"(?:[^"]|"")*"\s*(?:&|=|<>|!=|<=|>=|<|>))/.test(input)
    ||/^(?:IF|IFERROR|CASE|AND|OR|NOT|XOR|ISBLANK|ISNULL|ISNUMBER|BLANKVALUE|NULLVALUE|TEXT|VALUE|ASCII|LOWER|UPPER|PROPER|INITCAP|LEN|TRIM|LEFT|RIGHT|MID|FIND|BEGINS|CONTAINS|EXACT|ISPICKVAL|INCLUDES|CONCATENATE|SUBSTITUTE|REPT|REVERSE|ENCODEURL|URLENCODE|URLDECODE|LPAD|RPAD|REPLACE|CHAR|CASESAFEID|T|COLLECTION|COLLECTIONCOUNT|COLLECTIONSUM|SUM|VLOOKUP|ABS|ROUND|ROUNDUP|ROUNDDOWN|TRUNC|SIGN|MIN|MAX|MOD|SQRT|POWER|CEILING|FLOOR|MCEILING|MFLOOR|EXP|LN|LOG|SIN|COS|TAN|ASIN|ACOS|ATAN|ATAN2|SINH|COSH|TANH|DEGREES|RADIANS|DATE|DATEVALUE|DATETIMEVALUE|TODAY|NOW|DAY|MONTH|YEAR|HOUR|MINUTE|SECOND|TIMEVALUE|TIMENOW|TZOFFSET|WEEKDAY|ISOWEEK|ISOYEAR|ADDDAYS|ADDMONTHS|GEOLOCATION|DISTANCE)\s*\(/i.test(input);
}

/** Resolve text-property bindings against the already authorised record supplied to the component.
 * Never eval expressions, traverse dotted paths or fetch fields outside the runtime record. */
export function resolveFieldText(
  expression:unknown,record:unknown,context?:FormulaBindingContext
):unknown {
  if(typeof expression!=='string')return expression;
  if(!isFieldExpression(expression))return expression;
  for(const [,scope,property] of expression.matchAll(
    /(?:@|\{!)\$(User|Profile|Organization|RecordType|Permission)(?:\.([A-Za-z][A-Za-z0-9_]*))?/g)){
    const supported=scope==='User'
      ?['Id','Name','Email','TimeZone','Locale','CurrencyIsoCode']
      :scope==='Profile'||scope==='RecordType'?['Id','Name','DeveloperName']
        :scope==='Organization'?['Id','Name']:[];
    if(scope==='Permission'&&(!context?.permissions||!property
      ||!Object.hasOwn(context.permissions,property)))
      throw new FieldExpressionEvaluationError('Custom permission snapshot is unavailable in page-binding context');
    if(property&&scope!=='Permission'&&!supported.includes(property))
      throw new FieldExpressionEvaluationError('Unsupported formula global reference: $'+scope+'.'+property);
  }
  const source=record&&typeof record==='object'&&!Array.isArray(record)?record as Record<string,unknown>:{};
  if(/(?:@|\{!)\$Permission\./.test(expression)&&!context?.permissions)
    throw new FieldExpressionEvaluationError('Custom permissions are unavailable in page-binding context');
  const recordType=context?.recordType??(typeof source.RecordTypeId==='string'
    ?{Id:source.RecordTypeId}:undefined);
  const referenceSource={
    ...source,Record:source,'$Record':source,
    ...(context?.user?{'$User':context.user}:{}),
    ...(context?.profile?{'$Profile':context.profile}:{}),
    ...(context?.organization?{'$Organization':context.organization}:{}),
    ...(recordType?{'$RecordType':recordType}:{}),
    ...(context?.permissions?{'$Permission':context.permissions}:{})
  };
  const result=evaluateFieldExpressionDetailed(expression,referenceSource,context);
  if(result.error)throw new FieldExpressionEvaluationError(result.error);
  return result.value;
}

export function resolveRegisteredTextProperties(
 definitions:ReadonlyArray<{propertyKey:string;kind:string}>,properties:Record<string,unknown>,
 context?:FormulaBindingContext,readComponent?:FormulaBindingContext['readComponent']
):Record<string,unknown>{
  const baseContext=context??getAuthenticatedFormulaBindingContext()??undefined;
  // Shared formula aggregation may consume only a complete, already-authorised
  // renderer row set. Do not calculate misleading totals from a paged subset.
  const rows=Array.isArray(properties.records)?properties.records:null;
  const pagination=properties.recordPagination as {offset?:number;total?:number}|undefined;
  const completeRows=rows&&rows.length<=200&&
    (!pagination||(pagination.offset===0&&typeof pagination.total==='number'&&pagination.total<=rows.length))
    ?rows as Record<string,unknown>[]:undefined;
  const formulaContext={...(baseContext??{}),readComponent:readComponent??baseContext?.readComponent,now:baseContext?.now??new Date(),
    ...(completeRows?{collectionRows:completeRows}:{}),
    ...(properties.formulaCollectionSources&&typeof properties.formulaCollectionSources==='object'
      ?{collectionSources:properties.formulaCollectionSources as FormulaBindingContext['collectionSources']}:{}),
    ...(properties.namedCollections&&typeof properties.namedCollections==='object'
      ?{namedCollections:properties.namedCollections as FormulaBindingContext['namedCollections']}:{}),
    ...(typeof properties.objectApiName==='string'?{rootObjectApiName:properties.objectApiName}:{}),
    ...(properties.pageState&&typeof properties.pageState==='object'&&!Array.isArray(properties.pageState)
      ?{pageState:properties.pageState as FormulaBindingContext['pageState'],
        namedCollectionSelections:(properties.pageState as Record<string,unknown>).collectionSelections as FormulaBindingContext['namedCollectionSelections']}: {}),
    ...(typeof properties.sessionId==='string'?{sessionId:properties.sessionId}: {})};
  const record=properties.record??properties.currentRecord??properties.recordData;
  const hasRecord=Boolean(record&&typeof record==='object'&&!Array.isArray(record));
  const resolvedContext=withRecordTypeContext(formulaContext,record,properties.object);
  let next=properties;
  // Binding formulas on repeating rows are resolved by the row renderer.
  const authored=properties.properties;
  const extra=authored&&typeof authored==='object'&&!Array.isArray(authored)
    ?Object.entries(authored).filter(([key,value])=>typeof value==='string'&&value.includes('$component.')
      &&!definitions.some(field=>field.propertyKey===key)).map(([propertyKey])=>({propertyKey,kind:'TEXT'})):[];
  for(const definition of [...definitions,...extra]){
    if(!['TEXT','LONG_TEXT','TEXTAREA','STRING'].includes(definition.kind))continue;
    const value=properties[definition.propertyKey];
    if(typeof value!=='string'||!isFieldExpression(value))continue;
    // Selected functions are resolved by the mounted SQL display adapter.
    if(isSelectedSqlFormula(value))continue;
    const localRefs=[...value.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)].map(match=>match[1]);
    // Validate explicit bound Object fields against the authorised metadata,
    // not against returned row keys: a real nullable field may be absent from
    // the record without being invalid. An unbound field remains empty.
    const boundObject=typeof properties.objectApiName==='string'?
      properties.objectApiName:'';
    const objects=Array.isArray(properties.objects)?properties.objects:[];
    const object=objects.find(entry=>entry&&typeof entry==='object'
      &&(entry as {apiName?:unknown}).apiName===boundObject) as
      {fields?:Array<{apiName:string}>}|undefined;
    if(boundObject&&Array.isArray(object?.fields)){
      try{
        const selectedObjectNames=new Set(objects.map(entry=>
          entry&&typeof entry==='object'?(entry as {apiName?:unknown}).apiName:undefined));
        for(const token of tokenize(value)){
          if(token.kind!=='reference'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(token.value))continue;
          if(selectedObjectNames.has(token.value)||
            ['Record','state','session','event'].includes(token.value))continue;
          throw new FieldExpressionEvaluationError(
            'Bare @Field and named collection references are unsupported: @'+token.value+'; use @Object.Field');
        }
      }catch(error){
        if(error instanceof FieldExpressionEvaluationError)throw error;
        // Existing formula evaluator owns all syntax and complexity errors.
      }
    }
    if(!hasRecord&&rows&&rows.length>1&&value.includes('$component.')&&localRefs.length)continue;
    // A Grid/Card/Cart has MANY rows. The renderer, not the enclosing
    // RegisteredComponent, evaluates @Object.Field separately for each row.
    if(!hasRecord&&/@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value)
      &&!/\b(?:COLLECTION|TABLE|SUM|SUMIFS|COUNTIFS|AVERAGEIFS|MINIFS|MAXIFS)\s*\(/i.test(value))continue;
    // SUM may be nested in a text expression (e.g. "£ " & SUM(@LineTotal)).
    // Do not pre-evaluate a partial record page and show a misleading total.
    const localSum=/\bSUM\s*\(/i.test(value)&&rows?.some(row=>
      row&&typeof row==='object'&&!Array.isArray(row)&&localRefs.some(key=>Object.hasOwn(row,key)));
    if(localSum&&!completeRows)continue; // Never evaluate totals from an incomplete page.
    const hasNamed=Boolean(formulaContext.namedCollections&&Object.keys(formulaContext.namedCollections).length);
    const hasSources=Boolean(formulaContext.collectionSources&&Object.values(formulaContext.collectionSources)
      .some(value=>Array.isArray(value)&&value.length>0));
    if(!hasRecord&&/@[A-Za-z]/.test(value)&&!hasNamed&&!hasSources
      &&!Array.isArray(formulaContext.collectionRows))continue;
    if(!resolvedContext?.timeZone&&requiresAuthenticatedTimeZone(value,record))
      throw new FieldExpressionEvaluationError('Authenticated formula time zone is unavailable');
    if(next===properties)next={...properties};
    next[definition.propertyKey]=resolveFieldText(value,record,resolvedContext);
  }
  return next;
}

function requiresAuthenticatedTimeZone(expression:string,record:unknown):boolean {
  if(/\b(?:TODAY|NOW|TIMENOW|TZOFFSET|HOUR|MINUTE|SECOND|DATEVALUE|DATETIMEVALUE|DAY|MONTH|YEAR|WEEKDAY|ISOWEEK|ISOYEAR)\s*\(/i.test(expression))
    return true;
  if(!record||typeof record!=='object'||Array.isArray(record))return false;
  const source=record as Record<string,unknown>;
  const references=[...expression.matchAll(/@([A-Za-z_$][A-Za-z0-9_$.]*)/g)]
    .map(match=>match[1].split('.').at(-1)??'');
  return references.some(name=>{
    const value=source[name];
    return value instanceof Date
      ||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value);
  });
}

function withRecordTypeContext(context:FormulaBindingContext|undefined,
  record:unknown,object:unknown):FormulaBindingContext|undefined {
  if(!record||typeof record!=='object'||Array.isArray(record))return context;
  const recordValues=record as Record<string,unknown>;
  const recordTypeId=recordValues.RecordTypeId;
  if(typeof recordTypeId!=='string')return context;
  const metadata=object&&typeof object==='object'&&!Array.isArray(object)
    ?(object as Record<string,unknown>).recordTypes:null;
  const recordTypes=Array.isArray(metadata)?metadata:[];
  const definition=recordTypes.find((item:unknown)=>item&&typeof item==='object'
    &&!Array.isArray(item)&&(item as Record<string,unknown>).id===recordTypeId) as Record<string,unknown>|undefined;
  const recordType=definition?{
    Id:recordTypeId,Name:definition.label,DeveloperName:definition.developerName
  }:{Id:recordTypeId};
  return {...context,recordType};
}

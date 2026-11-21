import {hasPageValue,withoutPageValues} from '../../../../../server/src/expression-engine/PageReferences.js';
import {tokenize} from '../../../../../server/src/expression-engine/FormulaTokenizer.js';
import {isSelectedSqlFormula} from '../../../component-libraries/shared/formulaKinds.js';
import {looksLikeFormula,runFormulaText} from '../../pages/PageCompiler/formulaText';

/** A formula given at run time is converted by the page converter (formulaText.ts); this error
 * is what a component shows when it cannot be converted or run. */
export class FieldExpressionEvaluationError extends Error {
  constructor(message:string){super(message);this.name='FieldExpressionEvaluationError';}
}
/** Signed-in values page formulas read (@ThisTenant.User.Name, CONNECTED()). */
export type FormulaBindingContext={
  readComponent?:(name:string,key:string)=>unknown;
  timeZone?:string;now?:Date;
  pageState?:Readonly<Record<string,unknown>>;
  sessionId?:string;locale?:string;currencyIsoCode?:string|null;
  user?:Record<string,unknown>;profile?:Record<string,unknown>;organization?:Record<string,unknown>;
  connections?:{systemAvailable:readonly string[];systemConnected:readonly string[];customConnected:readonly string[]}|null;
  recordType?:Record<string,unknown>;permissions?:Readonly<Record<string,boolean>>;
  rootObjectApiName?:string;
  /** The page's converter for a formula given at run time (page code `$`: totals come from the server). */
  compile?:(text:unknown)=>((row:Record<string,unknown>)=>unknown)|null;
};
// Authenticated public identity shared by the page code and independently bundled components.
// It contains only the allowlisted profile fields, never tokens or credentials.
const SESSION_IDENTITY_KEY=Symbol.for('une.authenticatedFormulaIdentity');
function setAuthenticatedFormulaSession(context:FormulaBindingContext|null):void{
  const user=context?.user,organization=context?.organization;
  const names=(value:unknown)=>Object.freeze((Array.isArray(value)?value:[]).map(String));
  const connections=context?.connections;
  (globalThis as Record<symbol,unknown>)[SESSION_IDENTITY_KEY]=user&&organization&&typeof user.Id==='string'
    &&typeof organization.Id==='string'
    ?Object.freeze({user:Object.freeze({Id:user.Id,Name:user.Name,Email:user.Email,
        TimeZone:user.TimeZone,Locale:user.Locale,CurrencyIsoCode:user.CurrencyIsoCode,
        Manager:user.Manager??'',ManagerName:user.ManagerName??''}),
      organization:Object.freeze({Id:organization.Id,Name:organization.Name}),
      connections:connections?Object.freeze({systemAvailable:names(connections.systemAvailable),
        systemConnected:names(connections.systemConnected),customConnected:names(connections.customConnected)}):null}):null;
}

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
      Locale:session.locale,CurrencyIsoCode:session.currencyIsoCode??null,
      Manager:typeof session.managerId==='string'?session.managerId:'',
      ManagerName:typeof session.managerName==='string'?session.managerName:''
    }),
    profile:Object.freeze({
      Id:session.profileId??null,Name:session.profileName??null,
      DeveloperName:session.profileApi??null
    }),
    organization:Object.freeze({Id:session.tenantId,Name:session.tenantName}),
    connections:sessionConnections(session.connections)
  });
  setAuthenticatedFormulaSession(authenticatedFormulaBindingContext);
}
/** Connector names from the session for CONNECTED(); names only, never secrets. */
function sessionConnections(value:unknown):FormulaBindingContext['connections']{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value as Record<string,unknown>;
  const names=(key:string)=>Object.freeze((Array.isArray(source[key])?source[key] as unknown[]:[])
    .filter((item):item is string=>typeof item==='string'));
  return Object.freeze({systemAvailable:names('systemAvailable'),systemConnected:names('systemConnected'),
    customConnected:names('customConnected')});
}
export function getAuthenticatedFormulaBindingContext():FormulaBindingContext|null {
  return authenticatedFormulaBindingContext;
}

const isFieldExpression=(value:string):boolean=>looksLikeFormula(value);

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
  // The page's converter (page code `$`) when the page has one, else the same converter here.
  const page=context?.compile?.(expression);
  const result=page?(()=>{
    try{return {value:page(source)};}
    catch(error){
      if(error&&typeof error==='object'&&(error as {notHeld?:unknown}).notHeld===true)return {value:''};
      return {value:'',error:error instanceof Error?error.message:'Formula failed'};
    }
  })():runFormulaText(expression,source,{pageState:context?.pageState,sessionId:context?.sessionId,
    readComponent:context?.readComponent,rowObject:context?.rootObjectApiName,now:context?.now});
  if(result.error)throw new FieldExpressionEvaluationError(result.error);
  return result.value;
}

export function resolveRegisteredTextProperties(
 definitions:ReadonlyArray<{propertyKey:string;kind:string}>,properties:Record<string,unknown>,
 context?:FormulaBindingContext,readComponent?:FormulaBindingContext['readComponent'],
 compile?:FormulaBindingContext['compile']
):Record<string,unknown>{
  const baseContext=context??getAuthenticatedFormulaBindingContext()??undefined;
  // Totals over a list's rows are page code (SUMIFS over held rows or one server request).
  const rows=Array.isArray(properties.records)?properties.records:null;
  const pagination=properties.recordPagination as {offset?:number;total?:number}|undefined;
  const completeRows=rows&&rows.length<=200&&
    (!pagination||(pagination.offset===0&&typeof pagination.total==='number'&&pagination.total<=rows.length))
    ?rows as Record<string,unknown>[]:undefined;
  const hasNamed=Boolean(properties.namedCollections&&typeof properties.namedCollections==='object'
    &&Object.keys(properties.namedCollections).length);
  const hasSources=Boolean(properties.formulaCollectionSources&&typeof properties.formulaCollectionSources==='object'
    &&Object.values(properties.formulaCollectionSources).some(value=>Array.isArray(value)&&value.length>0));
  const formulaContext:FormulaBindingContext={...(baseContext??{}),readComponent:readComponent??baseContext?.readComponent,
    now:baseContext?.now??new Date(),...(compile?{compile}:{}),
    ...(typeof properties.objectApiName==='string'?{rootObjectApiName:properties.objectApiName}:{}),
    ...(properties.pageState&&typeof properties.pageState==='object'&&!Array.isArray(properties.pageState)
      ?{pageState:properties.pageState as FormulaBindingContext['pageState']}:{}),
    ...(typeof properties.sessionId==='string'?{sessionId:properties.sessionId}: {})};
  const record=properties.record??properties.currentRecord??properties.recordData;
  const hasRecord=Boolean(record&&typeof record==='object'&&!Array.isArray(record));
  const resolvedContext=withRecordTypeContext(formulaContext,record,properties.object);
  let next=properties;
  // Binding formulas on repeating rows are resolved by the row renderer.
  const authored=properties.properties;
  const extra=authored&&typeof authored==='object'&&!Array.isArray(authored)
    ?Object.entries(authored).filter(([key,value])=>typeof value==='string'&&hasPageValue(value)
      &&!definitions.some(field=>field.propertyKey===key)).map(([propertyKey])=>({propertyKey,kind:'TEXT'})):[];
  for(const definition of [...definitions,...extra]){
    if(!['TEXT','LONG_TEXT','TEXTAREA','STRING'].includes(definition.kind))continue;
    const value=properties[definition.propertyKey];
    if(typeof value!=='string'||!isFieldExpression(value))continue;
    // Selected functions are resolved by the mounted SQL display adapter.
    if(isSelectedSqlFormula(value))continue;
    const fieldText=withoutPageValues(value);
    const localRefs=[...fieldText.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)].map(match=>match[1]);
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
    if(!hasRecord&&rows&&rows.length>1&&hasPageValue(value)&&localRefs.length)continue;
    // A Grid/Card/Cart has MANY rows. The renderer, not the enclosing
    // RegisteredComponent, evaluates @Object.Field separately for each row.
    if(!hasRecord&&/@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(fieldText)
      &&!/\b(?:COLLECTION|TABLE|SUM|SUMIFS|COUNTIFS|AVERAGEIFS|MINIFS|MAXIFS)\s*\(/i.test(value))continue;
    // SUM may be nested in a text expression (e.g. "£ " & SUM(@LineTotal)).
    // Do not pre-evaluate a partial record page and show a misleading total.
    const localSum=/\bSUM\s*\(/i.test(value)&&rows?.some(row=>
      row&&typeof row==='object'&&!Array.isArray(row)&&localRefs.some(key=>Object.hasOwn(row,key)));
    if(localSum&&!completeRows)continue; // Never evaluate totals from an incomplete page.
    if(!hasRecord&&/@[A-Za-z]/.test(fieldText)&&!hasNamed&&!hasSources
      &&!completeRows)continue;
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

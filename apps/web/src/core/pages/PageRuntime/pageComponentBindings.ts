import {compileRecordFilterFormula} from './recordFilterFormula';
import {parseCollectionListBinding} from './pageCollectionListBinding';
import {hasExcelWildcardCriteria,matchesExcelWildcard} from '../../../../../server/src/expression-engine/FormulaWildcard.js';
import { compareMetadataValue } from '../../metadata/Definitions/metadataValueComparison';
import type { FieldMetadata } from '../../metadata/Definitions/metadata';
import { examineRecordFilter, isNumericFilterField } from '../../records/RecordWorkspace/recordFilterMetadata';

/**
 * The Page Builder supplies event bindings to the existing platform Flow/Action
 * runtime. A component need not select an Object merely to emit an action.
 * Never execute user-supplied expressions or attach business logic to JSX.
 */
export function needsMetadataComponentRuntime(properties: Record<string, unknown>): boolean {
  // Any registered component can bind to an Object, not just a named business
  // vertical. Keep legacy *ObjectApiName properties working without per-app code.
  if (Object.entries(properties).some(([key, value]) =>
    /objectApiName$/i.test(key) && typeof value === 'string' && value.trim().length > 0)) return true;
  // Explicit record-field bindings also need the data runtime even while the
  // Object binding is missing, so the editor exposes a configuration error
  // instead of silently rendering an empty static grid.
  if (Object.entries(properties).some(([key, value]) =>
    /(?:name|title|price|image|category|vatApplicable|ageRestricted)FieldApiName$/i.test(key) &&
    typeof value === 'string' && value.trim().length > 0)) return true;
  // Field mentions require the same permission-gated data runtime as Object bindings.
  if (Object.values(properties).some(value => typeof value === 'string'
    && /(^|[^A-Za-z0-9_@])@[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/.test(value))) return true;
  // Flow outputs may bind to sibling components without each component querying an Object.
  // These instances must still enter the metadata-aware runtime to receive page state.
  const state = properties.stateBindings;
  if(state && typeof state==='object' && !Array.isArray(state)
     && Object.keys(state).length>0)return true;
  if(properties.filterMode!=='Field'&&typeof properties.filterFormula==='string'&&properties.filterFormula.trim())return true;
  if(typeof properties.collectionFormula==='string'&&properties.collectionFormula.trim())return true;
  const bindings = properties.actionFlows;
  return Boolean(bindings && typeof bindings === 'object' && !Array.isArray(bindings)
    && Object.keys(bindings).length > 0);
}

/**
 * Evaluate the Page Builder's existing record-filter contract against
 * permission-checked records. Invalid, missing or unreadable fields fail closed;
 * an empty/unset filter is intentionally equivalent to "all readable records".
 */
/** Resolve safe component properties from declared Flow outputs → page-state keys.
 * Record collections are allowed only as explicit list bindings; they stay
 * page-local and the originating Flow must be server-authorised. A Flow never
 * acquires permission merely because its output is displayed here. */
export function safePageStateRecordCollection(value:unknown):Record<string,unknown>[]|undefined {
  let candidate=value;
  if(typeof candidate==='string'){
    if(candidate.length>500000)return undefined;
    try{candidate=JSON.parse(candidate);}catch{return undefined;}
  }
  if(!Array.isArray(candidate)||candidate.length>200)return undefined;
  let size=0;
  const valid=(item:unknown,depth:number):boolean=>{
    if(depth>3)return false;
    if(item===null)return true;
    if(typeof item==='string'){size+=item.length;return item.length<=20000&&size<=500000;}
    if(typeof item==='boolean')return true;
    if(typeof item==='number')return Number.isFinite(item);
    if(Array.isArray(item))return item.length<=100&&item.every(v=>valid(v,depth+1));
    if(item&&typeof item==='object'&&Object.getPrototypeOf(item)===Object.prototype)
      return Object.keys(item).length<=100&&Object.entries(item).every(([k,v])=>
        /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(k)&&
        !['__proto__','prototype','constructor'].includes(k)&&valid(v,depth+1));
    return false;
  };
  return candidate.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&valid(item,0))
    ?candidate as Record<string,unknown>[]
    :undefined;
}

export function bindPageStateProperties<T extends Record<string,unknown>>(
  properties:T,state:Readonly<Record<string,unknown>>
):T {
  const raw=properties.stateBindings;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return properties;
  const bindings=raw as Record<string,unknown>;
  const next:Record<string,unknown>={...properties};
  const protectedKeys=new Set(['objectApiName','actionFlows','stateBindings','filters',
    'records','onAction','onChange','sessionId','key','ref','children']);
  for(const [target,key] of Object.entries(bindings)){
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(target)||protectedKeys.has(target)
      ||typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))continue;
    const value=state[key];
    // Only explicitly declared list-shaped properties accept record collections.
    // Other state-bound text values retain their original scalar behaviour.
    if(target==='items'||Array.isArray(properties[target])){
      const records=safePageStateRecordCollection(value);
      if(records)next[target]=records;
    }else if(value===null||['string','number','boolean'].includes(typeof value))
      next[target]=value;
  }
  return next as T;
}
/** An explicit editor mode determines which saved rules are active.
 * Legacy pages without a mode retain their existing combined semantics. */
export function activePageRecordFilters(properties:Readonly<Record<string,unknown>>):{filters:unknown;formula:unknown}{
 if(properties.filterMode==='Formula')return {filters:[],formula:properties.filterFormula};
 if(properties.filterMode==='Field')return {filters:properties.filters,formula:undefined};
 return {filters:properties.filters,formula:properties.filterFormula};
}
export type PageFilterContext={
  pageState?:Readonly<Record<string,unknown>>;
  recordId?:string;
  sessionId?:string;
};
type PageFilter={field:string;operator:string;value:unknown};
export type PageQueryFilter={field:string;value:string;related:boolean};
export type PageServerRecordFilter={field:string;operator:string;value:string};
const serverFilterOperators:Record<string,string>={
  'Equals':'eq','Not Equals':'ne','Contains':'contains',
  'Greater Than':'gt','Greater Than or Equal':'gte',
  'Less Than':'lt','Less Than or Equal':'lte',
  'Is Blank':'isBlank','Is Not Blank':'isNotBlank',
  'Includes':'includes','Excludes':'excludes'
};
function isServerFilterable(field:FieldMetadata,operator:string):boolean{
 const dataType=field.dataType.trim();
 // Legacy SQL exclusions include absent values; page rules deliberately fail closed.
 if(field.apiName.startsWith('@')||operator==='Not Equals'||operator==='Excludes')return false;
 if(/^Formula\(/i.test(dataType)||/^(Geolocation|Address|EncryptedText|Text\s*\(Encrypted\))/i.test(dataType))return false;
 if(operator==='Contains')return /^(Text|Email|Phone|Url|Picklist)(\(|$)/i.test(dataType);
 if(operator==='Includes'||operator==='Excludes')
  return /^(Multi-Select Picklist|Multipicklist)$/i.test(dataType);
 if(['Greater Than','Greater Than or Equal','Less Than','Less Than or Equal'].includes(operator)
   &&/^Time(\(|$)/i.test(dataType))return false;
 if(operator==='Equals'||operator==='Not Equals'){
  if(field.relationship&&operator==='Not Equals')return false;
 }
 return true;
}
export function pageComponentRelatedQuery(properties:Record<string,unknown>,fields:ReadonlyArray<FieldMetadata>,parentId:unknown):{blocked:boolean;filter?:PageQueryFilter}{
 if(!properties.relatedFilterKey)return {blocked:false};
 const field=fields.find(field=>field.apiName===properties.relatedFieldApiName);
 if(!field||typeof parentId!=='string'||!parentId||!isServerFilterable(field,'Equals'))return {blocked:true};
 return {blocked:false,filter:{field:field.apiName,value:parentId,related:Boolean(field.relationship)}};
}
/**
 * Reuse an authorised Flow's active parent record from the page state to scope
 * child records. Field metadata supplies the relationship, never an app name.
 * The generated browser session token is NOT a database record ID.
 *
 * No matching active parent, invalid state or ambiguous parents fail closed.
 * The containing component opts in; a normal list still lists all records.
 */
export function pageComponentActiveRecordQuery(
 fields:ReadonlyArray<FieldMetadata>,pageState:Readonly<Record<string,unknown>>
):{blocked:boolean;filter?:PageQueryFilter}{
 const matches:Array<{field:FieldMetadata;value:string;priority:number}>=[];
 for(const field of fields){
  if(!field.relationship||!isServerFilterable(field,'Equals'))continue;
  const names=[field.apiName,field.relationship.targetObject]
    .filter((name):name is string=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(name));
  for(const [priority,prefix] of ['active','current',''].entries()){
   for(const name of names){
    const base=name.charAt(0).toLowerCase()+name.slice(1);
    const key=prefix?prefix+name+'Id':base+'Id';
    if(!Object.prototype.hasOwnProperty.call(pageState,key))continue;
    const value=pageState[key];
    if(typeof value!=='string'||!value.trim())return {blocked:true};
    if(!matches.some(candidate=>candidate.field.apiName===field.apiName&&candidate.priority===priority))
     matches.push({field,value,priority});
   }
  }
 }
 if(matches.length===0)return {blocked:true};
 const priority=Math.min(...matches.map(candidate=>candidate.priority));
 const nearest=matches.filter(candidate=>candidate.priority===priority);
 // Never accidentally choose between two unrelated active records.
 if(nearest.length!==1)return {blocked:true};
 const match=nearest[0];
 return {blocked:false,filter:{field:match.field.apiName,value:match.value,related:true}};
}
/** An explicitly published active ID always wins over session discovery.
 * A malformed or ambiguous active ID must never trigger a wider query. */
export function hasPageActiveRecordSelection(
 fields:ReadonlyArray<FieldMetadata>,pageState:Readonly<Record<string,unknown>>
):boolean {
 return fields.some(field=>{
  if(!field.relationship)return false;
  return [field.apiName,field.relationship.targetObject].some(name=>{
   if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))return false;
   const key=name.charAt(0).toLowerCase()+name.slice(1)+'Id';
   return [key,'active'+name+'Id','current'+name+'Id']
    .some(candidate=>Object.prototype.hasOwnProperty.call(pageState,candidate));
  });
 });
}

/**
 * Resolve a page session to a related record using only relationship metadata.
 * No POS/Cart-specific path is embedded in the shared runtime. Candidate parents
 * must themselves expose a readable SessionKey field. All reads use the normal
 * tenant- and OneEngine-permission-checked Record API.
 */
export async function pageComponentSessionRelatedQuery(
 fields:ReadonlyArray<FieldMetadata>,
 objects:ReadonlyArray<{apiName:string;fields:ReadonlyArray<FieldMetadata>}>,
 sessionId:string,
 load:(target:string,sessionKey:string)=>Promise<{records:Record<string,unknown>[];total:number}>
):Promise<{blocked:boolean;filter?:PageQueryFilter}>{
 if(typeof sessionId!=='string'||!sessionId.trim()||sessionId.length>128)return {blocked:true};
 const eligible=fields.flatMap(field=>{
  if(!field.relationship||!isServerFilterable(field,'Equals'))return [];
  const parent=objects.find(object=>object.apiName===field.relationship?.targetObject);
  if(!parent||!parent.fields.some(candidate=>candidate.apiName==='SessionKey'
    &&isServerFilterable(candidate,'Equals')))return [];
  return [{field,target:parent.apiName}];
 });
 if(eligible.length===0||eligible.length>8)return {blocked:true};
 const matches:PageQueryFilter[]=[];
 for(const {field,target} of eligible){
  try{
   const page=await load(target,sessionId);
   if(!page||!Array.isArray(page.records)||!Number.isSafeInteger(page.total)
     ||page.total<0||page.total>1||page.records.length>1)return {blocked:true};
   if(page.total===0)continue;
   const row=page.records[0];
   if(!row||typeof row.Id!=='string'||!row.Id)return {blocked:true};
   matches.push({field:field.apiName,value:row.Id,related:true});
  }catch{return {blocked:true};}
 }
 return matches.length===1?{blocked:false,filter:matches[0]}:{blocked:true};
}
const isDynamic=(value:unknown):value is {source:string;key?:string;skipWhenBlank?:boolean;allWhenStar?:boolean}=>
  Boolean(value&&typeof value==='object'&&!Array.isArray(value));
/** Resolve only declared, typed page context sources; never evaluate expressions. */
export function resolvePageFilterValue(value:unknown,context:PageFilterContext):unknown {
  if (!isDynamic(value)) return value;
  if(value.source==='PageState' && typeof value.key==='string'
    && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.key)){
    const resolved=context.pageState?.[value.key];
    return resolved===null||['string','number','boolean'].includes(typeof resolved)?resolved:undefined;
  }
  if(value.source==='CollectionState'&&typeof value.key==='string'){
    const match=/^([A-Za-z][A-Za-z0-9_]{0,79})\.state\.(Id|Name|Value|Field|Criteria)$/.exec(value.key);
    const selections=context.pageState?.collectionSelections;
    if(!match||!selections||typeof selections!=='object'||Array.isArray(selections))return undefined;
    const record=Object.entries(selections as Record<string,unknown>).find(([key])=>key.toLowerCase()===match[1].toLowerCase())?.[1];
    if(!record||typeof record!=='object'||Array.isArray(record)
      ||!Object.prototype.hasOwnProperty.call(record,match[2]))return undefined;
    const result=(record as Record<string,unknown>)[match[2]];
    return result===null||['string','number','boolean'].includes(typeof result)?result:undefined;
  }
  if(value.source==='CurrentRecord')return context.recordId||undefined;
  if(value.source==='Session')return context.sessionId||undefined;
  return undefined;
}
/** Explicit opt-in only. Skip an optional Page State condition when its
 * source is blank; never treat the blank condition as TRUE inside OR.
 * Every definition is still validated before this is evaluated. */
function skipsOptionalPageStateFilter(filter:PageFilter,context:PageFilterContext):boolean{
 const source=filter.value;
 if(['Is Blank','Is Not Blank'].includes(filter.operator)||!isDynamic(source)
  ||!['PageState','CollectionState'].includes(source.source))return false;
 const resolved=resolvePageFilterValue(source,context);
 // '*' is a selection sentinel only for explicitly configured state filters.
 return source.allWhenStar===true&&resolved==='*'
  ||source.skipWhenBlank===true&&[undefined,null,''].includes(resolved as undefined|null|string);
}
/** Block unbound parent filters *before* querying; missing context never means "all records". */
function pageComponentRecordQueryBase(
  definitions:unknown,fields:ReadonlyArray<FieldMetadata>,context:PageFilterContext={},logic:'AND'|'OR'='AND'
):{blocked:boolean;filter?:PageQueryFilter;filters?:PageServerRecordFilter[];filterLogic?:string;serverFilterable:boolean}{
  if(definitions===undefined||definitions===null)return {blocked:false,serverFilterable:true};
  if(!Array.isArray(definitions))return {blocked:true,serverFilterable:false};
  // A saved filter is mandatory. Invalid metadata must never widen queries.
  if(definitions.some(item=>examineRecordFilter(item,fields)!==null))
    return {blocked:true,serverFilterable:false};
  const active=definitions.filter(item=>!skipsOptionalPageStateFilter(item as PageFilter,context));
  let first:PageQueryFilter|undefined;
  const serverFilters:PageServerRecordFilter[]=[];
  let serverFilterable=true;
  for(const value of active){
    const filter=value as PageFilter;
    const expressionValue=isDynamic(filter.value)&&filter.value.source==='FieldExpression';
    const resolved=expressionValue?undefined:resolvePageFilterValue(filter.value,context);
    if(!expressionValue&&isDynamic(filter.value)&&(resolved===undefined||resolved===null||resolved===''))
      return {blocked:true,serverFilterable:false};
    const field=fields.find(candidate=>candidate.apiName===filter.field);
    const operator=serverFilterOperators[filter.operator];
    if(!field||!operator||expressionValue||!isServerFilterable(field,filter.operator)){
      serverFilterable=false;
      continue;
    }
    // OR over one active condition is equivalent to AND; keep lookup paging.
    if(logic==='OR'&&active.length>1&&field.relationship){
      serverFilterable=false;
      continue;
    }
    const wildcard=filter.operator==='Equals'&&hasExcelWildcardCriteria(resolved);
    if(wildcard&&field.relationship&&resolved==='*'){
      serverFilters.push({field:filter.field,operator:'isNotBlank',value:''});
    }else if(wildcard){
      if(!/^(Text|Email|Phone|Url|Picklist)(\(|$)/i.test(field.dataType))
        return {blocked:true,serverFilterable:false};
      serverFilters.push({field:filter.field,operator:'matches',value:String(resolved)});
    }else serverFilters.push({field:filter.field,operator,
      value:['Is Blank','Is Not Blank'].includes(filter.operator)?'':String(resolved??'')});
    if(logic==='AND'&&isDynamic(filter.value)&&filter.operator==='Equals'
      &&!hasExcelWildcardCriteria(resolved)&&!first
      &&['string','number','boolean'].includes(typeof resolved)){
      first={field:filter.field,value:String(resolved),related:Boolean(field?.relationship)};
    }
  }
  const filters=serverFilterable&&serverFilters.length===active.length&&serverFilters.length>0
    ?serverFilters:undefined;
  return {blocked:false,filter:first,filters,
    filterLogic:filters&&filters.length>1?filters.map((_,index)=>String(index+1)).join(` ${logic} `):undefined,
    serverFilterable};
}
/** Compile the same direct @Field criterion used by a collection Data Source into
 * the existing permission-scoped Record API predicate. This avoids filtering an
 * incomplete browser page and keeps the direct Formula Bar and visual filters
 * on one server filtering engine. Session collections are never queried here. */
export function collectionRecordFilterFormula(
 properties:Readonly<Record<string,unknown>>,primaryObject:string,fields:ReadonlyArray<FieldMetadata>
):string{
 if(!primaryObject)return '';
 const expressions=Object.entries(properties).filter(([key,value])=>
  key!=='collectionFormula'&&key!=='filterFormula'&&typeof value==='string')
  .map(([,value])=>String(value).trim());
 const declared=typeof properties.collectionFormula==='string'?properties.collectionFormula.trim():'';
 const criteria=[...expressions,declared].filter(Boolean);
 for(const formula of criteria){
  const binding=parseCollectionListBinding(formula,primaryObject);
  if(!binding||binding.object!==primaryObject||!fields.some(f=>f.apiName===binding.field))continue;
  // Unsupported predicates remain subject to the collection runtime's complete
  // page check, rather than using misleading client-side partial filtering.
  if(!['=','==','>','>=','<','<='].includes(binding.operator))continue;
  return '@'+binding.field+' '+binding.operator+' '+JSON.stringify(binding.criterion);
 }
 return '';
}
/** Compose an optional user-authored formula with ordinary Object filters.
 * The formula must compile to server-side predicates BEFORE paging; otherwise
 * reject it instead of returning an incomplete client-filtered page. */
export function pageComponentRecordQuery(
 definitions:unknown,fields:ReadonlyArray<FieldMetadata>,context:PageFilterContext={},
 logic:'AND'|'OR'='AND',formula?:unknown
):{blocked:boolean;filter?:PageQueryFilter;filters?:PageServerRecordFilter[];filterLogic?:string;serverFilterable:boolean;error?:string}{
 const base=pageComponentRecordQueryBase(definitions,fields,context,logic);
 if(formula===undefined||formula===null||formula==='')return base;
 const extra=compileRecordFilterFormula(formula,fields,context.pageState??{},context.sessionId??'');
 if(extra.blocked)return {blocked:true,serverFilterable:false,error:extra.error};
 if(!extra.filters.length)return base;
 if(base.blocked||!base.serverFilterable||(Array.isArray(definitions)
   &&definitions.some(item=>!skipsOptionalPageStateFilter(item as PageFilter,context))&&!base.filters))
  return {blocked:true,serverFilterable:false,error:'Filter formula requires all existing conditions to be server-filterable'};
 const regular=base.filters??[];
 const combined=[...regular,...extra.filters];
 if(combined.length>20)return {blocked:true,serverFilterable:false,error:'At most 20 combined record filters are supported'};
 const existing=regular.length?(base.filterLogic??regular.map((_,i)=>String(i+1)).join(' AND ')):'';
 const compiled=extra.filterLogic??extra.filters.map((_,i)=>String(i+1)).join(' AND ');
 const shifted=compiled.replace(/\b\d+\b/g,num=>String(Number(num)+regular.length));
 return {blocked:false,serverFilterable:true,filters:combined,
  filterLogic:existing?'('+existing+') AND ('+shifted+')':shifted};
}
export function comparePageFilterValue(actual:unknown,operator:string,expected:unknown,field:FieldMetadata|undefined):boolean{
 if(actual!=null&&isNumericFilterField(field)&&['Equals','Not Equals'].includes(operator)
   &&String(actual).trim()!==''&&String(expected??'').trim()!==''){
  const a=Number(actual),b=Number(expected);
  return Number.isFinite(a)&&Number.isFinite(b)&&(operator==='Equals'?a===b:a!==b);
 }
 if(actual!=null&&/^(Date|Date\/Time|DateTime)(\(|$)/i.test(field?.dataType??'')
   &&typeof expected==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expected)){
  const a=Date.parse(String(actual)),start=Date.parse(expected+'T00:00:00Z'),end=start+86400000;
  if(Number.isFinite(a)&&Number.isFinite(start)){
   switch(operator){
    case 'Equals':return a>=start&&a<end;
    case 'Not Equals':return a<start||a>=end;
    case 'Less Than':return a<start;
    case 'Less Than or Equal':return a<end;
    case 'Greater Than':return a>=end;
    case 'Greater Than or Equal':return a>=start;
   }
  }
 }
 if(operator==='Equals'&&hasExcelWildcardCriteria(expected))
   return typeof actual==='string'&&matchesExcelWildcard(actual,expected);
 return compareMetadataValue(actual,operator,expected,true);
}
export function filterPageComponentRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  definitions: unknown,
  fields: ReadonlyArray<FieldMetadata>,
  context: PageFilterContext={},logic:'AND'|'OR'='AND'
): T[] {
  if (definitions === undefined || definitions === null) return [...records];
  if (!Array.isArray(definitions)) return [];
  if (definitions.length===0) return [...records];
  if (pageComponentRecordQuery(definitions,fields,context,logic).blocked)return [];
  const active=definitions.filter(item=>!skipsOptionalPageStateFilter(item as PageFilter,context));
  if(active.length===0)return [...records];
  return records.filter(record => active[logic==='OR'?'some':'every'](item => {
    const filter = item as PageFilter;
    const mentions=record.__mentionValues&&typeof record.__mentionValues==='object'&&!Array.isArray(record.__mentionValues)
      ?record.__mentionValues as Record<string,unknown>:{};
    const field=fields.find(candidate=>candidate.apiName===filter.field);
    const actual=filter.field.startsWith('@')?mentions[filter.field]:record[filter.field];
    if(filter.field.startsWith('@')
      ?!Object.prototype.hasOwnProperty.call(mentions,filter.field)
      :!Object.prototype.hasOwnProperty.call(record,filter.field))return false;
    let resolved=resolvePageFilterValue(filter.value,context);
    if(isDynamic(filter.value)&&filter.value.source==='FieldExpression'){
      const path=String(filter.value.key??'');
      resolved=path.startsWith('@')&&path.includes('.')?mentions[path]:
        /^@[A-Za-z][A-Za-z0-9_]*$/.test(path)?record[path.slice(1)]:undefined;
      if(resolved===undefined)return false;
    }
    return comparePageFilterValue(actual,filter.operator,resolved,field);
  }));
}

/** Resolve a state value or its nested public fields for metadata Flow inputs.
 * Only own data properties are traversed: never prototypes, expressions or code. */
export function resolvePageStatePath(state:Readonly<Record<string,unknown>>,path:string):unknown {
 const parts=path.split('.');
 if(parts.length<1||parts.length>5||!parts.every(key=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
   &&!['__proto__','prototype','constructor'].includes(key)))return undefined;
 return parts.reduce<unknown>((current,key)=>{
   if(!current||typeof current!=='object'||Array.isArray(current)
     ||!Object.prototype.hasOwnProperty.call(current,key))return undefined;
   return (current as Record<string,unknown>)[key];
 },state);
}

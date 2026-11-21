import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {pageComponentRecordQuery,filterPageComponentRecords,pageComponentRelatedQuery,
 pageComponentActiveRecordQuery,hasPageActiveRecordSelection,pageComponentSessionRelatedQuery,SESSION_PARENT_LIMIT,
 type PageQueryFilter} from '../PageRuntime/pageComponentBindings';
import {filterRelatedRecords} from '../PageRuntime/filterRelatedRecords.mjs';
import type {CompiledDataSource} from './compilePage';
import type {SourceLoad} from './compiledPageStore';
import {EMPTY_FILTER_VALUE} from '../PageRuntime/recordFilterFormula';
import {followsMirroredSale} from './mirrorLiveRefresh';

type RecordPageLoader=(objectApiName:string,options:{limit:number;offset:number;
 filter?:{field:string;value:string;related:boolean};
 filters?:Array<{field:string;operator:string;value:string}>;filterLogic?:string;
 sortField?:string;sortDirection?:'asc'|'desc';
 search?:string;searchPrefix?:boolean;forceRefresh?:boolean})=>
 Promise<{records:Record<string,unknown>[];total:number}>;
type Scope={blocked:boolean;filter?:PageQueryFilter;field:string;parentId:unknown;
 /** The list belongs to this session's parent (or waits for one): a new parent made by a tap moves it. */
 parent?:SessionParent;waiting?:boolean};
/** A list scoped to the session's newest parent: the parent Object and the session. */
export type SessionParent={object:string;session:string};
type State=Readonly<Record<string,unknown>>;

/** The same permission-checked Record API read, filter and parent-scope rules
 * as the previous runtime, but run once per shared source instead of per
 * component. Session parents (the cart of this page session) are discovered
 * once and remembered until that parent Object is written. */
export function compiledSourceLoader(objects:readonly ObjectMetadata[],context:()=>{sessionId:string;recordId?:string},
 loadPage:RecordPageLoader):SourceLoad&{invalidate(objectApiNames?:readonly string[]):void;
 search(source:CompiledDataSource,state:State,term:string):Promise<Record<string,unknown>[]>}{
 const sessionParents=new Map<string,{parents:string[];scope:Scope}>();
 // fresh: the list is read again because someone saved (a live change): its parent is looked
 // for fresh too. A cached answer from before a new cart (after Clear sale or Hold) would
 // pick the old cart and leave the new sale's lines out.
 const scopeFor=async(source:CompiledDataSource,fields:ReadonlyArray<FieldMetadata>,state:State,sessionId:string,fresh=false):Promise<Scope>=>{
  const scope=source.scope;
  if(scope.kind==='none')return {blocked:false,field:'',parentId:undefined};
  // A display follows the till's current sale (its page session) when the till reports one;
  // before that it shows the till's open rows unscoped, as its filter says.
  if(scope.kind==='mirror'&&!followsMirroredSale())return {blocked:false,field:'',parentId:undefined};
  if(scope.kind==='key'){
   const parentId=state[scope.key];
   const query=pageComponentRelatedQuery({relatedFilterKey:scope.key,relatedFieldApiName:scope.field},fields,parentId);
   return {...query,field:scope.field,parentId};
  }
  // Active parent (activeCartId…) from page state wins over session discovery.
  if(hasPageActiveRecordSelection(fields,state)){
   const query=pageComponentActiveRecordQuery(fields,state);
   return {...query,field:query.filter?.field??'',parentId:query.filter?.value};
  }
  const cacheKey=source.id+'#'+sessionId;
  const cached=sessionParents.get(cacheKey);
  if(cached)return cached.scope;
  const query=await pageComponentSessionRelatedQuery(fields,objects,sessionId,(target,sessionKey)=>
   loadPage(target,{limit:SESSION_PARENT_LIMIT,offset:0,filter:{field:'SessionKey',value:sessionKey,related:false},
    ...(fresh?{forceRefresh:true}:{})}));
  const parentObject=query.parentObject??query.waiting?.parentObject;
  const result:Scope={blocked:query.blocked,...(query.filter?{filter:query.filter}:{}),
   field:query.filter?.field??query.waiting?.field??'',parentId:query.filter?.value,
   ...(parentObject?{parent:{object:parentObject,session:sessionId}}:{}),...(query.waiting?{waiting:true}:{})};
  // Only a found parent is remembered: a cart created later is found on the next read.
  if(!query.blocked&&query.filter)sessionParents.set(cacheKey,{scope:result,
   parents:fields.filter(field=>field.relationship).map(field=>field.relationship!.targetObject)});
  return result;
 };
 // The parent filter is checked separately (relatedFilter), so it never makes rows unpredictable.
 // Exact when every filter must hold (AND only) and each is equal/blank: a saved
 // or predicted row can then be placed in (or taken out of) the list without a re-read.
 const predictable=(query:{serverFilterable?:boolean;filterLogic?:string;filters?:ReadonlyArray<{operator:string}>})=>Boolean(query.serverFilterable
  &&(!query.filterLogic||!/\b(?:OR|NOT)\b/i.test(query.filterLogic))
  &&(query.filters??[]).every(filter=>filter.operator==='eq'||filter.operator==='isBlank'));
 const load=async(source:CompiledDataSource,state:State,window:{offset:number;limit:number;fresh?:boolean})=>{
  const {sessionId,recordId}=context();
  const fields=objects.find(object=>object.apiName===source.objectApiName)?.fields??[];
  const query=pageComponentRecordQuery(source.filters,fields,{pageState:state,sessionId,recordId},
   source.filterLogic,source.filterFormula);
  // Missing context never widens a query to "all records". A page value that is
  // not set yet (e.g. the start action's STATE) shows an empty list, not an error.
  if(query.blocked){
   if(query.error&&query.error!==EMPTY_FILTER_VALUE)throw Error(query.error);
   return null;
  }
  const related=await scopeFor(source,fields,state,sessionId,Boolean(window.fresh));
  // No parent yet for this session: an empty list that waits for the first one.
  if(related.blocked&&related.waiting&&related.parent)return {records:[],total:0,serverFilters:query.filters,
   relatedFilter:{field:related.field,value:'',related:true,parent:related.parent},paged:true,predictable:predictable(query)};
  if(related.blocked)return null;
  // Server-filtered queries page; a browser-side filter needs one bounded read.
  const paged=Boolean(query.filters)||!source.filters||(Array.isArray(source.filters)&&source.filters.length===0);
  const page=await loadPage(source.objectApiName,{limit:paged?window.limit:100,offset:paged?window.offset:0,
   filter:related.filter??(query.serverFilterable?query.filter:undefined),
   filters:query.filters,filterLogic:query.filterLogic,...(window.fresh?{forceRefresh:true}:{}),
   ...(source.sortField?{sortField:source.sortField,sortDirection:source.sortDirection??'asc'}:{})});
  const filtered=paged?page.records:filterPageComponentRecords(page.records,source.filters,fields,
   {pageState:state,recordId,sessionId},source.filterLogic);
  const records=related.field?filterRelatedRecords(filtered,related.parentId,related.field):filtered;
  return {records,total:paged?page.total:records.length,
   serverFilters:query.filters,
   relatedFilter:related.filter?{...related.filter,...(related.parent?{parent:related.parent}:{})}:undefined,paged,
   predictable:predictable(query)};
 };
 // Search follows the exact same metadata filter and parent-scope rules as the
 // list loader. Never show broader results when a filter cannot run on the server.
 const search=async(source:CompiledDataSource,state:State,term:string)=>{
  const {sessionId,recordId}=context();
  const fields=objects.find(object=>object.apiName===source.objectApiName)?.fields??[];
  const query=pageComponentRecordQuery(source.filters,fields,{pageState:state,sessionId,recordId},
   source.filterLogic,source.filterFormula);
  if(query.blocked||!query.serverFilterable)throw Error('Search requires server-compatible filters');
  const related=await scopeFor(source,fields,state,sessionId);
  if(related.blocked)throw Error('Search is unavailable without the parent record');
  const page=await loadPage(source.objectApiName,{limit:20,offset:0,search:term,searchPrefix:true,forceRefresh:true,
   filter:related.filter??query.filter,filters:query.filters,filterLogic:query.filterLogic});
  return page.records;
 };
 return Object.assign(load,{search,invalidate(objectApiNames?:readonly string[]){
  for(const [key,entry] of sessionParents)
   if(!objectApiNames||entry.parents.some(name=>objectApiNames.includes(name)))sessionParents.delete(key);
 }});
}

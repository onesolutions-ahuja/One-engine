import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {pageComponentRecordQuery,filterPageComponentRecords,pageComponentRelatedQuery,
 pageComponentActiveRecordQuery,hasPageActiveRecordSelection,pageComponentSessionRelatedQuery,
 type PageQueryFilter} from '../PageRuntime/pageComponentBindings';
import {filterRelatedRecords} from '../PageRuntime/filterRelatedRecords.mjs';
import type {CompiledDataSource} from './compilePage';
import type {SourceLoad} from './compiledPageStore';

type RecordPageLoader=(objectApiName:string,options:{limit:number;offset:number;
 filter?:{field:string;value:string;related:boolean};
 filters?:Array<{field:string;operator:string;value:string}>;filterLogic?:string;
 search?:string;searchPrefix?:boolean;forceRefresh?:boolean})=>
 Promise<{records:Record<string,unknown>[];total:number}>;
type Scope={blocked:boolean;filter?:PageQueryFilter;field:string;parentId:unknown};
type State=Readonly<Record<string,unknown>>;

/** The same permission-checked Record API read, filter and parent-scope rules
 * as the previous runtime, but run once per shared source instead of per
 * component. Session parents (the cart of this page session) are discovered
 * once and remembered until that parent Object is written. */
export function compiledSourceLoader(objects:readonly ObjectMetadata[],context:()=>{sessionId:string;recordId?:string},
 loadPage:RecordPageLoader):SourceLoad&{invalidate(objectApiNames?:readonly string[]):void;
 search(source:CompiledDataSource,state:State,term:string):Promise<Record<string,unknown>[]>}{
 const sessionParents=new Map<string,{parents:string[];scope:Scope}>();
 const scopeFor=async(source:CompiledDataSource,fields:ReadonlyArray<FieldMetadata>,state:State,sessionId:string):Promise<Scope>=>{
  const scope=source.scope;
  if(scope.kind==='none')return {blocked:false,field:'',parentId:undefined};
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
   loadPage(target,{limit:2,offset:0,filter:{field:'SessionKey',value:sessionKey,related:false}}));
  const result={...query,field:query.filter?.field??'',parentId:query.filter?.value};
  // Only a found parent is remembered: a cart created later is found on the next read.
  if(!query.blocked&&query.filter)sessionParents.set(cacheKey,{scope:result,
   parents:fields.filter(field=>field.relationship).map(field=>field.relationship!.targetObject)});
  return result;
 };
 const load=async(source:CompiledDataSource,state:State,window:{offset:number;limit:number})=>{
  const {sessionId,recordId}=context();
  const fields=objects.find(object=>object.apiName===source.objectApiName)?.fields??[];
  const query=pageComponentRecordQuery(source.filters,fields,{pageState:state,sessionId,recordId},
   source.filterLogic,source.filterFormula);
  // Missing context never widens a query to "all records".
  if(query.blocked){
   if(query.error)throw Error(query.error);
   return null;
  }
  const related=await scopeFor(source,fields,state,sessionId);
  if(related.blocked)return null;
  // Server-filtered queries page; a browser-side filter needs one bounded read.
  const paged=Boolean(query.filters)||!source.filters||(Array.isArray(source.filters)&&source.filters.length===0);
  const page=await loadPage(source.objectApiName,{limit:paged?window.limit:100,offset:paged?window.offset:0,
   filter:related.filter??(query.serverFilterable?query.filter:undefined),
   filters:query.filters,filterLogic:query.filterLogic});
  const filtered=paged?page.records:filterPageComponentRecords(page.records,source.filters,fields,
   {pageState:state,recordId,sessionId},source.filterLogic);
  const records=related.field?filterRelatedRecords(filtered,related.parentId,related.field):filtered;
  return {records,total:paged?page.total:records.length,
   serverFilters:query.filters,relatedFilter:related.filter,paged,
   // The parent filter is checked separately (relatedFilter), so it never makes rows unpredictable.
   predictable:Boolean(query.serverFilterable&&!source.filterFormula
    &&(!query.filterLogic||/^\(?1\)?$/.test(query.filterLogic)))};
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

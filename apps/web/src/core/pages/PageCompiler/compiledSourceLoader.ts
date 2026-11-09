import type {ObjectMetadata} from '../../metadata/Definitions/metadata';
import {pageComponentRecordQuery,filterPageComponentRecords} from '../PageRuntime/pageComponentBindings';
import type {CompiledDataSource} from './compilePage';
import {SOURCE_PAGE_SIZE,type SourceLoad} from './compiledPageStore';

type RecordPageLoader=(objectApiName:string,options:{limit:number;offset:number;
 filter?:{field:string;value:string;related:boolean};
 filters?:Array<{field:string;operator:string;value:string}>;filterLogic?:string})=>
 Promise<{records:Record<string,unknown>[];total:number}>;

/** The same permission-checked Record API read and filter rules as the
 * previous runtime, but run once per shared source instead of per component. */
export function compiledSourceLoader(objects:readonly ObjectMetadata[],sessionId:()=>string,
 loadPage:RecordPageLoader):SourceLoad{
 return async(source:CompiledDataSource,state)=>{
  const fields=objects.find(object=>object.apiName===source.objectApiName)?.fields??[];
  const query=pageComponentRecordQuery(source.filters,fields,{pageState:state,sessionId:sessionId()},
   source.filterLogic,source.filterFormula);
  // Missing context never widens a query to "all records".
  if(query.blocked){
   if(query.error)throw Error(query.error);
   return null;
  }
  const page=await loadPage(source.objectApiName,{limit:SOURCE_PAGE_SIZE,offset:0,
   filter:query.serverFilterable?query.filter:undefined,
   filters:query.filters,filterLogic:query.filterLogic});
  const records=query.filters?page.records:filterPageComponentRecords(page.records,source.filters,fields,
   {pageState:state,sessionId:sessionId()},source.filterLogic);
  return {records,total:query.filters?page.total:records.length,serverFilters:query.filters,
   predictable:Boolean(query.serverFilterable&&!source.filterFormula&&(!query.filterLogic||/^\(?1\)?$/.test(query.filterLogic)))};
 };
}

import {useEffect,useState} from 'react';
import type {FieldMetadata,ObjectMetadata} from '../../metadata/Definitions/metadata';
import {pageComponentSessionRelatedQuery,pageComponentRelatedQuery,
 pageComponentActiveRecordQuery,hasPageActiveRecordSelection,
 type PageQueryFilter} from './pageComponentBindings';

type RelatedScope={blocked:boolean;filter?:PageQueryFilter};
type RecordPage={records:Record<string,unknown>[];total:number};
type CachedRelatedQuery={scopeKey:string;query:RelatedScope};

/** Retain the authorised parent filter during same-session revalidation only. */
export function visibleSessionRelatedQuery(enabled:boolean,scopeKey:string,
 cached:CachedRelatedQuery|null):RelatedScope{
 return enabled&&cached?.scopeKey===scopeKey?cached.query:{blocked:true};
}
type RecordLoader=(objectApiName:string,query:{
 limit:number;offset:number;filter:{field:string;value:string;related:boolean}
})=>Promise<RecordPage>;

/** A page-local, permission-checked session lookup; never caches across tenants. */
export function usePageSessionRelatedQuery(
 enabled:boolean,fields:ReadonlyArray<FieldMetadata>,objects:ReadonlyArray<ObjectMetadata>,
 sessionId:string,revision:number,load:RecordLoader
):RelatedScope{
 const scopeKey=JSON.stringify([enabled,sessionId,fields
  .filter(field=>field.relationship).map(field=>[field.apiName,field.relationship?.targetObject]),
  objects.filter(object=>object.fields.some(field=>field.apiName==='SessionKey'))
   .map(object=>object.apiName)]);
 // Revision triggers revalidation, but must not invalidate a lookup for the same session.
 const requestKey=JSON.stringify([scopeKey,revision]);
 const [result,setResult]=useState<CachedRelatedQuery|null>(null);
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  void pageComponentSessionRelatedQuery(fields,objects,sessionId,
   (objectApiName,sessionKey)=>load(objectApiName,{
    limit:2,offset:0,filter:{field:'SessionKey',value:sessionKey,related:false}
   })).then(query=>{if(active)setResult({scopeKey,query});});
  return()=>{active=false;};
 },[requestKey]);
 return visibleSessionRelatedQuery(enabled,scopeKey,result);
}

/**
 * One shared resolution contract for the app Page Runtime and standalone
 * metadata-bound components. A configured parent picker always has precedence;
 * otherwise active record Flow state wins, followed by session discovery.
 */
export function usePageComponentRelatedScope(
 properties:Readonly<Record<string,unknown>>,componentType:string,
 fields:ReadonlyArray<FieldMetadata>,objects:ReadonlyArray<ObjectMetadata>,
 pageState:Readonly<Record<string,unknown>>,sessionId:string,revision:number,
 load:RecordLoader,manualParentId:unknown,disableActions:boolean
):{relatedQuery:RelatedScope;relatedField:string;parentId:unknown}{
 const relatedKey=String(properties.relatedFilterKey??'');
 const auto=properties.autoRecordScope===true||
  (properties.autoRecordScope!==false && ['smart_cart','Custom:smart_cart'].includes(componentType));
 const selected=hasPageActiveRecordSelection(fields,pageState);
 const direct=pageComponentActiveRecordQuery(fields,pageState);
 const session=usePageSessionRelatedQuery(auto&&!relatedKey&&!selected&&!disableActions,
  fields,objects,sessionId,revision,load);
 const relatedQuery=relatedKey
  ?pageComponentRelatedQuery(properties as Record<string,unknown>,fields,manualParentId)
  :auto?(selected?direct:session)
   :pageComponentRelatedQuery(properties as Record<string,unknown>,fields,undefined);
 return {
  relatedQuery,
  relatedField:relatedKey?String(properties.relatedFieldApiName??''):relatedQuery.filter?.field??'',
  parentId:relatedKey?manualParentId:relatedQuery.filter?.value
 };
}

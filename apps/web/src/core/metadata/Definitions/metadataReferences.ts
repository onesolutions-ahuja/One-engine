import type {ObjectMetadata,FlowDefinitionMetadata} from './metadata';

/** Stable metadata IDs are stored in existing relational property value columns.
 * Names remain an API transport detail; resolution never grants permissions. */
export const metadataReference = (id:string) => `metadata:${id}`;
export function metadataSelection<T extends {id?:string;apiName:string}>(items:readonly T[], value:unknown):T|undefined {
  if(typeof value!=='string')return undefined;
  return value.startsWith('metadata:') ? items.find(item=>item.id===value.slice(9))
    : items.find(item=>item.apiName===value);
}
export function metadataFieldObject(objects:readonly ObjectMetadata[],properties:Record<string,unknown>,key:string) {
  const prefix=key.replace(/Field(?:ApiName)?$/,'');
  const binding=Object.keys(properties).filter(k=>k.endsWith('ObjectApiName')&&prefix.startsWith(k.slice(0,-13).replace(/s$/,'')))
    .sort((a,b)=>b.length-a.length)[0];
  return metadataSelection(objects,(binding?properties[binding]:properties.objectApiName)||properties.targetObject);
}
export function resolveMetadataProperties(properties:Record<string,unknown>,objects:readonly ObjectMetadata[],
  flows:readonly Pick<FlowDefinitionMetadata,'id'|'apiName'>[]):Record<string,unknown> {
  const objectFor=(value:unknown)=>metadataSelection(objects,value);
  const resolve=(value:unknown,key:string,context:Record<string,unknown>,root:Record<string,unknown>):unknown=>{
    if(Array.isArray(value))return value.map(item=>resolve(item,key,context,root));
    if(value&&typeof value==='object'){
      const own=value as Record<string,unknown>;
      return Object.fromEntries(Object.entries(own).map(([name,item])=>[name,resolve(item,name,own,root)]));
    }
    if(typeof value!=='string'||!value.startsWith('metadata:'))return value;
    if(/objectApiName$|^targetObject$/i.test(key))return objectFor(value)?.apiName??value;
    if(/flowApiName$/i.test(key))return metadataSelection(flows,value)?.apiName??value;
    if(/FieldApiName$|Field$|^field$/i.test(key)){
      const object=metadataFieldObject(objects,{...root,...(context.objectApiName?{objectApiName:context.objectApiName}:{})},key);
      return metadataSelection(object?.fields??[],value)?.apiName??value;
    }
    // References in arbitrary text are never interpreted as executable expressions.
    return value;
  };
  return Object.fromEntries(Object.entries(properties).map(([key,value])=>[key,resolve(value,key,properties,properties)]));
}

import type {PoolClient} from 'pg';
import {encodeMetadataValue,decodeMetadataValues,type MetadataValueRow} from '../system-files/component-runtime.js';
import {availableComponentSettings,type PropertyDevice,validateComponentDefinitions,validateComponentSettings,resolveComponentSettings,isPropertyRecord,type ComponentSettingDefinition} from './component-property-contract.js';
export type ComponentEventPayloadField={apiName:string;label:string;kind:'TEXT'|'NUMBER'|'BOOLEAN'|'OBJECT';fields?:ComponentEventPayloadField[]};
export type ComponentEventDefinition={apiName:string;label:string;payloadFields?:ComponentEventPayloadField[]};
export type ComponentContract={propertyDefinitions?:ComponentSettingDefinition[];eventDefinitions?:ComponentEventDefinition[]};
export function validateComponentContract(value:Record<string,unknown>):ComponentContract{
 const contract:ComponentContract={};
 if(value.propertyDefinitions!==undefined){
  const issues=validateComponentDefinitions(value.propertyDefinitions);
  if(issues.length)throw Error('Invalid component properties: '+issues.map(x=>x.path+' '+x.message).join('; '));
  contract.propertyDefinitions=value.propertyDefinitions as ComponentSettingDefinition[];
 }
 if(value.eventDefinitions!==undefined){
  const events=value.eventDefinitions;
  const validPayloadFields=(raw:unknown,depth=0):raw is ComponentEventPayloadField[]=>{
   if(!Array.isArray(raw)||raw.length>20||depth>3)return false;
   const names=new Set<string>();
   return raw.every(field=>{
    if(!field||typeof field!=='object'||Array.isArray(field))return false;
    const item=field as Record<string,unknown>;
    if(typeof item.apiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(item.apiName)
      ||names.has(item.apiName)||typeof item.label!=='string'||!item.label.trim()
      ||item.label.length>200||!['TEXT','NUMBER','BOOLEAN','OBJECT'].includes(String(item.kind)))return false;
    names.add(item.apiName);
    if(item.kind==='OBJECT')return validPayloadFields(item.fields,depth+1);
    return item.fields===undefined;
   });
  };
  if(!Array.isArray(events)||events.length>100||events.some(e=>!e||typeof e!=='object'||Array.isArray(e)||
   typeof e.apiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(e.apiName)||
   typeof e.label!=='string'||!e.label.trim()||e.label.length>200||
   e.payloadFields!==undefined&&!validPayloadFields(e.payloadFields))||new Set(events.map(e=>e.apiName)).size!==events.length)
   throw Error('Invalid component events');
  contract.eventDefinitions=events as ComponentEventDefinition[];
 }
 return contract;
}
export async function readComponentContract(client:Pick<PoolClient,'query'>,tenant:string,api:string,version:number):Promise<ComponentContract>{
 const {rows}=await client.query<MetadataValueRow>(`SELECT property_path,value_kind,value_text
  FROM md_component_library_contract_properties WHERE tenant_id=$1 AND component_api=$2 AND version=$3`,[tenant,api,version]);
 return decodeMetadataValues(rows) as ComponentContract;
}
export async function readComponentContracts(client:Pick<PoolClient,'query'>,tenant:string,api:string,
 versions:readonly number[]):Promise<Map<number,ComponentContract>>{
 if(!versions.length)return new Map();
 const {rows}=await client.query<MetadataValueRow&{version:number}>(`SELECT version,property_path,value_kind,value_text
  FROM md_component_library_contract_properties
  WHERE tenant_id=$1 AND component_api=$2 AND version=ANY($3::int[])`,[tenant,api,[...versions]]);
 const byVersion=new Map<number,MetadataValueRow[]>();
 for(const row of rows)byVersion.set(row.version,[...(byVersion.get(row.version)??[]),row]);
 return new Map(versions.map(version=>[version,decodeMetadataValues(byVersion.get(version)??[]) as ComponentContract]));
}
export async function writeComponentContract(client:Pick<PoolClient,'query'>,tenant:string,api:string,version:number,contract:ComponentContract,previous?:number){
 // Omitted keys mean retain; explicit [] means clear. Restore copies the original version.
 const inherited=previous?await readComponentContract(client,tenant,api,previous):{};
 const rows:Array<{path:string;kind:string;text:string|null}>=[];
 for(const [key,value] of Object.entries({...inherited,...contract}))encodeMetadataValue(value,'/'+key,rows);
 for(const row of rows)await client.query(`INSERT INTO md_component_library_contract_properties
  (tenant_id,component_api,version,property_path,value_kind,value_text) VALUES($1,$2,$3,$4,$5,$6)`,
  [tenant,api,version,row.path,row.kind,row.text]);
}

/** Resolve trusted, published tenant schemas in one tenant-scoped query. Never accept a schema from a page payload. */
export async function validatePageComponentContracts(client:Pick<PoolClient,'query'>,tenant:string,
 components:readonly {type?:unknown;properties?:unknown}[],device?:PropertyDevice){
 const names=[...new Set(components.flatMap(c=>typeof c.type==='string'&&c.type.startsWith('Custom:')?[c.type.slice(7)]:[]))];
 if(!names.length)return;
 const {rows}=await client.query<MetadataValueRow&{component_api:string;version:number}>(`SELECT p.component_api,p.version,p.property_path,p.value_kind,p.value_text
  FROM md_component_library_contract_properties p JOIN md_component_library_heads h
   ON h.tenant_id=p.tenant_id AND h.component_api=p.component_api AND h.published_version=p.version
  WHERE p.tenant_id=$1 AND p.component_api=ANY($2::text[])`,[tenant,names]);
 const byName=new Map(names.map(name=>[name,decodeMetadataValues(rows.filter(r=>r.component_api===name)) as ComponentContract]));
 for(const component of components){
  if(typeof component.type!=='string'||!component.type.startsWith('Custom:'))continue;
  const api=component.type.slice(7),contract=byName.get(api);
  const definitions=availableComponentSettings(contract?.propertyDefinitions??[],device,rows.find(r=>r.component_api===api)?.version);
  if(!definitions.length)continue;
  const values=isPropertyRecord(component.properties)?component.properties:{};
  const issues=validateComponentSettings(definitions.filter(d=>d.schemaVersion===1),resolveComponentSettings(definitions,values));
  if(issues.length)throw Error('Invalid Page component settings: '+issues.map(i=>i.path+' '+i.message).join('; '));
 }
}

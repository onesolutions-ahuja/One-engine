import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {authenticated,wrap} from './ApiAuthenticationGuard.js';
import {autoNumberScopeTypeAllowed,setScopedAutoNumberStart} from '../field-engine/types/AutoNumberScope.js';
import {assertMetadataPackageEditable} from '../system-support/metadata-package-service.js';

/**
 * Object Manager:
 *  GET  /api/metadata/objects/:objectApi/fields/:fieldApi/auto-number          setting, choices, series
 *  PUT  /api/metadata/objects/:objectApi/fields/:fieldApi/auto-number          {scopeField}
 *  PUT  /api/metadata/objects/:objectApi/fields/:fieldApi/auto-number/series   {value,next}
 *  PUT  /api/metadata/objects/:objectApi/prevent-delete                        {preventDelete}
 */
type Deps={db:SqlPersistence;rbac:RbacEngine};
const api=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
type FieldRow={api_name:string;label:string|null;data_type:string;related_object:string|null};

export async function autoNumberSettings(db:Pick<SqlPersistence,'query'>,tenantId:string,objectApi:string,fieldApi:string){
 const {rows:fields}=await db.query<FieldRow&{auto_number_scope_field:string|null}>(`SELECT api_name,label,data_type,
   related_object,auto_number_scope_field FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND deleted_at IS NULL`,
  [tenantId,objectApi]);
 const field=fields.find(row=>row.api_name===fieldApi);
 if(!field||field.data_type!=='autonumber')throw Error('Not an Auto Number field');
 const scopeOptions=fields.filter(row=>row.api_name!==fieldApi&&autoNumberScopeTypeAllowed(row.data_type))
  .map(row=>({apiName:row.api_name,label:row.label||row.api_name}));
 const {rows:series}=await db.query<{scope_value:string;next_value:string}>(`SELECT scope_value,next_value::text
   FROM md_auto_number_scoped_counters WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 ORDER BY scope_value`,
  [tenantId,objectApi,fieldApi]);
 const issued=await db.query<{n:string}>(`SELECT (SELECT count(*) FROM md_auto_number_counters WHERE tenant_id=$1
   AND object_api=$2 AND field_api=$3 AND next_value>1)+(SELECT count(*) FROM md_auto_number_scoped_counters
   WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3 AND next_value>1) AS n`,[tenantId,objectApi,fieldApi]);
 return {scopeField:field.auto_number_scope_field??'',scopeOptions,
  // Once numbers were given, changing the split would mix two series.
  locked:Number(issued.rows[0]?.n??0)>0,
  series:series.map(row=>({value:row.scope_value,next:Number(row.next_value)}))};
}

export async function setAutoNumberScope(db:Pick<SqlPersistence,'query'>,tenantId:string,objectApi:string,
 fieldApi:string,scopeField:unknown){
 if(scopeField!==''&&(typeof scopeField!=='string'||!api.test(scopeField)))throw Error('Choose a field');
 const current=await autoNumberSettings(db,tenantId,objectApi,fieldApi);
 if(current.scopeField===scopeField)return current;
 if(current.locked)throw Error('This Auto Number has already given numbers; its series can no longer be split differently');
 if(scopeField&&!current.scopeOptions.some(option=>option.apiName===scopeField))
  throw Error('Number separately for each: choose a Lookup or Picklist field of this Object');
 await db.query(`UPDATE md_field_definitions SET auto_number_scope_field=$4 WHERE tenant_id=$1 AND object_api=$2
  AND api_name=$3 AND data_type='autonumber'`,[tenantId,objectApi,fieldApi,scopeField||null]);
 return autoNumberSettings(db,tenantId,objectApi,fieldApi);
}

export function registerAutoNumberSettingsRoutes(app:Express,{db,rbac}:Deps){
 const manage=async(req:Parameters<Parameters<typeof wrap>[0]>[0])=>{
  const actor=authenticated(req);
  const {objectApi,fieldApi}=req.params as Record<string,string>;
  if(!api.test(objectApi)||(fieldApi!==undefined&&!api.test(fieldApi)))throw Error('Invalid metadata name');
  await assertMetadataPackageEditable(db,actor.tenant_id,'object',objectApi);
  await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','manage');
  return {actor,objectApi,fieldApi};
 };
 const base='/api/metadata/objects/:objectApi/fields/:fieldApi/auto-number';
 app.get(base,wrap(async(req,res)=>{
  const actor=authenticated(req);
  const {objectApi,fieldApi}=req.params;
  if(!api.test(objectApi)||!api.test(fieldApi))throw Error('Invalid metadata name');
  await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','read');
  res.setHeader('Cache-Control','private, no-store');
  res.json(await autoNumberSettings(db,actor.tenant_id,objectApi,fieldApi));
 }));
 app.put(base,wrap(async(req,res)=>{
  const {actor,objectApi,fieldApi}=await manage(req);
  res.json(await setAutoNumberScope(db,actor.tenant_id,objectApi,fieldApi,(req.body??{}).scopeField??''));
 }));
 app.put(base+'/series',wrap(async(req,res)=>{
  const {actor,objectApi,fieldApi}=await manage(req);
  const body=(req.body??{}) as Record<string,unknown>;
  const settings=await autoNumberSettings(db,actor.tenant_id,objectApi,fieldApi);
  if(!settings.scopeField)throw Error('Choose "Number separately for each" first');
  const next=await db.transaction(client=>setScopedAutoNumberStart(client,actor.tenant_id,objectApi,fieldApi,
   String(body.value??''),Number(body.next)));
  res.json({value:body.value,next});
 }));
 app.get('/api/metadata/objects/:objectApi/prevent-delete',wrap(async(req,res)=>{
  const actor=authenticated(req);
  const {objectApi}=req.params;
  if(!api.test(objectApi))throw Error('Invalid metadata name');
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
  const {rows}=await db.query<{prevent_delete:boolean}>(
   'SELECT prevent_delete FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[actor.tenant_id,objectApi]);
  res.setHeader('Cache-Control','private, no-store');
  res.json({objectApi,preventDelete:rows[0]?.prevent_delete===true});
 }));
 app.put('/api/metadata/objects/:objectApi/prevent-delete',wrap(async(req,res)=>{
  const actor=authenticated(req);
  const {objectApi}=req.params;
  if(!api.test(objectApi))throw Error('Invalid metadata name');
  await assertMetadataPackageEditable(db,actor.tenant_id,'object',objectApi);
  await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
  const preventDelete=(req.body??{}).preventDelete===true;
  await db.query('UPDATE md_object_definitions SET prevent_delete=$3 WHERE tenant_id=$1 AND api_name=$2',
   [actor.tenant_id,objectApi,preventDelete]);
  res.json({objectApi,preventDelete});
 }));
}

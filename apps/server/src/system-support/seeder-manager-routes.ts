import type {Express} from 'express';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import {FRESH_CORE_OBJECTS} from '../app-seeders/fresh-core-objects.js';
import {FRESH_STANDARD_FIELDS} from '../app-seeders/fresh-standard-fields.js';
import {QUOTATION_OBJECTS} from '../app-seeders/core-quotation-objects.js';
import {CART_OBJECTS} from '../app-seeders/cart-objects.js';
import {APPOINTMENT_OBJECTS} from '../app-seeders/core-appointment-objects.js';
import {COMMUNICATION_OBJECTS,COMMUNICATION_ACTIVITY_FIELDS} from '../app-seeders/core-communication-objects.js';
import {LOCATION_SRN_FIELDS} from '../app-seeders/core-location-srn.js';
import {CORE_CASH_LEDGER_FIELDS} from '../app-seeders/core-cash-ledger.js';
import {PRODUCT_IMAGE_FIELD} from '../app-seeders/product-image-field.js';
import {seedCoreObjects} from '../app-seeders/core-objects.js';

type SeedField={apiName:string;label:string;dataType:string;relatedObject?:string;maxLength?:number};
type SeedObject={apiName:string;label:string;fields:SeedField[]};
type Seed={id:string;label:string;description:string;objects:SeedObject[];provisioningOnly?:boolean};

/** Aggregate the actual CoreObjects catalog. There are no separate
 * Appointment/Cart/ProductImage seeders in the platform UI.
 */
function coreCatalog():SeedObject[]{
 const objects=new Map<string,SeedObject>();
 const add=(apiName:string,label:string,fields:readonly SeedField[])=>{
  let obj=objects.get(apiName);
  if(!obj){obj={apiName,label,fields:[]};objects.set(apiName,obj);}
  const existing=new Set(obj.fields.map(f=>f.apiName));
  for(const field of fields)if(!existing.has(field.apiName)){
   obj.fields.push({...field});existing.add(field.apiName);
  }
 };
 for(const o of FRESH_CORE_OBJECTS){
  add(o.apiName,o.label,o.fields);
  if(o.category==='standard')add(o.apiName,o.label,
   (FRESH_STANDARD_FIELDS as Record<string,readonly SeedField[]>)[o.apiName]??[]);
 }
 add('User','User',[{apiName:'ReportsToId',label:'Reports To',dataType:'reference',relatedObject:'User'}]);
 for(const o of QUOTATION_OBJECTS)add(o.apiName,o.label,o.fields);
 for(const o of CART_OBJECTS)add(o.apiName,o.label,o.fields);
 for(const o of APPOINTMENT_OBJECTS)add(o.apiName,o.label,o.fields);
 for(const o of COMMUNICATION_OBJECTS){
  add(o.apiName,o.label,o.fields);
  add(o.apiName,o.label,COMMUNICATION_ACTIVITY_FIELDS);
 }
 for(const o of LOCATION_SRN_FIELDS)add(o.object,'label' in o?String(o.label):o.object,
  o.fields.map(f=>({
   apiName:f.api,label:f.label,dataType:f.type,
   ...('related' in f?{relatedObject:f.related}: {})
  })));
 add('CashLedger','Cash Ledger',CORE_CASH_LEDGER_FIELDS.map(f=>({
  apiName:f.api,label:f.label,dataType:f.type,
  ...('related' in f?{relatedObject:f.related}: {})
 })));
 add(PRODUCT_IMAGE_FIELD.objectApi,'Product',[{
  apiName:PRODUCT_IMAGE_FIELD.apiName,label:PRODUCT_IMAGE_FIELD.label,
  dataType:PRODUCT_IMAGE_FIELD.dataType,maxLength:PRODUCT_IMAGE_FIELD.maxLength
 }]);
 return [...objects.values()];
}

const seeds:Seed[]=[
 {id:'core-objects',label:'CoreObjects',description:'All shared Core objects, fields and reusable component metadata',objects:coreCatalog()},
 {id:'initial-user',label:'InitialUser',description:'One-time tenant administrator and disabled developer@tenant identity (provisioning only)',objects:[],provisioningOnly:true},
 {id:'oneengine-policy',label:'OneEngine Policy',description:'Initial tenant RBAC roles and permission set (provisioning only; subsequent edits use RBAC)',objects:[],provisioningOnly:true}
];

type SeederDiff={
 missingObjects:string[];missingFields:string[];unresolvedReferences:string[];
 upToDate:boolean;provisioningOnly:boolean;status?:string;
};
async function diff(client:PoolClient,tenantId:string,seed:Seed):Promise<SeederDiff>{
 if(seed.id==='initial-user'){
  const {rows}=await client.query(`
   SELECT 1 FROM md_tenant_developer_accounts a
   JOIN md_users u ON u.tenant_id=a.tenant_id AND u.id=a.user_id
   WHERE a.tenant_id=$1 LIMIT 1`,[tenantId]);
  return {missingObjects:[],missingFields:[],unresolvedReferences:[],
   upToDate:rows.length>0,provisioningOnly:true,
   status:rows.length?'Identity already provisioned':'Initial identity missing: use supported tenant recovery'};
 }
 if(seed.id==='oneengine-policy'){
  const {rows}=await client.query(`
   SELECT 1 FROM md_permission_sets p
   JOIN md_roles r ON r.tenant_id=p.tenant_id AND r.api_name='TenantDeveloper'
   JOIN md_role_permission_sets rp ON rp.tenant_id=p.tenant_id AND rp.role_id=r.id AND rp.permission_set_id=p.id
   WHERE p.tenant_id=$1 AND p.api_name='OneEngine' LIMIT 1`,[tenantId]);
  return {missingObjects:[],missingFields:[],unresolvedReferences:[],
   upToDate:rows.length>0,provisioningOnly:true,
   status:rows.length?'Policy already provisioned':'OneEngine policy missing: review tenant RBAC configuration'};
 }
 const {rows:objects}=await client.query<{api_name:string}>(
  'SELECT api_name FROM md_object_definitions WHERE tenant_id=$1',[tenantId]);
 const {rows:fields}=await client.query<{object_api:string;api_name:string}>(
  'SELECT object_api,api_name FROM md_field_definitions WHERE tenant_id=$1 AND deleted_at IS NULL',[tenantId]);
 const objectSet=new Set(objects.map(x=>x.api_name));
 const fieldSet=new Set(fields.map(x=>x.object_api+'.'+x.api_name));
 const missingObjects=seed.objects.filter(o=>!objectSet.has(o.apiName)).map(o=>o.apiName);
 const missingFields=seed.objects.flatMap(o=>o.fields.filter(f=>!fieldSet.has(o.apiName+'.'+f.apiName))
  .map(f=>o.apiName+'.'+f.apiName));
 const targets=new Set([...objectSet,...seed.objects.map(o=>o.apiName)]);
 const unresolvedReferences=seed.objects.flatMap(o=>o.fields
  .filter(f=>f.relatedObject&&!targets.has(f.relatedObject))
  .map(f=>o.apiName+'.'+f.apiName+' → '+f.relatedObject));
 return {missingObjects,missingFields,unresolvedReferences,
  upToDate:missingObjects.length===0&&missingFields.length===0,provisioningOnly:false};
}

export function registerSeederManagerRoutes(app:Express,db:SqlPersistence,platformTenants:PlatformTenantService){
 async function context(req:any){
  const actor=req.actor;
  if(!actor)throw Error('Authentication required');
  await platformTenants.requirePlatform(actor.tenant_id,actor.user_id);
  const slug=req.params.slug;
  if(typeof slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
   throw Error('Invalid tenant');
  const {rows}=await db.query<{id:string}>('SELECT id FROM md_tenants WHERE slug=$1',[slug]);
  if(!rows[0])throw Error('Tenant not found');
  const seed=seeds.find(s=>s.id===req.params.seedId);
  if(!seed)throw Error('Seeder not found');
  return {tenantId:rows[0].id,seed};
 }
 app.get('/api/platform/seeders',async(req:any,res,next)=>{
  try {
   await platformTenants.requirePlatform(req.actor.tenant_id,req.actor.user_id);
   res.json({seeders:seeds.map(({id,label,description,objects})=>({
    id,label,description,objectCount:objects.length
   }))});
  }catch(e){next(e);}
 });
 app.get('/api/platform/tenants/:slug/seeders/:seedId/preview',async(req:any,res,next)=>{
  try {
   const {tenantId,seed}=await context(req);
   res.json({seedId:seed.id,...await db.transaction(client=>diff(client,tenantId,seed))});
  }catch(e){next(e);}
 });
 app.post('/api/platform/tenants/:slug/seeders/:seedId/apply',async(req:any,res,next)=>{
  try {
   const {tenantId,seed}=await context(req);
   if(seed.provisioningOnly){
    res.status(409).json({error:'Initial identity and RBAC can only be seeded during tenant provisioning'});
    return;
   }
   const result=await db.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['metadrive:seed-manager:'+tenantId]);
    const before=await diff(client,tenantId,seed);
    if(before.unresolvedReferences.length)
     throw Error('Missing referenced objects: '+before.unresolvedReferences.join(', '));
    await seedCoreObjects(client,tenantId);
    const after=await diff(client,tenantId,seed);
    return {seedId:seed.id,
     createdObjects:before.missingObjects.filter(x=>!after.missingObjects.includes(x)),
     createdFields:before.missingFields.filter(x=>!after.missingFields.includes(x)),...after};
   });
   res.json(result);
  }catch(e){next(e);}
 });
}

import {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import {z} from 'zod';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
const uuid=z.string().uuid();
const entitlement=z.object({tenantId:uuid,id:uuid.optional(),license_key:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),label:z.string().min(1).max(120),
 kind:z.enum(['User','PermissionSet']),enabled:z.boolean(),seat_limit:z.number().int().min(0).nullable(),expires_at:z.string().datetime().nullable(),
 auto_assign:z.boolean().default(false),capabilities:z.array(z.object({resource:z.string().regex(/^[A-Za-z0-9_*][A-Za-z0-9_.*:-]{0,199}$/),action:z.string().regex(/^(\*|[A-Za-z][A-Za-z0-9_-]*)$/)}).strict()).max(500)}).strict();
export class LicenseService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async platformPools(actorTenant:string,actor:string,target?:unknown){
  await new PlatformTenantService(this.db,this.rbac).requirePlatform(actorTenant,actor);
  await this.rbac.require(actorTenant,actor,'PlatformTenant','manage');
  if(target===undefined)return {tenants:(await this.db.query('SELECT id,name,slug FROM md_tenants ORDER BY name LIMIT 1000')).rows};
  if(!uuid.safeParse(target).success)throw Error('Invalid tenant');
  const [p,c]=await Promise.all([this.db.query('SELECT * FROM md_license_entitlements WHERE tenant_id=$1 ORDER BY label',[target]),this.db.query('SELECT entitlement_id,resource,action FROM md_license_capabilities WHERE tenant_id=$1',[target])]);
  return {entitlements:p.rows.map(e=>({...e,capabilities:c.rows.filter(v=>v.entitlement_id===e.id).map(v=>({resource:v.resource,action:v.action}))}))};
 }
 async describe(tenant:string,user:string){
  await this.rbac.require(tenant,user,'Security','read');
  const [e,a,r,u,p,c]=await Promise.all([
   this.db.query('SELECT e.*,(SELECT count(*)::integer FROM md_user_license_assignments a WHERE a.tenant_id=e.tenant_id AND a.entitlement_id=e.id) AS used_seats FROM md_license_entitlements e WHERE e.tenant_id=$1 ORDER BY label',[tenant]),
   this.db.query('SELECT user_id,entitlement_id FROM md_user_license_assignments WHERE tenant_id=$1',[tenant]),
   this.db.query('SELECT permission_set_id,entitlement_id FROM md_permission_set_license_requirements WHERE tenant_id=$1',[tenant]),
   this.db.query('SELECT id,email,display_name FROM md_users WHERE tenant_id=$1 ORDER BY email',[tenant]),
   this.db.query('SELECT id,api_name FROM md_permission_sets WHERE tenant_id=$1 ORDER BY api_name',[tenant]),
   this.db.query('SELECT entitlement_id,resource,action FROM md_license_capabilities WHERE tenant_id=$1',[tenant])]);
  return {entitlements:e.rows,assignments:a.rows,requirements:r.rows,users:u.rows,permissionSets:p.rows,capabilities:c.rows};
 }
 async issue(actorTenant:string,actor:string,input:unknown){
  await new PlatformTenantService(this.db,this.rbac).requirePlatform(actorTenant,actor);
  await this.rbac.require(actorTenant,actor,'PlatformTenant','manage');
  const parsed=entitlement.safeParse(input);if(!parsed.success)throw Error('Invalid license entitlement');const e=parsed.data;
  await this.db.transaction(async c=>{
   await c.query('SELECT id FROM md_tenants WHERE id=$1 FOR UPDATE',[e.tenantId]);
   let id=e.id;
   if(id){
    const found=await c.query('SELECT id FROM md_license_entitlements WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[e.tenantId,id]);
    if(!found.rows[0])throw Error('License entitlement not found');
    const seats=await c.query<{used:string}>('SELECT count(*)::text AS used FROM md_user_license_assignments WHERE tenant_id=$1 AND entitlement_id=$2',[e.tenantId,id]);
    if(e.seat_limit!==null&&Number(seats.rows[0]?.used)>e.seat_limit)throw Error('Invalid seat limit: revoke assignments first');
    await c.query('UPDATE md_license_entitlements SET label=$3,enabled=$4,seat_limit=$5,expires_at=$6,auto_assign=$7 WHERE tenant_id=$1 AND id=$2',[e.tenantId,id,e.label,e.enabled,e.seat_limit,e.expires_at,e.auto_assign]);
   }else id=(await c.query<{id:string}>(`INSERT INTO md_license_entitlements(tenant_id,license_key,label,kind,enabled,seat_limit,expires_at,auto_assign)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[e.tenantId,e.license_key,e.label,e.kind,e.enabled,e.seat_limit,e.expires_at,e.auto_assign])).rows[0].id;
   await c.query('DELETE FROM md_license_capabilities WHERE tenant_id=$1 AND entitlement_id=$2',[e.tenantId,id]);
   for(const cap of e.capabilities)await c.query('INSERT INTO md_license_capabilities VALUES($1,$2,$3,$4)',[e.tenantId,id,cap.resource,cap.action]);
  });return {issued:true};
 }
 async assign(tenant:string,actor:string,input:unknown){
  await this.rbac.require(tenant,actor,'Security','manage');
  const parsed=z.object({user_id:uuid,entitlement_id:uuid,assigned:z.boolean()}).strict().safeParse(input);if(!parsed.success)throw Error('Invalid license assignment');const v=parsed.data;
  if(v.user_id===actor&&!v.assigned)throw Error('Cannot alter own license assignment');
  await this.db.transaction(async c=>{
   const e=await c.query<{enabled:boolean;seat_limit:number|null;active:boolean}>('SELECT enabled,seat_limit,(expires_at IS NULL OR expires_at>now()) AS active FROM md_license_entitlements WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,v.entitlement_id]);
   if(!e.rows[0])throw Error('License entitlement not found');
   if(v.assigned){
    if(!e.rows[0].enabled||!e.rows[0].active)throw Error('Invalid inactive license');
    const count=await c.query<{used:string}>(`SELECT count(*)::text AS used FROM md_user_license_assignments WHERE tenant_id=$1 AND entitlement_id=$2 AND user_id<>$3`,[tenant,v.entitlement_id,v.user_id]);
    if(e.rows[0].seat_limit!==null&&Number(count.rows[0]?.used)>=e.rows[0].seat_limit)throw Error('License seats exhausted');
    await c.query('INSERT INTO md_user_license_assignments VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,v.user_id,v.entitlement_id]);
   }else await c.query('DELETE FROM md_user_license_assignments WHERE tenant_id=$1 AND user_id=$2 AND entitlement_id=$3',[tenant,v.user_id,v.entitlement_id]);
   for(const table of ['md_sessions','md_refresh_sessions'])await c.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[tenant,v.user_id]);
  });return {assigned:v.assigned};
 }
 async requirement(tenant:string,actor:string,input:unknown){
  await this.rbac.require(tenant,actor,'Security','manage');
  const parsed=z.object({permission_set_id:uuid,entitlement_id:uuid,required:z.boolean()}).strict().safeParse(input);if(!parsed.success)throw Error('Invalid permission-set license requirement');const v=parsed.data;
  await this.db.transaction(async c=>{
   const found=await c.query("SELECT id FROM md_license_entitlements WHERE tenant_id=$1 AND id=$2 AND kind='PermissionSet'",[tenant,v.entitlement_id]);if(!found.rows[0])throw Error('Invalid permission-set license');
   if(v.required)await c.query('INSERT INTO md_permission_set_license_requirements VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,v.permission_set_id,v.entitlement_id]);
   else await c.query('DELETE FROM md_permission_set_license_requirements WHERE tenant_id=$1 AND permission_set_id=$2 AND entitlement_id=$3',[tenant,v.permission_set_id,v.entitlement_id]);
  });return {saved:true};
 }
}

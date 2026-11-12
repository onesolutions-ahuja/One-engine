import {createHash,randomBytes} from 'node:crypto';
import type {SqlPersistence} from './sql-persistence.js';
import {AuthenticationService} from './authentication.js';
import {seedInitialUser} from '../app-seeders/initial-user.js';
import {seedOneEnginePolicy} from '../app-seeders/oneengine-policy.js';
import {seedCoreObjects} from '../app-seeders/core-objects.js';

export type TenantRequest={
  slug:string;
  name:string;
  domain:string;
  developerEmail:string;
  developerPassword:string;
  developerName?:string;
  tenantDeveloperEmail?:string;
};
export type ProvisioningAuthority={actorTenantId:string;actorUserId:string;idempotencyKey:string};
export class TenantProvisioning {
  constructor(private readonly db:SqlPersistence) {}
  async provision(request:TenantRequest,authority?:ProvisioningAuthority) {
    const {slug,name,domain,developerEmail,developerPassword,developerName}=request;
    const tenantDeveloperEmail=request.tenantDeveloperEmail??'developer@'+domain;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid tenant slug');
    if(!name.trim())throw new Error('Invalid tenant name');
    if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(domain) || domain!==domain.toLowerCase())
      throw new Error('Invalid tenant domain');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(developerEmail))throw new Error('Invalid developer email');
    if(developerName!==undefined&&(typeof developerName!=='string'||!developerName.trim()||developerName.length>120))throw new Error('Invalid developer name');
    if(authority&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authority.idempotencyKey))throw new Error('Invalid idempotency key');
    const developerIdentityEmail=tenantDeveloperEmail.toLowerCase();
    if(request.tenantDeveloperEmail!==undefined && !/^[a-z0-9][a-z0-9._+-]{0,62}@unesolutions\.co\.uk$/.test(developerIdentityEmail))
      throw new Error('Invalid tenant developer email');
    if(developerIdentityEmail.toLowerCase()===developerEmail.toLowerCase())
      throw new Error('Administrator email must differ from tenant developer identity');
    const passwordHash=await new AuthenticationService(this.db).hashPassword(developerPassword);
    // Never reuse the administrator password or expose an initial developer password.
    const developerDisabledHash=await new AuthenticationService(this.db).hashPassword(
      randomBytes(48).toString('base64url'));
    const digest=createHash('sha256').update(JSON.stringify([slug,name,domain,developerEmail.toLowerCase(),developerPassword,developerName??'',developerIdentityEmail])).digest('hex');
    return this.db.transaction(async client=>{
      if(authority){
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
          [authority.actorTenantId+':'+authority.actorUserId+':'+authority.idempotencyKey]);
        const {rows}=await client.query<{request_digest:string;slug:string;domain:string}>(`
          SELECT p.request_digest,t.slug,d.domain FROM md_tenant_provisioning_requests p
          JOIN md_tenants t ON t.id=p.target_tenant_id
          JOIN md_tenant_domains d ON d.tenant_id=t.id
          WHERE p.actor_tenant_id=$1 AND p.actor_user_id=$2 AND p.request_key=$3::uuid
        `,[authority.actorTenantId,authority.actorUserId,authority.idempotencyKey]);
        if(rows[0]){
          if(rows[0].request_digest!==digest)throw new Error('Idempotency key conflict');
          return {slug:rows[0].slug,domain:rows[0].domain,replayed:true};
        }
      }
      const existing=await client.query('SELECT id FROM md_tenants WHERE slug=$1',[slug]);
      if(existing.rowCount)throw new Error('Tenant already exists; refusing to overwrite');
      const duplicate=await client.query('SELECT 1 FROM md_users WHERE lower(email)=$1 LIMIT 1',[developerIdentityEmail]);
      if(duplicate.rowCount)throw new Error('Tenant developer email already registered');
      // The first tenant of a fresh system owns it (OneEngine); every later
      // tenant's developer is limited to its own tenant (TenantDeveloper).
      const firstTenant=(await client.query('SELECT 1 FROM md_tenants LIMIT 1')).rowCount===0;
      const tenant=await client.query<{id:string}>(
        'INSERT INTO md_tenants (slug,name) VALUES ($1,$2) RETURNING id',[slug,name]);
      const tenantId=tenant.rows[0].id;
      await client.query('INSERT INTO md_session_policies(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenantId]);
      await client.query('INSERT INTO md_password_policies(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenantId]);
      await client.query('INSERT INTO md_tenant_domains (domain,tenant_id) VALUES ($1,$2)',[domain,tenantId]);
      // Exactly three Core bootstrap seeders, in one tenant SQL transaction.
      const users=await seedInitialUser(client,{
        tenantId,
        administratorEmail:developerEmail,
        administratorName:developerName,
        administratorPasswordHash:passwordHash,
        developerEmail:developerIdentityEmail,
        disabledDeveloperPasswordHash:developerDisabledHash
      });
      await seedOneEnginePolicy(client,tenantId,users,{systemOwner:firstTenant});
      await seedCoreObjects(client,tenantId);
      if(authority){
        await client.query(`INSERT INTO md_tenant_provisioning_requests
          (actor_tenant_id,actor_user_id,request_key,request_digest,target_tenant_id)
          VALUES ($1,$2,$3::uuid,$4,$5)`,
          [authority.actorTenantId,authority.actorUserId,authority.idempotencyKey,digest,tenantId]);
        await client.query(`INSERT INTO md_tenant_lifecycle_audit
          (actor_tenant_id,actor_user_id,target_tenant_id,operation,previous_status,new_status)
          VALUES ($1,$2,$3,'create','NONE','ACTIVE')`,
          [authority.actorTenantId,authority.actorUserId,tenantId]);
      }
      return {slug,domain,replayed:false};
    });
  }
}

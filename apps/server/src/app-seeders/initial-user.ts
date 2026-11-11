import type {PoolClient} from 'pg';

export type InitialUserInput={
 tenantId:string;
 administratorEmail:string;
 administratorName?:string;
 administratorPasswordHash:string;
 developerEmail:string;
 disabledDeveloperPasswordHash:string;
};

/** InitialUser is the only tenant bootstrap identity seeder.
 * The human administrator remains enabled while developer@tenant is created
 * disabled pending MFA activation. No credentials or permissions are shared.
 */
export async function seedInitialUser(client:PoolClient,input:InitialUserInput){
 const {tenantId}=input;
 const user=await client.query<{id:string}>(
  'INSERT INTO md_users (tenant_id,email,password_hash,display_name,enabled) VALUES ($1,$2,$3,$4,true) RETURNING id',
  [tenantId,input.administratorEmail.toLowerCase(),input.administratorPasswordHash,input.administratorName?.trim()??'']);
 const profile=await client.query<{id:string}>(
  'INSERT INTO md_profiles(tenant_id,api_name,label) VALUES($1,$2,$3) RETURNING id',
  [tenantId,'Default','Default Profile']);
 await client.query('INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)',
  [tenantId,user.rows[0].id,profile.rows[0].id]);
 // A single email represents a single login within a tenant. When the owner
 // selects the same address for both roles, reuse the administrator identity
 // rather than inserting a duplicate that violates md_users_email_per_tenant.
 const sharedIdentity=input.administratorEmail.trim().toLowerCase()===input.developerEmail.trim().toLowerCase();
 const disabledDeveloper=sharedIdentity
  ?{rows:[{id:user.rows[0].id}]}
  :await client.query<{id:string}>(`
  INSERT INTO md_users(tenant_id,email,password_hash,display_name,enabled)
  VALUES($1,$2,$3,'Tenant Developer',false) RETURNING id`,
  [tenantId,input.developerEmail.toLowerCase(),input.disabledDeveloperPasswordHash]);
 if(!sharedIdentity)await client.query('INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)',
  [tenantId,disabledDeveloper.rows[0].id,profile.rows[0].id]);
 // Shared developer identities already have an enabled password-bearing login.
 // Mark them activated at bootstrap; they must never be offered activation
 // that would reset the same administrator's credentials.
 if(sharedIdentity)await client.query(`
  INSERT INTO md_tenant_developer_accounts(tenant_id,user_id,activated_at)
  VALUES($1,$2,now())`,[tenantId,disabledDeveloper.rows[0].id]);
 else await client.query('INSERT INTO md_tenant_developer_accounts(tenant_id,user_id) VALUES($1,$2)',
  [tenantId,disabledDeveloper.rows[0].id]);
 if(!sharedIdentity)await client.query('UPDATE md_users SET reports_to_user_id=$3 WHERE tenant_id=$1 AND id=$2',
  [tenantId,user.rows[0].id,disabledDeveloper.rows[0].id]);
 return {administratorUserId:user.rows[0].id,developerUserId:disabledDeveloper.rows[0].id};
}

import {randomBytes} from 'node:crypto';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {broker} from './docker-mail-admin-routes.js';

const emailPattern=/^[a-z0-9][a-z0-9._+-]{0,62}@unesolutions\.co\.uk$/;
const valid=(email:string)=>emailPattern.test(email);
const mailListHas=(list:string,email:string)=>list.toLowerCase().split(/\s+/).some(token=>token.replace(/^[^a-z0-9]+|[^a-z0-9.\-+@_]+$/g,'')===email);

/** Platform-admin-only adapter. Availability must be checked against both SQL and the real mail server. */
export class TenantDeveloperMailbox {
 constructor(private readonly db:SqlPersistence){}
 async available(email:string):Promise<boolean>{
  if(!valid(email))return false;
  const {rows}=await this.db.query<{occupied:boolean}>(`
   SELECT (EXISTS(SELECT 1 FROM md_mail_accounts WHERE lower(email)=$1)
    OR EXISTS(SELECT 1 FROM md_users WHERE lower(email)=$1)) AS occupied`,[email]);
  if(rows[0]?.occupied)return false;
  const listed=await broker('mailbox_list');
  return !mailListHas(listed,email);
 }
 async suggestions(slug:string){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>54)
   throw new Error('Invalid tenant identifier');
  const preferred=slug+'@unesolutions.co.uk';
  const available=await this.available(preferred);
  const alternatives:string[]=[];
  if(!available){
   for(let i=1;i<=20&&alternatives.length<3;i++){
    const proposed=slug+i+'@unesolutions.co.uk';
    if(await this.available(proposed))alternatives.push(proposed);
   }
   if(alternatives.length<3){
    const proposed=slug+'-dev@unesolutions.co.uk';
    if(await this.available(proposed))alternatives.push(proposed);
   }
  }
  return {email:preferred,available,alternatives};
 }
 /** Idempotently reconciles only a mailbox already recorded for this exact tenant. */
 async provision(tenantSlug:string,email:string,actorTenantId:string,actorUserId:string){
  if(!valid(email))throw new Error('Invalid tenant developer email');
  const tenant=await this.db.query<{id:string}>(`SELECT id FROM md_tenants WHERE slug=$1`,[tenantSlug]);
  const tenantId=tenant.rows[0]?.id;
  if(!tenantId)throw new Error('Tenant not found');
  const existing=await this.db.query<{tenant_id:string;status:string}>(`
   SELECT tenant_id,status FROM md_mail_accounts WHERE lower(email)=$1`,[email]);
  if(existing.rows[0] && existing.rows[0].tenant_id!==tenantId)
   throw new Error('Developer mailbox belongs to another tenant');
  if(existing.rows[0]?.status==='active')return;
  // A pending/error reservation can only be retried after a real mail-server check.
  if(!(await this.availableForTenant(email,tenantId)))
   throw new Error('Developer mailbox already exists on the mail server; manual reconciliation required');
  await broker('sender_approve',email);
  await this.db.query(`INSERT INTO md_mail_accounts(email,tenant_id,domain,description,status)
   VALUES($1,$2,'unesolutions.co.uk','Tenant developer mailbox','pending')
   ON CONFLICT(email) DO UPDATE SET status='pending',updated_at=now()
    WHERE md_mail_accounts.tenant_id=EXCLUDED.tenant_id`,[email,tenantId]);
  try{
   const password=randomBytes(48).toString('base64url');
   await broker('mailbox_add',email,password);
   await this.db.query(`UPDATE md_mail_accounts SET status='active',updated_at=now()
     WHERE email=$1 AND tenant_id=$2`,[email,tenantId]);
   await this.db.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'tenant.developer.mailbox.provisioned',$3::jsonb)`,
    [actorTenantId,actorUserId,JSON.stringify({targetTenantId:tenantId,email})]);
  }catch(error){
   await this.db.query(`UPDATE md_mail_accounts SET status='error',updated_at=now()
    WHERE email=$1 AND tenant_id=$2`,[email,tenantId]).catch(()=>{});
   throw error;
  }
 }
 private async availableForTenant(email:string,tenantId:string){
  const {rows}=await this.db.query<{occupied:boolean}>(`
   SELECT EXISTS(SELECT 1 FROM md_mail_accounts WHERE lower(email)=$1 AND tenant_id<>$2)
    AS occupied`,[email,tenantId]);
  if(rows[0]?.occupied)return false;
  return !mailListHas(await broker('mailbox_list'),email);
 }
}

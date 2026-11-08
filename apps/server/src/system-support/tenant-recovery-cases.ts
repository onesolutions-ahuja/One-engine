import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import type {MfaService} from './mfa-service.js';
import type {NamedCredentialService} from './named-credential-service.js';
import {TenantRecoveryContacts,recoveryUuid,tokenDigest,newRecoveryToken,validRecoveryEmail}
 from './tenant-recovery-contacts.js';
type Actor={tenant_id:string;user_id:string};
type CaseRow={id:string;tenant_id:string;claimant_user_id:string;status:string;
 identity_proof_status:string;wait_until:Date;opened_at:Date;redeemed_at:Date|null;
 invitation_hash:string|null;invitation_expires_at:Date|null};
type Proof={email:string;confirmed_at:Date|null;disputed_at:Date|null};
export class TenantRecoveryCases{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly platform:PlatformTenantService,private readonly mfa:MfaService,
  private readonly contacts:TenantRecoveryContacts,private readonly mail:NamedCredentialService){}
 private async operator(actor:Actor,code?:unknown){
  await this.platform.requirePlatform(actor.tenant_id,actor.user_id);
  await this.rbac.require(actor.tenant_id,actor.user_id,'Platform:Recovery','manage');
  if(code!==undefined){
   if(typeof code!=='string'||!/^[0-9]{6}$/.test(code))throw Error('Fresh MFA code required');
   await this.mfa.verifyFresh(actor.tenant_id,actor.user_id,code);
  }
 }
 private async verifiedDomain(tenant:string){
  const {rows}=await this.db.query<{ok:boolean}>(`
   SELECT EXISTS(SELECT 1 FROM md_tenant_domains WHERE tenant_id=$1 AND verified_at IS NOT NULL) AS ok`,[tenant]);
  if(!rows[0]?.ok)throw Error('Verified tenant domain ownership required');
 }
 private async matureContacts(tenant:string){
  const {rows}=await this.db.query<{email:string}>(`
   SELECT email FROM md_tenant_recovery_contacts
   WHERE tenant_id=$1 AND verified_at<=now()-interval '7 days'
     AND created_at<=now()-interval '7 days' ORDER BY email`,[tenant]);
  if(rows.length<2)throw Error('Two mature independently verified contacts are required');
  return rows;
 }
 async open(actor:Actor,body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid recovery case');
  const p=body as Record<string,unknown>;
  if(typeof p.tenantId!=='string'||!recoveryUuid.test(p.tenantId)||
   typeof p.claimantUserId!=='string'||!recoveryUuid.test(p.claimantUserId))
   throw Error('Invalid recovery case');
  await this.operator(actor,p.mfaCode);
  await this.verifiedDomain(p.tenantId);
  const enrolled=await this.matureContacts(p.tenantId);
  const {rows:claimant}=await this.db.query<{id:string}>(`
   SELECT id FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true`,
   [p.tenantId,p.claimantUserId]);
  if(!claimant[0])throw Error('Claimant must hold an enabled tenant identity');
  const smtp=await this.contacts.mailConfig(p.tenantId);
  const tokens=enrolled.map(contact=>({email:contact.email,token:newRecoveryToken()}));
  const id=await this.db.transaction(async client=>{
   const {rows}=await client.query<{id:string}>(`
    INSERT INTO md_tenant_recovery_cases
     (tenant_id,claimant_user_id,opened_by_tenant_id,opened_by_user_id)
    VALUES($1,$2,$3,$4) RETURNING id`,
    [p.tenantId,p.claimantUserId,actor.tenant_id,actor.user_id]);
   for(const item of tokens)await client.query(`
    INSERT INTO md_tenant_recovery_case_proofs
     (tenant_id,case_id,email,token_hash,token_expires_at)
    VALUES($1,$2,$3,$4,now()+interval '48 hours')`,
    [p.tenantId,rows[0].id,item.email,tokenDigest(item.token)]);
   return rows[0].id;
  });
  try{
   for(const item of tokens)await this.mail.sendTenantEmail(p.tenantId,smtp.id,smtp.from,item.email,
    'MetaDrive emergency recovery verification',
    'An emergency tenant recovery was requested. If you independently confirm this request, submit the private token '+
    item.token+' for case '+id+'. It expires in 48 hours. If this request is unexpected, dispute it immediately.');
  }catch(error){
   await this.db.query(`UPDATE md_tenant_recovery_cases SET
    status='DISPUTED',identity_proof_status='DISPUTED'
    WHERE tenant_id=$1 AND id=$2 AND status='PENDING'`,[p.tenantId,id]);
   throw error;
  }
  return {caseId:id};
 }
 private async caseById(id:string,lock=false):Promise<CaseRow>{
  if(!recoveryUuid.test(id))throw Error('Invalid recovery case ID');
  const {rows}=await this.db.query<CaseRow>(`
   SELECT id,tenant_id,claimant_user_id,status,identity_proof_status,
     wait_until,opened_at,redeemed_at,invitation_hash,invitation_expires_at
   FROM md_tenant_recovery_cases WHERE id=$1`,[id]);
  if(!rows[0])throw Error('Recovery case not found');
  return rows[0];
 }
 async read(actor:Actor,id:string){
  await this.operator(actor);
  const value=await this.caseById(id);
  const {rows}=await this.db.query<{n:number}>(`
   SELECT count(DISTINCT operator_user_id)::integer AS n
   FROM md_tenant_recovery_approvals WHERE tenant_id=$1 AND case_id=$2`,
   [value.tenant_id,id]);
  return {case:{id:value.id,status:value.status,
   identity_proof_status:value.identity_proof_status,
   openedAt:value.opened_at,waitUntil:value.wait_until},
   approvals:rows[0]?.n??0};
 }
 async proof(id:string,body:unknown,dispute:boolean){
  if(!body||typeof body!=='object'||Array.isArray(body)||!recoveryUuid.test(id))
   throw Error('Invalid recovery proof');
  const p=body as Record<string,unknown>;
  if(!validRecoveryEmail(p.email)||typeof p.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.token))
   throw Error('Invalid recovery proof');
  const email=p.email.toLowerCase(),digest=tokenDigest(p.token);
  const accepted=await this.db.transaction(async client=>{
   const {rows}=await client.query<{tenant_id:string;token_hash:string}>(`
    SELECT tenant_id,token_hash FROM md_tenant_recovery_case_proofs
    WHERE case_id=$1 AND email=$2 AND token_expires_at>now()
      AND confirmed_at IS NULL AND disputed_at IS NULL AND failed_attempts<5
    FOR UPDATE`,[id,email]);
   const proof=rows[0];
   if(!proof||proof.token_hash!==digest){
    if(proof)await client.query(`UPDATE md_tenant_recovery_case_proofs
      SET failed_attempts=LEAST(failed_attempts+1,10)
      WHERE tenant_id=$1 AND case_id=$2 AND email=$3`,[proof.tenant_id,id,email]);
    return false;
   }
   const {rows:cases}=await client.query<{status:string}>(`
    SELECT status FROM md_tenant_recovery_cases
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[proof.tenant_id,id]);
   if(cases[0]?.status!=='PENDING'&&cases[0]?.status!=='VERIFIED')return false;
   await client.query(`UPDATE md_tenant_recovery_case_proofs SET
    ${dispute?'disputed_at':'confirmed_at'}=now(),token_hash=''
    WHERE tenant_id=$1 AND case_id=$2 AND email=$3`,[proof.tenant_id,id,email]);
   if(dispute){
    await client.query(`UPDATE md_tenant_recovery_cases SET
      status='DISPUTED',identity_proof_status='DISPUTED'
      WHERE tenant_id=$1 AND id=$2`,[proof.tenant_id,id]);
   }else{
    const {rows:counts}=await client.query<{n:number;disputed:number}>(`
     SELECT count(*) FILTER(WHERE confirmed_at IS NOT NULL)::integer AS n,
       count(*) FILTER(WHERE disputed_at IS NOT NULL)::integer AS disputed
     FROM md_tenant_recovery_case_proofs WHERE tenant_id=$1 AND case_id=$2`,
     [proof.tenant_id,id]);
    if(counts[0]?.n>=2&&counts[0]?.disputed===0)
     await client.query(`UPDATE md_tenant_recovery_cases
      SET status='VERIFIED',identity_proof_status='VERIFIED'
      WHERE tenant_id=$1 AND id=$2 AND status='PENDING'`,[proof.tenant_id,id]);
   }
   return true;
  });
  if(!accepted)throw Error('Recovery proof invalid or expired');
  return {verified:!dispute,disputed:dispute};
 }
 private async requirements(value:CaseRow){
  await this.verifiedDomain(value.tenant_id);
  await this.matureContacts(value.tenant_id);
  if(value.identity_proof_status!=='VERIFIED'||value.status==='DISPUTED'||
   new Date(value.wait_until).getTime()>Date.now())
   throw Error('Recovery evidence or 24-hour waiting period incomplete');
  const {rows}=await this.db.query<{n:number;confirmed:number;disputed:number}>(`
   SELECT
    (SELECT count(DISTINCT operator_user_id)::integer FROM md_tenant_recovery_approvals
      WHERE tenant_id=$1 AND case_id=$2) AS n,
    (SELECT count(*)::integer FROM md_tenant_recovery_case_proofs
      WHERE tenant_id=$1 AND case_id=$2 AND confirmed_at IS NOT NULL) AS confirmed,
    (SELECT count(*)::integer FROM md_tenant_recovery_case_proofs
      WHERE tenant_id=$1 AND case_id=$2 AND disputed_at IS NOT NULL) AS disputed`,
   [value.tenant_id,value.id]);
  return rows[0];
 }
 async approve(actor:Actor,id:string,body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid approval');
  await this.operator(actor,(body as Record<string,unknown>).mfaCode);
  const value=await this.caseById(id);
  if(value.status!=='VERIFIED'&&value.status!=='APPROVED')
   throw Error('Recovery case is not ready for approval');
  const proof=await this.requirements(value);
  if(proof.confirmed<2||proof.disputed)throw Error('Independent recovery proofs are incomplete');
  await this.db.transaction(async client=>{
   const {rows:locked}=await client.query<{status:string}>(`
    SELECT status FROM md_tenant_recovery_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [value.tenant_id,id]);
   if(!['VERIFIED','APPROVED'].includes(locked[0]?.status??''))throw Error('Recovery case unavailable');
   await client.query(`INSERT INTO md_tenant_recovery_approvals
     (tenant_id,case_id,operator_tenant_id,operator_user_id)
     VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
     [value.tenant_id,id,actor.tenant_id,actor.user_id]);
   const {rows}=await client.query<{n:number}>(`
    SELECT count(DISTINCT operator_user_id)::integer AS n FROM md_tenant_recovery_approvals
    WHERE tenant_id=$1 AND case_id=$2`,[value.tenant_id,id]);
   if(rows[0]?.n>=2)await client.query(`
    UPDATE md_tenant_recovery_cases SET status='APPROVED',approved_at=now()
    WHERE tenant_id=$1 AND id=$2`,[value.tenant_id,id]);
  });
  return this.read(actor,id);
 }
 async invite(actor:Actor,id:string,body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid invitation');
  await this.operator(actor,(body as Record<string,unknown>).mfaCode);
  const value=await this.caseById(id);
  if(value.status!=='APPROVED')throw Error('Recovery case requires two approvals');
  const proofs=await this.requirements(value);
  if(proofs.n<2||proofs.confirmed<2||proofs.disputed)throw Error('Recovery requirements incomplete');
  const {rows:contacts}=await this.db.query<{email:string}>(`
   SELECT email FROM md_tenant_recovery_case_proofs WHERE tenant_id=$1 AND case_id=$2
    AND confirmed_at IS NOT NULL AND disputed_at IS NULL ORDER BY email LIMIT 1`,
   [value.tenant_id,id]);
  if(!contacts[0])throw Error('Confirmed contact unavailable');
  const token=newRecoveryToken(),hash=tokenDigest(token);
  const {rowCount}=await this.db.query(`
   UPDATE md_tenant_recovery_cases SET invitation_hash=$3,
     invitation_expires_at=now()+interval '15 minutes'
   WHERE tenant_id=$1 AND id=$2 AND status='APPROVED' AND invitation_hash IS NULL`,
   [value.tenant_id,id,hash]);
  if(!rowCount)throw Error('Recovery invitation already requested');
  try{
   const smtp=await this.contacts.mailConfig(value.tenant_id);
   await this.mail.sendTenantEmail(value.tenant_id,smtp.id,smtp.from,contacts[0].email,
    'MetaDrive recovery invitation for verified claimant',
    'Only give this 15-minute invitation code to the verified tenant claimant: '+token+
    '. Case: '+id+'. Never send it to platform support.');
   await this.db.query(`UPDATE md_tenant_recovery_cases SET status='INVITED'
     WHERE tenant_id=$1 AND id=$2 AND invitation_hash=$3 AND status='APPROVED'`,
     [value.tenant_id,id,hash]);
  }catch(error){
   await this.db.query(`UPDATE md_tenant_recovery_cases
    SET invitation_hash=NULL,invitation_expires_at=NULL
    WHERE tenant_id=$1 AND id=$2 AND invitation_hash=$3 AND status='APPROVED'`,
    [value.tenant_id,id,hash]);
   throw error;
  }
  return {invited:true};
 }
 async redeem(actor:Actor,id:string,body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid invitation');
  const p=body as Record<string,unknown>;
  if(typeof p.invitationToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.invitationToken))
   throw Error('Invalid invitation');
  const value=await this.caseById(id);
  if(value.tenant_id!==actor.tenant_id||value.claimant_user_id!==actor.user_id)
   throw Error('Permission denied');
  await this.mfa.verifyFresh(actor.tenant_id,actor.user_id,p.mfaCode);
  const proof=await this.requirements(value);
  if(value.status!=='INVITED'||proof.n<2||proof.confirmed<2||proof.disputed||
   value.invitation_hash!==tokenDigest(p.invitationToken)||
   !value.invitation_expires_at||new Date(value.invitation_expires_at).getTime()<Date.now())
   throw Error('Recovery invitation not valid');
  const {rowCount}=await this.db.query(`
   UPDATE md_tenant_recovery_cases
   SET status='REDEEMED',redeemed_at=now(),invitation_hash=NULL
   WHERE tenant_id=$1 AND id=$2 AND claimant_user_id=$3 AND status='INVITED'
    AND invitation_hash=$4 AND invitation_expires_at>now()`,
    [actor.tenant_id,id,actor.user_id,tokenDigest(p.invitationToken)]);
  if(!rowCount)throw Error('Recovery invitation already used');
  return {redeemed:true};
 }
 async repair(actor:Actor,id:string,body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid repair');
  const value=await this.caseById(id);
  if(value.tenant_id!==actor.tenant_id||value.claimant_user_id!==actor.user_id)
   throw Error('Permission denied');
  await this.mfa.verifyFresh(actor.tenant_id,actor.user_id,(body as Record<string,unknown>).mfaCode);
  const proof=await this.requirements(value);
  if(value.status!=='REDEEMED'||proof.n<2||proof.confirmed<2||proof.disputed||
   !value.redeemed_at||new Date(value.redeemed_at).getTime()<Date.now()-15*60000)
   throw Error('Restricted recovery repair window expired');
  await this.db.transaction(async client=>{
   const {rows}=await client.query<{status:string}>(`
    SELECT status FROM md_tenant_recovery_cases WHERE tenant_id=$1 AND id=$2
     AND claimant_user_id=$3 FOR UPDATE`,[actor.tenant_id,id,actor.user_id]);
   if(rows[0]?.status!=='REDEEMED')throw Error('Recovery already completed');
   const role=await client.query<{id:string}>(`
    SELECT r.id FROM md_roles r
     JOIN md_role_permission_sets rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
     JOIN md_permission_sets p ON p.tenant_id=rp.tenant_id AND p.id=rp.permission_set_id
     WHERE r.tenant_id=$1 AND r.api_name='TenantDeveloper' AND p.api_name='OneEngine'`,
    [actor.tenant_id]);
   if(!role.rows[0])throw Error('Tenant developer administrator policy unavailable');
   await client.query(`INSERT INTO md_user_roles(tenant_id,user_id,role_id)
     VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
     [actor.tenant_id,actor.user_id,role.rows[0].id]);
   await client.query(`UPDATE md_tenant_recovery_cases
     SET status='REPAIRED',repaired_at=now() WHERE tenant_id=$1 AND id=$2`,
     [actor.tenant_id,id]);
   for(const table of ['md_sessions','md_refresh_sessions'])
    await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
     [actor.tenant_id,actor.user_id]);
   await client.query(`INSERT INTO md_security_events
     (tenant_id,actor_user_id,subject_user_id,action,details)
     VALUES($1,$2,$2,'TenantRecoveryRepair',$3::jsonb)`,
     [actor.tenant_id,actor.user_id,JSON.stringify({caseId:id})]);
  });
  return {repaired:true};
 }
}

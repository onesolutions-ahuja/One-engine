import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {isPlatformRecoveryMailConfigured} from './platform-recovery-mailer.js';
import {readRecoveryFlow,recoveryActionReady,uuidPattern,
 type RecoveryChannelAction,type RecoveryFlowConfig} from './password-recovery-flow-config.js';

const textField=(value:unknown,max:number,label:string)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000]/.test(value))
  throw new Error('Invalid '+label);
 return value;
};
function parseChannel(raw:unknown,channel:'sms'|'whatsapp'):RecoveryChannelAction{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid recovery channel');
 const x=raw as Record<string,unknown>;
 if(typeof x.enabled!=='boolean')throw new Error('Invalid recovery channel activation');
 const serviceUser=x.flowServiceUserId||null,credential=x.credentialId||null;
 if(serviceUser!==null&&(typeof serviceUser!=='string'||!uuidPattern.test(serviceUser))
  ||credential!==null&&(typeof credential!=='string'||!uuidPattern.test(credential)))
  throw new Error('Invalid recovery Flow service identity or credential');
 const path=typeof x.calloutPath==='string'?x.calloutPath:'';
 const body=typeof x.calloutBody==='string'?x.calloutBody:'';
 const message=textField(x.messageTemplate,5000,'recovery message template');
 if(path.length>2048||path.startsWith('/')||path.includes('\\')||path.includes('..')
  ||body.length>32768)throw new Error('Invalid recovery HTTP Callout mapping');
 if(body){
  try{const parsed=JSON.parse(body) as unknown;
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw new Error('invalid');}
  catch{throw new Error('Recovery HTTP Callout body must be a JSON object mapping');}
 }
 const action:RecoveryChannelAction={channel,enabled:x.enabled,
  flowServiceUserId:serviceUser,credentialId:credential,
  calloutPath:path,calloutBody:body,messageTemplate:message};
 if(action.enabled&&!recoveryActionReady(action))
  throw new Error('Set a service user, HTTPS Named Credential and HTTP Callout for '+channel);
 return action;
}
function parseFlow(raw:unknown):RecoveryFlowConfig{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid recovery Flow');
 const x=raw as Record<string,unknown>;
 if(x.method!=='OTP'&&x.method!=='LINK'
  ||x.otpLength!==4&&x.otpLength!==6
  ||!Number.isInteger(x.expiryMinutes)||Number(x.expiryMinutes)<5||Number(x.expiryMinutes)>15
  ||!Number.isInteger(x.maxAttempts)||Number(x.maxAttempts)<3||Number(x.maxAttempts)>5)
  throw new Error('Invalid recovery OTP configuration');
 if(x.otpLength===4&&(Number(x.expiryMinutes)>5||Number(x.maxAttempts)>3))
  throw new Error('4-digit OTP requires a 5-minute expiry and at most 3 attempts');
 const emailSubject=textField(x.emailSubject,300,'recovery email subject');
 const emailTemplate=textField(x.emailTemplate,10000,'recovery email template');
 if(!emailTemplate.includes('{!Verification.Value}'))
  throw new Error('The recovery template must include {!Verification.Value}');
 if(!x.channels||typeof x.channels!=='object'||Array.isArray(x.channels))
  throw new Error('Invalid recovery channel definitions');
 const channels=x.channels as Record<string,unknown>;
 const sms=parseChannel(channels.sms,'sms'),whatsapp=parseChannel(channels.whatsapp,'whatsapp');
 if(x.method==='LINK'&&(sms.enabled||whatsapp.enabled))
  throw new Error('Link recovery supports email only');
 return {method:x.method,otpLength:x.otpLength,expiryMinutes:Number(x.expiryMinutes),
  maxAttempts:Number(x.maxAttempts),emailSubject,emailTemplate,channels:{sms,whatsapp}};
}
export class PasswordRecoverySettingsService{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async read(tenantId:string,userId:string){
  await this.rbac.require(tenantId,userId,'Security','read');
  const [flow,revisionResult]=await Promise.all([
   readRecoveryFlow(this.db,tenantId),
   this.db.query<{revision:number}>('SELECT revision FROM md_password_recovery_flow WHERE tenant_id=$1',[tenantId])
  ]);
  return {policy:{method:flow.method,defaultChannel:'email',allowedChannels:flow.method==='OTP'
   ?(['email',...(flow.channels.sms.enabled?['sms']:[]),...(flow.channels.whatsapp.enabled?['whatsapp']:[])]):
     ['email'],templates:{email:{subject:flow.emailSubject,body:flow.emailTemplate}}},
   flow,revision:revisionResult.rows[0]?.revision??0,
   fromEmail:process.env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL??'',
   deliveryManagedByPlatform:true,deliveryReady:isPlatformRecoveryMailConfigured(),
   linkReady:Boolean(process.env.METADRIVE_PASSWORD_RESET_ORIGIN)};
 }
 async save(tenantId:string,userId:string,input:unknown){
  await this.rbac.require(tenantId,userId,'Security','manage');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid recovery settings');
  const payload=input as Record<string,unknown>;
  let flow:RecoveryFlowConfig;
  if(payload.flow!==undefined)flow=parseFlow(payload.flow);
  else{
   // Existing clients remain usable while moving to the relational Flow editor.
   const policy=payload.policy as Record<string,unknown>|undefined;
   if(!policy||!['OTP','LINK'].includes(String(policy.method)))
    throw new Error('Invalid recovery settings');
   const old=await readRecoveryFlow(this.db,tenantId);
   const templates=policy.templates as {email?:{subject?:unknown;body?:unknown}}|undefined;
   flow=parseFlow({...old,method:policy.method,emailSubject:templates?.email?.subject??old.emailSubject,
    emailTemplate:templates?.email?.body??old.emailTemplate});
  }
  const revision=payload.revision===undefined?undefined:Number(payload.revision);
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<0))
   throw new Error('Invalid recovery Flow version');
  await this.db.transaction(async client=>{
   const current=await client.query<{revision:number}>(
    'SELECT revision FROM md_password_recovery_flow WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
   if(revision!==undefined&&(current.rows[0]?.revision??0)!==revision)
    throw new Error('Recovery Flow changed. Reload before saving');
   await client.query(`INSERT INTO md_password_recovery_flow
    (tenant_id,method,otp_length,otp_expiry_minutes,max_otp_attempts,email_subject,email_template)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(tenant_id) DO UPDATE SET method=EXCLUDED.method,otp_length=EXCLUDED.otp_length,
     otp_expiry_minutes=EXCLUDED.otp_expiry_minutes,max_otp_attempts=EXCLUDED.max_otp_attempts,
     email_subject=EXCLUDED.email_subject,email_template=EXCLUDED.email_template,
     revision=md_password_recovery_flow.revision+1,updated_at=now()`,[tenantId,flow.method,flow.otpLength,
      flow.expiryMinutes,flow.maxAttempts,flow.emailSubject,flow.emailTemplate]);
   for(const channel of ['sms','whatsapp'] as const){
    const action=flow.channels[channel];
    await client.query(`INSERT INTO md_password_recovery_channel_actions
     (tenant_id,channel,enabled,flow_service_user_id,credential_id,callout_path,callout_body,message_template)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(tenant_id,channel) DO UPDATE SET enabled=EXCLUDED.enabled,
      flow_service_user_id=EXCLUDED.flow_service_user_id,credential_id=EXCLUDED.credential_id,
      callout_path=EXCLUDED.callout_path,callout_body=EXCLUDED.callout_body,
      message_template=EXCLUDED.message_template,
      revision=md_password_recovery_channel_actions.revision+1,updated_at=now()`,
     [tenantId,channel,action.enabled,action.flowServiceUserId,action.credentialId,
      action.calloutPath,action.calloutBody,action.messageTemplate]);
   }
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action)
    VALUES($1,$2,'PasswordRecoveryFlowUpdated')`,[tenantId,userId]);
  });
  return this.read(tenantId,userId);
 }
}

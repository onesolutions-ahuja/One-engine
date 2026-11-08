import type {SqlExecutor} from '../system-files/sql-persistence.js';

export type RecoveryChannel='email'|'whatsapp'|'sms';
export type RecoveryMethod='OTP'|'LINK';
export type RecoveryChannelAction={
 channel:'whatsapp'|'sms';enabled:boolean;flowServiceUserId:string|null;
 credentialId:string|null;calloutPath:string;calloutBody:string;messageTemplate:string;
};
export type RecoveryFlowConfig={
 method:RecoveryMethod;otpLength:4|6;expiryMinutes:number;maxAttempts:number;
 emailSubject:string;emailTemplate:string;channels:Record<'whatsapp'|'sms',RecoveryChannelAction>;
};
export const defaultRecoveryMessage='Your MetaDrive password recovery code is {!Verification.Value}. Expires in {!Verification.ExpiryMinutes} minutes.';
export const defaultRecoverySubject='MetaDrive password recovery';
export const defaultRecoveryFlow:RecoveryFlowConfig={
 method:'OTP',otpLength:6,expiryMinutes:10,maxAttempts:5,
 emailSubject:defaultRecoverySubject,emailTemplate:defaultRecoveryMessage,
 channels:{
  whatsapp:{channel:'whatsapp',enabled:false,flowServiceUserId:null,credentialId:null,
   calloutPath:'',calloutBody:'',messageTemplate:defaultRecoveryMessage},
  sms:{channel:'sms',enabled:false,flowServiceUserId:null,credentialId:null,
   calloutPath:'',calloutBody:'',messageTemplate:defaultRecoveryMessage}
 }
};
type FlowRow={method:RecoveryMethod;otp_length:4|6;otp_expiry_minutes:number;max_otp_attempts:number;
 email_subject:string;email_template:string};
type ActionRow={channel:'sms'|'whatsapp';enabled:boolean;flow_service_user_id:string|null;
 credential_id:string|null;callout_path:string;callout_body:string;message_template:string;
 credential_enabled:boolean|null;credential_protocol:string|null;service_user_enabled:boolean|null};
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function recoveryActionReady(action:RecoveryChannelAction):boolean{
 return action.enabled&&!!action.credentialId&&!!action.flowServiceUserId
  &&!!action.calloutPath.trim()&&!!action.calloutBody.trim();
}
export function renderRecoveryText(template:string,code:string,minutes:number,tenantName:string):string{
 return template.replaceAll('{!Verification.Value}',code)
  .replaceAll('{!Verification.ExpiryMinutes}',String(minutes))
  .replaceAll('{!Tenant.Name}',tenantName);
}
export async function readRecoveryFlow(db:SqlExecutor,tenantId:string):Promise<RecoveryFlowConfig>{
 const [{rows},{rows:actions}]=await Promise.all([
  db.query<FlowRow>(`SELECT method,otp_length,otp_expiry_minutes,max_otp_attempts,
   email_subject,email_template FROM md_password_recovery_flow WHERE tenant_id=$1`,[tenantId]),
  db.query<ActionRow>(`SELECT a.channel,a.enabled,a.flow_service_user_id,a.credential_id,
   a.callout_path,a.callout_body,a.message_template,
   c.enabled AS credential_enabled,c.protocol AS credential_protocol,u.enabled AS service_user_enabled
   FROM md_password_recovery_channel_actions a
   LEFT JOIN md_named_credentials c ON c.tenant_id=a.tenant_id AND c.id=a.credential_id
   LEFT JOIN md_users u ON u.tenant_id=a.tenant_id AND u.id=a.flow_service_user_id
   WHERE a.tenant_id=$1`,[tenantId])
 ]);
 const row=rows[0];
 const config:RecoveryFlowConfig={...defaultRecoveryFlow,
  method:row?.method??'OTP',otpLength:row?.otp_length??6,
  expiryMinutes:row?.otp_expiry_minutes??10,maxAttempts:row?.max_otp_attempts??5,
  emailSubject:row?.email_subject??defaultRecoverySubject,
  emailTemplate:row?.email_template??defaultRecoveryMessage,
  channels:{whatsapp:{...defaultRecoveryFlow.channels.whatsapp},
   sms:{...defaultRecoveryFlow.channels.sms}}
 };
 for(const action of actions){
  if(action.channel!=='whatsapp'&&action.channel!=='sms')continue;
  config.channels[action.channel]={
   channel:action.channel,
   enabled:action.enabled&&action.credential_enabled===true
    &&action.credential_protocol==='HTTPS'&&action.service_user_enabled===true,
   flowServiceUserId:action.flow_service_user_id,credentialId:action.credential_id,
   calloutPath:action.callout_path,calloutBody:action.callout_body,
   messageTemplate:action.message_template
  };
 }
 return config;
}

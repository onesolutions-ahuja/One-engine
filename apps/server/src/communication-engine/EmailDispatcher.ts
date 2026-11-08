import {normalizeMessageRecipients,resolveMessageTemplate} from './MessageTemplateEngine.js';
export type EmailDispatchConfig={namedCredentialId?:unknown;fromEmail?:unknown;recipients?:unknown;subject?:unknown;body?:unknown};
/** Validates a Flow email before the existing tenant/RBAC-protected durable outbox queues it. */
export function prepareEmailDispatch(config:EmailDispatchConfig,resolve:(value:unknown)=>unknown){
 const credentialId=config.namedCredentialId;
 const from=resolveMessageTemplate(config.fromEmail,resolve).trim();
 const recipients=normalizeMessageRecipients(resolveMessageTemplate(config.recipients,resolve));
 const subject=resolveMessageTemplate(config.subject,resolve);
 const body=resolveMessageTemplate(config.body,resolve);
 const email=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
 if(typeof credentialId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialId)
 ||!email.test(from)||from.length>254||!recipients.length||recipients.length>100
 ||recipients.some(value=>value.length>254||!email.test(value))||!subject.trim()
 ||subject.length>300||/[\r\n]/.test(subject)||body.length>10000)
 throw new Error('Invalid Flow email configuration');
 return {credentialId,from,recipients,subject,body};
}

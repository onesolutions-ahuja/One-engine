import nodemailer from 'nodemailer';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const ociCompartment=/^ocid1\.(compartment|tenancy)\.oc1\.\.[a-z0-9]+$/;
const ociRegion=/^[a-z]{2,4}-[a-z]+-\d$/;
/** OCI Email Delivery HTTPS submission authenticated by the instance principal:
 * no SMTP username/password is stored anywhere. Non-secret settings only. */
export function isOciRecoveryMailConfigured(env:NodeJS.ProcessEnv=process.env){
 const from=(env.METADRIVE_PLATFORM_MAIL_FROM_EMAIL??env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL)?.trim()??'';
 return env.METADRIVE_PLATFORM_MAIL_TRANSPORT==='oci-https'
  &&ociCompartment.test(env.METADRIVE_OCI_MAIL_COMPARTMENT_OCID?.trim()??'')
  &&ociRegion.test((env.METADRIVE_OCI_REGION??'uk-london-1').trim())
  &&emailPattern.test(from)&&from.length<=254;
}
async function sendOciRecoveryEmail(to:string,subject:string,body:string,env:NodeJS.ProcessEnv){
 const from=(env.METADRIVE_PLATFORM_MAIL_FROM_EMAIL??env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL)!.trim();
 const region=(env.METADRIVE_OCI_REGION??'uk-london-1').trim();
 const cli=env.METADRIVE_OCI_CLI?.trim()||'/usr/local/bin/oci';
 const sender={senderAddress:{email:from,name:(env.METADRIVE_PLATFORM_MAIL_FROM_NAME??'UNE Solutions').slice(0,100)},
  compartmentId:env.METADRIVE_OCI_MAIL_COMPARTMENT_OCID!.trim()};
 // execFile passes arguments without a shell; values cannot inject commands.
 await run(cli,['email-data-plane','email-submitted-response','submit-email',
  '--auth','instance_principal','--region',region,
  '--sender',JSON.stringify(sender),'--recipients',JSON.stringify({to:[{email:to}]}),
  '--subject',subject,'--body-text',body],
  {timeout:30000,maxBuffer:1024*1024,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',
   OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING:'True',LANG:'C.UTF-8'}});
 return {from,endpoint:'oci-https://'+region};
}

const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const publicIp=(address:string)=>{
 if(isIP(address)===4){
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||
   a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&b>=18&&b<=19||
   a===192&&b===0||a===192&&b===88||a===198&&b===51||a===203&&b===0);
 }
 if(isIP(address)===6){
  const v=address.toLowerCase();
  return !(/^(::|fc|fd|fe8|fe9|fea|feb)/.test(v)||v.includes(':ffff:'));
 }
 return false;
};

export function isPlatformRecoveryMailConfigured(env:NodeJS.ProcessEnv=process.env){
 return isOciRecoveryMailConfigured(env)||isPlatformSmtpConfigured(env);
}
function isPlatformSmtpConfigured(env:NodeJS.ProcessEnv=process.env){
 const port=Number(env.METADRIVE_PLATFORM_SMTP_PORT??587);
 const host=env.METADRIVE_PLATFORM_SMTP_HOST?.trim()??'';
 const from=env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL?.trim()??'';
 return Boolean(host&&host!=='localhost'&&!host.endsWith('.local')
  &&!isIP(host)&&!/[\s/@?#]/.test(host)
  &&env.METADRIVE_PLATFORM_SMTP_USERNAME?.trim()
  &&env.METADRIVE_PLATFORM_SMTP_PASSWORD
  &&emailPattern.test(from)&&from.length<=254
  &&[465,587].includes(port));
}

/** Uses only deployment-level secrets. Tenant Named Credentials are never consulted. */
export async function sendPlatformRecoveryEmail(to:string,subject:string,body:string,
 env:NodeJS.ProcessEnv=process.env):Promise<{from:string;endpoint:string}>{
 if(!emailPattern.test(to)||to.length>254||/[\r\n]/.test(subject)||subject.length>300||body.length>10000)
  throw new Error('Invalid recovery email');
 if(isOciRecoveryMailConfigured(env))return sendOciRecoveryEmail(to,subject,body,env);
 const host=env.METADRIVE_PLATFORM_SMTP_HOST?.trim();
 const port=Number(env.METADRIVE_PLATFORM_SMTP_PORT??587);
 const username=env.METADRIVE_PLATFORM_SMTP_USERNAME?.trim();
 const password=env.METADRIVE_PLATFORM_SMTP_PASSWORD;
 const from=env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL?.trim();
 if(!isPlatformSmtpConfigured(env)||!host||!username||!password||!from)
  throw new Error('Platform recovery mail is not configured');
 if(!emailPattern.test(to)||!emailPattern.test(from)||to.length>254||from.length>254||
  /[\r\n]/.test(subject)||subject.length>300||body.length>10000)
  throw new Error('Invalid recovery email');
 if(isIP(host)||host==='localhost'||host.endsWith('.local')||/[\s/@?#]/.test(host))
  throw new Error('Invalid platform SMTP host');
 const addresses=await lookup(host,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(address=>!publicIp(address.address)))
  throw new Error('Platform SMTP destination resolves to a restricted network');
 const address=addresses[0];
 const transport=nodemailer.createTransport({
  host:address.address,port,secure:port===465,requireTLS:port===587,
  auth:{user:username,pass:password},
  tls:{servername:host,rejectUnauthorized:true,minVersion:'TLSv1.2'},
  connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000,pool:false
 });
 try{
  await transport.sendMail({from,to,subject,text:body});
 }finally{transport.close();}
 return {from,endpoint:'smtp://'+host+':'+port};
}

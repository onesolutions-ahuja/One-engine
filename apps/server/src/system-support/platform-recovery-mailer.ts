import nodemailer from 'nodemailer';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

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
 const host=env.METADRIVE_PLATFORM_SMTP_HOST?.trim();
 const port=Number(env.METADRIVE_PLATFORM_SMTP_PORT??587);
 const username=env.METADRIVE_PLATFORM_SMTP_USERNAME?.trim();
 const password=env.METADRIVE_PLATFORM_SMTP_PASSWORD;
 const from=env.METADRIVE_PLATFORM_SMTP_FROM_EMAIL?.trim();
 if(!isPlatformRecoveryMailConfigured(env)||!host||!username||!password||!from)
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

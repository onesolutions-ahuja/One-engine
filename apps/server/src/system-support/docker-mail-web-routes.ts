import type {Express,Request,Response} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {IntegrationActivityWriter} from './integration-api-log.js';
import {recordMailboxCommunication,defaultMailCommunicationRecording} from './mail-communication-recording.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import type {MailAdminAccess} from './mail-admin-access.js';

const base=dirname(fileURLToPath(import.meta.url));
const packaged=resolve(base,'../scripts/mail-protocol.py');
const script=existsSync(packaged)?packaged:resolve(base,'../../scripts/mail-protocol.py');
const maxBody=32*1024*1024;
const actions=new Set(['login','folders','messages','message','mark_read','send','draft']);
const failures=new Map<string,{count:number;until:number}>();
function getCredentials(req:Request){
 const header=req.get('authorization')??'';
 if(!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(header)||header.length>8192)return null;
 const decoded=Buffer.from(header.slice(6),'base64').toString('utf8'),index=decoded.indexOf(':');
 if(index<1)return null;
 const username=decoded.slice(0,index),password=decoded.slice(index+1);
 return username&&password?{username,password}:null;
}
function execute(body:Record<string,unknown>):Promise<Record<string,unknown>>{
 return new Promise((resolveResult,reject)=>{
  const process=spawn('python3',[script],{stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin'},timeout:45000});
  let output='',settled=false;
  const fail=(err:Error)=>{if(!settled){settled=true;reject(err);}};
  process.on('error',fail);
  process.stdout.setEncoding('utf8');
  process.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>maxBody){process.kill();fail(new Error('Mail response too large'));}});
  process.on('close',code=>{
   if(settled)return;
   if(code!==0){fail(new Error('Mail worker exited'));return;}
   try{settled=true;resolveResult(JSON.parse(output) as Record<string,unknown>);}
   catch{fail(new Error('Invalid mail worker response'));}
  });
  process.stdin.on('error',()=>{});
  process.stdin.end(JSON.stringify(body));
 });
}
type MailRunner=(body:Record<string,unknown>)=>Promise<Record<string,unknown>>;
export function registerDockerMailWebRoutes(app:Express,db?:Pick<SqlPersistence,'query'>,
 activityWriter?:IntegrationActivityWriter,runMail:MailRunner=execute,getAdminAccess?:()=>MailAdminAccess|undefined){
 const allowed=(process.env.METADRIVE_MAIL_WEB_ORIGINS??'https://unesolutions.co.uk').split(',').map(x=>x.trim());
 app.use('/api/mail-client',async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','private, no-store');
  const origin=req.get('origin');
  if(origin){
   if(!allowed.includes(origin)){res.status(403).json({error:'Origin not allowed'});return;}
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  }
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
   res.status(204).end();return;
  }
  if(req.method!=='POST'||!['/','/admin/redeem','/admin/revoke'].includes(req.path)){res.status(404).json({error:'Unknown mail endpoint'});return;}
  const ip=req.ip??'unknown',prior=failures.get(ip),now=Date.now();
  if(prior&&prior.until>now&&prior.count>=8){res.status(429).json({error:'Too many failed attempts'});return;}
  const authorization=req.get('authorization')??'';
  const adminToken=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  const credentials=getCredentials(req);
  if(req.path==='/'&&!credentials&&!adminToken){res.status(401).json({error:'Mailbox credentials required'});return;}
  if(Number(req.get('content-length')??0)>maxBody){res.status(413).json({error:'Request too large'});return;}
  const chunks:Buffer[]=[];let size=0;
  try{
   for await(const piece of req){const bytes=Buffer.from(piece as Uint8Array);size+=bytes.length;if(size>maxBody){res.status(413).json({error:'Request too large'});return;}chunks.push(bytes);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;
   if(!body||typeof body!=='object'||Array.isArray(body)){res.status(400).json({error:'Invalid request'});return;}
   const access=getAdminAccess?.();
   if(req.path==='/admin/redeem'){
    if(!access){res.status(503).json({error:'Admin mailbox access unavailable'});return;}
    const redeemed=await access.redeem(body.ticket);
    if(!redeemed){res.status(401).json({error:'Invalid or expired mailbox access ticket'});return;}
    res.json(redeemed);return;
   }
   if(req.path==='/admin/revoke'){
    if(!access||!adminToken){res.status(401).json({error:'Admin session required'});return;}
    await access.revoke(adminToken);res.status(204).end();return;
   }
   if(!actions.has(String(body.action))){res.status(400).json({error:'Invalid operation'});return;}
   const {action,folder,uid,to,subject,body:messageBody,attachments}=body;
   let login: {username:string;password:string};
   if(adminToken){
    if(!access){res.status(503).json({error:'Admin mailbox access unavailable'});return;}
    try{login=await access.authorize(adminToken,String(action));}
    catch(error){res.status(error instanceof Error&&error.message==='Admin mailbox access is read-only'?403:401)
     .json({error:error instanceof Error?error.message:'Admin session denied'});return;}
   }else{login=credentials!;}
   const result=await runMail({...login,action,folder,uid,to,subject,body:messageBody,attachments});
   // Record only actions authenticated by the actual IMAP mailbox. Logging
   // failures never change the SMTP result or expose mail credentials.
   try{
    const logger=db&&activityWriter?{db,writer:activityWriter}:defaultMailCommunicationRecording();
    if(logger&&!adminToken)await recordMailboxCommunication(logger.db,logger.writer,credentials!.username,action,
     {folder,uid,to,subject,body:messageBody},result);
   }catch{
    console.warn('Mail Communication logging failed');
   }
   if(result.ok!==true){
    if(result.mailAuthenticated!==true)
     failures.set(ip,{count:prior&&prior.until>now?prior.count+1:1,until:now+15*60_000});
    res.status(result.mailAuthenticated===true?502:401)
     .json({error:typeof result.error==='string'?result.error:'Mailbox request failed'});return;
   }
   failures.delete(ip);res.json(result.result);
  }catch{res.status(502).json({error:'Mail service unavailable'});}
 });
}

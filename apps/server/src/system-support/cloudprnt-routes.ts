import {createHash} from 'node:crypto';
import express from 'express';
import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {FlowRecordQuery} from '../system-files/flow-record-query.js';

/**
 * Network receipt printers with Star CloudPRNT. No helper app: the printer itself polls
 * https://<site>/api/cloudprnt/<device key> (the key is the Named Device's Device ID), collects
 * the next job and confirms it. DEVICE("Receipt Printer","Print",text) queues text jobs here,
 * and PRINT(template,...) queues the rendered Print Template as a PNG image.
 * Only a hash of the key is stored; jobs expire after a day.
 */
export const DEVICE_JOB_DDL=`
CREATE TABLE IF NOT EXISTS md_device_print_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 key_hash text NOT NULL,
 content text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','done','failed')),
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_device_print_jobs_key ON md_device_print_jobs(key_hash,status,created_at);
ALTER TABLE md_device_print_jobs ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'text/plain';`;
/** Print Template receipts are queued as PNG images (base64 in content). */
const MEDIA_TYPES=['text/plain','image/png'];
const MAX_IMAGE_BASE64=1_500_000;
const KEY=/^[A-Za-z0-9_-]{24,64}$/;
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');

export function registerCloudPrntPublicRoutes(app:Express,db:SqlPersistence){
 const route=(fn:(req:Request,res:Response)=>Promise<void>)=>
  (req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 const next=async(key:string)=>{
  const {rows}=await db.query<{id:string;content:string;media_type:string}>(`
   SELECT id,content,media_type FROM md_device_print_jobs
   WHERE key_hash=$1 AND status IN ('queued','sent') AND created_at>now()-interval '1 day'
   ORDER BY created_at LIMIT 1`,[hash(key)]);
  return rows[0];
 };
 // Printer poll: tells the printer whether a job is waiting.
 app.post('/api/cloudprnt/:key',express.text({type:'*/*',limit:'64kb'}),route(async(req,res)=>{
  const key=req.params.key;
  if(!KEY.test(key)){res.status(404).end();return;}
  const job=await next(key);
  res.json(job?{jobReady:true,mediaTypes:[MEDIA_TYPES.includes(job.media_type)?job.media_type:'text/plain'],jobToken:job.id}:{jobReady:false});
 }));
 // Printer fetch: the job content.
 app.get('/api/cloudprnt/:key',route(async(req,res)=>{
  const key=req.params.key;
  if(!KEY.test(key)){res.status(404).end();return;}
  const job=await next(key);
  if(!job){res.status(404).end();return;}
  await db.query(`UPDATE md_device_print_jobs SET status='sent',updated_at=now() WHERE id=$1`,[job.id]);
  if(job.media_type==='image/png')res.type('image/png').send(Buffer.from(job.content,'base64'));
  else res.type('text/plain; charset=utf-8').send(job.content);
 }));
 // Printer confirm: code 2xx = printed, anything else = failed.
 app.delete('/api/cloudprnt/:key',route(async(req,res)=>{
  const key=req.params.key;
  if(!KEY.test(key)){res.status(404).end();return;}
  const code=String(req.query.code??'200');
  const token=typeof req.query.token==='string'&&/^[0-9a-f-]{36}$/i.test(req.query.token)?req.query.token:null;
  await db.query(`
   UPDATE md_device_print_jobs SET status=$2,updated_at=now()
   WHERE id=(SELECT id FROM md_device_print_jobs WHERE key_hash=$1 AND status='sent'
    AND ($3::uuid IS NULL OR id=$3::uuid) ORDER BY created_at LIMIT 1)`,
   [hash(key),/^2/.test(code)?'done':'failed',token]);
  await db.query(`DELETE FROM md_device_print_jobs WHERE created_at<now()-interval '1 day'`);
  res.status(200).end();
 }));
}

/** Queue a job for a Network Named Device the user can read (normal Record permissions). */
export async function queueDeviceJob(db:SqlPersistence,query:FlowRecordQuery,
 tenantId:string,userId:string,body:unknown){
 const input=body&&typeof body==='object'?body as Record<string,unknown>:{};
 const key=input.key,command=String(input.command??'').toUpperCase();
 const text=typeof input.text==='string'?input.text:'';
 const image=typeof input.image==='string'?input.image:'';
 if(image&&(command!=='PRINT'||image.length>MAX_IMAGE_BASE64||!/^[A-Za-z0-9+/]+={0,2}$/.test(image)||
   !Buffer.from(image.slice(0,12),'base64').subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))))
  throw Error('Receipt image must be a PNG under 1 MB');
 if(typeof key!=='string'||!KEY.test(key))throw Error('This network device has no CloudPRNT key. Create one in Setup → Named Devices.');
 if(!['PRINT','OPEN','CUT'].includes(command))throw Error('DEVICE command must be Print, Open or Cut');
 if(text.length>20000)throw Error('DEVICE text is limited to 20,000 characters');
 const devices=await query.find(tenantId,userId,'NamedDevice',[
  {field:'DeviceId',operator:'Equals',value:key},{field:'Active',operator:'Equals',value:true}],undefined,{limit:1});
 if(!devices.length)throw Error('Network device not found or inactive');
 // CloudPRNT plain-text jobs print and cut; drawer kicks follow the printer's drawer setting.
 await db.query(`INSERT INTO md_device_print_jobs(tenant_id,key_hash,content,created_by) VALUES($1,$2,$3,$4)`,
  [tenantId,hash(key),command==='PRINT'?text+'\n\n':'\n',userId]);
 return {queued:true};
}

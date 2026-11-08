import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {ScheduledActionService} from './scheduled-action-service.js';
import {BackendPrintTemplatePdfService} from './backend-print-template-pdf-service.js';
import type {RecordEngine} from '../system-files/record-engine.js';

type Actor={tenant_id:string;user_id:string};
type Req=Request<Record<string,string>>&{actor?:Actor};
const wrap=(fn:(req:Req,res:Response)=>Promise<void>)=>
 (req:Request,res:Response,next:NextFunction)=>{void fn(req as Req,res).catch(next);};

/** ScheduledAction is a tenant-scoped system object: owners can view or close
 * their own pending jobs; tenant administrators can manage all jobs. */
export function registerScheduledActionRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,records:RecordEngine){
 const actions=new ScheduledActionService(db);
 const pdf=new BackendPrintTemplatePdfService(db,rbac,records);
 const actor=(req:Req)=>{
  if(!req.actor?.tenant_id||!req.actor.user_id)throw Error('Authentication required');
  return req.actor;
 };
 const manager=async(user:Actor)=>
  rbac.allowed(user.tenant_id,user.user_id,'Tenant','manage');
 const noStore=(res:Response)=>res.setHeader('Cache-Control','private, no-store');

 app.post('/api/action-formulas/create-pdf',wrap(async(req,res)=>{
  const user=actor(req),body=req.body??{};
  if(typeof body.template!=='string'||typeof body.recordId!=='string')
   throw Error('Template API name and record ID are required');
  noStore(res);
  res.status(201).json(await pdf.create(user.tenant_id,user.user_id,body.template,body.recordId));
 }));
 app.post('/api/action-formulas/schedule',wrap(async(req,res)=>{
  const user=actor(req),data=req.body??{};
  const scheduled=await actions.schedule(user.tenant_id,user.user_id,{
   formula:data.formula,nextStep:data.nextStep,seconds:data.seconds,
   scope:data.scope,variables:data.variables,sessionId:data.sessionId
  });
  noStore(res);res.status(201).json({scheduledAction:scheduled});
 }));
 app.get('/api/scheduled-actions',wrap(async(req,res)=>{
  const user=actor(req);
  noStore(res);res.json({records:await actions.list(user.tenant_id,user.user_id,await manager(user))});
 }));
 app.get('/api/scheduled-actions/:id/history',wrap(async(req,res)=>{
  const user=actor(req);
  noStore(res);res.json({history:await actions.history(user.tenant_id,user.user_id,
   req.params.id,await manager(user))});
 }));
 app.post('/api/scheduled-actions/:id/cancel',wrap(async(req,res)=>{
  const user=actor(req);
  noStore(res);res.json({record:await actions.close(user.tenant_id,user.user_id,
   req.params.id,'Cancelled',await manager(user))});
 }));
 app.post('/api/scheduled-actions/:id/complete',wrap(async(req,res)=>{
  const user=actor(req);
  noStore(res);res.json({record:await actions.close(user.tenant_id,user.user_id,
   req.params.id,'ManuallyCompleted',await manager(user))});
 }));
}

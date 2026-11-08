import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {RecordCollaborationService} from './record-collaboration-service.js';
import type {NamedCredentialService} from './named-credential-service.js';
import {requireActionComponent,publishedActionComponent,
  type QuickActionComponentBinding} from './quick-action-component.js';

const objectName=/^[A-Za-z][A-Za-z0-9_]*$/;
const actionName=/^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Actor={tenant_id:string;user_id:string};
type ActionRow={behavior:string;field_api:string|null;value_text:string|null;
 target_object_api:string|null;relationship_field_api:string|null;flow_api_name:string|null;
 credential_id:string|null;from_email:string|null};

/** One server-side entrypoint for metadata-configured object quick actions. */
export class ObjectQuickActionRuntime {
 constructor(
  private readonly db:SqlPersistence,
  private readonly rbac:RbacEngine,
  private readonly records:RecordEngine,
  private readonly collaboration:RecordCollaborationService,
  private readonly flows:FlowRuntime,
  private readonly namedCredentials?:NamedCredentialService
 ){}

 /** The browser only receives action identifiers it can currently execute. */
 async available(actor:Actor,objectApi:string,recordId:string){
  if(!objectName.test(objectApi)||!uuid.test(recordId))throw new Error('Invalid record request');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,objectApi,'read');
  await this.rbac.requireRecord(tenant,user,objectApi,recordId,'read');
  const {rows}=await this.db.query<{action_id:string;behavior:string;flow_api_name:string|null;
    field_api:string|null;target_object_api:string|null;relationship_field_api:string|null;
    component_api_name:string|null}>(`
   SELECT action_id,behavior,flow_api_name,field_api,target_object_api,relationship_field_api,component_api_name FROM md_object_actions
   WHERE tenant_id=$1 AND object_api=$2 AND action_type='Custom' AND enabled=true
   ORDER BY sort_order,action_id`,[tenant,objectApi]);
  const granted=await this.rbac.allowedMany(tenant,user,rows.map(row=>({
   resource:'Action:'+objectApi+'.'+row.action_id,action:'execute'})));
  const ids:string[]=[];
  let canEditRecord:boolean|undefined;
  for(const [index,action] of rows.entries()){
   if(!granted[index])continue;
   if(action.behavior==='Send Email'&&(!action.flow_api_name
     ||!await this.rbac.allowed(tenant,user,'Email','send')
     ||!await this.rbac.allowed(tenant,user,'Flow:'+action.flow_api_name,'execute')))continue;
   if(action.behavior==='Run Flow'&&(!action.flow_api_name
     ||!await this.rbac.allowed(tenant,user,'Flow:'+action.flow_api_name,'execute')))continue;
   if(action.behavior==='Open Component'){
     if(!action.component_api_name)continue;
     try{await requireActionComponent(this.db,tenant,action.component_api_name);}
     catch{continue;}
   }
   if(action.behavior==='Set Field Value'||action.behavior==='Log Call'){
    if(canEditRecord===undefined){
     canEditRecord=await this.rbac.allowed(tenant,user,objectApi,'edit');
     if(canEditRecord)try {
      await this.rbac.requireRecord(tenant,user,objectApi,recordId,'edit');
     }catch{canEditRecord=false;}
    }
    if(!canEditRecord)continue;
    if(action.behavior==='Set Field Value'&&(!action.field_api
      ||!await this.rbac.allowed(tenant,user,objectApi+'.'+action.field_api,'edit')))continue;
   }
   if(action.behavior==='Create Related'&&(!action.target_object_api||!action.relationship_field_api
      ||!await this.rbac.allowed(tenant,user,action.target_object_api,'create')
      ||!await this.rbac.allowed(tenant,user,
        action.target_object_api+'.'+action.relationship_field_api,'create')))continue;
   ids.push(action.action_id);
  }
  return {actionIds:ids};
 }

 async authorizeFlow(actor:Actor,objectApi:string,recordId:string,actionId:string){
  if(!objectName.test(objectApi)||!uuid.test(recordId)||!actionName.test(actionId))
   throw new Error('Invalid action request');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,objectApi,'read');
  await this.rbac.requireRecord(tenant,user,objectApi,recordId,'read');
  await this.rbac.require(tenant,user,'Action:'+objectApi+'.'+actionId,'execute');
  const {rows}=await this.db.query<{flow_api_name:string}>(`SELECT flow_api_name
   FROM md_object_actions WHERE tenant_id=$1 AND object_api=$2 AND action_id=$3
    AND action_type='Custom' AND enabled=true AND behavior='Run Flow'`,
   [tenant,objectApi,actionId]);
  const flowApiName=rows[0]?.flow_api_name;
  if(!flowApiName)throw new Error('Quick action Flow is unavailable');
  await this.rbac.require(tenant,user,'Flow:'+flowApiName,'execute');
  return {flowApiName,inputs:{recordId,objectApiName:objectApi}};
 }

 /** Resolve configured values only after authorizing the Action and permitted record Fields. */
 private async componentInputs(actor:Actor,raw:QuickActionComponentBinding[],
  context?:{recordId:string;objectApiName:string}):Promise<Record<string,unknown>>{
   if(!Array.isArray(raw)||raw.length>20)throw Error('Invalid component action bindings');
   const inputs:Record<string,unknown>=context?{recordId:context.recordId,objectApiName:context.objectApiName}:{};
   let record:Record<string,unknown>|undefined;
   for(const item of raw){
     if(!item||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.property)
       ||['__proto__','prototype','constructor','recordId','objectApiName','onClose',
         'onLaunchFlow','actionContext'].includes(item.property)
       ||Object.hasOwn(inputs,item.property))throw Error('Invalid component input');
     if(item.source==='Literal'){
       if(typeof item.value!=='string'||item.value.length>1000)throw Error('Invalid literal input');
       inputs[item.property]=item.value;
     }else{
       if(!context)throw Error('Record bindings require a record action');
       if(item.source==='Record ID')inputs[item.property]=context.recordId;
       else if(item.source==='Object API')inputs[item.property]=context.objectApiName;
       else if(item.source==='Record Field'){
         if(!item.fieldApiName||!/^[A-Za-z][A-Za-z0-9_]*$/.test(item.fieldApiName))
           throw Error('Invalid record Field binding');
         await this.rbac.require(actor.tenant_id,actor.user_id,
           context.objectApiName+'.'+item.fieldApiName,'read');
         if(!record)record=await this.records.get(actor.tenant_id,actor.user_id,
           context.objectApiName,context.recordId);
         inputs[item.property]=Object.hasOwn(record,item.fieldApiName)
           ?record[item.fieldApiName]:null;
       }else throw Error('Invalid component input source');
     }
   }
   return inputs;
 }

 /** Server-authorized object action component launch; grants no arbitrary Component access. */
 async authorizeComponent(actor:Actor,objectApi:string,recordId:string,actionId:string){
  if(!objectName.test(objectApi)||!uuid.test(recordId)||!actionName.test(actionId))
    throw new Error('Invalid component action request');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,objectApi,'read');
  await this.rbac.requireRecord(tenant,user,objectApi,recordId,'read');
  await this.rbac.require(tenant,user,'Action:'+objectApi+'.'+actionId,'execute');
  const {rows}=await this.db.query<{component_api_name:string;presentation:'Modal'|'Side Panel';
    component_bindings:QuickActionComponentBinding[]}>(`
   SELECT component_api_name,presentation,component_bindings FROM md_object_actions
   WHERE tenant_id=$1 AND object_api=$2 AND action_id=$3 AND action_type='Custom'
     AND enabled=true AND behavior='Open Component'`,[tenant,objectApi,actionId]);
  const selected=rows[0];
  if(!selected?.component_api_name)throw new Error('Component Quick Action is unavailable');
  await requireActionComponent(this.db,tenant,selected.component_api_name);
  return {componentApiName:selected.component_api_name,presentation:selected.presentation,
   definition:await publishedActionComponent(this.db,tenant,selected.component_api_name),
   inputs:await this.componentInputs(actor,selected.component_bindings??[],
     {recordId,objectApiName:objectApi})};
 }

 /** Global actions share the same runtime, SQL metadata and OneEngine checks. */
 async globalAvailable(actor:Actor){
  const tenant=actor.tenant_id,user=actor.user_id;
  const {rows}=await this.db.query<{
   action_id:string;label:string;behavior:string;target_object_api:string|null;
   flow_api_name:string|null;component_api_name:string|null
  }>(`SELECT action_id,label,behavior,target_object_api,flow_api_name,component_api_name
    FROM md_global_quick_actions WHERE tenant_id=$1 AND enabled=true
    ORDER BY sort_order,action_id`,[tenant]);
  const permitted=await this.rbac.allowedMany(tenant,user,rows.map(a=>({
   resource:'Action:Global.'+a.action_id,action:'execute'})));
  const actions=[];
  for(const [index,a] of rows.entries()){
   if(!permitted[index])continue;
   if(a.behavior==='Create Record'&&(!a.target_object_api
     ||!await this.rbac.allowed(tenant,user,a.target_object_api,'create')))continue;
   if(a.behavior==='Run Flow'&&(!a.flow_api_name
     ||!await this.rbac.allowed(tenant,user,'Flow:'+a.flow_api_name,'execute')))continue;
   if(a.behavior==='Open Component'){
     if(!a.component_api_name)continue;
     try{await requireActionComponent(this.db,tenant,a.component_api_name);}
     catch{continue;}
   }
   if(a.behavior==='Send Email'&&(!a.flow_api_name
     ||!await this.rbac.allowed(tenant,user,'Email','send')
     ||!await this.rbac.allowed(tenant,user,'Flow:'+a.flow_api_name,'execute')))continue;
   actions.push({id:a.action_id,label:a.label,behavior:a.behavior,
     ...(a.target_object_api?{targetObjectApi:a.target_object_api}:{})});
  }
  return {actions};
 }

 async authorizeGlobalFlow(actor:Actor,actionId:string){
  if(!actionName.test(actionId))throw new Error('Invalid global action');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,'Action:Global.'+actionId,'execute');
  const {rows}=await this.db.query<{flow_api_name:string}>(`
   SELECT flow_api_name FROM md_global_quick_actions
   WHERE tenant_id=$1 AND action_id=$2 AND behavior='Run Flow' AND enabled=true`,
   [tenant,actionId]);
  const flowApiName=rows[0]?.flow_api_name;
  if(!flowApiName)throw new Error('Global Flow action is unavailable');
  await this.rbac.require(tenant,user,'Flow:'+flowApiName,'execute');
  return {flowApiName,inputs:{}};
 }

 async authorizeGlobalComponent(actor:Actor,actionId:string){
  if(!actionName.test(actionId))throw new Error('Invalid global component action');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,'Action:Global.'+actionId,'execute');
  const {rows}=await this.db.query<{component_api_name:string;presentation:'Modal'|'Side Panel';
    component_bindings:QuickActionComponentBinding[]}>(`
    SELECT component_api_name,presentation,component_bindings FROM md_global_quick_actions
    WHERE tenant_id=$1 AND action_id=$2 AND enabled=true AND behavior='Open Component'`,
    [tenant,actionId]);
  const selected=rows[0];
  if(!selected?.component_api_name)throw new Error('Global Component Quick Action is unavailable');
  await requireActionComponent(this.db,tenant,selected.component_api_name);
  return {componentApiName:selected.component_api_name,presentation:selected.presentation,
    definition:await publishedActionComponent(this.db,tenant,selected.component_api_name),
    inputs:await this.componentInputs(actor,selected.component_bindings??[])};
 }

 async executeGlobal(actor:Actor,actionId:string,input:unknown){
  if(!actionName.test(actionId)||!input||typeof input!=='object'||Array.isArray(input))
   throw new Error('Invalid global action request');
  const values=input as Record<string,unknown>;
  if(Object.keys(values).length>100)throw new Error('Invalid global action input');
  const tenant=actor.tenant_id,user=actor.user_id;
  await this.rbac.require(tenant,user,'Action:Global.'+actionId,'execute');
  const {rows}=await this.db.query<{
   behavior:string;target_object_api:string|null;flow_api_name:string|null;
   credential_id:string|null;from_email:string|null
  }>(`SELECT behavior,target_object_api,flow_api_name,credential_id,from_email
    FROM md_global_quick_actions WHERE tenant_id=$1 AND action_id=$2 AND enabled=true`,
   [tenant,actionId]);
  const action=rows[0];
  if(!action)throw new Error('Global action is unavailable');
  if(action.behavior==='Create Record'){
   if(!action.target_object_api||!objectName.test(action.target_object_api))
    throw new Error('Global target Object is unavailable');
   const id=await this.records.create(tenant,user,action.target_object_api,values);
   return {status:'completed',recordId:id,objectApiName:action.target_object_api};
  }
  if(action.behavior==='Run Flow'){
   if(!action.flow_api_name||!objectName.test(action.flow_api_name)
     ||Object.keys(values).length)throw new Error('Invalid global Flow action request');
   return {status:'started',result:await this.flows.execute(tenant,action.flow_api_name,user,{})};
  }
  if(action.behavior==='Send Email'){
   if(!action.flow_api_name)throw new Error('Email HTTP Callout Flow is unavailable');
   await this.rbac.require(tenant,user,'Email','send');
   await this.rbac.require(tenant,user,'Flow:'+action.flow_api_name,'execute');
   if(Object.keys(values).some(key=>!['to','subject','body'].includes(key))
     ||typeof values.to!=='string'||typeof values.subject!=='string'
     ||typeof values.body!=='string')throw new Error('Invalid global email input');
   return {status:'started',result:await this.flows.execute(tenant,action.flow_api_name,user,{
     to:values.to,subject:values.subject,body:values.body})};
  }
  throw new Error('Unsupported global action');
 }

 async execute(actor:Actor,objectApi:string,recordId:string,actionId:string,input:unknown){
  if(!objectName.test(objectApi)||!actionName.test(actionId)||!uuid.test(recordId))
   throw new Error('Invalid quick action request');
  if(input===null||typeof input!=='object'||Array.isArray(input))
   throw new Error('Invalid quick action input');
  const values=input as Record<string,unknown>;
  if(Object.keys(values).length>100)throw new Error('Quick action input too large');
  const tenantId=actor.tenant_id,userId=actor.user_id;
  await this.rbac.require(tenantId,userId,objectApi,'read');
  await this.rbac.requireRecord(tenantId,userId,objectApi,recordId,'read');
  await this.rbac.require(tenantId,userId,'Action:'+objectApi+'.'+actionId,'execute');
  const {rows}=await this.db.query<ActionRow>(`
    SELECT behavior,field_api,value_text,target_object_api,relationship_field_api,flow_api_name,credential_id,from_email
    FROM md_object_actions WHERE tenant_id=$1 AND object_api=$2 AND action_id=$3
      AND enabled=true AND action_type='Custom'`,[tenantId,objectApi,actionId]);
  const action=rows[0];
  if(!action)throw new Error('Quick action is unavailable');
  if(action.behavior==='Set Field Value'){
   if(Object.keys(values).length)throw new Error('This action accepts no user input');
   if(!action.field_api||action.value_text===null)throw new Error('Quick action configuration is invalid');
   await this.records.update(tenantId,userId,objectApi,recordId,{[action.field_api]:action.value_text});
   return {status:'completed',recordId};
  }
  if(action.behavior==='Log Call'){
   const subject=values.subject??action.value_text??'Call';
   const description=values.description??'';
   if(Object.keys(values).some(key=>!['subject','description'].includes(key)))
    throw new Error('Invalid call input');
   const {activity}=await this.collaboration.addActivity(actor,objectApi,recordId,{
    kind:'Call',subject,description,status:'Completed'});
   return {status:'completed',activity};
  }
  if(action.behavior==='Create Related'){
   const childObject=action.target_object_api,relationshipField=action.relationship_field_api;
   if(!childObject||!relationshipField)throw new Error('Quick action relationship is not configured');
   if(!objectName.test(childObject)||!objectName.test(relationshipField)
      ||Object.hasOwn(values,relationshipField))
    throw new Error('Invalid related-record values');
   const relation=await this.db.query(`
     SELECT 1 FROM md_field_definitions
     WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND related_object=$4
       AND data_type='reference' AND deleted_at IS NULL`,
     [tenantId,childObject,relationshipField,objectApi]);
   if(!relation.rowCount)throw new Error('Configured relationship is no longer available');
   const id=await this.records.create(tenantId,userId,childObject,{
    ...values,[relationshipField]:recordId});
   return {status:'completed',recordId:id,objectApiName:childObject};
  }
  if(action.behavior==='Send Email'){
   if(!action.flow_api_name)throw new Error('Email HTTP Callout Flow is unavailable');
   await this.rbac.require(tenantId,userId,'Email','send');
   await this.rbac.require(tenantId,userId,'Flow:'+action.flow_api_name,'execute');
   if(Object.keys(values).some(key=>!['to','subject','body'].includes(key)))
     throw new Error('Invalid email action input');
   if(typeof values.to!=='string'||typeof values.subject!=='string'
     ||typeof values.body!=='string')throw new Error('Email recipient, subject and body required');
   const result=await this.flows.execute(tenantId,action.flow_api_name,userId,{
     recordId,objectApiName:objectApi,to:values.to,subject:values.subject,body:values.body});
   return {status:'started',result,recordId};
  }
  if(action.behavior==='Run Flow'){
   if(!action.flow_api_name||!objectName.test(action.flow_api_name))
    throw new Error('Quick action Flow is not configured');
   if(Object.keys(values).length)throw new Error('Flow action accepts no user input');
   const result=await this.flows.execute(tenantId,action.flow_api_name,userId,{
    recordId,objectApiName:objectApi});
   return {status:'started',result};
  }
  throw new Error('Unsupported quick action behavior');
 }
}

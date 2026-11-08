import {randomInt} from 'node:crypto';
import {executeCustomActionBridgeNode} from './nodes/CustomActionBridgeNode.js';
import {template,uuid,scalar,type ActionContext} from './nodes/ActionNodeShared.js';
import type {RbacEngine} from './rbac-engine.js';
import {
 createFormulaEvaluationContext,type FormulaEvaluationContext
} from './flow-formula-runtime.js';
import type {RecordEngine} from './record-engine.js';
import {executeQuickActionNode} from './nodes/QuickActionNode.js';
import {executePlatformEventPublishNode} from './nodes/PlatformEventPublishNode.js';
import {executeActionEmailNode} from './nodes/ActionEmailNode.js';
import type {SqlExecutor} from './sql-persistence.js';

export async function loadFlowUserResource(client:SqlExecutor,tenantId:string,userId:string,
 graph:unknown,variables:Record<string,unknown>,rbac?:RbacEngine):Promise<FormulaEvaluationContext> {
 if(typeof graph!=='string'||!(/\$User(?:\.(?:Name|Email|TimeZone|Locale|CurrencyIsoCode|ManagerId|AncestorIds|DescendantIds|DirectReportIds))?\b|\$Profile(?:\.|\b)|\$Organization(?:\.|\b)|\$Permission\.[A-Za-z][A-Za-z0-9_]*|\$Record(?:__Prior|__IsClone|Type)?(?:\.|\b)/.test(graph)
   ||/\b(?:TODAY|NOW|TIMENOW|DAY|MONTH|YEAR|HOUR|MINUTE|SECOND|WEEKDAY|ISOWEEK|ISOYEAR|DATEVALUE|DATETIMEVALUE|TIMEVALUE|ADDDAYS|ADDMONTHS|TZOFFSET|CURRENCYRATE)\s*\(/i.test(graph)))
  return {};
 const now=new Date();
 const {rows}=await client.query<{
  id:string;email:string;display_name:string;time_zone:string;locale:string;
  user_currency_iso_code:string|null;reports_to_user_id:string|null;profile_id:string|null;
  profile_name:string|null;profile_api:string|null;has_currency_settings:boolean;
  currency_iso_code:string|null;conversion_rate:string|null
 }>(`SELECT u.id,u.email,u.display_name,u.time_zone,u.locale,u.currency_iso_code AS user_currency_iso_code,
    u.reports_to_user_id,p.id AS profile_id,p.label AS profile_name,p.api_name AS profile_api,
    s.tenant_id IS NOT NULL AS has_currency_settings,
    currency.value->>'currencyIsoCode' AS currency_iso_code,
    currency.value->>'conversionRate' AS conversion_rate
   FROM md_users u
   LEFT JOIN md_user_profiles up ON up.tenant_id=u.tenant_id AND up.user_id=u.id
   LEFT JOIN md_profiles p ON p.tenant_id=up.tenant_id AND p.id=up.profile_id
   LEFT JOIN md_tenant_settings s ON s.tenant_id=u.tenant_id AND s.setting_key='currencies'
   LEFT JOIN LATERAL jsonb_array_elements(
    COALESCE(s.properties->'currencies','{"currencies":[]}'::jsonb)->'currencies'
   ) currency(value) ON true
   WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true`,[tenantId,userId]);
 const actor=rows[0];
 if(!actor)throw new Error('Flow execution user is no longer enabled in this tenant');
 const currencyRates:Record<string,number>={};
 if(!actor.has_currency_settings)currencyRates.USD=1;
 for(const row of rows){
  if(row.currency_iso_code&&row.conversion_rate!==null){
   const rate=Number(row.conversion_rate);
   if(!/^[A-Z]{3}$/.test(row.currency_iso_code)||!Number.isFinite(rate)||rate<=0)
    throw new Error('Invalid tenant currency rate configuration');
   currencyRates[row.currency_iso_code]=rate;
  }
 }
 const hierarchyNeeded=/\$User\.(?:AncestorIds|DescendantIds|DirectReportIds)\b/.test(graph);
 let ancestorIds:string[]=[],descendantIds:string[]=[],directReportIds:string[]=[];
 if(hierarchyNeeded){
  const ancestors=await client.query<{user_id:string;hierarchy_level:number}>(
    "SELECT user_id,hierarchy_level FROM md_reporting_users($1,$2,'ancestors') WHERE hierarchy_level>0 ORDER BY hierarchy_level",
    [tenantId,userId]);
  ancestorIds=ancestors.rows.map(row=>row.user_id);
  const descendants=await client.query<{user_id:string;hierarchy_level:number}>(
    "SELECT user_id,hierarchy_level FROM md_reporting_users($1,$2,'descendants') WHERE hierarchy_level>0 ORDER BY hierarchy_level",
    [tenantId,userId]);
  descendantIds=descendants.rows.map(row=>row.user_id);
  directReportIds=descendants.rows.filter(row=>row.hierarchy_level===1).map(row=>row.user_id);
 }
 const resource:Record<string,unknown>={Id:actor.id,Name:actor.display_name.trim()||actor.email,
  Email:actor.email,TimeZone:actor.time_zone,Locale:actor.locale,
  CurrencyIsoCode:actor.user_currency_iso_code};
 if(/\$User\.ManagerId\b/.test(graph))resource.ManagerId=actor.reports_to_user_id??null;
 if(/\$User\.AncestorIds\b/.test(graph))resource.AncestorIds=ancestorIds;
 if(/\$User\.DescendantIds\b/.test(graph))resource.DescendantIds=descendantIds;
 if(/\$User\.DirectReportIds\b/.test(graph))resource.DirectReportIds=directReportIds;
 variables.$User=resource;
 if(/\$Profile(?:\.|\b)/.test(graph))
  variables.$Profile={Id:actor.profile_id,Name:actor.profile_name,DeveloperName:actor.profile_api};
 let organization:FormulaEvaluationContext['organization'];
 if(/\$Organization(?:\.|\b)/.test(graph)){
  const {rows:organizations}=await client.query<{id:string;name:string}>(
   'SELECT id,name FROM md_tenants WHERE id=$1',[tenantId]);
  if(!organizations[0])throw new Error('Flow execution organization is unavailable');
  organization={Id:organizations[0].id,Name:organizations[0].name};
  variables.$Organization=organization;
 }
 const permissionNames=[...new Set([...graph.matchAll(/\$Permission\.([A-Za-z][A-Za-z0-9_]*)/g)]
  .map(match=>match[1]))];
 let permissionSnapshot:Record<string,boolean>|undefined;
 if(permissionNames.length){
  if(!rbac)throw new Error('Custom permission context is unavailable for this Flow');
  const decisions=await rbac.allowedMany(tenantId,userId,permissionNames.map(name=>({
   resource:'CustomPermission:'+name,action:'read'
  })));
  permissionSnapshot=Object.fromEntries(permissionNames.map((name,index)=>[name,decisions[index]]));
  variables.$Permission=permissionSnapshot;
 }
 const profile=/\$Profile(?:\.|\b)/.test(graph)
  ?{Id:actor.profile_id,Name:actor.profile_name,DeveloperName:actor.profile_api}:undefined;
 return createFormulaEvaluationContext({
  timeZone:actor.time_zone,locale:actor.locale,currencyIsoCode:actor.user_currency_iso_code,
  currencyRates,now,transactionStage:'flow',
  actor:{Id:actor.id,Name:actor.display_name.trim()||actor.email,Email:actor.email,
   TimeZone:actor.time_zone,Locale:actor.locale,CurrencyIsoCode:actor.user_currency_iso_code},
  ...(profile?{profile}:{}),...(organization?{organization}:{}),
  ...(permissionSnapshot?{permissionSnapshot}:{})
 });
}

async function sendCustomNotification(context:ActionContext) {
 const {client,rbac,tenantId,userId,flowApi,config,resolve}=context;
 await rbac.require(tenantId,userId,'Notification','send');
 const recipients=[...new Set(template(config.recipientIds,resolve)
  .split(/[;,\r\n]+/).map(value=>value.trim()).filter(Boolean))];
 const title=template(config.title,resolve),body=template(config.messageBody??'',resolve);
 if(!recipients.length||recipients.length>100||recipients.some(id=>!uuid.test(id))
   ||!title.trim()||title.length>120||body.length>2000)
  throw new Error('Invalid Custom Notification configuration');
 const {rowCount}=await client.query(`
  INSERT INTO md_notifications(tenant_id,recipient_id,title,body,flow_api_name,sent_by)
  SELECT $1,u.id,$3,$4,$5,$6 FROM md_users u
  WHERE u.tenant_id=$1 AND u.enabled=true AND u.id=ANY($2::uuid[])
 `,[tenantId,recipients,title,body,flowApi,userId]);
 if(rowCount!==recipients.length)
  throw new Error('Notification recipients must be enabled users in this tenant');
}

async function createTask(context:ActionContext) {
 const {client,rbac,tenantId,userId,config,resolve}=context;
 const objectApi=config.objectApiName,recordId=template(config.recordId,resolve);
 const subject=template(config.subject,resolve),description=template(config.description??'',resolve);
 const dueAtText=config.dueAt===undefined?'':template(config.dueAt,resolve);
 if(typeof objectApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
   ||!uuid.test(recordId)||!subject.trim()||subject.length>200||description.length>10000)
  throw new Error('Invalid Create Task configuration');
 let dueAt:string|null=null;
 if(dueAtText){
  const date=new Date(dueAtText);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(dueAtText)
    ||!Number.isFinite(date.getTime()))throw new Error('Create Task due date requires an ISO 8601 timezone');
  dueAt=date.toISOString();
 }
 await rbac.require(tenantId,userId,objectApi,'edit');
 await rbac.requireRecord(tenantId,userId,objectApi,recordId,'edit');
 await client.query(`INSERT INTO md_record_activities
  (tenant_id,object_api,record_id,created_by,kind,subject,description,status,due_at)
  VALUES($1,$2,$3,$4,'Task',$5,$6,'Open',$7)`,
 [tenantId,objectApi,recordId,userId,subject.trim(),description,dueAt]);
}

async function postToChatter(context:ActionContext) {
 const {client,rbac,tenantId,userId,config,resolve}=context;
 const objectApi=config.objectApiName,recordId=template(config.recordId,resolve);
 const message=template(config.message,resolve);
 if(typeof objectApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
   ||!uuid.test(recordId)||!message.trim()||message.length>10000)
  throw new Error('Invalid Post to Chatter configuration');
 await rbac.require(tenantId,userId,objectApi,'edit');
 await rbac.requireRecord(tenantId,userId,objectApi,recordId,'edit');
 await client.query(`INSERT INTO md_record_chatter_posts
  (tenant_id,object_api,record_id,created_by,body) VALUES($1,$2,$3,$4,$5)`,
 [tenantId,objectApi,recordId,userId,message.trim()]);
}

async function submitForApproval(context:ActionContext) {
 const {client,rbac,tenantId,userId,flowApi,config,resolve}=context;
 const objectApi=config.objectApiName,recordId=template(config.recordId,resolve);
 const processApi=typeof config.approvalProcessApiName==='string'
  ?config.approvalProcessApiName.trim():'';
 const comments=template(config.comments??'',resolve);
 if(typeof objectApi!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApi)
   ||!uuid.test(recordId)||comments.length>2000||processApi&&!/^[A-Za-z][A-Za-z0-9_]*$/.test(processApi))
  throw new Error('Invalid Submit for Approval configuration');
 let approvers:unknown;
 if(processApi){
  const {rows}=await client.query<{properties:unknown}>(`
   SELECT properties FROM md_system_definitions
   WHERE tenant_id=$1 AND kind='approval-processes' AND api_name=$2 AND enabled=true FOR SHARE
  `,[tenantId,processApi]);
  const properties=rows[0]?.properties;
  if(!properties||typeof properties!=='object'||Array.isArray(properties)
    ||(properties as Record<string,unknown>).active!==true
    ||(properties as Record<string,unknown>).objectApiName!==objectApi)
   throw new Error('Active approval process does not match the target Object');
  approvers=(properties as Record<string,unknown>).approverUserIds;
 }else{
  approvers=typeof config.approverIds==='string'
   ?config.approverIds.split(/[;,\r\n]+/).map(value=>value.trim()).filter(Boolean):[];
 }

 if(!Array.isArray(approvers)||!approvers.length||approvers.length>50
   ||approvers.some(value=>typeof value!=='string'||!uuid.test(value)))
  throw new Error('Approval submission requires 1 to 50 valid approvers');
 const approverIds=[...new Set(approvers as string[])];
 if(!approverIds.length||approverIds.length>50)
  throw new Error('Approval submission requires 1 to 50 distinct approvers');
 const {records}=context;
 if(!records)throw new Error('Flow Record Engine is not configured');
 await rbac.require(tenantId,userId,'ApprovalRequest','manage');
 await rbac.require(tenantId,userId,objectApi,'edit');
 await rbac.requireRecord(tenantId,userId,objectApi,recordId,'edit');
 const locked=await client.query(
  'SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 FOR UPDATE',
  [tenantId,objectApi,recordId]);
 if(!locked.rowCount)throw new Error('Approval target record not found');
 const record=await records.get(tenantId,userId,objectApi,recordId,client);
 const recordName=typeof record.Name==='string'&&record.Name.trim()
  ?record.Name.trim():recordId;
 const object=await client.query<{label:string}>(
  'SELECT label FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 FOR SHARE',[tenantId,objectApi]);
 if(!object.rows[0])throw new Error('Approval target Object not found');
 const activeUsers=await client.query<{id:string}>(
  'SELECT id FROM md_users WHERE tenant_id=$1 AND enabled=true AND id=ANY($2::uuid[]) FOR SHARE',
  [tenantId,approverIds]);
 if(activeUsers.rowCount!==approverIds.length)
  throw new Error('Approvers must be enabled users in this tenant');
 for(const approverId of approverIds){
  await rbac.require(tenantId,approverId,'ApprovalRequest','approve');
  await rbac.requireRecord(tenantId,approverId,objectApi,recordId,'read');
 }
 const pending=await client.query(
  `SELECT 1 FROM md_approval_requests WHERE tenant_id=$1 AND object_api=$2
   AND record_id=$3 AND status='Pending' LIMIT 1`,[tenantId,objectApi,recordId]);
 if(pending.rowCount)throw new Error('Record already has a pending approval request');
 const group=await client.query<{id:string}>('SELECT gen_random_uuid() AS id');
 const inserted=await client.query(`
  INSERT INTO md_approval_requests
   (tenant_id,group_id,object_api,object_label,record_id,record_name,flow_api_name,
    submitted_by,approver_id,comments)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,u.id,$9
  FROM md_users u WHERE u.tenant_id=$1 AND u.enabled=true AND u.id=ANY($10::uuid[])
 `,[tenantId,group.rows[0].id,objectApi,object.rows[0].label,recordId,recordName,
   flowApi,userId,comments,approverIds]);
 if(inserted.rowCount!==approverIds.length)
  throw new Error('Approval recipients changed during submission');
 return group.rows[0].id;
}

/** Orchestration stages reuse exactly the same tenant/RBAC/record approval checks. */
export async function submitFlowStageApproval(context:ActionContext):Promise<string> {
 return submitForApproval(context);
}

function generateFlowOtp(context:ActionContext,digits:4|6):void {
 const outputVariable=context.config.outputVariable;
 if(typeof outputVariable!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(outputVariable))
  throw new Error('Generate Random OTP requires a valid output variable name');
 // randomInt uses Node's cryptographically secure system RNG. Keep the OTP as
 // text so leading zeroes survive Flow assignment, templates and email delivery.
 context.variables[outputVariable]=randomInt(0,10**digits).toString().padStart(digits,'0');
}

export async function executeFlowAction(context:ActionContext):Promise<number|undefined> {
 const savepoint='flow_action_'+context.elementId;
 await context.client.query('SAVEPOINT '+savepoint);
 try {
  if(context.config.actionType==='Generate 4-Digit Random OTP')generateFlowOtp(context,4);
  else if(context.config.actionType==='Generate 6-Digit Random OTP')generateFlowOtp(context,6);
  else if(context.config.actionType==='Custom Notification')await sendCustomNotification(context);
  else if(context.config.actionType==='Create Task')await createTask(context);
  else if(context.config.actionType==='Post to Chatter')await postToChatter(context);
  else if(context.config.actionType==='Quick Actions')await executeQuickActionNode(context);
  else if(context.config.actionType==='Submit for Approval')await submitForApproval(context);
  else if(context.config.actionType==='Publish Platform Event')await executePlatformEventPublishNode(context);
  else if(context.config.actionType==='Send Email'||context.config.actionType==='Email Alert')
   await executeActionEmailNode(context);
  else if(context.config.actionType==='External Service Action')
   await executeCustomActionBridgeNode(context);
  else throw new Error('Unsupported Flow action: '+String(context.config.actionType??''));
  await context.client.query('RELEASE SAVEPOINT '+savepoint);
  return undefined;
 }catch(error){
  await context.client.query('ROLLBACK TO SAVEPOINT '+savepoint);
  await context.client.query('RELEASE SAVEPOINT '+savepoint);
  const fault=context.connectors.find(connector=>connector.kind==='fault');
  if(!fault)throw error;
  context.variables['$Flow.FaultMessage']=error instanceof Error?error.message:'Unknown Flow error';
  context.variables['$Flow.FaultCode']=error instanceof Error?error.name:'UNKNOWN';
  return fault.to;
 }
}

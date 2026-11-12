import {recordInvoicePayment} from './record-payment-service.js';
import {FlowRecordQuery} from '../system-files/flow-record-query.js';
import {registerMcpRoutes} from './mcp-routes.js';
import {TillPinService} from './till-pin-service.js';
import {withAuditContext,auditContext,setAuditActor} from './audit-context.js';
import {ConnectedAppService} from './connected-app-service.js';
import {SecurityMonitorService} from './security-monitor-service.js';
import {normalizedLoginIp} from './session-policy-service.js';
import {registerConnectedPublicRoutes,registerGovernanceRoutes} from './security-governance-routes.js';
import {createHash,randomUUID} from 'node:crypto';
import {ComponentLibraryService} from './component-library-service.js';
import {DashboardSnapshotService} from './dashboard-snapshot-service.js';
import {DashboardSubscriptionService} from './dashboard-subscription-service.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import { SqlPersistence } from '../system-files/sql-persistence.js';
import {applySystemMigrations} from './system-migrations.js';
import {loadFlowCapabilityCatalog} from '../system-files/flow-capability-catalog.js';
import {finishFlowOrchestrationDecision} from '../system-files/flow-orchestration-runtime.js';
import {seedConnectorAppCatalog} from '../app-seeders/connector-apps.js';
import {retireRemovedApps,deleteRetiredChatterMetadata} from '../app-seeders/retired-apps.js';
import {migrateSmartRendererKeys} from '../app-seeders/smart-components.js';
import {seedMailAdminPermissions} from '../app-seeders/mail-admin-permissions.js';
import {reconcileCoreObjects} from '../app-seeders/core-objects.js';
import {seedPlatformOneEngineDeploymentPermission,upgradeTenantDeveloperPolicy} from '../app-seeders/oneengine-policy.js';
import { AuthenticationService } from '../system-files/authentication.js';
import {PasswordRecoverySettingsService} from './password-recovery-settings-service.js';
import {PasswordResetService} from './password-reset-service.js';
import {AccountAssistService} from './account-assist-service.js';
import {PasswordPolicyService} from './password-policy-service.js';
import {MfaService} from './mfa-service.js';
import {MfaBackupService} from './mfa-backup-service.js';
import {WebAuthnService} from './webauthn-service.js';
import {FederationService} from './federation-service.js';
import {SessionPolicyService,browserSecurityHeaders,readSessionPolicy} from './session-policy-service.js';
import {registerFederationCallback,registerIdentityPublicRoutes,registerIdentityAdminRoutes} from './identity-routes.js';
import {configureTrustedProxy,registerSecurityWebHost} from './security-web-host.js';
import {TenantDeveloperService} from './tenant-developer-service.js';
import {TenantRecoveryContacts} from './tenant-recovery-contacts.js';
import {TenantRecoveryCases} from './tenant-recovery-cases.js';
import {sessionMetadata} from '../system-files/session-metadata.js';
import { ObjectDefinitionService } from '../system-files/object-definition.js';
import {ObjectSchemaLifecycle} from '../system-files/object-schema-lifecycle.js';
import {fieldTypeConversionSupported} from '../system-files/field-type-migration.js';
import {ObjectManagerMetadataService} from '../system-files/object-manager-metadata.js';
import {persistObjectLookupFilters} from '../system-files/object-manager-lookup-filters.js';
import {listRelationshipDefinitions} from '../relationship-engine/RelationshipRegistry.js';
import {ObjectMetadataHistory,restorableObjectLayoutSnapshot} from '../system-files/object-metadata-history.js';
import {CustomMetadataService} from '../system-files/custom-metadata-service.js';
import { RbacEngine } from '../system-files/rbac-engine.js';
import {permittedApps} from './rbac-navigation.js';
import {RbacAdministration} from './rbac-administration.js';
import {NamedCredentialService} from './named-credential-service.js';
import {DurableJobService} from './durable-job-service.js';
import {OAuthAuthorizationService} from './oauth-authorization-service.js';
import {GlobalValueSetService} from './global-value-set-service.js';
import {SystemDefinitionService,definitionKinds,type DefinitionKind} from '../system-files/system-definition-service.js';
import { RecordEngine } from '../system-files/record-engine.js';
import {authorizedSavedRecordProjection} from './record-write-projection.js';
import {ExternalIdUpsert} from '../system-files/external-id-upsert.js';
import {DuplicateMatchError} from '../system-files/record-matching.js';
import {registerMatchingRoutes} from './matching-rule-routes.js';
import {registerFieldExactIndexRoutes} from './field-exact-index-routes.js';
import {registerMetadataLoaderRoutes} from './metadata-loader-routes.js';
import {registerDataLoaderRecordRoutes} from './data-loader-records.js';
import {registerDataLoaderRibbonRoutes} from './data-loader-ribbon.js';
import {registerBusinessProcessRoutes} from './business-process-routes.js';
import {registerObjectLabelTranslationRoutes,applyObjectLabelTranslations,requestedLabelLanguage} from './object-label-translation-routes.js';
import {parseRecordCursor,parseRecordFilters} from '../system-files/record-query.js';
import {SqlReportRuntime} from './sql-report-runtime.js';
import {RecordCollaborationService} from './record-collaboration-service.js';
import {ObjectQuickActionRuntime} from './object-quick-action-runtime.js';
import {GlobalQuickActionMetadataService} from './global-quick-action-metadata.js';
import {RecordRetentionService} from './record-retention-service.js';
import {RecordListViewService,type ViewInput} from './record-list-view-service.js';
import {RecordFileService} from '../system-files/record-file-service.js';
import {TenantMediaService} from '../system-files/tenant-media-service.js';
import {registerDynamicApiRoutes} from './dynamic-api-routes.js';
import {placeNewFieldOnRecordPages} from './record-page-field-placement.js';
import {registerDeclarativeRuleRoutes} from './declarative-rule-routes.js';
import {DeclarativeRuleError} from '../system-files/declarative-rules.js';
import {registerVersionedApiRoutes} from './versioned-api-routes.js';
import {registerPlatformEventStreamRoutes} from './platform-event-stream-routes.js';
import {registerBusinessContextRoutes} from './business-context-routes.js';
import {registerOutboundWebhookRoutes} from './outbound-webhook-service.js';
import {registerDockerMailAdminRoutes} from './docker-mail-admin-routes.js';
import {registerDockerMailWebRoutes} from './docker-mail-web-routes.js';
import {MailAdminAccess} from './mail-admin-access.js';
import {registerInboundWebhookPublicRoutes,registerInboundWebhookAdminRoutes} from './inbound-webhook-service.js';
import {createIntegrationCommunicationWriter,IntegrationCommunicationOutbox} from './integration-api-log.js';
import {countTenantApiRequests,registerTenantInspectionRoutes} from './tenant-inspection-routes.js';
import {registerDurableJobAdminRoutes} from './durable-job-admin-routes.js';
import {registerScheduledActionRoutes} from './scheduled-action-routes.js';
import {sendActionCommunication} from './action-formula-communication-service.js';
import {tenantServerFormulaEnabled,executeServerDataAction} from './formula-data-action-runtime.js';
import {evaluateFormulaSql,evaluateFormulaSqlMany} from './formula-sql-runtime.js';
import {splitServerDataActionPlan} from '../expression-engine/ActionFormulas.js';
import {registerPageScriptPublicRoute,registerPageScriptRoutes} from '../api/PageScriptController.js';
import {PageScriptService} from '../page-compiler/pageScriptService.js';
import {registerSeederManagerRoutes} from './seeder-manager-routes.js';
import {registerPlatformDeploymentRoutes} from './platform-deployment-routes.js';
import {assertMetadataPackageEditable,MetadataPackageService} from './metadata-package-service.js';
import {registerPackageApiController} from '../api/PackageApiController.js';
import {OpenApiExternalService,registerOpenApiExternalServiceRoutes} from './openapi-external-service.js';

import { ComponentRuntime } from '../system-files/component-runtime.js';
import { PageRuntime } from '../system-files/page-runtime.js';
import {pageLayoutVariant,runtimeLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import { FlowRuntime } from '../system-files/flow-runtime.js';
import {flowRunHistory} from '../system-files/flow-run-history.js';
import {FlowCustomError} from '../system-files/flow-error-runtime.js';
import {FlowRecordTriggers} from '../system-files/flow-record-triggers.js';
import {flowFormulaReferences} from '../system-files/flow-formula-runtime.js';
import { AppRuntime,appHomeFormFactor } from '../system-files/app-runtime.js';
import { TenantProvisioning } from '../system-files/tenant-provisioning.js';
import {PlatformTenantService} from '../system-files/platform-tenant-service.js';
import {PlatformTenantUserService} from './platform-tenant-user-service.js';
import {AppPublishingService} from './app-publishing-service.js';
import {NativeTenantRecordReader} from './native-tenant-records.js';
import {rotateFirstLoginPassword} from './first-login-rotation.js';
import {reconcileBootstrapPassword} from './bootstrap-password-sync.js';

type Actor={tenant_id:string;user_id:string};
type AuthenticatedRequest=Request<Record<string,string>> & {actor?:Actor};
const authorizeFormulaReferences=async(rbac:RbacEngine,actor:Actor,expression:string)=>{
  for(const reference of flowFormulaReferences(expression)){
    const match=/^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(reference);
    if(!match)throw new Error('Formula references must use Object.Field names');
    await rbac.require(actor.tenant_id,actor.user_id,match[1],'read');
    await rbac.require(actor.tenant_id,actor.user_id,match[1]+'.'+match[2],'read');
  }
};
type Handler=(req:AuthenticatedRequest,res:Response)=>Promise<unknown>;
/** Tenant web addresses change rarely: remember each answer for 60 s instead of
 * querying md_tenant_domains on every API request (a hot path under load). */
const tenantDomainCache=new Map<string,{known:boolean;at:number}>();
async function tenantDomainKnown(db:SqlPersistence,host:string):Promise<boolean>{
  const hit=tenantDomainCache.get(host);
  if(hit&&Date.now()-hit.at<60_000)return hit.known;
  const {rows}=await db.query('SELECT tenant_id FROM md_tenant_domains WHERE domain=$1',[host]);
  if(tenantDomainCache.size>=2000)tenantDomainCache.clear();
  tenantDomainCache.set(host,{known:rows.length>0,at:Date.now()});
  return rows.length>0;
}
const route=(handler:Handler)=>(req:Request,res:Response,next:NextFunction)=>{
  // These routes use named parameters only; Express wildcard parameters are not registered here.
  Promise.resolve(handler(req as AuthenticatedRequest,res)).catch(next);
};
const stableMetadata=(value:unknown):string=>JSON.stringify(value,(_key,item)=>
  item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
async function assertChangedPackagePermissionSetsEditable(db:SqlPersistence,
  administration:RbacAdministration,tenant:string,user:string,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
  const next=(raw as Record<string,unknown>).permissionSets;
  if(!Array.isArray(next))return;
  const current=await administration.describe(tenant,user);
  const currentByApi=new Map(current.permissionSets.map(item=>[item.apiName,item]));
  const nextByApi=new Map(next.filter((item):item is Record<string,unknown>=>
    Boolean(item)&&typeof item==='object'&&!Array.isArray(item))
    .map(item=>[String(item.apiName??''),item]));
  for(const [apiName,previous] of currentByApi){
    const updated=nextByApi.get(apiName);
    if(stableMetadata(previous)!==stableMetadata(updated))
      await assertMetadataPackageEditable(db,tenant,'permission-set',apiName);
  }
}
/** Validated SQL edit condition for a shared ribbon property. */
const builderEnabledWhen=(rule:unknown):{property:string;in:string[]}|undefined=>{
  if(!rule||typeof rule!=='object'||Array.isArray(rule))return undefined;
  const condition=rule as Record<string,unknown>;
  return typeof condition.property==='string'&&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(condition.property)&&
    Array.isArray(condition.in)&&condition.in.length>0&&condition.in.length<=20&&
    condition.in.every(value=>typeof value==='string'&&value.length<=128)
    ?{property:condition.property,in:condition.in as string[]}:undefined;
};
const tokenCookie='md_refresh';
const getCookie=(req:Request):string|undefined=>{
  const encoded=(req.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(tokenCookie+'='));
  return encoded?.slice(tokenCookie.length+1);
};
function cookieOptions(req:Request) {
  const origin=req.get('origin');
  const crossSite=Boolean(origin && new URL(origin).hostname !== req.hostname);
  return `HttpOnly; Path=/api/auth; Max-Age=2592000; SameSite=${crossSite?'None':'Lax'}${crossSite||process.env.NODE_ENV==='production'?'; Secure':''}`;
}
/** The shared platform web host (the hosted SPA origin used by every tenant). */
const platformWebHost=()=>(process.env.METADRIVE_PLATFORM_WEB_HOST??'unesolutions.co.uk').trim().toLowerCase();
/** Single platform sign-in: every tenant signs in on the shared platform host.
 * Candidate tenants are the ACTIVE tenants with an enabled internal user for the
 * email. The password/MFA check still runs only inside the chosen tenant. */
async function platformEmailTenants(db:SqlPersistence,email:unknown):Promise<string[]>{
  if(typeof email!=='string'||!email.trim()||email.length>254)return [];
  const {rows}=await db.query<{tenant_id:string}>(`SELECT u.tenant_id FROM md_users u
    JOIN md_tenants t ON t.id=u.tenant_id
    WHERE lower(u.email)=lower($1) AND u.enabled=true AND u.user_type='internal' AND t.status='ACTIVE'
    ORDER BY t.created_at,u.tenant_id`,[email.trim()]);
  return rows.map(row=>row.tenant_id);
}
const isPlatformHost=(req:Request)=>{
  const source=req.get('origin')??refererOrigin(req);
  try{return !!source&&new URL(source).hostname.toLowerCase()===platformWebHost();}catch{return false;}
};
const refererOrigin=(req:Request)=>{
  const referer=req.get('referer');
  try{return referer?new URL(referer).origin:undefined;}catch{return undefined;}
};
async function resolveTenant(db:SqlPersistence,req:Request,tenantSlug?:unknown,email?:unknown) {
  // Explicit tenant selection must never override the tenant owning the browser origin.
  // Browsers omit Origin on same-origin GET requests; fall back to the Referer's origin.
  const source=req.get('origin')??refererOrigin(req);
  let originTenant:string|undefined;
  if(source) {
    const host=new URL(source).hostname.toLowerCase();
    const {rows}=await db.query<{tenant_id:string}>(
      'SELECT tenant_id FROM md_tenant_domains WHERE domain=$1',[host]);
    originTenant=rows[0]?.tenant_id;
    if(!originTenant) return undefined;
    if(host===platformWebHost()&&tenantSlug===undefined){
      const candidates=await platformEmailTenants(db,email);
      // One account for this email: that tenant. Several: keep the origin tenant
      // when it is one of them, otherwise the oldest tenant (login picks by password).
      if(candidates.length)return candidates.includes(originTenant)?originTenant:candidates[0];
    }
  }
  if(tenantSlug!==undefined) {
    if(typeof tenantSlug!=='string'|| !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug))
      throw new Error('Invalid tenant');
    const {rows}=await db.query<{id:string}>('SELECT id FROM md_tenants WHERE slug=$1',[tenantSlug]);
    if(originTenant && rows[0]?.id!==originTenant) return undefined;
    return rows[0]?.id;
  }
  return originTenant;
}
export function createSystemServer(db:SqlPersistence) {
  const app=express();
  configureTrustedProxy(app,process.env.METADRIVE_TRUST_PROXY_CIDRS);
  app.disable('x-powered-by');
  // PERFORMANCE FIX: compress JSON/JS/CSS responses (they were sent uncompressed, ~85% larger).
  // Live event streams must never be compressed or they stop streaming.
  app.use(compression({threshold:1024,filter:(req,res)=>{
    if(String(res.getHeader('Content-Type')??'').includes('text/event-stream'))return false;
    return compression.filter(req,res);
  }}));
  app.use((_req,res,next)=>withAuditContext({},()=>{res.setHeader('X-Correlation-ID',auditContext()!.correlationId);next();}));
  // Log webhook ingress and response status without logging query tokens, signatures,
  // request bodies, or credential material. This distinguishes delivery from processing failures.
  app.use((req,res,next)=>{
    if(/^\/api\/inbound-webhooks\/[^/]+\/?$/.test(req.path)){
      const started=Date.now();
      res.on('finish',()=>console.info('Inbound webhook request',JSON.stringify({
        method:req.method,path:req.path,status:res.statusCode,durationMs:Date.now()-started
      })));
    }
    next();
  });
  let adminMailAccess:MailAdminAccess|undefined;
  registerDockerMailWebRoutes(app,undefined,undefined,undefined,()=>adminMailAccess);
  app.use('/api/media-assets',express.json({limit:'8mb'}));
  // XLSX is carried as base64 JSON; bound this route separately from ordinary API payloads.
  app.use('/api/metadata/loader',express.json({limit:'15mb'}));
  app.use('/api/data-loader',express.json({limit:'15mb'}));
  app.use(express.json({limit:'2mb',verify:(req,_res,bytes)=>{
    if((req.url??'').startsWith('/api/inbound-webhooks/') && bytes.length<=262144)
      (req as Request & {rawWebhookBody?:Buffer}).rawWebhookBody=Buffer.from(bytes);
  }}));
  app.use(express.urlencoded({extended:false,limit:'1mb'}));
  app.use((_req,res,next)=>{res.set(browserSecurityHeaders({frame_policy:'DENY',csp_enabled:true}));next();});
  const auth=new AuthenticationService(db);
  const rbac=new RbacEngine(db);
  adminMailAccess=new MailAdminAccess(db,rbac);
  const nativeTenantRecords=new NativeTenantRecordReader(db,rbac);
  const connected=new ConnectedAppService(db,auth,rbac),securityMonitor=new SecurityMonitorService(db,rbac);
  auth.setLoginGuard(async(tenant,user,context)=>{
    const event=await securityMonitor.enforce({actor:{tenant_id:tenant,user_id:user},correlationId:auditContext()!.correlationId,eventType:'login',path:'/api/auth/login',method:'POST',ip:normalizedLoginIp(context.ip)});
    await securityMonitor.complete(tenant,event.id,event.blocked?403:200,0);
    if(event.blocked)throw Error('Login blocked by transaction security policy');
  });
  const rbacAdministration=new RbacAdministration(db,rbac);
  const namedCredentials=new NamedCredentialService(db,rbac);
  const flowJobs=new DurableJobService(db);
  const recordRetention=new RecordRetentionService(db,rbac);
  const recoverySettings=new PasswordRecoverySettingsService(db,rbac);
  const records=new RecordEngine(db,rbac,namedCredentials);
  // Use a dedicated RecordEngine without record-trigger callbacks for system-generated API logs.
  const integrationCommunicationOutbox=new IntegrationCommunicationOutbox(
    db,createIntegrationCommunicationWriter(db,undefined,
      (client,tenant,user,record)=>flowRecordTriggers.execute(client,tenant,user,'Communication','created',record,null,'after-save').then(()=>undefined)));
  const integrationActivityWriter=integrationCommunicationOutbox.write;
  namedCredentials.setIntegrationActivityWriter(integrationActivityWriter);
  const externalIdUpsert=new ExternalIdUpsert(db,rbac,records);
  const recordListViews=new RecordListViewService(db,rbac);
  const reportRuntime=new SqlReportRuntime(db,rbac,records);
  const collaboration=new RecordCollaborationService(db,rbac);
  const recordFiles=new RecordFileService(db,rbac);
  const tenantMedia=new TenantMediaService(db,rbac);
  records.setRichTextFilePruner((client,tenantId,objectApi,recordId,fieldApi,html)=>
    recordFiles.pruneUnreferenced(client,tenantId,objectApi,recordId,fieldApi,html));
  const systemDefinitions=new SystemDefinitionService(db,rbac);
  const dashboardSnapshots=new DashboardSnapshotService(db,rbac,records,systemDefinitions);
  const dashboardSubscriptions=new DashboardSubscriptionService(db,rbac,systemDefinitions,namedCredentials,dashboardSnapshots);
  const oauth=new OAuthAuthorizationService(db,rbac,namedCredentials,integrationActivityWriter);
  const mfa=new MfaService(db,rbac,auth,namedCredentials);
  const federation=new FederationService(db,rbac,namedCredentials,integrationActivityWriter);
  const passkeys=new WebAuthnService(db,auth);
  const backups=new MfaBackupService(db,auth,mfa,rbac);
  const sessionPolicies=new SessionPolicyService(db,rbac);
  // SAML POSTs originate at the IdP. State + browser cookie protect these callbacks;
  // they must precede the browser-origin CORS gate and never accept bearer identity.
  registerFederationCallback(app,federation);
  const tenantDeveloper=new TenantDeveloperService(db,rbac,auth,mfa);
  const passwordReset=new PasswordResetService(db,auth,(tenant,credential,from,to,subject,body)=>
    namedCredentials.sendRecoveryEmail(tenant,credential,from,to,subject,body),
    (tenant,user,config,variables,key)=>namedCredentials.callout(tenant,user,config,variables,key));
  const definitions=new ObjectDefinitionService(db,{
    encryptedValueVault:namedCredentials,
    evaluateFormula:(client,tenantId,userId,objectApi,fieldApi,recordId)=>
      records.evaluateFormulaForMigration(client,tenantId,userId,objectApi,fieldApi,recordId),
    recalculateRollup:(client,tenantId,objectApi,fieldApi)=>
      records.recalculateRollupForMigration(client,tenantId,objectApi,fieldApi)
  });
  const objectManagerMetadata=new ObjectManagerMetadataService(db,rbac);
  const objectHistory=new ObjectMetadataHistory(db);
  const objectLifecycle=new ObjectSchemaLifecycle(db);
  const customMetadata=new CustomMetadataService(db,rbac);
  const globalValueSets=new GlobalValueSetService(db,rbac);
  const components=new ComponentRuntime(db);
  const library=new ComponentLibraryService(db,rbac);
  const pages=new PageRuntime(db);
  const externalServices=new OpenApiExternalService(db,rbac);
  const flows=new FlowRuntime(db,rbac,records,
    (tenantId,userId,config,variables,key,execution)=>execution
      ?namedCredentials.enqueueCallout(execution.client,tenantId,userId,execution.runId,
        execution.nodeId,config,variables).then(()=>({status:202,body:''}))
      :namedCredentials.callout(tenantId,userId,config,variables,key),
    (client,tenantId,userId,flowApi,version,runId,scheduledAt,step,appApiName)=>
      flowJobs.enqueue(tenantId,'flow.resume',{
        actorUserId:userId,resourceId:runId,resourceVersion:version,
        ...(appApiName?{appApiName}:{}),scheduledAt,idempotencyKey:runId+':'+step
      },client).then(()=>undefined),
    async(client,tenantId,userId,flowId,version,runId,nodeId,step,message)=>{
      await namedCredentials.enqueueFlowEmail(client,tenantId,userId,flowId,version,runId,nodeId,step,
        message.credentialId,message.from,message.recipients,message.subject,message.body);
    });
  const quickActions=new ObjectQuickActionRuntime(db,rbac,records,collaboration,flows,namedCredentials);
  const globalQuickActionMetadata=new GlobalQuickActionMetadataService(db,rbac);
  const metadataPackages=new MetadataPackageService(db,rbac,definitions,pages,library,
    objectManagerMetadata,flows,rbacAdministration);
  const flowRecordTriggers=new FlowRecordTriggers(rbac,flows,records,db,
    async(client,tenantId,userId,flowApi,version,runId,scheduledAt,step,appApiName)=>{
      await flowJobs.enqueue(tenantId,'flow.resume',{
        actorUserId:userId,resourceId:runId,resourceVersion:version,
        ...(appApiName?{appApiName}:{}),scheduledAt,idempotencyKey:runId+':'+step
      },client);
    });
  records.setRecordTriggerHandler((client,tenantId,userId,objectApi,operation,record,prior,phase,isClone)=>
    flowRecordTriggers.execute(client,tenantId,userId,objectApi,operation,record,prior,phase,isClone));
  const apps=new AppRuntime(db);
  const appPublishing=new AppPublishingService(db,rbac,apps,metadataPackages,definitions,pages,library,flows);
  const platformTenants=new PlatformTenantService(db,rbac);
  const platformTenantUsers=new PlatformTenantUserService(db,rbac);
  const recoveryContacts=new TenantRecoveryContacts(db,rbac,mfa,namedCredentials);
  const recoveryCases=new TenantRecoveryCases(db,rbac,platformTenants,mfa,recoveryContacts,namedCredentials);

  // CORS is granted only to origins registered for a SQL tenant.
  app.use(async (req,res,next)=>{
    try {
    const origin=req.get('origin');
    if(origin) {
      let host:string;
      try { const parsed=new URL(origin); if(!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) throw Error(); if(process.env.NODE_ENV==='production' && (parsed.protocol!=='https:' || (parsed.port && parsed.port!=='443')))throw Error(); host=parsed.hostname.toLowerCase(); }
      catch { res.status(403).json({error:'Unrecognised origin'});return; }
      const authorized={rows:await tenantDomainKnown(db,host)?[{}]:[]};
      if(!authorized.rows.length) {
        const publicOAuth=['/api/oauth/token','/api/oauth/revoke'].includes(req.path);
        const bearer=req.get('authorization');
        if((!publicOAuth&&req.method!=='OPTIONS'&&!/^Bearer [A-Za-z0-9_-]+$/.test(bearer??''))||!await connected.originAllowed(origin,publicOAuth||req.method==='OPTIONS'?undefined:bearer!.slice(7))){res.status(403).json({error:'Unregistered origin'});return;}
      }
      res.setHeader('Access-Control-Allow-Origin',origin);
      if(authorized.rows.length)res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, If-Match, If-Unmodified-Since, X-MetaDrive-Request-Source, X-MetaDrive-Offline-Sync');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }
    if(req.method==='OPTIONS') {res.status(204).end();return;}
    next();
    } catch(error) {next(error);}
  });
  const authorize=async (req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    try {
      const bearer=req.get('authorization')??'';
      if(!/^Bearer [a-zA-Z0-9_-]+$/.test(bearer)) {res.status(401).json({error:'Bearer access token required'});return;}
      const path=req.originalUrl.split('?')[0],started=Date.now();
      req.actor=await auth.authenticate(bearer.slice(7),{ip:req.ip,path,method:req.method});
      setAuditActor(req.actor.tenant_id,req.actor.user_id);
      const event=await securityMonitor.enforce({actor:req.actor,correlationId:auditContext()!.correlationId,eventType:path.startsWith('/api/metadata/')?'metadata':'api',path,method:req.method,ip:normalizedLoginIp(req.ip)});
      res.once('finish',()=>{void securityMonitor.complete(req.actor!.tenant_id,event.id,res.statusCode,Date.now()-started).catch(()=>console.error('Security monitoring completion failed'));});
      if(event.blocked){res.status(403).json({error:'Blocked by transaction security policy'});return;}
      next();
    } catch(error) {if(error instanceof Error&&error.message==='Invalid session')res.status(401).json({error:'Invalid session'});else next(error);}
  };

  // These values are stamped into Oracle's systemd release at activation.
  // Never report a source-checkout SHA as the running production release.
  const oracleRelease=(()=>{
    const commit=process.env.METADRIVE_RELEASE_SHA;
    const deployedAt=process.env.METADRIVE_RELEASE_AT;
    return commit && /^[a-f0-9]{40}$/.test(commit) && deployedAt
      && Number.isFinite(Date.parse(deployedAt))
      ? {commit,deployedAt} : null;
  })();
  app.get('/health',route(async(_req,res)=>{
    await db.query('SELECT 1 FROM md_tenants LIMIT 1');
    res.set('Cache-Control','no-store');
    res.json({status:'ok',persistence:'sql',release:oracleRelease});
  }));
  app.get('/api/health',route(async(_req,res)=>{
    await db.query('SELECT 1 FROM md_tenants LIMIT 1');
    res.set('Cache-Control','no-store');
    res.json({status:'ok',persistence:'sql',release:oracleRelease});
  }));
  // Landing routing is returned with the authenticated session, not fetched after rendering Setup.
  const landingPreference=async(tenantId:string,userId:string)=>{
    const {rows}=await db.query<{landing_app_api:string;reports_to_user_id:string|null}>(
      'SELECT landing_app_api FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',
      [tenantId,userId]);
    return rows[0]?.landing_app_api??'Setup';
  };
  // The login and refresh clients request this bootstrap explicitly. Keep it in
  // the same authenticated response so Setup does not repeat four metadata reads
  // immediately after rendering. Each dataset uses the same server-side RBAC and
  // tenant-scoped services as its standalone endpoint. If any dataset cannot be
  // loaded, omit the bundle and let the existing per-endpoint recovery path report
  // the precise failure instead of turning a successful login into a failure.
  const landingBootstrap=async(tenantId:string,userId:string)=>{
    try{
      const [objectsPayload,pagesPayload,appsPayload,session]=await Promise.all([
        (async()=>{
          await rbac.require(tenantId,userId,'ObjectDefinition','read');
          const objects=await definitions.list(tenantId);
          const configurations=await objectManagerMetadata.loadForObjects(tenantId,objects.map(item=>item.apiName));
          return objects.map(item=>({...item,...configurations.get(item.apiName)}));
        })(),
        (async()=>{
          await rbac.require(tenantId,userId,'PageDefinition','read');
          return pages.list(tenantId);
        })(),
        (async()=>permittedApps(rbac,tenantId,userId,await apps.listMetadata(tenantId)))(),
        sessionMetadata(db,tenantId,userId)
      ]);
      return {landing:{objects:objectsPayload,pages:pagesPayload,apps:appsPayload,user:session.user}};
    }catch{
      return {};
    }
  };
  app.post('/api/auth/login',route(async(req,res)=>{
    const {tenantSlug,email,password}=req.body??{};
    if(typeof email!=='string'||typeof password!=='string'||!email.trim()) {
      res.status(400).json({error:'Email and password required'});return;
    }
    let tenantId=await resolveTenant(db,req,tenantSlug,email);
    if(!tenantId) {res.status(401).json({error:'Invalid credentials or tenant domain'});return;}
    if(tenantSlug===undefined&&isPlatformHost(req)){
      // The same email can exist in several tenants: sign in to the one whose
      // password matches (checked without side effects; the chosen tenant then
      // records success/failure and lockout as usual).
      const candidates=await platformEmailTenants(db,email);
      if(candidates.length>1){
        for(const candidate of candidates)
          if(await auth.passwordMatches(candidate,email,password)){tenantId=candidate;break;}
      }
    }
    try {
      const userId=await auth.verifyIdentity(tenantId,email,password,req.ip);
      const challenge=await mfa.createChallenge(tenantId,userId,{ip:req.ip});
      if(challenge){res.json(challenge);return;}
      const session=await auth.issuePasswordSession(tenantId,userId,{ip:req.ip});
      res.setHeader('Set-Cookie',`${tokenCookie}=${session.refreshToken}; ${cookieOptions(req)}`);
      if(req.query.landing==='1')res.setHeader('Cache-Control','no-store');
      res.json({access_token:session.accessToken,expires_in:session.expiresIn,landingAppApi:await landingPreference(tenantId,userId),...(req.query.landing==='1'?await landingBootstrap(tenantId,userId):{})});
    } catch(error) {
      // Distinguish rejected credentials from SQL/session failures. A successful
      // password check followed by a failed database write must not become 401.
      if(error instanceof Error&&(error.message.startsWith('Invalid credentials')||error.message.startsWith('Password expired.')))
        res.status(401).json({error:error.message});
      else throw error;
    }
  }));
  app.post('/api/auth/refresh',route(async(req,res)=>{
    const token=getCookie(req);
    if(!token) {res.status(401).json({error:'Refresh token required'});return;}
    try {
      const session=await auth.refresh(token,{ip:req.ip});
      res.setHeader('Set-Cookie',`${tokenCookie}=${session.refreshToken}; ${cookieOptions(req)}`);
      if(req.query.landing==='1')res.setHeader('Cache-Control','no-store');
      res.json({access_token:session.accessToken,expires_in:session.expiresIn,landingAppApi:await landingPreference(session.tenant_id,session.user_id),...(req.query.landing==='1'?await landingBootstrap(session.tenant_id,session.user_id):{})});
    } catch {res.status(401).json({error:'Invalid refresh session'});}
  }));
  app.get('/api/auth/password-reset/options',route(async(req,res)=>{
    const tenantId=await resolveTenant(db,req,req.query.tenantSlug,req.query.email);
    if(!tenantId){res.status(400).json({error:'Tenant domain is required'});return;}
    res.setHeader('Cache-Control','no-store');
    res.json(await passwordReset.options(tenantId));
  }));
  app.post('/api/auth/password-reset/request',route(async(req,res)=>{
    const tenantId=await resolveTenant(db,req,req.body?.tenantSlug,req.body?.email);
    if(!tenantId){res.status(400).json({error:'Tenant domain is required'});return;}
    res.setHeader('Cache-Control','no-store');
    res.status(202).json(await passwordReset.request(tenantId,req.body?.email,req.body?.channel));
  }));
  app.post('/api/auth/password-reset/verify',route(async(req,res)=>{
    const tenantId=await resolveTenant(db,req,req.body?.tenantSlug,req.body?.email);
    if(!tenantId){res.status(400).json({error:'Tenant domain is required'});return;}
    res.setHeader('Cache-Control','no-store');
    res.json(await passwordReset.verify(tenantId,req.body?.email,req.body?.code));
  }));
  app.post('/api/auth/password-reset/confirm',route(async(req,res)=>{
    const tenantId=await resolveTenant(db,req,req.body?.tenantSlug,req.body?.email);
    if(!tenantId){res.status(400).json({error:'Tenant domain is required'});return;}
    res.setHeader('Cache-Control','no-store');
    res.json(await passwordReset.confirm(tenantId,req.body?.email,req.body?.token,req.body?.newPassword));
  }));
  app.post('/api/auth/mfa/verify',route(async(req,res)=>{
    const session=await mfa.verifyChallenge(req.body?.challenge_token,req.body?.code,{ip:req.ip});
    res.setHeader('Set-Cookie',`${tokenCookie}=${session.refreshToken}; ${cookieOptions(req)}`);
    const actor=await auth.authenticate(session.accessToken);
    if(req.query.landing==='1')res.setHeader('Cache-Control','no-store');
    res.json({access_token:session.accessToken,expires_in:session.expiresIn,landingAppApi:await landingPreference(actor.tenant_id,actor.user_id),...(req.query.landing==='1'?await landingBootstrap(actor.tenant_id,actor.user_id):{})});
  }));
  // Provider callback uses a one-time SQL state, never an unauthenticated tenant selector.
  app.get('/api/oauth/callback',route(async(req,res)=>{
    const redirect=await oauth.complete(req.query.state,req.query.code);
    res.setHeader('Cache-Control','no-store');
    res.redirect(303,redirect);
  }));
  // Public verification endpoints require high-entropy one-time tokens, not bearer identity.
  app.post('/api/recovery/contacts/verify',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryContacts.verify(req.body));
  }));
  app.post('/api/recovery/cases/:id/confirm',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.proof(req.params.id,req.body,false));
  }));
  app.post('/api/recovery/cases/:id/dispute',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.proof(req.params.id,req.body,true));
  }));
  // Public tenant identity discovery is restricted to a verified tenant-owned origin.
  // Do not enumerate tenant names from the shared API host via a user-supplied slug.
  app.get('/api/auth/tenant-display',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const origin=req.get('origin');
    if(!origin){res.status(404).json({error:'Tenant identity unavailable'});return;}
    const tenantId=await resolveTenant(db,req,req.query.tenantSlug);
    if(!tenantId){res.status(404).json({error:'Tenant identity unavailable'});return;}
    const {rows}=await db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[tenantId]);
    if(!rows[0]){res.status(404).json({error:'Tenant identity unavailable'});return;}
    res.json({name:rows[0].name});
  }));
  registerIdentityPublicRoutes(app,{federation,auth,mfa,passkeys,resolveTenant:req=>resolveTenant(db,req),
    setSession:(req,res,session)=>{
      const previous=res.getHeader('Set-Cookie');
      res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[String(previous)]:[]),`${tokenCookie}=${session.refreshToken}; ${cookieOptions(req)}`]);
      res.json({access_token:session.accessToken,expires_in:session.expiresIn});
    }});
  registerMcpRoutes(app,{db,rbac,records,definitions,flows,pages,platform:platformTenants},authorize);
  registerConnectedPublicRoutes(app,connected);
  registerInboundWebhookPublicRoutes(app,db,namedCredentials,flows,rbac,records,integrationActivityWriter);
  // Compiled page scripts: the script fetch carries a one-time ticket instead of a bearer token.
  const pageScriptDeps={db,rbac,records,pages,definitions,scripts:new PageScriptService()};
  registerPageScriptPublicRoute(app,pageScriptDeps);
  app.use('/api',authorize);
  registerPageScriptRoutes(app,pageScriptDeps);
  registerGovernanceRoutes(app,db,rbac,auth,connected,securityMonitor);
  registerIdentityAdminRoutes(app,{sessions:sessionPolicies,federation,passkeys,backups});
  app.use('/api',countTenantApiRequests(db));
  app.use('/services/data',authorize);
  app.use('/services/data',countTenantApiRequests(db));
  // Durable notifications: only the addressed user can list or acknowledge them.
  const notificationView=(row:{id:string;recipient_id:string;title:string;body:string;flow_api_name:string;sent_by:string|null;created_at:Date;read_at:Date|null})=>({
    id:row.id,recipientId:row.recipient_id,title:row.title,body:row.body,
    flowApiName:row.flow_api_name,sentBy:row.sent_by??'',
    createdAt:new Date(row.created_at).toISOString(),
    readAt:row.read_at?new Date(row.read_at).toISOString():null
  });
  type ApprovalSqlRow={id:string;group_id:string;object_api:string;object_label:string;record_id:string;
    record_name:string;flow_api_name:string;submitted_by:string;approver_id:string;status:string;
    comments:string;decision_comments:string;created_at:Date;decided_at:Date|null;decided_by:string|null};
  const approvalView=(r:ApprovalSqlRow)=>({
    id:r.id,groupId:r.group_id,objectApiName:r.object_api,objectLabel:r.object_label,
    recordId:r.record_id,recordName:r.record_name,flowApiName:r.flow_api_name,
    submittedBy:r.submitted_by,submittedByName:r.submitted_by,
    approverId:r.approver_id,status:r.status,comments:r.comments,decisionComments:r.decision_comments,
    createdAt:new Date(r.created_at).toISOString(),
    decidedAt:r.decided_at?new Date(r.decided_at).toISOString():null,decidedBy:r.decided_by
  });
  app.get('/api/approvals/inbox',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ApprovalRequest','read');
    const {rows}=await db.query<ApprovalSqlRow>(
      "SELECT * FROM md_approval_requests WHERE tenant_id=$1 AND approver_id=$2 AND status='Pending' ORDER BY created_at DESC,id DESC LIMIT 100",
      [actor.tenant_id,actor.user_id]);
    res.json({requests:rows.map(approvalView)});
  }));
  app.post('/api/approvals/:id/decision',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ApprovalRequest','approve');
    const decision=req.body?.decision,comments=req.body?.comments??'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)||
       !['Approved','Rejected'].includes(decision)||typeof comments!=='string'||comments.length>4000)
      throw new Error('Invalid approval decision');
    const updated=await db.transaction(async client=>{
      // Serialize all decisions in a stage BEFORE locking individual approval rows.
      // Otherwise concurrent approvers can deadlock with outstanding-item cancellation.
      const {rows:pending}=await client.query<{group_id:string}>(`
        SELECT group_id FROM md_approval_requests
        WHERE tenant_id=$1 AND id=$2 AND approver_id=$3 AND status='Pending'
      `,[actor.tenant_id,req.params.id,actor.user_id]);
      if(!pending[0])return null;
      await client.query(`
        SELECT 1 FROM md_flow_approval_stages
        WHERE tenant_id=$1 AND group_id=$2 FOR UPDATE
      `,[actor.tenant_id,pending[0].group_id]);
      const {rows}=await client.query<ApprovalSqlRow>(
        "UPDATE md_approval_requests SET status=$4,decision_comments=$5,decided_at=now(),decided_by=$2 WHERE tenant_id=$1 AND approver_id=$2 AND id=$3 AND status='Pending' RETURNING *",
        [actor.tenant_id,actor.user_id,req.params.id,decision,comments]);
      if(!rows[0])return null;
      // A normal approval is unchanged. Only approvals tied to a durable
      // orchestration stage can schedule interview resumption.
      const resume=await finishFlowOrchestrationDecision(client,actor.tenant_id,rows[0].group_id);
      if(resume)await flowJobs.enqueue(actor.tenant_id,'flow.resume',{
        actorUserId:resume.actorUserId,resourceId:resume.runId,
        resourceVersion:resume.version,
        ...(resume.appApiName?{appApiName:resume.appApiName}:{}),
        idempotencyKey:resume.runId+':orchestration:'+rows[0].group_id
      },client);
      return rows[0];
    });
    if(!updated){res.status(404).json({error:'Pending approval not found'});return;}
    res.json({request:approvalView(updated)});
  }));
  app.get('/api/notifications',route(async(req,res)=>{
    const actor=req.actor!;
    const {rows}=await db.query<{
      id:string;recipient_id:string;title:string;body:string;flow_api_name:string;
      sent_by:string|null;created_at:Date;read_at:Date|null
    }>('SELECT id,recipient_id,title,body,flow_api_name,sent_by,created_at,read_at FROM md_notifications WHERE tenant_id=$1 AND recipient_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100',[actor.tenant_id,actor.user_id]);
    const {rows:counts}=await db.query<{count:string}>(
      'SELECT count(*)::text AS count FROM md_notifications WHERE tenant_id=$1 AND recipient_id=$2 AND read_at IS NULL',[actor.tenant_id,actor.user_id]);
    res.json({notifications:rows.map(notificationView),unreadCount:Number(counts[0]?.count??0)});
  }));
  app.post('/api/notifications/:id/read',route(async(req,res)=>{
    const actor=req.actor!;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))
      throw new Error('Invalid notification ID');
    const {rows}=await db.query<{
      id:string;recipient_id:string;title:string;body:string;flow_api_name:string;
      sent_by:string|null;created_at:Date;read_at:Date|null
    }>('UPDATE md_notifications SET read_at=COALESCE(read_at,now()) WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3 RETURNING id,recipient_id,title,body,flow_api_name,sent_by,created_at,read_at',
      [actor.tenant_id,actor.user_id,req.params.id]);
    if(!rows[0]){res.status(404).json({error:'Notification not found'});return;}
    res.json({notification:notificationView(rows[0])});
  }));
  app.get('/api/auth/password-recovery/settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await recoverySettings.read(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/auth/password-recovery/settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await recoverySettings.save(actor.tenant_id,actor.user_id,req.body));
  }));
  app.get('/api/auth/mfa/status',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.status(actor.tenant_id,actor.user_id));
  }));
  app.get('/api/auth/mfa/policy',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.policy(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/auth/mfa/policy',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.setPolicy(actor.tenant_id,actor.user_id,req.body?.mode));
  }));
  app.post('/api/auth/mfa/enroll',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.enroll(actor.tenant_id,actor.user_id,req.body?.password));
  }));
  app.post('/api/auth/mfa/enroll/confirm',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.confirmEnrollment(actor.tenant_id,actor.user_id,req.body?.enrollment_token,req.body?.code));
  }));
  app.post('/api/auth/mfa/disable',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await mfa.disable(actor.tenant_id,actor.user_id,req.body?.password,req.body?.code));
  }));
  app.get('/api/tenant/recovery/contacts',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryContacts.list(actor.tenant_id,actor.user_id));
  }));
  app.post('/api/tenant/recovery/contacts',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','no-store');
    res.status(201).json(await recoveryContacts.enroll(actor.tenant_id,actor.user_id,req.body));
  }));
  app.post('/api/platform/recovery/cases',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.status(201).json(await recoveryCases.open(req.actor!,req.body));
  }));
  app.get('/api/platform/recovery/cases/:id',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.read(req.actor!,req.params.id));
  }));
  app.post('/api/platform/recovery/cases/:id/approve',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.approve(req.actor!,req.params.id,req.body));
  }));
  app.post('/api/platform/recovery/cases/:id/invite',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.invite(req.actor!,req.params.id,req.body));
  }));
  app.post('/api/tenant/recovery/cases/:id/redeem',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.redeem(req.actor!,req.params.id,req.body));
  }));
  app.post('/api/tenant/recovery/cases/:id/repair',route(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(await recoveryCases.repair(req.actor!,req.params.id,req.body));
  }));
  app.get('/api/tenant/developer-account',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','no-store');
    res.json(await tenantDeveloper.status(actor.tenant_id,actor.user_id));
  }));
  app.post('/api/tenant/developer-account/activate',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','no-store');
    res.json(await tenantDeveloper.activate(actor.tenant_id,actor.user_id,req.body));
  }));
  app.get('/api/auth/user-locks',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','read');
    const {rows}=await db.query<{id:string;email:string;display_name:string;enabled:boolean;locked_until:Date|null}>(
      'SELECT id,email,display_name,enabled,locked_until FROM md_users WHERE tenant_id=$1 ORDER BY email LIMIT 500',[actor.tenant_id]);
    res.json({users:rows.map(r=>({id:r.id,name:r.display_name||r.email,email:r.email,active:r.enabled,
      lockedUntil:r.locked_until?new Date(r.locked_until).getTime():null}))});
  }));
  // Security administration: tenant-scoped account locks and session revocation.
  const setAccountLock=route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    const id=req.params.id;
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid user ID');
    if(id===actor.user_id)throw new Error('Cannot alter own account lock');
    const locking=req.path.endsWith('/lock');
    const duration=req.body?.durationMinutes;
    if(locking && (!Number.isInteger(duration)||duration<1||duration>1440))
      throw new Error('Invalid account lock duration');
    await db.transaction(async client=>{
      const updated=await client.query(`UPDATE md_users SET failed_login_attempts=0,locked_until=${locking?"now() + ($3::integer * interval '1 minute')":"NULL"}
        WHERE tenant_id=$1 AND id=$2 RETURNING id`,locking
        ?[actor.tenant_id,id,duration]:[actor.tenant_id,id]);
      if(!updated.rowCount)throw new Error('User not found');
      if(locking)for(const table of ['md_sessions','md_refresh_sessions'])
        await client.query('UPDATE '+table+' SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,id]);
      await client.query('INSERT INTO md_security_events(tenant_id,actor_user_id,action,subject_user_id) VALUES($1,$2,$3,$4)',
        [actor.tenant_id,actor.user_id,locking?'UserLocked':'UserUnlocked',id]);
    });
    res.json({success:true});
  });
  app.post('/api/auth/users/:id/lock',setAccountLock);
  app.post('/api/auth/users/:id/unlock',setAccountLock);
  const passwordPolicy=new PasswordPolicyService(db,rbac);
  app.get('/api/auth/password-policy',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await passwordPolicy.read(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/auth/password-policy',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await passwordPolicy.save(actor.tenant_id,actor.user_id,req.body));
  }));
  app.get('/api/auth/security-events',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','read');
    const limit=Number(req.query.limit??25),offset=Number(req.query.offset??0);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||
       !Number.isSafeInteger(offset)||offset<0||offset>100000)
      throw new Error('Invalid pagination');
    const filters:string[]=['tenant_id=$1'];
    const params:unknown[]=[actor.tenant_id];
    const add=(sql:string,value:unknown)=>{
      params.push(value);filters.push(sql.replace('?', '$'+params.length));
    };
    for(const [key,column] of [
      ['action','action'],['identifier','login_identifier'],['ip','source_ip']
    ] as const){
      const value=typeof req.query[key]==='string'?req.query[key].trim():'';
      if(value.length>120)throw new Error('Invalid security event filter');
      if(value)add(column+' ILIKE ?', '%'+value+'%');
    }
    for(const [key,operator] of [['from','>='],['to','<']] as const){
      const value=typeof req.query[key]==='string'?req.query[key]:'';
      if(!value)continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||
         !Number.isFinite(new Date(value+'T00:00:00Z').getTime()))
        throw new Error('Invalid event date');
      add('created_at '+operator+' ?::timestamptz',
        value+'T00:00:00Z');
    }
    const where=' WHERE '+filters.join(' AND ');
    const {rows}=await db.query<{id:string;actor_user_id:string|null;action:string;login_identifier:string|null;source_ip:string|null;details:Record<string,string>;created_at:Date}>(
      'SELECT id,actor_user_id,action,details,created_at,login_identifier,source_ip FROM md_security_events'
      +where+' ORDER BY created_at DESC,id DESC LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2),
      [...params,limit+1,offset]);
    const page=rows.slice(0,limit);
    res.json({events:page.map(r=>({id:r.id,actorUserId:r.actor_user_id,at:new Date(r.created_at).toISOString(),action:r.action,details:r.details,loginIdentifier:r.login_identifier,sourceIp:r.source_ip})),
      nextOffset:rows.length>limit?offset+limit:null});
  }));
  app.post('/api/auth/users/:id/lock',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    const id=req.params.id,duration=req.body?.durationMinutes;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ||!Number.isSafeInteger(duration)||duration<1||duration>1440||id===actor.user_id)
      throw new Error('Invalid account lock');
    await db.transaction(async client=>{
      const target=await client.query(
        "UPDATE md_users SET locked_until=now()+($3 * interval '1 minute') WHERE tenant_id=$1 AND id=$2 AND enabled=true RETURNING id",
        [actor.tenant_id,id,duration]);
      if(!target.rowCount)throw new Error('User not found');
      await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,id]);
      await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,id]);
      await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,details) VALUES($1,$2,$3,'user.lock',jsonb_build_object('durationMinutes',$4::integer))",
        [actor.tenant_id,actor.user_id,id,duration]);
    });
    res.status(204).end();
  }));
  app.post('/api/auth/users/:id/unlock',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    const id=req.params.id;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid user ID');
    await db.transaction(async client=>{
      const target=await client.query('UPDATE md_users SET failed_login_attempts=0,locked_until=NULL WHERE tenant_id=$1 AND id=$2 RETURNING id',[actor.tenant_id,id]);
      if(!target.rowCount)throw new Error('User not found');
      await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action) VALUES($1,$2,$3,'user.unlock')",[actor.tenant_id,actor.user_id,id]);
    });
    res.status(204).end();
  }));
  app.get('/api/auth/me',route(async(req,res)=>{
    res.json(await sessionMetadata(db,req.actor!.tenant_id,req.actor!.user_id));
  }));
  app.post('/api/auth/logout',route(async(req,res)=>{
    await auth.signOut(req.get('authorization')!.slice(7),getCookie(req));
    res.setHeader('Set-Cookie',`${tokenCookie}=; HttpOnly; Path=/api/auth; Max-Age=0; SameSite=Lax`);
    res.status(204).end();
  }));
  app.post('/api/auth/change-password',route(async(req,res)=>{
    const actor=req.actor!;
    const {currentPassword,newPassword}=req.body??{};
    if(typeof currentPassword!=='string'||typeof newPassword!=='string')
      throw new Error('Invalid password change');
    try{
      await auth.changePassword(actor.tenant_id,actor.user_id,currentPassword,newPassword);
      res.status(204).end();
    }catch(error){
      if(error instanceof Error&&error.message==='Invalid credentials'){
        res.status(401).json({error:'Invalid credentials'});return;
      }
      throw error;
    }
  }));
  app.get('/api/auth/sessions',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await auth.activeSessions(actor.tenant_id,actor.user_id));
  }));
  app.post('/api/auth/sessions/revoke-all',route(async(req,res)=>{
    const actor=req.actor!;
    const currentPassword=req.body?.currentPassword;
    if(typeof currentPassword!=='string')throw new Error('Invalid credentials');
    try{
      await auth.revokeAllSessions(actor.tenant_id,actor.user_id,currentPassword);
      res.status(204).end();
    }catch(error){
      if(error instanceof Error&&error.message==='Invalid credentials'){
        res.status(401).json({error:'Invalid credentials'});return;
      }
      throw error;
    }
  }));
  app.get('/api/tenant/company-profile',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({profile:await platformTenants.getSetting(actor.tenant_id,actor.user_id,'company-profile')});
  }));
  app.put('/api/tenant/company-profile',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({profile:await platformTenants.saveSetting(actor.tenant_id,actor.user_id,'company-profile',req.body)});
  }));
  /** Tenant name and logo for page formulas ($tenant.name / $tenant.logo).
   * Every signed-in user of the tenant (kiosk and app users) may read these two
   * public brand values; the full company profile still needs TenantSettings read. */
  app.get('/api/tenant/brand',route(async(req,res)=>{
    const actor=req.actor!;
    const [profile,tenant]=await Promise.all([
      db.query<{properties:unknown}>(
        "SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='company-profile'",[actor.tenant_id]),
      db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[actor.tenant_id])
    ]);
    const settings=profile.rows[0]?.properties;
    const values=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings as Record<string,unknown>:{};
    const text=(value:unknown)=>typeof value==='string'?value.trim():'';
    res.setHeader('Cache-Control','private, no-store');
    res.json({name:text(values.tradingName)||text(values.legalName)||text(tenant.rows[0]?.name),
      logo:text(values.logoUrl)});
  }));
  app.get('/api/tenant/business-calendar',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json({calendar:await platformTenants.getBusinessCalendar(actor.tenant_id,actor.user_id)});
  }));
  app.put('/api/tenant/business-calendar',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({calendar:await platformTenants.saveSetting(actor.tenant_id,actor.user_id,'business-calendar',req.body)});
  }));
  app.get('/api/tenant/offline-briefcase',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json({briefcase:await platformTenants.getSetting(
      actor.tenant_id,actor.user_id,'offline-briefcase')??{selections:[]}});
  }));
  app.put('/api/tenant/offline-briefcase',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json({briefcase:await platformTenants.saveSetting(
      actor.tenant_id,actor.user_id,'offline-briefcase',req.body)});
  }));
  app.get('/api/tenant/offline-briefcase/data',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    const configuration=await platformTenants.getSetting(
      actor.tenant_id,actor.user_id,'offline-briefcase') as {selections?:unknown}|null;
    if(!configuration)return res.json({
      tenantId:actor.tenant_id,userId:actor.user_id,syncedAt:new Date().toISOString(),selections:[]
    });
    if(!Array.isArray(configuration.selections))
      throw new Error('Invalid saved offline briefcase configuration');
    const selections=await Promise.all(configuration.selections.map(async(selection:unknown)=>{
      if(!selection||typeof selection!=='object'||Array.isArray(selection))
        throw new Error('Invalid saved offline briefcase selection');
      const item=selection as Record<string,unknown>;
      const objectApi=item.objectApi;
      const recordIds=item.recordIds;
      if(typeof objectApi!=='string'||!Array.isArray(recordIds)
        ||!recordIds.every((id):id is string=>typeof id==='string'))
        throw new Error('Invalid saved offline briefcase selection');
      return {objectApi,records:await Promise.all(recordIds.map(async recordId=>({
        recordId,record:await records.get(actor.tenant_id,actor.user_id,objectApi,recordId)
      })))};
    }));
    res.json({tenantId:actor.tenant_id,userId:actor.user_id,
      syncedAt:new Date().toISOString(),selections});
  }));
  app.get('/api/metadata/currencies',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.getSetting(actor.tenant_id,actor.user_id,'currencies')??
      {corporateCurrency:'USD',standardVatRate:20,currencies:[{currencyIsoCode:'USD',conversionRate:1}]});
  }));
  app.put('/api/metadata/currencies',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.saveSetting(actor.tenant_id,actor.user_id,'currencies',req.body));
  }));
  app.get('/api/metadata/automation-settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.getSetting(actor.tenant_id,actor.user_id,'automation-settings')??
      {autoRetryFailedFlows:false,maxRetryAttempts:10,conversationIdleMinutes:15,flowServiceUserId:null});
  }));
  app.put('/api/metadata/automation-settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.saveSetting(actor.tenant_id,actor.user_id,'automation-settings',req.body));
  }));
  app.get('/api/metadata/automation-service-users',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'TenantSettings','manage');
    const {rows}=await db.query<{id:string;email:string;display_name:string;enabled:boolean}>(
      'SELECT id,email,display_name,enabled FROM md_users WHERE tenant_id=$1 ORDER BY email,id LIMIT 500',
      [actor.tenant_id]);
    res.json({users:rows.map(user=>({
      id:user.id,name:user.display_name||user.email,email:user.email,enabled:user.enabled
    }))});
  }));
  app.get('/api/platform/tenants/developer-email-availability',route(async(req,res)=>{
    const actor=req.actor!;
    const slug=String(req.query.slug??'');
    res.setHeader('Cache-Control','private, no-store');
    res.json(await platformTenants.developerEmailAvailability(actor.tenant_id,actor.user_id,slug));
  }));
  app.get('/api/platform/tenants/:slug',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.get(actor.tenant_id,actor.user_id,req.params.slug));
  }));
  app.patch('/api/platform/tenants/:slug',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.updateDetails(actor.tenant_id,actor.user_id,req.params.slug,req.body));
  }));
  app.patch('/api/platform/tenants/:slug/retention',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.updateRetention(actor.tenant_id,actor.user_id,req.params.slug,req.body));
  }));
  for(const operation of ['suspend','reactivate','archive','restore'] as const) {
    app.post('/api/platform/tenants/:slug/'+operation,route(async(req,res)=>{
      const actor=req.actor!;
      res.json(await platformTenants.transition(actor.tenant_id,actor.user_id,req.params.slug,operation));
    }));
  }
  app.post('/api/platform/tenants/:slug/developer-mailbox',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.provisionDeveloperMailbox(actor.tenant_id,actor.user_id,req.params.slug));
  }));
  // Platform user administration for any tenant (OneEngine in the platform tenant).
  app.get('/api/platform/tenants/:slug/users',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await platformTenantUsers.list(req.actor!,req.params.slug,req.query as Record<string,unknown>));
  }));
  app.post('/api/platform/tenants/:slug/users',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.status(201).json(await platformTenantUsers.create(req.actor!,req.params.slug,req.body));
  }));
  app.patch('/api/platform/tenants/:slug/users/:userId',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await platformTenantUsers.update(req.actor!,req.params.slug,req.params.userId,req.body));
  }));
  app.delete('/api/platform/tenants/:slug/users/:userId',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await platformTenantUsers.remove(req.actor!,req.params.slug,req.params.userId));
  }));
  app.post('/api/platform/tenants',route(async(req,res)=>{
    const actor=req.actor!;
    const payload=await platformTenants.create(actor.tenant_id,actor.user_id,req.body,req.get('idempotency-key'));
    res.status(payload.replayed?200:201).json(payload);
  }));
  app.get('/api/platform/tenants',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await platformTenants.list(actor.tenant_id,actor.user_id,req.query));
  }));
  app.get('/api/metadata/permissions',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await rbac.describe(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/metadata/permissions/sets',route(async(req,res)=>{
    const actor=req.actor!;
    await assertChangedPackagePermissionSetsEditable(db,rbacAdministration,actor.tenant_id,actor.user_id,req.body);
    res.json(await rbacAdministration.save(actor.tenant_id,actor.user_id,req.body));
  }));
  app.put('/api/metadata/permissions',route(async(req,res)=>{
    const actor=req.actor!;
    await assertChangedPackagePermissionSetsEditable(db,rbacAdministration,actor.tenant_id,actor.user_id,req.body);
    res.json(await rbacAdministration.save(actor.tenant_id,actor.user_id,req.body));
  }));
  // Native record forms consume permission-filtered field metadata. Unlike Object Manager,
  // this endpoint needs only record read/create/edit access, never metadata-admin access.
  app.get('/api/mobile/record-forms',route(async(req,res)=>{
    const actor=req.actor!;
    const canonical=await definitions.list(actor.tenant_id);
    const language=requestedLabelLanguage(req.headers['accept-language']);
    const locales=language.split('-')[0]===language?[language]:[language.split('-')[0],language];
    const labels=await db.query<{object_api:string;field_api:string;language:string;value_text:string}>(`
     SELECT object_api,field_api,language,value_text FROM md_object_label_translations
     WHERE tenant_id=$1 AND object_api=ANY($2::text[]) AND language=ANY($3::text[])`,
     [actor.tenant_id,canonical.map(item=>item.apiName),locales]);
    const objects=applyObjectLabelTranslations(canonical,labels.rows,language);
    const grants=await rbac.allowedMany(actor.tenant_id,actor.user_id,
      objects.flatMap(object=>['read','create','edit'].map(action=>({resource:object.apiName,action}))));
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Language',language);
    res.json({objects:objects.flatMap((object,index)=>{
      const [read,create,edit]=grants.slice(index*3,index*3+3);
      return read&&(create||edit)?[{apiName:object.apiName,label:object.label,
        pluralLabel:object.pluralLabel,canCreate:create,canEdit:edit}]:[];
    })});
  }));
  app.get('/api/mobile/record-forms/:objectApi',route(async(req,res)=>{
    const actor=req.actor!,objectApi=req.params.objectApi;
    if(!/^[A-Za-z][A-Za-z0-9_]{0,199}$/.test(objectApi))throw new Error('Invalid object name');
    await rbac.require(actor.tenant_id,actor.user_id,objectApi,'read');
    const [create,edit]=await rbac.allowedMany(actor.tenant_id,actor.user_id,
      [{resource:objectApi,action:'create'},{resource:objectApi,action:'edit'}]);
    if(!create&&!edit){res.status(403).json({error:'Record form access denied'});return;}
    const canonical=await definitions.get(actor.tenant_id,objectApi);
    const language=requestedLabelLanguage(req.headers['accept-language']);
    const locales=language.split('-')[0]===language?[language]:[language.split('-')[0],language];
    const labels=await db.query<{object_api:string;field_api:string;language:string;value_text:string}>(`
      SELECT object_api,field_api,language,value_text FROM md_object_label_translations
      WHERE tenant_id=$1 AND object_api=$2 AND language=ANY($3::text[])`,
      [actor.tenant_id,objectApi,locales]);
    const object=applyObjectLabelTranslations([canonical],labels.rows,language)[0];
    const editable=object.fields.filter(field=>!/^(formula|rollup|autonumber)$/i.test(field.dataType));
    const grants=await rbac.allowedMany(actor.tenant_id,actor.user_id,
      editable.flatMap(field=>['read','create','edit'].map(action=>({resource:objectApi+'.'+field.apiName,action}))));
    const fields=editable.flatMap((field,index)=>{
      const [readField,createField,editField]=grants.slice(index*3,index*3+3);
      const canCreateField=Boolean(create&&createField);
      const canEditField=Boolean(edit&&editField&&readField);
      if(!canCreateField&&!canEditField)return [];
      return [{apiName:field.apiName,label:field.label,dataType:field.dataType,
        required:field.required===true,defaultValue:field.defaultValue??null,
        picklistValues:field.picklistValues??[],
        controllerFieldApiName:field.controllerFieldApiName??null,
        valueSettings:field.valueSettings??null,
        relationship:field.relationship?{targetObject:field.relationship.targetObject}:null,
        canCreate:canCreateField,canEdit:canEditField}];
    });
    const recordTypes=(object.recordTypes??[]).filter(type=>type.active);
    const typeAccess=await rbac.allowedMany(actor.tenant_id,actor.user_id,
      recordTypes.map(type=>({resource:'RecordType:'+objectApi+'.'+type.id,action:'read'})));
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Language',language);
    res.json({object:{apiName:object.apiName,label:object.label,canCreate:create,canEdit:edit,fields,
      recordTypes:recordTypes.filter((type,index)=>typeAccess[index]).map(type=>({
        id:type.id,label:type.label,isDefault:type.isDefault
      }))}});
  }));
  app.get('/api/objects',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    // Tenant metadata must never reuse an obsolete empty browser response.
    res.setHeader('Cache-Control','private, no-store');
    res.removeHeader('ETag');
    res.json({objects:await definitions.list(actor.tenant_id)});
  }));
  // Validate against the SQL-supported metadata model; never report unsupported
  // builder features as executable/publishable definitions.
  app.post('/api/metadata/objects/:apiName/validate',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    const saved=await definitions.get(actor.tenant_id,req.params.apiName);
    const draft=req.body;
    if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('Invalid object draft');
    const errors:string[]=[];
    if(draft.apiName!==req.params.apiName)errors.push('Object API name does not match');
    if(typeof draft.label!=='string'||!draft.label.trim())errors.push('Object label is required');
    if(!Array.isArray(draft.fields))errors.push('Object fields must be an array');
    else {
      const names=new Set<string>();
      for(const field of draft.fields){
        if(!field||typeof field!=='object'||Array.isArray(field)){
          errors.push('Invalid field');continue;
        }
        if(typeof field.apiName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.apiName)){
          errors.push('Invalid field API name');continue;
        }
        const key=field.apiName.toLowerCase();
        if(names.has(key))errors.push('Duplicate field API name: '+field.apiName);
        names.add(key);
        const canonical=saved.fields.find(f=>f.apiName===field.apiName);
        if(!canonical)errors.push('Field is not stored in SQL: '+field.apiName);
        else if(field.dataType!==canonical.dataType
          &&!fieldTypeConversionSupported(canonical.dataType,field.dataType))
          errors.push('Unsupported field datatype change: '+field.apiName);
      }
    }
    // Draft/publishing and layouts require dedicated versioned SQL metadata support.
    if(draft.validationRules?.length||draft.formulaFields?.length)
      errors.push('Advanced Object draft features are not supported by the current SQL runtime');
    res.json({valid:errors.length===0,errors});
  }));
  // Metadata lookups use the same tenant-scoped SQL registry as list/create.
  app.put('/api/metadata/objects/:apiName/fields/:fieldApi',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    const proposal=req.body;
    if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))
      throw new Error('Invalid field update');
    res.json({object:await definitions.updateField(actor.tenant_id,req.params.apiName,
      req.params.fieldApi,proposal,actor.user_id)});
  }));
  app.get('/api/metadata/objects/:apiName/fields/:fieldApi/migrations',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    res.json({migrations:await definitions.listFieldTypeMigrations(
      actor.tenant_id,req.params.apiName,req.params.fieldApi)});
  }));
  app.post('/api/metadata/objects/:apiName/fields/:fieldApi/migrations/:migrationId/rollback',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    res.json({object:await definitions.rollbackFieldTypeMigration(
      actor.tenant_id,req.params.apiName,req.params.fieldApi,req.params.migrationId)});
  }));
  app.post('/api/metadata/objects/:apiName/formulas/validate',route(async(req,res)=>{
    const actor=req.actor!;
    const objectApi=req.params.apiName;
    if(typeof objectApi!=='string')throw new Error('Invalid object name');
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','create');
    await rbac.require(actor.tenant_id,actor.user_id,objectApi,'read');
    const {expression,returnType}=req.body??{};
    if(typeof expression!=='string'||!expression.trim()||expression.length>4000
      ||!['Number','Currency','Percent','Text','Date','DateTime','Time','Checkbox'].includes(returnType))
      throw new Error('Invalid formula definition');
    await authorizeFormulaReferences(rbac,actor,expression);
    const validatedReferences=await definitions.validateFormula(
      actor.tenant_id,objectApi,expression,returnType);
    res.json({valid:true,references:validatedReferences});
  }));
  app.delete('/api/metadata/objects/:apiName/fields/:fieldApi',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    res.json({object:await definitions.deleteField(actor.tenant_id,req.params.apiName,req.params.fieldApi)});
  }));
  app.get('/api/metadata/objects/:apiName/deleted-fields',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    res.json(await definitions.listDeletedFields(actor.tenant_id,req.params.apiName));
  }));
  app.post('/api/metadata/objects/:apiName/fields/:fieldApi/restore',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    res.json({object:await definitions.restoreField(actor.tenant_id,req.params.apiName,req.params.fieldApi)});
  }));
  app.get('/api/metadata/global-value-sets',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await globalValueSets.list(actor));
  }));
  app.post('/api/metadata/global-value-sets',route(async(req,res)=>{
    const actor=req.actor!;
    res.status(201).json(await globalValueSets.create(actor,req.body));
  }));
  app.put('/api/metadata/global-value-sets/:id',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await globalValueSets.update(actor,req.params.id,req.body));
  }));
  app.delete('/api/metadata/global-value-sets/:id',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await globalValueSets.delete(actor,req.params.id));
  }));
  app.get('/api/metadata/custom-labels',route(async(req,res)=>{
    const actor=req.actor!;
    const language=typeof req.query.language==='string'?req.query.language:undefined;
    res.json({labels:await customMetadata.listCustomLabels(actor.tenant_id,actor.user_id,language)});
  }));
  app.get('/api/metadata/custom-labels/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    const language=typeof req.query.language==='string'?req.query.language:'en';
    res.json({label:await customMetadata.getCustomLabel(actor.tenant_id,actor.user_id,req.params.apiName,language)});
  }));
  app.put('/api/metadata/custom-labels/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    const input={...req.body,apiName:req.params.apiName};
    res.json({label:await customMetadata.saveCustomLabel(actor.tenant_id,actor.user_id,input)});
  }));
  app.delete('/api/metadata/custom-labels/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    const language=typeof req.query.language==='string'?req.query.language:'en';
    await customMetadata.deleteCustomLabel(actor.tenant_id,actor.user_id,req.params.apiName,language);
    res.status(204).end();
  }));
  app.get('/api/metadata/custom-metadata-types',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({types:await customMetadata.listCustomMetadataTypes(actor.tenant_id,actor.user_id)});
  }));
  app.post('/api/metadata/custom-metadata-types',route(async(req,res)=>{
    const actor=req.actor!;
    res.status(201).json({type:await customMetadata.createCustomMetadataType(actor.tenant_id,actor.user_id,req.body)});
  }));
  app.get('/api/metadata/custom-metadata-types/:typeApi/records',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({records:await customMetadata.listCustomMetadataRecords(actor.tenant_id,actor.user_id,req.params.typeApi)});
  }));
  app.get('/api/metadata/custom-metadata-types/:typeApi/records/:recordKey',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({record:await customMetadata.getCustomMetadataRecord(
      actor.tenant_id,actor.user_id,req.params.typeApi,req.params.recordKey)});
  }));
  app.put('/api/metadata/custom-metadata-types/:typeApi/records/:recordKey',route(async(req,res)=>{
    const actor=req.actor!;
    const input={...req.body,recordKey:req.params.recordKey};
    res.json({record:await customMetadata.saveCustomMetadataRecord(
      actor.tenant_id,actor.user_id,req.params.typeApi,input)});
  }));
  app.delete('/api/metadata/custom-metadata-types/:typeApi/records/:recordKey',route(async(req,res)=>{
    const actor=req.actor!;
    await customMetadata.deleteCustomMetadataRecord(actor.tenant_id,actor.user_id,req.params.typeApi,req.params.recordKey);
    res.status(204).end();
  }));
  app.post('/api/metadata/custom-settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.status(201).json({setting:await customMetadata.createCustomSetting(actor.tenant_id,actor.user_id,req.body)});
  }));
  app.get('/api/metadata/custom-settings',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({settings:await customMetadata.listCustomSettings(actor.tenant_id,actor.user_id)});
  }));
  app.put('/api/metadata/custom-settings/:settingApi/values',route(async(req,res)=>{
    const actor=req.actor!;
    const {scope,ownerId,values}=req.body??{};
    res.json(await customMetadata.writeCustomSettingValues(
      actor.tenant_id,actor.user_id,req.params.settingApi,scope,values,ownerId));
  }));
  app.get('/api/metadata/custom-settings/:settingApi/values',route(async(req,res)=>{
    const actor=req.actor!;
    const targetUserId=typeof req.query.userId==='string'?req.query.userId:actor.user_id;
    res.json(await customMetadata.getCustomSettingValues(
      actor.tenant_id,actor.user_id,req.params.settingApi,targetUserId,
      typeof req.query.scope==='string'?req.query.scope as 'organization'|'profile'|'user':undefined,
      typeof req.query.ownerId==='string'?req.query.ownerId:undefined));
  }));
  app.get('/api/metadata/objects/:apiName/dependencies',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    res.json(await definitions.dependencies(actor.tenant_id,req.params.apiName));
  }));
  app.get('/api/metadata/objects/:apiName/field-dependencies',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    res.json(await definitions.fieldDependencies(actor.tenant_id,req.params.apiName));
  }));
  app.get('/api/metadata/objects/:apiName/history',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    const limit=Number(req.query.limit??100);
    res.json({history:await objectHistory.list(actor.tenant_id,req.params.apiName,limit)});
  }));
  app.get('/api/metadata/objects/:apiName/history/:revision',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    if(!/^[1-9][0-9]*$/.test(req.params.revision))throw new Error('Invalid metadata revision');
    res.json({change:await objectHistory.revision(actor.tenant_id,req.params.apiName,Number(req.params.revision))});
  }));
  // Restore only legacy page layouts from SQL history; optimistic revision,
  // package locks and OneEngine permissions are identical to ordinary edits.
  app.post('/api/metadata/objects/:apiName/history/:revision/restore-layouts',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await assertMetadataPackageEditable(db,actor.tenant_id,'object-config',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    if(!/^[1-9][0-9]*$/.test(req.params.revision))throw new Error('Invalid metadata revision');
    const revision=Number(req.params.revision);
    if(!Number.isSafeInteger(revision))throw new Error('Invalid metadata revision');
    const header=req.get('if-match')??'';
    if(!/^"(0|[1-9][0-9]*)"$/.test(header))
      throw new Error('Invalid page layout revision precondition');
    const expected=Number(header.slice(1,-1));
    if(!Number.isSafeInteger(expected))throw new Error('Invalid page layout revision precondition');
    const [history,current]=await Promise.all([
      objectHistory.revision(actor.tenant_id,req.params.apiName,revision),
      definitions.get(actor.tenant_id,req.params.apiName)
    ]);
    const input=restorableObjectLayoutSnapshot(history.after,req.params.apiName,current.label);
    const object=await definitions.replaceLayouts(actor.tenant_id,req.params.apiName,
      input,expected,actor.user_id);
    res.setHeader('Cache-Control','private, no-store');
    res.json({object,restoredFrom:revision});
  }));
  // Object Definition lifecycle is separate from field and layout edits.
  // Deleted definitions retain their SQL identity and are visible only to admins.
  app.get('/api/metadata/objects/deleted',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    res.setHeader('Cache-Control','private, no-store');
    res.json({objects:await objectLifecycle.listDeleted(actor.tenant_id)});
  }));
  app.get('/api/metadata/objects/:apiName/impact',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    res.setHeader('Cache-Control','private, no-store');
    res.json(await objectLifecycle.impact(actor.tenant_id,req.params.apiName));
  }));
  app.delete('/api/metadata/objects/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await assertMetadataPackageEditable(db,actor.tenant_id,'object-config',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    const revision=req.get('if-match')??'';
    if(!/^"(0|[1-9][0-9]*)"$/.test(revision))
      throw new Error('Invalid object revision precondition');
    res.json(await objectLifecycle.delete(actor.tenant_id,req.params.apiName,Number(revision.slice(1,-1))));
  }));
  app.post('/api/metadata/objects/:apiName/restore',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    const restored=await objectLifecycle.restore(actor.tenant_id,req.params.apiName);
    const object=await definitions.get(actor.tenant_id,req.params.apiName);
    const configuration=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,req.params.apiName);
    res.setHeader('Cache-Control','private, no-store');
    res.json({...restored,object:{...object,...configuration}});
  }));
  app.get('/api/metadata/objects/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'read');
    const object=await definitions.get(actor.tenant_id,req.params.apiName);
    const configuration=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,req.params.apiName);
    res.json({object:{...object,...configuration}});
  }));
  app.get('/api/apps/:appId/home-page',route(async(req,res)=>{
    const actor=req.actor!;
    const viewportWidth=Number(req.query.viewportWidth??0);
    const factor=String(req.query.formFactor??'Desktop');
    if(!['Desktop','Phone','Mobile','Tablet','Custom'].includes(factor))throw new Error('Invalid form factor');
    // Permission verification and profile lookup are independent SQL reads.
    // Run them concurrently; do not serialise the home-page request on both.
    const [,session]=await Promise.all([
      rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'read'),
      sessionMetadata(db,actor.tenant_id,actor.user_id)
    ]);
    const probeCustom=factor!=='Custom'&&Number.isInteger(viewportWidth)
      &&viewportWidth>=320&&viewportWidth<=10000;
    const [assigned,customHome]=await Promise.all([
      apps.homePage(actor.tenant_id,req.params.appId,
        appHomeFormFactor(factor),session.user.profileId),
      probeCustom
        ?apps.homePage(actor.tenant_id,req.params.appId,appHomeFormFactor('Custom'),session.user.profileId)
        :Promise.resolve(null)
    ]);
    // Start both loads together, but do not fail a valid Custom target if the
    // fallback assignment's layout is missing or fails to load.
    const [customPage,assignedResult]=await Promise.all([
      customHome?.apiName
        ?pages.load(actor.tenant_id,customHome.apiName,'Custom').then(result=>result.page)
        :Promise.resolve(null),
      assigned?.apiName
        ?pages.load(actor.tenant_id,assigned.apiName,runtimeLayoutVariant(factor))
          .then(result=>({page:result.page,error:null as unknown}))
          .catch(error=>({page:null,error}))
        :Promise.resolve({page:null,error:null as unknown})
    ]);
    const customAssigned=customPage?.activationAssignments?.some(assignment=>
      Array.isArray(assignment.formFactors)&&assignment.formFactors.includes('Custom')
      &&(assignment.scope==='Org Default'
        ||assignment.appId===req.params.appId&&
          (assignment.scope==='App Default'||assignment.profileId===session.user.profileId)));
    const targeted=customAssigned&&customPage?.customTargetEnabled===true
      &&viewportWidth>=(customPage.customTargetMinWidth??320)
      &&viewportWidth<=(customPage.customTargetMaxWidth??10000)
      ?customPage:null;
    if(!targeted&&assignedResult.error)throw assignedResult.error;
    const page=targeted??assignedResult.page;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({page});
  }));
  app.get(['/api/apps/:appId/in-screen-pages/:pageApiName','/api/apps/:appId/print-templates/:pageApiName'],route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'read');
    const page=await pages.resolveInScreenPage(actor.tenant_id,req.params.appId,
      req.params.pageApiName,String(req.query.formFactor??'Desktop'),
      req.path.split('/').at(-2)==='print-templates'?'Print Template':'In-Screen Page');
    if(!page)throw new Error('In-Screen Page not found');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({page:page.page});
  }));
  app.get('/api/apps/:appId/pages/:pageApiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'read');
    const factor=String(req.query.formFactor??'Desktop');
    const viewportWidth=Number(req.query.viewportWidth??0);
    const page=await pages.resolveAppPage(actor.tenant_id,req.params.appId,
      req.params.pageApiName,factor,viewportWidth);
    if(!page)throw new Error('Page not found');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({page:page.page});
  }));
  app.get('/api/metadata/relationships',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    const requested=req.query.objectApi;
    if(requested!==undefined&&(typeof requested!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_]*$/.test(requested)))
      throw new Error('Invalid relationship object');
    const relationships=await listRelationshipDefinitions(db,actor.tenant_id,
      requested as string|undefined);
    const checks=relationships.flatMap(edge=>[
      {resource:edge.sourceObject,action:'read'},
      {resource:edge.targetObject,action:'read'},
      {resource:edge.sourceObject+'.'+edge.fieldApiName,action:'read'}
    ]);
    const allowed=await rbac.allowedMany(actor.tenant_id,actor.user_id,checks);
    const visible=relationships.filter((_,index)=>allowed[index*3]===true
      &&allowed[index*3+1]===true&&allowed[index*3+2]===true);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({relationships:visible});
  }));
  app.get('/api/metadata/objects',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','read');
    const objects=await definitions.list(actor.tenant_id);
    const configurations=await objectManagerMetadata.loadForObjects(actor.tenant_id,
      objects.map(object=>object.apiName));
    const configured=objects.map(object=>{
      const configuration=configurations.get(object.apiName);
      return {...object,...configuration};
    });
    // Localization is opt-in on the read endpoint, preserving canonical
    // labels for metadata editing and avoiding accidental overwrites.
    if(typeof req.query.language==='string'){
      const language=requestedLabelLanguage(req.query.language);
      const [short]=language.split('-');
      const {rows}=await db.query<{object_api:string;field_api:string;language:string;value_text:string}>(`
        SELECT object_api,field_api,language,value_text FROM md_object_label_translations
        WHERE tenant_id=$1 AND language=ANY($2::text[])`,
        [actor.tenant_id,short===language?[language]:[short,language]]);
      res.setHeader('Content-Language',language);
      res.json({objects:applyObjectLabelTranslations(configured,rows,language)});
      return;
    }
    res.json({objects:configured});
  }));
  app.post('/api/metadata/objects',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','create');
    const {apiName,label}=req.body??{};
    if(typeof apiName!=='string'||typeof label!=='string')throw new Error('Invalid object definition');
    const payload=req.body??{};
    if(Array.isArray(payload.fields))for(const rawField of payload.fields){
      if(!rawField||typeof rawField!=='object'||Array.isArray(rawField))continue;
      const formula=(rawField as Record<string,unknown>).formula;
      if(!formula||typeof formula!=='object'||Array.isArray(formula))continue;
      const expression=(formula as Record<string,unknown>).expression;
      if(typeof expression==='string')await authorizeFormulaReferences(rbac,actor,expression);
    }
    const object=await definitions.create(actor.tenant_id,apiName,label,payload.fields??[],async client=>{
      await objectManagerMetadata.persistWithin(client,actor.tenant_id,apiName,{
        pluralLabel:payload.pluralLabel,description:payload.description??'',helpText:payload.helpText??'',
        settings:payload.settings??{},fieldSets:payload.fieldSets??[],actions:payload.actions??[],
        searchLayouts:payload.searchLayouts
      });
    });
    const configuration=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,apiName);
    res.status(201).json({object:{...object,...configuration}});
  }));
  app.put('/api/metadata/objects/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await assertMetadataPackageEditable(db,actor.tenant_id,'object-config',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
    await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
    const revisionHeader=req.get('if-match')??'';
    if(!/^"(0|[1-9][0-9]*)"$/.test(revisionHeader))throw new Error('Invalid page layout revision precondition');
    const draft=req.body;
    if(!draft||typeof draft!=='object'||Array.isArray(draft)||draft.apiName!==req.params.apiName)
      throw new Error('Invalid object draft');
    // Unsupported configuration must never appear successfully saved.
    if(draft.validationRules?.length||draft.formulaFields?.length)
      throw new Error('Invalid unsupported object configuration');
    const object=await definitions.replaceLayouts(actor.tenant_id,req.params.apiName,draft,
      Number(revisionHeader.slice(1,-1)),actor.user_id,async client=>{
        await objectManagerMetadata.persistWithin(client,
          actor.tenant_id,req.params.apiName,{
          pluralLabel:draft.pluralLabel,description:draft.description,helpText:draft.helpText,settings:draft.settings,
          fieldSets:draft.fieldSets,actions:draft.actions,searchLayouts:draft.searchLayouts,
          compactLayouts:draft.compactLayouts,compactLayoutAssignments:draft.compactLayoutAssignments,
          listViewButtons:draft.listViewButtons,customTab:draft.customTab,limits:draft.limits,
          relatedLookupFilters:draft.relatedLookupFilters,
          relatedLookupFilterLogic:draft.relatedLookupFilterLogic
          });
      });
    const configuration=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,req.params.apiName);
    res.json({object:{...object,...configuration}});
  }));
  app.post('/api/metadata/objects/:apiName/fields',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'object',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'FieldDefinition','create');
    const field=req.body?.field??req.body??{};
    const {apiName,dataType}=field;
    const relatedObject=field.relatedObject??field.relationship?.targetObject;
    if(typeof apiName!=='string'||typeof dataType!=='string'||
      (relatedObject!==undefined&&typeof relatedObject!=='string'))
      throw new Error('Invalid field definition');
    const formula=field.formula;
    if(formula&&typeof formula==='object'&&!Array.isArray(formula)
      &&typeof formula.expression==='string')
      await authorizeFormulaReferences(rbac,actor,formula.expression);
    let lookupConfiguration:Record<string,unknown>|undefined;
    if(req.body?.relatedLookupFilters!==undefined){
      await rbac.require(actor.tenant_id,actor.user_id,'ObjectDefinition','manage');
      await rbac.require(actor.tenant_id,actor.user_id,req.params.apiName,'edit');
      if(!Array.isArray(req.body.relatedLookupFilters)
        ||req.body.relatedLookupFilters.some((f:unknown)=>!f||typeof f!=='object'
          ||(f as {fieldApiName?:unknown}).fieldApiName!==apiName))
        throw new Error('Invalid new-field lookup filters');
      const previous=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,req.params.apiName);
      lookupConfiguration={
        relatedLookupFilters:[...previous.relatedLookupFilters,...req.body.relatedLookupFilters],
        relatedLookupFilterLogic:{...previous.relatedLookupFilterLogic,
          ...(req.body.relatedLookupFilterLogic??{})}
      };
    }
    await definitions.addField(actor.tenant_id,req.params.apiName,apiName,dataType,relatedObject,
      typeof field.label==='string'?field.label:undefined,field,
      lookupConfiguration?async client=>persistObjectLookupFilters(client,actor.tenant_id,
        req.params.apiName,lookupConfiguration!):undefined);
    // "Add to Page Layouts": record forms render from the object's Record Edit/View pages.
    const recordPagePlacement=Array.isArray(req.body?.pageLayoutIds)&&req.body.pageLayoutIds.length
      ?await placeNewFieldOnRecordPages(pages,rbac,actor.tenant_id,actor.user_id,req.params.apiName,apiName):[];
    const object=await definitions.get(actor.tenant_id,req.params.apiName);
    const configuration=await objectManagerMetadata.load(actor.tenant_id,actor.user_id,req.params.apiName);
    res.status(201).json({object:{...object,...configuration},recordPagePlacement});
  }));
  // Read-only single source of truth for the Page Builder ribbon. Property
  // definitions are global SQL records; applicability is one mapping per
  // supported component/property pair, never a duplicated definition.
  app.get('/api/metadata/builder-ribbon',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const [listed,registered,design2Slots,design2SlotRules]=await Promise.all([
      db.query<{
        id:string;label:string;tab:string;group_name:string;kind:string;sort_order:number;
        default_value:unknown;choices:unknown;component_api:string|null;
        control_kind_override:string|null;value_key:string|null;
        default_value_override:unknown;choices_override:unknown;min_value:number|null;
        enabled_when:unknown;enabled_when_override:unknown;
        max_value:number|null;field_select:boolean;
        design_row:number|null;design_width:number|null;design_height:number|null;design_order:number|null;
        design_caption:string|null;design_caption_width:number|null;design_display:string|null;
      }>(`SELECT p.property_key AS id,p.label,p.tab,p.section_group AS group_name,
          p.control_kind AS kind,p.sort_order,p.default_value,p.choices,
          p.min_value,p.max_value,p.field_select,p.enabled_when,
          p.design_row,p.design_width,p.design_height,p.design_order,
          p.design_caption,p.design_caption_width,p.design_display,
          r.component_api,r.control_kind_override,r.value_key,
          r.default_value_override,r.choices_override,r.enabled_when_override
        FROM md_builder_shared_properties p
        LEFT JOIN md_builder_ribbon_component_rules r
          ON r.property_key=p.property_key AND COALESCE(
            (SELECT v.enabled FROM md_data_loader_ribbon_visibility v
             WHERE v.tenant_id=$1 AND v.component_api=r.component_api
               AND v.property_key=r.property_key),r.enabled)=true
        WHERE p.property_key NOT IN ('firstTabCustom','firstTabCaption','firstTabValue')
        ORDER BY p.sort_order,r.component_api`,[actor.tenant_id]),
      db.query<{component_api:string}>(`SELECT component_api FROM md_builder_ribbon_components
        ORDER BY component_api`),
      db.query<{area:string;area_order:number;slot_key:string;row_no:number;
        order_no:number;width_px:number;height_px:number;property_key:string|null;
        fallback_key:string}>(`SELECT area,area_order,slot_key,row_no,order_no,width_px,height_px,
          property_key,fallback_key FROM md_builder_design2_slots
        ORDER BY area_order,row_no,order_no`),
      db.query<{component_api:string;area:string;slot_key:string;property_key:string}>(
        `SELECT component_api,area,slot_key,property_key
         FROM md_builder_design2_slot_rules ORDER BY component_api,area,slot_key`)
    ]);
    const properties=new Map<string,Record<string,unknown>>();
    for(const row of listed.rows){
      let item=properties.get(row.id);
      if(!item){
        item={
          id:row.id,label:row.label,tab:row.tab,group:row.group_name,kind:row.kind,
          components:[] as string[],default:row.default_value??undefined,
          choices:row.choices??[],min:row.min_value??undefined,max:row.max_value??undefined,
          field:row.field_select,designRow:row.design_row??undefined,
          enabledWhen:builderEnabledWhen(row.enabled_when),
          designWidth:row.design_width??undefined,designHeight:row.design_height??undefined,
          designOrder:row.design_order??undefined,
          designCaption:row.design_caption??undefined,
          designCaptionWidth:row.design_caption_width??undefined,
           designDisplay:row.design_display??'buttons',
          kindOverrides:{},defaultsOverrides:{},choicesOverrides:{},valueKeys:{},enabledWhenOverrides:{}
        };
        properties.set(row.id,item);
      }
      if(!row.component_api)continue;
      (item.components as string[]).push(row.component_api);
      if(row.control_kind_override)(item.kindOverrides as Record<string,string>)[row.component_api]=row.control_kind_override;
      if(row.value_key)(item.valueKeys as Record<string,string>)[row.component_api]=row.value_key;
      if(row.default_value_override!==null)(item.defaultsOverrides as Record<string,unknown>)[row.component_api]=row.default_value_override;
      if(row.choices_override!==null)(item.choicesOverrides as Record<string,unknown>)[row.component_api]=row.choices_override;
      // Per-component edit condition, e.g. Card Grid image height only for top/bottom.
      const enabledWhenOverride=builderEnabledWhen(row.enabled_when_override);
      if(enabledWhenOverride)(item.enabledWhenOverrides as Record<string,unknown>)[row.component_api]=enabledWhenOverride;
    }
    res.json({components:registered.rows.map(row=>row.component_api),
      properties:[...properties.values()],design2Slots:design2Slots.rows.map(slot=>({
        area:slot.area,areaOrder:slot.area_order,slotKey:slot.slot_key,
        row:slot.row_no,order:slot.order_no,width:slot.width_px,height:slot.height_px,
        propertyKey:slot.property_key,fallbackKey:slot.fallback_key
      })),design2SlotRules:design2SlotRules.rows.map(rule=>({
        componentApi:rule.component_api,area:rule.area,slotKey:rule.slot_key,
        propertyKey:rule.property_key
      }))});
  }));
  app.get('/api/component-library',route(async(req,res)=>{
    const actor=req.actor!;
    const [components,registered,canManage]=await Promise.all([
      library.list(actor.tenant_id,actor.user_id),
      db.query<{api_name:string;renderer_key:string}>(`SELECT api_name,renderer_key
        FROM md_component_definitions
        WHERE tenant_id=$1 AND enabled=true AND renderer_key='smart-bundled:' || api_name
        ORDER BY api_name`,[actor.tenant_id]),
      rbac.allowed(actor.tenant_id,actor.user_id,'ComponentDefinition','create')
    ]);
    res.json({components,registered:registered.rows.map(row=>({
      apiName:row.api_name,rendererKey:row.renderer_key
    })),canManage});
  }));
  app.post('/api/component-library',route(async(req,res)=>{
    const actor=req.actor!;
    res.status(201).json({component:await library.save(actor.tenant_id,actor.user_id,req.body)});
  }));
  app.put('/api/component-library/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'component',req.params.apiName);
    res.json({component:await library.save(actor.tenant_id,actor.user_id,req.body,req.params.apiName)});
  }));
  app.post('/api/component-library/:apiName/publish',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'component',req.params.apiName);
    res.json({component:await library.publish(actor.tenant_id,actor.user_id,req.params.apiName)});
  }));
  app.post('/api/component-library/:apiName/rollback',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'component',req.params.apiName);
    res.json({component:await library.publish(actor.tenant_id,actor.user_id,
      req.params.apiName,req.body?.version)});
  }));
  app.delete('/api/component-library/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'component',req.params.apiName);
    await library.remove(actor.tenant_id,actor.user_id,req.params.apiName);
    res.status(204).end();
  }));
  // Authenticated publication of display-only metadata. No cached record data or grants.
  app.get('/api/metadata/offline-publication',route(async(req,res)=>{
    const actor=req.actor!;
    await Promise.all(['ObjectDefinition','PageDefinition','ComponentDefinition'].map(
      resource=>rbac.require(actor.tenant_id,actor.user_id,resource,'read')));
    const [objects,publishedPages,availableApps,library]=await Promise.all([
      definitions.list(actor.tenant_id),
      pages.list(actor.tenant_id),
      apps.listMetadata(actor.tenant_id),
      components.list(actor.tenant_id)
    ]);
    const content={
      pages:publishedPages,
      apps:await permittedApps(rbac,actor.tenant_id,actor.user_id,availableApps),
      objects,components:library
    };
    // Hash the exact JSON-safe content that will be transmitted. Repository
    // metadata can contain optional properties or values with JSON serializers;
    // a digest over pre-serialization objects may not match the browser's
    // JSON.parse response, causing valid publications to be rejected.
    const wireContent=JSON.parse(JSON.stringify(content)) as typeof content;
    const digest=createHash('sha256').update(JSON.stringify(wireContent)).digest('hex');
    res.setHeader('Cache-Control','no-store');
    res.json({content:wireContent,publication:{
      revision:{version:1,publishedAt:Date.now(),digest},
      verifiedDigest:digest,minimumVersion:1
    }});
  }));
  // Builder-only metadata is loaded on demand; never include it in tenant login bootstrap.
  app.get('/api/metadata/flow-capabilities',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
    res.setHeader('Cache-Control','no-store');
    res.json(await loadFlowCapabilityCatalog(db,actor.tenant_id));
  }));
  app.get('/api/metadata/components',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ComponentDefinition','read');
    res.json({components:await components.list(actor.tenant_id)});
  }));
  // New pages are created exactly once, including their first immutable draft.
  // No existing (including archived) page may be overwritten or resurrected.
  app.post('/api/metadata/pages',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    const name=req.body?.apiName;
    if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)||name!==name.toLowerCase())
      throw new Error('New Page API names must be lowercase');
    if(req.body?.status!=='Draft')throw new Error('New Pages must start as Draft');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',name);
    const variant=pageLayoutVariant(req.body?.layoutVariant??'Desktop');
    const page=await db.transaction(async()=>{
      await pages.save(actor.tenant_id,name,req.body,true);
      return pages.saveLayoutDraft(actor.tenant_id,name,variant,
        {...req.body,draftRevision:0,revision:undefined},actor.user_id);
    });
    res.setHeader('Cache-Control','private, no-store');
    res.status(201).json({page});
  }));
  app.get('/api/metadata/pages',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    res.json({pages:await pages.list(actor.tenant_id)});
  }));
  app.get('/api/metadata/pages/:apiName/layouts/:variant/editor',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const variant=pageLayoutVariant(req.params.variant);
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.editor(actor.tenant_id,req.params.apiName,variant)});
  }));
  app.put('/api/metadata/pages/:apiName/layouts/:variant/draft',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',req.params.apiName);
    const variant=pageLayoutVariant(req.params.variant);
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.saveLayoutDraft(actor.tenant_id,req.params.apiName,variant,req.body,actor.user_id)});
  }));
  app.post('/api/metadata/pages/:apiName/layouts/:variant/publish',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',req.params.apiName);
    const variant=pageLayoutVariant(req.params.variant);
    const expected=req.body?.draftRevision;
    if(expected!==undefined&&(!Number.isInteger(expected)||expected<1))throw new Error('Invalid draft revision');
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.publishLayout(actor.tenant_id,req.params.apiName,variant,expected,actor.user_id)});
  }));
  app.get('/api/metadata/pages/:apiName/layouts/:variant/history',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    res.setHeader('Cache-Control','private, no-store');
    res.json({versions:await pages.layoutHistory(actor.tenant_id,req.params.apiName,pageLayoutVariant(req.params.variant))});
  }));
  app.post('/api/metadata/pages/:apiName/layouts/:variant/restore',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',req.params.apiName);
    const version=req.body?.version;
    if(!Number.isInteger(version)||version<1)throw new Error('Invalid page revision');
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.rollbackLayout(actor.tenant_id,req.params.apiName,pageLayoutVariant(req.params.variant),version,actor.user_id)});
  }));
  app.put('/api/metadata/pages/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',req.params.apiName);
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    // Existing legacy page identities remain valid until explicitly migrated.
    // Newly created pages must use canonical lowercase identifiers.
    const found=await db.query('SELECT 1 FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2',
      [actor.tenant_id,req.params.apiName]);
    if(!found.rowCount&&(!req.body?.apiName||req.body.apiName!==String(req.body.apiName).toLowerCase()))
      throw new Error('New Page API names must be lowercase');
    const page=await pages.save(actor.tenant_id,req.params.apiName,req.body);
    res.json({page});
  }));
  app.get('/api/named-credentials/readiness',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await namedCredentials.readiness(actor.tenant_id,actor.user_id));
  }));
  // Reverse proxies may forward HTTPS traffic to this server over plain HTTP.
  // Provider-facing webhook URLs must use HTTPS, except explicit local development.
  const credentialWithWebhookUrl=(req:Request,credential:Record<string,unknown>)=>{
    const host=req.get('host')??'';
    const local=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
    const safeHost=/^[A-Za-z0-9.:-]+$/.test(host) && !host.includes('..');
    return {...credential,
      webhookCallbackUrl:credential.webhookId && safeHost
        ?(local?'http':'https')+'://'+host+'/api/inbound-webhooks/'+encodeURIComponent(String(credential.webhookId))
        :null
    };
  };
  app.get('/api/named-credentials',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    const all=await namedCredentials.list(actor.tenant_id,actor.user_id);
    const readiness=await namedCredentials.readiness(actor.tenant_id,actor.user_id);
    if(all.length===0){
      const {rows:context}=await db.query<{db_name:string;tenant_exists:boolean}>(
        'SELECT current_database() AS db_name, EXISTS(SELECT 1 FROM md_tenants WHERE id=$1) AS tenant_exists',
        [actor.tenant_id]);
      console.warn('[named-credentials] empty tenant-scoped list', {
        database:context[0]?.db_name,tenantExists:context[0]?.tenant_exists,tenantId:actor.tenant_id
      });
    }
    res.json({credentials:all.map(item=>credentialWithWebhookUrl(req,item)),...readiness});
  }));
  app.post('/api/named-credentials',route(async(req,res)=>{
    const actor=req.actor!;
    const credential=await namedCredentials.create(actor.tenant_id,actor.user_id,req.body);
    if(!credential)throw new Error('Named Credential creation unavailable');
    const webhook=typeof req.body?.webhookRequired==='boolean'
      ?await namedCredentials.configureWebhook(actor.tenant_id,actor.user_id,
         credential.id,req.body.webhookRequired,req.body.webhookSecret||undefined,req.body.webhookVerifyToken||undefined)
      :null;
    const saved=(await namedCredentials.list(actor.tenant_id,actor.user_id))
       .find(item=>item.id===credential.id)??credential;
    res.status(201).json({credential:credentialWithWebhookUrl(req,saved),
      ...(webhook?.verifyToken?{webhookVerifyToken:webhook.verifyToken}:{})});
  }));
  app.put('/api/named-credentials/:id',route(async(req,res)=>{
    const actor=req.actor!;
    const credential=await namedCredentials.update(actor.tenant_id,actor.user_id,req.params.id,req.body);
    if(!credential)throw new Error('Named Credential update unavailable');
    const webhook=typeof req.body?.webhookRequired==='boolean'
      ?await namedCredentials.configureWebhook(actor.tenant_id,actor.user_id,
         credential.id,req.body.webhookRequired,req.body.webhookSecret||undefined,req.body.webhookVerifyToken||undefined)
      :null;
    const saved=(await namedCredentials.list(actor.tenant_id,actor.user_id))
       .find(item=>item.id===credential.id)??credential;
    res.json({credential:credentialWithWebhookUrl(req,saved),
      ...(webhook?.verifyToken?{webhookVerifyToken:webhook.verifyToken}:{})});
  }));
  app.get('/api/named-credentials/:id/webhook-verify-token',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json(await namedCredentials.revealWebhookVerifyToken(actor.tenant_id,actor.user_id,req.params.id));
  }));
  app.post('/api/named-credentials/:id/oauth/start',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','no-store');
    res.json(await oauth.start(actor.tenant_id,actor.user_id,req.params.id));
  }));
  // Read-only SQL Formula compiler: metadata is resolved server-side and session identity
  // comes from the signed-in actor. SQL values are bound, never interpolated.
  app.post('/api/formulas/evaluate',route(async(req,res)=>{
    const actor=req.actor!;
    const {formula,objectApi,recordId,state}=req.body??{};
    if(typeof formula!=='string'||!formula.trim()||formula.length>4000||
      (objectApi!==undefined&&typeof objectApi!=='string')||
      (recordId!==undefined&&typeof recordId!=='string'))
      throw Error('Invalid SQL Formula request');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({value:await evaluateFormulaSql(db,rbac,records,actor,
      {formula,objectApi,recordId,state})});
  }));
  // Same SQL Formula, many records, ONE query: avoids one HTTP request and one
  // permission lookup per record when a grid/list shows the same formula per row.
  app.post('/api/formulas/evaluate-batch',route(async(req,res)=>{
    const actor=req.actor!;
    const {formula,objectApi,recordIds,state}=req.body??{};
    if(typeof formula!=='string'||!formula.trim()||formula.length>4000||
      typeof objectApi!=='string'||!Array.isArray(recordIds))
      throw Error('Invalid SQL Formula request');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({values:await evaluateFormulaSql(db,rbac,records,actor,
      {formula,objectApi,recordIds,state})});
  }));
  // Every formula a page needs, ONE request. Identity, field metadata, permissions and
  // identical aggregates are resolved once; each item returns {value} or {error}.
  app.post('/api/formulas/evaluate-many',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json({results:await evaluateFormulaSqlMany(db,rbac,records,actor,req.body?.items)});
  }));
  // One authenticated HTTP request for only a validated contiguous data prefix.
  // Browser-only actions always execute after the server transaction returns.
  app.post('/api/action-formulas/execute-data',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    if(!await tenantServerFormulaEnabled(db,actor.tenant_id)){
      res.json({supported:false});return;
    }
    const formula=req.body?.formula,scope=req.body?.scope,steps=req.body?.dataSteps;
    if(typeof formula!=='string'||formula.length>4000||!formula.trim()||
      !scope||typeof scope!=='object'||Array.isArray(scope)||
      !Number.isSafeInteger(steps)||steps<1||
      Object.keys(scope).length>80||
      Object.keys(scope).some(key=>!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)||
        ['constructor','prototype','__proto__'].includes(key))){
      res.json({supported:false});return;
    }
    const split=splitServerDataActionPlan(formula);
    if(!split||split.dataSteps!==steps){
      res.json({supported:false});return;
    }
    const started=performance.now();
    const stats={operations:0,reusedReads:0,steps:[] as string[]};
    const result=await executeServerDataAction(db,records,actor,formula,scope,steps,rbac,stats);
    // Server time and work for this save, visible in the browser's network timing.
    res.setHeader('Server-Timing','action;dur='+(performance.now()-started).toFixed(1)
      +',ops;desc="'+stats.operations+' operations, '+stats.reusedReads+' reused reads"'
      +',steps;desc="'+stats.steps.join(' | ').replace(/["\\]/g,'')+'"');
    res.json(result);
  }));
  app.get('/api/action-formulas/credentials',route(async(req,res)=>{
    const actor=req.actor!;
    const credentials=await namedCredentials.list(actor.tenant_id,actor.user_id);
    res.setHeader('Cache-Control','private, no-store');
    res.json(credentials.filter(item=>item.enabled).map(({name,label})=>({apiName:name,label})));
  }));
  app.post('/api/action-formulas/verify-pin',route(async(req,res)=>{
    const actor=req.actor!;
    const {userId,pin}=req.body??{};
    if(userId!==undefined&&(typeof userId!=='string'||!/^[0-9a-f-]{36}$/i.test(userId)))
      throw Error('VERIFYPIN requires a valid user ID');
    // Compares against the stored scrypt hash with per-user lockout; the PIN is never stored or echoed.
    const valid=await new TillPinService(db).verify(actor.tenant_id,userId??actor.user_id,pin,actor.user_id);
    res.setHeader('Cache-Control','private, no-store');
    res.json({valid});
  }));
  app.post('/api/action-formulas/record-payment',route(async(req,res)=>{
    const actor=req.actor!;
    const {invoiceId,amount,method,note,reference}=req.body??{};
    // Normal Invoice edit + CashLedger create permissions apply inside the service.
    const result=await recordInvoicePayment({db,records,query:new FlowRecordQuery(db,rbac)},
      actor.tenant_id,actor.user_id,{invoiceId,amount,method,note,reference});
    res.setHeader('Cache-Control','private, no-store');
    res.json(result);
  }));
  app.post('/api/action-formulas/communication',route(async(req,res)=>{
    const actor=req.actor!;
    const {channel,credential,values}=req.body??{};
    if(!['EMAIL','WHATSAPP','SMS'].includes(channel))throw Error('Invalid communication channel');
    const result=await sendActionCommunication(db,rbac,namedCredentials,
      actor.tenant_id,actor.user_id,channel,credential,values,randomUUID());
    res.json(result);
  }));
  app.post('/api/named-credentials/:id/test',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'NamedCredential','manage');
    // A connection test is read-only and cannot follow an arbitrary URL or
    // bypass tenant credential activation, licence checks or OneEngine RBAC.
    const path=req.body?.path===undefined?'':req.body.path;
    if(typeof path!=='string'||path.length>512||path.startsWith('/')
      ||path.includes('\\')||path.includes('..')
      ||(path!==''&&!/^[A-Za-z0-9_./-]+$/.test(path)))
      throw new Error('Invalid Named Credential test path');
    const result=await namedCredentials.callout(
      actor.tenant_id,actor.user_id,
      {namedCredentialId:req.params.id,method:'GET',path},{},'credential-connectivity-test');
    res.json({success:result.status>=200&&result.status<300,status:result.status});
  }));
  app.post('/api/named-credentials/:id/rotate',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({credential:await namedCredentials.rotate(actor.tenant_id,actor.user_id,req.params.id)});
  }));
  app.patch('/api/named-credentials/:id/enabled',route(async(req,res)=>{
    const actor=req.actor!;
    const credential=await namedCredentials.setEnabled(actor.tenant_id,actor.user_id,req.params.id,req.body?.enabled);
    res.json({credential});
  }));
  app.delete('/api/named-credentials/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await namedCredentials.remove(actor.tenant_id,actor.user_id,req.params.id);
    res.status(204).end();
  }));
  app.get('/api/metadata/dashboards/:apiName/snapshots',route(async(req,res)=>{
    res.json({snapshots:await dashboardSnapshots.list(req.actor!,req.params.apiName)});
  }));
  app.post('/api/metadata/dashboards/:apiName/snapshots',route(async(req,res)=>{
    res.status(201).json({snapshot:await dashboardSnapshots.create(req.actor!,req.params.apiName,req.body)});
  }));
  app.delete('/api/metadata/dashboards/:apiName/snapshots/:id',route(async(req,res)=>{
    await dashboardSnapshots.remove(req.actor!,req.params.apiName,req.params.id);
    res.status(204).end();
  }));
  app.get('/api/metadata/dashboards/:apiName/subscriptions',route(async(req,res)=>{
    res.json({subscriptions:await dashboardSubscriptions.list(req.actor!,req.params.apiName)});
  }));
  app.post('/api/metadata/dashboards/:apiName/subscriptions',route(async(req,res)=>{
    res.status(201).json({subscription:await dashboardSubscriptions.save(req.actor!,req.params.apiName,req.body)});
  }));
  app.put('/api/metadata/dashboards/:apiName/subscriptions/:id',route(async(req,res)=>{
    res.json({subscription:await dashboardSubscriptions.save(req.actor!,req.params.apiName,req.body,req.params.id)});
  }));
  app.delete('/api/metadata/dashboards/:apiName/subscriptions/:id',route(async(req,res)=>{
    await dashboardSubscriptions.remove(req.actor!,req.params.apiName,req.params.id);
    res.status(204).end();
  }));
  app.post('/api/metadata/dashboards/:apiName/subscriptions/:id/run',route(async(req,res)=>{
    res.json({subscription:await dashboardSubscriptions.run(req.actor!,req.params.apiName,req.params.id)});
  }));
  // Universal SQL-backed definition API. Names are compatibility routes, data is SQL.
  app.post('/api/integration-connections/:id/test',route(async(req,res)=>{
    const actor=req.actor!;
    const connection=await systemDefinitions.testConnection(
      actor.tenant_id,actor.user_id,req.params.id,
      (credentialId,path)=>namedCredentials.callout(actor.tenant_id,actor.user_id,
        {namedCredentialId:credentialId,method:'GET',path},{},'integration-connection-test'));
    res.json({connection});
  }));
  const definitionPaths:Record<string,DefinitionKind>={
    '/metadata/platform-events':'platform-events',
    '/metadata/email-alerts':'email-alerts',
    '/metadata/approval-processes':'approval-processes',
    '/metadata/dashboards':'dashboards',
    '/metadata/dashboard-folders':'dashboard-folders',
    '/metadata/dashboard-territories':'dashboard-territories',
    '/metadata/report-folders':'report-folders',
    '/metadata/reports':'reports',
    '/connector-providers':'connector-providers',
    '/integration-connections':'integration-connections'
  };
  for(const [path,kind] of Object.entries(definitionPaths)) {
    app.get('/api'+path,route(async(req,res)=>{
      const actor=req.actor!;
      const items=await systemDefinitions.list(actor.tenant_id,actor.user_id,kind);
      res.json({[definitionKinds[kind]]:items});
    }));
    app.post('/api'+path,route(async(req,res)=>{
      const actor=req.actor!;
      const definition=await systemDefinitions.save(actor.tenant_id,actor.user_id,kind,req.body);
      res.status(201).json({[kind==='email-alerts'?'emailAlert':kind==='approval-processes'?'approvalProcess':kind==='platform-events'?'platformEvent':'definition']:definition});
    }));
    app.put('/api'+path+'/:apiName',route(async(req,res)=>{
      const actor=req.actor!;
      if(req.params.apiName!==req.body?.apiName)throw new Error('Invalid definition identity');
      const definition=await systemDefinitions.save(actor.tenant_id,actor.user_id,kind,req.body);
      res.json({[kind==='email-alerts'?'emailAlert':kind==='approval-processes'?'approvalProcess':kind==='platform-events'?'platformEvent':'definition']:definition});
    }));
    app.delete('/api'+path+'/:apiName',route(async(req,res)=>{
      const actor=req.actor!;
      await systemDefinitions.remove(actor.tenant_id,actor.user_id,kind,req.params.apiName);
      res.status(204).end();
    }));
  }
  app.get('/api/connector-apps/capabilities',route(async(req,res)=>{
    const actor=req.actor!;
    const decisions=await rbac.allowedMany(actor.tenant_id,actor.user_id,[
      {resource:'AppExchange',action:'read'},
      {resource:'AppExchange',action:'manage'},
      {resource:'NamedCredential',action:'read'},
      {resource:'NamedCredential',action:'manage'},
      {resource:'AppExchange',action:'install'},
      {resource:'Licence',action:'manage'}
    ]);
    res.json({view:decisions[0],edit:decisions[1],secrets:decisions[2],
      test:decisions[3],install:decisions[4]||decisions[1],licence:decisions[5]});
  }));
  app.get('/api/connector-apps/catalog',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','read');
    res.json(await apps.marketplace(actor.tenant_id));
  }));
  app.get('/api/metadata/flow-history',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json(await flowRunHistory(db,rbac,actor.tenant_id,actor.user_id,{
      status:req.query.status,limit:req.query.limit,cursor:req.query.cursor
    }));
  }));
  app.get('/api/metadata/flow-logs',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await flows.failedLogs(actor.tenant_id,actor.user_id));
  }));
  app.delete('/api/metadata/flow-interviews/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await flows.cancelInterview(actor.tenant_id,actor.user_id,req.params.id);
    res.status(204).end();
  }));
  app.post('/api/flow-interviews/:id/next',route(async(req,res)=>{
    const actor=req.actor!;
    const result=await flows.advanceInterview(actor.tenant_id,actor.user_id,req.params.id,req.body??{});
    res.setHeader('Cache-Control','private, no-store');
    res.json(result);
  }));
  app.get('/api/metadata/flow-interviews',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await flows.pendingInterviews(actor.tenant_id,actor.user_id));
  }));
  app.post('/api/metadata/flows/:apiName/validate',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await flows.validateDraft(actor.tenant_id,actor.user_id,req.params.apiName,req.body));
  }));
  app.post('/api/metadata/flows/:apiName/deactivate',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'flow',req.params.apiName);
    res.json(await flows.deactivate(actor.tenant_id,actor.user_id,req.params.apiName));
  }));
  app.get('/api/metadata/flows',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
    res.json({flows:await flows.list(actor.tenant_id)});
  }));
  app.get('/api/metadata/flows/list',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
    res.json(await flows.listPage(actor.tenant_id,req.query.page,req.query.search??'',req.query.flowType??''));
  }));
  app.get('/api/metadata/flows/:apiName/versions/:version',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
    res.json({version:await flows.loadEditorVersion(actor.tenant_id,
      req.params.apiName,req.params.version)});
  }));
  app.get('/api/metadata/components/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'ComponentDefinition','read');
    res.json({component:await components.resolve(actor.tenant_id,req.params.apiName)});
  }));
  app.get('/api/metadata/pages/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    res.json(await pages.load(actor.tenant_id,req.params.apiName));
  }));
  // Self-service till PIN setup requires an authenticated session and current password.
  // The PIN is never served by Object CRUD or returned in responses.
  app.post('/api/me/till-pin',route(async(req,res)=>{
    const actor=req.actor!;
    const password=req.body?.password;
    const pin=req.body?.pin;
    if(typeof password!=='string'||typeof pin!=='string')throw new Error('Invalid PIN setup');
    const authCheck=await db.query<{password_hash:string}>(
      'SELECT password_hash FROM md_users WHERE tenant_id=$1 AND id=$2 AND enabled=true',
      [actor.tenant_id,actor.user_id]);
    if(!authCheck.rows[0]||!await new AuthenticationService(db).verifyPassword(password,authCheck.rows[0].password_hash))
      throw new Error('Invalid current password');
    await new TillPinService(db).set(actor.tenant_id,actor.user_id,pin);
    res.status(204).end();
  }));
  app.post('/api/flows/:apiName/execute',route(async(req,res)=>{
    const actor=req.actor!;
    const inputs=req.body?.inputs??req.body??{};
    if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw new Error('Invalid Flow inputs');
    res.json(await flows.execute(actor.tenant_id,req.params.apiName,actor.user_id,inputs));
  }));
  app.get('/api/metadata/flows/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'FlowDefinition','read');
    res.json({flow:await flows.loadEditor(actor.tenant_id,req.params.apiName)});
  }));
  app.put('/api/metadata/flows/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'flow',req.params.apiName);
    res.json({flow:await flows.saveEditor(actor.tenant_id,actor.user_id,req.params.apiName,req.body)});
  }));
  app.delete('/api/metadata/flows/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await assertMetadataPackageEditable(db,actor.tenant_id,'flow',req.params.apiName);
    await flows.deleteEditor(actor.tenant_id,actor.user_id,req.params.apiName);
    res.status(204).end();
  }));
  // Explicit licence administration is separate from installation and activation.
  app.post('/api/connector-apps/:appKey/licence',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Licence','manage');
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(req.params.appKey))
      throw new Error('Invalid connector app');
    await db.transaction(async client=>{
      const found=await client.query<{id:string}>(
        'SELECT id FROM md_apps WHERE api_name=$1 AND enabled=true AND (tenant_owner_id IS NULL OR tenant_owner_id=$2)',
        [req.params.appKey,actor.tenant_id]);
      if(!found.rows[0])throw new Error('Connector application not found');
      await client.query(`INSERT INTO md_app_entitlements(tenant_id,app_id,active,expires_at)
        VALUES ($1,$2,true,NULL)
        ON CONFLICT(tenant_id,app_id) DO UPDATE SET active=true,expires_at=NULL`,
        [actor.tenant_id,found.rows[0].id]);
      await client.query(
        'INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,$3)',
        [actor.tenant_id,actor.user_id,'ConnectorLicenceGranted']);
    });
    res.json({granted:true});
  }));
  app.post('/api/apps/:apiName/install',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    if(req.body?.pageSeed)await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','create');
    const result=await appPublishing.install(actor,req.params.apiName,req.body?.pageSeed);
    if(!result.packaged){res.status(204).end();return;}
    res.json(result);
  }));
  // What installing a published AppExchange app will create, reuse or still needs.
  app.get('/api/apps/:apiName/install-preview',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','read');
    res.setHeader('Cache-Control','private, no-store');
    res.json(await appPublishing.preview(actor,req.params.apiName));
  }));
  // Publish a tenant-authored app to AppExchange (OneEngine).
  app.get('/api/platform/apps/:apiName/publish',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await appPublishing.discover(req.actor!,req.params.apiName));
  }));
  app.post('/api/platform/apps/:apiName/publish',route(async(req,res)=>{
    res.status(201).json(await appPublishing.publish(req.actor!,req.params.apiName,req.body));
  }));
  app.delete('/api/metadata/apps/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    await apps.uninstall(actor.tenant_id,req.params.apiName);
    res.status(204).end();
  }));
  app.get('/api/metadata/route-aliases',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','read');
    res.json(await apps.listAliases(actor.tenant_id));
  }));
  app.put('/api/metadata/route-aliases/:appId/:slug',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'manage');
    res.json({alias:await apps.saveAlias(actor.tenant_id,req.params.appId,req.params.slug,req.body??{})});
  }));
  app.delete('/api/metadata/route-aliases/:appId/:slug',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'manage');
    await apps.disableAlias(actor.tenant_id,req.params.appId,req.params.slug,req.body?.expectedVersion);
    res.status(204).end();
  }));
  app.get('/api/routes/resolve/:appId/:slug',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.appId,'read');
    const resolution=await apps.resolveAlias(actor.tenant_id,req.params.appId,req.params.slug);
    if(resolution.kind==='Record List'){
      await rbac.require(actor.tenant_id,actor.user_id,'Tab:'+resolution.targetApiName,'read');
      await rbac.require(actor.tenant_id,actor.user_id,resolution.targetApiName,'read');
    }
    else if(resolution.kind==='App Page')
      await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    res.json({path:resolution.path});
  }));
  // Tenant-scoped self-service diagnostics; never grant or bypass permissions.
  app.get('/api/metadata/apps/:apiName/access',route(async(req,res)=>{
    const actor=req.actor!;
    const appName=req.params.apiName;
    if(!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(appName))throw Error('Invalid app name');
    const {rows}=await db.query<{installed:boolean;licensed:boolean;enabled:boolean}>(`
      SELECT (i.app_id IS NOT NULL) AS installed,
        (e.app_id IS NOT NULL AND e.active=true AND
        (e.expires_at IS NULL OR e.expires_at>now())) AS licensed,
        a.enabled
      FROM md_apps a
      LEFT JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
      LEFT JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
      LEFT JOIN md_tenant_app_metadata m ON m.app_id=a.id AND m.tenant_id=$1
      WHERE COALESCE(m.api_name,a.api_name)=$2
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
      LIMIT 1`,[actor.tenant_id,appName]);
    const found=rows[0],installed=found?.installed===true;
    const licensed=found?.licensed===true,enabled=found?.enabled===true;
    const permitted=installed&&licensed&&enabled
      &&await rbac.allowed(actor.tenant_id,actor.user_id,'App:'+appName,'read');
    res.setHeader('Cache-Control','private, no-store');
    res.json({installed,licensed,enabled,permitted});
  }));
  app.get('/api/metadata/apps',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({apps:await permittedApps(rbac,actor.tenant_id,actor.user_id,await apps.listMetadata(actor.tenant_id))});
  }));
  app.get('/api/metadata/landing-bootstrap',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization, Cookie');
    res.json(await landingBootstrap(actor.tenant_id,actor.user_id));
  }));
  app.post('/api/metadata/apps',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    await rbac.require(actor.tenant_id,actor.user_id,'Licence','manage');
    const app=await apps.saveMetadata(actor.tenant_id,req.body?.apiName,req.body,false);
    res.status(201).json({app});
  }));
  app.put('/api/metadata/apps/:apiName',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+req.params.apiName,'manage');
    res.json({app:await apps.saveMetadata(actor.tenant_id,req.params.apiName,req.body,true)});
  }));

  // Tenant references resolve the real, tenant-scoped md_tenants row. They do
  // not create shadow records or disclose other tenants.
  app.get('/api/records/Tenant',route(async(req,res)=>{
    const actor=req.actor!;
    const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
    res.setHeader('Cache-Control','private, no-store');
    res.json(await nativeTenantRecords.list(actor,limit,offset,req.query.search));
  }));
  app.get('/api/records/Tenant/:id',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await nativeTenantRecords.get(req.actor!,req.params.id));
  }));

  // The User object is a secure view of md_users, never a second md_records copy.
  const userRecord=async(row:{id:string;email:string;display_name:string;enabled:boolean;landing_app_api:string;reports_to_user_id:string|null},actor:Actor)=>{
    const fields={Name:row.display_name||row.email,Email:row.email,Username:row.email,
      IsActive:row.enabled,Tenant:actor.tenant_id,ReportsToId:row.reports_to_user_id};
    const checks=Object.keys(fields).map(field=>({resource:'User.'+field,action:'read'}));
    const allowed=await rbac.allowedMany(actor.tenant_id,actor.user_id,checks);
    return {Id:row.id,...Object.fromEntries(Object.entries(fields).filter((_,i)=>allowed[i])),
      LandingApp:row.landing_app_api};
  };
  const requireUserFields=async(actor:Actor,values:Record<string,unknown>,action:string)=>{
    for(const field of Object.keys(values))if(field!=='LandingApp')
      await rbac.require(actor.tenant_id,actor.user_id,'User.'+field,action);
  };
  const userFields=(input:Record<string,unknown>,creating:boolean)=>{
    const allowed=new Set(['Name','Email','Username','IsActive','Password','Tenant','LandingApp','ReportsToId']);
    for(const key of Object.keys(input))if(!allowed.has(key))throw new Error('Unknown field: '+key);
    const email=input.Email??input.Username;
    if(email!==undefined&&(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)))throw new Error('Invalid user email');
    if(input.Name!==undefined&&typeof input.Name!=='string')throw new Error('Invalid user name');
    if(input.ReportsToId!==undefined&&input.ReportsToId!==null
      &&(typeof input.ReportsToId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.ReportsToId)))
      throw new Error('Invalid reporting manager');
    if(input.Tenant!==undefined&&(typeof input.Tenant!=='string'||!/^[0-9a-f-]{36}$/i.test(input.Tenant)))throw new Error('Invalid tenant');
    if(input.IsActive!==undefined&&typeof input.IsActive!=='boolean')throw new Error('Invalid active flag');
    if(input.LandingApp!==undefined&&(typeof input.LandingApp!=='string'
      ||(input.LandingApp!=='Setup'&&!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(input.LandingApp))))
      throw new Error('Invalid landing app');
    if(creating&&(!email||typeof input.Password!=='string'))throw new Error('Invalid user credentials');
    if(!creating&&input.Password!==undefined)throw new Error('Invalid password edit');
    return {email:email as string|undefined,name:input.Name as string|undefined,
      enabled:input.IsActive as boolean|undefined,password:input.Password as string|undefined,
      tenant:input.Tenant as string|undefined,landingApp:input.LandingApp as string|undefined,
      reportingTo:input.ReportsToId as string|null|undefined,role:undefined};
  };
  const requireUserReportingScope=async(tenantId:string,userId:string,target:string)=>{
    const {rows}=await db.query<{allowed:boolean}>(`
      SELECT COALESCE(md_effective_reporting_scope($1,$2,'User') IS NULL
        OR md_reporting_scope($1,$2,$3,md_effective_reporting_scope($1,$2,'User')),false) AS allowed
      WHERE EXISTS(SELECT 1 FROM md_users WHERE tenant_id=$1 AND id=$3)`,[tenantId,userId,target]);
    if(!rows[0]?.allowed)throw new Error('Permission denied');
  };
  const accountAssist=new AccountAssistService(db,rbac,auth,requireUserReportingScope);
  const noStore=(res:Response)=>res.setHeader('Cache-Control','no-store');
  app.get('/api/auth/recovery-phone',route(async(req,res)=>{
    noStore(res);res.json(await accountAssist.readOwnPhone(req.actor!));
  }));
  app.put('/api/auth/recovery-phone',route(async(req,res)=>{
    noStore(res);res.json(await accountAssist.setOwnPhone(req.actor!,req.body));
  }));
  app.put('/api/records/User/:id/recovery-phone',route(async(req,res)=>{
    noStore(res);res.json(await accountAssist.setUserPhone(req.actor!,req.params.id,req.body));
  }));
  app.post('/api/records/User/:id/password-reset-link',route(async(req,res)=>{
    noStore(res);res.status(201).json(await accountAssist.adminResetLink(req.actor!,req.params.id,req.body));
  }));
  app.post('/api/platform/tenants/:tenantId/password-reset-link',route(async(req,res)=>{
    noStore(res);res.status(201).json(await accountAssist.platformResetLink(req.actor!,req.params.tenantId,req.body));
  }));
  const readUser=async(tenantId:string,userId:string,id:string)=>{
    await requireUserReportingScope(tenantId,userId,id);
    const result=await db.query<{id:string;email:string;display_name:string;enabled:boolean;landing_app_api:string;reports_to_user_id:string|null}>(
      'SELECT id,email,display_name,enabled,landing_app_api,reports_to_user_id FROM md_users WHERE tenant_id=$1 AND id=$2',[tenantId,id]);
    if(!result.rows[0])throw new Error('Record not found');
    return userRecord(result.rows[0],{tenant_id:tenantId,user_id:userId});
  };
  app.get('/api/records/User',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','read');
    const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
    if(!Number.isInteger(limit)||!Number.isInteger(offset)||limit<1||offset<0)throw new Error('Invalid pagination');
    const [users,count]=await Promise.all([
      db.query<{id:string;email:string;display_name:string;enabled:boolean;landing_app_api:string;reports_to_user_id:string|null}>(
        `SELECT id,email,display_name,enabled,landing_app_api,reports_to_user_id FROM md_users
         WHERE tenant_id=$1 AND (md_effective_reporting_scope($1,$4,'User') IS NULL
           OR md_reporting_scope($1,$4,id,md_effective_reporting_scope($1,$4,'User')))
         ORDER BY email,id LIMIT $2 OFFSET $3`,
        [actor.tenant_id,Math.min(limit,100),offset,actor.user_id]),
      db.query<{total:string}>(`SELECT count(*)::text AS total FROM md_users
        WHERE tenant_id=$1 AND (md_effective_reporting_scope($1,$2,'User') IS NULL
        OR md_reporting_scope($1,$2,id,md_effective_reporting_scope($1,$2,'User')))`,[actor.tenant_id,actor.user_id])
    ]);
    res.json({records:await Promise.all(users.rows.map(row=>userRecord(row,actor))),total:Number(count.rows[0]?.total??0)});
  }));
  // The manager picker uses tenant identities, not role hierarchy or a shadow User object.
  app.get('/api/records/User/reporting-options',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','read');
    await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    const {rows}=await db.query<{id:string;email:string;display_name:string;reports_to_user_id:string|null}>(
      `SELECT id,email,display_name,reports_to_user_id FROM md_users WHERE tenant_id=$1
       AND (md_effective_reporting_scope($1,$2,'User') IS NULL OR
         md_reporting_scope($1,$2,id,md_effective_reporting_scope($1,$2,'User')))
       ORDER BY display_name,email,id LIMIT 2000`,
      [actor.tenant_id,actor.user_id]);
    const root=await db.query<{user_id:string}>('SELECT user_id FROM md_tenant_developer_accounts WHERE tenant_id=$1',[actor.tenant_id]);
    res.setHeader('Cache-Control','private, no-store');
    res.json({users:rows.map(u=>({id:u.id,name:u.display_name||u.email,email:u.email,reportsToId:u.reports_to_user_id})),
      rootUserId:root.rows[0]?.user_id??null});
  }));
  app.get('/api/records/User/:id/hierarchy',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','read');
    const target=req.params.id;
    await requireUserReportingScope(actor.tenant_id,actor.user_id,target);
    if(target!==actor.user_id)await rbac.require(actor.tenant_id,actor.user_id,'Security','read');
    const direction=req.query.direction==='ancestors'?'ancestors':req.query.direction==='descendants'?'descendants':null;
    if(!direction)throw new Error('Invalid hierarchy direction');
    const {rows}=await db.query<{user_id:string;hierarchy_level:number}>(
      `SELECT h.user_id,h.hierarchy_level FROM md_reporting_users($1,$2,$3) h
       WHERE md_effective_reporting_scope($1,$4,'User') IS NULL OR
         md_reporting_scope($1,$4,h.user_id,md_effective_reporting_scope($1,$4,'User'))
       ORDER BY h.hierarchy_level,h.user_id LIMIT 2000`,
      [actor.tenant_id,target,direction,actor.user_id]);
    res.setHeader('Cache-Control','private, no-store');
    res.json({userIds:rows.map(row=>row.user_id),users:rows.map(row=>({id:row.user_id,level:row.hierarchy_level}))});
  }));
  app.get('/api/records/User/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','read');
    res.json({record:await readUser(actor.tenant_id,actor.user_id,req.params.id)});
  }));
  app.post('/api/records/User',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','create');
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Invalid user');
    await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    await requireUserFields(actor,req.body,'create');
    const values=userFields(req.body,true);
    if(values.tenant&&values.tenant!==actor.tenant_id)throw new Error('Permission denied');
    if(values.landingApp&&values.landingApp!=='Setup'
      &&!(await apps.listMetadata(actor.tenant_id)).some(app=>app.apiName===values.landingApp))
      throw new Error('Landing app must be installed and licensed for this tenant');
    const passwordHash=await auth.hashPassword(values.password!,actor.tenant_id);
    const row=await db.transaction(async client=>{
      const result=await client.query<{id:string}>(
        'INSERT INTO md_users(tenant_id,email,display_name,password_hash,enabled,landing_app_api,reports_to_user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [actor.tenant_id,values.email,values.name??'',passwordHash,values.enabled??true,values.landingApp??'Setup',values.reportingTo??null]);
      const profile=await client.query<{id:string}>(
        "SELECT id FROM md_profiles WHERE tenant_id=$1 AND api_name='Default'",[actor.tenant_id]);
      if(profile.rows[0])await client.query(
        'INSERT INTO md_user_profiles(tenant_id,user_id,profile_id) VALUES($1,$2,$3)',
        [actor.tenant_id,result.rows[0].id,profile.rows[0].id]);
      return result.rows[0];
    });
    res.status(201).json({record:await readUser(actor.tenant_id,actor.user_id,row.id)});
  }));
  const editUser=route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','edit');
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Invalid user');
    if(Object.prototype.hasOwnProperty.call(req.body,'LandingApp')
      ||Object.prototype.hasOwnProperty.call(req.body,'ReportsToId'))
      await rbac.require(actor.tenant_id,actor.user_id,'Security','manage');
    await requireUserFields(actor,req.body,'edit');
    const values=userFields(req.body,false);
    await requireUserReportingScope(actor.tenant_id,actor.user_id,req.params.id);
    if(values.tenant&&values.tenant!==actor.tenant_id)throw new Error('Permission denied');
    if(values.landingApp&&values.landingApp!=='Setup'
      &&!(await apps.listMetadata(actor.tenant_id)).some(app=>app.apiName===values.landingApp))
      throw new Error('Landing app must be installed and licensed for this tenant');
    if(req.params.id===actor.user_id&&values.enabled===false)throw new Error('Invalid self deactivation');
    await db.transaction(async client=>{
      const updated=await client.query<{id:string;reports_to_user_id:string|null}>(
        'SELECT id,reports_to_user_id FROM md_users WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [actor.tenant_id,req.params.id]);
      if(!updated.rows[0])throw new Error('Record not found');
      await client.query(
        'UPDATE md_users SET email=COALESCE($3,email),display_name=COALESCE($4,display_name),enabled=COALESCE($5,enabled),landing_app_api=COALESCE($6,landing_app_api),reports_to_user_id=CASE WHEN $7::boolean THEN $8::uuid ELSE reports_to_user_id END WHERE tenant_id=$1 AND id=$2',
        [actor.tenant_id,req.params.id,values.email??null,values.name??null,values.enabled??null,values.landingApp??null,values.reportingTo!==undefined,values.reportingTo??null]);
      if(values.reportingTo!==undefined&&values.reportingTo!==updated.rows[0].reports_to_user_id)
        await client.query("INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,details) VALUES($1,$2,$3,'user.reporting.change',jsonb_build_object('previous',$4::text,'requested',$5::text))",
          [actor.tenant_id,actor.user_id,req.params.id,updated.rows[0].reports_to_user_id,values.reportingTo]);
      if(!updated.rowCount)throw new Error('Record not found');
      if(values.enabled===false){
        await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,req.params.id]);
        await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,req.params.id]);
      }
    });
    res.json({record:await readUser(actor.tenant_id,actor.user_id,req.params.id)});
  });
  app.put('/api/records/User/:id',editUser);
  app.patch('/api/records/User/:id',editUser);
  app.delete('/api/records/User/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'User','delete');
    if(req.params.id===actor.user_id)throw new Error('Invalid self deactivation');
    await requireUserReportingScope(actor.tenant_id,actor.user_id,req.params.id);
    await db.transaction(async client=>{
      const result=await client.query('UPDATE md_users SET enabled=false WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [actor.tenant_id,req.params.id]);
      if(!result.rowCount)throw new Error('Record not found');
      await client.query('UPDATE md_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,req.params.id]);
      await client.query('UPDATE md_refresh_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',[actor.tenant_id,req.params.id]);
    });
    res.status(204).end();
  }));

  app.get('/api/records/:objectApi/view-preferences',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json(await recordListViews.preferences(actor.tenant_id,actor.user_id,req.params.objectApi));
  }));
  app.put('/api/records/:objectApi/view-preferences',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json(await recordListViews.savePreferences(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.body));
  }));
  app.get('/api/records/:objectApi/list-view-groups',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({groups:await recordListViews.groups(actor.tenant_id,actor.user_id,req.params.objectApi)});
  }));
  app.get('/api/records/:objectApi/list-views',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json({views:await recordListViews.list(actor.tenant_id,actor.user_id,req.params.objectApi)});
  }));
  app.post('/api/records/:objectApi/list-views',route(async(req,res)=>{
    const actor=req.actor!;
    res.status(201).json({view:await recordListViews.save(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.body as ViewInput)});
  }));
  app.get('/api/records/:objectApi/list-views/:id',route(async(req,res)=>{
    const actor=req.actor!;
    res.json({view:await recordListViews.load(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.params.id)});
  }));
  app.put('/api/records/:objectApi/list-views/:id',route(async(req,res)=>{
    const actor=req.actor!;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))
      throw new Error('Invalid list view');
    res.json({view:await recordListViews.save(actor.tenant_id,actor.user_id,req.params.objectApi,
      {...req.body,id:req.params.id} as ViewInput)});
  }));
  app.delete('/api/records/:objectApi/list-views/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await recordListViews.remove(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id);
    res.status(204).end();
  }));
  app.put('/api/records/:objectApi/list-views/:id/pin',route(async(req,res)=>{
    const actor=req.actor!;
    await recordListViews.pin(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id,req.body?.pinned);
    res.json({pinned:req.body?.pinned});
  }));
  app.get('/api/records/:objectApi/:id/activities',route(async(req,res)=>{
    res.json(await collaboration.listActivities(req.actor!,req.params.objectApi,req.params.id));
  }));
  app.post('/api/records/:objectApi/:id/activities',route(async(req,res)=>{
    res.status(201).json(await collaboration.addActivity(req.actor!,req.params.objectApi,req.params.id,req.body));
  }));
  app.patch('/api/records/:objectApi/:id/activities/:activityId',route(async(req,res)=>{
    res.json(await collaboration.updateActivity(req.actor!,req.params.objectApi,req.params.id,req.params.activityId,req.body?.status));
  }));
  app.get('/api/records/:objectApi/:id/chatter',route(async(req,res)=>{
    res.json(await collaboration.listPosts(req.actor!,req.params.objectApi,req.params.id));
  }));
  app.post('/api/records/:objectApi/:id/chatter',route(async(req,res)=>{
    res.status(201).json(await collaboration.addPost(req.actor!,req.params.objectApi,req.params.id,req.body?.body));
  }));
  app.post('/api/records/:objectApi/:id/chatter/:postId/comments',route(async(req,res)=>{
    res.status(201).json(await collaboration.addComment(req.actor!,req.params.objectApi,req.params.id,req.params.postId,req.body?.body));
  }));
  app.post('/api/reports/preview',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await reportRuntime.run(actor,req.body?.report,req.body??{}));
  }));
  app.post('/api/reports/:apiName/run',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await reportRuntime.stored(actor,req.params.apiName,req.body??{}));
  }));
  // Retention is tenant-configured, defaults to no automatic permanent purge.
  app.get('/api/recycle-bin/retention',route(async(req,res)=>{
    const actor=req.actor!;res.setHeader('Cache-Control','private, no-store');
    res.json(await recordRetention.get(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/recycle-bin/retention',route(async(req,res)=>{
    const actor=req.actor!;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))
      throw new Error('Invalid retention configuration');
    res.setHeader('Cache-Control','private, no-store');
    res.json(await recordRetention.set(actor.tenant_id,actor.user_id,
      req.body.retentionDays,req.body.automaticPurgeEnabled));
  }));
  app.delete('/api/recycle-bin/records/:objectApi/:id/purge',route(async(req,res)=>{
    const actor=req.actor!;res.setHeader('Cache-Control','private, no-store');
    res.json(await recordRetention.purge(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.params.id));
  }));
  // Shared, tenant-scoped record Recycle Bin. This is separate from field-definition recovery.
  app.get('/api/recycle-bin/records/:objectApi',route(async(req,res)=>{
    const actor=req.actor!;
    const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
    res.setHeader('Cache-Control','private, no-store');
    res.json(await records.recycleBin(actor.tenant_id,actor.user_id,req.params.objectApi,limit,offset));
  }));
  app.post('/api/recycle-bin/records/:objectApi/:id/restore',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json(await records.restore(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id));
  }));

  // Shared import pipeline: tenant actor and OneEngine Object/Field/Record rights are
  // enforced inside the generic Record Engine for each row of one SQL transaction.
  app.post('/api/records/:objectApi/import',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await records.importRecords(actor.tenant_id,actor.user_id,
      req.params.objectApi,req.body?.records));
  }));
  // Resolve the actor's published Record Edit Page for a new record.
  // The selector uses the same tenant/profile/app/device/record-type rules as edit.
  app.get('/api/records/:objectApi/create-layout',route(async(req,res)=>{
    const actor=req.actor!;
    if(!await rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'create'))
      throw new Error('Insufficient Create permission for this Object');
    const actorSession=await sessionMetadata(db,actor.tenant_id,actor.user_id);
    const device=String(req.query.formFactor??'Desktop');
    const viewportWidth=Number(req.query.viewportWidth??0);
    const recordTypeId=typeof req.query.recordTypeId==='string'?req.query.recordTypeId:'';
    const typeAccess=actorSession.user.recordTypeAccess;
    const typeKey=req.params.objectApi+'.'+recordTypeId;
    if(recordTypeId&&Object.prototype.hasOwnProperty.call(typeAccess,typeKey)
      &&typeAccess[typeKey]!==true)
      throw new Error('Record type is not available for this user');
    const [editLightningPage,canEdit,canDelete]=await Promise.all([
      pages.resolveRecordPage(actor.tenant_id,req.params.objectApi,
        String(req.query.appId??'Records'),actorSession.user.profileId,
        recordTypeId,device,'Edit',viewportWidth),
      rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'update'),
      rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'delete')
    ]);
    res.setHeader('Cache-Control','private, no-store');
    res.json({editLightningPage,recordPermissions:{Create:true,Edit:canEdit,Delete:canDelete}});
  }));
  // Content-free numeric SQL aggregates. Always reapply actor, tenant, field,
  // record and lookup rights; never run under a service/system principal.
  app.get('/api/records/:objectApi/aggregate',route(async(req,res)=>{
    const actor=req.actor!;
    const field=req.query.field,rawFilters=req.query.filters,filterLogic=req.query.filterLogic;
    if(typeof field!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field)||
      (rawFilters!==undefined&&(typeof rawFilters!=='string'||rawFilters.length>12000))||
      (filterLogic!==undefined&&(typeof filterLogic!=='string'||filterLogic.length>256)))
      throw Error('Invalid aggregate request');
    const filters=parseRecordFilters(rawFilters as string|undefined);
    res.setHeader('Cache-Control','private, no-store');
    res.json(await records.aggregateFiltered(actor.tenant_id,actor.user_id,req.params.objectApi,
      field,filters,filterLogic as string|undefined));
  }));
  app.get('/api/records/:objectApi/:id',route(async(req,res)=>{
    const actor=req.actor!;
    const record=await records.get(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id);
    const actorSession=await sessionMetadata(db,actor.tenant_id,actor.user_id);
    const device=String(req.query.formFactor??'Desktop');
    const viewportWidth=Number(req.query.viewportWidth??0);
    const requestedType=typeof req.query.editRecordTypeId==='string'
      ?req.query.editRecordTypeId.trim():'';
    if(requestedType){
      const accessKey=req.params.objectApi+'.'+requestedType;
      const access=actorSession.user.recordTypeAccess;
      if(Object.prototype.hasOwnProperty.call(access,accessKey)&&access[accessKey]!==true)
        throw new Error('Record type is not available for this user');
    }
    const context=[actor.tenant_id,req.params.objectApi,
      String(req.query.appId??'Records'),actorSession.user.profileId,String(record.RecordTypeId??''),device] as const;
    const editContext=[actor.tenant_id,req.params.objectApi,
      String(req.query.appId??'Records'),actorSession.user.profileId,
      requestedType||String(record.RecordTypeId??''),device] as const;
    const [page,editPage]=await Promise.all([
      pages.resolveRecordPage(...context,'View',viewportWidth),
      pages.resolveRecordPage(...editContext,'Edit',viewportWidth)
    ]);
    res.setHeader('Cache-Control','private, no-store');
    const [canCreate,canEdit,canDelete]=await Promise.all([
      rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'create'),
      rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'update'),
      rbac.allowed(actor.tenant_id,actor.user_id,req.params.objectApi,'delete')
    ]);
    res.json({record,lightningPage:page,editLightningPage:editPage,
      recordPermissions:{Create:canCreate,Edit:canEdit,Delete:canDelete}});
  
  }));
  app.get('/api/records/:objectApi/:id/history',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await records.history(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id));
  }));
  app.get('/api/records/:objectApi',route(async(req,res)=>{
    const actor=req.actor!;
    const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
    if(!Number.isInteger(limit)||!Number.isInteger(offset)||limit<1||offset<0) throw new Error('Invalid pagination');
    const queryString=(name:string):string|undefined=>{
      const value=req.query[name];
      if(value===undefined)return undefined;
      if(typeof value!=='string')throw new Error('Invalid record list query');
      return value;
    };
    const sortDirection=queryString('sortDirection')?.toLowerCase();
    const filterField=queryString('filterField');
    const filterValue=queryString('filterValue');
    const filterOperator=queryString('filterOperator')??'Equals';
    const search=queryString('search');
    const searchPrefix=queryString('searchPrefix');
    if(searchPrefix!==undefined&&searchPrefix!=='1')throw new Error('Invalid search mode');
    const filtersValue=queryString('filters');
    const filterLogic=queryString('filterLogic');
    const cursorValue=queryString('cursor');
    if(sortDirection!==undefined&&sortDirection!=='asc'&&sortDirection!=='desc')
      throw new Error('Invalid sort direction');
    if(!['Equals','Includes','Excludes'].includes(filterOperator))
      throw new Error('Invalid record list filter operator');
    if((filterField===undefined)!==(filterValue===undefined)
      ||(search!==undefined&&search.length>256)||(filterValue!==undefined&&filterValue.length>2000)
      ||(filtersValue!==undefined&&filtersValue.length>12000)
      ||(filterLogic!==undefined&&filterLogic.length>256)
      ||(cursorValue!==undefined&&cursorValue.length>2048))
      throw new Error('Invalid record list query');
    const filters=parseRecordFilters(filtersValue);
    if(filterLogic!==undefined&&!filters.length)throw new Error('Filter logic requires filters');
    const cursor=parseRecordCursor(cursorValue);
    const viewId=queryString('viewId');
    const view=viewId?await recordListViews.load(actor.tenant_id,actor.user_id,req.params.objectApi,viewId):undefined;
    const objectApi=req.params.objectApi;
    if(typeof objectApi!=='string')throw new Error('Invalid object name');
    res.json(await records.list(actor.tenant_id,actor.user_id,objectApi,limit,offset,{
      search,prefixSearch:searchPrefix==='1',filterField,filterValue,filterOperator:filterOperator as 'Equals'|'Includes'|'Excludes',
      relatedField:queryString('relatedField'),relatedId:queryString('relatedId'),
      sortField:queryString('sortField')??view?.sort_field??undefined,
      sortDirection:(sortDirection as 'asc'|'desc'|undefined)??view?.sort_direction,
      filters:filters.length?filters:view?.filters,filterLogic:filterLogic??view?.filter_logic,
      scope:view?.scope,cursor
    }));
  }));
  app.patch('/api/records/:objectApi/external/:fieldApi/:externalValue',route(async(req,res)=>{
    const actor=req.actor!;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Invalid record values');
    const result=await externalIdUpsert.execute(actor.tenant_id,actor.user_id,req.params.objectApi,
      req.params.fieldApi,req.params.externalValue,req.body);
    res.status(result.created?201:200).json({id:result.id,created:result.created,record:{Id:result.id}});
  }));
  app.post('/api/records/:objectApi',route(async(req,res)=>{
    const actor=req.actor!;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)) throw new Error('Invalid record values');
    const id=await records.create(actor.tenant_id,actor.user_id,req.params.objectApi,req.body);
    const record=await authorizedSavedRecordProjection(records,actor.tenant_id,actor.user_id,
      req.params.objectApi,id);
    res.status(201).json({id,record});
  }));
  app.get('/api/records/:objectApi/:id/actions',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.available(req.actor!,req.params.objectApi,req.params.id));
  }));
  app.get('/api/records/:objectApi/:id/actions/:actionId/flow-launch',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.authorizeFlow(req.actor!,req.params.objectApi,req.params.id,
      req.params.actionId));
  }));
  app.get('/api/records/:objectApi/:id/actions/:actionId/component-launch',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.authorizeComponent(req.actor!,req.params.objectApi,req.params.id,
      req.params.actionId));
  }));
  app.get('/api/metadata/action-permission-options',route(async(req,res)=>{
    const actor=req.actor!;
    await rbac.require(actor.tenant_id,actor.user_id,'Security','read');
    const {rows}=await db.query<{resource:string;label:string}>(`
      SELECT 'Action:'||object_api||'.'||action_id AS resource,
        object_api||' · '||label AS label
      FROM md_object_actions WHERE tenant_id=$1 AND enabled=true AND action_type='Custom'
      UNION ALL
      SELECT 'Action:Global.'||action_id, 'Global · '||label
      FROM md_global_quick_actions WHERE tenant_id=$1 AND enabled=true
      ORDER BY label`,[actor.tenant_id]);
    res.setHeader('Cache-Control','private, no-store');
    res.json({actions:rows});
  }));
  app.get('/api/metadata/global-actions',route(async(req,res)=>{
    const actor=req.actor!;res.setHeader('Cache-Control','private, no-store');
    res.json(await globalQuickActionMetadata.list(actor.tenant_id,actor.user_id));
  }));
  app.put('/api/metadata/global-actions',route(async(req,res)=>{
    const actor=req.actor!;
    res.json(await globalQuickActionMetadata.save(actor.tenant_id,actor.user_id,req.body?.actions));
  }));
  app.get('/api/actions/global',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.globalAvailable(req.actor!));
  }));
  app.get('/api/actions/global/:actionId/flow-launch',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.authorizeGlobalFlow(req.actor!,req.params.actionId));
  }));
  app.get('/api/actions/global/:actionId/component-launch',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.authorizeGlobalComponent(req.actor!,req.params.actionId));
  }));
  app.post('/api/actions/global/:actionId/execute',route(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.executeGlobal(req.actor!,req.params.actionId,req.body??{}));
  }));
  app.post('/api/records/:objectApi/:id/actions/:actionId/execute',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json(await quickActions.execute(actor,req.params.objectApi,req.params.id,
      req.params.actionId,req.body??{}));
  }));
  app.post('/api/records/:objectApi/:id/clone',route(async(req,res)=>{
    const actor=req.actor!;
    if(req.body!==undefined&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)
      ||Object.keys(req.body).length))
      throw new Error('Invalid record clone request');
    const id=await records.clone(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id);
    res.status(201).json({id,record:{Id:id}});
  }));
  const updateRecord=route(async(req,res)=>{
    const actor=req.actor!;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('Invalid record values');
    await records.update(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id,
      req.body,req.get('if-unmodified-since'));
    const record=await authorizedSavedRecordProjection(records,actor.tenant_id,actor.user_id,
      req.params.objectApi,req.params.id);
    res.json({record});
  });
  app.patch('/api/records/:objectApi/:id',updateRecord);
  app.put('/api/records/:objectApi/:id',updateRecord);
  app.put('/api/records/:objectApi/:id/owner',route(async(req,res)=>{
    const actor=req.actor!;
    if(typeof req.body?.ownerId!=='string')throw new Error('Invalid owner ID');
    const record=await records.transferOwner(actor.tenant_id,actor.user_id,req.params.objectApi,
      req.params.id,req.body.ownerId,req.get('if-unmodified-since'));
    res.json({record});
  }));
  app.delete('/api/records/:objectApi/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await records.remove(actor.tenant_id,actor.user_id,req.params.objectApi,req.params.id,
      undefined,req.get('if-unmodified-since'));
    res.status(204).end();
  }));
  // Generic tenant-owned media library, subject to the existing Files permission.
  app.get('/api/media-assets',route(async(req,res)=>{
    const actor=req.actor!;
    res.setHeader('Cache-Control','private, no-store');
    res.json({assets:await tenantMedia.list(actor.tenant_id,actor.user_id)});
  }));
  app.post('/api/media-assets',route(async(req,res)=>{
    const actor=req.actor!;
    const asset=await tenantMedia.upload(actor.tenant_id,actor.user_id,req.body??{});
    res.status(201).json(asset);
  }));
  app.get('/api/media-assets/:id',route(async(req,res)=>{
    const actor=req.actor!;
    // PERFORMANCE FIX: images may be kept by the user's own browser for 10 minutes (was no-store).
    res.setHeader('Cache-Control','private, max-age=600');
    res.json(await tenantMedia.read(actor.tenant_id,actor.user_id,req.params.id));
  }));
  app.delete('/api/media-assets/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await tenantMedia.remove(actor.tenant_id,actor.user_id,req.params.id);
    res.status(204).end();
  }));
  app.post('/api/files/inline-images',route(async(req,res)=>{
    const actor=req.actor!;
    const file=await recordFiles.upload(actor.tenant_id,actor.user_id,req.body??{});
    res.status(201).json(file);
  }));
  app.get('/api/files/:id/content',route(async(req,res)=>{
    const actor=req.actor!;
    const file=await recordFiles.read(actor.tenant_id,actor.user_id,req.params.id);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    res.setHeader('Content-Disposition','inline; filename="inline-image"');
    res.type(file.content_type).send(file.content);
  }));
  app.delete('/api/files/:id',route(async(req,res)=>{
    const actor=req.actor!;
    await recordFiles.remove(actor.tenant_id,actor.user_id,req.params.id);
    res.status(204).end();
  }));
  registerDynamicApiRoutes(app,db,rbac,records,flows);
  registerTenantInspectionRoutes(app,db,rbac,platformTenants);
  registerPackageApiController(app,metadataPackages);
  registerOpenApiExternalServiceRoutes(app,externalServices);
  registerDurableJobAdminRoutes(app,db,rbac);
  registerScheduledActionRoutes(app,db,rbac,records);
  registerSeederManagerRoutes(app,db,platformTenants);
  registerPlatformDeploymentRoutes(app,db,rbac);
  registerDeclarativeRuleRoutes(app,db,rbac);
  registerMatchingRoutes(app,db,rbac);
  registerFieldExactIndexRoutes(app,db,rbac);
  registerMetadataLoaderRoutes(app,db,rbac,definitions,objectManagerMetadata,objectLifecycle);
  registerDataLoaderRecordRoutes(app,db,records,definitions,rbac,externalIdUpsert);
  registerDataLoaderRibbonRoutes(app,db,rbac);
  registerBusinessProcessRoutes(app,db,rbac);
  registerObjectLabelTranslationRoutes(app,db,rbac);
  registerVersionedApiRoutes(app,records,definitions,rbac,db);
  registerPlatformEventStreamRoutes(app,db,rbac);
  registerBusinessContextRoutes(app,db,rbac,records);
  registerOutboundWebhookRoutes(app,db,rbac);
  registerDockerMailAdminRoutes(app,db,rbac,adminMailAccess,platformTenants);
  registerInboundWebhookAdminRoutes(app,db,namedCredentials,rbac);
  app.use('/api',(_req,res)=>{res.status(404).json({error:'API endpoint not implemented in SQL runtime'});});
  registerSecurityWebHost(app,db,process.env.METADRIVE_WEB_DIST);
  app.use((err:Error,_req:Request,res:Response,_next:NextFunction)=>{
    if(err instanceof DuplicateMatchError)res.status(409).json({error:err.message,ruleApi:err.ruleApi,code:'DUPLICATE_RULE_BLOCKED'});
    else if(err instanceof DeclarativeRuleError)res.status(400).json({
      error:err.message,ruleApi:err.ruleApi,
      errors:[{message:err.message,...(err.fieldApi?{fields:[err.fieldApi]}:{})}]
    });
    else if(err instanceof FlowCustomError)res.status(400).json({
      error:err.message,errors:[{message:err.message,...(err.fieldName?{fields:[err.fieldName]}:{})}]
    });
    else if(err.message==='Matching rule configuration changed; retry record save')res.status(409).json({error:err.message});
    else if(err.message.startsWith('Rule revision conflict'))res.status(409).json({error:err.message});
    else if(err.message==='Unsupported REST API version'||err.message==='Query locator is not available to this session')
      res.status(404).json({error:err.message});
    else if(err.message.startsWith('RBAC revision conflict'))res.status(409).json({error:err.message});
    else if(/^(Cannot alter own|Cannot escalate own|Standard profile|Reserved permission|Managed package metadata is read-only)/.test(err.message))res.status(403).json({error:err.message});
    else if(err.message==='Login blocked by transaction security policy'||err.message==='MFA required for connected app consent')res.status(403).json({error:err.message});
    else if(err.message==='Permission denied') res.status(403).json({error:'Permission denied'});
    else if(err.message.startsWith('Developer mailbox provisioning failed'))res.status(502).json({error:err.message});
    else if(err.message==='App licence or entitlement unavailable')
      res.status(403).json({error:err.message});
    else if(/^(Install dependency first:|Uninstall dependent app first:|Missing app package resource:|Missing app navigation resource:|App package metadata conflict:|Unresolved app package Page Component reference:|App package Page Component dependency missing|App package Page Component property target unavailable or ambiguous|App downgrade is not allowed)/.test(err.message))
      res.status(409).json({error:err.message});
    else if(err.message==='File storage quota exceeded')res.status(413).json({error:err.message});
    else if(err.message==='Too many inline images for this field')res.status(409).json({error:err.message});
    else if(err.message.startsWith('Converted values conflict')||err.message.startsWith('Field type migrations must')
      ||err.message.startsWith('Field values were added')||err.message.startsWith('Field values changed')
      ||err.message.startsWith('Package cannot be installed')||err.message.startsWith('Package installation changed')
      ||err.message.startsWith('Package object is not owned')||err.message.startsWith('Package page is not owned')
      ||err.message.startsWith('Package component is not owned')
      ||err.message==='Field type migration is not active'
      ||err.message.startsWith('Field definition changed concurrently')
      ||err.message.startsWith('Field definition changed after migration')
      ||err.message.startsWith('Field type is used by'))
      res.status(409).json({error:err.message});
    else if(/^(Field datatype|Field datatype conversion|Existing value|Numeric value|Only ISO|Migration to Rich Text|Required field migration)/.test(err.message))
      res.status(400).json({error:err.message});
    else if(err.message==='Page already exists'||err.message==='Page API name already exists (archived)'||err.message==='Field already exists'||err.message==='Object already exists'||err.message==='Page layout revision conflict'||err.message==='Page layout draft revision conflict'||err.message==='Page revision conflict'||err.message==='Record has changed since it was loaded')res.status(409).json({error:err.message});
    else if(err.message==='API Name already exists'||err.message==='API Name already exists for this language')res.status(409).json({error:err.message});
    else if((err as Error&{code?:string;constraint?:string}).code==='23505' && /_api_(?:name|version)_ci_uq$|_id_ci_uq$/.test((err as Error&{constraint?:string}).constraint??''))res.status(409).json({error:'API Name already exists'});
    else if(['23503','23505'].includes((err as Error&{code?:string}).code??''))res.status(409).json({error:'Policy dependency or duplicate identity conflict'});
    // Tenant provisioning and custom-domain outcomes are user-actionable, never SQL outages.
    else if(err.message==='Authenticated tenant required')res.status(401).json({error:err.message});
    else if(/^(Domain already |Domain proof was changed|Maximum five tenant domains|Cannot remove platform-owned|Tenant already exists|Tenant developer email already registered|Idempotency key conflict|Invalid tenant status transition)/.test(err.message))
      res.status(409).json({error:err.message});
    else if(err.message.startsWith('DNS ')||err.message.startsWith('Domain DNS '))res.status(422).json({error:err.message});
    else if(/^(Administrator email must differ|Tenant developer email is required|Offline briefcase cannot|Flow service user must be|Logo file content does not match)/.test(err.message))
      res.status(400).json({error:err.message});
    else if(err.message==='Tenant login base domain is not configured')
      res.status(500).json({error:'Tenant login base domain is not configured on the server (METADRIVE_TENANT_BASE_DOMAIN)'});
    else if(err.message==='Record not found'||err.message.endsWith('not found')) res.status(404).json({error:err.message});
    else if(err.message.startsWith('Flow cannot activate: ')||err.message.startsWith('Invalid ')||err.message.startsWith('Unsupported ')
      ||/^(Unknown |Duplicate |Cyclic |Stale |External |Queue |Active sharing|Restriction |Portal |Too many)/.test(err.message)) res.status(400).json({error:err.message});
    else {console.error('SQL system request failed',err);res.status(503).json({error:'SQL service unavailable'});}
  });
  return app;
}
/**
 * Explicit first-run bootstrap: tenant and credentials are supplied only via env.
 * Never modifies an existing tenant, even when the bootstrap flag remains set.
 */
export async function bootstrapFreshTenant(db:SqlPersistence,env:NodeJS.ProcessEnv=process.env) {
  if(env.METADRIVE_FRESH_BOOTSTRAP!=='true')return false;
  const {rows}=await db.query<{count:string}>('SELECT count(*)::text AS count FROM md_tenants');
  if(Number(rows[0]?.count)!==0)return false;
  const requireEnv=(name:string)=>{const value=env[name]?.trim();if(!value)throw new Error('Missing fresh install setting: '+name);return value;};
  await new TenantProvisioning(db).provision({
    slug:requireEnv('METADRIVE_BOOTSTRAP_TENANT_ID'),
    name:requireEnv('METADRIVE_BOOTSTRAP_TENANT_NAME'),
    domain:requireEnv('METADRIVE_BOOTSTRAP_DOMAIN'),
    developerEmail:requireEnv('METADRIVE_BOOTSTRAP_ADMIN_EMAIL'),
    developerPassword:requireEnv('METADRIVE_BOOTSTRAP_ADMIN_PASSWORD')
  });
  return true;
}
export async function startSystemServer() {
  const db=new SqlPersistence(process.env.DATABASE_URL??'');
  try { await applySystemMigrations(db); await db.verifySchema();
    await retireRemovedApps(db); // Discontinue catalog listings without removing tenant records.
    const removedApps=await deleteRetiredChatterMetadata(db);
    console.info('Removed app/page/component metadata:',removedApps);
    console.info('Smart renderer keys upgraded:',await migrateSmartRendererKeys(db));
    await seedConnectorAppCatalog(db); // Headless connector apps. No auto licence or install.
    // Provision first, then reconcile shared Core metadata for every tenant once.
    await bootstrapFreshTenant(db);
    const seededTenants=await reconcileCoreObjects(db);
    const mailPermissionTenants=await seedMailAdminPermissions(db);
    console.info('MailAdmin permission set seeded for tenants:',mailPermissionTenants);

    console.info('Core metadata seeder: existing tenants backfilled:',seededTenants);
    const deploymentPermission=await seedPlatformOneEngineDeploymentPermission(db);
    console.info('Platform OneEngine deployment policy:',deploymentPermission);
    console.info('Tenant Developer role moved from OneEngine to TenantDeveloper for tenants:',await upgradeTenantDeveloperPolicy(db));
    const status=await reconcileBootstrapPassword(db); if(status!=='disabled')console.info('First-install credential reconciliation:',status);
    const firstLogin=await rotateFirstLoginPassword(db);
    if(firstLogin!=='disabled')console.info('First-login credential rotation:',firstLogin);
    if(firstLogin==='rotated'){
      const {rows}=await db.query<{id:string}>(`SELECT t.id FROM md_tenants t JOIN md_tenant_domains d ON d.tenant_id=t.id WHERE d.domain=$1`,
        [process.env.METADRIVE_BOOTSTRAP_DOMAIN]);
      if(!rows[0])throw new Error('New login verification has no registered domain');
      const auth=new AuthenticationService(db);
      const session=await auth.signIn(rows[0].id,
        process.env.METADRIVE_BOOTSTRAP_ADMIN_EMAIL??'',
        process.env.METADRIVE_BOOTSTRAP_ADMIN_PASSWORD??'');
      await auth.signOut(session.accessToken,session.refreshToken);
      console.info('New developer login verification: passed');
    } }
  catch(error) { await db.close(); throw error; }
  const port=Number(process.env.PORT??10000);
  if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT');
  const definitions=new ObjectDefinitionService(db);
  const retention=new RecordRetentionService(db,new RbacEngine(db));
  await definitions.purgeExpiredFields();
  await retention.purgeExpired();
  const purgeTimer=setInterval(()=>{
    void Promise.all([definitions.purgeExpiredFields(),retention.purgeExpired()]).catch(error=>{
      console.error('Expired metadata/record cleanup failed:',error);
    });
  },60*60*1000);
  purgeTimer.unref();
  const dispatcherRbac=new RbacEngine(db);
  const calloutDispatcher=new NamedCredentialService(db,dispatcherRbac);
  const dispatcherOutbox=new IntegrationCommunicationOutbox(
   db,createIntegrationCommunicationWriter(db));
  calloutDispatcher.setIntegrationActivityWriter(dispatcherOutbox.write);
  const calloutTimer=setInterval(()=>{
    void Promise.all([calloutDispatcher.dispatchOne(),calloutDispatcher.dispatchOneFlowEmail(),
     calloutDispatcher.dispatchOneQuickActionEmail(),dispatcherOutbox.dispatchOne()])
      .catch(error=>console.error('Durable outbound dispatch failed:',error));
  },1000);
  calloutTimer.unref();
  const server=createSystemServer(db).listen(port,'0.0.0.0');
  server.once('close',()=>{clearInterval(purgeTimer);clearInterval(calloutTimer);});
  return server;
}

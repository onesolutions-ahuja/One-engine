import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {AppRuntime} from '../system-files/app-runtime.js';
import type {ObjectDefinitionService} from '../system-files/object-definition.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import type {ComponentLibraryService} from './component-library-service.js';
import type {MetadataPackage,MetadataPackageService} from './metadata-package-service.js';
import {PlatformTenantService} from '../system-files/platform-tenant-service.js';

/**
 * AppExchange publishing for tenant-authored apps.
 *
 * A OneEngine holder publishes an app built in their own tenant (objects, fields,
 * pages, components, flows, layouts, permission sets, navigation and home pages)
 * as a versioned, global catalogue app. Any licensed tenant can then install it:
 * metadata the tenant already has is reused (objects gain only missing fields),
 * everything else is created, and nothing the tenant owns is overwritten.
 * Credentials are never published: flow callouts resolve to the installing
 * tenant's own Named Credential by name (for example from the WhatsApp Connector).
 */
type Actor={tenant_id:string;user_id:string};
type Selection={objects:string[];pages:string[];components:string[];flows:string[];
 objectConfigurations:string[];permissionSets:string[]};
const API=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const RESERVED_SETS=['OneEngine','PlatformDeveloper','TenantDeveloper'];
const KEYS:Array<keyof Selection>=['objects','pages','components','flows','objectConfigurations','permissionSets'];

function list(value:unknown,key:string):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>200||value.some(v=>typeof v!=='string'||!API.test(v)))
  throw new Error('Invalid publish selection: '+key);
 return [...new Set(value as string[])];
}
const packageApiFor=(appApi:string)=>('App_'+appApi).slice(0,128);

export class AppPublishingService{
 private readonly platform:PlatformTenantService;
 constructor(private readonly db:SqlPersistence,rbac:RbacEngine,
  private readonly apps:AppRuntime,private readonly packages:MetadataPackageService,
  private readonly definitions:ObjectDefinitionService,private readonly pages:PageRuntime,
  private readonly library:ComponentLibraryService,private readonly flows:FlowRuntime){
  this.platform=new PlatformTenantService(db,rbac);
 }

 /** A tenant-authored (not catalogue) app in the actor's tenant. */
 private async sourceApp(tenant:string,appApi:string){
  if(!API.test(appApi))throw new Error('Invalid app');
  const {rows}=await this.db.query<{id:string;api_name:string;label:string;description:string;brand_color:string}>(`
   SELECT a.id,m.api_name,m.label,m.description,m.brand_color FROM md_apps a
   JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
   WHERE m.api_name=$2 AND a.tenant_owner_id=$1 AND a.enabled=true`,[tenant,appApi]);
  if(!rows[0])throw new Error('App not found: only apps built in this tenant can be published');
  return rows[0];
 }
 private async publication(tenant:string,sourceAppId:string){
  const {rows}=await this.db.query<{app_id:string;api_name:string;package_api:string;latest:number|null}>(`
   SELECT p.app_id,a.api_name,p.package_api,
    (SELECT max(version) FROM md_app_package_versions v WHERE v.app_id=p.app_id) AS latest
   FROM md_app_publications p JOIN md_apps a ON a.id=p.app_id
   WHERE p.source_tenant_id=$1 AND p.source_app_id=$2`,[tenant,sourceAppId]);
  return rows[0];
 }

 /** Everything publishable in this tenant, with a suggested selection for the app. */
 async discover(actor:Actor,appApi:string){
  await this.platform.requirePlatform(actor.tenant_id,actor.user_id);
  const app=await this.sourceApp(actor.tenant_id,appApi);
  const [navigation,homes,objects,pages,components,flows,sets,published]=await Promise.all([
   this.db.query<{entry_type:string;api_name:string}>(`SELECT entry_type,api_name FROM md_tenant_app_navigation
    WHERE tenant_id=$1 AND app_id=$2 ORDER BY sort_order`,[actor.tenant_id,app.id]),
   this.db.query<{api_name:string}>(`SELECT p.api_name FROM md_app_home_pages h
    JOIN md_page_definitions p ON p.tenant_id=h.tenant_id AND p.id=h.page_id
    WHERE h.tenant_id=$1 AND h.app_id=$2`,[actor.tenant_id,app.id]),
   this.definitions.list(actor.tenant_id) as Promise<Array<Record<string,unknown>>>,
   this.pages.list(actor.tenant_id) as Promise<Array<Record<string,unknown>>>,
   this.library.list(actor.tenant_id,actor.user_id) as Promise<Array<Record<string,unknown>>>,
   this.flows.list(actor.tenant_id) as Promise<Array<Record<string,unknown>>>,
   this.db.query<{api_name:string;label:string|null}>(`SELECT api_name,label FROM md_permission_sets
    WHERE tenant_id=$1 AND NOT (api_name=ANY($2::text[])) ORDER BY api_name`,[actor.tenant_id,RESERVED_SETS]),
   this.publication(actor.tenant_id,app.id)
  ]);
  const customObjects=objects.filter(o=>o.kind==='Custom Object');
  const navPages=new Set(navigation.rows.filter(n=>n.entry_type==='App Page').map(n=>n.api_name)
   .concat(homes.rows.map(h=>h.api_name)));
  const appFlows=flows.filter(f=>f.appApiName===app.api_name&&['Active','Draft'].includes(String(f.status)));
  const objectNames=new Set(customObjects.map(o=>String(o.apiName)));
  const suggestedObjects=new Set(navigation.rows.filter(n=>n.entry_type==='Object'&&objectNames.has(n.api_name))
   .map(n=>n.api_name));
  for(const flow of appFlows)if(typeof flow.triggerObject==='string'&&objectNames.has(flow.triggerObject))
   suggestedObjects.add(flow.triggerObject);
  const libraryNames=new Set(components.map(c=>String(c.apiName)));
  const suggestedComponents=new Set<string>();
  for(const page of pages)if(navPages.has(String(page.apiName))&&Array.isArray(page.components))
   for(const node of page.components as Array<Record<string,unknown>>)
    if(typeof node.type==='string'&&libraryNames.has(node.type))suggestedComponents.add(node.type);
  const item=(apiName:string,label:unknown,suggested:boolean)=>({apiName,label:String(label||apiName),suggested});
  return {
   app:{apiName:app.api_name,label:app.label,description:app.description},
   published:published?{appExchangeApiName:published.api_name,latestVersion:published.latest??0}:null,
   nextVersion:(published?.latest??0)+1,
   navigation:navigation.rows.map(n=>({type:n.entry_type,apiName:n.api_name})),
   available:{
    objects:customObjects.map(o=>item(String(o.apiName),o.label,suggestedObjects.has(String(o.apiName)))),
    objectConfigurations:customObjects.map(o=>item(String(o.apiName),o.label,suggestedObjects.has(String(o.apiName)))),
    pages:pages.map(p=>item(String(p.apiName),p.label??p.title,navPages.has(String(p.apiName)))),
    components:components.map(c=>item(String(c.apiName),c.label,suggestedComponents.has(String(c.apiName)))),
    flows:flows.filter(f=>['Active','Draft'].includes(String(f.status)))
     .map(f=>item(String(f.apiName),f.label,appFlows.includes(f))),
    permissionSets:sets.rows.map(p=>item(p.api_name,p.label,false))
   }
  };
 }

 /** Publish the next version of a tenant app to AppExchange. */
 async publish(actor:Actor,appApi:string,body:unknown){
  await this.platform.requirePlatform(actor.tenant_id,actor.user_id);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid publish request');
  const x=body as Record<string,unknown>;
  const selection=Object.fromEntries(KEYS.map(k=>[k,list(x[k],k)])) as Selection;
  if(x.description!==undefined&&(typeof x.description!=='string'||x.description.length>4000))
   throw new Error('Invalid app description');
  const app=await this.sourceApp(actor.tenant_id,appApi);
  const existing=await this.publication(actor.tenant_id,app.id);
  const version=x.version===undefined?(existing?.latest??0)+1:Number(x.version);
  if(!Number.isSafeInteger(version)||version<1||version<=(existing?.latest??0))
   throw new Error('Invalid version: must be greater than the published version '+(existing?.latest??0));
  const [navigation,homes,activeFlows]=await Promise.all([
   this.db.query<{entry_type:'Object'|'App Page';api_name:string;sort_order:number}>(`
    SELECT entry_type,api_name,sort_order FROM md_tenant_app_navigation
    WHERE tenant_id=$1 AND app_id=$2 ORDER BY sort_order`,[actor.tenant_id,app.id]),
   this.db.query<{api_name:string;form_factor:string}>(`SELECT p.api_name,h.form_factor FROM md_app_home_pages h
    JOIN md_page_definitions p ON p.tenant_id=h.tenant_id AND p.id=h.page_id
    WHERE h.tenant_id=$1 AND h.app_id=$2`,[actor.tenant_id,app.id]),
   this.db.query<{api_name:string}>(`SELECT DISTINCT api_name FROM md_flow_definitions
    WHERE tenant_id=$1 AND active=true AND archived=false AND api_name=ANY($2::text[])`,
    [actor.tenant_id,selection.flows])
  ]);
  const pages=new Set(selection.pages);
  const missingPages=[...navigation.rows.filter(n=>n.entry_type==='App Page').map(n=>n.api_name),
   ...homes.rows.map(h=>h.api_name)].filter(name=>!pages.has(name));
  if(missingPages.length)
   throw new Error('Invalid publish selection: include the app\'s navigation and home pages: '+[...new Set(missingPages)].join(', '));
  const packageApi=existing?.package_api??packageApiFor(app.api_name);
  const manifest=await this.packages.export(actor.tenant_id,actor.user_id,{
   apiName:packageApi,label:app.label,version,type:'Unlocked',...selection
  },{portablePages:true});
  return this.db.transaction(async client=>{
   let appId=existing?.app_id;
   if(!appId){
    const clash=await client.query('SELECT 1 FROM md_apps WHERE lower(api_name)=lower($1)',[app.api_name]);
    if(clash.rowCount)throw new Error('Duplicate AppExchange app name: '+app.api_name+' is already in the catalogue');
    appId=(await client.query<{id:string}>(`INSERT INTO md_apps(api_name,label,enabled,tenant_owner_id,app_type)
     VALUES($1,$2,true,NULL,'Application') RETURNING id`,[app.api_name,app.label])).rows[0].id;
    await client.query(`INSERT INTO md_app_publications(app_id,source_tenant_id,source_app_id,package_api,created_by)
     VALUES($1,$2,$3,$4,$5)`,[appId,actor.tenant_id,app.id,packageApi,actor.user_id]);
   }else await client.query('UPDATE md_apps SET label=$2 WHERE id=$1',[appId,app.label]);
   await client.query(`INSERT INTO md_app_package_versions(app_id,version,published,description,brand_color)
    VALUES($1,$2,true,$3,$4)`,[appId,version,
    typeof x.description==='string'?x.description:app.description,app.brand_color]);
   for(const n of navigation.rows)await client.query(`INSERT INTO md_app_package_navigation
    (app_id,version,entry_type,api_name,sort_order) VALUES($1,$2,$3,$4,$5)`,
    [appId,version,n.entry_type,n.api_name,n.sort_order]);
   // Home pages are packaged pages, applied after install (not legacy page templates).
   await client.query(`INSERT INTO md_app_package_manifests
    (app_id,version,metadata_package,activate_flows,home_pages,published_by)
    VALUES($1,$2,$3::jsonb,$4::text[],$5::jsonb,$6)`,[appId,version,JSON.stringify(manifest),
    activeFlows.rows.map(r=>r.api_name),
    JSON.stringify(homes.rows.map(h=>({pageApi:h.api_name,formFactor:h.form_factor}))),actor.user_id]);
   await client.query(`INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
    VALUES($1,$2,'app-exchange.published',$3::jsonb)`,[actor.tenant_id,actor.user_id,JSON.stringify({
     app:app.api_name,version,packageApi,digest:manifest.digest,
     counts:Object.fromEntries(KEYS.map(k=>[k,selection[k].length]))})]);
   return {appExchangeApiName:app.api_name,version,packageApi,digest:manifest.digest,
    activateFlows:activeFlows.rows.map(r=>r.api_name)};
  });
 }

 /** Latest published manifest of a catalogue app visible to this tenant, if any. */
 private async manifest(tenant:string,appApi:string){
  if(!API.test(appApi))throw new Error('Invalid app');
  const {rows}=await this.db.query<{app_id:string;version:number;metadata_package:MetadataPackage;
   activate_flows:string[];home_pages:Array<{pageApi:string;formFactor:string}>}>(`
   SELECT a.id AS app_id,v.version,mf.metadata_package,mf.activate_flows,mf.home_pages FROM md_apps a
   LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
   JOIN LATERAL (SELECT version FROM md_app_package_versions
    WHERE app_id=a.id AND published=true ORDER BY version DESC LIMIT 1) v ON true
   JOIN md_app_package_manifests mf ON mf.app_id=a.id AND mf.version=v.version
   WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true AND a.tenant_owner_id IS NULL`,[tenant,appApi]);
  return rows[0];
 }
 private async packageCurrent(tenant:string,pkg:MetadataPackage){
  const {rows}=await this.db.query<{version:number;active:boolean}>(`SELECT version,active
   FROM md_metadata_package_installations WHERE tenant_id=$1 AND package_api=$2`,[tenant,pkg.package.apiName]);
  return !!rows[0]?.active&&rows[0].version>=pkg.package.version;
 }

 /** What installing this app will do in the actor's tenant. */
 async preview(actor:Actor,appApi:string){
  const found=await this.manifest(actor.tenant_id,appApi);
  if(!found)return {packaged:false as const};
  const pkg=found.metadata_package;
  const upToDate=await this.packageCurrent(actor.tenant_id,pkg);
  const preview=upToDate?null:await this.packages.preview(actor.tenant_id,actor.user_id,pkg);
  const owned=new Set(preview?[...preview.reused].map(r=>r.type+':'+r.apiName):[]);
  const create=(type:string,names:string[])=>names.filter(n=>!owned.has(type+':'+n));
  const c=pkg.contents;
  return {packaged:true as const,version:found.version,upToDate,
   canInstall:upToDate||!!preview?.canInstall,
   create:{objects:create('object',c.objects.map(o=>o.apiName)),pages:create('page',c.pages.map(p=>p.apiName)),
    components:create('component',c.components.map(x=>x.apiName)),flows:create('flow',(c.flows??[]).map(f=>f.apiName)),
    permissionSets:create('permission-set',(c.permissionSets??[]).map(p=>p.apiName))},
   reused:preview?.reused??[],addedFields:preview?.addedFields??[],
   missingDependencies:preview?.missingDependencies??[],conflicts:preview?.conflicts??[],
   activateFlows:found.activate_flows};
 }

 /**
  * Install or upgrade an app. Catalogue apps with a published manifest get their
  * metadata upserted first, then the app (navigation, home pages, version) is
  * installed and the publisher's active flows are activated, all in one SQL
  * transaction. Apps without a manifest keep the existing install path.
  */
 async install(actor:Actor,appApi:string,seed?:Parameters<AppRuntime['install']>[2]){
  const found=await this.manifest(actor.tenant_id,appApi);
  if(!found){await this.apps.install(actor.tenant_id,appApi,seed);return {packaged:false,flowWarnings:[]};}
  return this.db.transaction(async()=>{
   const pkg=found.metadata_package;
   let result:Record<string,unknown>|null=null;
   if(!(await this.packageCurrent(actor.tenant_id,pkg)))
    result=await this.packages.install(actor.tenant_id,actor.user_id,pkg) as unknown as Record<string,unknown>;
   await this.apps.install(actor.tenant_id,appApi,seed);
   // Keep a home page the tenant already chose; otherwise use the publisher's.
   for(const home of found.home_pages)await this.db.query(`
    INSERT INTO md_app_home_pages(tenant_id,app_id,form_factor,page_id)
    SELECT $1,$2,$3,p.id FROM md_page_definitions p
    WHERE p.tenant_id=$1 AND p.api_name=$4 AND p.enabled=true
    ON CONFLICT(tenant_id,app_id,form_factor) DO NOTHING`,
    [actor.tenant_id,found.app_id,home.formFactor,home.pageApi]);
   const flowWarnings:string[]=[];
   for(const name of found.activate_flows){
    try{
     const flow=await this.flows.loadEditor(actor.tenant_id,name) as Record<string,unknown>;
     if(flow.status==='Active')continue;
     await this.flows.saveEditor(actor.tenant_id,actor.user_id,name,{...flow,status:'Active'});
    }catch(error){
     flowWarnings.push(name+': '+(error instanceof Error?error.message:'could not be activated'));
    }
   }
   return {packaged:true,version:found.version,reused:result?.reused??[],
    addedFields:result?.addedFields??[],flowWarnings};
  });
 }
}

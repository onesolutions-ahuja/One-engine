import type {Express,Request,Response,NextFunction} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {PageRuntime} from '../system-files/page-runtime.js';
import {pageLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import {assertMetadataPackageEditable} from './metadata-package-service.js';

/**
 * App versions: every Save of an app (from Page Builder) records which saved revision of each
 * page layout the app had, plus the broken links found then. Only the last 10 are kept (and
 * always the published one). Publishing a version makes exactly those page revisions live; a
 * version with broken links cannot be published. Page revisions themselves are the existing
 * immutable md_page_layout_versions rows, so a version stores references, not copies.
 */
export {APP_VERSION_DDL} from './app-version-ddl.js';

export const APP_VERSIONS_KEPT=10;
const apiName=/^[A-Za-z][A-Za-z0-9_]*$/;
type Actor={tenant_id:string;user_id:string};
type Handler=(req:Request&{actor?:Actor},res:Response)=>Promise<void>;
const route=(handler:Handler)=>(req:Request,res:Response,next:NextFunction)=>{
 Promise.resolve(handler(req as Request&{actor?:Actor},res)).catch(next);
};
const actorOf=(req:Request&{actor?:Actor}):Actor=>{
 if(!req.actor?.tenant_id||!req.actor.user_id)throw new Error('Authenticated tenant required');
 return req.actor;
};

export type AppVersionRow={version:number;published:boolean;errorCount:number;errors:string[];pages:number;
 createdAt:string;createdBy:string;modifiedAt:string;modifiedBy:string};
export type BrokenLinkInput={page:string;component:string;message:string};

/** Broken links arrive from the builder; kept short and as plain text lines. */
export function errorLines(input:unknown):string[]{
 if(!Array.isArray(input))return [];
 return input.slice(0,200).flatMap(item=>{
  if(!item||typeof item!=='object')return [];
  const {page,component,message}=item as Record<string,unknown>;
  const text=[page,component,message].map(part=>String(part??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,160))
   .filter(Boolean).join(' · ');
  return text?[text]:[];
 });
}

export async function listAppVersions(db:SqlPersistence,tenant:string,app:string):Promise<AppVersionRow[]>{
 const {rows}=await db.query<{version:number;published:boolean;error_count:number;error_text:string;pages:string;
  created_at:Date;modified_at:Date;created_email:string|null;modified_email:string|null}>(`
  SELECT v.version,v.published,v.error_count,v.error_text,
   (SELECT COUNT(DISTINCT p.page_api) FROM md_app_version_pages p
     WHERE p.tenant_id=v.tenant_id AND p.app_api=v.app_api AND p.version=v.version)::text AS pages,
   v.created_at,v.modified_at,c.email AS created_email,m.email AS modified_email
  FROM md_app_versions v
  LEFT JOIN md_users c ON c.tenant_id=v.tenant_id AND c.id=v.created_by
  LEFT JOIN md_users m ON m.tenant_id=v.tenant_id AND m.id=v.modified_by
  WHERE v.tenant_id=$1 AND v.app_api=$2 ORDER BY v.version DESC`,[tenant,app]);
 return rows.map(row=>({version:row.version,published:row.published,errorCount:row.error_count,
  errors:row.error_text?row.error_text.split('\n'):[],pages:Number(row.pages),
  createdAt:new Date(row.created_at).toISOString(),createdBy:row.created_email??'',
  modifiedAt:new Date(row.modified_at).toISOString(),modifiedBy:row.modified_email??''}));
}

/** Record the app as saved now: the current draft revision of every layout of its pages. */
export async function recordAppVersion(db:SqlPersistence,tenant:string,app:string,pageNames:readonly string[],
 errors:readonly string[],actor:string):Promise<number>{
 const names=[...new Set(pageNames.filter(name=>apiName.test(name)))].slice(0,500);
 return db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['md_app_versions:'+tenant+':'+app]);
  const heads=names.length?(await client.query<{api_name:string;variant:string;draft_version:number}>(`
   SELECT p.api_name,h.variant,h.draft_version FROM md_page_layout_heads h
   JOIN md_page_definitions p ON p.tenant_id=h.tenant_id AND p.id=h.page_id
   WHERE h.tenant_id=$1 AND p.api_name=ANY($2::text[]) AND p.enabled=true AND h.draft_version IS NOT NULL`,
   [tenant,names])).rows:[];
  const next=(await client.query<{next:number}>(`SELECT COALESCE(MAX(version),0)+1 AS next
   FROM md_app_versions WHERE tenant_id=$1 AND app_api=$2`,[tenant,app])).rows[0].next;
  await client.query(`INSERT INTO md_app_versions(tenant_id,app_api,version,error_count,error_text,created_by,modified_by)
   VALUES($1,$2,$3,$4,$5,$6,$6)`,[tenant,app,next,errors.length,errors.join('\n'),actor]);
  for(const head of heads)await client.query(`INSERT INTO md_app_version_pages
   (tenant_id,app_api,version,page_api,layout_variant,page_version) VALUES($1,$2,$3,$4,$5,$6)`,
   [tenant,app,next,head.api_name,head.variant,head.draft_version]);
  // Keep the newest versions and always the published one.
  await client.query(`DELETE FROM md_app_versions WHERE tenant_id=$1 AND app_api=$2 AND published=false
   AND version NOT IN (SELECT version FROM md_app_versions WHERE tenant_id=$1 AND app_api=$2
    ORDER BY version DESC LIMIT $3)`,[tenant,app,APP_VERSIONS_KEPT]);
  return next;
 });
}

/** Make one saved app version live: each of its page layouts is restored as the draft (when it
 * is not already) and published. Pages already live at that revision are left alone. */
export async function publishAppVersion(db:SqlPersistence,pages:PageRuntime,tenant:string,app:string,
 version:number,actor:string):Promise<void>{
 const found=await db.query<{error_count:number}>(`SELECT error_count FROM md_app_versions
  WHERE tenant_id=$1 AND app_api=$2 AND version=$3`,[tenant,app,version]);
 if(!found.rowCount)throw new Error('App version not found');
 const errors=found.rows[0].error_count;
 if(errors>0)throw new Error('Fix the '+errors+' broken link'+(errors===1?'':'s')+' in this version before publishing it');
 const {rows}=await db.query<{page_api:string;layout_variant:string;page_version:number;
  draft_version:number|null;published_version:number|null}>(`
  SELECT a.page_api,a.layout_variant,a.page_version,h.draft_version,h.published_version
  FROM md_app_version_pages a
  JOIN md_page_definitions p ON p.tenant_id=a.tenant_id AND p.api_name=a.page_api AND p.enabled=true
  LEFT JOIN md_page_layout_heads h ON h.tenant_id=p.tenant_id AND h.page_id=p.id AND h.variant=a.layout_variant
  WHERE a.tenant_id=$1 AND a.app_api=$2 AND a.version=$3 ORDER BY a.page_api,a.layout_variant`,[tenant,app,version]);
 for(const row of rows){
  if(row.published_version===row.page_version&&row.draft_version===row.page_version)continue;
  const variant=pageLayoutVariant(row.layout_variant);
  await assertMetadataPackageEditable(db,tenant,'page',row.page_api);
  if(row.draft_version!==row.page_version)await pages.rollbackLayout(tenant,row.page_api,variant,row.page_version,actor);
  await pages.publishLayout(tenant,row.page_api,variant,row.page_version,actor);
 }
 await db.transaction(async client=>{
  await client.query(`UPDATE md_app_versions SET published=(version=$3),
   modified_by=CASE WHEN version=$3 OR published THEN $4::uuid ELSE modified_by END,
   modified_at=CASE WHEN version=$3 OR published THEN now() ELSE modified_at END
   WHERE tenant_id=$1 AND app_api=$2`,[tenant,app,version,actor]);
  await client.query(`DELETE FROM md_app_versions WHERE tenant_id=$1 AND app_api=$2 AND published=false
   AND version NOT IN (SELECT version FROM md_app_versions WHERE tenant_id=$1 AND app_api=$2
    ORDER BY version DESC LIMIT $3)`,[tenant,app,APP_VERSIONS_KEPT]);
 });
}

export function registerAppVersionRoutes(app:Express,db:SqlPersistence,rbac:RbacEngine,pages:PageRuntime){
 const appName=(req:Request)=>{
  const name=String(req.params.apiName??'');
  if(!apiName.test(name))throw new Error('Invalid App API name');
  return name;
 };
 app.get('/api/metadata/apps/:apiName/versions',route(async(req,res)=>{
  const actor=actorOf(req),name=appName(req);
  await rbac.require(actor.tenant_id,actor.user_id,'App:'+name,'read');
  res.setHeader('Cache-Control','private, no-store');
  res.json({versions:await listAppVersions(db,actor.tenant_id,name)});
 }));
 app.post('/api/metadata/apps/:apiName/versions',route(async(req,res)=>{
  const actor=actorOf(req),name=appName(req);
  await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await rbac.require(actor.tenant_id,actor.user_id,'App:'+name,'manage');
  const pageNames=Array.isArray(req.body?.pages)?req.body.pages.filter((item:unknown):item is string=>typeof item==='string'):[];
  const version=await recordAppVersion(db,actor.tenant_id,name,pageNames,errorLines(req.body?.errors),actor.user_id);
  res.setHeader('Cache-Control','private, no-store');
  res.json({version,versions:await listAppVersions(db,actor.tenant_id,name)});
 }));
 app.post('/api/metadata/apps/:apiName/versions/:version/publish',route(async(req,res)=>{
  const actor=actorOf(req),name=appName(req);
  await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await rbac.require(actor.tenant_id,actor.user_id,'App:'+name,'manage');
  const version=Number(req.params.version);
  if(!Number.isSafeInteger(version)||version<1)throw new Error('Invalid app version');
  await publishAppVersion(db,pages,actor.tenant_id,name,version,actor.user_id);
  res.setHeader('Cache-Control','private, no-store');
  res.json({versions:await listAppVersions(db,actor.tenant_id,name)});
 }));
}

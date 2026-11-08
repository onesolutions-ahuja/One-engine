import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import {PageRuntime} from '../system-files/page-runtime.js';
import {assertMetadataPackageEditable} from '../system-support/metadata-package-service.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';

/** Page API names can be changed only when SQL proves there are no unresolved
 * metadata-value references. Known navigation references are migrated atomically.
 * Page IDs, historical layouts, drafts, component IDs and published data remain intact. */
async function assertNoUnmanagedPageReferences(client:PoolClient,tenant:string,previous:string){
 const {rows}=await client.query<{table_name:string;column_name:string}>(`
   SELECT c.table_name,c.column_name FROM information_schema.columns c
   WHERE c.table_schema='public' AND c.table_name LIKE 'md\\_%' ESCAPE '\\'
     AND (c.column_name IN ('value_text','property_value','binding_value','page_api','page_api_name',
       'target_page_api','navigation_page_api')
       OR (c.column_name LIKE '%page%api%' AND c.column_name<>'api_name'))
     AND EXISTS(SELECT 1 FROM information_schema.columns t
       WHERE t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.column_name='tenant_id')
     AND (c.column_name LIKE '%page%api%' OR c.table_name LIKE '%\\_properties' ESCAPE '\\' OR c.table_name LIKE '%\\_bindings' ESCAPE '\\')
     AND c.table_name NOT IN ('md_tenant_app_navigation')
     AND c.table_name NOT LIKE '%\\_audit' ESCAPE '\\'
   ORDER BY c.table_name,c.column_name`);
 for(const col of rows){
  // Identifiers come only from the SQL catalog, and are quoted defensively.
  const table='"'+col.table_name.replace(/"/g,'""')+'"';
  const column='"'+col.column_name.replace(/"/g,'""')+'"';
  const valueColumn=['value_text','property_value','binding_value'].includes(col.column_name);
  const clause=valueColumn
    ?`position($2 in ${column})>0`
    :`${column}=$2`;
  const check=await client.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND ${clause} LIMIT 1`,
    [tenant,previous]);
  if(check.rowCount)throw new Error(
    'Page API name is referenced by '+col.table_name+'. Update its dependent formulas or navigation first.');
 }
}

/** Tenant-scoped Page Details remain separate from canvas drafts and immutable history. */
export function registerPageDetailsController(app:Express,db:SqlPersistence,rbac:RbacEngine){
 app.patch('/api/metadata/pages/:apiName/details',wrap(async(req,res)=>{
  const actor=authenticated(req),pageApi=req.params.apiName;
  if(!api.test(pageApi))throw new Error('Invalid Page API name');
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid Page details');
  const label=body.label,appApiName=body.appApiName,expectedLabel=body.expectedLabel;
  // Page device support is relational metadata, not a component setting.
  const deviceChoices=['Desktop','Tablet','Phone','Custom'] as const;
  const devices=body.devices as unknown;
  const expectedDevices=body.expectedDevices as unknown;
  const validDeviceList=(value:unknown):value is string[]=>
   Array.isArray(value)&&value.length>=1&&value.length<=4
   &&value.every(v=>typeof v==='string'&&deviceChoices.some(choice=>choice===v))
   &&new Set(value).size===value.length;
  if(devices!==undefined&&(!validDeviceList(devices)||!validDeviceList(expectedDevices)))
   throw new Error('Invalid Page device settings or missing expected devices');
  const nextApiName=body.nextApiName===undefined?pageApi:body.nextApiName;
  if(typeof label!=='string'||!label.trim()||label.trim().length>128
    ||typeof expectedLabel!=='string'||!expectedLabel.trim()||expectedLabel.length>128
    ||appApiName!==null&&(typeof appApiName!=='string'||!api.test(appApiName))
    ||typeof nextApiName!=='string'||!api.test(nextApiName)
    ||(nextApiName!==pageApi&&nextApiName!==nextApiName.toLowerCase()))
    throw new Error('Invalid Page details');
  await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
  await assertMetadataPackageEditable(db,actor.tenant_id,'page',pageApi);
  const current=await db.query<{id:string;title:string;page_type:string;devices:string[]}>(`
   SELECT p.id,p.title,d.page_type,d.devices FROM md_page_definitions p
   JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
   WHERE p.tenant_id=$1 AND p.api_name=$2 AND p.enabled=true
  `,[actor.tenant_id,pageApi]);
  const page=current.rows[0];if(!page)throw new Error('Page not found');
  if(page.page_type!=='App Page'&&appApiName!==null)
   throw new Error('App assignments are available for App Pages only');
  // A page provisioned by AppExchange is managed by that package's lifecycle.
  const managed=await db.query(`SELECT 1 FROM md_app_seed_pages WHERE tenant_id=$1
   AND page_id=$2 LIMIT 1`,[actor.tenant_id,page.id]);
  if(managed.rowCount)throw new Error('App-owned Page must be managed through AppExchange');
  const known=await db.query<{api_name:string}>(`
   SELECT DISTINCT COALESCE(m.api_name,a.api_name) AS api_name
   FROM md_apps a
   JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
   LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
   WHERE a.enabled=true AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
     AND (EXISTS (SELECT 1 FROM md_lightning_page_activation x
       WHERE x.tenant_id=$1 AND x.page_id=$2 AND x.app_api=COALESCE(m.api_name,a.api_name))
      OR EXISTS (SELECT 1 FROM md_tenant_app_navigation n
       WHERE n.tenant_id=$1 AND n.app_id=a.id AND n.entry_type='App Page' AND n.api_name=$3))
  `,[actor.tenant_id,page.id,pageApi]);
  const existingAppNames=known.rows.map(row=>row.api_name);
  const direct=await db.query<{app_api:string}>(`SELECT app_api FROM md_lightning_page_activation
   WHERE tenant_id=$1 AND page_id=$2 AND scope='App Default'`,[actor.tenant_id,page.id]);
  const assignedAppNames=direct.rows.map(row=>row.app_api).filter(Boolean);
  const renaming=nextApiName!==pageApi;
  const appChanged=page.page_type==='App Page'&&
    (existingAppNames.length!==1||existingAppNames[0]!==appApiName
      ||assignedAppNames.length!==1||assignedAppNames[0]!==appApiName);
  const deviceChangeRequested=validDeviceList(devices)&&
   (devices.length!==page.devices.length||devices.some(v=>!page.devices.includes(v)));
  // A device change to an App Page changes its default activation factors.
  // Keep this subject to the same app-level grants as application reassignment.
  if(appChanged||renaming||(page.page_type==='App Page'&&deviceChangeRequested)){
   await rbac.require(actor.tenant_id,actor.user_id,'AppExchange','manage');
   for(const appName of new Set([...existingAppNames,...(appApiName?[appApiName]:[])]))
    await rbac.require(actor.tenant_id,actor.user_id,'App:'+appName,'manage');
  }
  await db.transaction(async client=>{
   await client.query(`SELECT set_config('metadrive.actor_tenant',$1,true),
     set_config('metadrive.actor_user',$2,true)`,[actor.tenant_id,actor.user_id]);
   const locked=await client.query<{id:string;title:string;page_type:string;status:string;devices:string[]}>(`
    SELECT p.id,p.title,d.page_type,d.status,d.devices FROM md_page_definitions p
    JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.tenant_id=$1 AND p.api_name=$2 AND p.enabled=true
    FOR UPDATE OF p,d`,[actor.tenant_id,pageApi]);
   const row=locked.rows[0];
   if(!row||row.id!==page.id||row.title!==expectedLabel||row.page_type!==page.page_type)
    throw new Error('Page details changed. Reload before saving.');
   const deviceChanged=devices!==undefined&&validDeviceList(devices)
    &&(devices.length!==row.devices.length||devices.some(v=>!row.devices.includes(v)));
   if(devices!==undefined&&validDeviceList(expectedDevices)&&
     (expectedDevices.length!==row.devices.length||expectedDevices.some(v=>!row.devices.includes(v))))
    throw new Error('Page device settings changed. Reload before saving.');
   const nextDevices=deviceChanged?devices as string[]:row.devices;
   if(page.page_type==='App Page'){
    if(!appApiName)throw new Error('Choose an installed application');
    const appRecord=await client.query<{id:string}>(`
     SELECT a.id FROM md_apps a
     JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
     JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
     LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
     WHERE COALESCE(m.api_name,a.api_name)=$2
      AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
      AND a.enabled=true AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
     FOR UPDATE OF a`,[actor.tenant_id,appApiName]);
    if(appRecord.rows.length!==1)throw new Error('App not installed or licensed');
    if(appChanged){
     await client.query(`DELETE FROM md_lightning_page_activation
      WHERE tenant_id=$1 AND page_id=$2 AND scope='App Default'`,
      [actor.tenant_id,page.id]);
     await client.query(`INSERT INTO md_lightning_page_activation
      (tenant_id,page_id,assignment_id,scope,app_api,desktop,phone,tablet,custom,sort_order)
      SELECT $1,$2,$3,'App Default',$4,
        'Desktop'=ANY($5::text[]),'Phone'=ANY($5::text[]),
        'Tablet'=ANY($5::text[]),'Custom'=ANY($5::text[]),0
      FROM md_lightning_page_details d WHERE d.tenant_id=$1 AND d.page_id=$2`,
      [actor.tenant_id,page.id,randomUUID(),appApiName,nextDevices]);
     await client.query(`DELETE FROM md_tenant_app_navigation
      WHERE tenant_id=$1 AND entry_type='App Page' AND api_name=$2`,
      [actor.tenant_id,pageApi]);
     if(row.status==='Active'){
      await client.query(`INSERT INTO md_tenant_app_navigation
       (tenant_id,app_id,entry_type,api_name,sort_order)
       SELECT $1,$2,'App Page',$3,
        COALESCE((SELECT MAX(sort_order)+1 FROM md_tenant_app_navigation
          WHERE tenant_id=$1 AND app_id=$2),0)
       WHERE NOT EXISTS (SELECT 1 FROM md_tenant_app_navigation
        WHERE tenant_id=$1 AND app_id=$2 AND entry_type='App Page' AND api_name=$3)`,
       [actor.tenant_id,appRecord.rows[0].id,pageApi]);
     }
    }
    // App Page default assignment follows device eligibility without touching
    // tenant-specific Record/Home profile assignments or customer layouts.
    if(deviceChanged&&!appChanged)await client.query(`
     UPDATE md_lightning_page_activation SET
      desktop='Desktop'=ANY($3::text[]),phone='Phone'=ANY($3::text[]),
      tablet='Tablet'=ANY($3::text[]),custom='Custom'=ANY($3::text[])
     WHERE tenant_id=$1 AND page_id=$2 AND scope='App Default'`,
     [actor.tenant_id,page.id,nextDevices]);
   }
   if(renaming){
    const exists=await client.query(`SELECT 1 FROM md_page_definitions
      WHERE tenant_id=$1 AND lower(api_name)=lower($2) AND id<>$3 LIMIT 1`,
      [actor.tenant_id,nextApiName,row.id]);
    if(exists.rowCount)throw new Error('A page already uses this API name');
    await assertNoUnmanagedPageReferences(client,actor.tenant_id,pageApi);
    // Navigation references are known stable relational links and safe to rewrite.
    await client.query(`UPDATE md_tenant_app_navigation SET api_name=$3
      WHERE tenant_id=$1 AND entry_type='App Page' AND api_name=$2`,
      [actor.tenant_id,pageApi,nextApiName]);
   }
   if(label.trim()!==row.title||renaming){
    await client.query(`UPDATE md_page_definitions SET title=$3,api_name=$4
      WHERE tenant_id=$1 AND id=$2`,[actor.tenant_id,row.id,label.trim(),nextApiName]);
   }
   if(deviceChanged)
    await client.query(`UPDATE md_lightning_page_details
     SET devices=$3::text[],updated_at=now()
     WHERE tenant_id=$1 AND page_id=$2`,[actor.tenant_id,row.id,nextDevices]);
   else if(label.trim()!==row.title||appChanged||renaming)
    await client.query(`UPDATE md_lightning_page_details SET updated_at=now()
     WHERE tenant_id=$1 AND page_id=$2`,[actor.tenant_id,row.id]);
   // Existing SQL Setup Audit triggers record tenant actor and relational changes.
   // The version snapshots remain attached to the stable page ID.
  });
  res.setHeader('Cache-Control','private, no-store');
  res.json({page:await new PageRuntime(db).metadata(actor.tenant_id,nextApiName)});
 }));
}

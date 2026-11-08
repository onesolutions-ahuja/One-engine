import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import {validateAppNavigation} from '../app-runtime/AppNavigationRegistry.js';
import {resolveTenantAppMetadata} from '../app-runtime/AppMetadataResolver.js';
import type {SqlPersistence} from './sql-persistence.js';
/** Reuse shared published App Page variants while retaining existing form-factor data. */
export function appHomeFormFactor(variant:string):'desktop'|'tablet'|'phone'|'custom' {
  return variant==='Phone'||variant==='Mobile'?'phone':variant==='Tablet'?'tablet':variant==='Custom'?'custom':'desktop';
}
export class AppRuntime {
  constructor(private readonly db:SqlPersistence) {}
  /** Metadata for installed and entitled apps only, including tenant-owned apps. */
  async listMetadata(tenantId:string) {
    return resolveTenantAppMetadata(this.db,tenantId);
  }
  /** Tenant-owned app authoring; catalog identity, licence and installation remain separate. */
  async saveMetadata(tenantId:string,apiName:string,raw:unknown,updating:boolean) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid App metadata');
    const p=raw as Record<string,unknown>;
    if(p.apiName!==apiName||!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)
      ||typeof p.label!=='string'||!p.label.trim()||p.label.length>200
      ||typeof p.description!=='string'||p.description.length>4000
      ||typeof p.brandColor!=='string'||!/^#[0-9a-fA-F]{6}$/.test(p.brandColor)
      ||!Array.isArray(p.navigationItems)||!Array.isArray(p.navigationPageApiNames)
      ||!Array.isArray(p.navigationOrder)||!Array.isArray(p.utilityItems)
      ||p.navigationItems.length>100||p.navigationPageApiNames.length>100
      ||p.navigationOrder.length>200||p.utilityItems.length>2)
      throw new Error('Invalid App metadata');
    const {objects,pages,order,utilityItems}=validateAppNavigation(p);
    await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
        [tenantId+':app:'+apiName]);
      let appId:string;
      if(updating){
        const {rows}=await client.query<{app_id:string;revision:number|null}>(`
          SELECT a.id AS app_id,m.revision FROM md_apps a
          JOIN md_app_installations i ON i.tenant_id=$1 AND i.app_id=a.id
          JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id
          LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
          WHERE COALESCE(m.api_name,a.api_name)=$2
            AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
            AND a.enabled=true AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
          FOR UPDATE OF a`,[tenantId,apiName]);
        if(!rows[0])throw new Error('App not installed or licensed');
        appId=rows[0].app_id;
        if(p.revision!==undefined&&p.revision!==rows[0].revision)
          throw new Error('App revision conflict');
      }else{
        await requireAvailableMetadataName(client,tenantId,'tenantApp',apiName);
        const collision=await client.query(`
          SELECT 1 FROM md_apps a
          LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
          WHERE (a.tenant_owner_id=$1 OR a.tenant_owner_id IS NULL)
            AND lower(COALESCE(m.api_name,a.api_name))=lower($2) AND a.enabled=true
        `,[tenantId,apiName]);
        if(collision.rowCount)throw new Error('App already exists');
        const internalKey='Tenant_'+tenantId.replace(/-/g,'')+'_'+apiName;
        const {rows}=await client.query<{id:string}>(`
          INSERT INTO md_apps(api_name,label,enabled,tenant_owner_id)
          VALUES($1,$2,true,$3) RETURNING id`,[internalKey,p.label,tenantId]);
        appId=rows[0].id;
        // A newly authored tenant App receives its own entitlement and installation.
        await client.query(`
          INSERT INTO md_app_entitlements(tenant_id,app_id,active)
          VALUES($1,$2,true)`,[tenantId,appId]);
        await client.query(`
          INSERT INTO md_app_installations(tenant_id,app_id) VALUES($1,$2)`,
          [tenantId,appId]);
      }
      for(const objectApi of objects){
        const found=await client.query(
          'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',
          [tenantId,objectApi]);
        if(!found.rowCount)throw new Error('Unknown App Object: '+objectApi);
      }
      for(const pageApi of pages){
        const found=await client.query(
          'SELECT 1 FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true',
          [tenantId,pageApi]);
        if(!found.rowCount)throw new Error('Unknown App Page: '+pageApi);
      }
      await client.query(`
        INSERT INTO md_tenant_app_metadata(tenant_id,app_id,api_name,label,description,brand_color,revision)
        VALUES($1,$2,$3,$4,$5,$6,1)
        ON CONFLICT(tenant_id,app_id) DO UPDATE SET label=EXCLUDED.label,
          description=EXCLUDED.description,brand_color=EXCLUDED.brand_color,
          revision=md_tenant_app_metadata.revision+1
      `,[tenantId,appId,apiName,p.label,p.description,p.brandColor]);
      await client.query('DELETE FROM md_tenant_app_navigation WHERE tenant_id=$1 AND app_id=$2',[tenantId,appId]);
      await client.query('DELETE FROM md_tenant_app_utilities WHERE tenant_id=$1 AND app_id=$2',[tenantId,appId]);
      for(const [position,item] of order.entries())await client.query(`
        INSERT INTO md_tenant_app_navigation(tenant_id,app_id,entry_type,api_name,sort_order)
        VALUES($1,$2,$3,$4,$5)`,[tenantId,appId,item.type,item.apiName,position]);
      for(const [position,item] of utilityItems.entries())await client.query(`
        INSERT INTO md_tenant_app_utilities(tenant_id,app_id,utility_name,sort_order)
        VALUES($1,$2,$3,$4)`,[tenantId,appId,item,position]);
    });
    const found=(await this.listMetadata(tenantId)).find(item=>item.apiName===apiName);
    if(!found)throw new Error('Saved App unavailable');
    return found;
  }
  private async catalogApi(tenantId:string,publicName:string) {
    const {rows}=await this.db.query<{api_name:string}>(`
      SELECT a.api_name FROM md_apps a
      JOIN md_app_installations i ON i.tenant_id=$1 AND i.app_id=a.id
      JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id
      LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
      WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
        AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
    `,[tenantId,publicName]);
    if(!rows[0])throw new Error('App not installed or licensed');
    return rows[0].api_name;
  }

  /** Install one published SQL manifest, never all catalog apps or their executable code. */
  async install(tenantId:string,appApi:string,seed?:import('../system-support/app-page-seeder.js').AppPageSeed) {
    await this.db.transaction(async client=>{
      // Serialize tenant install/uninstall so dependency checks cannot race removal.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':app-lifecycle']);
      const {rows}=await client.query<{id:string;api_name:string;label:string}>(`
        SELECT a.id,a.api_name,a.label FROM md_apps a
        JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
        LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
        WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true AND e.active=true
          AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
          AND (e.expires_at IS NULL OR e.expires_at>now()) FOR UPDATE OF e
      `,[tenantId,appApi]);
      if(!rows[0])throw new Error('App licence or entitlement unavailable');
      const app=rows[0];
      const {rows:versions}=await client.query<{version:number;description:string;brand_color:string}>(`
        SELECT version,description,brand_color FROM md_app_package_versions
        WHERE app_id=$1 AND published=true ORDER BY version DESC LIMIT 1
      `,[app.id]);
      const published=versions[0];
      if(published){
        const {rows:dependencies}=await client.query<{
          api_name:string;minimum_version:number;installed_version:number|null;installed:boolean;licensed:boolean
        }>(`
          SELECT required.api_name,d.minimum_version,iv.version AS installed_version,
            (i.app_id IS NOT NULL) AS installed,
            (e.app_id IS NOT NULL AND e.active=true AND
              (e.expires_at IS NULL OR e.expires_at>now())) AS licensed
          FROM md_app_package_dependencies d
          JOIN md_apps required ON required.id=d.required_app_id AND required.enabled=true
          LEFT JOIN md_app_installations i ON i.tenant_id=$3 AND i.app_id=d.required_app_id
          LEFT JOIN md_app_entitlements e ON e.tenant_id=$3 AND e.app_id=d.required_app_id
          LEFT JOIN md_tenant_app_installed_versions iv ON iv.tenant_id=$3
            AND iv.app_id=d.required_app_id
          WHERE d.app_id=$1 AND d.version=$2
          ORDER BY required.api_name
        `,[app.id,published.version,tenantId]);
        for(const dependency of dependencies){
          if(!dependency.installed||!dependency.licensed
            ||(dependency.installed_version??0)<dependency.minimum_version)
            throw new Error('Install dependency first: '+dependency.api_name+
              ' (version '+dependency.minimum_version+' or later)');
        }
      }
      await client.query(`
        INSERT INTO md_app_installations(tenant_id,app_id) VALUES($1,$2)
        ON CONFLICT DO NOTHING
      `,[tenantId,app.id]);
      if(published){
        // Tenant navigation is FK-scoped to md_tenant_app_metadata. Install-specific
        // seeders may create navigation entries, so create the parent metadata row
        // BEFORE invoking either package or app seeding, in the same transaction.
        // Never overwrite an existing tenant's edited metadata on reinstall.
        await client.query(`
          INSERT INTO md_tenant_app_metadata
            (tenant_id,app_id,api_name,label,description,brand_color)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,app_id) DO NOTHING
        `,[tenantId,app.id,app.api_name,app.label,published.description,published.brand_color]);
        // Package seeder is imported only during selected-tenant installation, never on startup.
        const {seedPublishedAppPackage}=await import('../app-seeders/published-app-package.js');
        await seedPublishedAppPackage(client,tenantId,app.id,published.version);
      }
      // Install app-owned metadata in the same transaction as licensing and package
      // materialisation. The generic hook resolves optional seeder modules lazily.
      const {seedInstalledAppMetadata}=await import('../app-seeders/installed-app-seeders.js');
      await seedInstalledAppMetadata(client,tenantId,app.api_name);
      if(seed){
        const {seedAppPage}=await import('../system-support/app-page-seeder.js');
        await seedAppPage(client,tenantId,app.id,seed);
      }
      // Existing catalog entries without manifests retain their legacy install path.
      if(!published)return;
      const {rows:requirements}=await client.query<{
        resource_type:string;api_name:string;parent_api:string
      }>(`SELECT resource_type,api_name,parent_api FROM md_app_package_resources
        WHERE app_id=$1 AND version=$2 ORDER BY resource_type,api_name`,[app.id,published.version]);
      for(const requirement of requirements){
        const type=requirement.resource_type;
        const sql=type==='Object'
          ?'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2'
          :type==='Field'
          ?'SELECT 1 FROM md_field_definitions WHERE tenant_id=$1 AND api_name=$2 AND object_api=$3 AND deleted_at IS NULL'
          :type==='Component'
          ?'SELECT 1 FROM md_component_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true'
          :type==='App Page'
          ?'SELECT 1 FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true'
          :type==='Flow'
          ?'SELECT 1 FROM md_flow_definitions WHERE tenant_id=$1 AND api_name=$2 AND active=true AND archived=false'
          :null;
        if(!sql)throw new Error('Unsupported app package resource');
        const result=await client.query(sql,
          type==='Field'?[tenantId,requirement.parent_api,requirement.api_name]
            :[tenantId,requirement.api_name]);
        if(!result.rowCount)throw new Error('Missing app package resource: '+type+' '+(
          type==='Field'?requirement.parent_api+'.':'')+requirement.api_name);
      }
      const {rows:navigation}=await client.query<{
        entry_type:'Object'|'App Page';api_name:string;sort_order:number
      }>(`SELECT entry_type,api_name,sort_order FROM md_app_package_navigation
        WHERE app_id=$1 AND version=$2 ORDER BY sort_order,api_name`,[app.id,published.version]);
      for(const item of navigation){
        const table=item.entry_type==='Object'?'md_object_definitions':'md_page_definitions';
        const found=await client.query('SELECT 1 FROM '+table+' WHERE tenant_id=$1 AND api_name=$2',
          [tenantId,item.api_name]);
        if(!found.rowCount)throw new Error('Missing app navigation resource: '+item.api_name);
      }
      for(const item of navigation){
        await client.query(`
          INSERT INTO md_tenant_app_navigation(tenant_id,app_id,entry_type,api_name,sort_order)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
        `,[tenantId,app.id,item.entry_type,item.api_name,item.sort_order]);
      }
      const {rows:current}=await client.query<{version:number}>(`
        SELECT version FROM md_tenant_app_installed_versions
        WHERE tenant_id=$1 AND app_id=$2 FOR UPDATE
      `,[tenantId,app.id]);
      if(current[0]&&current[0].version>published.version)
        throw new Error('App downgrade is not allowed');
      await client.query(`
        INSERT INTO md_tenant_app_installed_versions(tenant_id,app_id,version)
        VALUES($1,$2,$3)
        ON CONFLICT(tenant_id,app_id) DO UPDATE SET
          version=EXCLUDED.version,installed_at=now()
      `,[tenantId,app.id,published.version]);
    });
  }
  async uninstall(tenantId:string,appApi:string) {
    await this.db.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':app-lifecycle']);
      const {rows:installed}=await client.query<{id:string;api_name:string}>(`
        SELECT a.id,a.api_name FROM md_apps a
        JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
        LEFT JOIN md_tenant_app_metadata m ON m.app_id=a.id AND m.tenant_id=$1
        WHERE COALESCE(m.api_name,a.api_name)=$2
          AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
      `,[tenantId,appApi]);
      if(!installed.length)return;
      const target=installed[0];
      const {rows:blockers}=await client.query<{api_name:string}>(`
        SELECT parent.api_name FROM md_app_package_dependencies d
        JOIN md_tenant_app_installed_versions v ON v.app_id=d.app_id
          AND v.version=d.version AND v.tenant_id=$1
        JOIN md_app_installations i ON i.tenant_id=v.tenant_id AND i.app_id=v.app_id
        JOIN md_apps parent ON parent.id=d.app_id
        WHERE d.required_app_id=$2 LIMIT 1
      `,[tenantId,target.id]);
      if(blockers.length)throw new Error('Uninstall dependent app first: '+blockers[0].api_name);
      await client.query(`
        UPDATE md_durable_jobs SET status='cancelled',lease_owner=NULL,
          lease_until=NULL,updated_at=now()
        WHERE tenant_id=$1 AND app_api_name IN ($2,$3) AND status IN ('queued','leased')
      `,[tenantId,appApi,target.api_name]);
      // Deactivate only the chosen connector's managed integration, retaining ciphertext.
      const {uninstallConnectorApp}=await import('../app-seeders/connector-apps.js');
      await uninstallConnectorApp(client,tenantId,target.api_name);
      await client.query('DELETE FROM md_app_home_pages WHERE tenant_id=$1 AND app_id=$2',
        [tenantId,target.id]);
      // Version receipt cascades; business records and shared component metadata survive.
      await client.query('DELETE FROM md_app_installations WHERE tenant_id=$1 AND app_id=$2',
        [tenantId,target.id]);
    });
  }
  async homePage(tenantId:string,appApi:string,formFactor:string,profileId='') {
    const {rows}=await this.db.query<{api_name:string|null}>(`
      SELECT COALESCE(home.api_name,
        CASE WHEN home_detail.page_id IS NULL OR
          (CASE $3 WHEN 'desktop' THEN 'Desktop'
            WHEN 'tablet' THEN 'Tablet' WHEN 'phone' THEN 'Phone'
            WHEN 'custom' THEN 'Custom' ELSE '' END)=ANY(home_detail.devices)
        THEN p.api_name ELSE NULL END) AS api_name FROM md_apps a
      JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
      JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=$1
      LEFT JOIN md_tenant_app_metadata m ON m.app_id=a.id AND m.tenant_id=$1
      LEFT JOIN md_app_home_pages h ON h.tenant_id=$1 AND h.app_id=a.id AND h.form_factor=$3
      LEFT JOIN md_page_definitions p ON p.id=h.page_id AND p.tenant_id=$1 AND p.enabled=true
      LEFT JOIN md_lightning_page_details home_detail ON home_detail.tenant_id=p.tenant_id
        AND home_detail.page_id=p.id
      LEFT JOIN LATERAL (
        SELECT hp.api_name FROM md_lightning_page_activation x
        JOIN md_lightning_page_details d ON d.tenant_id=x.tenant_id AND d.page_id=x.page_id
        JOIN md_page_definitions hp ON hp.tenant_id=d.tenant_id AND hp.id=d.page_id
        WHERE x.tenant_id=$1 AND x.app_api=$2 AND d.status='Active'
          AND d.page_type='Home Page' AND hp.enabled=true
          AND (CASE $3 WHEN 'desktop' THEN 'Desktop'
            WHEN 'tablet' THEN 'Tablet' WHEN 'phone' THEN 'Phone'
            WHEN 'custom' THEN 'Custom' ELSE '' END)=ANY(d.devices)
          AND ((x.scope='App Default') OR (x.scope='App and Profile' AND x.profile_id=$4))
          AND (($3='desktop' AND x.desktop) OR ($3='tablet' AND x.tablet) OR ($3='phone' AND x.phone) OR ($3='custom' AND x.custom))
        ORDER BY CASE x.scope WHEN 'App and Profile' THEN 2 ELSE 1 END DESC,
          d.updated_at DESC LIMIT 1
      ) home ON true
      WHERE COALESCE(m.api_name,a.api_name)=$2 AND a.enabled=true
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
        AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
    `,[tenantId,appApi,formFactor,profileId]);
    if(!rows.length)throw new Error('Permission denied');
    return rows[0].api_name?{apiName:rows[0].api_name}:null;
  }
  async marketplace(tenantId:string) {
    const {rows}=await this.db.query<{
      id:string;api_name:string;label:string;app_type:'Application'|'ConnectorApp';description:string|null;installed:boolean;
      expires_at:Date|null;licensed:boolean;package_version:number|null;installed_version:number|null;
      credential_name:string|null;credential_base_url:string|null;credential_auth_type:string|null
    }>(`
      SELECT a.id,a.app_type,COALESCE(m.api_name,a.api_name) AS api_name,COALESCE(m.label,a.label) AS label,
        COALESCE(m.description,p.description) AS description,
        (i.app_id IS NOT NULL) AS installed,iv.version AS installed_version,
        p.version AS package_version,e.expires_at,
        c.credential_name,cred.base_url AS credential_base_url,cred.auth_type AS credential_auth_type,
        (COALESCE(e.active,false) AND
          (e.expires_at IS NULL OR e.expires_at>now())) AS licensed
      FROM md_apps a
      LEFT JOIN md_app_installations i ON i.tenant_id=$1 AND i.app_id=a.id
      LEFT JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id
      LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=$1 AND m.app_id=a.id
      LEFT JOIN md_tenant_app_installed_versions iv ON iv.tenant_id=$1 AND iv.app_id=a.id
      LEFT JOIN md_connector_app_credentials c ON c.tenant_id=$1 AND c.app_id=a.id
      LEFT JOIN md_named_credentials cred ON cred.tenant_id=$1 AND cred.id=c.credential_id
      LEFT JOIN LATERAL (
        SELECT version,description FROM md_app_package_versions
        WHERE app_id=a.id AND published=true ORDER BY version DESC LIMIT 1
      ) p ON true
      WHERE a.enabled=true AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
      ORDER BY a.label
    `,[tenantId]);
    return {records:rows.map(row=>({
      Id:row.id,Name:row.label,AppKey__c:row.api_name,
      AppType__c:row.app_type??'Application',
      Category__c:row.app_type==='ConnectorApp'?'Connector Apps':'Applications',
      Description__c:row.description??'',CredentialName__c:row.credential_name??'',
      ...(row.credential_name?{DefaultBaseUrl__c:row.credential_base_url??'',
        AuthType__c:row.credential_auth_type??'None'}:{}),
      Installed__c:row.installed,
      LicenceStatus__c:row.licensed?'ACTIVE':'UNLICENSED',
      ...(row.package_version?{PackageVersion__c:row.package_version}:{}),
      ...(row.installed_version?{InstalledPackageVersion__c:row.installed_version}:{}),
      ...(row.expires_at?{LicenceExpiresAt__c:new Date(row.expires_at).toISOString()}:{})
    }))};
  }
  /** Tenant app route aliases are independently versioned SQL metadata. */
  async listAliases(tenantId:string){
    const {rows}=await this.db.query<{
      app_api:string;slug:string;kind:string;target_api:string;status:string;version:number
    }>(`
      SELECT COALESCE(m.api_name,r.app_api) AS app_api,r.slug,r.kind,r.target_api,r.status,r.version
      FROM md_app_route_aliases r
      JOIN md_apps a ON a.api_name=r.app_api
      JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=r.tenant_id
      LEFT JOIN md_tenant_app_metadata m ON m.app_id=a.id AND m.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=$1)
      ORDER BY app_api,r.slug
    `,[tenantId]);
    return {aliases:rows.map(r=>({
      appId:r.app_api,slug:r.slug,kind:r.kind,
      targetApiName:r.target_api,status:r.status,version:r.version
    }))};
  }
  async saveAlias(tenantId:string,appApi:string,slug:string,input:Record<string,unknown>){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(appApi)|| !/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(slug))
      throw new Error('Invalid route alias');
    const kind=input.kind,target=input.targetApiName,expected=input.expectedVersion;
    if(input.appId!==appApi||input.slug!==slug||
      !['App Home','App Page','Record List'].includes(String(kind))||
      typeof target!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(target)||
      !Number.isSafeInteger(expected)||Number(expected)<0)
      throw new Error('Invalid route alias');
    if(kind==='App Home'&&target!==appApi)throw new Error('Invalid App Home destination');
    const catalog=await this.catalogApi(tenantId,appApi);
    const {rows:install}=await this.db.query<{id:string}>(`
      SELECT a.id FROM md_apps a
      JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=$1
      JOIN md_app_entitlements e ON e.tenant_id=$1 AND e.app_id=a.id
      WHERE a.api_name=$2 AND a.enabled=true AND e.active=true
        AND (e.expires_at IS NULL OR e.expires_at>now())
    `,[tenantId,catalog]);
    if(!install.length)throw new Error('App not installed or licensed');
    if(kind!=='App Home'){
      const query=kind==='App Page'
        ? 'SELECT id FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true'
        : 'SELECT id FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2';
      const found=await this.db.query(query,[tenantId,target]);
      if(!found.rows.length)throw new Error('Route alias destination unavailable');
    }
    const version=Number(expected);
    const {rows}=await this.db.query<{version:number}>(version===0?`
      INSERT INTO md_app_route_aliases(tenant_id,app_api,slug,kind,target_api,status,version)
      VALUES($1,$2,$3,$4,$5,'Active',1)
      ON CONFLICT(tenant_id,app_api,slug) DO NOTHING RETURNING version
    `:`
      UPDATE md_app_route_aliases
      SET kind=$4,target_api=$5,status='Active',version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND app_api=$2 AND slug=$3 AND version=$6
      RETURNING version
    `,version===0?[tenantId,catalog,slug,kind,target]:[tenantId,catalog,slug,kind,target,version]);
    if(!rows.length)throw new Error('Route alias version conflict');
    return {appId:appApi,slug,kind,targetApiName:target,status:'Active',version:rows[0].version};
  }
  async disableAlias(tenantId:string,appApi:string,slug:string,expectedVersion:unknown){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(appApi)||
      !/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(slug)||
      !Number.isSafeInteger(expectedVersion)||Number(expectedVersion)<1)
      throw new Error('Invalid route alias');
    const catalog=await this.catalogApi(tenantId,appApi);
    const {rowCount}=await this.db.query(`
      UPDATE md_app_route_aliases
      SET status='Disabled',version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND app_api=$2 AND slug=$3 AND version=$4 AND status='Active'
    `,[tenantId,catalog,slug,expectedVersion]);
    if(!rowCount)throw new Error('Route alias version conflict');
  }
  async resolveAlias(tenantId:string,appApi:string,slug:string){
    const catalog=await this.catalogApi(tenantId,appApi);
    const {rows}=await this.db.query<{kind:string;target_api:string}>(`
      SELECT r.kind,r.target_api FROM md_app_route_aliases r
      JOIN md_apps a ON a.api_name=r.app_api
      JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=r.tenant_id
      JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 AND r.app_api=$2 AND r.slug=$3 AND r.status='Active'
        AND a.enabled=true AND e.active=true
        AND (e.expires_at IS NULL OR e.expires_at>now())
    `,[tenantId,catalog,slug]);
    const record=rows[0];
    if(!record)throw new Error('Route alias unavailable');
    const target=record.target_api;
    if(record.kind!=='App Home'){
      const sql=record.kind==='App Page'
        ? 'SELECT 1 FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true'
        : 'SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2';
      const result=await this.db.query(sql,[tenantId,target]);
      if(!result.rows.length)throw new Error('Route alias destination unavailable');
    }
    const app=encodeURIComponent(appApi),api=encodeURIComponent(target);
    if(record.kind==='App Home')return {path:'/une/apps/'+app+'/home',kind:record.kind,targetApiName:target};
    if(record.kind==='App Page')return {path:'/une/apps/'+app+'/pages/'+api,kind:record.kind,targetApiName:target};
    if(record.kind==='Record List'){
      const q=new URLSearchParams({filterName:'All'+target+'s',appId:appApi});
      return {path:'/une/o/'+api+'/list?'+q.toString(),kind:record.kind,targetApiName:target};
    }
    throw new Error('Invalid route alias destination');
  }
  async listInstalled(tenantId:string) {
    return this.listMetadata(tenantId);
  }
}

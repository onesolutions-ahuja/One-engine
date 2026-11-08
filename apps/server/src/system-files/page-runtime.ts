import {validatePageComponentContracts} from '../system-support/component-contract-store.js';
import {requirePagePropertyContract} from '../system-support/page-property-contract.js';
import {requireAvailableMetadataName} from '../system-support/metadata-name-guard.js';
import {encodeMetadataValue,decodeMetadataValues,type MetadataValueRow} from './component-runtime.js';
import {expandAppProperties} from '../system-support/app-page-seeder.js';
import type { SqlPersistence } from './sql-persistence.js';
import {PageLayoutVersionRuntime,runtimeLayoutVariant,type PageLayoutVariant} from './page-layout-version-runtime.js';

type PropRow=MetadataValueRow;
type NodeRow={component_key:string;component_type:string;label:string;region:string;visible:boolean};
const encodePageValue=encodeMetadataValue;
const decodePageValues=decodeMetadataValues;

export class PageRuntime {
  private readonly layouts:PageLayoutVersionRuntime;
  // Published metadata only. Legacy pages perform permission checks during load
  // and must not be served from this cache.
  private readonly publishedLoadCache=new Map<string,{
    at:number;value:{page:Awaited<ReturnType<PageRuntime['metadata']>>}
  }>();
  private static readonly PUBLISHED_LOAD_TTL_MS=30_000;
  private static readonly PUBLISHED_LOAD_CACHE_MAX=300;
  constructor(private readonly db:SqlPersistence) {this.layouts=new PageLayoutVersionRuntime(db);}
  private publishedCacheKey(tenantId:string,pageApi:string,variant:PageLayoutVariant):string{
    return JSON.stringify([tenantId,pageApi,variant]);
  }
  private invalidatePublishedCache(tenantId:string,pageApi:string):void{
    const prefix=JSON.stringify([tenantId,pageApi]).slice(0,-1)+',';
    for(const key of this.publishedLoadCache.keys())
      if(key.startsWith(prefix))this.publishedLoadCache.delete(key);
  }
  async list(tenantId:string) {
    const {rows}=await this.db.query<{api_name:string}>(`SELECT p.api_name FROM md_page_definitions p
      JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
      WHERE p.tenant_id=$1 AND p.enabled=true ORDER BY p.title,p.api_name`,[tenantId]);
    return Promise.all(rows.map(row=>this.metadata(tenantId,row.api_name)));
  }
  private async loadLegacy(tenantId:string,pageApi:string) {
    const page=await this.db.query<{id:string;title:string}>(
      'SELECT id,title FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 AND enabled=true',[tenantId,pageApi]);
    if(!page.rows[0]) throw new Error('Page not found');
    const owner=await this.db.query<{allowed:boolean}>(`SELECT EXISTS (
      SELECT 1 FROM md_app_installations i JOIN md_apps a ON a.id=i.app_id AND a.enabled=true
      JOIN md_app_entitlements e ON e.app_id=i.app_id AND e.tenant_id=i.tenant_id
      WHERE i.tenant_id=s.tenant_id AND i.app_id=s.app_id AND e.active=true
        AND (e.expires_at IS NULL OR e.expires_at>now())) AS allowed
      FROM md_app_seed_pages s WHERE s.tenant_id=$1 AND s.page_id=$2`,[tenantId,page.rows[0].id]);
    if(owner.rows.some(row=>!row.allowed))throw new Error('Permission denied');
    const components=await this.db.query<{id:string;component_api:string;slot:string;sort_order:number}>(
      'SELECT id,component_api,slot,sort_order FROM md_page_components WHERE tenant_id=$1 AND page_id=$2 ORDER BY sort_order',
      [tenantId,page.rows[0].id]);
    const properties=await this.db.query<{
      component_id:string;property_path:string;value_text:string|null;data_type:string;
      object_id:string|null;field_id:string|null;flow_id:string|null
    }>(`SELECT p.* FROM md_page_component_properties p JOIN md_page_components c ON c.tenant_id=p.tenant_id AND c.id=p.component_id
      WHERE c.tenant_id=$1 AND c.page_id=$2`,[tenantId,page.rows[0].id]);
    const configured=components.rows.map(c=>({
      id:c.id,type:c.component_api,label:c.component_api,region:c.slot,visible:true,
      properties:expandAppProperties(properties.rows.filter(p=>p.component_id===c.id))
    }));
    return {page:{
      apiName:pageApi,label:page.rows[0].title,targetObject:'',pageType:'App Page',
      layoutMode:'template',canvasWidth:1200,canvasHeight:800,status:'Active',
      customTargetEnabled:false,customTargetMinWidth:320,customTargetMaxWidth:10000,
      devices:['Desktop','Phone'],components:configured,activationAssignments:[]
    },components:configured};
  }

  async metadata(tenantId:string,pageApi:string,variant:PageLayoutVariant='Desktop'){
    const {rows}=await this.db.query<{
      id:string;api_name:string;title:string;page_type:string;target_object:string;record_mode:string;layout_mode:string;
      template:string|null;canvas_width:number;canvas_height:number;canvas_fill_color:string;status:string;
      devices:string[];revision:number;updated_at:Date
    }>(`SELECT p.id,p.api_name,p.title,d.page_type,d.target_object,d.record_mode,d.layout_mode,d.template,
      d.canvas_width,d.canvas_height,d.canvas_fill_color,d.status,d.devices,d.revision,d.updated_at
      FROM md_page_definitions p JOIN md_lightning_page_details d
        ON d.tenant_id=p.tenant_id AND d.page_id=p.id
      WHERE p.tenant_id=$1 AND p.api_name=$2 AND p.enabled=true`,[tenantId,pageApi]);
    const page=rows[0];if(!page)throw new Error('Page not found');
    const [nodes,properties,assignments]=await Promise.all([
      this.db.query<NodeRow>(
        'SELECT component_key,component_type,label,region,visible FROM md_lightning_page_nodes WHERE tenant_id=$1 AND page_id=$2 ORDER BY sort_order',[tenantId,page.id]),
      this.db.query<PropRow>(
        'SELECT component_key,property_path,value_kind,value_text FROM md_lightning_page_node_properties WHERE tenant_id=$1 AND page_id=$2',[tenantId,page.id]),
      this.db.query<{assignment_id:string;scope:string;app_api:string|null;profile_id:string|null;record_type_id:string|null;desktop:boolean;phone:boolean;tablet:boolean;custom:boolean}>(
        'SELECT assignment_id,scope,app_api,profile_id,record_type_id,desktop,phone,tablet,custom FROM md_lightning_page_activation WHERE tenant_id=$1 AND page_id=$2 ORDER BY sort_order',[tenantId,page.id])
    ]);
    const components=nodes.rows.map(node=>{
      const data=decodePageValues(properties.rows.filter(row=>row.component_key===node.component_key));
      return {...(data.extra as Record<string,unknown>??{}),id:node.component_key,type:node.component_type,
        label:node.label,region:node.region,visible:node.visible,properties:data.props??{}};
    });
    const base={apiName:page.api_name,label:page.title,targetObject:page.target_object,
      pageType:page.page_type,recordMode:page.record_mode,layoutMode:page.layout_mode,template:page.template??undefined,
      canvasWidth:page.canvas_width,canvasHeight:page.canvas_height,
       canvasFillColor:page.canvas_fill_color??'#ffffff',status:page.status,
      devices:page.devices,revision:page.revision,updatedAt:page.updated_at,
      components,activationAssignments:assignments.rows.map(a=>({
        id:a.assignment_id,scope:a.scope,appId:a.app_api,profileId:a.profile_id,recordTypeId:a.record_type_id,
        formFactors:[...(a.desktop?['Desktop']:[]),...(a.phone?['Phone']:[]),...(a.tablet?['Tablet']:[]),...(a.custom?['Custom']:[])]
      }))};
    return this.layouts.load(tenantId,pageApi,variant,'published',base);
  }
  /** Editor reads pending revisions; ordinary page routes see only published versions. */
  async editor(tenantId:string,pageApi:string,variant:PageLayoutVariant){
    const base=await this.metadata(tenantId,pageApi,variant);
    return this.layouts.load(tenantId,pageApi,variant,'draft',base);
  }
  async version(tenantId:string,pageApi:string,variant:PageLayoutVariant,version:number){
    const base=await this.metadata(tenantId,pageApi,variant);
    return this.layouts.version(tenantId,pageApi,variant,version,base);
  }
  async saveLayoutDraft(tenantId:string,pageApi:string,variant:PageLayoutVariant,payload:unknown,actor?:string){
    const base=await this.metadata(tenantId,pageApi,variant);
    return this.layouts.saveDraft(tenantId,pageApi,variant,payload,base,actor);
  }
  async publishLayout(tenantId:string,pageApi:string,variant:PageLayoutVariant,expected?:number,actor?:string){
    await this.layouts.publish(tenantId,pageApi,variant,expected,actor);
    this.invalidatePublishedCache(tenantId,pageApi);
    return this.metadata(tenantId,pageApi,variant);
  }
  async rollbackLayout(tenantId:string,pageApi:string,variant:PageLayoutVariant,version:number,actor?:string){
    await this.layouts.rollback(tenantId,pageApi,variant,version,actor);
    return this.editor(tenantId,pageApi,variant);
  }
  /** Copy an immutable history snapshot to a NEW draft revision, without
   * changing published output or rewriting the original version. */
  async copyLayoutVersion(tenantId:string,pageApi:string,variant:PageLayoutVariant,
    version:number,actor:string){
    const versions=await this.layouts.history(tenantId,pageApi,variant);
    const selected=versions.find(v=>v.version===version);
    if(!selected)throw new Error('Page layout revision not found');
    if(selected.archived)throw new Error('Unarchive the version before copying it');
    const [editor,source]=await Promise.all([
      this.editor(tenantId,pageApi,variant),this.version(tenantId,pageApi,variant,version)
    ]);
    const copy={...editor,...source,apiName:editor.apiName,label:editor.label,
      draftRevision:editor.draftRevision,activationAssignments:editor.activationAssignments};
    const result=await this.saveLayoutDraft(tenantId,pageApi,variant,copy,actor);
    return result;
  }
  async archiveLayout(tenantId:string,pageApi:string,variant:PageLayoutVariant,
    version:number,archived:boolean,actor:string){
    await this.layouts.archive(tenantId,pageApi,variant,version,archived,actor);
    return this.layouts.history(tenantId,pageApi,variant);
  }
  async layoutHistory(tenantId:string,pageApi:string,variant:PageLayoutVariant){
    return this.layouts.history(tenantId,pageApi,variant);
  }
  async load(tenantId:string,pageApi:string,variant:PageLayoutVariant='Desktop'){
    const key=this.publishedCacheKey(tenantId,pageApi,variant);
    const hit=this.publishedLoadCache.get(key);
    if(hit&&Date.now()-hit.at<PageRuntime.PUBLISHED_LOAD_TTL_MS)return hit.value;
    if(hit)this.publishedLoadCache.delete(key);
    // metadata() already checks the tenant-scoped Lightning page row.
    const page=await this.metadata(tenantId,pageApi,variant).catch(error=>{
      if(error instanceof Error&&error.message==='Page not found')return null;
      throw error;
    });
    if(!page)return this.loadLegacy(tenantId,pageApi);
    const value={page};
    if(this.publishedLoadCache.size>=PageRuntime.PUBLISHED_LOAD_CACHE_MAX)
      this.publishedLoadCache.delete(this.publishedLoadCache.keys().next().value!);
    this.publishedLoadCache.set(key,{at:Date.now(),value});
    return value;
  }

  /** Transactional draft publishing and component persistence; no JSON columns. */
  async save(tenantId:string,previousApiName:string,raw:unknown,createOnly=false){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid Page metadata');
    const p=raw as Record<string,unknown>;
    const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128;
    if(!id(p.apiName)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(p.apiName)
      ||!id(p.label)||!['Record Page','App Page','Home Page','In-Screen Page','Print Template'].includes(String(p.pageType))
      ||!['template','free-canvas'].includes(String(p.layoutMode))
      ||!['Active','Draft'].includes(String(p.status))||typeof p.targetObject!=='string'
      ||!Number.isInteger(p.canvasWidth)||!Number.isInteger(p.canvasHeight)
      ||Number(p.canvasWidth)<320||Number(p.canvasWidth)>10000
      ||Number(p.canvasHeight)<320||Number(p.canvasHeight)>10000
       ||(p.canvasFillColor!==undefined&&(typeof p.canvasFillColor!=='string'||!/^#[0-9a-fA-F]{6}$/.test(p.canvasFillColor)))
      ||!Array.isArray(p.devices)||!p.devices.length||p.devices.length>4
      ||new Set(p.devices).size!==p.devices.length
      ||p.devices.some(v=>!['Desktop','Tablet','Phone','Custom'].includes(String(v)))
      ||!Array.isArray(p.components)||p.components.length>400
      ||!Array.isArray(p.activationAssignments??[])||(p.activationAssignments as unknown[]).length>200)
      throw new Error('Invalid Page metadata');
    if(p.pageType==='Record Page'&&!['View','Edit'].includes(String(p.recordMode??'View')))
      throw new Error('Invalid Record Page mode');
    if(p.pageType==='Record Page'){
      const found=await this.db.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[tenantId,p.targetObject]);
      if(!found.rowCount)throw new Error('Invalid Page target object');
    }
    const components=p.components as Array<Record<string,unknown>>;
    const keys=new Set<string>();
    for(const c of components){
      if(!c||typeof c!=='object'||Array.isArray(c)||!id(c.id)||!id(c.type)
        ||typeof c.label!=='string'||c.label.length>200||keys.has(String(c.id).toLowerCase()))throw new Error('Invalid Page component or duplicate Component ID');
      requirePagePropertyContract(String(c.type),c.properties);
      keys.add(String(c.id).toLowerCase());
    }
    await validatePageComponentContracts(this.db,tenantId,components);
    const assignments=p.activationAssignments as Array<Record<string,unknown>>|undefined ?? [];
    if(p.status==='Active'&&!['App Page','In-Screen Page','Print Template'].includes(String(p.pageType))&&!assignments.length)
      throw new Error('Invalid Page activation');
    const assignmentIds=new Set<string>();
    for(const a of assignments){
      if(!a||typeof a!=='object'||Array.isArray(a)||!id(a.id)||assignmentIds.has(a.id)
        ||!['Org Default','App Default','App and Profile','App, Record Type, and Profile'].includes(String(a.scope))
        ||!Array.isArray(a.formFactors)||!a.formFactors.length
        ||a.formFactors.some(v=>!['Desktop','Phone','Tablet','Custom'].includes(String(v)))
        ||(a.scope!=='Org Default'&&!id(a.appId))
        ||(['App and Profile','App, Record Type, and Profile'].includes(String(a.scope))&&!id(a.profileId))
        ||(a.scope==='App, Record Type, and Profile'&&!id(a.recordTypeId)))
        throw new Error('Invalid Page activation');
      assignmentIds.add(a.id);
    }
    await this.db.transaction(async client=>{
      const existing=await client.query<{id:string;enabled:boolean}>(
        'SELECT id,enabled FROM md_page_definitions WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE',[tenantId,previousApiName]);
      let pageId=existing.rows[0]?.id;
      // MCP create_page must never overwrite an existing tenant-authored Page.
      // Enforce this inside the transaction to avoid a separate check/write race.
      if(pageId&&createOnly)throw new Error('Page already exists');
      // Archived pages retain their identity and immutable history. They must
      // never be silently updated or resurrected by a new-page request.
      if(pageId&&existing.rows[0]?.enabled===false)
        throw new Error('Page API name already exists (archived)');
      if(pageId){
        if(p.apiName!==previousApiName)throw new Error('Rename this page from Page Properties');
        const managed=await client.query(
          'SELECT 1 FROM md_app_seed_pages WHERE tenant_id=$1 AND page_id=$2 LIMIT 1',[tenantId,pageId]);
        if(managed.rowCount)throw new Error('Invalid managed Page update');
        await client.query('UPDATE md_page_definitions SET api_name=$3,title=$4 WHERE tenant_id=$1 AND id=$2',
          [tenantId,pageId,p.apiName,p.label]);
      }else{
        if(p.apiName!==previousApiName)throw new Error('Page not found');
        await requireAvailableMetadataName(client,tenantId,'page',String(p.apiName));
        try{
          const inserted=await client.query<{id:string}>(
            'INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled) VALUES($1,$2,$3,true) RETURNING id',
            [tenantId,p.apiName,p.label]);
          pageId=inserted.rows[0].id;
        }catch(error){
          // A concurrent create may reserve this name after the availability check.
          if((error as {code?:string}).code==='23505')throw new Error('Page already exists');
          throw error;
        }
      }
      const before=await client.query<{revision:number}>(
        'SELECT revision FROM md_lightning_page_details WHERE tenant_id=$1 AND page_id=$2 FOR UPDATE',[tenantId,pageId]);
      const rev=before.rows[0]?.revision??0;
      if(p.revision!==undefined&&p.revision!==rev)throw new Error('Page revision conflict');
      await client.query(`INSERT INTO md_lightning_page_details
        (tenant_id,page_id,page_type,target_object,record_mode,layout_mode,template,canvas_width,canvas_height,canvas_fill_color,status,devices,revision,creation_layout_variant)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(tenant_id,page_id) DO UPDATE SET
          page_type=EXCLUDED.page_type,target_object=EXCLUDED.target_object,
          record_mode=EXCLUDED.record_mode,layout_mode=EXCLUDED.layout_mode,template=EXCLUDED.template,
          canvas_width=EXCLUDED.canvas_width,canvas_height=EXCLUDED.canvas_height,
           canvas_fill_color=EXCLUDED.canvas_fill_color,
          status=EXCLUDED.status,devices=EXCLUDED.devices,revision=EXCLUDED.revision,updated_at=now()`,
        [tenantId,pageId,p.pageType,p.targetObject,p.recordMode??'View',p.layoutMode,p.template??null,
          p.canvasWidth,p.canvasHeight,p.canvasFillColor??'#ffffff',p.status,p.devices,rev+1,
          ['Desktop','Mobile','Tablet','Custom'].includes(String(p.layoutVariant))?p.layoutVariant:'Desktop']);
      await client.query('DELETE FROM md_lightning_page_nodes WHERE tenant_id=$1 AND page_id=$2',[tenantId,pageId]);
      await client.query('DELETE FROM md_lightning_page_activation WHERE tenant_id=$1 AND page_id=$2',[tenantId,pageId]);
      for(const [index,c] of components.entries()){
        await client.query(`INSERT INTO md_lightning_page_nodes
          (tenant_id,page_id,component_key,component_type,label,region,visible,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tenantId,pageId,c.id,c.type,c.label,c.region??'main',c.visible!==false,index]);
        const extra=Object.fromEntries(Object.entries(c).filter(([key])=>
          !['id','type','label','region','visible','properties'].includes(key)));
        const props:Array<{path:string;kind:string;text:string|null}>=[];
        encodePageValue(c.properties??{},'/props',props);
        encodePageValue(extra,'/extra',props);
        for(const item of props){
          if(item.path.length>1024)throw new Error('Invalid Page property path');
          await client.query(`INSERT INTO md_lightning_page_node_properties
            (tenant_id,page_id,component_key,property_path,value_kind,value_text)
            VALUES($1,$2,$3,$4,$5,$6)`,[tenantId,pageId,c.id,item.path,item.kind,item.text]);
        }
      }
      for(const [index,a] of assignments.entries())await client.query(`INSERT INTO md_lightning_page_activation
        (tenant_id,page_id,assignment_id,scope,app_api,profile_id,record_type_id,desktop,phone,tablet,custom,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId,pageId,a.id,a.scope,a.appId??null,a.profileId??null,a.recordTypeId??null,
          (a.formFactors as string[]).includes('Desktop'),(a.formFactors as string[]).includes('Phone'),
          (a.formFactors as string[]).includes('Tablet'),(a.formFactors as string[]).includes('Custom'),index]);
    });
    this.invalidatePublishedCache(tenantId,previousApiName);
    if(p.apiName!==previousApiName)this.invalidatePublishedCache(tenantId,String(p.apiName));
    return this.metadata(tenantId,p.apiName);
  }

  /** Specific assignments take precedence over the org default; Draft pages cannot render. */
  async resolveRecordPage(tenantId:string,objectApi:string,appId:string,profileId:string,
    recordTypeId:string,device:string,mode:'View'|'Edit'='View',viewportWidth?:number,strictCustom=false):Promise<Awaited<ReturnType<PageRuntime['metadata']>>|null>{
    if(device!=='Custom'&&Number.isInteger(viewportWidth)&&viewportWidth!>=320&&viewportWidth!<=10000){
      const preferred=await this.resolveRecordPage(tenantId,objectApi,appId,profileId,
        recordTypeId,'Custom',mode,undefined,true);
      if(preferred?.customTargetEnabled===true
        &&viewportWidth!>=(preferred.customTargetMinWidth??320)
        &&viewportWidth!<=(preferred.customTargetMaxWidth??10000))
        return preferred;
    }
    if(!['Desktop','Phone','Mobile','Tablet','Custom'].includes(device))throw new Error('Invalid form factor');
    const dbDevice=device==='Mobile'?'Phone':device;
    const {rows}=await this.db.query<{api_name:string}>(`SELECT p.api_name FROM md_page_definitions p
      JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
      JOIN md_lightning_page_activation a ON a.tenant_id=p.tenant_id AND a.page_id=p.id
      WHERE p.tenant_id=$1 AND p.enabled=true AND d.status='Active'
        AND d.page_type='Record Page' AND d.target_object=$2 AND d.record_mode=$7
        AND $6=ANY(d.devices)
        AND (NOT $8::boolean OR a.custom)
        AND (($6='Desktop' AND a.desktop) OR ($6='Phone' AND a.phone)
          OR ($6='Tablet' AND (a.tablet OR a.desktop))
          OR ($6='Custom' AND (a.custom OR a.desktop)))
        AND (a.scope='Org Default'
          OR (a.scope='App Default' AND a.app_api=$3)
          OR (a.scope='App and Profile' AND a.app_api=$3 AND a.profile_id=$4)
          OR (a.scope='App, Record Type, and Profile' AND a.app_api=$3
              AND a.profile_id=$4 AND a.record_type_id=$5))
      ORDER BY CASE WHEN ($6='Tablet' AND a.tablet)
                        OR ($6='Custom' AND a.custom) THEN 1 ELSE 0 END DESC,
        CASE a.scope WHEN 'App, Record Type, and Profile' THEN 4
        WHEN 'App and Profile' THEN 3 WHEN 'App Default' THEN 2 ELSE 1 END DESC,
        d.updated_at DESC,p.api_name ASC LIMIT 1`,
      [tenantId,objectApi,appId,profileId,recordTypeId,dbDevice,mode,strictCustom]);
    return rows[0]?this.metadata(tenantId,rows[0].api_name,runtimeLayoutVariant(device)):null;
  }
  /** Published in-screen surfaces never enter normal application navigation. */
  async resolveInScreenPage(tenantId:string,appId:string,pageApi:string,device:string,pageType:'In-Screen Page'|'Print Template'='In-Screen Page'):
    Promise<Awaited<ReturnType<PageRuntime['load']>>|null>{
    if(!['Desktop','Phone','Mobile','Tablet','Custom'].includes(device))
      throw new Error('Invalid in-screen page device');
    const factor=device==='Mobile'?'Phone':device;
    const {rows}=await this.db.query<{api_name:string}>(`
      SELECT p.api_name FROM md_page_definitions p
      JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
      JOIN md_app_installations i ON i.tenant_id=p.tenant_id
      JOIN md_apps a ON a.id=i.app_id AND a.enabled=true
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=p.tenant_id)
      LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=i.tenant_id AND m.app_id=i.app_id
      JOIN md_app_entitlements e ON e.tenant_id=i.tenant_id AND e.app_id=i.app_id AND e.active=true
      WHERE p.tenant_id=$1 AND p.api_name=$3 AND p.enabled=true
        AND d.page_type=$5 AND d.status='Active'
        AND $4=ANY(d.devices)
        AND COALESCE(m.api_name,a.api_name)=$2
        AND (e.expires_at IS NULL OR e.expires_at>now())
        AND (EXISTS(
          SELECT 1 FROM md_lightning_page_activation x
          WHERE x.tenant_id=p.tenant_id AND x.page_id=p.id AND x.app_api=$2
            AND (($4='Desktop' AND x.desktop) OR ($4='Phone' AND x.phone)
              OR ($4='Tablet' AND (x.tablet OR x.desktop))
              OR ($4='Custom' AND (x.custom OR x.desktop)))
        ) OR NOT EXISTS(
          SELECT 1 FROM md_lightning_page_activation x
          WHERE x.tenant_id=p.tenant_id AND x.page_id=p.id AND x.app_api IS NOT NULL
        ))
      LIMIT 1`,[tenantId,appId,pageApi,factor,pageType]);
    return rows[0]?this.load(tenantId,rows[0].api_name,runtimeLayoutVariant(device)):null;
  }

  async resolveAppPage(tenantId:string,appId:string,pageApi:string,device:string,viewportWidth?:number,strictCustom=false):Promise<Awaited<ReturnType<PageRuntime['load']>>|null>{
    if(device!=='Custom'&&Number.isInteger(viewportWidth)&&viewportWidth!>=320&&viewportWidth!<=10000){
      const preferred=await this.resolveAppPage(tenantId,appId,pageApi,'Custom',undefined,true);
      if(preferred?.page?.customTargetEnabled===true
        &&viewportWidth!>=(preferred.page.customTargetMinWidth??320)
        &&viewportWidth!<=(preferred.page.customTargetMaxWidth??10000))
        return preferred;
    }
    if(!['Desktop','Phone','Mobile','Tablet','Custom'].includes(device))throw new Error('Invalid form factor');
    const {rows}=await this.db.query<{api_name:string}>(`SELECT p.api_name FROM md_page_definitions p
      JOIN md_app_installations i ON i.tenant_id=p.tenant_id
      JOIN md_apps a ON a.id=i.app_id AND a.enabled=true
        AND (a.tenant_owner_id IS NULL OR a.tenant_owner_id=p.tenant_id)
      LEFT JOIN md_tenant_app_metadata m ON m.tenant_id=i.tenant_id AND m.app_id=i.app_id
      JOIN md_app_entitlements e ON e.tenant_id=i.tenant_id AND e.app_id=i.app_id AND e.active=true
      WHERE p.tenant_id=$1 AND p.api_name=$3 AND p.enabled=true
        AND COALESCE(m.api_name,a.api_name)=$2
        AND (e.expires_at IS NULL OR e.expires_at>now())
        AND (
          EXISTS(SELECT 1 FROM md_lightning_page_details d
            JOIN md_lightning_page_activation x ON x.tenant_id=d.tenant_id AND x.page_id=d.page_id
            WHERE d.tenant_id=p.tenant_id AND d.page_id=p.id
              AND d.status='Active' AND d.page_type='App Page' AND x.app_api=$2
              AND $4=ANY(d.devices)
              AND (NOT $5::boolean OR x.custom)
              AND (($4='Desktop' AND x.desktop) OR ($4='Phone' AND x.phone)
                OR ($4='Tablet' AND (x.tablet OR x.desktop))
                OR ($4='Custom' AND (x.custom OR x.desktop))))
          OR (
            NOT $5::boolean AND NOT EXISTS(SELECT 1 FROM md_lightning_page_details d
              WHERE d.tenant_id=p.tenant_id AND d.page_id=p.id)
            AND EXISTS(SELECT 1 FROM md_tenant_app_navigation n
              WHERE n.tenant_id=i.tenant_id AND n.app_id=i.app_id
                AND n.entry_type='App Page' AND n.api_name=p.api_name)
          )
        )`,
      [tenantId,appId,pageApi,device==='Mobile'?'Phone':device,strictCustom]);
    return rows[0]?this.load(tenantId,rows[0].api_name,runtimeLayoutVariant(device)):null;
  }
}

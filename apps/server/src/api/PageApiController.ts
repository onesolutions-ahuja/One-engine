import type {Express} from 'express';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import type {FlowRuntime} from '../system-files/flow-runtime.js';
import {authenticated,wrap,api} from './ApiAuthenticationGuard.js';
import {PageRuntime} from '../system-files/page-runtime.js';
import {pageLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import {assertMetadataPackageEditable} from '../system-support/metadata-package-service.js';
import {registerPageDetailsController} from './PageDetailsController.js';
import {applyInventoryCsv,exportInventoryCsv,inventoryDefinitions,inventoryRequestedTypes,inventoryCsvPageGroups,originalInventoryIssue,type InventoryPage,type InventoryCsvPageGroup,type InventoryIssue} from '../system-support/page-inventory-csv.js';
import {validateExplicitComponentNames} from '../system-support/page-component-names.js';
import {requirePagePropertyContract} from '../system-support/page-property-contract.js';
import {validatePageComponentContracts} from '../system-support/component-contract-store.js';
import {loadPageLayoutSummaries} from '../system-support/page-layout-summary.js';
export function registerPageApiController(app:Express,db:SqlPersistence,rbac:RbacEngine){
  const pages=new PageRuntime(db);
  const preflightInventory=async(tenant:string,variant:ReturnType<typeof pageLayoutVariant>,
    result:ReturnType<typeof applyInventoryCsv>)=>{
    if(!result.valid||!result.changes)return result;
    try{validateExplicitComponentNames(result.page.components);}
    catch(error){result.issues.push({row:1,component_name:'',component_property:'component_name',remark:error instanceof Error?error.message:'Duplicate component name'});result.valid=false;return result;}
    for(const block of result.page.components){
      try{requirePagePropertyContract(block.type,block.properties);}
      catch(error){
        result.issues.push({row:1,component_name:block.id,component_property:'pagePropertyContract',
          remark:error instanceof Error?error.message:'Invalid Page property contract'});
      }
    }
    if(result.issues.length){result.valid=false;return result;}
    try{await validatePageComponentContracts(db,tenant,result.page.components,variant);}
    catch(error){
      result.issues.push({row:1,component_name:'',component_property:'',
        remark:error instanceof Error?error.message:'Invalid component metadata'});
      result.valid=false;
    }
    return result;
  };
  app.get('/api/metadata/pages/:apiName/layouts/:variant/versions/:version',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const version=Number(req.params.version);
    if(!Number.isSafeInteger(version)||version<1)throw new Error('Invalid page revision');
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.version(actor.tenant_id,name,pageLayoutVariant(req.params.variant),version)});
  }));
  app.post('/api/metadata/pages/:apiName/layouts/:variant/versions/:version/copy',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',name);
    const version=Number(req.params.version);
    if(!Number.isSafeInteger(version)||version<1)throw new Error('Invalid page revision');
    res.setHeader('Cache-Control','private, no-store');
    res.json({page:await pages.copyLayoutVersion(actor.tenant_id,name,
      pageLayoutVariant(req.params.variant),version,actor.user_id)});
  }));
  app.patch('/api/metadata/pages/:apiName/layouts/:variant/versions/:version/archive',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',name);
    const version=Number(req.params.version),archived=req.body?.archived;
    if(!Number.isSafeInteger(version)||version<1||typeof archived!=='boolean')
      throw new Error('Invalid Page version archive request');
    const versions=await pages.archiveLayout(actor.tenant_id,name,pageLayoutVariant(req.params.variant),
      version,archived,actor.user_id);
    res.setHeader('Cache-Control','private, no-store');
    res.json({versions});
  }));
  app.get('/api/metadata/pages/:apiName/component-name-history',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const stem=String(req.query.stem??'');
    if(!/^[a-z][a-z0-9]{0,63}$/.test(stem))throw Error('Invalid component name prefix');
    const result=await db.query<{last:string}>(`
      SELECT COALESCE(MAX(SUBSTRING(LOWER(v.value_text) FROM LENGTH($3::text)+1)::bigint),0)::text AS last
      FROM md_page_layout_version_properties v
      JOIN md_page_definitions p ON p.tenant_id=v.tenant_id AND p.id=v.page_id
      WHERE p.tenant_id=$1 AND p.api_name=$2 AND p.enabled=true
        AND v.property_path='/props/navigatorName'
        AND LOWER(v.value_text) ~ ('^'||$3||'[0-9]{1,9}$')`,
      [actor.tenant_id,name,stem]);
    res.setHeader('Cache-Control','private, no-store');
    res.json({last:Number(result.rows[0]?.last??0)});
  }));
  /** Which device layouts each page has designed, and the one it opens in.
   * Read-only, tenant-scoped; pages the tenant does not have are omitted. */
  app.get('/api/metadata/page-layout-summaries',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const names=String(req.query.pages??'').split(',').map(name=>name.trim()).filter(Boolean);
    if(names.length>500)throw Error('Request at most 500 pages');
    if(names.some(name=>!api.test(name)))throw Error('Invalid Page API name');
    res.setHeader('Cache-Control','private, no-store');
    res.json({pages:await loadPageLayoutSummaries(db,actor.tenant_id,names)});
  }));
  // Read saved draft component metadata, never a browser-local or published runtime approximation.
  app.get('/api/metadata/pages/:apiName/inventory',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','read');
    const variant=pageLayoutVariant(req.query.variant??'Desktop');
    const page=await pages.editor(actor.tenant_id,name,variant) as unknown as InventoryPage;
    const definitions=await inventoryDefinitions(db,actor.tenant_id,page.components,variant);
    res.setHeader('Cache-Control','private, no-store');
    res.json({csv:exportInventoryCsv(page,definitions,variant),variant,draftRevision:page.draftRevision??0});
  }));
  /**
   * Multi-page CSV upsert: pageapi is the sole page locator. Existing page drafts
   * only; no page creation, hidden page fallback or cross-tenant lookup.
   * All groups are preflighted before an outer transaction writes any page.
   */
  const prepareInventoryBatch=async(tenant:string,csv:string,
    defaultVariant:ReturnType<typeof pageLayoutVariant>='Desktop')=>{
    // The CSV Layout column selects each page's layout draft; blank cells use the default.
    const {groups,issues}=inventoryCsvPageGroups(csv,defaultVariant);
    const draftRevisions:Record<string,number>={};
    const prepared:Array<{group:InventoryCsvPageGroup;page:InventoryPage;
      result:ReturnType<typeof applyInventoryCsv>}>=[];
    let changes=0,skipped=0;
    if(!groups.length&&!issues.length)issues.push({
      row:1,component_name:'',component_property:'pageapi',remark:'CSV has no page rows'});
    if(issues.length)return {groups,prepared,issues,changes,skipped,draftRevisions};
    const existing=await db.query<{api_name:string}>(`
      SELECT p.api_name FROM md_page_definitions p
      JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
      WHERE p.tenant_id=$1 AND p.enabled=true AND p.api_name=ANY($2::text[])`,
      [tenant,groups.map(group=>group.pageapi)]);
    const found=new Set(existing.rows.map(row=>row.api_name));
    for(const group of groups){
      if(!found.has(group.pageapi)){
        issues.push({row:group.firstRow,pageapi:group.pageapi,component_name:'',
          component_property:'pageapi',remark:'Page API not found: '+group.pageapi});
        continue;
      }
      try{
        await assertMetadataPackageEditable(db,tenant,'page',group.pageapi);
        const page=await pages.editor(tenant,group.pageapi,group.variant) as unknown as InventoryPage;
        const definitions=await inventoryDefinitions(db,tenant,page.components,group.variant,
          inventoryRequestedTypes(group.csv));
        const result=await preflightInventory(tenant,group.variant,
          applyInventoryCsv(page,group.csv,definitions,group.variant));
        draftRevisions[group.key]=page.draftRevision??0;
        changes+=result.changes;skipped+=result.skipped;
        for(const issue of result.issues)issues.push(originalInventoryIssue(group,issue));
        if(result.valid)prepared.push({group,page,result});
      }catch(error){
        issues.push({row:group.firstRow,pageapi:group.pageapi,component_name:'',
          component_property:'pageapi',
          remark:error instanceof Error?error.message:'Page could not be validated'});
      }
    }
    return {groups,prepared,issues,changes,skipped,draftRevisions};
  };
  app.post('/api/metadata/pages/inventory/batch/validate',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    const variant=pageLayoutVariant(req.body?.variant??'Desktop');
    const csv=typeof req.body?.csv==='string'?req.body.csv:'';
    const batch=await prepareInventoryBatch(actor.tenant_id,csv,variant);
    res.setHeader('Cache-Control','private, no-store');
    res.json({valid:batch.issues.length===0,issues:batch.issues,changes:batch.changes,
      skipped:batch.skipped,draftRevisions:batch.draftRevisions,
      pageCount:batch.groups.length});
  }));
  app.post('/api/metadata/pages/inventory/batch/apply',wrap(async(req,res)=>{
    const actor=authenticated(req);
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    const variant=pageLayoutVariant(req.body?.variant??'Desktop');
    const csv=typeof req.body?.csv==='string'?req.body.csv:'';
    const batch=await prepareInventoryBatch(actor.tenant_id,csv,variant);
    res.setHeader('Cache-Control','private, no-store');
    if(batch.issues.length){
      res.json({valid:false,issues:batch.issues,changes:0,skipped:batch.skipped,
        draftRevisions:batch.draftRevisions,pageCount:batch.groups.length});
      return;
    }
    const expected=req.body?.expectedDraftRevisions;
    if(!expected||typeof expected!=='object'||Array.isArray(expected))
      throw Error('Validate the CSV before applying changes');
    for(const group of batch.groups){
      const number=(expected as Record<string,unknown>)[group.key];
      if(!Number.isSafeInteger(number)||number!==batch.draftRevisions[group.key])
        throw Error('Page layout '+group.pageapi+' ('+group.variant+') changed since CSV validation. Validate again.');
    }
    const updatedPages:InventoryPage[]=[];
    // SqlPersistence uses one ambient transaction across nested saveLayoutDraft
    // calls. Any failed revision/permission/contract write rolls back ALL pages.
    await db.transaction(async()=>{
      for(const {group,page,result} of batch.prepared){
        const latest=await pages.editor(actor.tenant_id,group.pageapi,group.variant) as unknown as InventoryPage;
        if((latest.draftRevision??0)!==page.draftRevision)
          throw Error('Page layout '+group.pageapi+' changed during import. Validate again.');
        if(!result.changes)continue;
        const saved=await pages.saveLayoutDraft(actor.tenant_id,group.pageapi,group.variant,
          result.page,actor.user_id) as unknown as InventoryPage;
        updatedPages.push(saved);
      }
    });
    res.json({valid:true,issues:[] as InventoryIssue[],changes:batch.changes,
      skipped:batch.skipped,pageCount:batch.groups.length,updatedPages,
      draftRevisions:batch.draftRevisions});
  }));
  // Validate every row before touching SQL. The same checks are repeated on apply.
  app.post('/api/metadata/pages/:apiName/inventory/validate',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',name);
    const variant=pageLayoutVariant(req.body?.variant??'Desktop');
    const csv=typeof req.body?.csv==='string'?req.body.csv:'';
    const page=await pages.editor(actor.tenant_id,name,variant) as unknown as InventoryPage;
    const definitions=await inventoryDefinitions(db,actor.tenant_id,page.components,variant,inventoryRequestedTypes(csv));
    const result=await preflightInventory(actor.tenant_id,variant,
      applyInventoryCsv(page,csv,definitions,variant));
    res.setHeader('Cache-Control','private, no-store');
    res.json({valid:result.valid,issues:result.issues,changes:result.changes,skipped:result.skipped,
      draftRevision:page.draftRevision??0});
  }));
  app.post('/api/metadata/pages/:apiName/inventory/apply',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await assertMetadataPackageEditable(db,actor.tenant_id,'page',name);
    const variant=pageLayoutVariant(req.body?.variant??'Desktop');
    const expected=req.body?.expectedDraftRevision;
    if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Invalid expected draft revision');
    const page=await pages.editor(actor.tenant_id,name,variant) as unknown as InventoryPage;
    if((page.draftRevision??0)!==expected)throw new Error('Page layout changed since CSV validation. Validate the file again.');
    const csv=typeof req.body?.csv==='string'?req.body.csv:'';
    const definitions=await inventoryDefinitions(db,actor.tenant_id,page.components,variant,inventoryRequestedTypes(csv));
    const result=await preflightInventory(actor.tenant_id,variant,
      applyInventoryCsv(page,csv,definitions,variant));
    res.setHeader('Cache-Control','private, no-store');
    if(!result.valid){res.json({valid:false,issues:result.issues,changes:0,skipped:result.skipped});return;}
    if(!result.changes){res.json({valid:true,issues:[],changes:0,skipped:result.skipped,page});return;}
    // saveLayoutDraft is transactional, audits the user and checks draftRevision under a lock.
    // A rejected property or concurrent edit leaves the existing saved page unchanged.
    const saved=await pages.saveLayoutDraft(actor.tenant_id,name,variant,result.page,actor.user_id);
    res.json({valid:true,issues:[],changes:result.changes,skipped:result.skipped,page:saved});
  }));
  registerPageDetailsController(app,db,rbac);

  // Deactivation is not a draft save: it takes a published page out of routing
  // without deleting either its draft or its published per-device snapshots.
  app.post('/api/metadata/pages/:apiName/deactivate',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await db.transaction(async client=>{
      const found=await client.query<{id:string,status:string}>(`
        SELECT p.id,d.status FROM md_page_definitions p
        JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
        WHERE p.tenant_id=$1 AND p.api_name=$2 AND p.enabled=true
        FOR UPDATE OF p,d`,[actor.tenant_id,name]);
      const current=found.rows[0];
      if(!current)throw new Error('Page not found');
      const managed=await client.query('SELECT 1 FROM md_app_seed_pages WHERE tenant_id=$1 AND page_id=$2',
        [actor.tenant_id,current.id]);
      if(managed.rowCount)throw new Error('App-owned Page must be managed through AppExchange');
      const appHome=await client.query('SELECT 1 FROM md_app_home_pages WHERE tenant_id=$1 AND page_id=$2',
        [actor.tenant_id,current.id]);
      if(appHome.rowCount)throw new Error('Reassign the App Home Page before deactivating it');
      const kind=await client.query<{target_object:string;record_mode:string}>(`
        SELECT target_object,record_mode FROM md_lightning_page_details
        WHERE tenant_id=$1 AND page_id=$2 AND page_type='Record Page'`,
        [actor.tenant_id,current.id]);
      if(kind.rows[0]&&current.status==='Active'){
        const replacement=await client.query<{available:boolean}>(`
          SELECT EXISTS(SELECT 1 FROM md_lightning_page_details d
          JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id
          WHERE d.tenant_id=$1 AND d.page_id<>$2 AND d.page_type='Record Page'
            AND d.target_object=$3 AND d.record_mode=$4
            AND d.status='Active' AND p.enabled=true) AS available`,
          [actor.tenant_id,current.id,kind.rows[0].target_object,kind.rows[0].record_mode]);
        if(!replacement.rows[0]?.available)
          throw new Error('Publish a replacement Record '+kind.rows[0].record_mode+' Page before deactivating this one');
      }
      await client.query(`UPDATE md_lightning_page_details
        SET status='Draft',revision=revision+1,updated_at=now()
        WHERE tenant_id=$1 AND page_id=$2`,[actor.tenant_id,current.id]);
      // Preserve md_page_layout_heads and all immutable versions for reactivation.
    });
    res.status(204).end();
  }));
  app.delete('/api/metadata/pages/:apiName',wrap(async(req,res)=>{
    const actor=authenticated(req),name=req.params.apiName;
    if(!api.test(name))throw new Error('Invalid Page API name');
    await rbac.require(actor.tenant_id,actor.user_id,'PageDefinition','manage');
    await db.transaction(async client=>{
      const {rows}=await client.query<{id:string;enabled:boolean}>(`
        SELECT id,enabled FROM md_page_definitions
        WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE`,[actor.tenant_id,name]);
      const page=rows[0];
      if(!page)throw new Error('Page not found');
      const appOwned=await client.query(`
        SELECT 1 FROM md_app_seed_pages WHERE tenant_id=$1 AND page_id=$2 LIMIT 1`,
        [actor.tenant_id,page.id]);
      if(appOwned.rowCount)throw new Error('App-owned Page must be managed through AppExchange');
      const appHome=await client.query(`
        SELECT 1 FROM md_app_home_pages WHERE tenant_id=$1 AND page_id=$2 LIMIT 1`,
        [actor.tenant_id,page.id]);
      if(appHome.rowCount)throw new Error('App Home Page must be reassigned before removal');
      // Every Object retains an editable default View and Edit Page. A replacement
      // of the same mode must be published before the last page can be archived.
      const activeRecord=await client.query<{target_object:string;record_mode:string}>(`
        SELECT target_object,record_mode FROM md_lightning_page_details
        WHERE tenant_id=$1 AND page_id=$2 AND page_type='Record Page'`,
        [actor.tenant_id,page.id]);
      if(activeRecord.rows[0]){
        const {rows:replacement}=await client.query<{available:boolean}>(`
          SELECT EXISTS(SELECT 1 FROM md_lightning_page_details d
          JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id
          WHERE d.tenant_id=$1 AND d.page_id<>$2 AND d.page_type='Record Page'
            AND d.target_object=$3 AND d.record_mode=$4
            AND d.status='Active' AND p.enabled=true) AS available`,
          [actor.tenant_id,page.id,activeRecord.rows[0].target_object,
            activeRecord.rows[0].record_mode]);
        if(!replacement[0]?.available)throw new Error(
          'Publish a replacement Record '+activeRecord.rows[0].record_mode+' Page before archiving this one');
      }
      // Soft-deactivate only; preserve layouts, history, component properties and business records.
      await client.query(`
        UPDATE md_page_definitions SET enabled=false WHERE tenant_id=$1 AND id=$2`,
        [actor.tenant_id,page.id]);
      await client.query(`
        UPDATE md_lightning_page_details SET status='Draft' WHERE tenant_id=$1 AND page_id=$2`,
        [actor.tenant_id,page.id]);
    });
    res.status(204).end();
  }));

}

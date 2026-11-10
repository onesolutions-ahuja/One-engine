import {readBaselineMigration} from './baseline-sql-section.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations},{RbacEngine},{SystemDefinitionService}]=await Promise.all([
 'sql-persistence.js','system-migrations.js','rbac-engine.js','system-definition-service.js'
].map(file=>import(new URL(file,file==='system-migrations.js'?support:built).href)));

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url)throw new Error('METADRIVE_SQL_TEST_DATABASE_URL is required');
const db=new SqlPersistence(url);
try{
 const core=readFileSync(fileURLToPath(new URL('../src/system-files/schema.sql',import.meta.url)),'utf8');
 await db.query(core);
 await applySystemMigrations(db);
 await applySystemMigrations(db);
 await db.verifySchema();
 // Real SQL fuzzy matching and migration replay checks.
 const fuzzy=await db.query(`SELECT
  md_fuzzy_ascii_match('Acme Laboratories','Acme Laboratoris',1) AS near,
  md_fuzzy_ascii_match('Acme Labs','Acme Lods',2) AS two_edits,
  md_fuzzy_ascii_match('Acme Labs','Zcme Labs',2) AS different_first,
  md_fuzzy_ascii_match('Ab','Ac',1) AS too_short,
  md_fuzzy_ascii_match('Acme','Acme Labs',2) AS too_distant`);
 assert.deepEqual(fuzzy.rows[0],{
  near:true,two_edits:true,different_first:false,too_short:false,too_distant:false
 });
 const international=await db.query(`SELECT
  md_fuzzy_unicode_match('Михаил','Михайл',1) AS cyrillic_near,
  md_fuzzy_unicode_match('Bonjour','BonJour',1) AS casefold,
  md_fuzzy_unicode_match('Μιχάλης','Μιχάλη',1) AS greek_near,
  md_fuzzy_unicode_match('日本語','日本文',1) AS too_short,
  md_fuzzy_unicode_match('Михаил','Нихаил',1) AS distinct_first,
  md_fuzzy_unicode_match('東京大学','東京工学',1) AS bounded_difference,
  regexp_replace(lower(normalize('  АЛЕКСЕЙ — Иванов  ', NFC)), '[^[:alnum:]]', '', 'g') AS normalized`);
 assert.deepEqual(international.rows[0],{
  cyrillic_near:true,casefold:true,greek_near:true,too_short:false,
  distinct_first:false,bounded_difference:true,normalized:'алексейиванов'
 });
 const tenant=await db.query('INSERT INTO md_tenants(slug,name) VALUES ($1,$2) RETURNING id',['ci-isolated-tenant','CI tenant']);
 const tenantId=tenant.rows[0].id;
 // Review-bundle drift regression: stale SQL registrations from older releases
 // must be disabled, while current reviewed and tenant-owned definitions survive.
 const {deactivateUnavailableBundledComponents}=await import(new URL(
  '../dist-system/app-seeders/bundled-components.js',import.meta.url).href);
 await db.query(`INSERT INTO md_component_definitions
  (tenant_id,api_name,renderer_key,enabled) VALUES
  ($1,'smart_retired_panel','smart-bundled:smart_retired_panel',true),
  ($1,'smart_retired_label','smart-bundled:smart_retired_label',true),
  ($1,'TenantAccordion','tenant-library',true)`,[tenantId]);
 await db.transaction(client=>deactivateUnavailableBundledComponents(client,tenantId));
 await db.transaction(client=>deactivateUnavailableBundledComponents(client,tenantId));
 const componentStatus=await db.query(`
  SELECT api_name,enabled FROM md_component_definitions
  WHERE tenant_id=$1 AND api_name IN ('smart_retired_panel','smart_retired_label','TenantAccordion')
  ORDER BY api_name`,[tenantId]);
 assert.deepEqual(componentStatus.rows,[
  {api_name:'smart_retired_panel',enabled:false},
  {api_name:'smart_retired_label',enabled:false},
  {api_name:'TenantAccordion',enabled:true}
 ]);
 console.info('Stale bundled SQL component reconciliation: passed');
 const user=await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',
  [tenantId,'ci-user@example.invalid','ci-placeholder-hash']);
 const userId=user.rows[0].id;
 const set=await db.query('INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,$2) RETURNING id',[tenantId,'CI']);
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',
  [tenantId,userId,set.rows[0].id]);
 await db.query('INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,$4,$5)',
  [tenantId,set.rows[0].id,'SystemDefinition:reports','manage','allow']);
 const {componentContractSqlSmoke}=await import('./component-contract-sql-smoke.mjs');
 await componentContractSqlSmoke(db,tenantId,userId,set.rows[0].id);
 const svc=new SystemDefinitionService(db,new RbacEngine(db));
 const saved=await svc.save(tenantId,userId,'reports',{apiName:'DailySales',label:'Daily Sales'});
 assert.equal(saved.revision,1);
 const updated=await svc.save(tenantId,userId,'reports',{apiName:'DailySales',label:'Daily Sales Updated',revision:1});
 assert.equal(updated.revision,2);
 await assert.rejects(()=>svc.save(tenantId,userId,'reports',{apiName:'DailySales',label:'Stale Update',revision:1}),/revision conflict/);
 await assert.rejects(()=>svc.list(tenantId,userId,'reports'),/Permission denied/);
 await db.query('INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,$4,$5)',
  [tenantId,set.rows[0].id,'SystemDefinition:reports','read','allow']);
 assert.equal((await svc.list(tenantId,userId,'reports')).length,1);

 const [{ObjectDefinitionService},{PageRuntime}]=await Promise.all([
   import(new URL('object-definition.js',built).href),
   import(new URL('page-runtime.js',built).href)
 ]);
 const objects=new ObjectDefinitionService(db);
 const object=await objects.create(tenantId,'AuditItem__c','Audit Item',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true}
 ]);
 assert.equal(object.pageLayouts.length,1);
 // Reusable tenant exact-match indexes are opt-in and transactionally rebuilt.
 // They must never change the underlying md_record_values or business records.
 const baseRecord=await db.query(`INSERT INTO md_records(tenant_id,object_api)
  VALUES($1,'AuditItem__c') RETURNING id`,[tenantId]);
 const fieldRecordId=baseRecord.rows[0].id;
 await db.query(`INSERT INTO md_record_values
  (tenant_id,record_id,object_api,field_api,value_text)
  VALUES($1,$2,'AuditItem__c','Name','Original customer')`,[tenantId,fieldRecordId]);
 // PostgreSQL full-text ranking uses internal "char", not SQL character(1).
 // Exercise the same expression used by RecordEngine.list against a populated
 // tenant-scoped search index, not just source-string assertions.
 const fullTextRank=await db.query(`SELECT max(ts_rank_cd(
    setweight(qv.search_vector,qv.weight::"char"),
    websearch_to_tsquery('simple',$3))) AS score
   FROM md_record_search_values qv
   WHERE qv.tenant_id=$1 AND qv.object_api=$2
     AND qv.search_vector @@ websearch_to_tsquery('simple',$3)`,
   [tenantId,'AuditItem__c','Original customer']);
 assert.ok(Number(fullTextRank.rows[0]?.score)>0,
   'Weighted SQL search must rank indexed records without a PostgreSQL type error');
 console.info('Weighted SQL record search ranking: passed');
 const inactive=await db.query(`SELECT count(*)::integer AS count FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,[tenantId]);
 assert.equal(inactive.rows[0].count,0,'Unconfigured fields must not create index entries');
 await db.query(`INSERT INTO md_field_exact_indexes
  (tenant_id,object_api,field_api,enabled) VALUES($1,'AuditItem__c','Name',true)`,[tenantId]);
 const existing=await db.query(`SELECT value_hash,folded_hash FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'
   AND record_id=$2`,[tenantId,fieldRecordId]);
 const expected=await db.query(`SELECT md5('Original customer') AS exact,
  md5(lower('Original customer')) AS folded`);
 assert.equal(existing.rows[0]?.value_hash,expected.rows[0].exact);
 assert.equal(existing.rows[0]?.folded_hash,expected.rows[0].folded);
 await db.query(`UPDATE md_record_values SET value_text='Updated customer'
  WHERE tenant_id=$1 AND record_id=$2 AND field_api='Name'`,[tenantId,fieldRecordId]);
 const updatedIndex=await db.query(`SELECT value_hash FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND record_id=$2 AND field_api='Name'`,
  [tenantId,fieldRecordId]);
 assert.notEqual(updatedIndex.rows[0]?.value_hash,expected.rows[0].exact,
  'Index entry was not updated on Record write');
 await db.query(`UPDATE md_field_exact_indexes SET enabled=false,revision=revision+1
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,[tenantId]);
 assert.equal((await db.query(`SELECT count(*)::integer AS count FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,
  [tenantId])).rows[0].count,0,'Disable must discard indexed entries');
 await db.query(`UPDATE md_field_exact_indexes SET enabled=true,revision=revision+1
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,[tenantId]);
 assert.equal((await db.query(`SELECT count(*)::integer AS count FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,
  [tenantId])).rows[0].count,1,'Re-enable must rebuild without record mutation');
 await db.query(`DELETE FROM md_record_values
  WHERE tenant_id=$1 AND record_id=$2 AND field_api='Name'`,[tenantId,fieldRecordId]);
 assert.equal((await db.query(`SELECT count(*)::integer AS count FROM md_field_exact_index_entries
  WHERE tenant_id=$1 AND object_api='AuditItem__c' AND field_api='Name'`,
  [tenantId])).rows[0].count,0,'Deleting a Field value must clear its index');
 await db.query(`DELETE FROM md_records WHERE tenant_id=$1 AND id=$2`,[tenantId,fieldRecordId]);
 console.info('Tenant opt-in equality index: backfill/update/disable/re-enable/delete: passed');
 // Every object obtains real, SQL-owned Record View and Edit pages through one
 // tenant-scoped migration/creation path, with no duplicate page versions.
 const initialRecordPages=await db.query(`SELECT d.record_mode,COUNT(*)::integer AS count
   FROM md_lightning_page_details d JOIN md_page_definitions p
     ON p.tenant_id=d.tenant_id AND p.id=d.page_id
   WHERE d.tenant_id=$1 AND d.target_object='AuditItem__c'
     AND d.page_type='Record Page' AND p.enabled=true
   GROUP BY d.record_mode ORDER BY d.record_mode`,[tenantId]);
 assert.deepEqual(initialRecordPages.rows,[{record_mode:'Edit',count:1},{record_mode:'View',count:1}]);
 await db.query('SELECT md_ensure_object_record_pages($1,$2)',[tenantId,'AuditItem__c']);
 const replayedPages=await db.query(`SELECT COUNT(*)::integer AS count FROM md_lightning_page_details
   WHERE tenant_id=$1 AND target_object='AuditItem__c' AND page_type='Record Page'`,[tenantId]);
 assert.equal(replayedPages.rows[0].count,2,'Idempotent Record Page migration duplicated pages');
 // Existing Object Page Layouts are migrated only into untouched scaffold pages,
 // with four isolated versions; a second execution must not create new versions.
 const migrationSql=readBaselineMigration('20270104-unified-record-page-layouts.sql');
 // Existing customers may have several legacy layouts assigned to different
 // profiles/record types. Do not silently replace those with one default.
 await objects.create(tenantId,'LegacySegment__c','Legacy Segment',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true}
 ]);
 await db.query(`INSERT INTO md_object_page_layouts
   (tenant_id,object_api,layout_id,label,sort_order)
   VALUES($1,'LegacySegment__c','alternate','Alternate presentation',1)`,[tenantId]);
 await db.query(migrationSql);
 const unmigrated=await db.query(`SELECT COUNT(*)::integer AS n
   FROM md_page_layout_versions v JOIN md_lightning_page_details d
     ON d.tenant_id=v.tenant_id AND d.page_id=v.page_id
   WHERE v.tenant_id=$1 AND d.target_object='LegacySegment__c'`,[tenantId]);
 assert.equal(unmigrated.rows[0].n,0,
   'Objects with alternate profile layouts must retain legacy resolution, not receive the default field configuration');
 const migratedVersions=await db.query(`SELECT d.record_mode,h.variant,h.published_version,
   (SELECT COUNT(*)::integer FROM md_page_layout_version_nodes n
     WHERE n.tenant_id=h.tenant_id AND n.page_id=h.page_id AND n.variant=h.variant
       AND n.version=h.published_version AND n.component_type='Field Section') AS sections
   FROM md_page_layout_heads h JOIN md_lightning_page_details d
     ON d.tenant_id=h.tenant_id AND d.page_id=h.page_id
   WHERE h.tenant_id=$1 AND d.target_object='AuditItem__c'
   ORDER BY d.record_mode,h.variant`,[tenantId]);
 assert.equal(migratedVersions.rows.length,8,'Every Record operation requires four SQL device layouts');
 assert.ok(migratedVersions.rows.every(row=>row.sections===1&&row.published_version===1),
   'Default legacy field sections must be published in all device versions');
 await db.query(migrationSql);
 const replayedVersions=await db.query(`SELECT COUNT(*)::integer AS count
   FROM md_page_layout_versions v JOIN md_lightning_page_details d
     ON d.tenant_id=v.tenant_id AND d.page_id=v.page_id
   WHERE v.tenant_id=$1 AND d.target_object='AuditItem__c'`,[tenantId]);
 assert.equal(replayedVersions.rows[0].count,8,'Legacy layout migration must be replay-safe');
 const layout=await objects.replaceLayouts(tenantId,'AuditItem__c',
   {...object,pageLayouts:[{...object.pageLayouts[0],label:'Custom Layout'}]},object.revision);
 assert.equal(layout.pageLayouts[0].label,'Custom Layout');
 await assert.rejects(()=>objects.replaceLayouts(tenantId,'AuditItem__c',object,object.revision),
   /revision conflict/);
 // Historic SQL layout restore is versioned and never rewinds published Pages,
 // fields, Record Types or tenant data.
 const {ObjectMetadataHistory,restorableObjectLayoutSnapshot}=await import(
   new URL('object-metadata-history.js',built).href);
 const secondLayout=await objects.replaceLayouts(tenantId,'AuditItem__c',{
   apiName:'AuditItem__c',pageLayouts:[{...layout.pageLayouts[0],label:'Later revision'}],
   pageLayoutAssignments:layout.pageLayoutAssignments
 },layout.revision);
 const layoutSnapshot=(await new ObjectMetadataHistory(db).revision(tenantId,'AuditItem__c',layout.revision)).after;
 const safeRestore=restorableObjectLayoutSnapshot(layoutSnapshot,'AuditItem__c',secondLayout.label);
 assert.equal('recordTypes' in safeRestore,false);
 const fieldsBefore=(await db.query(`SELECT COUNT(*)::integer AS count FROM md_field_definitions
  WHERE tenant_id=$1 AND object_api='AuditItem__c'`,[tenantId])).rows[0].count;
 const restored=await objects.replaceLayouts(tenantId,'AuditItem__c',safeRestore,secondLayout.revision);
 assert.equal(restored.pageLayouts[0].label,'Custom Layout');
 assert.equal(restored.revision,secondLayout.revision+1);
 assert.equal((await db.query(`SELECT COUNT(*)::integer AS count FROM md_field_definitions
  WHERE tenant_id=$1 AND object_api='AuditItem__c'`,[tenantId])).rows[0].count,fieldsBefore);
 await assert.rejects(()=>objects.replaceLayouts(tenantId,'AuditItem__c',safeRestore,
   secondLayout.revision),/revision conflict/);
 console.info('Object layout history restore, immutable revisions and Field preservation: passed');

 const pageService=new PageRuntime(db);
 // Regression: Page Manager hides archived pages, but their API names remain
 // reserved. Creating with the same label must never update an archived row.
 const pageDraftInput={apiName:'smart_kiosk_customise',label:'SMART KIOSK CUSTOMISE',
   targetObject:'',pageType:'App Page',layoutMode:'free-canvas',
   canvasWidth:1440,canvasHeight:900,status:'Draft',devices:['Desktop'],
   components:[],activationAssignments:[]};
 const createdDraft=await db.transaction(async()=>{
   await pageService.save(tenantId,pageDraftInput.apiName,pageDraftInput,true);
   return pageService.saveLayoutDraft(tenantId,pageDraftInput.apiName,'Desktop',
     {...pageDraftInput,draftRevision:0},userId);
 });
 assert.equal(createdDraft.apiName,pageDraftInput.apiName);
 assert.ok(createdDraft.draftRevision>0,'create-only path saves a new draft');
 await assert.rejects(()=>pageService.save(tenantId,pageDraftInput.apiName,
   pageDraftInput,true),/Page already exists/);
 const archivedId=(await db.query(`SELECT id FROM md_page_definitions
   WHERE tenant_id=$1 AND api_name=$2`,[tenantId,pageDraftInput.apiName])).rows[0].id;
 await db.query(`UPDATE md_page_definitions SET enabled=false
   WHERE tenant_id=$1 AND id=$2`,[tenantId,archivedId]);
 await assert.rejects(()=>pageService.save(tenantId,pageDraftInput.apiName,
   {...pageDraftInput,label:'Should not overwrite an archived page'},true),/Page already exists/);
 await assert.rejects(()=>pageService.save(tenantId,pageDraftInput.apiName,
   {...pageDraftInput,label:'Should not overwrite an archived page'}),/archived/);
 const preserved=(await db.query(`SELECT id,enabled,title FROM md_page_definitions
   WHERE tenant_id=$1 AND api_name=$2`,[tenantId,pageDraftInput.apiName])).rows[0];
 assert.equal(preserved.id,archivedId);
 assert.equal(preserved.enabled,false);
 assert.equal(preserved.title,pageDraftInput.label);
 const replacement={...pageDraftInput,apiName:'smart_kiosk_customise_2'};
 const freshPage=await pageService.save(tenantId,replacement.apiName,replacement,true);
 assert.equal(freshPage.apiName,replacement.apiName);
 assert.notEqual((await db.query(`SELECT id FROM md_page_definitions
   WHERE tenant_id=$1 AND api_name=$2`,[tenantId,replacement.apiName])).rows[0].id,archivedId);
 console.info('Create-only Page drafts, archived API identity and fresh-name retry: passed');
 const defaultEdit=await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Desktop','Edit');
 assert.equal(defaultEdit?.recordMode,'Edit');
 assert.equal(defaultEdit?.pageType,'Record Page');
 const savedPage=await pageService.save(tenantId,'AuditItem_Record_Page',{
   apiName:'AuditItem_Record_Page',label:'Audit Item Record Page',
   targetObject:'AuditItem__c',pageType:'Record Page',layoutMode:'template',
   canvasWidth:1200,canvasHeight:800,template:'main-sidebar',status:'Active',devices:['Desktop'],
   components:[{id:'details',type:'Field Section',label:'Details',region:'main',visible:true,
     properties:{fieldApiNames:['Name'],style:{width:'100%'}}}],
   activationAssignments:[{id:'default',scope:'Org Default',appId:null,
     profileId:null,recordTypeId:null,formFactors:['Desktop']}]
 });
 assert.equal(savedPage.status,'Active');
 assert.deepEqual(savedPage.components[0].properties.style,{width:'100%'});
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Desktop')).apiName,
   savedPage.apiName);
 // All four layouts begin with the existing SQL page; draft changes are invisible
 // to the record runtime until an explicit publish. No tenant data is replaced.
 const mobileDraft=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Mobile',{
   ...savedPage,layoutVariant:'Mobile',draftRevision:0,canvasWidth:390,canvasHeight:844,
   components:[{...savedPage.components[0],label:'Mobile record details',properties:{
     fields:['Name'],pagePropertyContract:{version:1,
       fieldRules:[{fieldApiName:'Name',behavior:'Required',visibilityRules:{
         logic:'Any',expression:'1 OR 2',conditions:[
           {source:'Device',operator:'Equals',value:'Phone'},
           {source:'Record Permission',operator:'Equals',value:'Edit'}
         ]}}],
       actionVisibility:[{actionId:'Edit',unavailable:'Hide',when:{
         logic:'All',conditions:[{source:'Record Permission',operator:'Equals',value:'Edit'}]}}]
     }
   }}]
 });
 assert.equal(mobileDraft.draftRevision,2);
 assert.equal(mobileDraft.publishedRevision,1);
 assert.equal(mobileDraft.components[0].label,'Mobile record details');
 assert.equal(mobileDraft.components[0].properties.pagePropertyContract.fieldRules[0].visibilityRules.logic,'Any');
 assert.equal(mobileDraft.components[0].properties.pagePropertyContract.fieldRules[0].visibilityRules.expression,'1 OR 2');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Details',
  'Saving a draft must never replace the published Mobile layout');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Desktop')).components[0].label,'Details');
 await assert.rejects(()=>pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Mobile',{
   ...mobileDraft,draftRevision:1
 }),/revision conflict/);
 await pageService.publishLayout(tenantId,savedPage.apiName,'Mobile',mobileDraft.draftRevision);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Mobile record details');
 assert.deepEqual((await pageService.metadata(tenantId,savedPage.apiName,'Mobile'))
   .components[0].properties.pagePropertyContract,
   mobileDraft.components[0].properties.pagePropertyContract,
   'Published Dynamic Form and Action conditions must match the saved draft');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Desktop')).components[0].label,'Details',
  'Publishing Mobile must not change Desktop');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Tablet')).canvasWidth,1024);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Custom')).canvasWidth,1200);
 assert.deepEqual((await pageService.layoutHistory(tenantId,savedPage.apiName,'Mobile')).map(item=>item.version),[2,1]);
 await pageService.rollbackLayout(tenantId,savedPage.apiName,'Mobile',1);
 assert.equal((await pageService.editor(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Details');
 assert.equal((await pageService.editor(tenantId,savedPage.apiName,'Mobile'))
   .components[0].properties.pagePropertyContract,undefined,
   'Draft rollback restores the previous version of form/action rules');
 assert.deepEqual((await pageService.metadata(tenantId,savedPage.apiName,'Mobile'))
   .components[0].properties.pagePropertyContract,
   mobileDraft.components[0].properties.pagePropertyContract,
   'Rollback must not mutate still-published rules');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Mobile record details',
  'Restore to draft must not affect the published layout');
 const afterRestore=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Mobile',{
  ...await pageService.editor(tenantId,savedPage.apiName,'Mobile'),draftRevision:1,
  components:[{...savedPage.components[0],label:'Restored and edited mobile details'}]
 });
 assert.equal(afterRestore.draftRevision,3,
  'A restored older draft must never reuse an immutable existing version number');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Mobile record details',
  'Post-restore edits must still be private');
 await pageService.rollbackLayout(tenantId,savedPage.apiName,'Mobile',1);
 await pageService.publishLayout(tenantId,savedPage.apiName,'Mobile',1);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Mobile')).components[0].label,'Details');
 const customDraft=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Custom',{
   ...savedPage,layoutVariant:'Custom',draftRevision:1,canvasWidth:1600,canvasHeight:1000,
   components:[{...savedPage.components[0],label:'Custom information'}]
 });
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Custom')).canvasWidth,1200,
   'Custom draft dimensions must not leak into the published page');
 await pageService.publishLayout(tenantId,savedPage.apiName,'Custom',customDraft.draftRevision);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Custom')).canvasWidth,1600);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Desktop')).canvasWidth,1200,
   'Publishing a custom target must preserve the Desktop layout');
 await assert.rejects(()=>pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Custom',{
   ...savedPage,layoutVariant:'Custom',draftRevision:0
 }),/revision conflict/);

 // Device activation is scoped: changing the Phone assignment must not drop
 // the active Desktop page, even if the two drafts began with identical ids.
 const phoneOnly=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Mobile',{
   ...await pageService.editor(tenantId,savedPage.apiName,'Mobile'),
   activationAssignments:[{id:'default',scope:'App Default',appId:'Records',
     profileId:null,recordTypeId:null,formFactors:['Phone']}]
 });
 await pageService.publishLayout(tenantId,savedPage.apiName,'Mobile',phoneOnly.draftRevision);
 const activeAssignments=await db.query(`SELECT a.scope,a.app_api,a.desktop,a.phone,a.assignment_id
   FROM md_lightning_page_activation a JOIN md_page_definitions p
     ON p.tenant_id=a.tenant_id AND p.id=a.page_id
   WHERE p.tenant_id=$1 AND p.api_name=$2 ORDER BY a.scope`,[tenantId,savedPage.apiName]);
 assert.equal(activeAssignments.rows.length,2,'Device-targeted publication must preserve other assignments');
 assert.deepEqual(activeAssignments.rows.map(a=>[a.scope,a.desktop,a.phone]),[
   ['App Default',false,true],['Org Default',true,false]]);
 assert.equal(new Set(activeAssignments.rows.map(a=>a.assignment_id)).size,2,
   'Reused source assignment ids must not conflict across devices');
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Desktop')).apiName,
   savedPage.apiName,'Desktop remains resolved after Phone activation changes');
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Phone')).apiName,
   savedPage.apiName,'Published Phone activation remains resolvable');

 // Publish the two remaining layout variants independently and ensure
 // Tablet/Desktop never replace the Phone routing or Custom/Mobile content.
 const tabletEdition=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Tablet',{
   ...await pageService.editor(tenantId,savedPage.apiName,'Tablet'),canvasWidth:1100,
   components:[{...savedPage.components[0],label:'Tablet-only details'}],
   activationAssignments:[{id:'tablet-records',scope:'App Default',appId:'Records',
     profileId:null,recordTypeId:null,formFactors:['Tablet']}]
 });
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Tablet')).canvasWidth,1024);
 await pageService.publishLayout(tenantId,savedPage.apiName,'Tablet',tabletEdition.draftRevision);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Tablet')).canvasWidth,1100);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Custom')).canvasWidth,1600);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Desktop')).components[0].label,'Details');
 const customAssignment=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Custom',{
   ...await pageService.editor(tenantId,savedPage.apiName,'Custom'),
   activationAssignments:[{id:'custom-records',scope:'App Default',appId:'Records',
     profileId:null,recordTypeId:null,formFactors:['Custom']}]
 });
 await pageService.publishLayout(tenantId,savedPage.apiName,'Custom',customAssignment.draftRevision);
 const isolatedTargets=await db.query(`SELECT desktop,phone,tablet,custom FROM md_lightning_page_activation a
   JOIN md_page_definitions p ON p.tenant_id=a.tenant_id AND p.id=a.page_id
   WHERE a.tenant_id=$1 AND p.api_name=$2`,[tenantId,savedPage.apiName]);
 assert.equal(isolatedTargets.rows.some(a=>a.desktop),true,'Desktop assignment removed');
 assert.equal(isolatedTargets.rows.some(a=>a.phone),true,'Mobile assignment removed');
 assert.equal(isolatedTargets.rows.some(a=>a.tablet),true,'Tablet assignment removed');
 assert.equal(isolatedTargets.rows.some(a=>a.custom),true,'Custom assignment removed');
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Custom')).layoutVariant,
   'Custom','Custom activation must resolve its explicitly published layout');

 const desktopEdition=await pageService.saveLayoutDraft(tenantId,savedPage.apiName,'Desktop',{
   ...await pageService.editor(tenantId,savedPage.apiName,'Desktop'),
   components:[{...savedPage.components[0],label:'Desktop-only details'}]
 });
 await pageService.publishLayout(tenantId,savedPage.apiName,'Desktop',desktopEdition.draftRevision);
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Desktop')).components[0].label,'Desktop-only details');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Tablet')).components[0].label,'Tablet-only details');
 assert.equal((await pageService.metadata(tenantId,savedPage.apiName,'Custom')).components[0].label,'Custom information');
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Phone')).apiName,
   savedPage.apiName,'Publishing Desktop after Mobile must not remove Phone activation');
 assert.equal((await pageService.resolveRecordPage(tenantId,'AuditItem__c','Records','','master','Tablet')).components[0].label,
   'Tablet-only details','Tablet routing must use the published Tablet snapshot');

 // First activation exposes version-one fallbacks while preserving unpublished
 // edits for the other variants. No tablet or custom draft can leak accidentally.
 const initialDraftPage=await pageService.save(tenantId,'Version_Activation_Check',{
  apiName:'Version_Activation_Check',label:'Version Activation Check',targetObject:'',
  pageType:'App Page',layoutMode:'template',template:'one-region',
  canvasWidth:1440,canvasHeight:900,status:'Draft',devices:['Desktop','Phone'],
  components:[{id:'welcome',type:'smart_retired_label',label:'Base layout',region:'main',visible:true,properties:{}}],
  activationAssignments:[]
 });
 const mobileNew=await pageService.saveLayoutDraft(tenantId,initialDraftPage.apiName,'Mobile',{
  ...initialDraftPage,draftRevision:0,canvasWidth:390,canvasHeight:844,
  components:[{...initialDraftPage.components[0],label:'Mobile private draft'}]
 });
 const tabletNew=await pageService.saveLayoutDraft(tenantId,initialDraftPage.apiName,'Tablet',{
  ...initialDraftPage,draftRevision:1,canvasWidth:1024,canvasHeight:768,
  components:[{...initialDraftPage.components[0],label:'Tablet private draft'}]
 });
 assert.equal(tabletNew.publishedRevision,0);
 assert.equal((await pageService.metadata(tenantId,initialDraftPage.apiName,'Mobile')).status,'Draft',
   'Saving the first immutable draft cannot make the page live');
 await pageService.publishLayout(tenantId,initialDraftPage.apiName,'Mobile',mobileNew.draftRevision);
 assert.equal((await pageService.metadata(tenantId,initialDraftPage.apiName,'Mobile')).status,'Active');
 assert.equal((await pageService.metadata(tenantId,initialDraftPage.apiName,'Mobile')).components[0].label,'Mobile private draft');
 assert.equal((await pageService.metadata(tenantId,initialDraftPage.apiName,'Tablet')).components[0].label,'Base layout');
 assert.equal((await pageService.editor(tenantId,initialDraftPage.apiName,'Tablet')).components[0].label,'Tablet private draft');
 assert.equal((await pageService.metadata(tenantId,initialDraftPage.apiName,'Custom')).publishedRevision,1);
 await db.query('INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,$4,$5)',
  [tenantId,set.rows[0].id,'*','*','allow']);
 // Exercise the actual Builder SQL contracts, not only route existence.
 const [{AppRuntime},{FlowRuntime}]=await Promise.all([
  import(new URL('app-runtime.js',built).href),
  import(new URL('flow-runtime.js',built).href)
 ]);
 const apps=new AppRuntime(db);
 const appDefinition={
  apiName:'AuditApp',label:'Audit App',description:'SQL builder smoke',brandColor:'#1d4ed8',
  navigationItems:['AuditItem__c'],navigationPageApiNames:[],
  navigationOrder:[{type:'Object',apiName:'AuditItem__c'}],utilityItems:[]
 };
 const createdApp=await apps.saveMetadata(tenantId,'AuditApp',appDefinition,false);
 assert.equal(createdApp.apiName,'AuditApp');
 assert.deepEqual(createdApp.navigationItems,['AuditItem__c']);
 await assert.rejects(()=>apps.saveMetadata(tenantId,'AuditApp',appDefinition,false),/API Name already exists/);
 const updatedApp=await apps.saveMetadata(tenantId,'AuditApp',
  {...appDefinition,label:'Audit App Updated',revision:createdApp.revision},true);
 assert.equal(updatedApp.revision,createdApp.revision+1);
 assert.equal((await apps.listInstalled(tenantId)).find(item=>item.apiName==='AuditApp')?.label,'Audit App Updated');

 const home=await pageService.save(tenantId,'Audit_App_Home',{
  apiName:'Audit_App_Home',label:'Audit App Home',targetObject:'',pageType:'Home Page',
  layoutMode:'free-canvas',canvasWidth:1200,canvasHeight:800,status:'Active',devices:['Desktop'],
  components:[],activationAssignments:[{id:'appDefault',scope:'App Default',appId:'AuditApp',
   profileId:null,recordTypeId:null,formFactors:['Desktop']}]
 });
 assert.equal((await apps.homePage(tenantId,'AuditApp','desktop'))?.apiName,home.apiName);
 const appPage=await pageService.save(tenantId,'Audit_App_Till',{
  apiName:'Audit_App_Till',label:'Audit Till',targetObject:'AuditItem__c',pageType:'App Page',
  layoutMode:'free-canvas',canvasWidth:1200,canvasHeight:800,status:'Active',devices:['Desktop'],
  components:[],activationAssignments:[{id:'appPage',scope:'App Default',appId:'AuditApp',
   profileId:null,recordTypeId:null,formFactors:['Desktop']}]
 });
 assert.equal((await pageService.resolveAppPage(tenantId,'AuditApp',appPage.apiName,'Desktop'))?.page.apiName,appPage.apiName);
 // Regression: an active App Page that App Manager puts in the navigation
 // must open even when it has no App Default activation row. Explicit rules,
 // device restrictions and unlisted pages still take precedence.
 const navigationOnlyPage=await pageService.save(tenantId,'Audit_Navigation_Only',{
   apiName:'Audit_Navigation_Only',label:'Navigation only page',targetObject:'',
   pageType:'App Page',layoutMode:'template',template:'one-region',
   canvasWidth:1200,canvasHeight:800,status:'Active',devices:['Desktop'],
   components:[],activationAssignments:[]
 });
 assert.equal(await pageService.resolveAppPage(tenantId,'AuditApp',navigationOnlyPage.apiName,'Desktop'),null,
   'An unlisted App Page must not be publicly routable');
 await db.query(`INSERT INTO md_tenant_app_navigation
   (tenant_id,app_id,entry_type,api_name,sort_order)
   SELECT m.tenant_id,m.app_id,'App Page',$3,20
   FROM md_tenant_app_metadata m WHERE m.tenant_id=$1 AND m.api_name=$2`,
   [tenantId,'AuditApp',navigationOnlyPage.apiName]);
 assert.equal((await pageService.resolveAppPage(tenantId,'AuditApp',navigationOnlyPage.apiName,'Desktop'))?.page.apiName,
   navigationOnlyPage.apiName,'Active navigation-only App Pages should open');
 assert.equal(await pageService.resolveAppPage(tenantId,'AuditApp',navigationOnlyPage.apiName,'Phone'),null,
   'Navigation must not bypass page device eligibility');
 await pageService.save(tenantId,navigationOnlyPage.apiName,{
   ...navigationOnlyPage,activationAssignments:[{
     id:'anotherAppOnly',scope:'App Default',appId:'AnotherApp',formFactors:['Desktop']
   }]
 });
 assert.equal(await pageService.resolveAppPage(tenantId,'AuditApp',navigationOnlyPage.apiName,'Desktop'),null,
   'An assignment to another app must not be overridden by navigation');

 const {RecordEngine}=await import(new URL('record-engine.js',built).href);
 const records=new RecordEngine(db,new RbacEngine(db));
 // End-to-end tenant SQL image and document field write/read contract.
 await objects.create(tenantId,'MediaFieldProbe__c','Media Field Probe',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
   {apiName:'Preview',label:'Preview',dataType:'Image'},
   {apiName:'Document',label:'Document',dataType:'File'}
 ]);
 const {TenantMediaService}=await import(new URL('tenant-media-service.js',built).href);
 const media=new TenantMediaService(db,new RbacEngine(db));
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
 const imageAsset=await media.upload(tenantId,userId,{
  name:'pixel.gif',contentType:'image/gif',contentBase64:gif.toString('base64')
 });
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n');
 const pdfAsset=await media.upload(tenantId,userId,{
  name:'invoice.pdf',contentType:'application/pdf',contentBase64:pdf.toString('base64')
 });
 const mediaRecordId=await records.create(tenantId,userId,'MediaFieldProbe__c',{
  Name:'Asset attachments',Preview:imageAsset.assetRef,Document:pdfAsset.assetRef
 });
 const mediaRecord=await records.get(tenantId,userId,'MediaFieldProbe__c',mediaRecordId);
 assert.equal(mediaRecord.Preview,imageAsset.assetRef);
 assert.equal(mediaRecord.Document,pdfAsset.assetRef);
 await assert.rejects(()=>records.create(tenantId,userId,'MediaFieldProbe__c',{
  Name:'Wrong image',Preview:pdfAsset.assetRef
 }),/Media asset is unavailable in this tenant/);
 await assert.rejects(()=>records.create(tenantId,userId,'MediaFieldProbe__c',{
  Name:'External file URL',Document:'https://outside.invalid/file.pdf'
 }),/File field requires a tenant media asset/);
 // Cross-object matching must persist a reference only inside this tenant,
 // with a verified target object and field. The old same-object set is untouched.
 const targetId=await records.create(tenantId,userId,'AuditItem__c',{
  Name:'Cross Object Match',RecordTypeId:'master'
 });
 await db.query(`INSERT INTO md_matching_rules
  (tenant_id,object_api,api_name,label,active,match_mode,action,target_object_api)
  VALUES($1,'MediaFieldProbe__c','CrossName','Cross name match',true,'All','Alert','AuditItem__c')`,[tenantId]);
 await db.query(`INSERT INTO md_matching_rule_fields
  (tenant_id,object_api,rule_api,field_api,target_field_api,case_sensitive,match_type)
  VALUES($1,'MediaFieldProbe__c','CrossName','Name','Name',false,'Exact')`,[tenantId]);
 const sourceId=await records.create(tenantId,userId,'MediaFieldProbe__c',{
  Name:'Cross Object Match'
 });
 const crossLinked=await db.query(`SELECT matched_object_api,matched_record_id FROM md_cross_object_duplicate_sets
  WHERE tenant_id=$1 AND object_api='MediaFieldProbe__c' AND record_id=$2
   AND rule_api='CrossName'`,[tenantId,sourceId]);
 assert.deepEqual(crossLinked.rows,[{matched_object_api:'AuditItem__c',matched_record_id:targetId}]);
 const originalObject=await db.query(`SELECT count(*)::integer AS total FROM md_duplicate_record_sets
  WHERE tenant_id=$1 AND object_api='MediaFieldProbe__c' AND record_id=$2`,
  [tenantId,sourceId]);
 assert.equal(originalObject.rows[0].total,0);
 console.info('Cross-object matching persistence, tenant isolation and SQL FKs: passed');
 console.info('Tenant File/Image SQL-backed Record Engine, upload and read: passed');


 // Validate the real SQL outbox → RecordEngine → Communication persistence.
 const [{seedCommunicationObjects},{createIntegrationCommunicationWriter,
  IntegrationCommunicationOutbox}]=await Promise.all([
   import(new URL('core-communication-objects.js',
    new URL('../dist-system/app-seeders/',import.meta.url)).href),
   import(new URL('integration-api-log.js',support).href)
 ]);
 // Raw CI tenant setup intentionally omits full Core seeding. Communication has
 // reusable Contact/Customer lookup fields, so create referenced Object metadata.
 for(const api of ['Contact','Customer']){
  await db.query('INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',[tenantId,api,api]);
 }
 await db.transaction(client=>seedCommunicationObjects(client,tenantId));
 const communicationWriter=createIntegrationCommunicationWriter(db);
 const communicationOutbox=new IntegrationCommunicationOutbox(db,communicationWriter);
 await communicationOutbox.write({
  tenantId,direction:'Outbound',transport:'HTTP',provider:'onesys_sms_gate',
  endpoint:'https://api.example.invalid/send',
  method:'POST',statusCode:200,outcome:'success',
  communication:{channel:'SMS',recipient:'447700900000',
   body:'SQL real outbox delivery test',externalMessageId:'sql-sms-'+tenantId}
 });
 const delivery=await db.query(
  "SELECT r.id FROM md_records r JOIN md_record_values v ON v.tenant_id=r.tenant_id "+
  "AND v.record_id=r.id AND v.field_api='ExternalMessageId' WHERE r.tenant_id=$1 "+
  "AND r.object_api='Communication' AND r.is_deleted=false AND v.value_text=$2",
  [tenantId,'sql-sms-'+tenantId]);
 assert.equal(delivery.rows.length,1,'Communication must materialize in md_records');
 const sms=await records.get(tenantId,userId,'Communication',delivery.rows[0].id);
 assert.equal(sms.Channel,'SMS');
 assert.equal(sms.Direction,'Outbound');
 assert.equal(sms.Body,'SQL real outbox delivery test');
 // Provider identifiers survive SQL outbox delivery and become actual metadata fields.
 await communicationOutbox.write({
  tenantId,direction:'Inbound',transport:'Webhook',provider:'WhatsApp_Cloud_API',
  endpoint:'/api/inbound-webhooks/ci-provider',method:'POST',statusCode:200,
  outcome:'success',communication:{channel:'WhatsApp',body:'Welcome',
   sender:'447700900111',recipient:'447700900222',
   phoneNumberId:'phone-provider-ci',wabaId:'waba-provider-ci',
   externalMessageId:'wa-ci-inbound-'+tenantId}
 });
 const providerDelivery=await db.query(
  "SELECT r.id FROM md_records r JOIN md_record_values v ON v.tenant_id=r.tenant_id "+
  "AND v.record_id=r.id AND v.field_api='ExternalMessageId' WHERE r.tenant_id=$1 "+
  "AND r.object_api='Communication' AND r.is_deleted=false AND v.value_text=$2",
  [tenantId,'wa-ci-inbound-'+tenantId]);
 assert.equal(providerDelivery.rows.length,1);
 const providerRecord=await records.get(tenantId,userId,'Communication',providerDelivery.rows[0].id);
 assert.equal(providerRecord.Body,'Welcome');
 assert.equal(providerRecord.Recipient,'447700900222');
 assert.equal(providerRecord.PhoneNumberId,'phone-provider-ci');
 assert.equal(providerRecord.WabaId,'waba-provider-ci');
 // Actual PostgreSQL status callbacks: an acknowledged outbound WhatsApp
 // message must accept sent, delivered, read and retries without new rows.
 const {applyWhatsAppDeliveryStatus}=await import(
  new URL('inbound-webhook-service.js',support).href);
 const whatsappId='wamid.ci-outbound-'+tenantId;
 await communicationOutbox.write({
  tenantId,direction:'Outbound',transport:'HTTP',provider:'onesys_whatsapp',
  endpoint:'https://graph.facebook.com/v26.0/123/messages',method:'POST',
  statusCode:200,outcome:'success',communication:{
   channel:'WhatsApp',sender:'WhatsApp Business',recipient:'447700900111',
   body:'CI webhook delivery-status test',externalMessageId:whatsappId
  }
 });
 const statusId=(await db.query(`
  SELECT r.id FROM md_records r
  JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
   AND v.object_api='Communication' AND v.field_api='ExternalMessageId'
  WHERE r.tenant_id=$1 AND r.object_api='Communication' AND v.value_text=$2`,
  [tenantId,whatsappId])).rows[0]?.id;
 assert.ok(statusId,'Outbound WhatsApp Communication must exist');
 await applyWhatsAppDeliveryStatus(db,tenantId,whatsappId,'sent','1792920000');
 await applyWhatsAppDeliveryStatus(db,tenantId,whatsappId,'delivered','1792920001');
 await applyWhatsAppDeliveryStatus(db,tenantId,whatsappId,'delivered','1792920001');
 await applyWhatsAppDeliveryStatus(db,tenantId,whatsappId,'read','1792920002');
 await applyWhatsAppDeliveryStatus(db,tenantId,whatsappId,'sent','1792920000');
 const statusRecord=await records.get(tenantId,userId,'Communication',statusId);
 assert.equal(statusRecord.Status,'Read');
 assert.equal(statusRecord.DeliveredAt,new Date(1792920001*1000).toISOString());
 assert.equal(statusRecord.Body,'CI webhook delivery-status test');
 const receiptCount=(await db.query(`SELECT count(*)::int AS n FROM md_records r
   JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
    AND v.field_api='ExternalMessageId'
   WHERE r.tenant_id=$1 AND r.object_api='Communication'
    AND v.value_text=$2`,[tenantId,whatsappId])).rows[0].n;
 assert.equal(receiptCount,1,'Callbacks must not add Communication messages');
 // A signed provider status can precede the outbound writer's SQL commit.
 // Reconcile it when the message arrives, without creating status messages.
 const earlyId='wamid.ci-early-'+tenantId;
 await applyWhatsAppDeliveryStatus(db,tenantId,earlyId,'delivered','1792921001');
 await communicationOutbox.write({
  tenantId,direction:'Outbound',transport:'HTTP',provider:'onesys_whatsapp',
  endpoint:'https://graph.facebook.com/v26.0/123/messages',method:'POST',
  statusCode:200,outcome:'success',communication:{
   channel:'WhatsApp',sender:'WhatsApp Business',recipient:'447700900123',
   body:'CI early status callback',externalMessageId:earlyId
  }
 });
 const earlyRows=await db.query(`
  SELECT r.id FROM md_records r
  JOIN md_record_values v ON v.tenant_id=r.tenant_id AND v.record_id=r.id
   AND v.field_api='ExternalMessageId'
  WHERE r.tenant_id=$1 AND r.object_api='Communication' AND v.value_text=$2`,
  [tenantId,earlyId]);
 assert.equal(earlyRows.rows.length,1);
 const earlyRecord=await records.get(tenantId,userId,'Communication',earlyRows.rows[0].id);
 assert.equal(earlyRecord.Status,'Delivered');
 assert.equal(earlyRecord.DeliveredAt,new Date(1792921001*1000).toISOString());
 const pendingEarly=await db.query(`SELECT count(*)::int AS n
  FROM md_communication_pending_status
  WHERE tenant_id=$1 AND external_message_id=$2`,[tenantId,earlyId]);
 assert.equal(pendingEarly.rows[0].n,0,'Reconciled status must leave no pending row');
 console.info('Real PostgreSQL WhatsApp delivery receipt status projection: passed');
 const defaultColumns=await db.query(`
  SELECT field_api FROM md_search_layout_columns
  WHERE tenant_id=$1 AND object_api='Communication' AND layout_key='searchResults'
  ORDER BY position`,[tenantId]);
 assert.deepEqual(defaultColumns.rows.slice(0,5).map(row=>row.field_api),
  ['OccurredAt','Direction','Transport','RequestMethod','ResponseStatusCode']);
 assert.equal(defaultColumns.rows.length,28,'Default has 28 fields plus virtual Id');
 const smsList=await records.list(tenantId,userId,'Communication',50,0);
 assert.ok(smsList.records.some(row=>row.Id===delivery.rows[0].id),
  'Communication record must be visible in the shared Records list API');
 const pending=await db.query(
  'SELECT count(*)::int AS n FROM md_communication_delivery_outbox WHERE tenant_id=$1',[tenantId]);
 assert.equal(pending.rows[0].n,0,'Materialized Communication leaves no outbox backlog');
 await assert.rejects(()=>records.create(tenantId,userId,'Communication',{
  Name:'User-created',Channel:'SMS',Direction:'Outbound',Status:'Sent'
 }),/append-only/);
 await assert.rejects(()=>records.update(tenantId,userId,'Communication',
  delivery.rows[0].id,{Body:'Changed'}),/append-only/);
 await assert.rejects(()=>records.remove(tenantId,userId,'Communication',
  delivery.rows[0].id),/append-only/);

 console.info('Real PostgreSQL Communication outbox delivery and record read: passed');
 // Real-SQL path for unattended incoming Email; verifies the same shared
 // Communication writer, not a second mail-specific CRUD persistence engine.
 const {MailInboxCommunicationSync}=await import(new URL(
  'mail-inbox-communication-sync.js',support).href);
 const mailbox='support@ci-inbox.example';
 await db.query(`INSERT INTO md_mail_domains(tenant_id,domain,verified_at)
   VALUES($1,'ci-inbox.example',now())`,[tenantId]);
 await db.query(`INSERT INTO md_mail_accounts
   (tenant_id,email,domain,status) VALUES($1,$2,'ci-inbox.example','active')`,
   [tenantId,mailbox]);
 const received={
  fingerprint:'a'.repeat(64),messageId:'<ci-incoming@sender.example>',
  from:'sender@example.net',to:mailbox,subject:'Inbound CI mail',
  body:'Received by unattended MetaDrive ingestion',
  receivedAt:'2026-10-25T00:00:00Z'
 };
 const scanner=new MailInboxCommunicationSync(db,communicationOutbox.write,
  async(address,offset)=>{
   assert.equal(address,mailbox);assert.equal(offset,0);
   return {messages:[received],nextOffset:0,total:1};
  });
 assert.equal(await scanner.runOnce(),1);
 assert.equal(await scanner.runOnce(),0);
 const emailMatches=await db.query(`SELECT r.id FROM md_records r
  JOIN md_record_values v ON v.tenant_id=r.tenant_id
   AND v.record_id=r.id AND v.field_api='Subject'
   AND v.value_text='Inbound CI mail'
  WHERE r.tenant_id=$1 AND r.object_api='Communication'`,[tenantId]);
 assert.equal(emailMatches.rows.length,1);
 const receivedEmail=await records.get(tenantId,userId,'Communication',emailMatches.rows[0].id);
 assert.equal(receivedEmail.Direction,'Inbound');
 assert.equal(receivedEmail.Channel,'Email');
 assert.equal(receivedEmail.Body,received.body);
 assert.equal(receivedEmail.Sender,received.from);
 const scanOffset=await db.query(
  'SELECT next_offset FROM md_mail_inbox_scan_offsets WHERE tenant_id=$1 AND email=$2',
  [tenantId,mailbox]);
 assert.equal(scanOffset.rows[0].next_offset,0);
 console.info('Automatic inbound Email through shared Communication SQL outbox: passed');

 // One-time owner-requested Communication list reset: archive complete
 // historical rows without deleting them or touching another tenant/future mail.
 const clearMarker='7214c626-0f66-4f40-b815-675f10b901b3';
 const neighbour=await db.query(
  "INSERT INTO md_tenants(slug,name) VALUES('ci-clear-neighbour','Other tenant') RETURNING id");
 const otherTenantId=neighbour.rows[0].id;
 await db.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
  VALUES($1,'Communication','Communication',false)`,[otherTenantId]);
 const otherHistoryId='11111111-1111-4111-8111-111111111118';
 await db.transaction(async client=>{
  await client.query("SELECT set_config('metadrive.communication_writer','on',true)");
  for(const [tenant,record] of [[tenantId,clearMarker],[otherTenantId,otherHistoryId]]){
   await client.query(`INSERT INTO md_records
    (tenant_id,id,object_api,created_at) VALUES($1,$2,'Communication',
     '2026-10-24T00:00:00Z'::timestamptz)`,[tenant,record]);
  }
  await client.query(`INSERT INTO md_record_values
   (tenant_id,record_id,object_api,field_api,value_text)
   VALUES($1,$2,'Communication','Body',$3)`,
   [tenantId,clearMarker,'Retain message body inside recovery archive']);
 });
 const requestedClearSql=readBaselineMigration('20270102-user-requested-communication-history-clear.sql');
 await db.transaction(client=>client.query(requestedClearSql));
 await db.transaction(client=>client.query(requestedClearSql));
 const oldVisible=await db.query(
  "SELECT count(*)::int AS n FROM md_records WHERE tenant_id=$1 AND id=$2 AND is_deleted=false",
  [tenantId,clearMarker]);
 assert.equal(oldVisible.rows[0].n,0,'Archived owner history must be hidden');
 const originalArchive=await db.query(`SELECT field_snapshots FROM md_communication_user_clear_archive
   WHERE tenant_id=$1 AND record_id=$2`,[tenantId,clearMarker]);
 assert.equal(originalArchive.rows.length,1);
 assert.ok(originalArchive.rows[0].field_snapshots.some(entry=>
  entry.field_api==='Body' && entry.value_text==='Retain message body inside recovery archive'));
 const otherVisible=await db.query(
  "SELECT count(*)::int AS n FROM md_records WHERE tenant_id=$1 AND id=$2 AND is_deleted=false",
  [otherTenantId,otherHistoryId]);
 assert.equal(otherVisible.rows[0].n,1,'Another tenant must retain all history');
 const untouchedNew=await db.query(
  "SELECT count(*)::int AS n FROM md_records WHERE tenant_id=$1 AND id=$2 AND is_deleted=false",
  [tenantId,delivery.rows[0].id]);
 assert.equal(untouchedNew.rows[0].n,1,'Newer Communications must remain visible');
 const archiveAudits=await db.query(`SELECT count(*)::int AS n FROM md_security_events
  WHERE tenant_id=$1 AND action='communication.history_cleared_by_owner'`,[tenantId]);
 assert.equal(archiveAudits.rows[0].n,1,'Rerunning cleanup must not duplicate audit history');
 await assert.rejects(()=>records.remove(tenantId,userId,'Communication',
  delivery.rows[0].id),/append-only/);
 console.info('User-scoped Communication archive, live-list clearing and recovery: passed');

 // Replay this versioned cleanup against seeded legacy data to exercise the
 // actual PostgreSQL migration (including the append-only trigger restore).
 // No new Communication fields are created by this migration.
 const originalSubjects=[
  'POST 200 · success · 6ms · req 605B/resp 0B · /api/inbound-webhooks/Credential_WhatsApp_Cloud_API',
  'Invoice delivered · POST 202 · success · 8ms · req 15B/resp 2B · https://example.invalid/send',
  'Your invoice is ready'
 ];
 const historicalIds=[];
 await db.transaction(async client=>{
  await client.query("SELECT set_config('metadrive.communication_writer','on',true)");
  for(const oldSubject of originalSubjects){
   const {rows:[record]}=await client.query(
    "INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Communication') RETURNING id",
    [tenantId]);
   historicalIds.push(record.id);
   for(const [field,value] of [['Subject',oldSubject],
     ['RelatedObject','IntegrationApiCall']]){
    await client.query(`INSERT INTO md_record_values
     (tenant_id,record_id,object_api,field_api,value_text)
     VALUES($1,$2,'Communication',$3,$4)`,
     [tenantId,record.id,field,value]);
   }
  }
 });
 const normalizeSubjects=readBaselineMigration('20261204-communication-subject-normalization.sql');
 await db.transaction(client=>client.query(normalizeSubjects));
 await db.transaction(client=>client.query(normalizeSubjects));
 const historical=await db.query(`SELECT record_id,value_text FROM md_record_values
  WHERE tenant_id=$1 AND object_api='Communication' AND field_api='Subject'
    AND record_id=ANY($2::uuid[])`,[tenantId,historicalIds]);
 const resultingSubjects=new Map(historical.rows.map(row=>[row.record_id,row.value_text]));
 assert.equal(resultingSubjects.get(historicalIds[0]),null);
 assert.equal(resultingSubjects.get(historicalIds[1]),'Invoice delivered');
 assert.equal(resultingSubjects.get(historicalIds[2]),'Your invoice is ready');
 const structured=await db.query(`SELECT field_api,value_text FROM md_record_values
  WHERE tenant_id=$1 AND record_id=$2
   AND field_api IN ('Endpoint','RequestMethod','ResponseStatusCode','Outcome',
    'DurationMs','RequestBytes','ResponseBytes')`,
  [tenantId,historicalIds[0]]);
 const fieldsByName=Object.fromEntries(structured.rows.map(row=>[row.field_api,row.value_text]));
 assert.equal(fieldsByName.Endpoint,
  '/api/inbound-webhooks/Credential_WhatsApp_Cloud_API');
 assert.equal(fieldsByName.RequestMethod,'POST');
 assert.equal(fieldsByName.ResponseStatusCode,'200');
 assert.equal(fieldsByName.Outcome,'success');
 assert.equal(fieldsByName.DurationMs,'6');
 assert.equal(fieldsByName.RequestBytes,'605');
 assert.equal(fieldsByName.ResponseBytes,'0');
 const subjectArchive=await db.query(`SELECT record_id,original_subject,recovered_subject
  FROM md_communication_legacy_api_subject_archive
  WHERE tenant_id=$1`,[tenantId]);
 assert.equal(subjectArchive.rows.length,2);
 assert.ok(subjectArchive.rows.some(row=>row.original_subject===originalSubjects[0]));
 assert.ok(subjectArchive.rows.some(row=>row.recovered_subject==='Invoice delivered'));
 await assert.rejects(()=>records.update(tenantId,userId,'Communication',
  historicalIds[1],{Subject:'Changed'}),/append-only/);
 console.info('Legacy Communication Subject normalization and preservation: passed');


 // Phase 1 actual PostgreSQL lifecycle/relationship contracts.
 // No mocked query engine: exercise SQL constraints, record permissions and restoration.
 const {RecordRetentionService}=await import(new URL('record-retention-service.js',support).href);
 const retention=new RecordRetentionService(db,new RbacEngine(db));
 const lifecycleAccount=await objects.create(tenantId,'LifecycleAccount__c','Lifecycle Account',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true,unique:true}
 ]);
 const lifecycleDetail=await objects.create(tenantId,'LifecycleDetail__c','Lifecycle Detail',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
   {apiName:'AccountId',label:'Account',dataType:'Master-Detail(LifecycleAccount__c)',required:true,
     relationship:{type:'Master-Detail',targetObject:'LifecycleAccount__c',
      relationshipName:'Account',childRelationshipName:'Details'}}
 ]);
 assert.ok(lifecycleAccount&&lifecycleDetail);
 const parent=await records.create(tenantId,userId,'LifecycleAccount__c',{Name:'Reusable unique'});
 const otherParent=await records.create(tenantId,userId,'LifecycleAccount__c',{Name:'Other parent'});
 const dependent=await records.create(tenantId,userId,'LifecycleDetail__c',
   {Name:'Cascaded detail',AccountId:parent});
 await records.create(tenantId,userId,'LifecycleDetail__c',{Name:'Other detail',AccountId:otherParent});
 const lookupObject=await objects.create(tenantId,'LifecycleLookup__c','Lifecycle Lookup',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
   {apiName:'AccountId',label:'Account',dataType:'Lookup(LifecycleAccount__c)',
    relationship:{type:'Lookup',targetObject:'LifecycleAccount__c',
      relationshipName:'Account',childRelationshipName:'Lookups',deleteBehavior:'Clear'}}
 ]);
 assert.ok(lookupObject);
 const lookup=await records.create(tenantId,userId,'LifecycleLookup__c',
   {Name:'Restorable lookup',AccountId:parent});
 const linked=await records.list(tenantId,userId,'LifecycleDetail__c',50,0,
   {relatedField:'AccountId',relatedId:parent});
 assert.equal(linked.total,1,'related list must not include children of another parent');
 assert.equal(linked.records[0].Id,dependent);

 await db.query(`INSERT INTO md_record_activities(tenant_id,object_api,record_id,created_by,kind,subject)
   VALUES($1,$2,$3,$4,'Task','Retained during recycle')`,
   [tenantId,'LifecycleAccount__c',parent,userId]);
 await records.remove(tenantId,userId,'LifecycleAccount__c',parent);
 assert.equal((await records.get(tenantId,userId,'LifecycleLookup__c',lookup)).AccountId,null,
   'deleted lookup target must be cleared on an active source');
 assert.equal((await records.list(tenantId,userId,'LifecycleDetail__c')).total,1,
   'Master-Detail children must be hidden while recycled');
 assert.equal((await records.recycleBin(tenantId,userId,'LifecycleAccount__c')).total,1);
 await assert.rejects(()=>records.get(tenantId,userId,'LifecycleAccount__c',parent),
   /Record not found/);
 const replacement=await records.create(tenantId,userId,'LifecycleAccount__c',{Name:'Reusable unique'});
 await assert.rejects(()=>records.restore(tenantId,userId,'LifecycleAccount__c',parent),
   /duplicate key|unique/i,'restore must reject collisions with replacement records');
 assert.equal((await records.recycleBin(tenantId,userId,'LifecycleAccount__c')).total,1,
   'failed restore must roll back the full deletion group');
 await records.update(tenantId,userId,'LifecycleAccount__c',replacement,{Name:'New unique name'});
 const recovered=await records.restore(tenantId,userId,'LifecycleAccount__c',parent);
 assert.equal(recovered.restored,2,'restore must include dependent Master-Detail records');
 assert.equal((await records.get(tenantId,userId,'LifecycleLookup__c',lookup)).AccountId,parent,
   'restore must recover the original lookup without changing the source record');

 assert.equal((await records.list(tenantId,userId,'LifecycleDetail__c',50,0,
   {relatedField:'AccountId',relatedId:parent})).total,1);
 const retainedActivity=await db.query(
  'SELECT 1 FROM md_record_activities WHERE tenant_id=$1 AND record_id=$2',
  [tenantId,parent]);
 assert.equal(retainedActivity.rowCount,1,'normal delete and restore must retain activities');
 assert.deepEqual(await retention.get(tenantId,userId),
   {retentionDays:15,automaticPurgeEnabled:false});
 await retention.set(tenantId,userId,1,false);
 await records.remove(tenantId,userId,'LifecycleAccount__c',replacement);
 await db.query(`UPDATE md_records SET deleted_at=now()-interval '2 days'
   WHERE tenant_id=$1 AND deletion_root_id=$2`,[tenantId,replacement]);
 assert.deepEqual(await retention.purge(tenantId,userId,'LifecycleAccount__c',replacement),
   {purged:1});
 assert.equal((await db.query('SELECT 1 FROM md_records WHERE tenant_id=$1 AND id=$2',
   [tenantId,replacement])).rowCount,0);
 assert.equal((await retention.purgeExpired()).purged,0,
   'opt-in retention scan must not delete without automatic-purge enablement');

 const flows=new FlowRuntime(db,new RbacEngine(db),records);
 // Phase 2: real SQL Action registry, permission evaluation, CRUD and activity integration.
 const {ObjectQuickActionRuntime}=await import(new URL('object-quick-action-runtime.js',support).href);
 const {RecordCollaborationService}=await import(new URL('record-collaboration-service.js',support).href);
 const quickActions=new ObjectQuickActionRuntime(db,new RbacEngine(db),records,
   new RecordCollaborationService(db,new RbacEngine(db)),flows);
 const actionConfig=[
   ['CallAccount','Call Customer','Log Call',null,'Customer follow-up',null,null,null],
   ['NewDetail','New Detail','Create Related',null,null,'LifecycleDetail__c','AccountId',null]
 ];
 for(const [id,label,behavior,field,value,target,relationship,flow] of actionConfig)
   await db.query(`INSERT INTO md_object_actions
     (tenant_id,object_api,action_id,label,action_type,enabled,behavior,field_api,
      value_text,target_object_api,relationship_field_api,flow_api_name)
     VALUES($1,'LifecycleAccount__c',$2,$3,'Custom',true,$4,$5,$6,$7,$8,$9)`,
     [tenantId,id,label,behavior,field,value,target,relationship,flow]);
 const defaultPlacement=await db.query(`SELECT placement FROM md_object_actions
  WHERE tenant_id=$1 AND object_api='LifecycleAccount__c' AND action_id='NewDetail'`,[tenantId]);
 assert.equal(defaultPlacement.rows[0].placement,'Default','Legacy actions preserve placement');
 await db.query(`UPDATE md_object_actions SET placement='Publisher'
  WHERE tenant_id=$1 AND object_api='LifecycleAccount__c' AND action_id='CallAccount'`,[tenantId]);
 assert.equal((await db.query(`SELECT placement FROM md_object_actions
  WHERE tenant_id=$1 AND object_api='LifecycleAccount__c' AND action_id='CallAccount'`,
  [tenantId])).rows[0].placement,'Publisher');
 await assert.rejects(db.query(`UPDATE md_object_actions SET placement='Unsafe'
  WHERE tenant_id=$1 AND object_api='LifecycleAccount__c' AND action_id='CallAccount'`,
  [tenantId]),/placement/);
 // Placement is presentation-only metadata; it never weakens OneEngine Action permissions.
 const allowed=await quickActions.available({tenant_id:tenantId,user_id:userId},'LifecycleAccount__c',parent);
 assert.ok(allowed.actionIds.includes('CallAccount')&&allowed.actionIds.includes('NewDetail'));
 const quickRelated=await quickActions.execute(
  {tenant_id:tenantId,user_id:userId},'LifecycleAccount__c',parent,'NewDetail',{Name:'Quick child'});
 assert.equal(quickRelated.objectApiName,'LifecycleDetail__c');
 assert.equal((await records.get(tenantId,userId,'LifecycleDetail__c',quickRelated.recordId)).AccountId,parent);
 const call=await quickActions.execute(
  {tenant_id:tenantId,user_id:userId},'LifecycleAccount__c',parent,'CallAccount',{description:'Spoke to client'});
 assert.equal(call.status,'completed');
 assert.equal((await db.query(`SELECT kind FROM md_record_activities
    WHERE tenant_id=$1 AND object_api='LifecycleAccount__c' AND record_id=$2 AND subject='Customer follow-up'`,
    [tenantId,parent])).rows[0]?.kind,'Call');
 // Tenant-global action settings and execution share the same runtime.
 const {GlobalQuickActionMetadataService}=await import(
  new URL('global-quick-action-metadata.js',support).href);
 const globalSettings=new GlobalQuickActionMetadataService(db,new RbacEngine(db));
 await globalSettings.save(tenantId,userId,[{id:'CreateGlobalAccount',label:'Create Global Account',
   behavior:'Create Record',enabled:true,targetObjectApi:'LifecycleAccount__c'}]);
 const globalOptions=await quickActions.globalAvailable({tenant_id:tenantId,user_id:userId});
 assert.ok(globalOptions.actions.some(x=>x.id==='CreateGlobalAccount'),
  'global action must be visible to authorized tenant developer');
 const globalResult=await quickActions.executeGlobal(
   {tenant_id:tenantId,user_id:userId},'CreateGlobalAccount',{Name:'Global action created'});
 assert.equal(globalResult.objectApiName,'LifecycleAccount__c');
 assert.equal((await records.get(tenantId,userId,'LifecycleAccount__c',globalResult.recordId)).Name,
   'Global action created');


 const draft={apiName:'AuditCheckout',label:'Audit Checkout',flowType:'Screen Flow',
  status:'Draft',versionNumber:1,activeVersion:null,
  elements:[{id:1,type:'Start',label:'Start',config:{}},
    {id:2,type:'Screen',label:'Payment',config:{fields:[{name:'Amount',required:true,defaultValue:0}]}}],
  connectors:[{id:'1',from:1,to:2,kind:'normal',label:'default'}],
  resources:[],startConfig:{},tests:[],versions:[]};
 const persisted=await flows.saveEditor(tenantId,userId,'AuditCheckout',draft);
 assert.deepEqual(persisted.elements[1].config,draft.elements[1].config);
 assert.equal((await flows.listPage(tenantId,1,'AuditCheckout')).total,1);
 assert.equal((await flows.loadEditor(tenantId,'AuditCheckout')).status,'Draft');
 await assert.rejects(()=>flows.saveEditor(tenantId,userId,'AuditCheckout',
  {...draft,status:'Active'}),/Flow cannot activate/);
 await flows.deleteEditor(tenantId,userId,'AuditCheckout');
 assert.ok(!(await flows.list(tenantId)).some(item=>item.apiName==='AuditCheckout'));
 const simple={apiName:'SimpleAuditFlow',label:'Simple Audit Flow',
  flowType:'Autolaunched Flow',status:'Active',
  elements:[{id:1,type:'Start',label:'Start',config:{}},
    {id:2,type:'End',label:'End',config:{}}],
  connectors:[{id:'1',from:1,to:2,kind:'normal',label:'default'}],
  resources:[],startConfig:{},tests:[],versions:[]};
 assert.equal((await flows.saveEditor(tenantId,userId,'SimpleAuditFlow',simple)).status,'Active');
 assert.equal((await flows.execute(tenantId,'SimpleAuditFlow',userId)).status,'completed');


 // Durable SQL Screen Flow with two screens, backwards navigation, a real shared
 // Create Records operation, and an injected HTTP transport (no network in CI).
 let calloutCount=0;
 const supportedFlows=new FlowRuntime(db,new RbacEngine(db),records,
  async (_tenant,_user,config,variables)=>{
   calloutCount++;
   assert.equal(config.namedCredentialId,'00000000-0000-4000-8000-000000000001');
   assert.equal(variables.Amount,15);
   return {status:200,body:'approved'};
  });
 const checkout={apiName:'AuditScreenCheckout',label:'Audit Screen Checkout',
  flowType:'Screen Flow',status:'Active',resources:[
   {name:'RecordId',availableForOutput:true},
   {name:'PaymentStatus',availableForOutput:true}
  ],startConfig:{},tests:[],versions:[],
  elements:[
   {id:1,type:'Start',label:'Start',config:{}},
   {id:2,type:'Screen',label:'Amount',config:{
    fields:[{apiName:'Amount',type:'Number',label:'Amount',required:true}]}},
   {id:3,type:'Screen',label:'Confirm',config:{
    fields:[{apiName:'Confirmed',type:'Checkbox',label:'Confirm',required:true}]}},
   {id:4,type:'HTTP Callout',label:'Collect payment',config:{
    namedCredentialId:'00000000-0000-4000-8000-000000000001',method:'POST',path:'pay',statusVariable:'PaymentStatus',
    onError:'FAULT_PATH'}},
   {id:5,type:'Create Records',label:'Create invoice',config:{
    object:'AuditItem__c',fieldValues:[{field:'Name',value:'Screen Sale'}],
    resultVariable:'RecordId'}},
   {id:6,type:'End',label:'End',config:{}},
   {id:7,type:'End',label:'Payment failure',config:{}}
  ],connectors:[
   {id:'1',from:1,to:2,kind:'normal',label:'default'},
   {id:'2',from:2,to:3,kind:'normal',label:'Next'},
   {id:'3',from:3,to:4,kind:'normal',label:'Next'},
   {id:'4',from:4,to:5,kind:'normal',label:'default'},
   {id:'5',from:4,to:7,kind:'fault',label:'Fault'},
   {id:'6',from:5,to:6,kind:'normal',label:'default'}
  ]};
 assert.equal((await supportedFlows.saveEditor(tenantId,userId,checkout.apiName,checkout)).status,'Active');
 const first=await supportedFlows.execute(tenantId,checkout.apiName,userId);
 assert.equal(first.screen.id,2);
 await assert.rejects(
  ()=>supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{values:{Amount:null}}),
  /Required Screen field/);
 const second=await supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{values:{Amount:15}});
 assert.equal(second.screen.id,3);
 assert.equal(second.canGoBack,true);
 const back=await supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{action:'back'});
 assert.equal(back.screen.id,2);
 const confirmation=await supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{values:{Amount:15}});
 assert.equal(confirmation.screen.id,3);
 const complete=await supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{values:{Confirmed:true}});
 assert.equal(complete.completed,true);
 assert.equal(complete.outputs.PaymentStatus,200);
 assert.equal(calloutCount,1);
 assert.equal((await records.get(tenantId,userId,'AuditItem__c',complete.outputs.RecordId)).Name,'Screen Sale');
 await assert.rejects(()=>supportedFlows.advanceInterview(tenantId,userId,first.interviewId,{}),/not found/);
 // A rejected callout follows its metadata fault edge and must not create a sale.
 const rejectedFlows=new FlowRuntime(db,new RbacEngine(db),records,
  async()=>{throw new Error('Payment declined');});
 const originalRecords=await db.query(
  "SELECT count(*)::integer AS total FROM md_records WHERE tenant_id=$1 AND object_api='AuditItem__c'",[tenantId]);
 const declined=await rejectedFlows.execute(tenantId,checkout.apiName,userId);
 const secondDeclined=await rejectedFlows.advanceInterview(tenantId,userId,declined.interviewId,
  {values:{Amount:15}});
 assert.equal(secondDeclined.screen.id,3);
 const declinedEnd=await rejectedFlows.advanceInterview(tenantId,userId,declined.interviewId,
  {values:{Confirmed:true}});
 assert.equal(declinedEnd.completed,true);
 assert.equal(declinedEnd.outputs.RecordId,undefined);
 const afterDecline=await db.query(
  "SELECT count(*)::integer AS total FROM md_records WHERE tenant_id=$1 AND object_api='AuditItem__c'",[tenantId]);
 assert.equal(afterDecline.rows[0].total,originalRecords.rows[0].total,
  'A declined card callout must not persist a record');
 const debug=await supportedFlows.debugGraph(tenantId,userId,checkout.apiName,{});
 assert.equal(debug.status,'waiting');
 assert.equal(calloutCount,1);
 // End-to-end SQL Screen Flow: Get Records -> Data Table -> Selected Rows -> Loop -> Create Records.
 const mealFirst=await records.create(tenantId,userId,'AuditItem__c',{Name:'Meal Source Chicken'});
 const mealSecond=await records.create(tenantId,userId,'AuditItem__c',{Name:'Meal Source Sides'});
 const mealSelectionFlow={apiName:'AuditMealRecordSelection',label:'Meal record selections',
  flowType:'Screen Flow',status:'Active',startConfig:{},tests:[],versions:[],
  resources:[
   {name:'MealOptions',label:'Meal options',type:'Record Collection',
    dataType:'AuditItem__c',isCollection:true,availableForInput:false,availableForOutput:false},
   {name:'SelectedMeals',label:'Selected meals',type:'Record Collection',
    dataType:'AuditItem__c',isCollection:true,availableForInput:false,availableForOutput:false}
  ],
  elements:[
   {id:1,type:'Start',label:'Start',config:{}},
   {id:2,type:'Get Records',label:'Options',config:{object:'AuditItem__c',
     recordLimit:'all',outputVariable:'MealOptions',conditions:[
       {field:'Name',operator:'Starts With',value:'Meal Source '}] }},
   {id:3,type:'Screen',label:'Choose meal',config:{fields:[
     {apiName:'Chosen',label:'Choose',type:'Data Table',collection:'MealOptions',
      columns:['Name'],multiselect:true,selectedRowsResource:'SelectedMeals',
      minimumSelections:1,maximumSelections:2,required:true}]}},
   {id:4,type:'Loop',label:'Selected products',config:{collection:'SelectedMeals',
     loopVariable:'CurrentMeal',direction:'First to last'}},
   {id:5,type:'Create Records',label:'Copy selection',config:{object:'AuditItem__c',
     fieldValues:[{field:'Name',value:'{!CurrentMeal.Name}'}]}},
   {id:6,type:'End',label:'Complete',config:{}}
  ],
  connectors:[
   {id:'1',from:1,to:2,kind:'normal',label:'default'},
   {id:'2',from:2,to:3,kind:'normal',label:'default'},
   {id:'3',from:3,to:4,kind:'normal',label:'Next'},
   {id:'4',from:4,to:5,kind:'normal',label:'For Each'},
   {id:'5',from:5,to:4,kind:'normal',label:'default'},
   {id:'6',from:4,to:6,kind:'normal',label:'After Last'}
  ]};
 assert.equal((await supportedFlows.saveEditor(tenantId,userId,mealSelectionFlow.apiName,
   mealSelectionFlow)).status,'Active');
 const selectionStart=await supportedFlows.execute(tenantId,mealSelectionFlow.apiName,userId);
 assert.equal(selectionStart.screen.id,3);
 assert.deepEqual(selectionStart.screenResources.MealOptions.map(row=>row.Id).sort(),
   [mealFirst,mealSecond].sort());
 const selectionRun=selectionStart.interviewId;
 await assert.rejects(()=>supportedFlows.advanceInterview(tenantId,userId,selectionRun,{
   values:{Chosen:['00000000-0000-4000-8000-000000000099']}}),
   /not in the permitted record collection/);
 await assert.rejects(()=>supportedFlows.advanceInterview(tenantId,userId,selectionRun,{
   values:{Chosen:[]}}),/selection count/);
 const beforeSelected=(await db.query("SELECT count(*)::int AS total FROM md_records WHERE tenant_id=$1 AND object_api='AuditItem__c'",
   [tenantId])).rows[0].total;
 const selectedComplete=await supportedFlows.advanceInterview(tenantId,userId,selectionRun,
   {values:{Chosen:[mealSecond,mealFirst]}});
 assert.equal(selectedComplete.completed,true);
 const afterSelected=(await db.query("SELECT count(*)::int AS total FROM md_records WHERE tenant_id=$1 AND object_api='AuditItem__c'",
   [tenantId])).rows[0].total;
 assert.equal(afterSelected,beforeSelected+2,'Selected Rows Loop must create exactly two records');
 console.info('Screen Data Table typed selections -> Loop -> Create Records SQL smoke passed');

 const recordId=await records.create(tenantId,userId,'AuditItem__c',{Name:'First',RecordTypeId:'master'});
 const initial=await records.get(tenantId,userId,'AuditItem__c',recordId);
 assert.equal(initial.Name,'First');
 assert.equal(initial.RecordTypeId,'master');
 await records.update(tenantId,userId,'AuditItem__c',recordId,{Name:'Edited'},
  new Date(initial.LastModifiedDate).toISOString());
 const changedRecord=await records.get(tenantId,userId,'AuditItem__c',recordId);
 assert.equal(changedRecord.Name,'Edited');
 // Live PostgreSQL acceptance: declarative rule evaluation shares the existing record transaction.
 await objects.addField(tenantId,'AuditItem__c','Code__c','Text(80)',undefined,'Code');
 await db.query(`INSERT INTO md_field_default_formulas
   (tenant_id,object_api,field_api,expression) VALUES($1,$2,$3,$4)`,
   [tenantId,'AuditItem__c','Code__c','LOWER($Record.Name)']);
 await db.query(`INSERT INTO md_validation_rules
   (tenant_id,object_api,api_name,label,expression,error_message,error_field_api,active)
   VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
   [tenantId,'AuditItem__c','NoBadName','Block bad names','BEGINS($Record.Name, "Bad")',
     'Name cannot start with Bad','Name']);
 const beforeInvalid=await db.query(`SELECT count(*)::integer AS total
   FROM md_records WHERE tenant_id=$1 AND object_api=$2`,[tenantId,'AuditItem__c']);
 await assert.rejects(()=>records.create(tenantId,userId,'AuditItem__c',{Name:'Bad record'}),
   /Name cannot start with Bad/);
 const afterInvalid=await db.query(`SELECT count(*)::integer AS total
   FROM md_records WHERE tenant_id=$1 AND object_api=$2`,[tenantId,'AuditItem__c']);
 assert.equal(afterInvalid.rows[0].total,beforeInvalid.rows[0].total,
   'A failed validation rule must roll back the record save');
 const calculatedId=await records.create(tenantId,userId,'AuditItem__c',{Name:'Validated'});
 assert.equal((await records.get(tenantId,userId,'AuditItem__c',calculatedId)).Code__c,'validated');
 await assert.rejects(()=>records.update(tenantId,userId,'AuditItem__c',calculatedId,{Name:'Bad update'}),
   /Name cannot start with Bad/);
 assert.equal((await records.get(tenantId,userId,'AuditItem__c',calculatedId)).Name,'Validated');
 // Order-of-execution contract: before-save changes are validated before insert/after-save.
 const failedPhases=[];
 records.setRecordTriggerHandler(async(_tx,_tenant,_actor,_object,_operation,record,_prior,phase)=>{
   failedPhases.push(phase);
   if(phase==='before-save')return {...record,Name:'Bad from before-save'};
   return record;
 });
 await assert.rejects(()=>records.create(tenantId,userId,'AuditItem__c',{Name:'Originally valid'}),
   /Name cannot start with Bad/);
 assert.deepEqual(failedPhases,['before-save'],
   'A failed validation rule must prevent after-save Flow execution');
 const successPhases=[];
 records.setRecordTriggerHandler(async(_tx,_tenant,_actor,_object,_operation,record,_prior,phase)=>{
   successPhases.push(phase);return record;
 });
 await records.create(tenantId,userId,'AuditItem__c',{Name:'Flow order good'});
 assert.deepEqual(successPhases,['before-save','after-save']);
 // Object Manager limits must be enforced by live PostgreSQL for shared metadata APIs.
 await objects.create(tenantId,'MetadataQuotaProbe__c','Metadata Quota Probe',[
   {apiName:'Name',label:'Name',dataType:'Text(80)',required:true}
 ]);
 await db.query(`INSERT INTO md_object_metadata_limits
   (tenant_id,object_api,max_fields) VALUES($1,'MetadataQuotaProbe__c',1)`,[tenantId]);
 await assert.rejects(()=>
   objects.addField(tenantId,'MetadataQuotaProbe__c','ShouldFail__c','Text(80)',undefined,'Too many fields'),
   /Object metadata limit exceeded/);
 assert.equal(Number((await db.query(`SELECT COUNT(*) AS total FROM md_field_definitions
   WHERE tenant_id=$1 AND object_api='MetadataQuotaProbe__c' AND deleted_at IS NULL`,
   [tenantId])).rows[0].total),1,'metadata limit failure rolls back the extra field');
 await db.query(`UPDATE md_object_metadata_limits SET max_fields=2
   WHERE tenant_id=$1 AND object_api='MetadataQuotaProbe__c'`,[tenantId]);
 await objects.addField(tenantId,'MetadataQuotaProbe__c','Allowed__c','Text(80)',undefined,'Allowed field');
 assert.equal(Number((await db.query(`SELECT COUNT(*) AS total FROM md_field_definitions
   WHERE tenant_id=$1 AND object_api='MetadataQuotaProbe__c' AND deleted_at IS NULL`,
   [tenantId])).rows[0].total),2,'raising the cap allows the shared field API to create');
 console.info('Tenant SQL metadata limit enforcement: passed');

 // Business processes are tenant SQL metadata that explicitly constrain
 // existing Record Type picklists through the one Record Engine.
 const processObject=await objects.create(tenantId,'ProcessProbe__c','Process Probe',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Stage',label:'Stage',dataType:'Picklist',picklistValues:['New','Approved','Rejected']}
 ]);
 await db.query(`INSERT INTO md_object_business_processes
  (tenant_id,object_api,api_name,label,status_field,active)
  VALUES($1,'ProcessProbe__c','Approval','Approval process','Stage',true)`,[tenantId]);
 for(const [index,value] of ['New','Approved'].entries())
  await db.query(`INSERT INTO md_object_business_process_values
   (tenant_id,object_api,process_api,value_text,sort_order)
   VALUES($1,'ProcessProbe__c','Approval',$2,$3)`,[tenantId,value,index]);
 const chosen=processObject.recordTypes.map(recordType=>({...recordType,
  businessProcessApiName:'Approval',
  picklistValues:{...recordType.picklistValues,Stage:['New','Approved']}}));
 const processed=await objects.replaceLayouts(tenantId,'ProcessProbe__c',{
  ...processObject,recordTypes:chosen
 },processObject.revision);
 assert.equal(processed.recordTypes[0].businessProcessApiName,'Approval');
 assert.deepEqual(processed.recordTypes[0].picklistValues.Stage,['New','Approved']);
 const savedStages=await db.query(`SELECT field_value FROM md_object_record_type_values
  WHERE tenant_id=$1 AND object_api='ProcessProbe__c' AND field_api='Stage'
  ORDER BY sort_order`,[tenantId]);
 assert.deepEqual(savedStages.rows.map(row=>row.field_value),['New','Approved']);
 const stale=processed.recordTypes.map(recordType=>({...recordType,
  picklistValues:{...recordType.picklistValues,Stage:['New']}}));
 await assert.rejects(()=>objects.replaceLayouts(tenantId,'ProcessProbe__c',{
  ...processed,recordTypes:stale
 },processed.revision),/Apply the business process status values/);
 const {snapshotBusinessProcessRevision,restoreBusinessProcessRevision}=await import(
  new URL('business-process-history.js',support).href);
 const processContext={tenantId,objectApi:'ProcessProbe__c',processApi:'Approval',actorId:userId};
 await db.transaction(client=>snapshotBusinessProcessRevision(client,processContext));
 await db.query(`UPDATE md_object_business_processes
  SET label='Approval process updated',revision=revision+1
  WHERE tenant_id=$1 AND object_api='ProcessProbe__c' AND api_name='Approval'`,[tenantId]);
 await db.query(`DELETE FROM md_object_business_process_values
  WHERE tenant_id=$1 AND object_api='ProcessProbe__c' AND process_api='Approval'`,[tenantId]);
 for(const [order,value] of ['New','Rejected'].entries())
  await db.query(`INSERT INTO md_object_business_process_values
   (tenant_id,object_api,process_api,value_text,sort_order)
   VALUES($1,'ProcessProbe__c','Approval',$2,$3)`,[tenantId,value,order]);
 await db.transaction(client=>snapshotBusinessProcessRevision(client,processContext));
 const restoredRevision=await db.transaction(client=>
  restoreBusinessProcessRevision(client,processContext,1,2));
 assert.equal(restoredRevision,3);
 const revisions=await db.query(`SELECT revision,label FROM md_object_business_process_history
  WHERE tenant_id=$1 AND object_api='ProcessProbe__c' AND process_api='Approval'
  ORDER BY revision`,[tenantId]);
 assert.deepEqual(revisions.rows.map(row=>row.revision),[1,2,3]);
 assert.equal(revisions.rows[2].label,'Approval process');
 const retained=await db.query(`SELECT field_value FROM md_object_record_type_values
   WHERE tenant_id=$1 AND object_api='ProcessProbe__c' AND field_api='Stage'
   ORDER BY sort_order`,[tenantId]);
 assert.deepEqual(retained.rows.map(row=>row.field_value),['New','Approved']);
 await assert.rejects(()=>db.transaction(client=>
  restoreBusinessProcessRevision(client,processContext,2,2)),/revision conflict/);
 console.info('Business process SQL history, restore and Record Type preservation: passed');
 console.info('Business process Record Type SQL persistence and snapshot protection: passed');
 console.info('SQL system migrations, RBAC and declarative rule acceptance: passed');
}finally{await db.close();}

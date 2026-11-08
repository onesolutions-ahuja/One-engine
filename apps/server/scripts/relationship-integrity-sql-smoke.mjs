import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||!url.includes('/metadrive_2c'))
 throw new Error('Phase 2C requires a disposable metadrive_2c database');
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const relationships=new URL('../dist-system/relationship-engine/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations},{ObjectDefinitionService},
 {RecordEngine},{RbacEngine},{listRelationshipDefinitions}]=await Promise.all([
 import(new URL('sql-persistence.js',built).href),
 import(new URL('system-migrations.js',support).href),
 import(new URL('object-definition.js',built).href),
 import(new URL('record-engine.js',built).href),
 import(new URL('rbac-engine.js',built).href),
 import(new URL('RelationshipRegistry.js',relationships).href)
]);
const db=new SqlPersistence(url);
try{
 await db.query(readFileSync(fileURLToPath(new URL('../src/system-files/schema.sql',import.meta.url)),'utf8'));
 await applySystemMigrations(db);
 const defs=new ObjectDefinitionService(db);
 const tenants=[];
 for(const slug of ['phase-2c-main','phase-2c-isolated']){
  const created=await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$1) RETURNING id',[slug]);
  tenants.push(created.rows[0].id);
 }
 const [tenant,otherTenant]=tenants;
 const principal=await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'phase2c@example.invalid','fixture') RETURNING id",[tenant]);
 const user=principal.rows[0].id;
 const access=await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Phase2C') RETURNING id",[tenant]);
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,access.rows[0].id]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,access.rows[0].id]);
 const rb=new RbacEngine(db),records=new RecordEngine(db,rb);
 const name=[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}];
 for(const t of [tenant,otherTenant])for(const nameOfObject of ['PhaseParent__c','PhaseChild__c','PhaseGrand__c']){
  await defs.create(t,nameOfObject,nameOfObject.replace('__c',''),name);
 }
 const lookup=(target,name,behavior='Clear')=>({
   relationship:{type:'Lookup',targetObject:target,relationshipName:name,
    childRelationshipName:name+'Records',deleteBehavior:behavior}
 });
 const master=(target,name,allowReparenting=false)=>({
   relationship:{type:'Master-Detail',targetObject:target,relationshipName:name,
    childRelationshipName:name+'Records',allowReparenting}
 });
 await defs.addField(tenant,'PhaseParent__c','PeerId','Lookup(PhaseParent__c)',undefined,'Peer',
  lookup('PhaseParent__c','Peer'));
 await defs.addField(tenant,'PhaseChild__c','ParentId','Master-Detail(PhaseParent__c)',undefined,'Parent',
  master('PhaseParent__c','PrimaryParent'));
 await defs.addField(tenant,'PhaseChild__c','SecondaryParentId','Lookup(PhaseParent__c)',undefined,
  'Secondary Parent',lookup('PhaseParent__c','SecondaryParent'));
 await defs.addField(tenant,'PhaseChild__c','ReviewParentId','Lookup(PhaseParent__c)',undefined,
  'Review Parent',lookup('PhaseParent__c','ReviewParent'));
 await assert.rejects(()=>defs.addField(tenant,'PhaseChild__c','CollidingParentId',
  'Lookup(PhaseParent__c)',undefined,'Colliding Parent',{
    relationship:{type:'Lookup',targetObject:'PhaseParent__c',
      relationshipName:'CollidingParent',childRelationshipName:'SecondaryParentRecords'}
  }),/Duplicate child relationship name/);

 await defs.addField(tenant,'PhaseGrand__c','ChildId','Master-Detail(PhaseChild__c)',undefined,'Child',
  master('PhaseChild__c','PrimaryChild',true));
 await defs.addField(tenant,'PhaseGrand__c','BlockingParentId','Lookup(PhaseParent__c)',undefined,
  'Blocking Parent',lookup('PhaseParent__c','BlockingParent','Restrict'));
 await defs.addField(tenant,'PhaseGrand__c','ASecondaryMasterId','Master-Detail(PhaseParent__c)',
  undefined,'Secondary Master',master('PhaseParent__c','SecondaryMaster',true));
 const primaryMetadata=(await db.query(
  `SELECT api_name,is_primary_master FROM md_field_definitions
   WHERE tenant_id=$1 AND object_api='PhaseGrand__c' AND relationship_type='Master-Detail'`,
  [tenant])).rows;
 assert.deepEqual(primaryMetadata.filter(row=>row.is_primary_master).map(row=>row.api_name),
  ['ChildId'],'The first-created master, not alphabetical API order, owns the detail');
 const edges=await listRelationshipDefinitions(db,tenant);
 assert.equal(edges.filter(e=>e.sourceObject==='PhaseChild__c'&&e.targetObject==='PhaseParent__c').length,3);
 assert.ok(edges.some(e=>e.fieldApiName==='ParentId'&&e.relationshipType==='Master-Detail'
   &&e.childRelationshipName==='PrimaryParentRecords'));
 assert.ok(edges.some(e=>e.fieldApiName==='BlockingParentId'&&e.deleteBehavior==='Restrict'));
 assert.equal((await listRelationshipDefinitions(db,otherTenant)).length,0,'No tenant metadata leakage');
 assert.equal((await listRelationshipDefinitions(db,tenant,'PhaseParent__c')).length,6);
 await assert.rejects(()=>defs.addField(tenant,'PhaseParent__c','BadMasterId',
   'Master-Detail(PhaseGrand__c)'),/cycle/);
 const p1=await records.create(tenant,user,'PhaseParent__c',{Name:'Parent A'});
 const p2=await records.create(tenant,user,'PhaseParent__c',{Name:'Parent B'});
 const foreign=await db.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'PhaseParent__c') RETURNING id",[otherTenant]);
 await assert.rejects(()=>records.create(tenant,user,'PhaseChild__c',
   {Name:'Foreign',ParentId:foreign.rows[0].id}),/relationship target/);
 await records.update(tenant,user,'PhaseParent__c',p1,{PeerId:p2});
 await records.update(tenant,user,'PhaseParent__c',p2,{PeerId:p1});
 const c1=await records.create(tenant,user,'PhaseChild__c',
  {Name:'Child A',ParentId:p1,SecondaryParentId:p2,ReviewParentId:p1});
 const c2=await records.create(tenant,user,'PhaseChild__c',
  {Name:'Child B',ParentId:p2});
 const g1=await records.create(tenant,user,'PhaseGrand__c',
  {Name:'Grand',ChildId:c1,BlockingParentId:p1,ASecondaryMasterId:p2});
 // Field paths are resolved by configured relationship aliases, not by a
 // hardcoded target object. A three-level formula must remain fresh on update.
 await defs.addField(tenant,'PhaseGrand__c','AncestorLabel','Formula(Text)',
   undefined,'Ancestor Label',{formula:{
    expression:'PrimaryChild.PrimaryParent.Name',returnType:'Text'
   }});
 await defs.addField(tenant,'PhaseGrand__c','OtherMasterLabel','Formula(Text)',
   undefined,'Other Master Label',{formula:{
    expression:'SecondaryMaster.Name',returnType:'Text'
   }});
 const labeled=await records.get(tenant,user,'PhaseGrand__c',g1);
 assert.equal(labeled.AncestorLabel,'Parent A');
 assert.equal(labeled.OtherMasterLabel,'Parent B');
 await records.update(tenant,user,'PhaseParent__c',p1,{Name:'Parent A Updated'});
 assert.equal((await records.get(tenant,user,'PhaseGrand__c',g1)).AncestorLabel,
  'Parent A Updated','Related formula values must invalidate when an ancestor changes');
 await records.update(tenant,user,'PhaseParent__c',p1,{Name:'Parent A'}); 
 // Controlled-by-parent sharing uses both masters and propagates through
 // Parent -> Child -> Grandchild. The child/grandchild owners are deliberately
 // different from the parent owner; independent sharing must not grant access.
 const inheritedReader=(await db.query(
  "INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'parentreader@example.invalid','fixture') RETURNING id",
  [tenant])).rows[0].id;
 const inheritedSet=(await db.query(
  "INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'InheritedParentReader') RETURNING id",
  [tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',
  [tenant,inheritedReader,inheritedSet]);
 for(const objectApi of ['PhaseParent__c','PhaseChild__c','PhaseGrand__c'])
  for(const resource of [objectApi,'RecordType:'+objectApi+'.master'])
   await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,'read','allow')",
    [tenant,inheritedSet,resource]);
 await db.query("UPDATE md_records SET owner_id=$3 WHERE tenant_id=$1 AND id=$2",
  [tenant,p1,inheritedReader]);
 const read=async id=>(await db.query("SELECT md_record_access($1,$2,$3,'read') AS permitted",
  [tenant,inheritedReader,id])).rows[0].permitted;
 const context=(await db.query(`SELECT r.owner_id,r.record_type_id,
   md_rbac_allowed($1,$2,'PhaseParent__c','read') AS object_grant,
   md_rbac_allowed($1,$2,'RecordType:PhaseParent__c.master','read') AS type_grant
   FROM md_records r WHERE r.tenant_id=$1 AND r.id=$3`,[tenant,inheritedReader,p1])).rows[0];
 console.info('2C parent owner permission context:',JSON.stringify(context));
 assert.equal(await read(p1),true);
 assert.equal(await read(c1),true,'A nonowned child must inherit sharing from its master');
 assert.equal(await read(g1),false,'A junction detail must require both master parents');
 await db.query("UPDATE md_records SET owner_id=$3 WHERE tenant_id=$1 AND id=$2",
  [tenant,p2,inheritedReader]);
 assert.equal(await read(g1),true,'Grandchild must inherit multi-hop, multi-master sharing');
 const owners=(await db.query(
  'SELECT id,owner_id FROM md_records WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
  [tenant,[p1,p2,c1,c2,g1]])).rows;
 assert.equal(owners.find(row=>row.id===c1)?.owner_id,inheritedReader,
  'Detail owner should track the primary master owner');
 assert.equal(owners.find(row=>row.id===g1)?.owner_id,inheritedReader,
  'A two-hop detail owner should track its primary master owner');
 assert.equal(owners.find(row=>row.id===c2)?.owner_id,inheritedReader,
  'Master ownership changes should propagate to sibling detail records');
 // Required lookup filters reject invalid targets at the shared Record Engine;
 // optional filters are advisory and must not block otherwise valid writes.
 const {persistObjectLookupFilters}=await import(new URL('object-manager-lookup-filters.js',built).href);
 await db.transaction(async client=>persistObjectLookupFilters(client,tenant,'PhaseChild__c',{
  relatedLookupFilters:[
   {id:'review-parent-check',fieldApiName:'ReviewParentId',relatedObject:'PhaseParent__c',
    relatedFieldApiName:'Name',operator:'Equals',value:'Parent A',required:true},
   {id:'secondary-parent-hint',fieldApiName:'SecondaryParentId',relatedObject:'PhaseParent__c',
    relatedFieldApiName:'Name',operator:'Equals',value:'Never Matching',required:false}
  ],
  relatedLookupFilterLogic:{ReviewParentId:'All'}
 }));
 await assert.rejects(()=>records.update(tenant,user,'PhaseChild__c',c1,
  {ReviewParentId:p2}),/Invalid required lookup filter/);
 await records.update(tenant,user,'PhaseChild__c',c1,{SecondaryParentId:p2});

 // SQL must never admit a valid-tenant ID from the wrong target object.
 await assert.rejects(()=>db.query("UPDATE md_record_values SET reference_record_id=$4 WHERE tenant_id=$1 AND record_id=$2 AND field_api=$3",
  [tenant,c1,'SecondaryParentId',c1]),/Invalid relationship target/);
 await assert.rejects(()=>records.update(tenant,user,'PhaseChild__c',c1,{ParentId:p2}),/does not allow reparenting/);
 await records.update(tenant,user,'PhaseGrand__c',g1,{ChildId:c2});
 await records.update(tenant,user,'PhaseGrand__c',g1,{ChildId:c1});
 const primary=await records.list(tenant,user,'PhaseChild__c',50,0,{relatedField:'ParentId',relatedId:p1});
 const secondary=await records.list(tenant,user,'PhaseChild__c',50,0,{relatedField:'SecondaryParentId',relatedId:p2});
 assert.ok(primary.records.some(row=>row.Id===c1),'Inverse master-detail query omitted the child');
 assert.ok(secondary.records.some(row=>row.Id===c1),'Second lookup query conflated relationship fields');
 await assert.rejects(()=>records.remove(tenant,user,'PhaseParent__c',p1),/restricted/);
 assert.equal((await db.query('SELECT is_deleted FROM md_records WHERE tenant_id=$1 AND id=$2',[tenant,p1])).rows[0].is_deleted,false);
 await records.update(tenant,user,'PhaseGrand__c',g1,{BlockingParentId:null});
 // Salesforce cascade deletes are platform-owned: a user authorised to delete
 // the parent can delete its descendants even when the detail object has an
 // explicit independent delete deny. Direct detail deletion still checks RBAC.
 const cascadeActor=(await db.query(
  "INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'cascade@example.invalid','fixture') RETURNING id",
  [tenant])).rows[0].id;
 const cascadeSet=(await db.query(
  "INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'ParentCascadeOnly') RETURNING id",
  [tenant])).rows[0].id;
 await db.query("INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)",
  [tenant,cascadeActor,cascadeSet]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'PhaseParent__c','delete','allow')",
  [tenant,cascadeSet]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'RecordType:PhaseParent__c.master','read','allow')",
  [tenant,cascadeSet]);
 for(const target of ['PhaseChild__c','PhaseGrand__c'])
  await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,'delete','deny')",
   [tenant,cascadeSet,target]);
 await assert.rejects(()=>records.remove(tenant,cascadeActor,'PhaseChild__c',c1),
  /Permission denied/);
 await db.query("UPDATE md_records SET owner_id=$3 WHERE tenant_id=$1 AND id=$2",
  [tenant,p1,cascadeActor]);
 await records.remove(tenant,cascadeActor,'PhaseParent__c',p1);
 const gone=await db.query('SELECT id,is_deleted FROM md_records WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
  [tenant,[p1,c1,g1]]);
 assert.equal(gone.rows.length,3);
 assert.ok(gone.rows.every(row=>row.is_deleted),'Master-detail cascade must reach grandchild');
 assert.equal((await db.query('SELECT is_deleted FROM md_records WHERE tenant_id=$1 AND id=$2',[tenant,p2])).rows[0].is_deleted,false);
 assert.equal((await db.query('SELECT is_deleted FROM md_records WHERE tenant_id=$1 AND id=$2',[tenant,c2])).rows[0].is_deleted,false);
 await assert.rejects(()=>db.query("INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,reference_record_id) VALUES($1,$2,'PhaseChild__c','ReviewParentId',$3)",
  [tenant,c2,p1]),/Invalid relationship target/);

 // A record author can have Child create rights but must not reference a parent
 // that their record-sharing policy forbids them to read.
 const restrictedUser=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'blocked@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const restrictedSet=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'BlockedParent') RETURNING id",[tenant])).rows[0].id;
 await db.query("INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)",[tenant,restrictedUser,restrictedSet]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow'),($1,$2,'PhaseParent__c','read','deny')",[tenant,restrictedSet]);
 await assert.rejects(()=>records.create(tenant,restrictedUser,'PhaseChild__c',
  {Name:'Hidden parent attempt',ParentId:p2}),/Invalid relationship target/);
 const inherited=await db.query("SELECT md_record_access($1,$2,$3,'read') AS visible",[tenant,restrictedUser,c2]);
 assert.equal(inherited.rows[0].visible,false,
  'Master-detail child must never disclose a parent inaccessible to the actor');
 const visible=await db.query("SELECT md_record_access($1,$2,$3,'read') AS visible",[tenant,user,c2]);
 assert.equal(visible.rows[0].visible,true,'Parent grants must carry through to the child');


 console.info('Phase 2C SQL: 3-level cascade, distinct lookup edges, self-reference, reparenting, Restrict, tenant isolation, discovery passed');
}finally{await db.close();}

import {readBaselineMigration} from './baseline-sql-section.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{RbacEngine},{RecordEngine},{ObjectDefinitionService},{AppRuntime},{RbacAdministration},{AuthenticationService},{createSystemServer},{applySystemMigrations}]=await Promise.all([
 import(new URL('sql-persistence.js',built)),import(new URL('rbac-engine.js',built)),
 import(new URL('record-engine.js',built)),import(new URL('object-definition.js',built)),
 import(new URL('app-runtime.js',built)),import(new URL('rbac-administration.js',support)),
 import(new URL('authentication.js',built)),import(new URL('server.js',support)),import(new URL('system-migrations.js',support))
]);
const db=new SqlPersistence(process.env.METADRIVE_SQL_TEST_DATABASE_URL??'');
let listener;
try{
 const {rows:[tenant]}=await db.query("INSERT INTO md_tenants(slug,name) VALUES('rbac-sql-smoke','RBAC isolated SQL validation') RETURNING id");
 const t=tenant.id,rbac=new RbacEngine(db),records=new RecordEngine(db,rbac),admin=new RbacAdministration(db,rbac);
 const auth=new AuthenticationService(db),password='RbacSqlTestPassphrase!2026',hash=await auth.hashPassword(password);
 const user=async(email)=>(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[t,email,hash])).rows[0].id;
 const developer=await user('developer@example.invalid'),supervisor=await user('administrator@example.invalid'),cashier=await user('cashier@example.invalid');
 const set=async(api,user)=>{const {rows:[p]}=await db.query('INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,$2) RETURNING id',[t,api]);
  await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'*','*','allow')",[t,p.id]);
  await db.query('INSERT INTO md_permission_assignments VALUES($1,$2,$3)',[t,user,p.id]);return p.id;};
 const one=await set('TenantDeveloper',developer),superSet=await set('Supervisor',supervisor);
 const identity=readBaselineMigration('20261018-zzzzzz-oneengine-identity.sql');
 await db.query(identity);await db.query(identity);
 assert.equal((await db.query('SELECT api_name FROM md_permission_sets WHERE tenant_id=$1 AND id=$2',[t,one])).rows[0].api_name,'OneEngine');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM md_permission_assignments WHERE tenant_id=$1 AND user_id=$2 AND permission_set_id=$3',[t,developer,one])).rows[0].n,1);
 // Seed an unassigned platform-only identity to test indirect-delegation protection.
 const platformId=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'PlatformDeveloper') RETURNING id",[t])).rows[0].id;
 const objects=new ObjectDefinitionService(db);
 await objects.create(t,'Invoice','Invoice',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Total',label:'Total',dataType:'Number'},
  {apiName:'OwnerId',label:'Owner',dataType:'Text(80)'}
 ]);
 const apps=new AppRuntime(db);
 await apps.saveMetadata(t,'RbacTest',{apiName:'RbacTest',label:'RBAC Test',description:'Validation',
  brandColor:'#123456',navigationItems:['Invoice'],navigationPageApiNames:[],
  navigationOrder:[{type:'Object',apiName:'Invoice'}],utilityItems:[]},false);
 const owned=await records.create(t,developer,'Invoice',{Name:'Private invoice',Total:10,RecordTypeId:'master'});

 // Real two-tenant isolation, not a synthetic unknown-user check.
 const {rows:[isolatedTenant]}=await db.query("INSERT INTO md_tenants(slug,name) VALUES('rbac-sql-smoke-isolated','RBAC second tenant') RETURNING id");
 const t2=isolatedTenant.id;
 const outsider=(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',
  [t2,'isolated@example.invalid',hash])).rows[0].id;
 const outsidePermissionSet=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'TenantIsolationAdmin') RETURNING id",[t2])).rows[0].id;
 await db.query("INSERT INTO md_permission_rules VALUES($1,$2,'*','*','allow')",[t2,outsidePermissionSet]);
 await db.query('INSERT INTO md_permission_assignments VALUES($1,$2,$3)',[t2,outsider,outsidePermissionSet]);
 await objects.create(t2,'Invoice','Invoice',[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}]);
 const foreign=await records.create(t2,outsider,'Invoice',{Name:'Tenant two record',RecordTypeId:'master'});
 assert.equal((await records.get(t2,outsider,'Invoice',foreign)).Id,foreign);
 await assert.rejects(()=>records.get(t,developer,'Invoice',foreign),/Record not found/);
 await assert.rejects(()=>records.get(t2,outsider,'Invoice',owned),/Record not found/);
 await assert.rejects(()=>records.update(t2,outsider,'Invoice',owned,{Name:'Breach'}),/Record not found/);
 await assert.rejects(()=>records.remove(t2,outsider,'Invoice',owned),/Record not found/);
 assert.equal((await records.get(t,developer,'Invoice',owned)).Name,'Private invoice');

 const profile=randomUUID(),cashSet=randomUUID(),group=randomUUID(),role=randomUUID(),publicGroup=randomUUID(),queue=randomUUID();
 const policy=(id,apiName)=>({id,apiName,label:apiName,license:'MetaDrive',description:'',
  systemPermissions:[],objectPermissions:{},fieldPermissions:{},recordTypePermissions:{},appPermissions:{},tabPermissions:{}});
 let state=await rbac.describe(t,supervisor);
 const save=async(edit,actor=supervisor)=>{const next=structuredClone(await rbac.describe(t,actor));edit(next);return admin.save(t,actor,next);};
 state=await save(s=>{
  s.roles.push({id:role,apiName:'CashierRole',name:'Cashier role',parentRoleId:null});
  s.profiles.push({...policy(profile,'CashierProfile'),isStandard:false,
   objectPermissions:{Invoice:{read:true,create:true,edit:true,delete:true}},
   fieldPermissions:{'Invoice.Name':{read:true,create:true,edit:true},'Invoice.Total':{read:true,create:true,edit:true}},
   recordTypePermissions:{'Invoice.master':true},appPermissions:{RbacTest:true},tabPermissions:{Invoice:true}});
  s.permissionSets.push({...policy(cashSet,'CashierFlows'),systemPermissions:['flows:run']});
  s.permissionSetGroups.push({id:group,apiName:'CashierGroup',label:'Cashier group',description:'',
   permissionSetIds:[cashSet],calculationStatus:'Updated',lastCalculatedAt:null,mutedSystemPermissions:[],
   mutedObjectPermissions:{},mutedFieldPermissions:{},mutedRecordTypePermissions:{},mutedAppPermissions:{},mutedTabPermissions:{}});
  const u=s.users.find(u=>u.id===cashier);u.profileId=profile;u.roleId=role;u.permissionSetGroupIds=[group];
 });
 assert.equal(state.users.find(u=>u.id===cashier).profileId,profile);
 assert.equal(await rbac.allowed(t,cashier,'Invoice','create'),true);
 assert.equal(await rbac.allowed(t,cashier,'Flow:Checkout','execute'),true);
 assert.equal(await rbac.allowed(t,cashier,'App:RbacTest','read'),true);
 assert.equal(await rbac.allowed(t,cashier,'Tab:Invoice','read'),true);
 // Tenant admins must not confer platform authority through profile inheritance or set groups.
 await assert.rejects(()=>save(s=>{s.permissionSetGroups.find(g=>g.id===group).permissionSetIds.push(platformId);}),/Permission denied/);
 await assert.rejects(()=>save(s=>{s.profiles.find(p=>p.id===profile).inheritedPermissionSetIds.push(platformId);}),/Permission denied/);
 await assert.rejects(()=>save(s=>{s.users.find(u=>u.id===cashier).permissionSetIds.push(platformId);}),/Permission denied/);
 const platformRole=randomUUID();
 await save(s=>{s.roles.push({id:platformRole,apiName:'LegacyPlatformRole',name:'Platform-linked role',parentRoleId:null});});
 await db.query('INSERT INTO md_role_permission_sets(tenant_id,role_id,permission_set_id) VALUES($1,$2,$3)',[t,platformRole,platformId]);
 await assert.rejects(()=>save(s=>{s.users.find(u=>u.id===cashier).roleId=platformRole;}),/Permission denied/);

 await assert.rejects(()=>save(s=>{
  s.permissionSetGroups.push({...s.permissionSetGroups[0],id:randomUUID(),apiName:'DormantPlatformGroup',permissionSetIds:[platformId]});
 }),/Permission denied/);
 await assert.rejects(()=>admin.save(t,cashier,state),/Permission denied/);
 const mine=await records.create(t,cashier,'Invoice',{Name:'Cashier invoice',Total:20,RecordTypeId:'master'});
 assert.equal((await records.list(t,cashier,'Invoice')).total,1);
 await assert.rejects(()=>records.get(t,cashier,'Invoice',owned),/not found/);
 await assert.rejects(()=>records.update(t,cashier,'Invoice',owned,{Total:99}),/not found/);
 await assert.rejects(()=>records.remove(t,cashier,'Invoice',owned),/not found/);
 // Named Flow deny overrides OneEngine wildcard and revocation is visible without a new session.
 await save(s=>{const p=s.permissionSets.find(p=>p.id===one);
  p.systemPermissions=p.systemPermissions.filter(p=>p!=='flows:run');p.fieldPermissions['Invoice.Total'].edit=false;});
 assert.equal(await rbac.allowed(t,developer,'Flow:Checkout','execute'),false);
 await assert.rejects(()=>records.update(t,developer,'Invoice',owned,{Total:99}),/Permission denied/);
 await save(s=>{const p=s.permissionSets.find(p=>p.id===one);p.systemPermissions.push('flows:run');p.fieldPermissions['Invoice.Total'].edit=true;});
 assert.equal(await rbac.allowed(t,developer,'Flow:Checkout','execute'),true);
 await records.update(t,developer,'Invoice',owned,{Total:10});
 // Group mute affects only this group's allows. A direct grant remains effective.
 await save(s=>{s.permissionSetGroups.find(g=>g.id===group).mutedSystemPermissions=['flows:run'];});
 assert.equal(await rbac.allowed(t,cashier,'Flow:Checkout','execute'),false);
 await save(s=>{s.users.find(u=>u.id===cashier).permissionSetIds=[cashSet];});
 assert.equal(await rbac.allowed(t,cashier,'Flow:Checkout','execute'),true);
 await save(s=>{s.permissionSets.find(p=>p.id===cashSet).advancedRules=[{resource:'Flow',action:'execute',effect:'deny'}];});
 assert.equal(await rbac.allowed(t,cashier,'Flow:Checkout','execute'),false);
 await save(s=>{const p=s.permissionSets.find(p=>p.id===cashSet);p.advancedRules=[];p.deniedPermissions=[];p.systemPermissions=['flows:run'];});
 // Public group and queue membership persist and participate in record sharing.
 await save(s=>{
  s.publicGroups.push({id:publicGroup,apiName:'TillUsers',label:'Till users',description:'',userIds:[cashier],roleIds:[],roleAndSubordinateIds:[],groupIds:[]});
  s.queues.push({id:queue,apiName:'TillQueue',label:'Till queue',description:'',userIds:[],roleIds:[],roleAndSubordinateIds:[],publicGroupIds:[publicGroup],supportedObjectApiNames:['Invoice']});
  s.sharingRules.push({id:randomUUID(),apiName:'InvoiceShare',label:'Invoice share',objectApiName:'Invoice',active:true,type:'CriteriaBased',ownerRoleIds:[],
   criteria:[{fieldApiName:'Total',operator:'Equals',value:'10'}],filterLogic:'All',targetType:'PublicGroup',targetId:publicGroup,accessLevel:'Edit'});
 });
 assert.equal((await records.list(t,cashier,'Invoice')).total,2);
 await records.update(t,cashier,'Invoice',owned,{Total:10});
 await save(s=>{
  s.sharingSettings.Invoice={defaultAccess:'Public Read/Write',grantAccessUsingHierarchies:false,restrictionRules:[
   {id:'restricted_cashier',tenantId:t,objectApiName:'Invoice',enabled:true,subjectType:'user',subjectId:cashier,
    conditionLogic:'all',conditions:[{field:'Total',operator:'eq',value:'10'}]}]};
 });
 assert.equal((await records.list(t,cashier,'Invoice')).total,1,'restriction narrows both public and ownership grants');
 await assert.rejects(()=>records.get(t,cashier,'Invoice',mine),/not found/);
 await save(s=>{s.sharingSettings.Invoice.restrictionRules=[];s.sharingRules=[];s.sharingSettings.Invoice.defaultAccess='Private';});
 await records.transferOwner(t,developer,'Invoice',owned,queue);
 assert.equal((await records.get(t,cashier,'Invoice',owned)).OwnerId,queue);
 // Record type restrictions are enforced on reads and writes.
 await save(s=>{s.profiles.find(p=>p.id===profile).advancedRules=[{resource:'RecordType:Invoice.master',action:'read',effect:'deny'}];});
 await assert.rejects(()=>records.create(t,cashier,'Invoice',{Name:'Denied type',RecordTypeId:'master'}),/Permission denied/);
 assert.equal((await records.list(t,cashier,'Invoice')).total,0);
 await assert.rejects(()=>records.create(t,cashier,'Invoice',{Name:'Implicit default type'}),/Permission denied/);
 await save(s=>{const p=s.profiles.find(p=>p.id===profile);p.advancedRules=[];p.deniedPermissions=[];p.recordTypePermissions['Invoice.master']=true;});
 // A policy administrator retaining broad data grants can recover a tenant-wide restriction.
 await save(s=>{s.sharingSettings.Invoice.restrictionRules=[
  {id:'tenant_wide_restriction',tenantId:t,objectApiName:'Invoice',enabled:true,subjectType:'all',
   conditionLogic:'all',conditions:[{field:'Total',operator:'eq',value:'10'}]}];});
 assert.equal((await records.list(t,supervisor,'Invoice')).total,1);
 await save(s=>{s.sharingSettings.Invoice.restrictionRules=[];});
 assert.equal((await records.list(t,supervisor,'Invoice')).total,2);
 // A delegated security administrator cannot grow its own rights indirectly.
 const limited=await user('delegated-admin@example.invalid'),limitedSet=randomUUID(),limitedRole=randomUUID();
 await save(s=>{
  s.sharingSettings.Invoice.grantAccessUsingHierarchies=true;
  s.roles.push({id:limitedRole,apiName:'DelegatedRole',name:'Delegated role',parentRoleId:null});
  s.permissionSets.push({...policy(limitedSet,'DelegatedAdministration'),
   systemPermissions:['security:read','security:manage','User:edit'],
   objectPermissions:{Invoice:{read:true}},recordTypePermissions:{'Invoice.master':true}});
  const u=s.users.find(u=>u.id===limited);u.roleId=limitedRole;u.permissionSetIds=[limitedSet];
 });
 await assert.rejects(()=>save(s=>{s.permissionSets.find(p=>p.id===limitedSet).objectPermissions.Invoice.create=true;},limited),/Permission denied/);
 // A delegated administrator cannot assign an unchanged broader policy to a
 // different user (a privilege escalation otherwise missed by policy-diff checks).
 await assert.rejects(()=>save(s=>{s.users.find(u=>u.id===cashier).permissionSetIds.push(one);},limited),/Permission denied/);
 await assert.rejects(()=>save(s=>{
  s.profiles.find(p=>p.id===profile).inheritedPermissionSetIds.push(one);
 },limited),/Permission denied/);
 await assert.rejects(()=>save(s=>{
  s.permissionSetGroups.find(g=>g.id===group).permissionSetIds.push(one);
 },limited),/Permission denied/);
 await assert.rejects(()=>save(s=>{
  s.permissionSetGroups.find(g=>g.id===group).mutedSystemPermissions=[];
 },limited),/Permission denied/);


 await assert.rejects(()=>save(s=>{s.roles.find(r=>r.id===role).parentRoleId=limitedRole;},limited),/Cannot escalate own/);
 assert.equal((await rbac.describe(t,supervisor)).roles.find(r=>r.id===role).parentRoleId,null);

 // Assignment refresh/login and explicit revocation.
 const tokens=await auth.signIn(t,'cashier@example.invalid',password);
 const actor=await auth.authenticate(tokens.accessToken);
 assert.equal(actor.user_id,cashier);
 assert.equal((await rbac.describe(t,supervisor)).users.find(u=>u.id===cashier).permissionSetGroupIds[0],group);
 await save(s=>{const u=s.users.find(u=>u.id===cashier);u.permissionSetIds=[];u.permissionSetGroupIds=[];});
 assert.equal(await rbac.allowed(t,cashier,'Flow:Checkout','execute'),false);
 // Foreign-tenant policies and forged assignments cannot be saved.
 const {rows:[other]}=await db.query("INSERT INTO md_tenants(slug,name) VALUES('rbac-foreign','Foreign tenant') RETURNING id");
 await assert.rejects(()=>admin.save(t,supervisor,{...state,tenantId:other.id}),/Permission denied|revision conflict/);
 const foreignSet=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Foreign') RETURNING id",[other.id])).rows[0].id;
 await assert.rejects(()=>save(s=>{s.users.find(u=>u.id===cashier).permissionSetIds=[foreignSet];}),/Unknown tenant/);
 await assert.rejects(()=>save(s=>{s.permissionSets.find(p=>p.id===platformId).systemPermissions.push('security:read');}),/Permission denied/);
 const before=await rbac.describe(t,supervisor);
 await assert.rejects(()=>admin.save(t,supervisor,{...before,revision:before.revision-1}),/revision conflict/);
 await assert.rejects(()=>save(s=>{s.users.find(u=>u.id===supervisor).permissionSetIds=[one];}),/own permission assignments/);
 await assert.rejects(()=>save(s=>{s.permissionSets.find(p=>p.id===superSet).systemPermissions=[];}),/Permission denied/);
 assert.equal((await rbac.describe(t,supervisor)).revision,before.revision,'failed self-lockout rolls back');
 // Permission set rename and deletion with references preserve data.
 await save(s=>{s.permissionSets.find(p=>p.id===cashSet).apiName='CashierFlowsRenamed';});
 await assert.rejects(()=>save(s=>{s.permissionSets=s.permissionSets.filter(p=>p.id!==cashSet);}),/Unknown tenant/);
 await save(s=>{s.permissionSetGroups=[];s.permissionSets=s.permissionSets.filter(p=>p.id!==cashSet);});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM md_records WHERE tenant_id=$1',[t])).rows[0].n,2);
 // Install/licence checks remain independent of wildcard RBAC.
 await db.query("UPDATE md_app_entitlements SET active=false WHERE tenant_id=$1",[t]);
 await assert.rejects(()=>apps.homePage(t,'RbacTest','desktop'),/Permission denied/);
 await db.query("UPDATE md_app_entitlements SET active=true WHERE tenant_id=$1",[t]);
 await apps.uninstall(t,'RbacTest');
 await assert.rejects(()=>apps.homePage(t,'RbacTest','desktop'),/Permission denied/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM md_records WHERE tenant_id=$1',[t])).rows[0].n,2);
 await applySystemMigrations(db);await applySystemMigrations(db);
 assert.equal(await rbac.allowed(t,developer,'Flow:Checkout','execute'),true);
 // Actual HTTP permission saves reject cashier escalation and stale admin drafts.
 listener=createSystemServer(db).listen(0,'127.0.0.1');
 if(!listener.listening)await import('node:events').then(({once})=>once(listener,'listening'));
 const http=async(token,body)=>fetch('http://127.0.0.1:'+listener.address().port+'/api/metadata/permissions',{
  method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await http(tokens.accessToken,await rbac.describe(t,supervisor))).status,403);
 const get=async(path)=>{const response=await fetch('http://127.0.0.1:'+listener.address().port+'/api'+path,{headers:{Authorization:'Bearer '+tokens.accessToken}});
  assert.equal(response.status,200,await response.clone().text());return response.json();};
 await apps.install(t,'RbacTest');
 let nav=await get('/metadata/apps');
 assert.equal(nav.apps[0].apiName,'RbacTest');
 assert.deepEqual(nav.apps[0].navigationItems,['Invoice']);
 await save(s=>{s.profiles.find(p=>p.id===profile).tabPermissions.Invoice=false;});
 nav=await get('/metadata/apps');assert.deepEqual(nav.apps[0].navigationItems,[]);
 await save(s=>{s.profiles.find(p=>p.id===profile).appPermissions.RbacTest=false;});
 assert.deepEqual((await get('/metadata/apps')).apps,[]);
 // The system User view also obeys central field permissions.
 await save(s=>{s.profiles.find(p=>p.id===profile).systemPermissions.push('User:read','User.Email:read');});
 const visibleUsers=await get('/records/User');
 assert.ok(visibleUsers.records.some(u=>u.Email==='cashier@example.invalid'));
 assert.ok(visibleUsers.records.every(u=>u.Name===undefined));
 await save(s=>{s.profiles.find(p=>p.id===profile).advancedRules=[{resource:'User.Email',action:'read',effect:'deny'}];});
 assert.ok((await get('/records/User')).records.every(u=>u.Email===undefined));
 const adminTokens=await auth.signIn(t,'administrator@example.invalid',password);
 assert.equal((await http(adminTokens.accessToken,{...await rbac.describe(t,supervisor),revision:0})).status,409);

 // Native user reporting hierarchy is independent of the role tree.
 await db.query('UPDATE md_users SET reports_to_user_id=$3 WHERE tenant_id=$1 AND id=$2',[t,supervisor,developer]);
 await db.query('UPDATE md_users SET reports_to_user_id=$3 WHERE tenant_id=$1 AND id=$2',[t,cashier,supervisor]);
 const descendant=(await db.query("SELECT md_reporting_scope($1,$2,$3,'descendants') AS allowed",[t,developer,cashier])).rows[0].allowed;
 assert.equal(descendant,true);
 assert.equal((await db.query("SELECT md_reporting_scope($1,$2,$3,'descendants') AS allowed",[t,cashier,developer])).rows[0].allowed,false);
 await assert.rejects(()=>db.query('UPDATE md_users SET reports_to_user_id=$3 WHERE tenant_id=$1 AND id=$2',[t,developer,cashier]),/Circular reporting hierarchy/);
 await save(snapshot=>{snapshot.permissionSets.find(set=>set.id===superSet).recordDataScopes={Invoice:'descendants'};},developer);
 assert.equal((await db.query("SELECT md_effective_reporting_scope($1,$2,'Invoice') AS scope",[t,supervisor])).rows[0].scope,'descendants');
 const forbidden=await records.create(t,developer,'Invoice',{Name:'Outside team record',Total:18,RecordTypeId:'master'});
 const installedRecordPolicy=(await db.query("SELECT pg_get_functiondef('md_record_access(uuid,uuid,uuid,text)'::regprocedure) AS body")).rows[0].body;
 assert.match(installedRecordPolicy,/md_effective_reporting_scope/,'Record access must enforce management scopes');
 const scopeCheck=await db.query("SELECT owner_id,owner_queue_id,md_effective_reporting_scope($1,$2,'Invoice') AS scope,md_reporting_scope($1,$2,owner_id,'descendants') AS in_team,md_record_access($1,$2,$3,'read') AS allowed FROM md_records WHERE tenant_id=$1 AND id=$3",
  [t,supervisor,forbidden]);
 assert.equal(scopeCheck.rows[0].in_team,false);
 assert.equal(scopeCheck.rows[0].allowed,false,JSON.stringify(scopeCheck.rows[0]));
 console.info('RBAC SQL validation passed: profiles, groups, direct grants/revocation, denies/restoration, sharing/restrictions, queues, record types, tenant isolation, atomic rollback, migration idempotency, HTTP and app licensing');
}finally{
 if(listener?.listening)await new Promise((resolve,reject)=>listener.close(e=>e?reject(e):resolve()));
 await db.close();
}

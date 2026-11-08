import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {PoolClient} from 'pg';
import {RbacEngine} from '../system-files/rbac-engine.js';
import {snapshot,grantRules,type Snapshot,type Rule} from './rbac-contract.js';
import {readRbac} from './rbac-description.js';
import {validateRbac,groupMutes} from './rbac-validation.js';
import {writeRbac} from './rbac-persistence.js';
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>
 v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const assignments=(u:Snapshot['users'][number])=>stable({
 roleId:u.roleId,profileId:u.profileId,sets:[...u.permissionSetIds].sort(),groups:[...u.permissionSetGroupIds].sort(),
 type:u.userType,account:u.externalAccountId
});
/** The complete editor uses one revision, one SQL transaction, and the central RBAC engine. */
export class RbacAdministration{
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 async describe(tenant:string,actor:string){
  await this.rbac.require(tenant,actor,'Security','read');
  return snapshot.parse(await readRbac(this.db,tenant));
 }
 async save(tenant:string,actor:string,body:unknown){
  await this.rbac.require(tenant,actor,'Security','manage');
  await this.rbac.require(tenant,actor,'Security','read');
  const parsed=snapshot.safeParse(body);
  if(!parsed.success)throw Error('Invalid RBAC request: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+' '+i.message).join('; '));
  const next=parsed.data;
  return this.db.transaction(tx=>this.saveWithin(tx,tenant,actor,next));
 }
 async saveWithin(tx:PoolClient,tenant:string,actor:string,body:unknown){
   const parsed=snapshot.safeParse(body);
   if(!parsed.success)throw Error('Invalid RBAC request: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+' '+i.message).join('; '));
   const next=parsed.data;
   await tx.query('SELECT id FROM md_tenants WHERE id=$1 FOR UPDATE',[tenant]);
   // Recheck after acquiring the tenant policy lock: no stale authorization window.
   const currentRbac=new RbacEngine(tx as unknown as SqlPersistence);
   await currentRbac.require(tenant,actor,'Security','manage');
   await currentRbac.require(tenant,actor,'Security','read');
   const previous=snapshot.parse(await readRbac(tx,tenant));
   if(previous.revision!==next.revision)throw Error('RBAC revision conflict; reload permissions before saving');
   await validateRbac(tx,tenant,next);
   const beforeUser=previous.users.find(u=>u.id===actor),afterUser=next.users.find(u=>u.id===actor);
   for(const u of next.users){const old=previous.users.find(p=>p.id===u.id)!;
    if(u.name!==old.name||u.username!==old.username)throw Error('Invalid user identity edits: use User records');
   }
   if(!beforeUser||!afterUser||assignments(beforeUser)!==assignments(afterUser))throw Error('Cannot alter own permission assignments');
   if(next.users.some(u=>assignments(u)!==assignments(previous.users.find(p=>p.id===u.id)!)))
    await currentRbac.require(tenant,actor,'User','edit');
   for(const p of previous.profiles){
    const updated=next.profiles.find(n=>n.id===p.id);
    if(p.isStandard&&(!updated||!updated.isStandard||updated.apiName!==p.apiName))throw Error('Standard profile identity is protected');
   }
   for(const p of next.profiles)if(p.isStandard&&!previous.profiles.some(old=>old.id===p.id&&old.isStandard))
    throw Error('Standard profile identity is protected');
   for(const p of previous.permissionSets.filter(p=>['OneEngine','PlatformDeveloper'].includes(p.apiName))){
    if(next.permissionSets.find(n=>n.id===p.id)?.apiName!==p.apiName)throw Error('Reserved permission set identity is protected');
   }
   // Platform policy administration remains a separately assigned authority.
   const platform=previous.permissionSets.find(p=>p.apiName==='PlatformDeveloper');
   if(!platform&&next.permissionSets.some(p=>p.apiName==='PlatformDeveloper'))throw Error('Permission denied');
   for(const p of next.permissionSets)if(p.navigationDefaultAccess==='Allow'&&previous.permissionSets.find(old=>old.id===p.id)?.navigationDefaultAccess!=='Allow')
    await currentRbac.require(tenant,actor,'*','*');
   const roleLinks=await tx.query<{role_id:string;permission_set_id:string}>(
    'SELECT role_id,permission_set_id FROM md_role_permission_sets WHERE tenant_id=$1',[tenant]);
   const platformChanged=platform&&stable(platform)!==stable(next.permissionSets.find(p=>p.id===platform.id));
   // Platform policy assignment can also flow through inherited profiles or set groups.
   // Protect changes to those links even when no user is assigned yet.
   const platformLinks=(state:Snapshot)=>({
    profiles:state.profiles.filter(p=>p.inheritedPermissionSetIds.includes(platform!.id)).map(p=>p.id).sort(),
    groups:state.permissionSetGroups.filter(g=>g.permissionSetIds.includes(platform!.id)).map(g=>g.id).sort()
   });
   const platformLinked=platform&&stable(platformLinks(previous))!==stable(platformLinks(next));
   const holdsPlatform=(state:Snapshot,u:Snapshot['users'][number])=>
    u.permissionSetIds.includes(platform!.id)||
    Boolean(u.roleId&&roleLinks.rows.some(link=>link.role_id===u.roleId&&link.permission_set_id===platform!.id))||
    Boolean(state.profiles.find(p=>p.id===u.profileId)?.inheritedPermissionSetIds.includes(platform!.id))||
    u.permissionSetGroupIds.some(id=>Boolean(state.permissionSetGroups.find(g=>g.id===id)?.permissionSetIds.includes(platform!.id)));
   const platformAssigned=platform&&next.users.some(u=>{
    const old=previous.users.find(p=>p.id===u.id)!;
    return holdsPlatform(previous,old)!==holdsPlatform(next,u);
   });
   if(platformChanged||platformLinked||platformAssigned){
    const has=await tx.query<{authorised:boolean}>(`
     SELECT EXISTS(
      SELECT 1 FROM md_permission_assignments a JOIN md_permission_sets p
       ON p.tenant_id=a.tenant_id AND p.id=a.permission_set_id
       WHERE a.tenant_id=$1 AND a.user_id=$2 AND p.api_name='PlatformDeveloper'
      UNION ALL SELECT 1 FROM md_user_roles ur JOIN md_role_permission_sets rp
       ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
       JOIN md_permission_sets p ON p.tenant_id=rp.tenant_id AND p.id=rp.permission_set_id
       WHERE ur.tenant_id=$1 AND ur.user_id=$2 AND p.api_name='PlatformDeveloper'
      UNION ALL SELECT 1 FROM md_user_profiles up JOIN md_profile_permission_sets pp
       ON pp.tenant_id=up.tenant_id AND pp.profile_id=up.profile_id
       JOIN md_permission_sets p ON p.tenant_id=pp.tenant_id AND p.id=pp.permission_set_id
       WHERE up.tenant_id=$1 AND up.user_id=$2 AND p.api_name='PlatformDeveloper'
      UNION ALL SELECT 1 FROM md_user_permission_groups ug JOIN md_permission_group_sets gs
       ON gs.tenant_id=ug.tenant_id AND gs.group_id=ug.group_id
       JOIN md_permission_sets p ON p.tenant_id=gs.tenant_id AND p.id=gs.permission_set_id
       WHERE ug.tenant_id=$1 AND ug.user_id=$2 AND p.api_name='PlatformDeveloper'
     ) AS authorised`,[tenant,actor]);
    if(!has.rows[0]?.authorised)throw Error('Permission denied');
   }
   const newAllows:Rule[]=[];
   for(const p of [...next.permissionSets,...next.profiles]){
    const old=[...previous.permissionSets,...previous.profiles].find(o=>o.id===p.id);
    const prior=old?grantRules(old):[];
    newAllows.push(...grantRules(p).filter(r=>r.effect==='allow'&&!prior.some(o=>stable(o)===stable(r))));
   }
   // Revoking a deny also adds authority. Only an actor already holding that authority can delegate it.
   for(const p of [...previous.permissionSets,...previous.profiles]){
    const updated=[...next.permissionSets,...next.profiles].find(o=>o.id===p.id);
    if(!updated)continue;
    const desired=grantRules(updated);
    for(const r of grantRules(p).filter(r=>r.effect==='deny')){
     if(!desired.some(n=>stable(n)===stable(r)))newAllows.push({...r,effect:'allow'});
    }
   }
   // Removing a group mute restores grants for existing members without altering
   // policies or assignment links. Delegated admins must hold restored authority.
   for(const group of next.permissionSetGroups){
    const old=previous.permissionSetGroups.find(g=>g.id===group.id);
    if(!old)continue;
    const stillMuted=groupMutes(group);
    for(const rule of groupMutes(old)){
     if(stillMuted.some(r=>stable(r)===stable(rule)))continue;
     await currentRbac.require(tenant,actor,rule.resource,rule.action);
    }
   }
   // Changes to existing assignment links can delegate grants without changing any
   // permission-set rules. Check these as strictly as newly authored grants.
   const effectiveSources=(state:Snapshot,u:Snapshot['users'][number])=>{
    const sources=new Set<string>(u.permissionSetIds);
    if(u.profileId){
     sources.add('profile:'+u.profileId);
     for(const id of state.profiles.find(p=>p.id===u.profileId)?.inheritedPermissionSetIds??[])sources.add(id);
    }
    for(const groupId of u.permissionSetGroupIds)
     for(const id of state.permissionSetGroups.find(g=>g.id===groupId)?.permissionSetIds??[])sources.add(id);
    if(u.roleId)for(const link of roleLinks.rows)if(link.role_id===u.roleId)sources.add(link.permission_set_id);
    return sources;
   };
   for(const user of next.users){
    const oldUser=previous.users.find(u=>u.id===user.id)!;
    const before=effectiveSources(previous,oldUser);
    for(const id of effectiveSources(next,user)){
     if(before.has(id))continue;
     const p=id.startsWith('profile:')?
      next.profiles.find(p=>'profile:'+p.id===id):
      next.permissionSets.find(p=>p.id===id);
     if(!p)throw Error('Unknown tenant policy reference');
     for(const rule of grantRules(p).filter(r=>r.effect==='allow'))
      await currentRbac.require(tenant,actor,rule.resource,rule.action);
    }
   }
   for(const r of newAllows)await currentRbac.require(tenant,actor,r.resource,r.action);
   // Capture the actor's complete finite permission boundary, plus changed wildcard probes.
   // This catches indirect escalation through profiles, groups, hierarchy and removal of denies.
   await tx.query('CREATE TEMP TABLE md_rbac_actor_before(resource text,action text,allowed boolean,PRIMARY KEY(resource,action)) ON COMMIT DROP');
   await tx.query("INSERT INTO md_rbac_actor_before SELECT DISTINCT resource,action,md_rbac_allowed($1,$2,resource,action) FROM (SELECT resource,action FROM md_permission_rules WHERE tenant_id=$1 UNION SELECT api_name,a FROM md_object_definitions CROSS JOIN unnest(ARRAY['read','create','edit','delete','viewAll','modifyAll']) a WHERE tenant_id=$1 UNION SELECT object_api||'.'||api_name,a FROM md_field_definitions CROSS JOIN unnest(ARRAY['read','create','edit','delete']) a WHERE tenant_id=$1 UNION SELECT 'RecordType:'||object_api||'.'||record_type_id,'read' FROM md_object_record_types WHERE tenant_id=$1 UNION SELECT 'App:'||api_name,'read' FROM md_tenant_app_metadata WHERE tenant_id=$1 UNION SELECT 'Tab:'||api_name,'read' FROM md_object_definitions WHERE tenant_id=$1 UNION SELECT 'Flow:'||api_name,'execute' FROM md_flow_definitions WHERE tenant_id=$1) checks",
    [tenant,actor]);
   for(const r of newAllows)await tx.query('INSERT INTO md_rbac_actor_before VALUES($3,$4,md_rbac_allowed($1,$2,$3,$4)) ON CONFLICT DO NOTHING',
    [tenant,actor,r.resource,r.action]);
   await tx.query("CREATE TEMP TABLE md_rbac_records_before ON COMMIT DROP AS SELECT id,object_api,(md_rbac_allowed($1,$2,object_api,'modifyAll') OR md_rbac_allowed($1,$2,'Record','viewAll')) AS can_restore,md_record_access($1,$2,id,'read') AS can_read,md_record_access($1,$2,id,'edit') AS can_edit,md_record_access($1,$2,id,'delete') AS can_delete FROM md_records WHERE tenant_id=$1",
    [tenant,actor]);
   // Preserve additional legacy role assignments when the primary role was not edited.
   await writeRbac(tx,tenant,next,previous);
   const escalated=await tx.query<{escalated:boolean}>("SELECT EXISTS(SELECT 1 FROM md_rbac_actor_before WHERE NOT allowed AND md_rbac_allowed($1,$2,resource,action)) OR EXISTS(SELECT 1 FROM md_rbac_records_before WHERE NOT can_restore AND ((NOT can_read AND md_record_access($1,$2,id,'read')) OR (NOT can_edit AND md_record_access($1,$2,id,'edit')) OR (NOT can_delete AND md_record_access($1,$2,id,'delete')))) AS escalated",[tenant,actor]);
   if(escalated.rows[0]?.escalated)throw Error('Cannot escalate own effective permissions');
   await currentRbac.require(tenant,actor,'Security','manage');
   await currentRbac.require(tenant,actor,'Security','read');
   await tx.query('INSERT INTO md_rbac_revisions(tenant_id,revision) VALUES($1,1) ON CONFLICT(tenant_id) DO UPDATE SET revision=md_rbac_revisions.revision+1',[tenant]);
   await tx.query("INSERT INTO md_security_events(tenant_id,actor_user_id,action) VALUES($1,$2,'rbac.policies.update')",[tenant,actor]);
   return readRbac(tx,tenant);
 }
}

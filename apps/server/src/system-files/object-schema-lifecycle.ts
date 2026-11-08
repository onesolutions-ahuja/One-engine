import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';

/**
 * Recoverable object definitions: metadata and records remain intact. A delete
 * is refused while the object has inbound relationships,
 * or a known declarative consumer. Existing records are preserved, hidden while
 * the object is deleted, and recovered with their original IDs on restore.
 * Never cascade foreign keys or drop tables.
 */
type ObjectRow={api_name:string;label:string;is_system:boolean;deleted_at:Date|null};
type Blocker={kind:string;count:number};
type QueryClient=Pick<PoolClient,'query'>;

const checks=[
  {kind:'Inbound relationships',sql:`SELECT count(*)::int AS count FROM md_field_definitions WHERE tenant_id=$1 AND related_object=$2 AND object_api<>$2 AND deleted_at IS NULL`},
  {kind:'Custom record pages',sql:`SELECT count(*)::int AS count FROM md_lightning_page_details d JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id WHERE d.tenant_id=$1 AND d.target_object=$2 AND p.api_name NOT IN ('Record_'||substr(md5($1::text||':'||$2),1,20)||'_View','Record_'||substr(md5($1::text||':'||$2),1,20)||'_Edit')`},
  {kind:'App navigation',sql:`SELECT count(*)::int AS count FROM md_tenant_app_navigation WHERE tenant_id=$1 AND entry_type='Object' AND api_name=$2`},
  {kind:'Flow triggers',sql:`SELECT count(*)::int AS count FROM md_flow_trigger_subscriptions WHERE tenant_id=$1 AND trigger_key=$2`},
  {kind:'Metadata packages',sql:`SELECT count(*)::int AS count FROM md_metadata_package_components WHERE tenant_id=$1 AND component_type='object' AND component_api=$2 AND component_state<>'Disabled'`},
  {kind:'Cross-object quick actions',sql:`SELECT count(*)::int AS count FROM md_object_actions WHERE tenant_id=$1 AND target_object_api=$2 AND object_api<>$2`},
  {kind:'Installed application objects',sql:`SELECT count(*)::int AS count FROM md_app_package_resources r JOIN md_tenant_app_installed_versions i ON i.app_id=r.app_id AND i.version=r.version WHERE i.tenant_id=$1 AND r.resource_type='Object' AND r.api_name=$2`}
] as const;

async function blockers(client:QueryClient,tenantId:string,apiName:string):Promise<Blocker[]>{
 const found:Blocker[]=[];
 for(const check of checks){
  const {rows}=await client.query<{count:number}>(check.sql,[tenantId,apiName]);
  const count=Number(rows[0]?.count??0);
  if(count>0)found.push({kind:check.kind,count});
 }
 return found;
}

export class ObjectSchemaLifecycle {
 constructor(private readonly db:SqlPersistence){}
 async impact(tenantId:string,apiName:string){
  const {rows}=await this.db.query<ObjectRow>(
   'SELECT api_name,label,is_system,deleted_at FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',
   [tenantId,apiName]);
  const object=rows[0];
  if(!object)throw new Error('Object not found');
  const records=await this.db.query<{count:number}>(
   'SELECT count(*)::int AS count FROM md_records WHERE tenant_id=$1 AND object_api=$2',
   [tenantId,apiName]);
  return {apiName:object.api_name,label:object.label,isSystem:object.is_system,
   deleted:object.deleted_at!==null,blockers:await blockers(this.db,tenantId,apiName),
   recordCount:Number((await this.db.query<{count:number}>(
     'SELECT count(*)::int AS count FROM md_records WHERE tenant_id=$1 AND object_api=$2',
     [tenantId,apiName])).rows[0]?.count??0)};
 }
 async listDeleted(tenantId:string){
  const {rows}=await this.db.query<{api_name:string;label:string;deleted_at:Date}>(
   `SELECT api_name,label,deleted_at FROM md_object_definitions
    WHERE tenant_id=$1 AND deleted_at IS NOT NULL AND is_system=false ORDER BY deleted_at DESC,api_name`,
   [tenantId]);
  return rows.map(row=>({apiName:row.api_name,label:row.label,deletedAt:row.deleted_at}));
 }
 async delete(tenantId:string,apiName:string,expectedRevision:number){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
   throw new Error('Invalid object revision precondition');
  return this.db.transaction(async client=>{
   // Serialize with Record Engine's create/update shared advisory lock so
   // records cannot be written after an object becomes inactive.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
     [tenantId+':'+apiName]);
   const {rows}=await client.query<ObjectRow>(
    'SELECT api_name,label,is_system,deleted_at FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE',
    [tenantId,apiName]);
   const object=rows[0];
   if(!object||object.deleted_at!==null)throw new Error('Object not found');
   if(object.is_system)throw new Error('Standard objects cannot be deleted');
   const revisions=await client.query<{revision:number}>(
    'SELECT revision FROM md_object_layout_versions WHERE tenant_id=$1 AND object_api=$2 FOR UPDATE',
    [tenantId,apiName]);
   if((revisions.rows[0]?.revision??0)!==expectedRevision)
    throw new Error('Object revision conflict');
   const dependencies=await blockers(client,tenantId,apiName);
   if(dependencies.length)throw new Error(
    'Object deletion blocked: '+dependencies.map(item=>item.kind+' ('+item.count+')').join(', '));
   await client.query(`INSERT INTO md_object_lifecycle_page_states
    (tenant_id,object_api,page_id,enabled)
    SELECT p.tenant_id,$2,p.id,p.enabled FROM md_page_definitions p
    JOIN md_lightning_page_details d ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.tenant_id=$1 AND d.target_object=$2 AND p.api_name IN
      ('Record_'||substr(md5($1::text||':'||$2),1,20)||'_View',
       'Record_'||substr(md5($1::text||':'||$2),1,20)||'_Edit')
    ON CONFLICT (tenant_id,object_api,page_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
    [tenantId,apiName]);
   await client.query(`UPDATE md_page_definitions p SET enabled=false
    FROM md_object_lifecycle_page_states s
    WHERE s.tenant_id=$1 AND s.object_api=$2 AND p.tenant_id=s.tenant_id AND p.id=s.page_id`,
    [tenantId,apiName]);
   await client.query(
    'UPDATE md_object_definitions SET deleted_at=now() WHERE tenant_id=$1 AND api_name=$2 AND deleted_at IS NULL',
    [tenantId,apiName]);
   return {apiName,deleted:true};
  });
 }
 async restore(tenantId:string,apiName:string){
  return this.db.transaction(async client=>{
   const {rows}=await client.query<ObjectRow>(
    'SELECT api_name,label,is_system,deleted_at FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE',
    [tenantId,apiName]);
   const object=rows[0];
   if(!object||object.deleted_at===null)throw new Error('Deleted object not found');
   if(object.is_system)throw new Error('Standard objects cannot be restored');
   // The unique (tenant_id, api_name) index reserves names while deleted.
   // Restore never rebuilds metadata or changes the stable object identity.
   await client.query(
    'UPDATE md_object_definitions SET deleted_at=NULL WHERE tenant_id=$1 AND api_name=$2',
    [tenantId,apiName]);
   await client.query(`UPDATE md_page_definitions p SET enabled=s.enabled
    FROM md_object_lifecycle_page_states s
    WHERE s.tenant_id=$1 AND s.object_api=$2 AND p.tenant_id=s.tenant_id AND p.id=s.page_id`,
    [tenantId,apiName]);
   await client.query('DELETE FROM md_object_lifecycle_page_states WHERE tenant_id=$1 AND object_api=$2',
    [tenantId,apiName]);
   return {apiName,restored:true};
  });
 }
}

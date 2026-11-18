import type {PoolClient} from 'pg';
import type {SqlPersistence} from './sql-persistence.js';

/**
 * Recoverable object definitions: metadata and records remain intact. A delete
 * is refused while the object has inbound relationships,
 * or a known live declarative consumer. Existing records are preserved, hidden while
 * the object is deleted, and recovered with their original IDs on restore.
 * A soft delete never cascades foreign keys or drops tables; only an explicit,
 * confirmed permanent delete (purge) of an Object already in the Deleted bin does.
 *
 * Three kinds of Object: System Objects (is_system: the platform's own Objects such as
 * User, NamedDevice, IncomingWebhook) can never be deleted, purged or turned into an
 * ordinary Object, enforced by a database trigger; Standard Objects (is_standard: the
 * shared Core business catalogue) and Custom Objects (tenant-made) can be deleted.
 */
type ObjectRow={api_name:string;label:string;is_system:boolean;deleted_at:Date|null};
type Blocker={kind:string;count:number};
type QueryClient=Pick<PoolClient,'query'>;

/** Idempotent: the Standard Object flag and the System Object guard. */
export const OBJECT_KIND_DDL=`
ALTER TABLE md_object_definitions ADD COLUMN IF NOT EXISTS is_standard boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION md_protect_system_objects() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.is_system THEN
   RAISE EXCEPTION 'System Object % can never be deleted',OLD.api_name USING ERRCODE='check_violation';
  END IF;
  RETURN OLD;
 END IF;
 IF OLD.is_system AND (NEW.is_system IS DISTINCT FROM true OR NEW.deleted_at IS NOT NULL
   OR NEW.api_name IS DISTINCT FROM OLD.api_name OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
  RAISE EXCEPTION 'System Object % can never be deleted, renamed or made an ordinary Object',OLD.api_name
   USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $guard$;
DROP TRIGGER IF EXISTS md_protect_system_objects ON md_object_definitions;
CREATE TRIGGER md_protect_system_objects BEFORE UPDATE OR DELETE ON md_object_definitions
 FOR EACH ROW EXECUTE FUNCTION md_protect_system_objects();
`;

const checks=[
  {kind:'Inbound relationships',sql:`SELECT count(*)::int AS count FROM md_field_definitions WHERE tenant_id=$1 AND related_object=$2 AND object_api<>$2 AND deleted_at IS NULL`},
  // Only live consumers block: a disabled page (e.g. left by a retired app) or a trigger of an
  // inactive/archived Flow no longer runs, so it cannot break when the Object goes.
  {kind:'Custom record pages',sql:`SELECT count(*)::int AS count FROM md_lightning_page_details d JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id WHERE d.tenant_id=$1 AND d.target_object=$2 AND p.enabled=true AND p.api_name NOT IN ('Record_'||substr(md5($1::text||':'||$2),1,20)||'_View','Record_'||substr(md5($1::text||':'||$2),1,20)||'_Edit')`},
  {kind:'App navigation',sql:`SELECT count(*)::int AS count FROM md_tenant_app_navigation WHERE tenant_id=$1 AND entry_type='Object' AND api_name=$2`},
  {kind:'Flow triggers',sql:`SELECT count(*)::int AS count FROM md_flow_trigger_subscriptions s JOIN md_flow_definitions f ON f.tenant_id=s.tenant_id AND f.id=s.flow_id WHERE s.tenant_id=$1 AND s.trigger_key=$2 AND s.active=true AND f.active=true AND f.archived=false`},
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


/** Tables a permanent delete must never remove rows from: if a purge reaches one,
 * something else depends on the data and the whole purge is rolled back. */
const PURGE_STOP_TABLES=new Set(['md_tenants','md_users','md_apps','md_permission_sets','md_profiles',
 'md_roles','md_object_definitions','md_system_migrations']);
const identifier=/^[a-z_][a-z0-9_]*$/;
const quoteTable=(name:string)=>{
 const parts=name.replace(/"/g,'').split('.');
 if(!parts.length||parts.length>2||parts.some(part=>!identifier.test(part)))throw new Error('Invalid table for permanent delete');
 return parts.map(part=>'"'+part+'"').join('.');
};
const columnList=(names:string[])=>{
 if(!names.length||names.some(name=>!identifier.test(name)))throw new Error('Invalid key for permanent delete');
 return names.map(name=>'"'+name+'"').join(',');
};
/** A row value on the left of IN: (a,b). The select list of the subquery stays a plain list. */
const columns=(names:string[])=>'('+columnList(names)+')';
type ForeignKey={child:string;child_cols:string[];parent_cols:string[]};
async function foreignKeysTo(client:QueryClient,table:string):Promise<ForeignKey[]>{
 const {rows}=await client.query<ForeignKey>(`SELECT con.conrelid::regclass::text AS child,
   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord)
     JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS child_cols,
   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum,ord)
     JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.attnum) AS parent_cols
  FROM pg_constraint con WHERE con.contype='f' AND con.confrelid=to_regclass($1)
  ORDER BY 1,2`,[table]);
 return rows;
}
/** Delete the rows of `table` matched by `where` and, first, every row that references them
 * through a foreign key (depth-first). Stops (throws) instead of touching PURGE_STOP_TABLES. */
export async function purgeRows(client:QueryClient,table:string,where:string,params:unknown[],depth=0):Promise<number>{
 if(depth>8)throw new Error('Permanent delete stopped: dependency chain too deep at '+table);
 const name=table.replace(/^.*\./,'').replace(/"/g,'');
 const quoted=quoteTable(table);
 if(depth>0&&PURGE_STOP_TABLES.has(name)){
  const {rowCount}=await client.query(`SELECT 1 FROM ${quoted} WHERE ${where} LIMIT 1`,params);
  if(rowCount)throw new Error('Permanent delete stopped: '+name+' still uses this data');
  return 0;
 }
 for(const key of await foreignKeysTo(client,table)){
  if(key.child===table)continue; // self references go in the same DELETE statement
  await purgeRows(client,key.child,`${columns(key.child_cols)} IN (SELECT ${columnList(key.parent_cols)} FROM ${quoted} WHERE ${where})`,params,depth+1);
 }
 const result=await client.query(`DELETE FROM ${quoted} WHERE ${where}`,params);
 return result.rowCount??0;
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
   if(object.is_system)throw new Error('System Objects can never be deleted');
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
   if(object.is_system)throw new Error('System Objects can never be deleted or restored');
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

 /** Permanent delete of an Object already in the Deleted bin: its records, fields, layouts,
  * record pages, native table and definition are removed in one transaction (all or nothing).
  * Never a System Object; refused while a live Object, Flow, app or package still uses it.
  * The caller must pass the API name again as confirmation. */
 async purge(tenantId:string,apiName:string,confirmation:string){
  if(confirmation!==apiName)throw new Error('Type the Object API name to confirm the permanent delete');
  return this.db.transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenantId+':'+apiName]);
   const {rows}=await client.query<ObjectRow>(
    'SELECT api_name,label,is_system,deleted_at FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 FOR UPDATE',
    [tenantId,apiName]);
   const object=rows[0];
   if(!object)throw new Error('Object not found');
   if(object.is_system)throw new Error('System Objects can never be deleted');
   if(object.deleted_at===null)throw new Error('Delete the Object first; only Objects in the Deleted bin can be deleted permanently');
   // Its own record pages and the triggers of dead Flows go with it; any live consumer blocks.
   const live=(await blockers(client,tenantId,apiName)).filter(item=>item.kind!=='Custom record pages');
   if(live.length)throw new Error('Permanent delete blocked: '+live.map(item=>item.kind+' ('+item.count+')').join(', '));
   const native=await client.query<{table_name:string}>(
    'SELECT table_name FROM md_native_objects WHERE tenant_id=$1 AND object_api=$2',[tenantId,apiName]);
   const table=native.rows[0]?.table_name;
   if(table&&!/^md_object_[a-f0-9]{32}$/.test(table))throw new Error('Invalid native table');
   if(table)await purgeRows(client,'"'+table+'"','tenant_id=$1',[tenantId],1);
   const records=await purgeRows(client,'md_records','tenant_id=$1 AND object_api=$2',[tenantId,apiName]);
   // Ids first: the dependency walk removes the page details these pages are found by.
   const pages=(await client.query<{page_id:string}>(`SELECT page_id FROM md_lightning_page_details
    WHERE tenant_id=$1 AND target_object=$2`,[tenantId,apiName])).rows.map(row=>row.page_id);
   if(pages.length)await purgeRows(client,'md_page_definitions','tenant_id=$1 AND id=ANY($2::uuid[])',[tenantId,pages]);
   await client.query('DELETE FROM md_flow_trigger_subscriptions WHERE tenant_id=$1 AND trigger_key=$2',[tenantId,apiName]);
   await client.query('DELETE FROM md_object_lifecycle_page_states WHERE tenant_id=$1 AND object_api=$2',[tenantId,apiName]);
   await client.query(`DELETE FROM md_permission_rules WHERE tenant_id=$1 AND (resource=$2 OR resource LIKE $3)`,
    [tenantId,apiName,apiName.replace(/[\\%_]/g,'\\$&')+'.%']);
   // Lookups of other Objects that were already deleted keep no link to an Object that is gone.
   await client.query(`UPDATE md_field_definitions SET related_object=NULL
    WHERE tenant_id=$1 AND related_object=$2 AND object_api<>$2 AND deleted_at IS NOT NULL`,[tenantId,apiName]);
   // Everything else that hangs off the Object definition (fields, layouts, settings...).
   for(const key of await foreignKeysTo(client,'md_object_definitions')){
    await purgeRows(client,key.child,`${columns(key.child_cols)} IN (SELECT ${columnList(key.parent_cols)}
     FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2)`,[tenantId,apiName],1);
   }
   await client.query('DELETE FROM md_native_fields WHERE tenant_id=$1 AND object_api=$2',[tenantId,apiName]);
   await client.query('DELETE FROM md_native_objects WHERE tenant_id=$1 AND object_api=$2',[tenantId,apiName]);
   const removed=await client.query('DELETE FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND is_system=false AND deleted_at IS NOT NULL',
    [tenantId,apiName]);
   if(removed.rowCount!==1)throw new Error('Object could not be deleted permanently');
   if(table){
    const shared=await client.query('SELECT 1 FROM md_native_objects WHERE table_name=$1 LIMIT 1',[table]);
    if(!shared.rowCount)await client.query('DROP TABLE IF EXISTS "'+table+'"');
   }
   return {apiName,purged:true,records};
  });
 }

}

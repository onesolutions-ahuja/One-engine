import type {PoolClient} from 'pg';
import {recordReadScope,scopedMetadata} from '../system-support/record-read-scope.js';
import {NATIVE_FIELDS_SQL,nativeFieldsFromRows,type NativeFieldsMetadata} from './native-object-query.js';

/**
 * Object save setup: every per-Object setup read that a record save needs, written once.
 * Each read can run on its own (remembered for the page action / save scope), or all of
 * them run in ONE round trip right after the save takes its Object write lock
 * (primeObjectSaveSetup). Record data is never part of it. All queries take
 * $1 = tenant id and $2 = Object API name.
 */
export const OBJECT_FIELDS_SQL=`SELECT md_field_definitions.api_name,md_field_definitions.label,md_field_definitions.data_type,related_object,relationship_type,allow_reparenting,required,max_length,precision,scale,is_unique,external_id,
       nf.column_name AS native_column,nf.sql_type AS native_type,no.table_name AS native_table,
       formula_expression,formula_return_type,g.value_set_api AS global_value_set_api,
       EXISTS(SELECT 1 FROM md_metadata_package_components c
         WHERE c.tenant_id=md_field_definitions.tenant_id AND c.component_type='object'
          AND c.component_api=md_field_definitions.object_api AND c.component_state='Retained')
         AS package_object_retained,
        case_sensitive,default_value,auto_number_format,picklist_restricted,
        rollup_child_object,rollup_relationship_field,rollup_operation,rollup_source_field,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=md_field_definitions.tenant_id
           AND s.object_api=md_field_definitions.rollup_child_object
           AND s.api_name=md_field_definitions.rollup_source_field AND s.deleted_at IS NULL)
          AS rollup_source_data_type,
        (SELECT d.controller_field_api FROM md_field_dependencies d
         WHERE d.tenant_id=md_field_definitions.tenant_id AND d.object_api=md_field_definitions.object_api
           AND d.field_api=md_field_definitions.api_name) AS controller_field_api_name,
        EXISTS(SELECT 1 FROM md_field_exact_indexes x
         WHERE x.tenant_id=md_field_definitions.tenant_id AND x.object_api=md_field_definitions.object_api
           AND x.field_api=md_field_definitions.api_name AND x.enabled) AS exact_indexed
       FROM md_field_definitions LEFT JOIN md_field_global_value_sets g
         ON g.tenant_id=md_field_definitions.tenant_id AND g.object_api=md_field_definitions.object_api
          AND g.field_api=md_field_definitions.api_name
       LEFT JOIN md_native_objects no ON no.tenant_id=md_field_definitions.tenant_id AND no.object_api=md_field_definitions.object_api
       LEFT JOIN md_native_fields nf ON nf.tenant_id=md_field_definitions.tenant_id AND nf.object_api=md_field_definitions.object_api AND nf.field_api=md_field_definitions.api_name
       WHERE md_field_definitions.tenant_id=$1 AND md_field_definitions.object_api=$2
         AND md_field_definitions.deleted_at IS NULL`;
export const OBJECT_RETAINED_SQL=`SELECT EXISTS(
        SELECT 1 FROM md_metadata_package_components
        WHERE tenant_id=$1 AND component_type='object' AND component_api=$2
          AND component_state='Retained') AS retained`;
/** Field rows checked the same way wherever they come from. */
export function checkedFieldRows<T extends {package_object_retained?:boolean}>(
  objectApi:string,rows:T[],retained:boolean|undefined):T[]{
  if(rows[0]?.package_object_retained)throw Error('Metadata package component is uninstalled: '+objectApi);
  if(!rows.length&&retained)throw Error('Metadata package component is uninstalled: '+objectApi);
  return rows;
}

const SETUP_SQL={
  'lookup-filters':`SELECT l.field_api,f.related_object,l.related_field_api,l.operator,l.value_text,l.value_field_api
      FROM md_object_lookup_filters l JOIN md_field_definitions f
        ON f.tenant_id=l.tenant_id AND f.object_api=l.object_api AND f.api_name=l.field_api
      WHERE l.tenant_id=$1 AND l.object_api=$2 AND l.required=true
        AND f.data_type='reference' AND f.deleted_at IS NULL
      ORDER BY l.field_api,l.sort_order`,
  'lookup-filter-logic':'SELECT field_api,logic FROM md_object_lookup_filter_logic WHERE tenant_id=$1 AND object_api=$2',
  'default-record-type':'SELECT record_type_id FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2 AND active=true AND is_default=true ORDER BY sort_order LIMIT 1',
  'active-record-types':'SELECT record_type_id FROM md_object_record_types WHERE tenant_id=$1 AND object_api=$2 AND active=true',
  'auto-number-fields':`SELECT f.api_name,f.auto_number_format,f.is_unique,f.external_id,f.case_sensitive,f.auto_number_scope_field,
        s.label AS scope_label FROM md_field_definitions f
       LEFT JOIN md_field_definitions s ON s.tenant_id=f.tenant_id AND s.object_api=f.object_api
        AND s.api_name=f.auto_number_scope_field AND s.deleted_at IS NULL
       WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.data_type='autonumber' AND f.deleted_at IS NULL`,
  'rollup-fields':`SELECT f.api_name,f.rollup_operation AS operation,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=f.tenant_id AND s.object_api=f.rollup_child_object
           AND s.api_name=f.rollup_source_field AND s.deleted_at IS NULL) AS source_data_type
       FROM md_field_definitions f
       WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.data_type='rollup' AND f.deleted_at IS NULL`,
  'related-formula-rollups':`SELECT r.object_api AS parent,r.rollup_child_object AS child,r.rollup_relationship_field AS parent_field,l.api_name AS lookup
    FROM md_field_definitions l JOIN md_field_definitions f ON f.tenant_id=l.tenant_id AND f.object_api=l.object_api
    JOIN md_field_definitions r ON r.tenant_id=f.tenant_id AND r.rollup_child_object=f.object_api AND r.rollup_source_field=f.api_name
    WHERE l.tenant_id=$1 AND l.related_object=$2 AND l.data_type='reference' AND f.data_type='formula' AND r.data_type='rollup'
    AND strpos(f.formula_expression,'$Record.'||l.api_name||'.')>0 AND l.deleted_at IS NULL AND f.deleted_at IS NULL AND r.deleted_at IS NULL`,
  'rollup-parents':`SELECT object_api AS parent_object,rollup_relationship_field AS relationship_field
      FROM md_field_definitions WHERE tenant_id=$1 AND data_type='rollup'
        AND rollup_child_object=$2 AND deleted_at IS NULL`,
  'rollups':`SELECT object_api AS parent_object,api_name AS field_api,
        rollup_relationship_field AS relationship_field,rollup_operation AS operation,
        rollup_source_field AS source_field,rollup_filter_logic AS filter_logic,
        (SELECT s.data_type FROM md_field_definitions s
         WHERE s.tenant_id=md_field_definitions.tenant_id
           AND s.object_api=md_field_definitions.rollup_child_object
           AND s.api_name=md_field_definitions.rollup_source_field AND s.deleted_at IS NULL)
          AS source_data_type
      FROM md_field_definitions WHERE tenant_id=$1 AND data_type='rollup'
        AND rollup_child_object=$2 AND deleted_at IS NULL`,
  'validation-rules':`SELECT api_name,expression,error_message,error_field_api FROM md_validation_rules
       WHERE tenant_id=$1 AND object_api=$2 AND active=true ORDER BY sort_order,api_name`,
  'matching-rules':'SELECT api_name,match_mode,action,target_object_api FROM md_matching_rules WHERE tenant_id=$1 AND object_api=$2 AND active=true ORDER BY api_name',
  'default-formulas':`SELECT d.field_api,d.expression FROM md_field_default_formulas d
       JOIN md_field_definitions f ON f.tenant_id=d.tenant_id AND f.object_api=d.object_api
        AND f.api_name=d.field_api AND f.deleted_at IS NULL
       WHERE d.tenant_id=$1 AND d.object_api=$2 ORDER BY d.field_api`,
  'prevent-delete':'SELECT label FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND prevent_delete=true',
  // Fields whose changes are written to field history (same rule as the history insert).
  'history-fields':`SELECT f.api_name FROM md_field_definitions f JOIN md_object_manager_settings settings
       ON settings.tenant_id=f.tenant_id AND settings.object_api=f.object_api
       WHERE f.tenant_id=$1 AND f.object_api=$2 AND f.track_history=true
         AND settings.track_field_history=true AND f.data_type<>'encryptedtext' AND f.deleted_at IS NULL`,
} as const;
export type ObjectSetupName=keyof typeof SETUP_SQL;
type Executor={query:(sql:string,params:unknown[])=>Promise<{rows:unknown[]}>};
const setupKey=(name:string,tenantId:string,objectApi:string)=>name+'\u0000'+tenantId+'\u0000'+objectApi;
/** Cache key of an Object's field definitions in the scope (kept as before). */
export const fieldsKey=(tenantId:string,objectApi:string)=>tenantId+'\u0000'+objectApi;

/** One setup read for one Object, remembered in the page action / save scope. */
export function objectSetup<T>(executor:Executor,name:ObjectSetupName,tenantId:string,objectApi:string)
  :Promise<{rows:T[]}>{
  return scopedMetadata(setupKey(name,tenantId,objectApi),
    ()=>executor.query(SETUP_SQL[name],[tenantId,objectApi]) as Promise<{rows:T[]}>);
}
/** The Object's native table and columns, remembered in the scope (setup, not record data). */
export function objectNativeFields(executor:Executor,tenantId:string,objectApi:string):Promise<NativeFieldsMetadata>{
  return scopedMetadata(setupKey('native-fields',tenantId,objectApi),async()=>
    nativeFieldsFromRows((await executor.query(NATIVE_FIELDS_SQL,[tenantId,objectApi])).rows));
}

const agg=(sql:string)=>`(SELECT COALESCE(json_agg(q),'[]'::json) FROM (${sql}) q)`;
const PRIME_SQL='SELECT '+[
  agg(OBJECT_FIELDS_SQL)+' AS "fields"',
  '('+OBJECT_RETAINED_SQL+') AS "retained"',
  agg(NATIVE_FIELDS_SQL)+' AS "native-fields"',
  ...Object.entries(SETUP_SQL).map(([name,sql])=>agg(sql)+' AS "'+name+'"'),
].join(',\n');

/**
 * Read all of one Object's save setup in ONE round trip and keep it for the rest of the
 * scope (one page action, or one save). Called right after the save takes its Object
 * write lock, so it sees setup committed by anything that held the lock before.
 * Outside a scope it does nothing (each read then runs on its own, as before).
 */
/** Prime the Object's save setup if this scope has not read it yet (one trip, or none). */
export async function ensureObjectSaveSetup(executor:Executor,tenantId:string,objectApi:string):Promise<void>{
  const scope=recordReadScope();
  if(!scope||scope.fields.has(setupKey('matching-rules',tenantId,objectApi)))return;
  await primeObjectSaveSetup(executor,tenantId,objectApi);
}
export async function primeObjectSaveSetup(client:Executor,tenantId:string,objectApi:string):Promise<void>{
  const scope=recordReadScope();
  if(!scope)return;
  const {rows}=await client.query(PRIME_SQL,[tenantId,objectApi]) as {rows:Array<Record<string,unknown>>};
  const row=rows[0];
  if(!row)return;
  const seed=(key:string,value:unknown)=>scope.fields.set(key,Promise.resolve(value));
  for(const name of Object.keys(SETUP_SQL)){
    const list=row[name] as unknown[];
    seed(setupKey(name,tenantId,objectApi),{rows:list,rowCount:list.length});
  }
  // Field definitions: only when they pass the same checks as a direct read.
  try{
    seed(fieldsKey(tenantId,objectApi),
      checkedFieldRows(objectApi,row.fields as Array<{package_object_retained?:boolean}>,row.retained===true));
  }catch{scope.fields.delete(fieldsKey(tenantId,objectApi));}
  // Native table: only when present and valid (otherwise the direct read raises its error).
  try{seed(setupKey('native-fields',tenantId,objectApi),nativeFieldsFromRows(row['native-fields'] as unknown[]));}
  catch{scope.fields.delete(setupKey('native-fields',tenantId,objectApi));}
}

/**
 * Object write lock in ONE round trip (was three: check rules, lock, check again).
 * An Object with active matching rules is written one save at a time (exclusive lock);
 * other Objects share the lock with each other and only wait for setup changes.
 * Each statement inside the function sees the latest committed data, so a rule
 * activated while waiting for the shared lock is still caught, exactly as before.
 */
export const OBJECT_WRITE_LOCK_DDL=`CREATE OR REPLACE FUNCTION md_lock_object_for_write(lock_key text,t uuid,object_name text)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $lock$
BEGIN
 IF EXISTS(SELECT 1 FROM md_matching_rules WHERE tenant_id=t AND object_api=object_name AND active=true) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
  RETURN true;
 END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(lock_key,0));
 IF EXISTS(SELECT 1 FROM md_matching_rules WHERE tenant_id=t AND object_api=object_name AND active=true) THEN
  RAISE EXCEPTION 'Matching rule configuration changed; retry record save';
 END IF;
 RETURN false;
END $lock$`;

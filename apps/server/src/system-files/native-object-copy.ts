import {createHash} from 'node:crypto';
import type {SqlPersistence} from './sql-persistence.js';

/** Offline, verified COPY stage only. Never select this snapshot for runtime CRUD:
 * it is not kept current after commit. Cutover requires all EAV consumers first.
 * No startup hook: an operator explicitly runs this against a chosen tenant/object.
 */
export type NativeField={api_name:string;data_type:string;standard:boolean;
  rollup_source_data_type?:string|null};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32);
export const nativeTableName=(objectApi:string)=>'md_object_'+digest(objectApi);
const ident=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const textTypes=new Set(['text','textarea','longtext','richtext','encryptedtext','email',
  'phone','url','image','file','picklist','multipicklist','autonumber','time']);

export function nativeFieldType(field:NativeField):string {
  const type=field.data_type==='rollup'?(field.rollup_source_data_type??'number'):field.data_type;
  if(textTypes.has(type))return 'text';
  if(['number','currency','percent'].includes(type))return 'numeric';
  if(type==='boolean')return 'boolean';
  if(type==='reference')return 'uuid';
  if(type==='date')return 'date';
  if(type==='datetime')return 'timestamptz';
  if(type==='geolocation')return 'double precision[]';
  if(type==='address')return 'text[]';
  // Do not silently copy a newly introduced type as text or drop its values.
  throw Error('Native copy does not support field type: '+field.data_type);
}
export const nativeColumnName=(field:NativeField)=>
  'f_'+digest(field.api_name+':'+nativeFieldType(field));

function valueSql(field:NativeField):string {
  const type=nativeFieldType(field);
  if(type==='double precision[]')return 'to_jsonb(ARRAY[v.geo_latitude,v.geo_longitude]::double precision[])';
  if(type==='text[]')return 'to_jsonb(ARRAY[v.address_street,v.address_city,v.address_state,v.address_postal_code,v.address_country])';
  const text='COALESCE(v.reference_record_id::text,v.value_text)';
  const value=type==='numeric'?`COALESCE(v.value_number,NULLIF(v.value_text,'')::numeric)`
    :type==='boolean'?`COALESCE(v.value_boolean,v.value_text::boolean)`
    :type==='date'?`COALESCE(v.value_date,v.value_text::date)`
    :type==='timestamptz'?`COALESCE(v.value_datetime,v.value_text::timestamptz)`
    :type==='uuid'?`(${text})::uuid`:text;
  return `to_jsonb(${value})`;
}

const systemColumns=['tenant_id','id','created_at','updated_at','owner_id','owner_queue_id',
  'record_type_id','is_clone','is_deleted','deleted_at','deleted_by','deletion_group_id','deletion_root_id'];

/** SQL identifiers are hashed; metadata values are quoted independently of identifiers. */
export function nativeCopyPlan(objectApi:string,fields:readonly NativeField[]) {
  if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(objectApi))throw Error('Invalid object API name');
  if(new Set(fields.map(f=>f.api_name)).size!==fields.length)throw Error('Duplicate field API name');
  const table=nativeTableName(objectApi),qtable=ident(table);
  const stored=fields.filter(f=>f.data_type!=='formula');
  for(const field of stored)nativeFieldType(field);
  const columns=stored.filter(f=>f.standard);
  const custom=stored.filter(f=>!f.standard);
  const cases=stored.map(f=>`WHEN ${literal(f.api_name)} THEN ${valueSql(f)}`).join('\n');
  const source=`SELECT ${systemColumns.map(c=>'r.'+c).join(',')},
    COALESCE(field_values.data,'{}'::jsonb) AS data
    FROM md_records r LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(v.field_api,COALESCE(${cases?`CASE v.field_api ${cases} END`:'NULL::jsonb'},'null'::jsonb)) AS data
      FROM md_record_values v WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.object_api=r.object_api
    ) field_values ON true WHERE r.tenant_id=$1 AND r.object_api=$2`;
  const extract=(f:NativeField)=>{
    const key=literal(f.api_name),type=nativeFieldType(f);
    if(type.endsWith('[]'))return `(CASE WHEN data ? ${key} THEN ARRAY(SELECT jsonb_array_elements_text(data->${key}))::${type} END)`;
    return `(data->>${key})::${type}`;
  };
  const projection=columns.map(f=>`to_jsonb(n.${ident(nativeColumnName(f))})`);
  const rebuilt=columns.map((f,i)=>`CASE WHEN ${literal(f.api_name)}=ANY(n.present_fields)
    THEN jsonb_build_object(${literal(f.api_name)},${projection[i]}) ELSE '{}'::jsonb END`);
  return {table,fields:stored.map(f=>({...f,column:f.standard?nativeColumnName(f):null,sqlType:nativeFieldType(f)})),
    ddl:[`CREATE TABLE IF NOT EXISTS ${qtable} (
      tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL,
      created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
      owner_id uuid,owner_queue_id uuid,record_type_id text,is_clone boolean NOT NULL,
      is_deleted boolean NOT NULL,deleted_at timestamptz,deleted_by uuid,
      deletion_group_id uuid,deletion_root_id uuid,present_fields text[] NOT NULL,
      extras jsonb NOT NULL CHECK(jsonb_typeof(extras)='object'),PRIMARY KEY(tenant_id,id))`,
      ...columns.map(f=>`ALTER TABLE ${qtable} ADD COLUMN IF NOT EXISTS ${ident(nativeColumnName(f))} ${nativeFieldType(f)}`),
      // Unbounded text (images, rich text, etc.) can exceed PostgreSQL's B-tree
      // entry limit. Search text uses GIN; fixed-size scalar fields use B-tree.
      ...columns.filter(f=>!nativeFieldType(f).endsWith('[]')&&nativeFieldType(f)!=='text').map(f=>
        `CREATE INDEX IF NOT EXISTS ${ident('md_obj_'+digest(table+nativeColumnName(f)+'btree'))}
         ON ${qtable}(tenant_id,${ident(nativeColumnName(f))}) WHERE NOT is_deleted`),
      ...stored.filter(f=>/^(Name|Barcode)$/i.test(f.api_name)&&nativeFieldType(f)==='text').map(f=>
        `CREATE INDEX IF NOT EXISTS ${ident('md_obj_'+digest(table+f.api_name+(f.standard?'column':'extras')+'trgm'))}
         ON ${qtable} USING gin (${f.standard?ident(nativeColumnName(f)):`(extras->>${literal(f.api_name)})`} gin_trgm_ops) WHERE NOT is_deleted`)],
    copy:`WITH source AS (${source}) INSERT INTO ${qtable}
      (${systemColumns.map(ident).join(',')},present_fields,extras${columns.map(f=>','+ident(nativeColumnName(f))).join('')})
      SELECT ${systemColumns.map(ident).join(',')},ARRAY(SELECT jsonb_object_keys(data)),
      (SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(data)
        WHERE key=ANY(ARRAY[${custom.map(f=>literal(f.api_name)).join(',')}]::text[]))
      ${columns.map(f=>','+extract(f)).join('')} FROM source`,
    verify:`WITH source AS (${source}),copied AS (
      SELECT ${systemColumns.map(c=>'n.'+ident(c)).join(',')},
        n.extras${rebuilt.map(x=>' || '+x).join('')} AS data FROM ${qtable} n WHERE tenant_id=$1
    ), difference AS ((SELECT * FROM source EXCEPT SELECT * FROM copied)
      UNION ALL (SELECT * FROM copied EXCEPT SELECT * FROM source))
    SELECT (SELECT count(*)::text FROM source) AS source_count,
      (SELECT count(*)::text FROM copied) AS copied_count,
      (SELECT count(*)::text FROM difference) AS differences`
  };
}

/** Copy under database locks: includes deleted records and inactive fields, keeps
 * original EAV tables intact, rolls back the entire copy on any mismatch/error.
 * Lock timeout bounds impact on live traffic. This is an offline operation.
 */
export async function copyNativeObject(db:SqlPersistence,tenantId:string,objectApi:string) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId))
    throw Error('Invalid tenant ID');
  // Validate before opening a transaction or creating anything.
  nativeCopyPlan(objectApi,[]);
  return db.transaction(async client=>{
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query("SET LOCAL standard_conforming_strings=on");
    // Include direct SQL consumers, field changes and package installs, not just
    // RecordEngine's advisory lock. Never upgrade a row lock into this table lock.
    await client.query(`LOCK TABLE md_tenants,md_object_definitions,md_field_definitions,
      md_app_package_resources,md_tenant_app_installed_versions,
      md_records,md_record_values IN SHARE MODE`);
    const object=await client.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[tenantId,objectApi]);
    if(!object.rowCount)throw Error('Object not found');
    const {rows:fields}=await client.query<NativeField>(`SELECT f.api_name,f.data_type,
      (f.api_name='Name' OR EXISTS(SELECT 1 FROM md_app_package_resources p
        JOIN md_tenant_app_installed_versions i ON i.app_id=p.app_id AND i.version=p.version
        WHERE i.tenant_id=f.tenant_id AND p.resource_type='Field'
          AND p.parent_api=f.object_api AND p.api_name=f.api_name)) AS standard,
      CASE WHEN f.rollup_operation='COUNT' THEN 'number' ELSE
        (SELECT s.data_type FROM md_field_definitions s WHERE s.tenant_id=f.tenant_id
          AND s.object_api=f.rollup_child_object AND s.api_name=f.rollup_source_field) END AS rollup_source_data_type
      FROM md_field_definitions f WHERE f.tenant_id=$1 AND f.object_api=$2 ORDER BY f.api_name`,[tenantId,objectApi]);
    // A formula with persisted values or unrecognised metadata must never be
    // silently omitted by the pivot, even on a previously corrupted database.
    const invalid=await client.query(`SELECT 1 FROM md_record_values v
      LEFT JOIN md_field_definitions f ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
      WHERE v.tenant_id=$1 AND v.object_api=$2 AND (f.api_name IS NULL OR f.data_type='formula') LIMIT 1`,[tenantId,objectApi]);
    if(invalid.rowCount)throw Error('Native copy found values without supported stored-field metadata');
    const plan=nativeCopyPlan(objectApi,fields);
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query(`CREATE TABLE IF NOT EXISTS md_native_object_copies (
      tenant_id uuid NOT NULL REFERENCES md_tenants(id),object_api text NOT NULL,
      table_name text NOT NULL,source_count bigint NOT NULL,copied_at timestamptz NOT NULL,
      schema_hash text NOT NULL,status text NOT NULL CHECK(status='snapshot-only'),
      PRIMARY KEY(tenant_id,object_api))`);
    // Serialize DDL across tenants sharing an object's physical table.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['native-copy:'+objectApi]);
    for(const sql of plan.ddl)await client.query(sql);
    await client.query(`DELETE FROM ${ident(plan.table)} WHERE tenant_id=$1`,[tenantId]);
    await client.query(plan.copy,[tenantId,objectApi]);
    const {rows}=await client.query<{source_count:string;copied_count:string;differences:string}>(plan.verify,[tenantId,objectApi]);
    const verification=rows[0];
    if(!verification||verification.source_count!==verification.copied_count||verification.differences!=='0')
      throw Error('Native object copy verification failed; transaction rolled back');
    await client.query(`INSERT INTO md_native_object_copies
      (tenant_id,object_api,table_name,source_count,copied_at,schema_hash,status)
      VALUES($1,$2,$3,$4,clock_timestamp(),$5,'snapshot-only') ON CONFLICT(tenant_id,object_api)
      DO UPDATE SET table_name=EXCLUDED.table_name,source_count=EXCLUDED.source_count,
        copied_at=EXCLUDED.copied_at,schema_hash=EXCLUDED.schema_hash,status=EXCLUDED.status`,
      [tenantId,objectApi,plan.table,verification.source_count,createHash('sha256').update(JSON.stringify(plan.fields)).digest('hex')]);
    return {objectApi,table:plan.table,...verification,status:'snapshot-only' as const};
  });
}

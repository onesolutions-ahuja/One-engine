import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {copyNativeObject} from '../system-files/native-object-copy.js';

/** The EAV write facade remains in place during migration because its constraints
 * and triggers enforce uniqueness, relationship integrity, history and sharing.
 * These synchronous database triggers maintain typed rows in the SAME transaction.
 * No asynchronous mirror, stale snapshot read, or permission bypass is permitted.
 */
export const NATIVE_OBJECT_DDL=String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS md_native_objects(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),object_api text NOT NULL,
 table_name text NOT NULL CHECK(table_name ~ '^md_object_[a-f0-9]{32}$'),
 activated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,object_api));
CREATE TABLE IF NOT EXISTS md_native_fields(
 tenant_id uuid NOT NULL,object_api text NOT NULL,field_api text NOT NULL,
 column_name text CHECK(column_name IS NULL OR column_name ~ '^f_[a-f0-9]{32}$'),
 sql_type text NOT NULL,data_type text NOT NULL,
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_native_objects(tenant_id,object_api));

-- Keep the search index in sync with the native row, including direct native writes.
CREATE OR REPLACE FUNCTION md_native_search_values_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj text; field record; raw_value text; stored jsonb;
BEGIN
 SELECT object_api INTO obj FROM md_native_objects
  WHERE tenant_id=NEW.tenant_id AND table_name=TG_TABLE_NAME;
 IF obj IS NULL THEN RETURN NEW; END IF;
 DELETE FROM md_record_search_values
  WHERE tenant_id=NEW.tenant_id AND record_id=NEW.id AND object_api=obj;
 DELETE FROM md_field_exact_index_entries
  WHERE tenant_id=NEW.tenant_id AND record_id=NEW.id AND object_api=obj;
 IF NEW.is_deleted THEN RETURN NEW; END IF;
 stored:=to_jsonb(NEW);
 FOR field IN
  SELECT n.field_api,n.column_name FROM md_native_fields n
   WHERE n.tenant_id=NEW.tenant_id AND n.object_api=obj
    AND (EXISTS(SELECT 1 FROM md_search_layout_fields sl
      WHERE sl.tenant_id=n.tenant_id AND sl.object_api=n.object_api AND sl.field_api=n.field_api)
      OR EXISTS(SELECT 1 FROM md_field_exact_indexes ex
       WHERE ex.tenant_id=n.tenant_id AND ex.object_api=n.object_api AND ex.field_api=n.field_api AND ex.enabled))
 LOOP
  IF field.field_api=ANY(NEW.present_fields) THEN
   raw_value:=CASE WHEN field.column_name IS NULL THEN NEW.extras->>field.field_api
    ELSE stored->>field.column_name END;
   PERFORM md_refresh_record_search_value(NEW.tenant_id,NEW.id,obj,field.field_api,raw_value);
   PERFORM md_sync_field_exact_entry(NEW.tenant_id,obj,field.field_api,NEW.id,raw_value,false);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

-- Give serial duplicate writes the same public error while the unique index
-- remains the final, concurrency-safe enforcement for simultaneous writers.
CREATE OR REPLACE FUNCTION md_native_unique_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj text; field record; val jsonb; old_val jsonb; value_expr text; duplicate boolean;
BEGIN
 IF NEW.is_deleted THEN RETURN NEW; END IF;
 SELECT object_api INTO obj FROM md_native_objects
  WHERE tenant_id=NEW.tenant_id AND table_name=TG_TABLE_NAME;
 IF obj IS NULL THEN RETURN NEW; END IF;
 FOR field IN
  SELECT n.field_api,n.column_name,n.sql_type,d.case_sensitive
  FROM md_native_fields n JOIN md_field_definitions d
   ON d.tenant_id=n.tenant_id AND d.object_api=n.object_api AND d.api_name=n.field_api
  WHERE n.tenant_id=NEW.tenant_id AND n.object_api=obj AND d.is_unique
 LOOP
  IF NOT field.field_api=ANY(NEW.present_fields) THEN CONTINUE; END IF;
  old_val:=NULL;
  IF field.column_name IS NULL THEN
   val:=NEW.extras->field.field_api;
   value_expr:=CASE WHEN field.sql_type='text' THEN format('(extras->>%L)',field.field_api)
    ELSE format('(extras->%L)',field.field_api) END;
   IF TG_OP='UPDATE' THEN old_val:=OLD.extras->field.field_api; END IF;
  ELSE
   val:=to_jsonb(NEW)->field.column_name;
   value_expr:=format('%I',field.column_name);
   IF TG_OP='UPDATE' THEN old_val:=to_jsonb(OLD)->field.column_name; END IF;
  END IF;
  IF val IS NULL OR val='null'::jsonb THEN CONTINUE; END IF;
  IF TG_OP='UPDATE' THEN
   IF NOT OLD.is_deleted AND NEW.tenant_id=OLD.tenant_id
    AND val IS NOT DISTINCT FROM old_val THEN CONTINUE; END IF;
  END IF;
  IF field.sql_type='text' AND NOT field.case_sensitive THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE tenant_id=$1 AND id<>$2
    AND NOT is_deleted AND lower(%s)=lower($3))',TG_TABLE_NAME,value_expr)
    INTO duplicate USING NEW.tenant_id,NEW.id,val#>>'{}';
  ELSE
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE tenant_id=$1 AND id<>$2
    AND NOT is_deleted AND to_jsonb(%s)=$3)',TG_TABLE_NAME,value_expr)
    INTO duplicate USING NEW.tenant_id,NEW.id,val;
  END IF;
  IF duplicate THEN RAISE EXCEPTION 'Value must be unique' USING ERRCODE='23505'; END IF;
 END LOOP;
 RETURN NEW;
END $$;

-- Validate native references against live same-tenant target records.
CREATE OR REPLACE FUNCTION md_native_validate_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj text; f record; data jsonb; target text;
BEGIN
 IF NEW.is_deleted THEN RETURN NEW; END IF;
 SELECT object_api INTO obj FROM md_native_objects
  WHERE tenant_id=NEW.tenant_id AND table_name=TG_TABLE_NAME;
 IF obj IS NULL THEN RETURN NEW; END IF;
 data:=to_jsonb(NEW);
 FOR f IN SELECT d.api_name,d.related_object,n.column_name FROM md_field_definitions d
  JOIN md_native_fields n ON n.tenant_id=d.tenant_id AND n.object_api=d.object_api
    AND n.field_api=d.api_name
  WHERE d.tenant_id=NEW.tenant_id AND d.object_api=obj
    AND d.data_type='reference' AND d.deleted_at IS NULL
 LOOP
  IF NOT f.api_name=ANY(NEW.present_fields) THEN CONTINUE; END IF;
  target:=CASE WHEN f.column_name IS NULL THEN NEW.extras->>f.api_name
    ELSE data->>f.column_name END;
  IF target IS NOT NULL AND NOT EXISTS(SELECT 1 FROM md_records r
    WHERE r.tenant_id=NEW.tenant_id AND r.object_api=f.related_object
     AND r.id=target::uuid AND NOT r.is_deleted FOR SHARE)
  THEN RAISE EXCEPTION 'Invalid relationship target for field %',f.api_name
    USING ERRCODE='23503';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION md_native_install_value_triggers(tab text) RETURNS void
 LANGUAGE plpgsql AS $$
BEGIN
 IF tab !~ '^md_object_[a-f0-9]{32}$' THEN
  RAISE EXCEPTION 'Invalid native table name';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger
  WHERE tgrelid=to_regclass(format('%I',tab)) AND tgname='md_native_relationship_check_trigger') THEN
  EXECUTE format('CREATE TRIGGER md_native_relationship_check_trigger BEFORE INSERT OR UPDATE
   ON %I FOR EACH ROW EXECUTE FUNCTION md_native_validate_relationship()',tab);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger
  WHERE tgrelid=to_regclass(format('%I',tab)) AND tgname='md_native_unique_check_trigger') THEN
  EXECUTE format('CREATE TRIGGER md_native_unique_check_trigger BEFORE INSERT OR UPDATE
   ON %I FOR EACH ROW EXECUTE FUNCTION md_native_unique_check()',tab);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger
  WHERE tgrelid=to_regclass(format('%I',tab)) AND tgname='md_native_search_values_sync_trigger') THEN
  EXECUTE format('CREATE TRIGGER md_native_search_values_sync_trigger AFTER INSERT OR UPDATE
   ON %I FOR EACH ROW EXECUTE FUNCTION md_native_search_values_sync()',tab);
 END IF;
END $$;

-- Also attach on tables activated before this DDL upgrade.
DO $$ DECLARE tab text; BEGIN
 FOR tab IN SELECT DISTINCT table_name FROM md_native_objects LOOP
  PERFORM md_native_install_value_triggers(tab);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION md_native_configure_field(t uuid,o text,k text) RETURNS void
 LANGUAGE plpgsql AS $$
DECLARE f md_field_definitions; tab text; typ text; col text; standard boolean;
 expression text; unique_expr text; idx text; unique_ci text; unique_cs text;
BEGIN
 SELECT table_name INTO tab FROM md_native_objects WHERE tenant_id=t AND object_api=o;
 IF tab IS NULL THEN RETURN; END IF;
 PERFORM md_native_install_value_triggers(tab);
 SELECT * INTO f FROM md_field_definitions WHERE tenant_id=t AND object_api=o AND api_name=k;
 IF NOT FOUND OR f.data_type='formula' THEN
  DELETE FROM md_native_fields WHERE tenant_id=t AND object_api=o AND field_api=k; RETURN;
 END IF;
 typ:=f.data_type;
 IF typ='rollup' THEN
  IF f.rollup_operation='COUNT' THEN typ:='number'; ELSE
   SELECT data_type INTO typ FROM md_field_definitions
    WHERE tenant_id=t AND object_api=f.rollup_child_object AND api_name=f.rollup_source_field;
   typ:=COALESCE(typ,'number');
  END IF;
 END IF;
 typ:=CASE WHEN typ IN('number','currency','percent') THEN 'numeric'
  WHEN typ='reference' THEN 'uuid' WHEN typ='datetime' THEN 'timestamptz'
  WHEN typ='geolocation' THEN 'double precision[]' WHEN typ='address' THEN 'text[]'
  WHEN typ IN('boolean','date') THEN typ
  WHEN typ IN('text','textarea','longtext','richtext','encryptedtext','email','phone','url',
   'image','file','picklist','multipicklist','autonumber','time') THEN 'text'
  ELSE NULL END;
 IF typ IS NULL THEN RAISE EXCEPTION 'Unsupported native storage field type: %',f.data_type; END IF;
 standard:=k='Name' OR EXISTS(SELECT 1 FROM md_app_package_resources p
  JOIN md_tenant_app_installed_versions i ON i.app_id=p.app_id AND i.version=p.version
  WHERE i.tenant_id=t AND p.resource_type='Field' AND p.parent_api=o AND p.api_name=k);
 IF standard THEN
  col:='f_'||substr(encode(digest(k||':'||typ,'sha256'),'hex'),1,32);
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I %s',tab,col,typ);
 END IF;
 INSERT INTO md_native_fields(tenant_id,object_api,field_api,column_name,sql_type,data_type)
  VALUES(t,o,k,col,typ,f.data_type) ON CONFLICT(tenant_id,object_api,field_api)
  DO UPDATE SET column_name=EXCLUDED.column_name,sql_type=EXCLUDED.sql_type,data_type=EXCLUDED.data_type;
 expression:=CASE WHEN col IS NOT NULL THEN format('%I',col)
  ELSE format('(extras->>%L)',k) END;
 unique_expr:=CASE WHEN col IS NULL AND typ<>'text'
   THEN format('NULLIF(extras->%L,''null''::jsonb)',k)
  ELSE expression END;
 unique_ci:='md_native_u_ci_'||md5(tab||':'||k);
 unique_cs:='md_native_u_cs_'||md5(tab||':'||k);
 IF f.is_unique AND typ='text' AND NOT f.case_sensitive THEN
  EXECUTE format('DROP INDEX IF EXISTS %I',unique_cs);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I
   (tenant_id,lower(%s)) WHERE NOT is_deleted AND %s IS NOT NULL',
   unique_ci,tab,expression,expression);
 ELSIF f.is_unique THEN
  EXECUTE format('DROP INDEX IF EXISTS %I',unique_ci);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I
   (tenant_id,%s) WHERE NOT is_deleted AND %s IS NOT NULL',
   unique_cs,tab,unique_expr,unique_expr);
 ELSE
  EXECUTE format('DROP INDEX IF EXISTS %I',unique_ci);
  EXECUTE format('DROP INDEX IF EXISTS %I',unique_cs);
 END IF;
 idx:='md_native_'||md5(tab||k||COALESCE(col,'extras')||typ);
 IF typ='text' AND f.data_type<>'encryptedtext' THEN
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin ((%s) gin_trgm_ops) WHERE NOT is_deleted',idx,tab,expression);
 ELSIF typ IN('numeric','uuid','boolean') OR (col IS NOT NULL AND typ IN('date','timestamptz')) THEN
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id,((%s)::%s)) WHERE NOT is_deleted',idx,tab,expression,typ);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION md_native_record_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tab text; columns text:='tenant_id,id,created_at,updated_at,owner_id,owner_queue_id,record_type_id,is_clone,is_deleted,deleted_at,deleted_by,deletion_group_id,deletion_root_id';
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT table_name INTO tab FROM md_native_objects WHERE tenant_id=OLD.tenant_id AND object_api=OLD.object_api;
  IF tab IS NOT NULL THEN EXECUTE format('DELETE FROM %I WHERE tenant_id=$1 AND id=$2',tab) USING OLD.tenant_id,OLD.id; END IF;
  RETURN OLD;
 END IF;
 SELECT table_name INTO tab FROM md_native_objects WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api;
 IF tab IS NULL THEN RETURN NEW; END IF;
 EXECUTE format('INSERT INTO %I (%s,present_fields,extras)
  SELECT %s,ARRAY[]::text[],''{}''::jsonb FROM jsonb_populate_record(NULL::%I,$1)
  ON CONFLICT(tenant_id,id) DO UPDATE SET
   created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,owner_id=EXCLUDED.owner_id,
   owner_queue_id=EXCLUDED.owner_queue_id,record_type_id=EXCLUDED.record_type_id,is_clone=EXCLUDED.is_clone,
   is_deleted=EXCLUDED.is_deleted,deleted_at=EXCLUDED.deleted_at,deleted_by=EXCLUDED.deleted_by,
   deletion_group_id=EXCLUDED.deletion_group_id,deletion_root_id=EXCLUDED.deletion_root_id',tab,columns,columns,tab)
  USING to_jsonb(NEW);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_native_record_changed ON md_records;
CREATE TRIGGER md_native_record_changed AFTER INSERT OR UPDATE OR DELETE ON md_records
 FOR EACH ROW EXECUTE FUNCTION md_native_record_changed();

CREATE OR REPLACE FUNCTION md_native_field_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM md_native_objects
   WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api) THEN
  PERFORM md_native_configure_field(NEW.tenant_id,NEW.object_api,NEW.api_name);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_native_field_changed ON md_field_definitions;
CREATE TRIGGER md_native_field_changed AFTER INSERT OR UPDATE OF data_type,rollup_operation,rollup_source_field,rollup_child_object,is_unique,case_sensitive
 ON md_field_definitions FOR EACH ROW EXECUTE FUNCTION md_native_field_changed();

-- Newly created Objects must become natively writable immediately.
CREATE OR REPLACE FUNCTION md_native_object_created() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tab text;
BEGIN
 tab:='md_object_'||substr(encode(digest(NEW.api_name,'sha256'),'hex'),1,32);
 EXECUTE format('CREATE TABLE IF NOT EXISTS %I(
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL,
  created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
  owner_id uuid,owner_queue_id uuid,record_type_id text,is_clone boolean NOT NULL,
  is_deleted boolean NOT NULL,deleted_at timestamptz,deleted_by uuid,
  deletion_group_id uuid,deletion_root_id uuid,present_fields text[] NOT NULL,
  extras jsonb NOT NULL CHECK(jsonb_typeof(extras)=''object''),
  PRIMARY KEY(tenant_id,id))',tab);
 INSERT INTO md_native_objects(tenant_id,object_api,table_name)
 VALUES(NEW.tenant_id,NEW.api_name,tab)
 ON CONFLICT(tenant_id,object_api) DO NOTHING;
 PERFORM md_native_install_value_triggers(tab);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_native_object_created ON md_object_definitions;
CREATE TRIGGER md_native_object_created AFTER INSERT ON md_object_definitions
 FOR EACH ROW EXECUTE FUNCTION md_native_object_created();
`;

export async function activateNativeObject(db:SqlPersistence,tenantId:string,objectApi:string){
 return db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['native-object-copy']);
  if((await client.query('SELECT 1 FROM md_native_objects WHERE tenant_id=$1 AND object_api=$2',[tenantId,objectApi])).rowCount)return;
  const result=await copyNativeObject(db,tenantId,objectApi);
  await client.query('INSERT INTO md_native_objects(tenant_id,object_api,table_name) VALUES($1,$2,$3)',[tenantId,objectApi,result.table]);
  await client.query(`SELECT md_native_configure_field(tenant_id,object_api,api_name)
   FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2`,[tenantId,objectApi]);
 });
}

export async function applyNativeObjectStorage(db:SqlPersistence){
 // Every Object of every tenant gets its typed table (new Objects on the next start).
 // An Object whose fields cannot be stored natively yet stays on the record tables
 // only (reads fall back automatically); it is logged, and the server still starts.
 const {rows}=await db.query<{tenant_id:string;api_name:string}>(`SELECT o.tenant_id,o.api_name
  FROM md_object_definitions o WHERE o.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM md_native_objects n
   WHERE n.tenant_id=o.tenant_id AND n.object_api=o.api_name) ORDER BY o.tenant_id,o.api_name`);
 const skipped:string[]=[];
 for(const row of rows){
  try{await activateNativeObject(db,row.tenant_id,row.api_name);}
  catch(error){skipped.push(row.api_name+' ('+(error instanceof Error?error.message:'failed').slice(0,120)+')');}
 }
 if(skipped.length)console.warn('[native-storage] kept on record tables: '+skipped.slice(0,50).join('; '));
}

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

CREATE OR REPLACE FUNCTION md_native_configure_field(t uuid,o text,k text) RETURNS void
 LANGUAGE plpgsql AS $$
DECLARE f md_field_definitions; tab text; typ text; col text; standard boolean; expression text; idx text;
BEGIN
 SELECT table_name INTO tab FROM md_native_objects WHERE tenant_id=t AND object_api=o;
 IF tab IS NULL THEN RETURN; END IF;
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
 idx:='md_native_'||md5(tab||k||COALESCE(col,'extras')||typ);
 IF typ='text' AND f.data_type<>'encryptedtext' THEN
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin ((%s) gin_trgm_ops) WHERE NOT is_deleted',idx,tab,expression);
 ELSIF typ IN('numeric','uuid','boolean') OR (col IS NOT NULL AND typ IN('date','timestamptz')) THEN
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id,((%s)::%s)) WHERE NOT is_deleted',idx,tab,expression,typ);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION md_native_write_value(v md_record_values,removed boolean) RETURNS void
 LANGUAGE plpgsql AS $$
DECLARE tab text; f md_native_fields; val jsonb;
BEGIN
 SELECT table_name INTO tab FROM md_native_objects WHERE tenant_id=v.tenant_id AND object_api=v.object_api;
 IF tab IS NULL THEN RETURN; END IF;
 SELECT * INTO f FROM md_native_fields WHERE tenant_id=v.tenant_id AND object_api=v.object_api AND field_api=v.field_api;
 IF NOT FOUND THEN
  PERFORM md_native_configure_field(v.tenant_id,v.object_api,v.field_api);
  SELECT * INTO f FROM md_native_fields WHERE tenant_id=v.tenant_id AND object_api=v.object_api AND field_api=v.field_api;
  IF NOT FOUND THEN
   IF removed THEN RETURN; END IF;
   RAISE EXCEPTION 'Native field metadata unavailable for %.%',v.object_api,v.field_api;
  END IF;
 END IF;
 IF removed THEN val:='null'::jsonb;
 ELSIF f.sql_type='numeric' THEN val:=to_jsonb(COALESCE(v.value_number,NULLIF(v.value_text,'')::numeric));
 ELSIF f.sql_type='boolean' THEN val:=to_jsonb(COALESCE(v.value_boolean,v.value_text::boolean));
 ELSIF f.sql_type='date' THEN val:=to_jsonb(COALESCE(v.value_date,v.value_text::date));
 ELSIF f.sql_type='timestamptz' THEN val:=to_jsonb(COALESCE(v.value_datetime,v.value_text::timestamptz));
 ELSIF f.sql_type='uuid' THEN val:=to_jsonb(COALESCE(v.reference_record_id,v.value_text::uuid));
 ELSIF f.sql_type='double precision[]' THEN val:=to_jsonb(ARRAY[v.geo_latitude,v.geo_longitude]);
 ELSIF f.sql_type='text[]' THEN val:=to_jsonb(ARRAY[v.address_street,v.address_city,v.address_state,v.address_postal_code,v.address_country]);
 ELSE val:=to_jsonb(COALESCE(v.reference_record_id::text,v.value_text)); END IF;
 val:=COALESCE(val,'null'::jsonb);
 IF f.column_name IS NULL THEN
  EXECUTE format('UPDATE %I SET extras=CASE WHEN $5 THEN extras-$3 ELSE extras||jsonb_build_object($3,$4) END,
   present_fields=CASE WHEN $5 THEN array_remove(present_fields,$3)
    WHEN $3=ANY(present_fields) THEN present_fields ELSE array_append(present_fields,$3) END
   WHERE tenant_id=$1 AND id=$2',tab) USING v.tenant_id,v.record_id,v.field_api,val,removed;
 ELSE
  EXECUTE format('UPDATE %I SET %I=(jsonb_populate_record(NULL::%I,jsonb_build_object(%L,$4))).%I,
   extras=extras-$3,present_fields=CASE WHEN $5 THEN array_remove(present_fields,$3)
    WHEN $3=ANY(present_fields) THEN present_fields ELSE array_append(present_fields,$3) END
   WHERE tenant_id=$1 AND id=$2',tab,f.column_name,tab,f.column_name,f.column_name)
   USING v.tenant_id,v.record_id,v.field_api,val,removed;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION md_native_value_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM md_native_write_value(OLD,true); RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (OLD.tenant_id,OLD.record_id,OLD.object_api,OLD.field_api)
   IS DISTINCT FROM (NEW.tenant_id,NEW.record_id,NEW.object_api,NEW.field_api) THEN
  PERFORM md_native_write_value(OLD,true);
 END IF;
 PERFORM md_native_write_value(NEW,false); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_native_value_changed ON md_record_values;
CREATE TRIGGER md_native_value_changed AFTER INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_native_value_changed();

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
DECLARE v md_record_values;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM md_native_objects WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api) THEN RETURN NEW; END IF;
 PERFORM md_native_configure_field(NEW.tenant_id,NEW.object_api,NEW.api_name);
 IF NEW.data_type<>'formula' THEN
  FOR v IN SELECT * FROM md_record_values WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND field_api=NEW.api_name
   LOOP PERFORM md_native_write_value(v,false); END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_native_field_changed ON md_field_definitions;
CREATE TRIGGER md_native_field_changed AFTER INSERT OR UPDATE OF data_type,rollup_operation,rollup_source_field,rollup_child_object
 ON md_field_definitions FOR EACH ROW EXECUTE FUNCTION md_native_field_changed();
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
 // Initial migration cohort requested by the owner; storage functions themselves
 // are generic and every app still uses the shared RecordEngine and RBAC.
 const {rows}=await db.query<{tenant_id:string;api_name:string}>(`SELECT tenant_id,api_name
  FROM md_object_definitions WHERE api_name=ANY($1::text[]) AND deleted_at IS NULL ORDER BY tenant_id,api_name`,
  [['Product','MenuCategory','Cart','CartLine','Customer']]);
 for(const row of rows)await activateNativeObject(db,row.tenant_id,row.api_name);
}

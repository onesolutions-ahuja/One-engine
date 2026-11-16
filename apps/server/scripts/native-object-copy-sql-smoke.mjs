import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {copyNativeObject,nativeTableName} from '../src/system-files/native-object-copy.ts';

// Task H: validate native initialization without a legacy value table.
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')
 throw Error('Requires disposable metadrive_native_copy_test database');
const pool=new Pool({connectionString:url});
const db={async transaction(run){const client=await pool.connect();try{
 await client.query('BEGIN');const value=await run(client);await client.query('COMMIT');return value;
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const table=nativeTableName('Product');
try{
 await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE TABLE md_tenants(id uuid PRIMARY KEY);
  CREATE TABLE md_object_definitions(tenant_id uuid,api_name text,PRIMARY KEY(tenant_id,api_name));
  CREATE TABLE md_native_objects(tenant_id uuid,object_api text,table_name text,PRIMARY KEY(tenant_id,object_api));
  CREATE TABLE md_field_definitions(tenant_id uuid,object_api text,api_name text,data_type text,
   rollup_operation text,rollup_child_object text,rollup_source_field text,PRIMARY KEY(tenant_id,object_api,api_name));
  CREATE TABLE md_app_package_resources(app_id uuid,version int,resource_type text,parent_api text,api_name text);
  CREATE TABLE md_tenant_app_installed_versions(tenant_id uuid,app_id uuid,version int);
  CREATE TABLE md_records(tenant_id uuid,id uuid DEFAULT gen_random_uuid(),object_api text,
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
   owner_id uuid,owner_queue_id uuid,record_type_id text,is_clone boolean NOT NULL DEFAULT false,
   is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by uuid,
   deletion_group_id uuid,deletion_root_id uuid,PRIMARY KEY(tenant_id,id));`);
 await pool.query('INSERT INTO md_tenants VALUES($1),($2)',[a,b]);
 await pool.query("INSERT INTO md_object_definitions VALUES($1,'Product'),($2,'Product'),($1,'Empty')",[a,b]);
 for(const tenant of [a,b])
  for(const [field,type] of [['Name','text'],['Amount','currency'],['Enabled','boolean'],
    ['OnDate','date'],['Parent','reference'],['Custom','text']])
   await pool.query('INSERT INTO md_field_definitions VALUES($1,\'Product\',$2,$3,NULL,NULL,NULL)',[tenant,field,type]);
 await pool.query("INSERT INTO md_records(tenant_id,object_api) SELECT $1,'Product' FROM generate_series(1,10000)",[a]);
 await pool.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Product')",[b]);
 const id=(await pool.query('SELECT id FROM md_records WHERE tenant_id=$1 LIMIT 1',[a])).rows[0].id;
 await pool.query('UPDATE md_records SET is_deleted=true,deleted_at=now() WHERE tenant_id=$1 AND id=$2',[a,id]);
 assert.equal((await copyNativeObject(db,a,'Empty')).source_count,'0');
 const started=performance.now();
 assert.equal((await copyNativeObject(db,a,'Product')).source_count,'10000');
 console.info('10k-row native initialization ms:',Math.round(performance.now()-started));
 assert.equal((await copyNativeObject(db,b,'Product')).source_count,'1');
 const first=(await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0];
 assert.equal(first.is_deleted,true);
 assert.deepEqual(first.present_fields,[]);
 assert.deepEqual(first.extras,{});
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[a])).rows[0].n,10000);
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[b])).rows[0].n,1);
 assert.equal((await copyNativeObject(db,a,'Product')).differences,'0');
 await pool.query("INSERT INTO md_native_objects VALUES($1,'Product',$2)",[a,table]);
 await assert.rejects(copyNativeObject(db,a,'Product'),/already activated/);
 assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[a])).rows[0].n,10000);
 console.info('Native initialization passed: 10k headers, tenant isolation, soft deletion, verified rows, and activated-object protection');
}finally{await pool.end();}

// Native uniqueness and search are verified through the public record API and SQL metadata.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {RecordEngine} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')
 throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA native_unique_search_test');
await setup.end();
const isolated=new URL(url);
isolated.searchParams.set('options','-c search_path=native_unique_search_test,public');
const db=new SqlPersistence(isolated.toString());
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db);
 const records=new RecordEngine(db,new RbacEngine(db));
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('native-unique-search','Native unique search') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'native-unique@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'NativeUniqueSearch') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
 const object='NativeUniqueSearch__c';
 await definitions.create(tenant,object,'Native unique search',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Code',label:'Code',dataType:'Text(80)',unique:true},
  {apiName:'Exact',label:'Exact',dataType:'Text(80)',unique:true,caseSensitive:true}
 ]);
 await activateNativeObject(db,tenant,object);
 const indexes=await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname LIKE 'md_native_u_%'");
 assert.equal(indexes.rows.length,2,'native field unique indexes installed');
 const triggerCount=(await db.query(`SELECT count(*)::int AS total FROM pg_trigger trigger
  JOIN pg_class table_info ON table_info.oid=trigger.tgrelid
  JOIN md_native_objects obj ON obj.table_name=table_info.relname
  WHERE obj.tenant_id=$1 AND obj.object_api=$2
   AND trigger.tgname IN ('md_native_unique_check_trigger','md_native_search_values_sync_trigger')`,[tenant,object])).rows[0].total;
 assert.equal(triggerCount,2,'native table has uniqueness and search triggers');

 assert(indexes.rows.some(row=>row.indexdef.includes('lower(')),'case-insensitive native index');
 assert(indexes.rows.some(row=>!row.indexdef.includes('lower(')),'case-sensitive native index');

 const original=await records.create(tenant,user,object,
  {Name:'First native entry',Code:'MiXeD',Exact:'Alpha'});
 const fresh=await records.create(tenant,user,object,
  {Name:'Copper zephyr lantern',Code:'SECOND',Exact:'alpha'});
 const found=await records.list(tenant,user,object,50,0,{search:'copper zephyr lantern'});
 assert.equal(found.total,1,'search must find a record created after native activation');
 assert.equal(found.records[0]?.Id,fresh,'search must return the new record');

 await assert.rejects(records.create(tenant,user,object,
  {Name:'Duplicate case-folded code',Code:'mixed',Exact:'Unused'}),
  'duplicate case-insensitive value must be rejected');
 await assert.rejects(records.create(tenant,user,object,
  {Name:'Duplicate exact code',Code:'THIRD',Exact:'Alpha'}),
  'duplicate case-sensitive value must be rejected');

 await records.update(tenant,user,object,fresh,{Name:'Changed nebula lantern'});
 assert.equal((await records.list(tenant,user,object,50,0,{search:'copper zephyr'})).total,0,
  'native search removes stale tokens after an update');
 assert.equal((await records.list(tenant,user,object,50,0,{search:'changed nebula'})).total,1,
  'native search refreshes tokens after an update');
 assert.equal((await records.get(tenant,user,object,original)).Code,'MiXeD');
 console.info('Native unique/search PostgreSQL smoke passed: native unique indexes, case sensitivity, duplicate rejection, new-record search, update refresh');
}finally{await db.close();}

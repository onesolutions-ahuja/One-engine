// System Object protection, live-only delete blockers and permanent delete, against real PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {ObjectSchemaLifecycle} from '../src/system-files/object-schema-lifecycle.ts';
import {RecordEngine} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';
import {markCoreObjectKinds} from '../src/app-seeders/core-objects.ts';

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')
 throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA object_purge_test');
await setup.end();
const isolated=new URL(url);
isolated.searchParams.set('options','-c search_path=object_purge_test,public');
const db=new SqlPersistence(isolated.toString());
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db);
 const lifecycle=new ObjectSchemaLifecycle(db);
 const records=new RecordEngine(db,new RbacEngine(db));
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('object-purge','Object purge') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'object-purge@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'ObjectPurge') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);

 // 1. System Objects: marked by the Core seeder and protected by the database itself.
 await db.query("INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,'NamedDevice','Named Device',false),($1,'Product','Product',false)",[tenant]);
 await db.transaction(client=>markCoreObjectKinds(client,tenant));
 const kinds=Object.fromEntries((await definitions.list(tenant)).map(o=>[o.apiName,o.kind]));
 assert.equal(kinds.NamedDevice,'System Object');
 assert.equal(kinds.Product,'Standard Object');
 await assert.rejects(db.query("UPDATE md_object_definitions SET deleted_at=now() WHERE tenant_id=$1 AND api_name='NamedDevice'",[tenant]),/can never be deleted/);
 await assert.rejects(db.query("UPDATE md_object_definitions SET is_system=false WHERE tenant_id=$1 AND api_name='NamedDevice'",[tenant]),/can never be deleted/);
 await assert.rejects(db.query("DELETE FROM md_object_definitions WHERE tenant_id=$1 AND api_name='NamedDevice'",[tenant]),/can never be deleted/);
 await assert.rejects(lifecycle.delete(tenant,'NamedDevice',0),/System Objects can never be deleted/);
 await db.query("UPDATE md_object_definitions SET label='Device' WHERE tenant_id=$1 AND api_name='NamedDevice'",[tenant]);
 console.info('System Objects: protected against delete, purge and un-flagging (database trigger)');

 // 2. An Object with records, a native table, a lookup from another Object and its own record pages.
 const object='PurgeMe__c',other='KeepMe__c';
 await definitions.create(tenant,object,'Purge me',[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Amount',label:'Amount',dataType:'Number(12,2)'}]);
 await definitions.create(tenant,other,'Keep me',[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}]);
 await activateNativeObject(db,tenant,object);
 const first=await records.create(tenant,user,object,{Name:'one',Amount:1});
 await records.create(tenant,user,object,{Name:'two',Amount:2});
 await db.query(`INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,relationship_type)
  VALUES($1,$2,'PurgeRef','Purge ref','reference',$3,'Lookup')`,[tenant,other,object]);
 await assert.rejects(lifecycle.delete(tenant,object,0),/Inbound relationships/);
 // A deleted lookup no longer blocks, and keeps no link to an Object that is gone.
 await db.query("UPDATE md_field_definitions SET deleted_at=now() WHERE tenant_id=$1 AND object_api=$2 AND api_name='PurgeRef'",[tenant,other]);

 // 3. Dead consumers (a disabled record page, an archived Flow's trigger) do not block a delete.
 const page=(await db.query("INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled) VALUES($1,'AcetillPurgeMeRecord','Old app page',false) RETURNING id",[tenant])).rows[0].id;
 await db.query(`INSERT INTO md_lightning_page_details(tenant_id,page_id,page_type,target_object,layout_mode,template,
  canvas_width,canvas_height,status,devices) VALUES($1,$2,'Record Page',$3,'template','header-main',1440,900,'Active',ARRAY['Desktop'])`,
  [tenant,page,object]);
 const flow=(await db.query(`INSERT INTO md_flow_definitions(tenant_id,api_name,label,flow_type,version,active,archived)
  VALUES($1,'OldAppFlow','Old app flow','Record-Triggered Flow',1,false,true) RETURNING id`,[tenant])).rows[0].id;
 await db.query(`INSERT INTO md_flow_trigger_subscriptions(tenant_id,flow_id,flow_type,trigger_key,app_api_name,active)
  VALUES($1,$2,'Record-Triggered Flow',$3,'Acetill',true)`,[tenant,flow,object]);
 assert.deepEqual((await lifecycle.impact(tenant,object)).blockers,[],'disabled pages and archived Flows are not live consumers');
 const deleted=await lifecycle.delete(tenant,object,(await definitions.get(tenant,object)).revision??0);
 assert.equal(deleted.deleted,true);

 // 4. Permanent delete: confirmation, then records, fields, pages, triggers and the native table go.
 const table=(await db.query('SELECT table_name FROM md_native_objects WHERE tenant_id=$1 AND object_api=$2',[tenant,object])).rows[0]?.table_name;
 assert.ok(table,'native table exists before purge');
 await assert.rejects(lifecycle.purge(tenant,object,'wrong'),/Type the Object API name/);
 await assert.rejects(lifecycle.purge(tenant,other,other),/Delete the Object first/);
 const purged=await lifecycle.purge(tenant,object,object);
 assert.equal(purged.purged,true);
 assert.equal(purged.records,2);
 const left=async(sql,params)=>Number((await db.query(sql,params)).rows[0].n);
 assert.equal(await left('SELECT count(*) n FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[tenant,object]),0);
 assert.equal(await left('SELECT count(*) n FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2',[tenant,object]),0);
 assert.equal(await left('SELECT count(*) n FROM md_records WHERE tenant_id=$1 AND id=$2',[tenant,first]),0);
 assert.equal(await left('SELECT count(*) n FROM md_page_definitions WHERE tenant_id=$1 AND id=$2',[tenant,page]),0);
 assert.equal(await left('SELECT count(*) n FROM md_flow_trigger_subscriptions WHERE tenant_id=$1 AND trigger_key=$2',[tenant,object]),0);
 assert.equal(await left('SELECT count(*) n FROM md_native_objects WHERE tenant_id=$1 AND object_api=$2',[tenant,object]),0);
 assert.equal(await left('SELECT count(*) n FROM pg_tables WHERE tablename=$1',[table]),0,'native table dropped');
 assert.equal((await db.query("SELECT related_object FROM md_field_definitions WHERE tenant_id=$1 AND object_api=$2 AND api_name='PurgeRef'",[tenant,other])).rows[0].related_object,null);
 assert.equal((await definitions.get(tenant,other)).apiName,other,'other Objects are untouched');
 assert.equal(await left('SELECT count(*) n FROM md_users WHERE tenant_id=$1',[tenant]),1,'users are untouched');
 // The API name is free again.
 await definitions.create(tenant,object,'Purge me again',[{apiName:'Name',label:'Name',dataType:'Text(80)',required:true}]);
 console.info('Permanent delete: records, fields, pages, triggers and native table removed in one transaction');
}finally{await db.close();}

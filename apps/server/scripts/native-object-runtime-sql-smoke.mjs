import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {RecordEngine} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';
import {nativeTableName} from '../src/system-files/native-object-copy.ts';
import {loadNativeFields,nativeTableSql} from '../src/system-files/native-object-query.ts';

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA native_api_test');await setup.end();
const isolated=new URL(url);isolated.searchParams.set('options','-c search_path=native_api_test,public');
const db=new SqlPersistence(isolated.toString());
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db),records=new RecordEngine(db,new RbacEngine(db));
 const tenants=[],users=[],sets=[];
 for(const slug of ['native-one','native-two']){
  const tenant=(await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$1) RETURNING id',[slug])).rows[0].id;
  const user=(await db.query('INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,$2,\'fixture\') RETURNING id',[tenant,slug+'@example.invalid'])).rows[0].id;
  const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'NativeTest') RETURNING id",[tenant])).rows[0].id;
  await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
  await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
  tenants.push(tenant);users.push(user);sets.push(set);
 }
 const [a,b]=tenants,[actor,other]=users,object='NativeProbe__c';
 for(const tenant of tenants)await definitions.create(tenant,object,'Native probe',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Amount',label:'Amount',dataType:'Number(12,2)'},
  {apiName:'Enabled',label:'Enabled',dataType:'Checkbox'},
  {apiName:'Code',label:'Code',dataType:'Text(80)',unique:true},
  {apiName:'Secret',label:'Secret',dataType:'Text(80)'},
  {apiName:'OnDate',label:'On date',dataType:'Date'}
 ]);
 const id=await records.create(a,actor,object,{Name:'Before',Amount:12.5,Enabled:false,Code:'ONE',Secret:'hidden',OnDate:'2026-11-15'});
 const before=await records.get(a,actor,object,id);
 await activateNativeObject(db,a,object);await activateNativeObject(db,b,object);
 assert.deepEqual(await records.get(a,actor,object,id),before,'activation preserves API response');
 await records.update(a,actor,object,id,{Name:'After',Amount:42.25,Enabled:true});
 assert.equal((await records.get(a,actor,object,id)).Amount,42.25);
 const filterCases=[['Amount','eq','42.25',1],['Amount','gte','42',1],['Amount','lt','42',0],
  ['Name','contains','fte',1],['Name','startsWith','Aft',1],['Name','ne','wrong',1],
  ['Secret','isBlank','',0],['Secret','isNotBlank','',1],['Enabled','eq','true',1],['OnDate','eq','2026-11-15',1]];
 for(const [field,operator,value,total] of filterCases){
  const page=await records.list(a,actor,object,50,0,{filters:[{field,operator,value}]});
  assert.equal(page.total,total,field+' '+operator);
 }
 const created=await records.create(a,actor,object,{Name:'Created after activation',Amount:7,Code:'TWO'});
 assert.equal((await records.get(a,actor,object,created)).Amount,7);
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${nativeTableName(object)} WHERE tenant_id=$1`,[a])).rows[0].n,2);
 await assert.rejects(records.create(a,actor,object,{Name:'duplicate',Code:'TWO'}));
 await assert.rejects(records.get(b,other,object,id),/not found/i);
 await assert.rejects(records.update(b,other,object,id,{Name:'cross tenant'}),/not found/i);
 // Rollback a successful save in an outer transaction: both representations must revert.
 await assert.rejects(db.transaction(async()=>{await records.update(a,actor,object,id,{Amount:999});throw Error('rollback probe');}),/rollback probe/);
 assert.equal((await records.get(a,actor,object,id)).Amount,42.25);
 await definitions.addField(a,object,'Added','Text(80)');
 await records.update(a,actor,object,id,{Added:'builder-created'});
 assert.equal((await records.get(a,actor,object,id)).Added,'builder-created');
 const meta=await loadNativeFields(db,a,object);
 const table=nativeTableSql(meta);
 const nativeAdded=(await db.query(`SELECT extras->>'Added' AS value FROM ${table}
   WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0];
 assert.equal(nativeAdded.value,'builder-created','new custom field stores native values');
 await definitions.deleteField(a,object,'Added');
 const deleted=(await db.query(`SELECT extras ? 'Added' AS has_extra,
   'Added'=ANY(present_fields) AS is_present FROM ${table}
   WHERE tenant_id=$1 AND id=$2`,[a,id])).rows[0];
 assert.equal(deleted.has_extra,false,'deleted field is removed from native extras');
 assert.equal(deleted.is_present,false,'deleted field is removed from present_fields');
 assert.equal((await db.query(`SELECT 1 FROM md_native_fields WHERE tenant_id=$1
   AND object_api=$2 AND field_api='Added'`,[a,object])).rowCount,0,
   'deleted field has no native field metadata');
 await definitions.restoreField(a,object,'Added');
 await records.update(a,actor,object,id,{Added:'builder-restored'});
 assert.equal((await records.get(a,actor,object,id)).Added,'builder-restored',
   'restored field is configured for native writes again');
 await definitions.addField(a,object,'MustFill','Text(80)');
 await assert.rejects(definitions.updateField(a,object,'MustFill',{label:'MustFill',required:true}),
   /Required field cannot be enabled while records have no value/,
   'native presence check prevents enabling required on empty records');
 // Field denies apply to native output AND filtering; revocation is immediate.
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,'read','deny')",[a,sets[0],object+'.Secret']);
 assert(!Object.hasOwn(await records.get(a,actor,object,id),'Secret'));
 await assert.rejects(records.list(a,actor,object,50,0,{filters:[{field:'Secret',operator:'eq',value:'hidden'}]}),/not readable/i);
 await records.remove(a,actor,object,created);
 await assert.rejects(records.get(a,actor,object,created),/not found/i);
 assert.equal((await db.query(`SELECT is_deleted FROM ${nativeTableName(object)} WHERE tenant_id=$1 AND id=$2`,[a,created])).rows[0].is_deleted,true);
 await records.restore(a,actor,object,created);
 assert.equal((await records.get(a,actor,object,created)).Amount,7);
 // A reader with object/field grants but no owner/share grant cannot see private records.
 const reader=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'reader@example.invalid','fixture') RETURNING id",[a])).rows[0].id;
 const limited=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'NativeReader') RETURNING id",[a])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[a,reader,limited]);
 for(const resource of [object,object+'.*'])await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,'read','allow')",[a,limited,resource]);
 await db.query("INSERT INTO md_sharing_settings(tenant_id,object_api,default_access) VALUES($1,$2,'Private') ON CONFLICT(tenant_id,object_api) DO UPDATE SET default_access='Private'",[a,object]);
 assert.equal((await records.list(a,reader,object)).total,0);
 await assert.rejects(records.get(a,reader,object,id),/not found/i);
 // The typed Name column is shared across tenants of this Object API.
 // Dropping it for one tenant must not damage the other tenant's metadata.
 const typed=(await db.query(`SELECT column_name FROM md_native_fields
   WHERE tenant_id=$1 AND object_api=$2 AND field_api='Name'`,[a,object])).rows[0].column_name;
 const columnExists=async()=>Boolean((await db.query(`SELECT 1 FROM pg_attribute
   WHERE attrelid=to_regclass($1) AND attname=$2 AND NOT attisdropped`,
   [nativeTableName(object),typed])).rowCount);
 assert(await columnExists(),'typed column exists before field deletion');
 await definitions.deleteField(a,object,'Name');
 assert(await columnExists(),'deleting one tenant field must preserve the shared typed column');
 await definitions.deleteField(b,object,'Name');
 assert.equal(await columnExists(),false,'typed column drops after its final tenant reference');
 await definitions.restoreField(b,object,'Name');
 assert(await columnExists(),'restoring a field recreates its native typed column');
 console.info('Native RecordEngine integration passed: CRUD, numeric/text/date filters, rollback, uniqueness, native field add/delete/restore, required-value check, shared typed column safety, soft deletion/restore, tenant/object/field/record security');
}finally{await db.close();}

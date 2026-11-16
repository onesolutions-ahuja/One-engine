// Times product-grid reads on 10,000 products (real PostgreSQL, native per-object table):
// first page, one category, a name search and a search with no match. Prints the times and
// fails past SEARCH_BUDGET_MS. Run in CI with a disposable database.
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
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA search_probe');await setup.end();
const isolated=new URL(url);isolated.searchParams.set('options','-c search_path=search_probe,native_api_test,public');
const db=new SqlPersistence(isolated.toString());
const COUNT=10000;
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db),records=new RecordEngine(db,new RbacEngine(db));
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('search','search') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'search@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Search') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
 const object='SearchItem';
 await definitions.create(tenant,object,'Search item',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Barcode',label:'Barcode',dataType:'Text(40)'},
  {apiName:'Grp',label:'Group',dataType:'Text(40)'},
  {apiName:'Price',label:'Price',dataType:'Number(12,2)'}]);
 // Bulk load straight into the record tables (the copy step then fills the native table).
 await db.transaction(async client=>{
  await client.query(`INSERT INTO md_records(tenant_id,object_api,owner_id)
   SELECT $1,$2,$3 FROM generate_series(1,$4)`,[tenant,object,user,COUNT]);
  await client.query(`WITH numbered AS (SELECT id,row_number() OVER (ORDER BY created_at,id) AS n
    FROM md_records WHERE tenant_id=$1 AND object_api=$2)
   INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text,value_number,is_unique,case_sensitive)
   SELECT $1,id,$2,f.field_api,f.value_text,f.value_number,false,false FROM numbered
   CROSS JOIN LATERAL (VALUES ('Name','Item '||n,NULL::numeric),('Barcode',lpad(n::text,12,'0'),NULL),
    ('Grp','G'||(n%10),NULL),('Price',(n%50)::text,(n%50)::numeric)) AS f(field_api,value_text,value_number)`,[tenant,object]);
 });
 await activateNativeObject(db,tenant,object);
 await db.query('ANALYZE');
 const cases=[
  ['first page',{}],
  ['one group',{filters:[{field:'Grp',operator:'eq',value:'G3'}]}],
  ['name search',{filters:[{field:'Name',operator:'contains',value:'item 123'}]}],
  ['barcode scan',{filters:[{field:'Barcode',operator:'eq',value:'000000004567'}]}],
  ['no match',{filters:[{field:'Name',operator:'contains',value:'zzzz'}]}]];
 const results=[];
 for(const [name,options] of cases){
  let best=Infinity,page;
  for(let run=0;run<3;run++){
   const started=performance.now();
   page=await records.list(tenant,user,object,50,0,options);
   best=Math.min(best,performance.now()-started);
  }
  results.push([name,Math.round(best),page.total]);
 }
 console.info('10k products: '+results.map(([n,ms,total])=>n+' '+ms+' ms ('+total+' rows)').join(', '));
 assert.equal(results[0][2],COUNT);
 assert.equal(results[1][2],COUNT/10);
 assert.equal(results[3][2],1);
 assert.equal(results[4][2],0);
 const budget=Number(process.env.SEARCH_BUDGET_MS??100000);
 for(const [name,ms] of results)assert(ms<=budget,name+' took '+ms+' ms (budget '+budget+')');
}finally{await db.close();}

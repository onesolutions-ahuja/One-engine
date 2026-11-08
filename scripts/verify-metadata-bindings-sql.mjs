import {readBaselineMigration} from '../apps/server/scripts/baseline-sql-section.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ObjectDefinitionService} from '../apps/server/src/system-files/object-definition.ts';
import {FlowRuntime} from '../apps/server/src/system-files/flow-runtime.ts';
import {AppRuntime} from '../apps/server/src/system-files/app-runtime.ts';
import {PageRuntime} from '../apps/server/src/system-files/page-runtime.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function verifyMetadataBindingsSql(db) {
await db.exec((await readFile(root+'apps/server/src/system-files/schema.sql','utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
const migration=readBaselineMigration('001-metadata-bindings.sql');
await db.exec(migration);await db.exec(migration);
const adapter=client=>({query:async(sql,params=[])=>{const r=await client.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};}});
const sql={...adapter(db),transaction:fn=>db.transaction(tx=>fn(adapter(tx)))};
const one=async(q,p=[])=> (await db.query(q,p)).rows[0];
const tenant=(await one("INSERT INTO md_tenants(slug,name) VALUES ('one','One') RETURNING id")).id;
const other=(await one("INSERT INTO md_tenants(slug,name) VALUES ('two','Two') RETURNING id")).id;
const app=(await one("INSERT INTO md_apps(api_name,label) VALUES ('Example','Example') RETURNING id")).id;
await db.query('INSERT INTO md_app_entitlements(tenant_id,app_id,active) VALUES ($1,$2,true)',[tenant,app]);
const component=(await one("INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key) VALUES ($1,'Conversation','OneConversation') RETURNING id",[tenant])).id;
const object=(await one("INSERT INTO md_object_definitions(tenant_id,api_name,label) VALUES ($1,'BeforeRename','Example') RETURNING id",[tenant])).id;
const field=(await one("INSERT INTO md_field_definitions(tenant_id,object_api,api_name,data_type) VALUES ($1,'BeforeRename','BeforeField','text') RETURNING id",[tenant])).id;
const foreignObject=(await one("INSERT INTO md_object_definitions(tenant_id,api_name,label) VALUES ($1,'Private','Private') RETURNING id",[other])).id;
const seed={key:'home',version:1,pageApiName:'ExampleHome',title:'Example',componentId:component,properties:{title:'Initial',objectApiName:'metadata:'+object,nameFieldApiName:'metadata:'+field}};
const apps=new AppRuntime(sql),pages=new PageRuntime(sql);
const model=await new ObjectDefinitionService(sql).create(tenant,'Catalog','Catalogue',[
 {apiName:'Amount',label:'Selling price',dataType:'Number'}]);
assert.ok(model.id);assert.ok(model.fields[0].id);assert.equal(model.fields[0].label,'Selling price');
await db.query("INSERT INTO md_flow_definitions(tenant_id,api_name,label,version,active) VALUES ($1,'AnyFlow','Readable checkout',1,true)",[tenant]);
const listed=await new FlowRuntime(sql).list(tenant);assert.ok(listed[0].id);assert.equal(listed[0].label,'Readable checkout');
await apps.install(tenant,'Example',seed);await apps.install(tenant,'Example',seed);
assert.equal((await one('SELECT count(*)::int AS n FROM md_page_components')).n,1);
assert.equal((await one('SELECT count(*)::int AS n FROM md_page_component_properties')).n,3);
await db.query("UPDATE md_page_component_properties SET value_text='Customer title' WHERE property_path='title'");
await apps.install(tenant,'Example',{...seed,version:2,properties:{...seed.properties,title:'Upgrade',newOption:true}});
let loaded=await pages.load(tenant,'ExampleHome');assert.equal(loaded.components[0].properties.title,'Customer title');
assert.equal(loaded.components[0].properties.newOption,true);
assert.equal(loaded.components[0].properties.objectApiName,'metadata:'+object);
// Stable field reference survives a rename of its API name.
await db.query("UPDATE md_field_definitions SET api_name='AfterField' WHERE id=$1",[field]);
assert.equal((await pages.load(tenant,'ExampleHome')).components[0].properties.nameFieldApiName,'metadata:'+field);
await assert.rejects(()=>apps.install(tenant,'Example',{...seed,key:'bad',pageApiName:'BadPage',properties:{objectApiName:'metadata:'+foreignObject}}),/foreign key/i);
assert.equal((await one("SELECT count(*)::int AS n FROM md_page_definitions WHERE api_name='BadPage'")).n,0);
await apps.uninstall(tenant,'Example');await assert.rejects(()=>pages.load(tenant,'ExampleHome'),/Permission denied/);
assert.equal((await pages.list(tenant)).length,0);
await apps.install(tenant,'Example',seed);loaded=await pages.load(tenant,'ExampleHome');assert.equal(loaded.components[0].properties.title,'Customer title');
await db.query('UPDATE md_app_entitlements SET active=false WHERE tenant_id=$1',[tenant]);
await assert.rejects(()=>pages.load(tenant,'ExampleHome'),/Permission denied/);
assert.equal((await one('SELECT count(*)::int AS n FROM md_records')).n,0);
assert.equal((await one('SELECT count(*)::int AS n FROM md_permission_rules')).n,0);
console.log('PASS: fresh schema, repeated migration, install idempotency, upgrades preserve edits, cross-tenant rejection/rollback, rename references, uninstall/reinstall, licence enforcement, no records or permissions mutated');
}

// A disposable schema inside a rolled-back transaction protects existing data.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {Pool}=await import('pg');
 if(!process.env.METADRIVE_TEST_DATABASE_URL)throw Error('Set METADRIVE_TEST_DATABASE_URL for SQL integration validation');
 const pool=new Pool({connectionString:process.env.METADRIVE_TEST_DATABASE_URL});
 const client=await pool.connect();let sequence=0;
 try{
  await client.query('BEGIN');
  const schema='md_binding_test_'+Date.now().toString(36);
  await client.query('CREATE SCHEMA '+schema);
  await client.query('SET LOCAL search_path TO '+schema);
  await verifyMetadataBindingsSql({
   exec:sql=>client.query(sql),query:(sql,params)=>client.query(sql,params),
   transaction:async fn=>{
    const point='binding_'+(++sequence);await client.query('SAVEPOINT '+point);
    try{const result=await fn(client);await client.query('RELEASE SAVEPOINT '+point);return result;}
    catch(error){await client.query('ROLLBACK TO SAVEPOINT '+point);throw error;}
   }
  });
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
}

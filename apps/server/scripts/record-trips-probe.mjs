// Counts SQL round trips of a till-like tap (read product, find line, update line,
// re-read, reload cart lines and cart) on real PostgreSQL. Prints the numbers and
// fails if a step regresses past its budget. Run in CI with a disposable database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg,{Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {RecordEngine,withRecordReadScope} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';
import {withAuditContext,auditContext} from '../src/system-support/audit-context.ts';

 // TRIPS_TRACE=1 prints each statement of the page-code-scope tap (first 110 characters).
let trace=null;
const originalQuery=pg.Client.prototype.query;
pg.Client.prototype.query=function(...args){
 if(trace&&typeof args[0]==='string')trace.push(args[0].replace(/\s+/g,' ').slice(0,110));
 return originalQuery.apply(this,args);
};
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
// Extensions (pgcrypto, pg_trgm) were created by the earlier native test in its schema.
await setup.query('CREATE SCHEMA trips_probe');await setup.end();
const isolated=new URL(url);isolated.searchParams.set('options','-c search_path=trips_probe,native_api_test,public');
const db=new SqlPersistence(isolated.toString());
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db),records=new RecordEngine(db,new RbacEngine(db));
 // As on the server: a record trigger handler is set (it makes saves re-read the record).
 records.setRecordTriggerHandler(async()=>undefined);
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('trips','trips') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'trips@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Trips') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
 await definitions.create(tenant,'ProbeProduct','Probe product',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Price',label:'Price',dataType:'Number(12,2)'}]);
 await definitions.create(tenant,'ProbeCart','Probe cart',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'Status',label:'Status',dataType:'Text(80)'}]);
 await definitions.create(tenant,'ProbeLine','Probe line',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'CartId',label:'Cart',dataType:'Lookup',relatedObject:'ProbeCart'},
  {apiName:'ProductId',label:'Product',dataType:'Lookup',relatedObject:'ProbeProduct'},
  {apiName:'Qty',label:'Qty',dataType:'Number(12,2)'},
  {apiName:'Amount',label:'Amount',dataType:'Number(12,2)'}]);
 for(const object of ['ProbeProduct','ProbeCart','ProbeLine'])await activateNativeObject(db,tenant,object);
 const product=await records.create(tenant,user,'ProbeProduct',{Name:'Cola',Price:1.5});
 const cart=await records.create(tenant,user,'ProbeCart',{Name:'Cart 1',Status:'Open'});
 const line=await records.create(tenant,user,'ProbeLine',{Name:'Cola',CartId:cart,ProductId:product,Qty:1,Amount:1.5});
 const steps=[];

 const tap=()=>db.transaction(async()=>{
  const measure=async(name,run)=>{
   const timing=auditContext().timing,before=timing.dbTrips;
   if(trace)trace.push('--- '+name);
   const value=await run();steps.push([name,timing.dbTrips-before]);return value;
  };
  const p=await measure('get product',()=>records.get(tenant,user,'ProbeProduct',product));
  const found=await measure('find line',()=>records.list(tenant,user,'ProbeLine',1,0,
   {filters:[{field:'CartId',operator:'eq',value:cart},{field:'ProductId',operator:'eq',value:product}]}));
  const l=found.records[0];
  await measure('update line',()=>records.update(tenant,user,'ProbeLine',line,{Qty:Number(l.Qty)+1,Amount:(Number(l.Qty)+1)*p.Price}));
  const reread=await measure('re-read line',()=>records.get(tenant,user,'ProbeLine',line));
  // The re-read after a save must show the saved values, never the values read before it.
  assert.equal(Number(reread.Qty),Number(l.Qty)+1,'re-read after save is fresh');
  await measure('create line',()=>records.create(tenant,user,'ProbeLine',{Name:'Tea',CartId:cart,ProductId:product,Qty:1,Amount:1}));
  await measure('cart lines',()=>records.list(tenant,user,'ProbeLine',100,0,{filters:[{field:'CartId',operator:'in',value:[cart]}]}));
  await measure('cart',()=>records.list(tenant,user,'ProbeCart',100,0,{filters:[{field:'Status',operator:'eq',value:'Open'}]}));
 });
 const run=async scoped=>{
  steps.length=0;
  const total=await withAuditContext({timing:{dbTrips:0,dbMs:0,started:performance.now()}},async()=>{
   await (scoped?withRecordReadScope(tap):tap());
   return auditContext().timing.dbTrips;
  });
  console.info((scoped?'page-code scope':'plain')+': '+total+' SQL trips | '+steps.map(([n,t])=>n+' '+t).join(', '));
  return total;
 };
 await run(false);
 if(process.env.TRIPS_TRACE)trace=[];
 const scoped=await run(true);
 if(trace){console.info(trace.join('\n'));trace=null;}
 // Budget for one till tap inside the page-code scope (was far higher before batching).
 assert(scoped<=Number(process.env.TRIPS_BUDGET??999),'SQL trips over budget: '+scoped);
 const lines=await records.list(tenant,user,'ProbeLine',100,0,{filters:[{field:'CartId',operator:'eq',value:cart}]});
 assert.equal(lines.total,3);
 assert.equal(lines.records.find(r=>r.Id===line).Qty,3);
}finally{await db.close();}

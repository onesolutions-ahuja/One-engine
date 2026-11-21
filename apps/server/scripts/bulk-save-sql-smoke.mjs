// Bulk saves on real PostgreSQL: the same results as saving one by one (values, auto
// numbers, roll-ups to the parent), a failure inside a batch leaves exactly what one-by-one
// leaves, rules switch the batch to one by one, and 100 records save within a time budget.
// Run in CI with a disposable database (BULK_BUDGET_MS sets the 100-record budget).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {SqlPersistence} from '../src/system-files/sql-persistence.ts';
import {applySystemMigrations} from '../src/system-support/system-migrations.ts';
import {activateNativeObject} from '../src/system-support/native-object-storage.ts';
import {ObjectDefinitionService} from '../src/system-files/object-definition.ts';
import {RecordEngine,withRecordReadScope} from '../src/system-files/record-engine.ts';
import {RbacEngine} from '../src/system-files/rbac-engine.ts';
import {withAuditContext,auditContext} from '../src/system-support/audit-context.ts';

const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/metadrive_native_copy_test')throw Error('Disposable SQL database required');
const setup=new Pool({connectionString:url});
await setup.query('CREATE SCHEMA bulk_probe');await setup.end();
const isolated=new URL(url);isolated.searchParams.set('options','-c search_path=bulk_probe,native_api_test,public');
const db=new SqlPersistence(isolated.toString());
try{
 await db.query(readFileSync(new URL('../src/system-files/schema.sql',import.meta.url),'utf8'));
 await applySystemMigrations(db);
 const definitions=new ObjectDefinitionService(db),records=new RecordEngine(db,new RbacEngine(db));
 // As on the server: Flows are wired in; here no Flow exists for these Objects.
 records.setRecordTriggerHandler(async()=>undefined);
 records.setRecordTriggerProbe(async()=>false);
 const tenant=(await db.query("INSERT INTO md_tenants(slug,name) VALUES('bulk','bulk') RETURNING id")).rows[0].id;
 const user=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'bulk@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const set=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Bulk') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,user,set]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",[tenant,set]);
 await definitions.create(tenant,'BulkCart','Bulk cart',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true}]);
 await definitions.create(tenant,'BulkLine','Bulk line',[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'CartId',label:'Cart',dataType:'Lookup',relatedObject:'BulkCart'},
  {apiName:'Qty',label:'Qty',dataType:'Number(12,2)'},
  {apiName:'Paid',label:'Paid',dataType:'Checkbox'},
  {apiName:'LineNo',label:'Line number',dataType:'Auto Number',autoNumberFormat:'L-{0000}'}]);
 for(const object of ['BulkCart','BulkLine'])await activateNativeObject(db,tenant,object);
 const carts=[];
 for(const name of ['A','B'])carts.push(await records.create(tenant,user,'BulkCart',{Name:name}));
 const lines=(cart,count,from=0)=>Array.from({length:count},(_,index)=>
  ({Name:'Line '+(from+index),CartId:cart,Qty:from+index,Paid:index%2===0}));
 const action=run=>withAuditContext({timing:{dbTrips:0,dbMs:0,started:performance.now()}},
  ()=>db.transaction(()=>withRecordReadScope(async()=>{
   const started=performance.now(),value=await run();
   return {value,ms:performance.now()-started,trips:auditContext().timing.dbTrips};
  })));
 const read=async ids=>(await records.list(tenant,user,'BulkLine',100,0,
  {filters:[{field:'Id',operator:'in',value:ids}],sortField:'Name'})).records
  .map(({Name,CartId,Qty,Paid,LineNo})=>({Name,CartId,Qty,Paid,LineNo}));

 // 1. Same records as one by one: values and auto numbers continue in order.
 const single=await action(async()=>{const ids=[];for(const values of lines(carts[0],5))ids.push(await records.create(tenant,user,'BulkLine',values));return ids;});
 const bulk=await action(()=>records.createMany(tenant,user,'BulkLine',lines(carts[0],5,5)));
 assert.equal(bulk.value.length,5);
 const one=await read(single.value),many=await read(bulk.value);
 assert.deepEqual(many.map(row=>row.LineNo),['L-0006','L-0007','L-0008','L-0009','L-0010'],'auto numbers continue in order');
 assert.deepEqual(many.map(({LineNo,...row})=>row),lines(carts[0],5,5).map(row=>({...row,Qty:row.Qty})),'bulk values');
 assert.deepEqual(one.map(row=>row.LineNo),['L-0001','L-0002','L-0003','L-0004','L-0005']);

 // 2. Bulk update: same as one by one, including moving lines to another cart.
 await action(()=>records.updateMany(tenant,user,'BulkLine',bulk.value.map((id,index)=>({id,values:{Qty:100+index,CartId:carts[1]}}))));
 const moved=await read(bulk.value);
 assert.deepEqual(moved.map(row=>[row.Qty,row.CartId]),bulk.value.map((_,index)=>[100+index,carts[1]]));

 // 3. A failure part-way leaves exactly what one by one leaves (earlier records saved).
 const missing='00000000-0000-4000-8000-000000000000';
 const partial=await db.transaction(async client=>{
  try{
   await records.updateMany(tenant,user,'BulkLine',[
    {id:single.value[0],values:{Qty:900}},{id:single.value[1],values:{Qty:901}},
    {id:missing,values:{Qty:902}},{id:single.value[2],values:{Qty:903}}],client);
   return 'no error';
  }catch(error){
   const rows=await read(single.value);
   return error.message+' | '+rows.map(row=>row.Qty).join(',');
  }
 });
 assert.equal(partial,'Record not found | 900,901,2,3,4','one by one up to the failing record');

 // 4. A validation rule: the batch is saved one by one (the rule sees each record in turn).
 await db.query(`INSERT INTO md_validation_rules(tenant_id,object_api,api_name,label,expression,error_message,error_field_api,active)
  VALUES($1,'BulkLine','NoBad','No bad','BEGINS($Record.Name, "Bad")','Name cannot start with Bad','Name',true)`,[tenant]);
 const ruled=await action(async()=>{
  try{await records.createMany(tenant,user,'BulkLine',[{Name:'Good 1',CartId:carts[0]},{Name:'Bad 2',CartId:carts[0]}]);return 'saved';}
  catch(error){return error.message;}
 });
 assert.match(ruled.value,/Name cannot start with Bad/);
 await db.query("DELETE FROM md_validation_rules WHERE tenant_id=$1 AND api_name='NoBad'",[tenant]);

 // 5. Speed: 100 records in one action (page-code scope), bulk against one by one.
 const timedBulk=await action(()=>records.createMany(tenant,user,'BulkLine',lines(carts[0],100,1000)));
 const timedSingle=await action(async()=>{for(const values of lines(carts[1],100,2000))await records.create(tenant,user,'BulkLine',values);});
 const updates=timedBulk.value.map((id,index)=>({id,values:{Qty:index,Paid:true}}));
 const timedUpdate=await action(()=>records.updateMany(tenant,user,'BulkLine',updates));
 console.info('100 records: bulk create '+timedBulk.ms.toFixed(0)+' ms ('+timedBulk.trips+' SQL trips), one by one '
  +timedSingle.ms.toFixed(0)+' ms ('+timedSingle.trips+' trips), bulk update '+timedUpdate.ms.toFixed(0)+' ms ('
  +timedUpdate.trips+' trips)');
 assert.equal((await read(timedBulk.value)).length,100);
 assert(timedBulk.trips<=30,'bulk create of 100 records takes few SQL trips: '+timedBulk.trips);
 assert(timedUpdate.trips<=30,'bulk update of 100 records takes few SQL trips: '+timedUpdate.trips);
 // 6. The once-per-Object access shortcut used by bulk updates gives exactly md_record_access.
 const other=(await db.query("INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'other@example.invalid','fixture') RETURNING id",[tenant])).rows[0].id;
 const limited=(await db.query("INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'Editor') RETURNING id",[tenant])).rows[0].id;
 await db.query('INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)',[tenant,other,limited]);
 for(const [resource,act] of [['BulkLine','read'],['BulkLine','edit'],['BulkLine.*','read'],['BulkLine.*','edit']])
  await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,$3,$4,'allow')",[tenant,limited,resource,act]);
 for(const sharing of ['Private','Public Read Only','Public Read/Write'])for(const who of [user,other])for(const act of ['edit','read']){
  await db.query("INSERT INTO md_sharing_settings(tenant_id,object_api,default_access) VALUES($1,'BulkLine',$2) ON CONFLICT(tenant_id,object_api) DO UPDATE SET default_access=$2",[tenant,sharing]);
  const {rows:[counts]}=await db.query(`WITH access_fast AS MATERIALIZED (SELECT md_object_access_fast($1,$2,'BulkLine',$3) AS fast)
   SELECT count(*) FILTER (WHERE md_record_access($1,$2,r.id,$3))::integer AS exact,
    count(*) FILTER (WHERE CASE WHEN (SELECT fast FROM access_fast) THEN NOT r.is_deleted
     AND (r.record_type_id IS NULL OR md_rbac_allowed($1,$2,'RecordType:'||r.object_api||'.'||r.record_type_id,'read'))
     ELSE md_record_access($1,$2,r.id,$3) END)::integer AS fast
   FROM md_records r WHERE r.tenant_id=$1 AND r.object_api='BulkLine' AND r.id=ANY($4::uuid[])`,[tenant,who,act,single.value]);
  assert.equal(counts.fast,counts.exact,sharing+' '+act+': shortcut = per-record access');
 }
 // Bulk and one by one give the same outcome for another user (each tried, then undone).
 const outcome=run=>db.transaction(async client=>{
  let result;
  try{await run(client);result='saved';}catch(error){result=error.message;}
  throw Object.assign(Error('undo'),{result});
 }).catch(error=>error.result??error.message);
 const items=single.value.slice(0,3).map(id=>({id,values:{Qty:5}}));
 for(const sharing of ['Public Read/Write','Private']){
  await db.query("UPDATE md_sharing_settings SET default_access=$2 WHERE tenant_id=$1 AND object_api='BulkLine'",[tenant,sharing]);
  const bulkResult=await outcome(client=>records.updateMany(tenant,other,'BulkLine',items,client));
  const singleResult=await outcome(async client=>{for(const item of items)await records.update(tenant,other,'BulkLine',item.id,item.values,undefined,client,true);});
  assert.equal(bulkResult,singleResult,sharing+': bulk and one by one agree');
 }
 const budget=Number(process.env.BULK_BUDGET_MS??100000);
 assert(timedBulk.ms<=budget,'100-record bulk save took '+timedBulk.ms.toFixed(0)+' ms (budget '+budget+' ms)');
}finally{await db.close();}

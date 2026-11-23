import {resolvePrintValue} from '../src/system-support/backend-print-template-pdf-service.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {seedEposObjects,EPOS_OBJECTS} from '../src/app-seeders/core-epos-objects.js';
import {changeSetupRecord,setupRecords} from '../src/system-support/setup-records.js';
import {receiptSettings,receiptValue} from '../src/expression-engine/ReceiptSettings.js';

test('receipt settings preserve zero, false, optional blanks and enforce their limits',()=>{
 const read=(key:string,value:unknown)=>receiptValue(receiptSettings.find(s=>s.key===key)!,value);
 assert.equal(read('refundDays',0),0);
 assert.equal(read('autoPrintReceipt',false),false);
 assert.equal(read('giftCardValidMonths',''),null);
 assert.equal(read('cashRoundingStep','0.10'),0.1);
 assert.equal(read('serviceChargePercent',12.25),12.25);
 for(const [key,value] of [['refundDays',3651],['giftCardValidMonths',0.1],['receiptQrUrl','http://example.com'],
  ['serviceChargePercent',1.234],['showVatBreakdown','false'],['vatNumber','a'.repeat(41)]])assert.throws(()=>read(String(key),value));
});

test('print templates resolve company fields in formulas and captions',()=>{
 const company={vatnumber:'GB123',refunddays:21};
 assert.equal(resolvePrintValue('VAT: @ThisTenant.Company.VatNumber',{},'Invoice',company),'VAT: GB123');
 assert.equal(resolvePrintValue('=@ThisTenant.Company.RefundDays + 1',{},'Invoice',company),'22');
 assert.throws(()=>resolvePrintValue('@ThisTenant.Company.Missing',{},'Invoice',company),/Unknown tenant value/);
});

test('setup writes require Manage Users before executing SQL',async()=>{
 const db={transaction:(fn:Function)=>fn({query(){throw Error('unexpected write');}})};
 const blocked={require:async(_t:string,_u:string,resource:string)=>{assert.equal(resource,'SystemPermission:ManageUsers');throw Error('Permission denied');}};
 for(const args of [{User:'u',PermissionSet:'s'},null])await assert.rejects(
  changeSetupRecord(db as never,blocked as never,'t','u','UserPermissionSet',args,'id'),/Permission denied/);
});

test('Postgres seeds preserve tenant edits and setup record grants round-trip',{skip:!process.env.EPOS_TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:process.env.EPOS_TEST_DATABASE_URL!});
 const client=await pool.connect();
 const tenant='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 try{
  await client.query(`CREATE TEMP TABLE md_object_definitions(tenant_id uuid,api_name text,label text,is_system boolean,deleted_at timestamp,PRIMARY KEY(tenant_id,api_name));
   CREATE TEMP TABLE md_field_definitions(tenant_id uuid,object_api text,api_name text,label text,data_type text,related_object text,max_length int,is_unique boolean,required boolean,deleted_at timestamp,formula_expression text,formula_return_type text,PRIMARY KEY(tenant_id,object_api,api_name));
   CREATE TEMP TABLE md_field_picklist_values(tenant_id uuid,object_api text,field_api text,value text,sort_order int,PRIMARY KEY(tenant_id,object_api,field_api,value));
   CREATE TEMP TABLE md_permission_sets(tenant_id uuid,id uuid DEFAULT gen_random_uuid(),api_name text,label text,description text,UNIQUE(tenant_id,api_name));
   CREATE TEMP TABLE md_permission_rules(tenant_id uuid,permission_set_id uuid,resource text,action text,effect text,UNIQUE(tenant_id,permission_set_id,resource,action));
   CREATE TEMP TABLE md_permission_assignments(tenant_id uuid,user_id uuid,permission_set_id uuid,PRIMARY KEY(tenant_id,user_id,permission_set_id));
   CREATE TEMP TABLE md_custom_permission_definitions(tenant_id uuid,name text,PRIMARY KEY(tenant_id,name));`);
  for(const obj of EPOS_OBJECTS.filter(o=>o.existing))await client.query('INSERT INTO md_object_definitions(tenant_id,api_name) VALUES($1,$2)',[tenant,obj.name]);
  await seedEposObjects(client,tenant);
  await client.query("UPDATE md_field_definitions SET label='Tenant note' WHERE object_api='Product' AND api_name='PopupNote'");
  const counts=async()=>{
   const out=[];
   for(const table of ['md_object_definitions','md_field_definitions','md_field_picklist_values','md_permission_rules','md_permission_sets'])
    out.push((await client.query('SELECT count(*) FROM '+table)).rows[0].count);
   return out;
  };
  const before=await counts();
  await seedEposObjects(client,tenant);
  assert.deepEqual(await counts(),before);
  assert.equal((await client.query("SELECT label FROM md_field_definitions WHERE object_api='Product' AND api_name='PopupNote'")).rows[0].label,'Tenant note');
  const rbac={require:async()=>{},allowedMany:async(_t:string,_u:string,c:unknown[])=>c.map(()=>true)};
  const db={query:client.query.bind(client),transaction:(fn:Function)=>fn(client)};
  const read=(name:Parameters<typeof setupRecords>[4])=>setupRecords(db as never,rbac as never,tenant,user,name,100,0);
  const set=(await read('PermissionSet')).records.find(r=>r.Name==='TillCashier')!.Id;
  const permission=(await read('CustomPermission')).records.find(r=>r.Name==='Till_Admin')!.Id;
  for(const [name,values] of [['PermissionSetCustomPermission',{PermissionSet:set,CustomPermission:permission}],['UserPermissionSet',{PermissionSet:set,User:user}]] as const){
   const id=await changeSetupRecord(db as never,rbac as never,tenant,user,name,values);
   assert.ok((await read(name)).records.some(r=>r.Id===id));
   await changeSetupRecord(db as never,rbac as never,tenant,user,name,null,id);
   assert.ok(!(await read(name)).records.some(r=>r.Id===id));
  }
 }finally{client.release();await pool.end();}
});

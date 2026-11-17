import test from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {parsePageReference} from '../../server/src/expression-engine/PageReferences.js';
import {buildPageCode,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode';
import {executePageCodeAction,parsePageCodeRequest} from '../../server/src/system-support/page-code-runtime';
import {deviceTill,setDeviceTill} from '../../server/src/system-support/till-assignment-service';
import {TILL_NUMBERING_FIELDS,LOCATION_NUMBERS_FORWARD_RULE,seedTillNumberingMetadata,seedTillNumberingStarters,
 tillNumberingReceipt} from '../../server/src/app-seeders/core-till-numbering';
import {evaluateFlowFormula,createFormulaEvaluationContext} from '../../server/src/system-files/flow-formula-runtime.js';
import {compileRecordFilterFormula} from '../src/core/pages/PageRuntime/recordFilterFormula';
import {resetDeviceTillForTests} from '../src/core/authentication/TillDevice/deviceTill';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

type Row=Record<string,unknown>;
const locationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tillId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deviceKey='0f8e2a4c-1d2b-4c3d-9e8f-123456789abc';

/** The invoice part of the till's "Complete sale" (the formula given to paste). */
const completeSale=`=ACTIONS(IF(OR(ISBLANK(@ThisPage.Till.Id), ISBLANK(@ThisPage.Till.Location)), STATE(payError, "Set this device up as a till first"), ACTIONS(
 UPDATERECORD(Location, @ThisPage.Till.Location, LastNumberedAt, NOW()),
 GETRECORD(Location, Id, @ThisPage.Till.Location, AS(loc)),
 UPDATERECORD(Location, loc.Id, NextInvoiceSeq, BLANKVALUE(loc.NextInvoiceSeq, 1) + 1),
 CREATERECORD(Invoice, InvoiceSeq, BLANKVALUE(loc.NextInvoiceSeq, 1), InvoiceNumber, "INV-" & loc.Code & "-" & TEXT(YEAR(TODAY())) & LPAD(MONTH(TODAY()), 2, "0") & LPAD(BLANKVALUE(loc.NextInvoiceSeq, 1), 6, "0"), Location, loc.Id, TillId, @ThisPage.Till.Id, UserId, @ThisTenant.User.Id, DeviceKey, @ThisPage.Device.Key, DeviceIp, @ThisPage.Device.Ip, DeviceAgent, @ThisPage.Device.Agent, AS(inv)))))`;

function fakeRecords(tables:Record<string,Row[]>){
 let next=0;
 const calls:string[]=[];
 const match=(row:Row,filters:Array<{field:string;value:unknown}>)=>filters.every(f=>String(row[f.field]??'')===String(f.value));
 return {calls,tables,records:{
  async list(_t:string,_u:string,object:string,limit:number,_o:number,options:{filters?:never[]}={}){
   calls.push('list '+object);
   const rows=(tables[object]??[]).filter(row=>match(row,options.filters??[]));
   return {records:rows.slice(0,limit).map(row=>({...row})),total:rows.length};
  },
  async get(_t:string,_u:string,object:string,id:string){calls.push('get '+object);return {...(tables[object]??[]).find(row=>row.Id===id)};},
  async create(_t:string,_u:string,object:string,values:Row){
   calls.push('create '+object);
   const id='00000000-0000-4000-8000-'+String(++next).padStart(12,'0');
   (tables[object]??=[]).push({Id:id,...values});
   return id;
  },
  async update(_t:string,_u:string,object:string,id:string,values:Row){
   calls.push('update '+object+' '+Object.keys(values).join(','));
   Object.assign(tables[object].find(row=>row.Id===id)!,values);
  },
  async remove(){throw Error('not used');}
 }};
}
const db={transaction:async<T>(run:()=>Promise<T>)=>run(),query:async()=>({rows:[]})};
const server=serverPageCode(buildPageCode({apiName:'smart_till_payment',components:[{id:'pay',objectApiName:'Cart',formulas:[],
 actions:[{event:'click',kind:'Formula',formula:completeSale}]}]} as never));
const yyyymm=()=>{const now=new Date();return String(now.getFullYear())+String(now.getMonth()+1).padStart(2,'0');};
const store=()=>fakeRecords({
 Location:[{Id:locationId,Name:'Location 1',Code:'LOC1',NextInvoiceSeq:158}],
 Till:[{Id:tillId,Name:'Till 1',Code:'TILL1',Location:locationId,Active:true,DeviceKey:deviceKey}],Invoice:[]});
const run=(fake:ReturnType<typeof store>,key=deviceKey)=>executePageCodeAction({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},
 server,'pay:click',parsePageCodeRequest({sessionId:'s-1',state:{},rowObject:'Cart',event:{},deviceKey:key},
  {ip:'203.0.113.7',agent:'Mozilla/5.0 (iPad)'}),'');

test('@ThisPage.Till.* and @ThisPage.Device.* are page values; a component named Till keeps its own values',()=>{
 assert.deepEqual(parsePageReference('@ThisPage.Till.Id'),{kind:'till',field:'Id'});
 assert.deepEqual(parsePageReference('@ThisPage.Till.LocationCode'),{kind:'till',field:'LocationCode'});
 assert.deepEqual(parsePageReference('@ThisPage.Device.Ip'),{kind:'device',field:'Ip'});
 assert.deepEqual(parsePageReference('@ThisPage.Till.value'),{kind:'component',name:'Till',key:'value'});
 const code=compileActionFormula(completeSale,'Cart').js;
 assert.match(code,/\$\.till\("Location"\)/);
 assert.match(code,/\$\.device\("Ip"\)/);
});

test('invoice number: Location locked first, counter read under the lock, number frozen on the Invoice',async()=>{
 const fake=store();
 // Another till takes numbers 158-169 while this one waits for the Location lock:
 // the counter must be read AFTER the lock, never from an earlier read.
 const update=fake.records.update;
 fake.records.update=async(t,u,object,id,values)=>{
  if(object==='Location'&&'LastNumberedAt' in values)fake.tables.Location[0].NextInvoiceSeq=170;
  return update(t,u,object,id,values);
 };
 const result=await run(fake);
 assert.equal(result.ok,true,result.error);
 const steps=fake.calls.filter(call=>/^update Location|^create Invoice/.test(call));
 assert.deepEqual(steps,['update Location LastNumberedAt','update Location NextInvoiceSeq','create Invoice']);
 const invoice=fake.tables.Invoice[0];
 assert.equal(invoice.InvoiceNumber,'INV-LOC1-'+yyyymm()+'000170');
 assert.equal(invoice.InvoiceSeq,170);
 assert.equal(invoice.Location,locationId);
 assert.equal(invoice.TillId,tillId);
 assert.equal(invoice.DeviceKey,deviceKey);
 // IP and browser are what the server saw, never what the browser sent.
 assert.equal(invoice.DeviceIp,'203.0.113.7');
 assert.equal(invoice.DeviceAgent,'Mozilla/5.0 (iPad)');
 assert.equal(fake.tables.Location[0].NextInvoiceSeq,171);
 fake.records.update=update;
 await run(fake);
 assert.equal(fake.tables.Invoice[1].InvoiceNumber,'INV-LOC1-'+yyyymm()+'000171');
});

test('a prefix change only affects new numbers; old invoices keep the number they were saved with',async()=>{
 const fake=store();
 await run(fake);
 fake.tables.Location[0].Code='LDN';
 await run(fake);
 assert.equal(fake.tables.Invoice[0].InvoiceNumber,'INV-LOC1-'+yyyymm()+'000158');
 assert.equal(fake.tables.Invoice[1].InvoiceNumber,'INV-LDN-'+yyyymm()+'000159');
});

test('a device that is not set up as a Till (or an inactive Till) saves nothing and says so',async()=>{
 for(const fake of [store(),(()=>{const f=store();f.tables.Till[0].Active=false;return f;})()]){
  const result=await run(fake,fake.tables.Till[0].Active?'another-device-key-123':deviceKey);
  assert.equal(result.ok,true,result.error);
  assert.equal(fake.tables.Invoice.length,0);
  assert.equal(result.state.payError,'Set this device up as a till first');
 }
});

test('setting a device up: the key moves to the chosen Till, with who/where for audit',async()=>{
 const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const fake=store();
 fake.tables.Till.push({Id:other,Name:'Till 2',Code:'TILL2',Location:locationId,Active:true});
 const before=await deviceTill({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},'unknown-device-key-0001');
 assert.equal(before.till,null);
 assert.deepEqual(before.tills.map(t=>t.Code),['TILL1','TILL2']);
 const bound=await setDeviceTill({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},deviceKey,other,
  {ip:'198.51.100.2',agent:'UneTill/1.0'});
 assert.equal(bound.Id,other);
 assert.equal(bound.LocationCode,'LOC1');
 assert.equal(fake.tables.Till[0].DeviceKey,null,'the old Till lets the device go');
 assert.equal(fake.tables.Till[1].DeviceKey,deviceKey);
 assert.equal(fake.tables.Till[1].DeviceSetUpBy,'u');
 assert.equal(fake.tables.Till[1].DeviceIp,'198.51.100.2');
 await assert.rejects(setDeviceTill({db,records:fake.records} as never,{tenant_id:'t',user_id:'u'},'bad key',other),/device key/);
});

test('list filters can read the device Till (e.g. this till\'s held sales)',()=>{
 resetDeviceTillForTests({status:'set',tills:[],till:{Id:tillId,Name:'Till 1',Code:'TILL1',Location:locationId,LocationCode:'LOC1'}});
 const fields=[{apiName:'TillId',label:'Till',dataType:'Text'}] as FieldMetadata[];
 assert.deepEqual(compileRecordFilterFormula('@Cart.TillId = @ThisPage.Till.Id',fields).filters,
  [{field:'TillId',operator:'eq',value:tillId}]);
 resetDeviceTillForTests();
});

test('admins may move a counter forward, never back',()=>{
 // Same resolver and context as the validation rule engine.
 const check=(prior:Row,current:Row)=>evaluateFlowFormula(LOCATION_NUMBERS_FORWARD_RULE.expression,
  (name:string)=>current[name]??null,
  createFormulaEvaluationContext({currentRecord:current,priorRecord:prior,transactionStage:'update'}),'validation_rule');
 assert.equal(check({NextInvoiceSeq:158,NextOrderSeq:98},{NextInvoiceSeq:500,NextOrderSeq:98}),false);
 assert.equal(check({NextInvoiceSeq:158,NextOrderSeq:98},{NextInvoiceSeq:157,NextOrderSeq:98}),true);
 assert.equal(check({NextInvoiceSeq:158,NextOrderSeq:98},{NextInvoiceSeq:158,NextOrderSeq:1}),true);
});

/** SQL recorder: answers the few reads the seeder makes. */
function fakeClient(answers:{order?:boolean;receipt?:boolean;native?:string[];used?:string[];firstLocation?:string}){
 const calls:Array<{sql:string;params:unknown[]}>=[];
 let ids=0;
 const client={async query(sql:string,params:unknown[]=[]){
  calls.push({sql,params});
  if(sql.includes('FROM md_object_definitions WHERE'))return {rows:[],rowCount:answers.order?1:0};
  if(sql.includes('FROM md_system_migrations'))return {rows:[],rowCount:answers.receipt?1:0};
  if(sql.includes('FROM md_native_objects o'))return {rows:[{table_name:'md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',field_api:'Name',column_name:null,sql_type:'text',data_type:'text'},
   ...['Code','DeviceKey'].map(f=>({table_name:'md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',field_api:f,column_name:null,sql_type:'text',data_type:'text'})),
   ...['NextOrderSeq','NextInvoiceSeq'].map(f=>({table_name:'md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',field_api:f,column_name:null,sql_type:'numeric',data_type:'number'})),
   {table_name:'md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',field_api:'Active',column_name:null,sql_type:'boolean',data_type:'boolean'},
   {table_name:'md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',field_api:'Location',column_name:null,sql_type:'uuid',data_type:'reference'}],rowCount:7};
  if(sql.includes('FROM md_native_objects'))return {rows:(answers.native??[]).map(object_api=>({object_api})),rowCount:0};
  if(sql.includes('SELECT DISTINCT object_api FROM md_records'))return {rows:(answers.used??[]).map(object_api=>({object_api})),rowCount:0};
  if(sql.includes("object_api='Location'")&&sql.includes('ORDER BY created_at'))return {rows:answers.firstLocation?[{id:answers.firstLocation}]:[],rowCount:1};
  if(sql.includes('INSERT INTO md_records'))return {rows:[{id:'99999999-0000-4000-8000-00000000000'+(++ids)}],rowCount:1};
  return {rows:[{id:'x'}],rowCount:1};
 }} as unknown as PoolClient;
 return {client,calls};
}

test('catalog: Till object, unique codes/numbers, counters; Order fields only once an app brings Order',async()=>{
 const till=TILL_NUMBERING_FIELDS.find(o=>o.object==='Till')!;
 assert.deepEqual(till.fields.slice(0,4).map(f=>f.api),['Name','Code','Location','Active']);
 const unique=TILL_NUMBERING_FIELDS.flatMap(o=>o.fields.filter(f=>f.unique).map(f=>o.object+'.'+f.api)).sort();
 assert.deepEqual(unique,['Invoice.InvoiceNumber','Location.Code','Order.OrderNumber','Till.Code','Till.DeviceKey']);
 for(const object of ['Cart','Invoice','Order','CashLedger'])
  assert.ok(TILL_NUMBERING_FIELDS.find(o=>o.object===object)!.fields.some(f=>f.api==='TillId'),object+'.TillId');
 const without=fakeClient({});
 await seedTillNumberingMetadata(without.client,'t');
 assert.ok(!without.calls.some(c=>c.params[1]==='Order'&&c.sql.includes('md_field_definitions')));
 assert.ok(without.calls.some(c=>c.sql.includes('md_validation_rules')&&c.params.includes('NumbersOnlyMoveForward')));
 const withOrder=fakeClient({order:true});
 await seedTillNumberingMetadata(withOrder.client,'t');
 assert.ok(withOrder.calls.some(c=>c.params[1]==='Order'&&c.params[2]==='OrderNumber'&&c.params[6]===true));
 assert.ok(withOrder.calls.every(c=>!/INSERT/.test(c.sql)||/ON CONFLICT/.test(c.sql)),'never overwrites tenant metadata');
});

test('starter Location LOC1 + Till 1: once per tenant, never brought back after deletion',async()=>{
 const fresh=fakeClient({native:['Location','Till']});
 assert.equal(await seedTillNumberingStarters(fresh.client,'t'),'seeded');
 const records=fresh.calls.filter(c=>c.sql.includes('INSERT INTO md_records')).map(c=>c.params[1]);
 assert.deepEqual(records,['Location','Till']);
 const values=fresh.calls.filter(c=>c.sql.startsWith('UPDATE ')&&c.sql.includes('extras')).map(c=>JSON.stringify(c.params));
 assert.ok(values.some(v=>v.includes('LOC1')&&v.includes('Location 1')));
 assert.ok(values.some(v=>v.includes('TILL1')&&v.includes('Till 1')));
 assert.ok(fresh.calls.some(c=>c.sql.includes('INSERT INTO md_system_migrations')&&c.params[0]===tillNumberingReceipt('t')));
 // Second start: the receipt says done.
 assert.equal(await seedTillNumberingStarters(fakeClient({receipt:true,native:['Location','Till']}).client,'t'),'done');
 // Tenant had Locations (even deleted ones): no LOC1; Till 1 goes to its first Location.
 const existing=fakeClient({native:['Location','Till'],used:['Location'],firstLocation:locationId});
 await seedTillNumberingStarters(existing.client,'t');
 assert.deepEqual(existing.calls.filter(c=>c.sql.includes('INSERT INTO md_records')).map(c=>c.params[1]),['Till']);
 // Record tables not ready yet: try again at the next start, no receipt.
 const waiting=fakeClient({native:['Location']});
 assert.equal(await seedTillNumberingStarters(waiting.client,'t'),'waiting');
 assert.ok(!waiting.calls.some(c=>c.sql.includes('INSERT')));
});

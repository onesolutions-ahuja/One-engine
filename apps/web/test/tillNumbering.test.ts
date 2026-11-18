import test from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {parsePageReference} from '../../server/src/expression-engine/PageReferences.js';
import {buildPageCode,serverPageCode} from '../../server/src/page-compiler/code/pageCode';
import {compileActionFormula} from '../../server/src/page-compiler/code/generateCode';
import {executePageCodeAction,parsePageCodeRequest} from '../../server/src/system-support/page-code-runtime';
import {deviceTill,setDeviceTill} from '../../server/src/system-support/till-assignment-service';
import {TILL_NUMBERING_FIELDS,seedTillNumberingMetadata,seedTillNumberingStarters,
 tillNumberingReceipt} from '../../server/src/app-seeders/core-till-numbering';
import {autoNumberFieldTokens,autoNumberScopeTypeAllowed,autoNumberSeriesKey,nextScopedAutoNumber,setScopedAutoNumberStart} from '../../server/src/field-engine/types/AutoNumberScope';
import {autoNumberSettings,setAutoNumberScope} from '../../server/src/api/AutoNumberSettingsController';
import {formatAutoNumberValue} from '../../server/src/field-engine/types/AutoNumberField';
import {compileRecordFilterFormula} from '../src/core/pages/PageRuntime/recordFilterFormula';
import {resetDeviceTillForTests} from '../src/core/authentication/TillDevice/deviceTill';
import type {FieldMetadata} from '../src/core/metadata/Definitions/metadata';

type Row=Record<string,unknown>;
const locationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tillId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deviceKey='0f8e2a4c-1d2b-4c3d-9e8f-123456789abc';

/** The invoice part of the till's "Complete sale": no number formula, the system numbers it. */
const completeSale=`=ACTIONS(CREATERECORD(Invoice, Location, @ThisPage.Till.Location, TillId, @ThisPage.Till.Id, UserId, @ThisTenant.User.Id, DeviceKey, @ThisPage.Device.Key, DeviceIp, @ThisPage.Device.Ip, DeviceAgent, @ThisPage.Device.Agent, InvoiceType, "Sale", AS(inv)))`;

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

test('a sale is saved with the device\'s Till, its Location, the user and the device (IP/browser seen by the server)',async()=>{
 const fake=store();
 const result=await run(fake);
 assert.equal(result.ok,true,result.error);
 const invoice=fake.tables.Invoice[0];
 assert.equal(invoice.Location,locationId,'the Location decides the number series');
 assert.equal(invoice.TillId,tillId);
 assert.equal(invoice.DeviceKey,deviceKey);
 assert.equal(invoice.DeviceIp,'203.0.113.7');
 assert.equal(invoice.DeviceAgent,'Mozilla/5.0 (iPad)');
 assert.equal('InvoiceNumber' in invoice,false,'the number is given by the system on save, not by the formula');
});

test('a device that is not set up as a Till (or an inactive Till): no Till or Location is saved on the sale',async()=>{
 for(const fake of [store(),(()=>{const f=store();f.tables.Till[0].Active=false;return f;})()]){
  const result=await run(fake,fake.tables.Till[0].Active?'another-device-key-123':deviceKey);
  assert.equal(result.ok,true,result.error);
  assert.equal(fake.tables.Invoice[0].TillId,'');
  assert.equal(fake.tables.Invoice[0].Location,'');
 }
});

/** Counter SQL recorder (the real SQL was checked on PostgreSQL 16: 20 parallel saves, no repeats). */
function counterClient(start:Record<string,number>={}){
 const next=new Map(Object.entries(start));
 const sql:string[]=[];
 return {sql,next,client:{async query(text:string,params:unknown[]){
  sql.push(text);
  const value=String(params[3]);
  if(/DO UPDATE SET next_value=md_auto_number_scoped_counters.next_value\+1/.test(text)){
   const now=next.get(value)??1;next.set(value,now+1);return {rows:[{sequence:String(now)}]};
  }
  const wanted=Number(params[4]);
  if((next.get(value)??1)>wanted)return {rows:[]};
  next.set(value,wanted);return {rows:[{next_value:String(wanted)}]};
 }} as unknown as PoolClient};
}

test('Auto Number per Location: each shop has its own series; an admin moves a series forward, never back',async()=>{
 const {client,next}=counterClient();
 const give=async(loc:string)=>formatAutoNumberValue('INV-{0}',await nextScopedAutoNumber(client,'t','Invoice','InvoiceNumber',loc));
 assert.equal(await give('LOC1'),'INV-1');
 assert.equal(await give('LOC1'),'INV-2');
 assert.equal(await give('LOC2'),'INV-1');
 assert.equal(await setScopedAutoNumberStart(client,'t','Invoice','InvoiceNumber','LOC1',838382),838382);
 assert.equal(await give('LOC1'),'INV-838382');
 await assert.rejects(setScopedAutoNumberStart(client,'t','Invoice','InvoiceNumber','LOC1',5),/only move forward/);
 await assert.rejects(setScopedAutoNumberStart(client,'t','Invoice','InvoiceNumber','LOC1',0),/above 0/);
 assert.equal(next.get('LOC2'),2);
 assert.equal(formatAutoNumberValue('{0}',7),'7','no padding unless the format asks for it');
});

test('two fields split the series and the type shows in the number: INV-… sales, SRN-… returns per shop',async()=>{
 const {client}=counterClient();
 const give=async(loc:string,type:string)=>formatAutoNumberValue(
  autoNumberFieldTokens('{InvoiceType}-{0}',name=>name==='InvoiceType'?type:''),
  await nextScopedAutoNumber(client,'t','Invoice','InvoiceNumber',autoNumberSeriesKey([loc,type])));
 assert.equal(await give('LOC1','INV'),'INV-1');
 assert.equal(await give('LOC1','SRN'),'SRN-1');
 assert.equal(await give('LOC1','INV'),'INV-2');
 assert.equal(await give('LOC2','INV'),'INV-1');
 // An invoice with no Location (e.g. made by Smart Assist) has its own series.
 assert.equal(autoNumberSeriesKey(['','INV']),'\u2205|INV');
 assert.equal(autoNumberFieldTokens('{YYYY}/{Code}-{000}',()=>'A{B}'),'{YYYY}/AB-{000}');
});

test('"Number separately for each": a Lookup or Picklist field of the Object, fixed once numbers exist',async()=>{
 assert.ok(['reference','Lookup','Master-Detail','picklist'].every(autoNumberScopeTypeAllowed));
 assert.ok(['text'].every(type=>!autoNumberScopeTypeAllowed(type)));
 assert.ok(!['text','number','autonumber'].some(autoNumberScopeTypeAllowed));
 const fields=[{api_name:'InvoiceNumber',label:'Invoice Number',data_type:'autonumber',related_object:null,auto_number_scope_field:null},
  {api_name:'Location',label:'Store / Location',data_type:'reference',related_object:'Location',auto_number_scope_field:null},
  {api_name:'Notes',label:'Notes',data_type:'text',related_object:null,auto_number_scope_field:null}];
 let issued=0;
 const writes:unknown[][]=[];
 const db={async query(sql:string,params:unknown[]){
  if(sql.includes('FROM md_field_definitions'))return {rows:fields};
  if(sql.includes('scope_value,next_value'))return {rows:[]};
  if(sql.includes('AS n'))return {rows:[{n:String(issued)}]};
  if(sql.startsWith('UPDATE md_field_definitions')){writes.push(params);fields[0].auto_number_scope_field=params[3] as never;return {rows:[]};}
  return {rows:[]};
 }} as never;
 const before=await autoNumberSettings(db,'t','Invoice','InvoiceNumber');
 assert.deepEqual(before.scopeOptions.map(o=>o.apiName),['Location']);
 await assert.rejects(setAutoNumberScope(db,'t','Invoice','InvoiceNumber','Notes'),/Lookup or Picklist/);
 await assert.rejects(setAutoNumberScope(db,'t','Invoice','InvoiceNumber','Location,Notes,Location2'),/at most two/);
 const after=await setAutoNumberScope(db,'t','Invoice','InvoiceNumber','Location');
 assert.equal(after.scopeField,'Location');
 issued=1;
 await assert.rejects(setAutoNumberScope(db,'t','Invoice','InvoiceNumber',''),/already given numbers/);
 await assert.rejects(autoNumberSettings(db,'t','Invoice','Location'),/Not an Auto Number/);
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

test('catalog: Till object, unique codes, Auto Number per Location; Order fields only once an app brings Order',async()=>{
 const till=TILL_NUMBERING_FIELDS.find(o=>o.object==='Till')!;
 assert.deepEqual(till.fields.slice(0,4).map(f=>f.api),['Name','Code','Location','Active']);
 const unique=TILL_NUMBERING_FIELDS.flatMap(o=>o.fields.filter(f=>f.unique).map(f=>o.object+'.'+f.api)).sort();
 assert.deepEqual(unique,['Location.Code','Till.Code','Till.DeviceKey']);
 const numbers=TILL_NUMBERING_FIELDS.flatMap(o=>o.fields.filter(f=>f.type==='autonumber').map(f=>[o.object,f.api,f.format,f.per]));
 assert.deepEqual(numbers,[['Invoice','InvoiceNumber','{InvoiceType}-{0}','Location,InvoiceType'],['Order','OrderNumber','ORD-{0}','Location']]);
 for(const object of ['Cart','Invoice','Order','CashLedger'])
  assert.ok(TILL_NUMBERING_FIELDS.find(o=>o.object===object)!.fields.some(f=>f.api==='TillId'),object+'.TillId');
 const without=fakeClient({});
 await seedTillNumberingMetadata(without.client,'t');
 assert.ok(!without.calls.some(c=>c.params[1]==='Order'&&c.sql.includes('md_field_definitions')));
 assert.ok(!without.calls.some(c=>c.sql.includes('md_validation_rules')));
 const withOrder=fakeClient({order:true});
 await seedTillNumberingMetadata(withOrder.client,'t');
 assert.ok(withOrder.calls.some(c=>c.params[1]==='Order'&&c.params[2]==='OrderNumber'&&c.params[4]==='autonumber'
  &&c.params[7]==='ORD-{0}'&&c.params[8]==='Location'));
 assert.ok(withOrder.calls.every(c=>!/INSERT/.test(c.sql)||/ON CONFLICT/.test(c.sql)),'never overwrites tenant metadata');
});

test('starter Location LOC1 + Till 1: once per tenant, never brought back after deletion',async()=>{
 const fresh=fakeClient({native:['Location','Till']});
 assert.equal(await seedTillNumberingStarters(fresh.client,'t'),'seeded');
 // The older Text InvoiceNumber becomes the Auto Number per Location; Invoice/Order can't be deleted.
 assert.ok(fresh.calls.some(c=>c.sql.includes("SET data_type='autonumber'")&&c.params[2]==='InvoiceNumber'
  &&c.params[3]==='{InvoiceType}-{0}'&&c.params[4]==='Location,InvoiceType'));
 assert.ok(fresh.calls.some(c=>c.sql.includes("SET data_type='picklist'")&&c.params[2]==='InvoiceType'&&c.params[3]==='INV'));
 assert.ok(fresh.calls.some(c=>c.sql.includes('md_field_picklist_values')&&c.params[3]==='SRN'));
 assert.ok(fresh.calls.some(c=>c.sql.includes('prevent_delete=true')&&JSON.stringify(c.params[1])==='["Invoice","Order"]'));
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

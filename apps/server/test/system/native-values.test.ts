import test from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import type {RecordStoredValue} from '../../src/system-files/record-value-write.js';
import {loadNativeFields,nativeTableSql,nativeValueSql,readNativeValueRows,
 type NativeFieldsMetadata} from '../../src/system-files/native-object-query.js';
import {writeNativeValues} from '../../src/system-files/native-values.js';

const table='md_object_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const column='f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const tenant='11111111-1111-4111-8111-111111111111';
const record='22222222-2222-4222-8222-222222222222';
const metadataRow=(name:string|null,sqlType:string|null='text',col:string|null=null)=>({
 table_name:table,field_api:name,column_name:col,sql_type:sqlType,data_type:sqlType
});
const scalar=(override:Partial<RecordStoredValue>={}):RecordStoredValue=>({
 value_text:null,reference_record_id:null,is_unique:false,case_sensitive:false,...override
});
function fixture(rows:ReturnType<typeof metadataRow>[],updated=true){
 const calls:Array<{sql:string;params:unknown[]}>=[]; 
 const client={
  async query(sql:string,params:unknown[]=[]){
   calls.push({sql,params});
   if(sql.includes('FROM md_native_objects o'))return {rows,rowCount:rows.length};
   return {rows:updated?[{id:record}]:[],rowCount:updated?1:0};
  }
 } as unknown as PoolClient;
 return {client,calls};
}

test('native metadata loads in one parameterized LEFT JOIN and requires an Object table',async()=>{
 const {client,calls}=fixture([metadataRow('Name','text',column),metadataRow('Custom','text')]);
 const meta=await loadNativeFields(client,tenant,'Product');
 assert.equal(calls.length,1);
 assert.match(calls[0].sql,/LEFT JOIN md_native_fields/);
 assert.deepEqual(calls[0].params,[tenant,'Product']);
 assert.equal(meta.table,table);
 assert.deepEqual(meta.fields.get('Name'),{column,sqlType:'text',dataType:'text'});
 assert.deepEqual(meta.fields.get('Custom'),{column:null,sqlType:'text',dataType:'text'});
 const emptyTable=await loadNativeFields(fixture([metadataRow(null,null)]).client,tenant,'Empty');
 assert.equal(emptyTable.fields.size,0,'An Object without fields still has a table');
 await assert.rejects(loadNativeFields(fixture([]).client,tenant,'Missing'),/Object has no native table/);
 await assert.rejects(loadNativeFields(fixture([{...metadataRow('Name'),table_name:'not_a_table'}]).client,
  tenant,'Product'),/Invalid native table/);
 await assert.rejects(loadNativeFields(fixture([metadataRow('Name','text','public.x')]).client,
  tenant,'Product'),/Invalid native field metadata/);
});

test('native SQL read helpers validate identifiers and produce the EAV-shaped lateral',()=>{
 const meta:NativeFieldsMetadata={table,fields:new Map([
  ['Name',{column,sqlType:'text',dataType:'text'}],
  ['Amount',{column:null,sqlType:'numeric',dataType:'number'}],
  ['Lookup',{column:null,sqlType:'uuid',dataType:'reference'}],
  ['Geo',{column:null,sqlType:'double precision[]',dataType:'geolocation'}],
  ['Address',{column:null,sqlType:'text[]',dataType:'address'}]
 ])};
 assert.equal(nativeTableSql(meta),'"'+table+'"');
 assert.equal(nativeValueSql(meta,'Name'),'nr."'+column+'"');
 assert.equal(nativeValueSql(meta,'Name','nr',true),'nr."'+column+'"::text');
 assert.equal(nativeValueSql(meta,'Amount'),"(CASE WHEN (nr.extras->>'Amount') ~ '^\\s*-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?\\s*$' THEN (nr.extras->>'Amount')::numeric END)");
 assert.match(nativeValueSql(meta,'Lookup'),/::uuid$/);
 assert.match(nativeValueSql(meta,'Geo'),/jsonb_array_elements_text/);
 assert.match(nativeValueSql(meta,'Geo'),/::double precision\[\]/);
 assert.match(nativeValueSql(meta,'Address'),/::text\[\]/);
 const sql=readNativeValueRows(meta,'records');
 assert.match(sql,/LEFT JOIN LATERAL/);
 assert.match(sql,/n.id=records.id/);
 for(const key of ['field_api','value_text','reference_record_id','value_number',
  'value_date','value_datetime','value_boolean','geo_latitude','geo_longitude',
  'address_street','address_city','address_state','address_postal_code','address_country'])
  assert.ok(sql.includes(key),key);
 assert.throws(()=>nativeValueSql(meta,'Missing'),/Native field metadata unavailable/);
 assert.throws(()=>nativeValueSql(meta,'Name','nr;DROP'),/Invalid native query alias/);
 assert.throws(()=>readNativeValueRows(meta,'r;DROP'),/Invalid native record alias/);
 assert.throws(()=>nativeTableSql({...meta,table:'md_records;DROP TABLE md_records'}),/Invalid native table/);
});

test('one UPDATE binds all eight SQL types for both typed columns and extras',async()=>{
 const cases:Array<{type:string;stored:RecordStoredValue;value:unknown}>=[
  {type:'text',stored:scalar({value_text:'O\'Brien'}),value:"O'Brien"},
  {type:'numeric',stored:scalar({value_text:'0',value_number:'12345678901234567890.123456'}),value:'12345678901234567890.123456'},
  {type:'boolean',stored:scalar({value_boolean:false}),value:false},
  {type:'uuid',stored:scalar({reference_record_id:record}),value:record},
  {type:'date',stored:scalar({value_date:'2026-11-16'}),value:'2026-11-16'},
  {type:'timestamptz',stored:scalar({value_datetime:new Date('2026-11-16T13:00:00Z')}),value:new Date('2026-11-16T13:00:00Z')},
  {type:'double precision[]',stored:scalar({geo_latitude:51.5,geo_longitude:-0.1}),value:[51.5,-0.1]},
  {type:'text[]',stored:scalar({address_street:'10 Road',address_city:'London'}),value:['10 Road','London',null,null,null]}
 ];
 const rows:ReturnType<typeof metadataRow>[]=[];
 const values=new Map<string,RecordStoredValue>();
 cases.forEach(({type,stored},index)=>{
  const col='f_'+(index+1).toString(16).padStart(32,'0');
  rows.push(metadataRow('Column'+index,type,col));
  rows.push(metadataRow('Extra'+index,type));
  values.set('Column'+index,stored);
  values.set('Extra'+index,stored);
 });
 const {client,calls}=fixture(rows);
 await writeNativeValues(client,tenant,'Product',record,values);
 assert.equal(calls.length,2,'Metadata SELECT and exactly one UPDATE for all fields');
 const update=calls[1];
 assert.match(update.sql,/^UPDATE "md_object_[a-f0-9]{32}" SET /);
 assert.doesNotMatch(update.sql,/md_record_values/);
 assert.match(update.sql,/extras=\(COALESCE\(extras/);
 assert.match(update.sql,/present_fields=/);
 assert.match(update.sql,/WHERE tenant_id=\$1 AND id=\$2 RETURNING id/);
 assert.deepEqual(update.params.slice(0,2),[tenant,record]);
 for(const {type,value} of cases){
  assert.ok(update.sql.includes('::'+type),'Postgres type cast: '+type);
  assert.ok(update.params.some(p=>JSON.stringify(p)===JSON.stringify(value)),'bound '+type);
 }
 for(let i=0;i<cases.length;i++)
  assert.ok(update.sql.includes('"f_'+(i+1).toString(16).padStart(32,'0')+'"='));
 assert.deepEqual(update.params.at(-1),[...values.keys()],
  'Every stored value, including false and arrays, is present');
 assert.ok(!update.sql.includes("O'Brien"),'User values cannot enter SQL text');
});

test('NULL and empty values clear typed columns, extras and present_fields; false and zero remain',async()=>{
 const rows=[
  metadataRow('Name','text',column),metadataRow('Price','numeric'),
  metadataRow('Flag','boolean'),metadataRow('Coordinates','double precision[]'),
  metadataRow('Address','text[]'),metadataRow('Selections','text')
 ];
 const values=new Map<string,RecordStoredValue>([
  ['Name',scalar({value_text:''})],['Price',scalar({value_text:null})],
  ['Flag',scalar({value_boolean:false})],
  ['Coordinates',scalar({geo_latitude:null,geo_longitude:null})],
  ['Address',scalar({address_street:'',address_city:''})],
  ['Selections',scalar({value_text:null,multi_values:[]})]
 ]);
 const {client,calls}=fixture(rows);
 await writeNativeValues(client,tenant,'Product',record,values);
 assert.equal(calls.length,3,'Metadata read, one native UPDATE and multi-select cleanup');
 assert.match(calls[1].sql,/"f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"=NULL/);
 assert.deepEqual(calls[1].params.at(-2),[...values.keys()],'All changed keys are removed before patch');
 assert.deepEqual(calls[1].params.at(-1),['Flag'],'A false boolean is still present');
 assert.match(calls[2].sql,/DELETE FROM md_record_multi_values/);
 assert.equal(calls.some(call=>call.sql.includes('INSERT INTO md_record_multi_values')),false);
 const zero=fixture([metadataRow('Price','numeric')]);
 await writeNativeValues(zero.client,tenant,'Product',record,new Map([
  ['Price',scalar({value_number:'0'})]
 ]));
 assert.deepEqual(zero.calls[1].params.at(-1),['Price']);
});

test('multi-select values keep their existing sorted side-table writes',async()=>{
 const {client,calls}=fixture([metadataRow('Selections')]);
 await writeNativeValues(client,tenant,'Product',record,new Map([
  ['Selections',scalar({value_text:'A;B',multi_values:['A','B']})]
 ]));
 assert.equal(calls.length,4);
 assert.match(calls[2].sql,/DELETE FROM md_record_multi_values/);
 assert.match(calls[3].sql,/INSERT INTO md_record_multi_values/);
 assert.deepEqual(JSON.parse(calls[3].params[3] as string),[
  {field_api:'Selections',value:'A',sort_order:0},
  {field_api:'Selections',value:'B',sort_order:1}
 ]);
});

test('hostile field names cannot enter SQL; missing native records fail closed',async()=>{
 const injected="Name'); DROP TABLE md_records; --";
 const bad=fixture([metadataRow(injected)]);
 await assert.rejects(loadNativeFields(bad.client,tenant,'Product'),/Invalid native field metadata/);
 const unlisted=fixture([metadataRow('Name')]);
 await assert.rejects(writeNativeValues(unlisted.client,tenant,'Product',record,
  new Map([[injected,scalar({value_text:'unsafe'})]])),/Native field metadata unavailable/);
 assert.equal(unlisted.calls.length,1,'No UPDATE follows an unrecognized field');
 const absent=fixture([metadataRow('Name')],false);
 await assert.rejects(writeNativeValues(absent.client,tenant,'Product',record,
  new Map([['Name',scalar({value_text:'A'})]])),/Native record not found/);
});

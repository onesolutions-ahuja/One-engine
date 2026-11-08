import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const url=process.env.METADRIVE_SQL_TEST_DATABASE_URL;
if(!url||!url.includes('/metadrive_2b'))throw new Error('2B smoke requires disposable metadrive_2b database');
const built=new URL('../dist-system/system-files/',import.meta.url);
const support=new URL('../dist-system/system-support/',import.meta.url);
const [{SqlPersistence},{applySystemMigrations},{ObjectDefinitionService},{RecordEngine},{RbacEngine}]=await Promise.all([
 import(new URL('sql-persistence.js',built).href),
 import(new URL('system-migrations.js',support).href),
 import(new URL('object-definition.js',built).href),
 import(new URL('record-engine.js',built).href),
 import(new URL('rbac-engine.js',built).href)
]);
const db=new SqlPersistence(url);
try{
 await db.query(readFileSync(fileURLToPath(new URL('../src/system-files/schema.sql',import.meta.url)),'utf8'));
 await applySystemMigrations(db);
 const defs=new ObjectDefinitionService(db);
 const tenants=[];
 for(const slug of ['field-primary','field-secondary']){
  const r=await db.query('INSERT INTO md_tenants(slug,name) VALUES($1,$1) RETURNING id',[slug]);
  tenants.push(r.rows[0].id);
 }
 const [primary,secondary]=tenants;
 const fields=[
  {apiName:'Name',label:'Name',dataType:'Text(80)',required:true},
  {apiName:'ExtKey',label:'External Key',dataType:'Text(80)',externalId:true},
  {apiName:'UniqueCode',label:'Unique Code',dataType:'Text(80)',unique:true},
  {apiName:'Amount',label:'Amount',dataType:'Currency(12,2)',defaultValue:12.34},
  {apiName:'IsActive',label:'Active',dataType:'Checkbox',defaultValue:true},
  {apiName:'Effective',label:'Effective',dataType:'Date',defaultValue:'2024-02-29'},
  {apiName:'Choice',label:'Choice',dataType:'Picklist',picklistValues:['A','B'],defaultValue:'A'},
  {apiName:'Notes',label:'Notes',dataType:'Text Area'},
  {apiName:'Memo',label:'Memo',dataType:'Long Text Area'},
  {apiName:'RichMemo',label:'Rich Memo',dataType:'Rich Text Area'},
  {apiName:'Ratio',label:'Ratio',dataType:'Percent(8,3)',defaultValue:12.125},
  {apiName:'Quantity',label:'Quantity',dataType:'Number(8,3)',defaultValue:4.125},
  {apiName:'Timestamp',label:'Timestamp',dataType:'Date/Time',defaultValue:'2026-10-30T14:30:00Z'},
  {apiName:'Clock',label:'Clock',dataType:'Time',defaultValue:'13:45'},
  {apiName:'Contact',label:'Contact',dataType:'Email',defaultValue:'example@example.com'},
  {apiName:'Phone',label:'Phone',dataType:'Phone',defaultValue:'+44 20 7123 4567'},
  {apiName:'Site',label:'Site',dataType:'URL',defaultValue:'https://example.com'},
  {apiName:'Choices',label:'Choices',dataType:'Multi-Select Picklist',picklistValues:['A','B'],defaultValue:'A;B'},
  {apiName:'Location',label:'Location',dataType:'Geolocation'},
  {apiName:'Address',label:'Address',dataType:'Address'},
  {apiName:'Confidential',label:'Confidential',dataType:'Text (Encrypted)'},
  {apiName:'Attachment',label:'Attachment',dataType:'File'},
  {apiName:'Photo',label:'Photo',dataType:'Image'},
  {apiName:'TicketNumber',label:'Ticket Number',dataType:'Auto Number',
   autoNumberFormat:'TN-{0000}'}
 ];
 const created=await defs.create(primary,'Phase2B__c','Phase 2B',fields);
 assert.equal(created.fields.length,fields.length);
 await defs.create(secondary,'Phase2B__c','Other Tenant Phase 2B',fields);
 assert.deepEqual(created.fields.filter(f=>f.externalId).map(f=>[f.apiName,f.unique]),[['ExtKey',false]]);
 assert.equal(created.fields.find(f=>f.apiName==='Amount').defaultValue,12.34);
 const expectedTypes={
  Notes:'textarea',Memo:'longtext',RichMemo:'richtext',Ratio:'percent',
  Quantity:'number',Timestamp:'datetime',Clock:'time',Contact:'email',
  Phone:'phone',Site:'url',Choices:'multipicklist',Location:'geolocation',
  Address:'address',Confidential:'encryptedtext',Attachment:'file',Photo:'image',
  TicketNumber:'autonumber'
 };
 const catalogue=(await db.query(
  "SELECT api_name,data_type FROM md_field_definitions WHERE tenant_id=$1 AND object_api='Phase2B__c'",
  [primary])).rows;
 for(const [name,type] of Object.entries(expectedTypes))
  assert.equal(catalogue.find(row=>row.api_name===name)?.data_type,type,
   'Stored field type catalogue mismatch: '+name);
 for(const name of ['Ratio','Quantity'])
  assert.equal(typeof created.fields.find(field=>field.apiName===name)?.defaultValue,'number',
   'Numeric default must retain its typed value: '+name);
 for(const name of ['Timestamp','Clock','Contact','Phone','Site','Choices'])
  assert.equal(typeof created.fields.find(field=>field.apiName===name)?.defaultValue,'string',
   'Default did not survive metadata round-trip: '+name);
 const stored=await db.query("SELECT api_name,is_unique,external_id FROM md_field_definitions WHERE tenant_id=$1 AND object_api='Phase2B__c' AND api_name IN ('ExtKey','UniqueCode') ORDER BY api_name",[primary]);
 assert.deepEqual(stored.rows.map(f=>[f.api_name,f.is_unique,f.external_id]),[['ExtKey',false,true],['UniqueCode',true,false]]);
 const insert=async(tenant,name,ext,code)=>db.transaction(async client=>{
  const record=await client.query("INSERT INTO md_records(tenant_id,object_api) VALUES($1,'Phase2B__c') RETURNING id",[tenant]);
  for(const [fieldApi,value,isUnique] of [['Name',name,false],['ExtKey',ext,false],['UniqueCode',code,true]]){
   await client.query("INSERT INTO md_record_values (tenant_id,record_id,object_api,field_api,value_text,is_unique,case_sensitive) VALUES($1,$2,'Phase2B__c',$3,$4,$5,false)",
    [tenant,record.rows[0].id,fieldApi,value,isUnique]);
  }
  return record.rows[0].id;
 });
 await insert(primary,'A','shared-key','one');
 await insert(primary,'B','shared-key','two');
 await insert(secondary,'C','shared-key','one');
 await assert.rejects(()=>insert(primary,'D','some-key','ONE'),/duplicate key|unique constraint/i);
 const count=await db.query("SELECT count(*)::int AS total FROM md_records WHERE tenant_id=$1 AND object_api='Phase2B__c'",[primary]);
 assert.equal(count.rows[0].total,2,'Failed unique insert must roll back the entire record');
 // Enabling Unique on an External ID with existing duplicate values must be atomic.
 await assert.rejects(()=>defs.updateField(primary,'Phase2B__c','ExtKey',
  {label:'External Key',unique:true}),/duplicate key|unique/i);
 assert.equal((await defs.get(primary,'Phase2B__c')).fields.find(f=>f.apiName==='ExtKey').unique,false);
 // Conversion must reject incompatible stored values, leaving metadata
 // and the record projections unchanged atomically.
 await assert.rejects(()=>defs.updateField(primary,'Phase2B__c','UniqueCode',
  {label:'Unique Code',dataType:'Date'}),/Unsupported|conversion|Cannot|Invalid/i);
 assert.equal((await defs.get(primary,'Phase2B__c')).fields.find(f=>f.apiName==='UniqueCode').dataType,
  'Text(80)');
 // A value row missing entirely (or present with NULL) must block Required.
 await assert.rejects(()=>defs.updateField(primary,'Phase2B__c','Amount',
  {label:'Amount',required:true}),/Required field cannot be enabled/);
 assert.equal((await defs.get(primary,'Phase2B__c')).fields.find(f=>f.apiName==='Amount').required,false);
 // Real field conversion is transactional across the record set, not a metadata-only edit.
 await defs.addField(primary,'Phase2B__c','Conversion','Text(80)',undefined,'Conversion');
 const recordIds=(await db.query("SELECT id FROM md_records WHERE tenant_id=$1 AND object_api='Phase2B__c' ORDER BY id",[primary])).rows;
 for(const [index,row] of recordIds.entries()){
  await db.query("INSERT INTO md_record_values(tenant_id,record_id,object_api,field_api,value_text) VALUES($1,$2,'Phase2B__c','Conversion',$3)",[primary,row.id,String(index+1)+'.25']);
 }
 const converted=await defs.updateField(primary,'Phase2B__c','Conversion',
  {label:'Conversion',dataType:'Number(8,2)'});
 assert.ok(converted.fields.some(f=>f.apiName==='Conversion'&&f.dataType==='Number(8, 2)'));
 const migrated=(await db.query("SELECT value_text,value_number::text AS value FROM md_record_values WHERE tenant_id=$1 AND object_api='Phase2B__c' AND field_api='Conversion' ORDER BY record_id",[primary])).rows;
 const migrationSnapshots=(await db.query("SELECT m.after_value_text,m.after_value_number FROM md_field_type_migration_values m JOIN md_field_type_migrations x ON x.id=m.migration_id AND x.tenant_id=m.tenant_id WHERE x.tenant_id=$1 AND x.object_api='Phase2B__c' AND x.field_api='Conversion' ORDER BY m.record_id",[primary])).rows;
 console.info('2B conversion typed rows and migration snapshots:',JSON.stringify({migrated,migrationSnapshots}));
 assert.deepEqual(migrated.map(r=>Number(r.value)),[1.25,2.25]);


 for(const [apiName,invalid] of [
  ['BadDate__c',{apiName:'Invalid',dataType:'Date',defaultValue:'2025-02-29'}],
  ['BadEmail__c',{apiName:'Invalid',dataType:'Email',defaultValue:'not-an-email'}],
  ['BadType__c',{apiName:'Invalid',dataType:'Long Text Area',unique:true}],
  ['BadExternal__c',{apiName:'Invalid',dataType:'Checkbox',externalId:true}]
 ]){
  await assert.rejects(()=>defs.create(primary,apiName,apiName,[invalid]),/Invalid|Unique|External ID|date/i);
  const missing=await db.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2',[primary,apiName]);
  assert.equal(missing.rowCount,0,'Invalid field must not partially create an object');
 }
 // Run actual shared API read/write/filter paths for typed fields (not just
 // metadata). The actor is a tenant user with explicit test permissions.
 const actor=(await db.query(
  "INSERT INTO md_users(tenant_id,email,password_hash) VALUES($1,'field-actor@example.invalid','test') RETURNING id",
  [primary])).rows[0].id;
 const permissionSet=(await db.query(
  "INSERT INTO md_permission_sets(tenant_id,api_name) VALUES($1,'FieldCatalogueQA') RETURNING id",
  [primary])).rows[0].id;
 await db.query("INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id) VALUES($1,$2,$3)",
  [primary,actor,permissionSet]);
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'*','*','allow')",
  [primary,permissionSet]);
 const engine=new RecordEngine(db,new RbacEngine(db));
 const createdId=await engine.create(primary,actor,'Phase2B__c',{
  Name:'Typed API Record',ExtKey:'api-typed-1',UniqueCode:'API-001',
  Quantity:5.125,Ratio:25.125,Contact:'tester@example.com',Site:'https://example.org',
  Effective:'2024-02-29',Timestamp:'2026-10-30T14:30:00Z',Clock:'13:45',
  Choice:'B',Choices:'A;B'
 });
 const typed=await engine.get(primary,actor,'Phase2B__c',createdId);
 assert.equal(typed.Name,'Typed API Record');
 assert.equal(typed.Quantity,5.125);
 assert.equal(typed.Ratio,25.125);
 assert.equal(typed.Choice,'B');
 assert.equal(typed.Contact,'tester@example.com');
 const filtered=await engine.list(primary,actor,'Phase2B__c',50,0,
  {filterField:'Quantity',filterValue:'5.125'});
 assert.ok(filtered.records.some(record=>record.Id===createdId),
  'Numeric precision/filter must match the stored record across the entire authorized set');
 const byChoice=await engine.list(primary,actor,'Phase2B__c',50,0,
  {filterField:'Choices',filterOperator:'Includes',filterValue:'A'});
 assert.ok(byChoice.records.some(record=>record.Id===createdId),
  'Multi-select option filter must match the stored API values');
 await assert.rejects(()=>engine.update(primary,actor,'Phase2B__c',createdId,
  {Contact:'invalid-email'}),/Invalid email/);
 assert.equal((await engine.get(primary,actor,'Phase2B__c',createdId)).Contact,
  'tester@example.com','Rejected updates must not damage valid stored values');
 await db.query("INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect) VALUES($1,$2,'Phase2B__c.Site','edit','deny')",
  [primary,permissionSet]);
 await assert.rejects(()=>engine.update(primary,actor,'Phase2B__c',createdId,
  {Site:'https://new-site.example'}),/Permission denied|Field is not editable/);
 const afterDenied=await engine.get(primary,actor,'Phase2B__c',createdId);
 assert.equal(afterDenied.Site,'https://example.org');
 // Concurrent creation with a default (including decimal defaults) must not
 // share auto-number state or produce unstable field values.
 const concurrent=await Promise.all(Array.from({length:4},(_,i)=>engine.create(primary,actor,'Phase2B__c',
  {Name:'Concurrent '+i,UniqueCode:'CONC-'+i,ExtKey:'conc-'+i})));
 assert.equal(new Set(concurrent).size,4);
 const issuedNumbers=new Set();
 for(const id of concurrent){
  const row=await engine.get(primary,actor,'Phase2B__c',id);
  assert.equal(row.Quantity,4.125);
  assert.equal(row.Ratio,12.125);
  assert.equal(row.IsActive,true);
  assert.match(String(row.TicketNumber),/^TN-[0-9]{4}$/);
  assert.ok(!issuedNumbers.has(row.TicketNumber),
   'Concurrent Auto Number values must not collide');
  issuedNumbers.add(row.TicketNumber);
 }
 console.info('2B SQL: full catalogue, record API write/read/filter/FLS, defaults, concurrency and rollback passed');
}finally{await db.close();}

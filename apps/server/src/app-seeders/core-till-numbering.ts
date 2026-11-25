import type {PoolClient} from 'pg';
import {writeNativeValues} from '../system-files/native-values.js';
import {loadNativeFields,nativeTableSql,nativeValueSql,type NativeFieldsMetadata} from '../system-files/native-object-query.js';
import type {RecordStoredValue} from '../system-files/record-value-write.js';
import {POS_TERMINAL_TYPE} from './core-named-devices.js';

/**
 * Multi-store / multi-till document numbers (metadata, two starter records).
 *  - Invoice.InvoiceNumber is an Auto Number numbered separately for each Location and
 *    Invoice Type ({InvoiceType}-{0}: INV-838382 sales, SRN-1201 returns); Order.OrderNumber
 *    for each Location (ORD-{0}). The system gives the number on save, one atomic counter
 *    per series, so every till of a shop shares it. No formula needed.
 *  - A return is an SRN Invoice: ReferenceInvoice = the sale; its lines keep OriginalInvoice.
 *  - Invoices can't be deleted (Object setting): they are set to Cancelled.
 *  - A Till is a Named Device of type POS Terminal (Name, Code, Location, Active, DeviceId).
 *    A device makes its own key; the server maps it to a POS Terminal (@ThisPage.Till.*).
 *    TillId and UserId are saved on Cart, Invoice and CashLedger records (CashLedger keeps its
 *    existing User field; Cart its UserId), with DeviceKey / DeviceIp / DeviceAgent for audit.
 *  - The Invoice is the sale document for every app (till, kiosk, bookings); Order is retired.
 * Tenants made before v13 had a separate Till Object: migrateTillsToNamedDevices copies its
 * records to POS Terminals once and repoints TillId. The Till Object itself is left for the
 * admin to delete (no customer data is removed by a seeder).
 */
type Field={api:string;label:string;type:string;related?:string;unique?:boolean;
 /** Auto Number: format and the field(s) it is numbered separately for. */
 format?:string;per?:string;
 /** Picklist values and default. */
 values?:readonly string[];default?:string};
export const TILL_NUMBERING_FIELDS:ReadonlyArray<{object:string;label?:string;appOwned?:boolean;fields:readonly Field[]}>=[
 {object:'Location',fields:[
  {api:'Code',label:'Code',type:'text',unique:true}
 ]},
 {object:'Cart',fields:[
  {api:'TillId',label:'Till',type:'reference',related:'NamedDevice'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'},
  // Stamped while the device's app is open (device-presence-service); old = device gone.
  {api:'DeviceOnlineAt',label:'Device Online At',type:'datetime'},
  {api:'DeviceStatus',label:'Device Status',type:'text'}
 ]},
 // The device the line is rung up on: the customer display on that device shows these lines.
 {object:'CartLine',fields:[
  {api:'DeviceKey',label:'Device Key',type:'text'}
 ]},
 {object:'Invoice',fields:[
  // INV-838382 for sales, SRN-1201 for returns: one series per shop and type.
  {api:'InvoiceType',label:'Invoice Type',type:'picklist',values:['INV','SRN'],default:'INV'},
  {api:'InvoiceNumber',label:'Invoice Number',type:'autonumber',format:'{InvoiceType}-{0}',per:'Location,InvoiceType'},
  {api:'ReferenceInvoice',label:'Reference Invoice',type:'reference',related:'Invoice'},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'TillId',label:'Till',type:'reference',related:'NamedDevice'},
  {api:'UserId',label:'User',type:'reference',related:'User'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 // A return line keeps the sale it returns, for "no more than sold" checks and reports.
 {object:'InvoiceLine',fields:[
  {api:'OriginalInvoice',label:'Original Invoice',type:'reference',related:'Invoice'}
 ]},
 {object:'CashLedger',fields:[
  {api:'TillId',label:'Till',type:'reference',related:'NamedDevice'}
 ]},
 // Kitchen tickets show this number (one running series per tenant).
 {object:'Order',appOwned:true,fields:[
  {api:'OrderNumber',label:'Order Number',type:'autonumber',format:'{0}'}
 ]}
];
/** Numbered documents: delete is refused, Status is set to Cancelled instead. */
export const NO_DELETE_OBJECTS=['Invoice'] as const;
export const STARTER_LOCATION={Name:'Location 1',Code:'LOC1'} as const;
export const STARTER_TILL={Name:'Till 1',Code:'TILL1'} as const;
/** Per-tenant receipt: uniqueness upgrades and starter records happen once, so a tenant
 * that later deletes the starter records or relaxes a rule is not overridden. */
export const tillNumberingReceipt=(tenantId:string)=>'till-numbering-v1:'+tenantId;
export const tillMigrationReceipt=(tenantId:string)=>'till-to-named-device-v1:'+tenantId;
/** Objects whose TillId pointed at the retired Till Object. */
const TILL_REFERENCING_OBJECTS=['Cart','Invoice','Order','CashLedger'] as const;

const text=(value:string):RecordStoredValue=>({value_text:value,reference_record_id:null,is_unique:false,case_sensitive:false});
const flag=(value:boolean):RecordStoredValue=>({value_text:null,value_boolean:value,reference_record_id:null,is_unique:false,case_sensitive:false});
const reference=(id:string):RecordStoredValue=>({value_text:null,reference_record_id:id,is_unique:false,case_sensitive:false});

/** Metadata only, conflict-safe: existing objects, fields and tenant edits are kept. */
export async function seedTillNumberingMetadata(client:PoolClient,tenantId:string):Promise<void>{
 for(const object of TILL_NUMBERING_FIELDS){
  if(object.appOwned){
   const exists=await client.query('SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2 AND deleted_at IS NULL',
    [tenantId,object.object]);
   if(!exists.rowCount)continue;
  }
  for(const field of object.fields){
   await client.query(`INSERT INTO md_field_definitions
    (tenant_id,object_api,api_name,label,data_type,related_object,is_unique,auto_number_format,auto_number_scope_field,default_value,required)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
    [tenantId,object.object,field.api,field.label,field.type,field.related??null,field.unique===true,
     field.format??null,field.per??null,field.default??null]);
   for(const [index,value] of (field.values??[]).entries())await client.query(`INSERT INTO md_field_picklist_values
    (tenant_id,object_api,field_api,value,sort_order) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM md_field_definitions
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND data_type='picklist') ON CONFLICT DO NOTHING`,
    [tenantId,object.object,field.api,value,(index+1)*10]);
  }
 }
}

/** Once per tenant: unique codes and Auto Number invoice numbers on fields that predate
 * this catalog, "can't be deleted" on Invoice, then the starter Location and Till (POS Terminal). A field whose existing values are duplicated stays as it is
 * (the admin fixes the duplicates); the rest of the startup is never blocked by it. */
export async function seedTillNumberingStarters(client:PoolClient,tenantId:string):Promise<'seeded'|'done'|'waiting'>{
 const receipt=tillNumberingReceipt(tenantId);
 if((await client.query('SELECT 1 FROM md_system_migrations WHERE version=$1',[receipt])).rowCount)return 'done';
 // Records need the Objects' native tables; on an older database they appear at the next start.
 const native=await client.query<{object_api:string}>(`SELECT object_api FROM md_native_objects
  WHERE tenant_id=$1 AND object_api IN ('Location','NamedDevice')`,[tenantId]);
 if(native.rows.length<2)return 'waiting';
 for(const object of TILL_NUMBERING_FIELDS)for(const field of object.fields){
  if(field.type==='picklist'){
   // The older Text "Invoice Type (SALE / SRN)" becomes a picklist INV / SRN, default INV
   // (saved values stay as they are; they only name the number series of new records).
   const changed=await client.query(`UPDATE md_field_definitions SET data_type='picklist',default_value=$4,picklist_restricted=false
    WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3 AND data_type='text' AND deleted_at IS NULL`,
    [tenantId,object.object,field.api,field.default??null]);
   if(changed.rowCount)for(const [index,value] of (field.values??[]).entries())await client.query(`INSERT INTO md_field_picklist_values
    (tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [tenantId,object.object,field.api,value,(index+1)*10]);
   continue;
  }
  if(field.type==='autonumber'){
   // An older Text number field becomes this Auto Number (values already saved stay).
   await client.query(`UPDATE md_field_definitions SET data_type='autonumber',auto_number_format=$4,
    auto_number_scope_field=$5,is_unique=false WHERE tenant_id=$1 AND object_api=$2 AND api_name=$3
    AND data_type='text' AND deleted_at IS NULL`,[tenantId,object.object,field.api,field.format??'{0}',field.per??null]);
   continue;
  }
  if(!field.unique)continue;
  await client.query('SAVEPOINT till_numbering_unique');
  try{
   await client.query(`UPDATE md_field_definitions SET is_unique=true WHERE tenant_id=$1 AND object_api=$2
    AND api_name=$3 AND data_type='text' AND is_unique=false AND deleted_at IS NULL`,[tenantId,object.object,field.api]);
   await client.query('RELEASE SAVEPOINT till_numbering_unique');
  }catch{
   await client.query('ROLLBACK TO SAVEPOINT till_numbering_unique');
   await client.query('RELEASE SAVEPOINT till_numbering_unique');
  }
 }
 await client.query(`UPDATE md_object_definitions SET prevent_delete=true WHERE tenant_id=$1
  AND api_name=ANY($2::text[])`,[tenantId,[...NO_DELETE_OBJECTS]]);
 // Starter records only where the tenant never had any (deleted ones count: no resurrection).
 const used=await client.query<{object_api:string}>(`SELECT DISTINCT object_api FROM md_records
  WHERE tenant_id=$1 AND object_api IN ('Location','Till','NamedDevice')`,[tenantId]);
 const had=new Set(used.rows.map(row=>row.object_api));
 const insert=async(objectApi:string,values:Map<string,RecordStoredValue>)=>{
  const {rows}=await client.query<{id:string}>(`INSERT INTO md_records
   (tenant_id,object_api,record_type_id,owner_id,owner_queue_id,is_clone) VALUES($1,$2,NULL,NULL,NULL,false) RETURNING id`,
   [tenantId,objectApi]);
  await writeNativeValues(client,tenantId,objectApi,rows[0].id,values);
  return rows[0].id;
 };
 let locationId:string|undefined;
 if(!had.has('Location'))locationId=await insert('Location',new Map([
  ['Name',text(STARTER_LOCATION.Name)],['Code',text(STARTER_LOCATION.Code)],['Active',flag(true)]]));
 else{
  const first=await client.query<{id:string}>(`SELECT id FROM md_records WHERE tenant_id=$1 AND object_api='Location'
   AND is_deleted=false ORDER BY created_at,id LIMIT 1`,[tenantId]);
  locationId=first.rows[0]?.id;
 }
 if(!had.has('Till')&&!had.has('NamedDevice')&&locationId)await insert('NamedDevice',new Map([
  ['Name',text(STARTER_TILL.Name)],['Code',text(STARTER_TILL.Code)],['DeviceType',text(POS_TERMINAL_TYPE)],
  ['Location',reference(locationId)],['Active',flag(true)]]));
 await client.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,'tenant')
  ON CONFLICT(version) DO NOTHING`,[receipt]);
 return 'seeded';
}

/** Till field -> Named Device field for the one-time copy. DeviceKey becomes DeviceId. */
const TILL_TO_DEVICE:ReadonlyArray<readonly [string,string]>=[['Name','Name'],['Code','Code'],
 ['Location','Location'],['Active','Active'],['DeviceKey','DeviceId'],['DeviceSetUpAt','DeviceSetUpAt'],
 ['DeviceSetUpBy','DeviceSetUpBy'],['DeviceIp','DeviceIp'],['DeviceAgent','DeviceAgent'],
 ['CustomerDisplayKey','CustomerDisplayKey']];
const stored=(meta:NativeFieldsMetadata,field:string,value:unknown):RecordStoredValue|null=>{
 const type=meta.fields.get(field)?.sqlType;
 if(value===null||value===undefined||value===''||!type)return null;
 if(type==='uuid')return reference(String(value));
 if(type==='boolean')return flag(value===true||value==='true'||value==='t');
 return text(value instanceof Date?value.toISOString():String(value));
};

/** Once per tenant: each Till record becomes a Named Device of type POS Terminal (an existing
 * POS Terminal with the same Code is reused), TillId values on Cart/Invoice/Order/CashLedger
 * move to it, and the TillId lookups point at NamedDevice. The Till Object and its records are
 * left untouched for the admin to delete. */
export async function migrateTillsToNamedDevices(client:PoolClient,tenantId:string):Promise<'migrated'|'done'|'waiting'>{
 const receipt=tillMigrationReceipt(tenantId);
 if((await client.query('SELECT 1 FROM md_system_migrations WHERE version=$1',[receipt])).rowCount)return 'done';
 const native=await client.query<{object_api:string}>(`SELECT object_api FROM md_native_objects
  WHERE tenant_id=$1 AND object_api IN ('Till','NamedDevice')`,[tenantId]);
 const nativeObjects=new Set(native.rows.map(row=>row.object_api));
 const moved=new Map<string,string>();
 if(nativeObjects.has('Till')){
  if(!nativeObjects.has('NamedDevice'))return 'waiting';
  const till=await loadNativeFields(client,tenantId,'Till');
  const device=await loadNativeFields(client,tenantId,'NamedDevice');
  if(TILL_TO_DEVICE.some(([,to])=>!device.fields.has(to))||!device.fields.has('DeviceType'))return 'waiting';
  const columns=TILL_TO_DEVICE.filter(([from])=>till.fields.has(from))
   .map(([from])=>nativeValueSql(till,from,'nr',true)+' AS "'+from+'"');
  const {rows:tills}=await client.query<Record<string,unknown>&{id:string}>(`SELECT r.id${columns.map(c=>','+c).join('')}
   FROM md_records r JOIN ${nativeTableSql(till)} nr ON nr.tenant_id=r.tenant_id AND nr.id=r.id
   WHERE r.tenant_id=$1 AND r.object_api='Till' AND r.is_deleted=false ORDER BY r.created_at,r.id`,[tenantId]);
  for(const row of tills){
   const code=typeof row.Code==='string'?row.Code:'';
   if(code){
    const same=await client.query<{id:string}>(`SELECT r.id FROM md_records r
     JOIN ${nativeTableSql(device)} nr ON nr.tenant_id=r.tenant_id AND nr.id=r.id
     WHERE r.tenant_id=$1 AND r.object_api='NamedDevice' AND r.is_deleted=false
      AND ${nativeValueSql(device,'Code','nr',true)}=$2 LIMIT 1`,[tenantId,code]);
    if(same.rows[0]){moved.set(row.id,same.rows[0].id);continue;}
   }
   const values=new Map<string,RecordStoredValue>([['DeviceType',text(POS_TERMINAL_TYPE)]]);
   for(const [from,to] of TILL_TO_DEVICE){const value=stored(device,to,row[from]);if(value)values.set(to,value);}
   const {rows}=await client.query<{id:string}>(`INSERT INTO md_records
    (tenant_id,object_api,record_type_id,owner_id,owner_queue_id,is_clone) VALUES($1,'NamedDevice',NULL,NULL,NULL,false) RETURNING id`,
    [tenantId]);
   await writeNativeValues(client,tenantId,'NamedDevice',rows[0].id,values);
   moved.set(row.id,rows[0].id);
  }
  // Sales documents keep their Till: the old Till id is replaced by its POS Terminal's id.
  for(const object of TILL_REFERENCING_OBJECTS){
   if(!moved.size)break;
   const has=await client.query('SELECT 1 FROM md_native_fields WHERE tenant_id=$1 AND object_api=$2 AND field_api=$3',
    [tenantId,object,'TillId']);
   if(!has.rowCount)continue;
   const meta=await loadNativeFields(client,tenantId,object);
   const field=meta.fields.get('TillId');
   if(!field)continue;
   for(const [from,to] of moved){
    if(field.column)await client.query(`UPDATE ${nativeTableSql(meta)} SET "${field.column}"=$3::${field.sqlType}
     WHERE tenant_id=$1 AND "${field.column}"::text=$2`,[tenantId,from,to]);
    else await client.query(`UPDATE ${nativeTableSql(meta)} SET extras=jsonb_set(extras,'{TillId}',to_jsonb($3::text))
     WHERE tenant_id=$1 AND extras->>'TillId'=$2`,[tenantId,from,to]);
   }
  }
 }
 await client.query(`UPDATE md_field_definitions SET related_object='NamedDevice'
  WHERE tenant_id=$1 AND api_name='TillId' AND related_object='Till'`,[tenantId]);
 await client.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,'tenant')
  ON CONFLICT(version) DO NOTHING`,[receipt]);
 return 'migrated';
}

export async function seedTillNumbering(client:PoolClient,tenantId:string):Promise<void>{
 await seedTillNumberingMetadata(client,tenantId);
 await seedTillNumberingStarters(client,tenantId);
 // A tenant whose native tables are not ready yet is retried at the next start.
 await client.query('SAVEPOINT till_to_named_device');
 try{
  await migrateTillsToNamedDevices(client,tenantId);
  await client.query('RELEASE SAVEPOINT till_to_named_device');
 }catch{
  await client.query('ROLLBACK TO SAVEPOINT till_to_named_device');
  await client.query('RELEASE SAVEPOINT till_to_named_device');
 }
}

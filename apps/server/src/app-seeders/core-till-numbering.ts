import type {PoolClient} from 'pg';
import {writeNativeValues} from '../system-files/native-values.js';
import type {RecordStoredValue} from '../system-files/record-value-write.js';

/**
 * Multi-store / multi-till document numbers (metadata, two starter records).
 *  - Invoice.InvoiceNumber is an Auto Number numbered separately for each Location and
 *    Invoice Type ({InvoiceType}-{0}: INV-838382 sales, SRN-1201 returns); Order.OrderNumber
 *    for each Location (ORD-{0}). The system gives the number on save, one atomic counter
 *    per series, so every till of a shop shares it. No formula needed.
 *  - A return is an SRN Invoice: ReferenceInvoice = the sale; its lines keep OriginalInvoice.
 *  - Invoices and Orders can't be deleted (Object setting): they are set to Cancelled.
 *  - Till (Name, Code, Location, Active, DeviceKey). A device makes its own key; the
 *    server maps it to a Till (@ThisPage.Till.*). TillId and UserId are saved on Cart, Order,
 *    Invoice and CashLedger records (CashLedger keeps its existing User field; Cart its
 *    UserId), with DeviceKey / DeviceIp / DeviceAgent for audit.
 * Order is an app-owned Object: its fields are added only once the Object exists.
 */
type Field={api:string;label:string;type:string;related?:string;unique?:boolean;
 /** Auto Number: format and the field(s) it is numbered separately for. */
 format?:string;per?:string;
 /** Picklist values and default. */
 values?:readonly string[];default?:string};
export const TILL_NUMBERING_FIELDS:ReadonlyArray<{object:string;label?:string;appOwned?:boolean;fields:readonly Field[]}>=[
 {object:'Till',label:'Till',fields:[
  {api:'Name',label:'Name',type:'text'},
  {api:'Code',label:'Code',type:'text',unique:true},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'Active',label:'Active',type:'boolean'},
  // The device set up as this Till (see till-assignment-service), and who set it up from where.
  {api:'DeviceKey',label:'Device Key',type:'text',unique:true},
  {api:'DeviceSetUpAt',label:'Device Set Up At',type:'datetime'},
  {api:'DeviceSetUpBy',label:'Device Set Up By',type:'reference',related:'User'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 {object:'Location',fields:[
  {api:'Code',label:'Code',type:'text',unique:true}
 ]},
 {object:'Cart',fields:[
  {api:'TillId',label:'Till',type:'reference',related:'Till'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 {object:'Invoice',fields:[
  // INV-838382 for sales, SRN-1201 for returns: one series per shop and type.
  {api:'InvoiceType',label:'Invoice Type',type:'picklist',values:['INV','SRN'],default:'INV'},
  {api:'InvoiceNumber',label:'Invoice Number',type:'autonumber',format:'{InvoiceType}-{0}',per:'Location,InvoiceType'},
  {api:'ReferenceInvoice',label:'Reference Invoice',type:'reference',related:'Invoice'},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'TillId',label:'Till',type:'reference',related:'Till'},
  {api:'UserId',label:'User',type:'reference',related:'User'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 // A return line keeps the sale it returns, for "no more than sold" checks and reports.
 {object:'InvoiceLine',fields:[
  {api:'OriginalInvoice',label:'Original Invoice',type:'reference',related:'Invoice'}
 ]},
 {object:'Order',appOwned:true,fields:[
  {api:'OrderNumber',label:'Order Number',type:'autonumber',format:'ORD-{0}',per:'Location'},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'TillId',label:'Till',type:'reference',related:'Till'},
  {api:'UserId',label:'User',type:'reference',related:'User'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 {object:'CashLedger',fields:[
  {api:'TillId',label:'Till',type:'reference',related:'Till'}
 ]}
];
/** Numbered documents: delete is refused, Status is set to Cancelled instead. */
export const NO_DELETE_OBJECTS=['Invoice','Order'] as const;
export const STARTER_LOCATION={Name:'Location 1',Code:'LOC1'} as const;
export const STARTER_TILL={Name:'Till 1',Code:'TILL1'} as const;
/** Per-tenant receipt: uniqueness upgrades and starter records happen once, so a tenant
 * that later deletes the starter records or relaxes a rule is not overridden. */
export const tillNumberingReceipt=(tenantId:string)=>'till-numbering-v1:'+tenantId;

const text=(value:string):RecordStoredValue=>({value_text:value,reference_record_id:null,is_unique:false,case_sensitive:false});
const flag=(value:boolean):RecordStoredValue=>({value_text:null,value_boolean:value,reference_record_id:null,is_unique:false,case_sensitive:false});
const reference=(id:string):RecordStoredValue=>({value_text:null,reference_record_id:id,is_unique:false,case_sensitive:false});

/** Metadata only, conflict-safe: existing objects, fields and tenant edits are kept. */
export async function seedTillNumberingMetadata(client:PoolClient,tenantId:string):Promise<void>{
 await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
  VALUES($1,'Till','Till',false) ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId]);
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

/** Once per tenant: unique codes and Auto Number invoice/order numbers on fields that predate
 * this catalog, "can't be deleted" on Invoice and Order, then the starter Location and Till. A field whose existing values are duplicated stays as it is
 * (the admin fixes the duplicates); the rest of the startup is never blocked by it. */
export async function seedTillNumberingStarters(client:PoolClient,tenantId:string):Promise<'seeded'|'done'|'waiting'>{
 const receipt=tillNumberingReceipt(tenantId);
 if((await client.query('SELECT 1 FROM md_system_migrations WHERE version=$1',[receipt])).rowCount)return 'done';
 // Records need the Objects' native tables; on an older database they appear at the next start.
 const native=await client.query<{object_api:string}>(`SELECT object_api FROM md_native_objects
  WHERE tenant_id=$1 AND object_api IN ('Location','Till')`,[tenantId]);
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
  WHERE tenant_id=$1 AND object_api IN ('Location','Till')`,[tenantId]);
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
 if(!had.has('Till')&&locationId)await insert('Till',new Map([
  ['Name',text(STARTER_TILL.Name)],['Code',text(STARTER_TILL.Code)],['Location',reference(locationId)],['Active',flag(true)]]));
 await client.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,'tenant')
  ON CONFLICT(version) DO NOTHING`,[receipt]);
 return 'seeded';
}

export async function seedTillNumbering(client:PoolClient,tenantId:string):Promise<void>{
 await seedTillNumberingMetadata(client,tenantId);
 await seedTillNumberingStarters(client,tenantId);
}

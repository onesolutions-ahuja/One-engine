import type {PoolClient} from 'pg';
import {writeNativeValues} from '../system-files/native-values.js';
import type {RecordStoredValue} from '../system-files/record-value-write.js';

/**
 * Multi-store / multi-till document numbering (metadata, one validation rule and two
 * starter records). Numbers themselves are built by page formulas with existing
 * functions; this only provides the fields they read and write:
 *  - Location.Code is the number prefix (unique, tenant-editable); Location keeps one
 *    counter per document type (NextOrderSeq / NextInvoiceSeq) and LastNumberedAt,
 *    which an action writes first so the Location row is locked before it reads a counter.
 *  - Till (Name, Code, Location, Active, DeviceKey). A device makes its own key; the
 *    server maps it to a Till (@ThisPage.Till.*). TillId and UserId are saved on Cart, Order,
 *    Invoice and CashLedger records (CashLedger keeps its existing User field; Cart its
 *    UserId), with DeviceKey / DeviceIp / DeviceAgent for audit.
 *  - InvoiceNumber / OrderNumber (unique text, frozen at save) and InvoiceSeq / OrderSeq.
 * Order is an app-owned Object: its fields are added only once the Object exists.
 */
type Field={api:string;label:string;type:string;related?:string;unique?:boolean};
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
  {api:'Code',label:'Code',type:'text',unique:true},
  {api:'NextOrderSeq',label:'Next Order Number',type:'number'},
  {api:'NextInvoiceSeq',label:'Next Invoice Number',type:'number'},
  {api:'LastNumberedAt',label:'Last Numbered At',type:'datetime'}
 ]},
 {object:'Cart',fields:[
  {api:'TillId',label:'Till',type:'reference',related:'Till'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 {object:'Invoice',fields:[
  {api:'InvoiceNumber',label:'Invoice Number',type:'text',unique:true},
  {api:'InvoiceSeq',label:'Invoice Sequence',type:'number'},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'TillId',label:'Till',type:'reference',related:'Till'},
  {api:'UserId',label:'User',type:'reference',related:'User'},
  {api:'DeviceKey',label:'Device Key',type:'text'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'}
 ]},
 {object:'Order',appOwned:true,fields:[
  {api:'OrderNumber',label:'Order Number',type:'text',unique:true},
  {api:'OrderSeq',label:'Order Sequence',type:'number'},
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
/** Admins may move a counter forward (e.g. to continue an old system's numbers), never back. */
export const LOCATION_NUMBERS_FORWARD_RULE={
 api:'NumbersOnlyMoveForward',label:'Next numbers only move forward',
 expression:'OR(BLANKVALUE(NextOrderSeq, 0) < BLANKVALUE(PRIORVALUE(NextOrderSeq), 0), '
  +'BLANKVALUE(NextInvoiceSeq, 0) < BLANKVALUE(PRIORVALUE(NextInvoiceSeq), 0))',
 message:'Next order and invoice numbers can only move forward, so a number is never issued twice.',
 field:'NextInvoiceSeq'
} as const;
export const STARTER_LOCATION={Name:'Location 1',Code:'LOC1'} as const;
export const STARTER_TILL={Name:'Till 1',Code:'TILL1'} as const;
/** Per-tenant receipt: uniqueness upgrades and starter records happen once, so a tenant
 * that later deletes the starter records or relaxes a rule is not overridden. */
export const tillNumberingReceipt=(tenantId:string)=>'till-numbering-v1:'+tenantId;

const text=(value:string):RecordStoredValue=>({value_text:value,reference_record_id:null,is_unique:false,case_sensitive:false});
const number=(value:number):RecordStoredValue=>({value_text:null,value_number:String(value),reference_record_id:null,is_unique:false,case_sensitive:false});
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
  for(const field of object.fields)await client.query(`INSERT INTO md_field_definitions
   (tenant_id,object_api,api_name,label,data_type,related_object,is_unique,required)
   VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
   [tenantId,object.object,field.api,field.label,field.type,field.related??null,field.unique===true]);
 }
 const rule=LOCATION_NUMBERS_FORWARD_RULE;
 await client.query(`INSERT INTO md_validation_rules
  (tenant_id,object_api,api_name,label,expression,error_message,error_field_api,active,sort_order)
  VALUES($1,'Location',$2,$3,$4,$5,$6,true,0) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
  [tenantId,rule.api,rule.label,rule.expression,rule.message,rule.field]);
}

/** Once per tenant: unique codes/numbers on fields that predate this catalog, then the
 * starter Location and Till. A field whose existing values are duplicated stays as it is
 * (the admin fixes the duplicates); the rest of the startup is never blocked by it. */
export async function seedTillNumberingStarters(client:PoolClient,tenantId:string):Promise<'seeded'|'done'|'waiting'>{
 const receipt=tillNumberingReceipt(tenantId);
 if((await client.query('SELECT 1 FROM md_system_migrations WHERE version=$1',[receipt])).rowCount)return 'done';
 // Records need the Objects' native tables; on an older database they appear at the next start.
 const native=await client.query<{object_api:string}>(`SELECT object_api FROM md_native_objects
  WHERE tenant_id=$1 AND object_api IN ('Location','Till')`,[tenantId]);
 if(native.rows.length<2)return 'waiting';
 for(const object of TILL_NUMBERING_FIELDS)for(const field of object.fields){
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
  ['Name',text(STARTER_LOCATION.Name)],['Code',text(STARTER_LOCATION.Code)],['Active',flag(true)],
  ['NextOrderSeq',number(1)],['NextInvoiceSeq',number(1)]]));
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

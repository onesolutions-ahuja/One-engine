import type {PoolClient} from 'pg';
import {writeNativeValues} from '../system-files/native-values.js';
import type {RecordStoredValue} from '../system-files/record-value-write.js';

/** Company: the tenant's own company details, ONE record per tenant. It is the only place
 * company data lives: Setup → Company Settings edits it, page formulas read every field as
 * @ThisTenant.Company.<Field>, and any app's settings page edits it with Smart components.
 * Builders add their own fields to it in Object Manager (no code). The logo stays in Company
 * Settings → Branding (an uploaded image). */
export const COMPANY_OBJECT={object:'Company',label:'Company',fields:[
 {api:'Name',label:'Trading name',type:'text',profile:'tradingName'},
 {api:'LegalName',label:'Legal company name',type:'text',profile:'legalName'},
 {api:'Description',label:'Description',type:'text',profile:'description'},
 {api:'Website',label:'Website',type:'text',profile:'website'},
 {api:'Email',label:'Contact email',type:'text',profile:'email'},
 {api:'Phone',label:'Contact phone',type:'text',profile:'phone'},
 {api:'AddressLine1',label:'Address line 1',type:'text',profile:'addressLine1'},
 {api:'AddressLine2',label:'Address line 2',type:'text',profile:'addressLine2'},
 {api:'City',label:'Town / City',type:'text',profile:'city'},
 {api:'Postcode',label:'Postcode',type:'text',profile:'postcode'},
 {api:'Country',label:'Country',type:'text',profile:'country'},
 {api:'Timezone',label:'Time zone',type:'text',profile:'timezone'},
 {api:'Locale',label:'Locale',type:'text',profile:'locale'},
 {api:'VatNumber',label:'VAT number',type:'text',profile:'vatNumber'},
 // Receipts (plan: Code PR item 1). Read by receipt templates and pay actions.
 {api:'ReceiptDisplayName',label:'Name on receipt',type:'text',profile:'receiptDisplayName'},
 {api:'ReceiptMessage',label:'Receipt message',type:'text',profile:'receiptMessage'},
 {api:'RefundDays',label:'Refund within (days)',type:'number',profile:'refundDays'},
 {api:'ReceiptShowVat',label:'Show VAT breakdown',type:'boolean',profile:'receiptShowVat'},
 {api:'ReceiptAskChoice',label:'Ask paper / email / both / none',type:'boolean',profile:'receiptAskChoice'},
 {api:'ReceiptAutoPrint',label:'Print a receipt after every sale',type:'boolean',profile:'receiptAutoPrint'},
 {api:'ReceiptShowBarcode',label:'Show receipt barcode',type:'boolean',profile:'receiptShowBarcode'},
 {api:'ReceiptQrLink',label:'QR code link',type:'text',profile:'receiptQrLink'},
 {api:'ReceiptQrCaption',label:'QR code caption',type:'text',profile:'receiptQrCaption'},
 {api:'ReceiptTipLine',label:'Show a tip line',type:'boolean',profile:'receiptTipLine'},
 {api:'CardSurchargeOn',label:'Card surcharge',type:'boolean',profile:'cardSurchargeOn'},
 {api:'CardSurchargePercent',label:'Card surcharge (%)',type:'number',profile:'cardSurchargePercent'},
 {api:'CashRoundingOn',label:'Round cash totals',type:'boolean',profile:'cashRoundingOn'},
 {api:'CashRoundingStep',label:'Round cash to (e.g. 0.05)',type:'number',profile:'cashRoundingStep'}
]} as const;
/** Company Settings profile key -> Company field (the Setup form keeps its keys). */
export const PROFILE_TO_COMPANY_FIELD:ReadonlyMap<string,string>=new Map(COMPANY_OBJECT.fields.map(f=>[f.profile,f.api]));
export const companyReceipt=(tenantId:string)=>'company-record-v1:'+tenantId;

const stored=(type:string,value:unknown):RecordStoredValue|null=>{
 const base={value_text:null,reference_record_id:null,is_unique:false,case_sensitive:false};
 if(value===null||value===undefined||value==='')return null;
 if(type==='boolean')return typeof value==='boolean'?{...base,value_boolean:value}:null;
 if(type==='number'){const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)?{...base,value_number:String(n)}:null;}
 return typeof value==='string'?{...base,value_text:value.trim()}:null;
};

export async function seedCompanyObject(client:PoolClient,tenantId:string):Promise<void>{
 await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
  VALUES($1,$2,$3,true) ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId,COMPANY_OBJECT.object,COMPANY_OBJECT.label]);
 for(const field of COMPANY_OBJECT.fields)await client.query(`INSERT INTO md_field_definitions
  (tenant_id,object_api,api_name,label,data_type,related_object,is_unique,required)
  VALUES($1,$2,$3,$4,$5,NULL,false,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
  [tenantId,COMPANY_OBJECT.object,field.api,field.label,field.type]);
 // The one Company record can't be deleted.
 await client.query(`UPDATE md_object_definitions SET prevent_delete=true WHERE tenant_id=$1 AND api_name='Company'`,[tenantId]);
 await seedCompanyRecord(client,tenantId);
}

/** Once per tenant: the Company record, filled from the old Company Settings values. */
export async function seedCompanyRecord(client:PoolClient,tenantId:string):Promise<'seeded'|'done'|'waiting'>{
 const receipt=companyReceipt(tenantId);
 if((await client.query('SELECT 1 FROM md_system_migrations WHERE version=$1',[receipt])).rowCount)return 'done';
 if(!(await client.query(`SELECT 1 FROM md_native_objects WHERE tenant_id=$1 AND object_api='Company'`,[tenantId])).rowCount)
  return 'waiting';
 const existing=await client.query(`SELECT 1 FROM md_records WHERE tenant_id=$1 AND object_api='Company' LIMIT 1`,[tenantId]);
 if(!existing.rowCount){
  const [profile,tenant]=await Promise.all([
   client.query<{properties:unknown}>("SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='company-profile'",[tenantId]),
   client.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[tenantId])]);
  const raw=profile.rows[0]?.properties;
  const values=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  const out=new Map<string,RecordStoredValue>();
  for(const field of COMPANY_OBJECT.fields){
   const value=stored(field.type,values[field.profile]);
   if(value)out.set(field.api,value);
  }
  if(!out.has('Name')){const name=stored('text',values.legalName)??stored('text',tenant.rows[0]?.name);if(name)out.set('Name',name);}
  const {rows}=await client.query<{id:string}>(`INSERT INTO md_records
   (tenant_id,object_api,record_type_id,owner_id,owner_queue_id,is_clone) VALUES($1,'Company',NULL,NULL,NULL,false) RETURNING id`,[tenantId]);
  await writeNativeValues(client,tenantId,'Company',rows[0].id,out);
 }
 await client.query(`INSERT INTO md_system_migrations(version,checksum) VALUES($1,'tenant') ON CONFLICT(version) DO NOTHING`,[receipt]);
 return 'seeded';
}

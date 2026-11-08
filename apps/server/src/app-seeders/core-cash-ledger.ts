import type {PoolClient} from 'pg';

/** Shared, tenant-owned receipts and disbursements for all applications.
 * Financial postings must be performed by authorised OneEngine flows, not by UI writes.
 */
export const CORE_CASH_LEDGER_FIELDS=[
 {api:'Name',label:'Name',type:'text'},
 {api:'TransactionNumber',label:'Transaction Number',type:'autonumber'},
 {api:'TransactionType',label:'Transaction Type',type:'picklist'},
 {api:'Direction',label:'Direction',type:'picklist'},
 {api:'Amount',label:'Amount',type:'number'},
 {api:'CurrencyCode',label:'Currency',type:'text'},
 {api:'Method',label:'Payment Method',type:'picklist'},
 {api:'Invoice',label:'Invoice',type:'reference',related:'Invoice'},
 {api:'Customer',label:'Customer',type:'reference',related:'Customer'},
 {api:'User',label:'Performed By',type:'reference',related:'User'},
 {api:'SourceApp',label:'Source Application',type:'text'},
 {api:'Location',label:'Location',type:'reference',related:'Location'},
 {api:'TillSession',label:'Till Session Reference',type:'text'},
 {api:'TransactionDate',label:'Transaction Date',type:'datetime'},
 {api:'Reference',label:'Idempotency Reference',type:'text'},
 {api:'ExternalReference',label:'External Reference',type:'text'},
 {api:'Status',label:'Posting Status',type:'picklist'},
 {api:'ReversalOf',label:'Reverses Transaction',type:'reference',related:'CashLedger'},
 {api:'Notes',label:'Notes',type:'text'}
] as const;
const PICKLISTS={
 TransactionType:['Receipt','Refund','Payout','Adjustment'],
 Direction:['IN','OUT'],
 Method:['Cash','Card','Bank Transfer','Other'],
 Status:['Pending','Posted','Reversed']
} as const;
export async function seedCoreCashLedger(client:PoolClient,tenantId:string):Promise<void>{
 await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
 VALUES($1,'CashLedger','Cash Ledger',true)
 ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId]);
 for(const f of CORE_CASH_LEDGER_FIELDS){
  await client.query(`INSERT INTO md_field_definitions
   (tenant_id,object_api,api_name,label,data_type,related_object,auto_number_format,is_unique,required)
   VALUES($1,'CashLedger',$2,$3,$4,$5,$6,$7,false)
   ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
   [tenantId,f.api,f.label,f.type,'related' in f?f.related:null,
    f.api==='TransactionNumber'?'CL-{YYYY}-{000000}':null,
    f.api==='TransactionNumber'||f.api==='Reference']);
 }
 for(const [field,values] of Object.entries(PICKLISTS)){
  for(const [index,value] of values.entries()){
   await client.query(`INSERT INTO md_field_picklist_values
    (tenant_id,object_api,field_api,value,sort_order)
    VALUES($1,'CashLedger',$2,$3,$4)
    ON CONFLICT DO NOTHING`,[tenantId,field,value,(index+1)*10]);
  }
 }
}

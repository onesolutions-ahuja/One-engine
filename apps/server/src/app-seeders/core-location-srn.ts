import type {PoolClient} from 'pg';

/** Shared metadata: locations are reusable by POS, purchasing and other apps.
 * Never mutate a published Core v1 seeder checksum. */
export const LOCATION_SRN_FIELDS = [
  {object:'Location',label:'Location',fields:[
    {api:'Name',label:'Name',type:'text'},
    {api:'Code',label:'Code',type:'text'},
    {api:'Active',label:'Active',type:'boolean'}
  ]},
  {object:'Invoice',fields:[
    {api:'InvoiceType',label:'Invoice Type (SALE / SRN)',type:'text'},
    {api:'ReferenceInvoice',label:'Reference Invoice',type:'reference',related:'Invoice'},
    {api:'Location',label:'Store / Location',type:'reference',related:'Location'}
  ]},
  {object:'Purchase',fields:[
    {api:'Location',label:'Store / Location',type:'reference',related:'Location'}
  ]}
] as const;

export async function seedLocationSrnMetadata(client:PoolClient,tenantId:string):Promise<void>{
  await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
    VALUES($1,'Location','Location',false) ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId]);
  for(const object of LOCATION_SRN_FIELDS) for(const field of object.fields){
    await client.query(`INSERT INTO md_field_definitions
      (tenant_id,object_api,api_name,label,data_type,related_object,required)
      VALUES($1,$2,$3,$4,$5,$6,false)
      ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
      [tenantId,object.object,field.api,field.label,field.type,'related' in field?field.related:null]);
  }
}

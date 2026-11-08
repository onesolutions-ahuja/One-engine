import type {PoolClient} from 'pg';

/** Additive cart metadata for the kiosk and other order-entry applications. */
export const CART_OBJECTS = [
  {apiName:'Cart',label:'Cart',fields:[
    {apiName:'Name',label:'Name',dataType:'text'},
    {apiName:'SessionKey',label:'Session Key',dataType:'text'},
    {apiName:'UserId',label:'Cart User ID',dataType:'text'},
    {apiName:'HoldReference',label:'Hold Reference',dataType:'text'},
    {apiName:'HoldLabel',label:'Hold Label',dataType:'text'},
    {apiName:'HeldBy',label:'Held By',dataType:'reference',relatedObject:'User'},
    {apiName:'Status',label:'Status',dataType:'text'},
    {apiName:'ServiceMode',label:'Service Mode',dataType:'text'},
    {apiName:'Subtotal',label:'Subtotal',dataType:'number'},
    {apiName:'Tax',label:'Tax',dataType:'number'},
    {apiName:'Total',label:'Total',dataType:'number'},
    {apiName:'ExpiresAt',label:'Expires At',dataType:'datetime'}
  ]},
  {apiName:'CartLine',label:'Cart Line',fields:[
    {apiName:'Name',label:'Name',dataType:'text'},
    {apiName:'Cart',label:'Cart',dataType:'reference',relatedObject:'Cart'},
    {apiName:'Product',label:'Product',dataType:'reference',relatedObject:'Product'},
    {apiName:'Quantity',label:'Quantity',dataType:'number'},
    {apiName:'UnitPrice',label:'Unit Price',dataType:'number'},
    {apiName:'LineTotal',label:'Line Total',dataType:'number'},
    {apiName:'Status',label:'Status',dataType:'text'}
  ]}
] as const;

/** Metadata only. Existing objects/fields are never replaced. */
export async function seedCartObjects(client:PoolClient,tenantId:string):Promise<void> {
  for (const object of CART_OBJECTS) {
    await client.query(
      'INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',
      [tenantId,object.apiName,object.label]);
  }
  for (const object of CART_OBJECTS) {
    for (const field of object.fields) {
      await client.query(
        'INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,max_length,required) VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING',
        [tenantId,object.apiName,field.apiName,field.label,field.dataType,'relatedObject' in field ? field.relatedObject : null,null]);
    }
  }
}

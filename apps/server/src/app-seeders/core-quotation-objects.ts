import type {PoolClient} from 'pg';

/**
 * Reusable Core sales metadata for quotes. Ace Assist and all other apps
 * consume these Objects via the shared Object/Field APIs and Flow runtime.
 * Do not place appointment, payment, or tax behaviour inside this seeder.
 */
export const QUOTATION_OBJECTS = [
  {apiName:'Quotation',label:'Quotation',fields:[
    {apiName:'Name',label:'Name',dataType:'text'},
    {apiName:'QuotationNumber',label:'Quotation Number',dataType:'text',maxLength:80},
    {apiName:'Customer',label:'Customer',dataType:'reference',relatedObject:'Customer'},
    {apiName:'Contact',label:'Contact',dataType:'reference',relatedObject:'Contact'},
    {apiName:'Account',label:'Account',dataType:'reference',relatedObject:'Account'},
    {apiName:'IssueDate',label:'Issue Date',dataType:'date'},
    {apiName:'ExpiryDate',label:'Expiry Date',dataType:'date'},
    {apiName:'Status',label:'Status',dataType:'text',maxLength:40},
    {apiName:'CurrencyCode',label:'Currency Code',dataType:'text',maxLength:3},
    {apiName:'Subtotal',label:'Subtotal',dataType:'number'},
    {apiName:'DiscountAmount',label:'Discount Amount',dataType:'number'},
    {apiName:'TaxAmount',label:'Tax Amount',dataType:'number'},
    {apiName:'Total',label:'Total',dataType:'number'},
    {apiName:'TermsAndConditions',label:'Terms and Conditions',dataType:'text',maxLength:5000},
    {apiName:'Notes',label:'Notes',dataType:'text',maxLength:4000},
    {apiName:'AcceptedAt',label:'Accepted At',dataType:'datetime'},
    {apiName:'RelatedInvoice',label:'Related Invoice',dataType:'reference',relatedObject:'Invoice'}
  ]},
  {apiName:'QuotationLine',label:'Quotation Line',fields:[
    {apiName:'Name',label:'Name',dataType:'text'},
    {apiName:'Quotation',label:'Quotation',dataType:'reference',relatedObject:'Quotation'},
    {apiName:'Product',label:'Product',dataType:'reference',relatedObject:'Product'},
    {apiName:'Description',label:'Description',dataType:'text',maxLength:2000},
    {apiName:'Quantity',label:'Quantity',dataType:'number'},
    {apiName:'UnitPrice',label:'Unit Price',dataType:'number'},
    {apiName:'DiscountAmount',label:'Discount Amount',dataType:'number'},
    {apiName:'TaxAmount',label:'Tax Amount',dataType:'number'},
    {apiName:'LineTotal',label:'Line Total',dataType:'number'},
    {apiName:'SortOrder',label:'Sort Order',dataType:'number'}
  ]}
] as const;

/**
 * Additive and tenant-safe. Register all Objects before reference Fields.
 * Existing definitions and user customisations are never overwritten.
 * Business records, Flows, RBAC grants and app activation remain independent.
 */
export async function seedQuotationObjects(client:PoolClient,tenantId:string):Promise<void> {
  for(const object of QUOTATION_OBJECTS) {
    await client.query(
      'INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',
      [tenantId,object.apiName,object.label]);
  }
  for(const object of QUOTATION_OBJECTS) {
    for(const field of object.fields) {
      await client.query(
        'INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,max_length,required) VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING',
        [tenantId,object.apiName,field.apiName,field.label,field.dataType,
         'relatedObject' in field?field.relatedObject:null,
         'maxLength' in field?field.maxLength:null]);
    }
  }
}

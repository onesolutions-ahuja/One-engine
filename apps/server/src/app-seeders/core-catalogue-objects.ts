import type {PoolClient} from 'pg';

/** Shared product catalogue for every selling app (till, kiosk, online, bookings).
 * ProductCategory replaces app-named menu categories; ProductOptionGroup/ProductOption
 * replace meal-choice groups and options (sizes, add-ons, service extras); CartLineOption is
 * the option chosen on a cart line. Channel flags say where a Product or Category is sold.
 * Metadata only: no records, and existing objects, fields and tenant edits are kept.
 */
type Field={apiName:string;label:string;dataType:string;relatedObject?:string;maxLength?:number};
const channels:Field[]=[
 {apiName:'AvailableOnPOS',label:'Available on POS',dataType:'boolean'},
 {apiName:'AvailableOnKiosk',label:'Available on Kiosk',dataType:'boolean'},
 {apiName:'AvailableOnline',label:'Available Online',dataType:'boolean'}
];
export const CATALOGUE_OBJECTS:ReadonlyArray<{apiName:string;label:string;existing?:boolean;fields:readonly Field[]}>=[
 {apiName:'ProductCategory',label:'Product Category',fields:[
  {apiName:'Name',label:'Name',dataType:'text'},
  {apiName:'Active',label:'Active',dataType:'boolean'},
  {apiName:'SortOrder',label:'Sort Order',dataType:'number'},
  {apiName:'ParentCategory',label:'Parent Category',dataType:'reference',relatedObject:'ProductCategory'},
  {apiName:'ImageUrl',label:'Image URL',dataType:'text',maxLength:2048},
  ...channels
 ]},
 {apiName:'Product',label:'Product',existing:true,fields:[
  {apiName:'Category',label:'Category',dataType:'reference',relatedObject:'ProductCategory'},
  ...channels
 ]},
 {apiName:'ProductOptionGroup',label:'Product Option Group',fields:[
  {apiName:'Name',label:'Name',dataType:'text'},
  {apiName:'Product',label:'Product',dataType:'reference',relatedObject:'Product'},
  {apiName:'MinimumChoices',label:'Minimum Choices',dataType:'number'},
  {apiName:'MaximumChoices',label:'Maximum Choices',dataType:'number'},
  {apiName:'IncludedQuantity',label:'Included Quantity',dataType:'number'},
  {apiName:'SortOrder',label:'Sort Order',dataType:'number'},
  {apiName:'Active',label:'Active',dataType:'boolean'}
 ]},
 {apiName:'ProductOption',label:'Product Option',fields:[
  {apiName:'Name',label:'Name',dataType:'text'},
  {apiName:'OptionGroup',label:'Option Group',dataType:'reference',relatedObject:'ProductOptionGroup'},
  {apiName:'OptionProduct',label:'Option Product',dataType:'reference',relatedObject:'Product'},
  {apiName:'AdditionalPrice',label:'Additional Price',dataType:'number'},
  {apiName:'SortOrder',label:'Sort Order',dataType:'number'},
  {apiName:'Active',label:'Active',dataType:'boolean'},
  {apiName:'ImageUrl',label:'Image URL',dataType:'text',maxLength:2048}
 ]},
 {apiName:'CartLineOption',label:'Cart Line Option',fields:[
  {apiName:'Name',label:'Name',dataType:'text'},
  {apiName:'CartLine',label:'Cart Line',dataType:'reference',relatedObject:'CartLine'},
  {apiName:'OptionGroup',label:'Option Group',dataType:'reference',relatedObject:'ProductOptionGroup'},
  {apiName:'Option',label:'Option',dataType:'reference',relatedObject:'ProductOption'},
  {apiName:'OptionProduct',label:'Option Product',dataType:'reference',relatedObject:'Product'},
  {apiName:'AdditionalPrice',label:'Additional Price',dataType:'number'},
  {apiName:'Quantity',label:'Quantity',dataType:'number'}
 ]}
];

/** After Product and Cart exist (fresh core objects, cart objects). */
export async function seedCatalogueObjects(client:PoolClient,tenantId:string):Promise<void>{
 for(const object of CATALOGUE_OBJECTS){
  if(object.existing)continue;
  await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
   VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId,object.apiName,object.label]);
 }
 // Objects first, so reference fields always point at a registered Object.
 for(const object of CATALOGUE_OBJECTS)for(const field of object.fields){
  await client.query(`INSERT INTO md_field_definitions
   (tenant_id,object_api,api_name,label,data_type,related_object,max_length,required)
   SELECT $1,$2,$3,$4,$5,$6,$7,false WHERE EXISTS(SELECT 1 FROM md_object_definitions WHERE tenant_id=$1 AND api_name=$2)
   ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
   [tenantId,object.apiName,field.apiName,field.label,field.dataType,field.relatedObject??null,field.maxLength??null]);
 }
}

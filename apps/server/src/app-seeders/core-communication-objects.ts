import type {PoolClient} from 'pg';

/** Universal communication log metadata; delivery remains in the shared Flow/connector runtime. */
export const COMMUNICATION_OBJECTS=[{apiName:'Communication',label:'Communication',fields:[
  {
    "apiName": "Name",
    "label": "Name",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Channel",
    "label": "Channel",
    "dataType": "picklist"
  },
  {
    "apiName": "Direction",
    "label": "Direction",
    "dataType": "picklist"
  },
  {
    "apiName": "Status",
    "label": "Status",
    "dataType": "picklist"
  },
  {
    "apiName": "Sender",
    "label": "Sender",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Recipient",
    "label": "Recipient",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Subject",
    "label": "Subject",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Body",
    "label": "Body",
    "dataType": "text",
    "maxLength": 10000
  },
  {
    "apiName": "ExternalMessageId",
    "label": "External Message ID",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "ConversationId",
    "label": "Conversation ID",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Provider",
    "label": "Provider",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "RelatedObject",
    "label": "Related Object",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "RelatedRecordId",
    "label": "Related Record ID",
    "dataType": "text",
    "maxLength": 500
  },
  {
    "apiName": "Contact",
    "label": "Contact",
    "dataType": "reference",
    "relatedObject": "Contact"
  },
  {
    "apiName": "Customer",
    "label": "Customer",
    "dataType": "reference",
    "relatedObject": "Customer"
  },
  {
    "apiName": "SentAt",
    "label": "Sent At",
    "dataType": "datetime"
  },
  {
    "apiName": "ReceivedAt",
    "label": "Received At",
    "dataType": "datetime"
  },
  {
    "apiName": "DeliveredAt",
    "label": "Delivered At",
    "dataType": "datetime"
  },
  {
    "apiName": "ErrorMessage",
    "label": "Error Message",
    "dataType": "text",
    "maxLength": 2000
  }
]}] as const;
export const COMMUNICATION_PICKLISTS={Channel:['Email','SMS','WhatsApp','Phone','WebChat','Push','Other'],Direction:['Inbound','Outbound'],Status:['Draft','Queued','Sending','Sent','Delivered','Read','Failed','Received']} as const;
/** Structured request/transport diagnostics; never put these into message Body.
 * Kept separate from the original v1 seeder checksum for upgrade safety.
 * The matching versioned SQL migration installs them for existing tenants.
 */
export const COMMUNICATION_ACTIVITY_FIELDS=[
 {apiName:'Transport',label:'Transport',dataType:'text',maxLength:20},
 {apiName:'Endpoint',label:'Endpoint',dataType:'text',maxLength:2048},
 {apiName:'RequestMethod',label:'Request Method',dataType:'text',maxLength:20},
 {apiName:'ResponseStatusCode',label:'HTTP Status Code',dataType:'number'},
 {apiName:'Outcome',label:'Integration Outcome',dataType:'text',maxLength:40},
 {apiName:'DurationMs',label:'Duration (ms)',dataType:'number'},
 {apiName:'RequestBytes',label:'Request Bytes',dataType:'number'},
 {apiName:'ResponseBytes',label:'Response Bytes',dataType:'number'},
 {apiName:'OccurredAt',label:'Integration Occurred At',dataType:'datetime'},
 {apiName:'PhoneNumberId',label:'WhatsApp Phone Number ID',dataType:'text',maxLength:500},
 {apiName:'WabaId',label:'WhatsApp Business Account ID',dataType:'text',maxLength:500}
] as const;
/** Default Core list layout. Id is a universal virtual record column inserted by the renderer. */
export const COMMUNICATION_LIST_COLUMNS=[
 "OccurredAt",
 "Direction",
 "Transport",
 "RequestMethod",
 "ResponseStatusCode",
 "Body",
 "Provider",
 "Outcome",
 "ReceivedAt",
 "ErrorMessage",
 "Channel",
 "Contact",
 "ConversationId",
 "Customer",
 "DeliveredAt",
 "DurationMs",
 "Endpoint",
 "ExternalMessageId",
 "Name",
 "Recipient",
 "RelatedObject",
 "RelatedRecordId",
 "RequestBytes",
 "ResponseBytes",
 "Sender",
 "SentAt",
 "Status",
 "Subject"
] as const;

export async function seedCommunicationObjects(client:PoolClient,tenantId:string):Promise<void>{
  for(const object of COMMUNICATION_OBJECTS){
    await client.query('INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',[tenantId,object.apiName,object.label]);
    await client.query("INSERT INTO md_sharing_settings (tenant_id,object_api,default_access,use_hierarchy) VALUES($1,$2,'Public Read Only',false) ON CONFLICT(tenant_id,object_api) DO UPDATE SET default_access='Public Read Only',use_hierarchy=false",[tenantId,object.apiName]);
    for(const field of object.fields){
      await client.query('INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,max_length,required) VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING',
        [tenantId,object.apiName,field.apiName,field.label,field.dataType,'relatedObject' in field?field.relatedObject:null,'maxLength' in field?field.maxLength:null]);
    }
    for(const field of COMMUNICATION_ACTIVITY_FIELDS){
      await client.query(`INSERT INTO md_field_definitions
       (tenant_id,object_api,api_name,label,data_type,max_length,required)
       VALUES($1,$2,$3,$4,$5,$6,false)
       ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
        [tenantId,object.apiName,field.apiName,field.label,field.dataType,
         'maxLength' in field?field.maxLength:null]);
    }
    // Tenant-configurable default Search Results; do not replace a custom layout.
    // The schema owns field references and the Record Runtime owns rendering.
    const currentLayout=await client.query(`SELECT 1 FROM md_search_layout_columns
      WHERE tenant_id=$1 AND object_api=$2 AND layout_key='searchResults' LIMIT 1`,
      [tenantId,object.apiName]);
    if(!currentLayout.rows.length){
      for(const [position,field] of COMMUNICATION_LIST_COLUMNS.entries())
        await client.query(`INSERT INTO md_search_layout_columns
          (tenant_id,object_api,layout_key,position,field_api)
          VALUES($1,$2,'searchResults',$3,$4) ON CONFLICT DO NOTHING`,
          [tenantId,object.apiName,position,field]);
    }
    for(const [fieldApi,values] of Object.entries(COMMUNICATION_PICKLISTS)){
      for(const [index,value] of values.entries()){
        await client.query('INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenantId,object.apiName,fieldApi,value,(index+1)*10]);
      }
    }
  }
}

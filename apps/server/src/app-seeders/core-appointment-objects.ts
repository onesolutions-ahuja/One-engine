import type {PoolClient} from 'pg';

/** Reusable standard scheduling Object. Data and booking behaviour stay in Records and Flows. */
export const APPOINTMENT_OBJECTS=[{
  apiName:'Appointment',label:'Appointment',fields:[
    {apiName:'Name',label:'Name',dataType:'text',maxLength:500},
    {apiName:'StartDateTime',label:'Start Date and Time',dataType:'datetime'},
    {apiName:'EndDateTime',label:'End Date and Time',dataType:'datetime'},
    {apiName:'Status',label:'Status',dataType:'picklist'},
    {apiName:'Customer',label:'Customer',dataType:'reference',relatedObject:'Customer'},
    {apiName:'Contact',label:'Contact',dataType:'reference',relatedObject:'Contact'},
    {apiName:'Service',label:'Service',dataType:'text',maxLength:255},
    {apiName:'Location',label:'Location',dataType:'text',maxLength:255},
    {apiName:'AssignedTo',label:'Assigned To',dataType:'text',maxLength:255},
    {apiName:'Description',label:'Description',dataType:'text',maxLength:4000},
    {apiName:'Notes',label:'Notes',dataType:'text',maxLength:4000},
    {apiName:'TimeZone',label:'Time Zone',dataType:'text',maxLength:100},
    {apiName:'ExternalBookingId',label:'External Booking ID',dataType:'text',maxLength:255},
    {apiName:'ReminderAt',label:'Reminder At',dataType:'datetime'},
    {apiName:'CompletedAt',label:'Completed At',dataType:'datetime'}
  ]
}] as const;

export const APPOINTMENT_STATUSES=[
 'Scheduled','Confirmed','In Progress','Completed','Cancelled','No Show','Rescheduled'
] as const;

/** Idempotent, non-destructive metadata creation. No demo bookings or changes to custom fields. */
export async function seedAppointmentObjects(client:PoolClient,tenantId:string):Promise<void>{
 for(const object of APPOINTMENT_OBJECTS){
  await client.query(
   'INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system) VALUES($1,$2,$3,false) ON CONFLICT(tenant_id,api_name) DO NOTHING',
   [tenantId,object.apiName,object.label]);
  for(const field of object.fields){
   await client.query(
    'INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,max_length,required) VALUES($1,$2,$3,$4,$5,$6,$7,false) ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING',
    [tenantId,object.apiName,field.apiName,field.label,field.dataType,
     'relatedObject' in field?field.relatedObject:null,
     'maxLength' in field?field.maxLength:null]);
  }
 }
 for(const [index,value] of APPOINTMENT_STATUSES.entries()){
  await client.query(
   'INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
   [tenantId,'Appointment','Status',value,(index+1)*10]);
 }
}

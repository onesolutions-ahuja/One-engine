import type {PoolClient} from 'pg';

/** Shared device and webhook metadata for every app (till, kiosk, bookings...).
 * NamedDevice: every device in one Object. Tills are type POS Terminal (DeviceId = the
 * device key the browser/app makes; @ThisPage.Till reads it), kiosks and customer displays
 * their own types, card readers reached through a connector (Cloud API) and local devices on
 * USB, Bluetooth or the network (printers, cash drawers, scanners).
 * IncomingWebhook: one record per provider notification, so record-triggered Flows and
 * formulas (GETRECORD) react to payments without code. */
export const NAMED_DEVICE_OBJECTS=[
 {object:'NamedDevice',label:'Named Device',fields:[
  {api:'Name',label:'Name',type:'text'},
  {api:'DeviceType',label:'Device Type',type:'picklist'},
  {api:'Connection',label:'Connection',type:'picklist'},
  {api:'Connector',label:'Connector (for Cloud API devices)',type:'text'},
  {api:'DeviceId',label:'Device / Reader ID',type:'text'},
  {api:'Address',label:'USB, Bluetooth or network address',type:'text'},
  {api:'Location',label:'Store / Location',type:'reference',related:'Location'},
  {api:'IsDefault',label:'Default for its type',type:'boolean'},
  {api:'Active',label:'Active',type:'boolean'},
  {api:'Notes',label:'Notes',type:'text'},
  // POS Terminal (Till): its code, who set the device up and from where, and its customer display.
  {api:'Code',label:'Code',type:'text',unique:true},
  {api:'DeviceSetUpAt',label:'Device Set Up At',type:'datetime'},
  {api:'DeviceSetUpBy',label:'Device Set Up By',type:'reference',related:'User'},
  {api:'DeviceIp',label:'Device IP Address',type:'text'},
  {api:'DeviceAgent',label:'Device Browser / App',type:'text'},
  {api:'CustomerDisplayKey',label:'Customer Display (device key)',type:'text'},
  // A drawer, printer or scanner fixed to one Till: an installed app that sees it attached
  // (USB/Bluetooth/serial ID in Address or Device ID) knows which Till it is on.
  {api:'AttachedTill',label:'Attached to Till',type:'reference',related:'NamedDevice'}
 ]},
 // Payment hand-off between the till and the customer screen (card prompt, PayPal QR).
 {object:'Cart',label:'Cart',fields:[
  {api:'PaymentStatus',label:'Payment Status (blank, Card, QR, Paid, Failed)',type:'text'},
  {api:'PaymentLink',label:'Payment Link (QR)',type:'text'},
  {api:'PaymentReference',label:'Payment Reference',type:'text'},
  {api:'PaymentOrderId',label:'Payment Order ID',type:'text'}
 ]},
 {object:'IncomingWebhook',label:'Incoming Webhook',fields:[
  {api:'Name',label:'Name',type:'text'},
  {api:'Connector',label:'Connector',type:'text'},
  {api:'EventType',label:'Event Type',type:'text'},
  {api:'Reference',label:'Provider Reference',type:'text'},
  {api:'Status',label:'Provider Status',type:'text'},
  {api:'ProcessingStatus',label:'Processing Status',type:'picklist'},
  {api:'ReceivedAt',label:'Received At',type:'datetime'},
  {api:'Payload',label:'Payload',type:'longtext'}
 ]}
] as const;
export const POS_TERMINAL_TYPE='POS Terminal';
export const NAMED_DEVICE_PICKLISTS={
 'NamedDevice.DeviceType':['POS Terminal','Kiosk','Customer Display','Card Reader','Receipt Printer','Label Printer','Cash Drawer','Barcode Scanner','Scale','Other'],
 'NamedDevice.Connection':['Cloud API','USB','Bluetooth','Network','Serial'],
 'IncomingWebhook.ProcessingStatus':['New','Processed','Failed']
} as const;

export async function seedNamedDeviceObjects(client:PoolClient,tenantId:string):Promise<void>{
 for(const object of NAMED_DEVICE_OBJECTS){
  await client.query(`INSERT INTO md_object_definitions(tenant_id,api_name,label,is_system)
   VALUES($1,$2,$3,true) ON CONFLICT(tenant_id,api_name) DO NOTHING`,[tenantId,object.object,object.label]);
  for(const field of object.fields){
   await client.query(`INSERT INTO md_field_definitions
    (tenant_id,object_api,api_name,label,data_type,related_object,is_unique,required)
    VALUES($1,$2,$3,$4,$5,$6,$7,false)
    ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING`,
    [tenantId,object.object,field.api,field.label,field.type,'related' in field?field.related:null,
     'unique' in field&&field.unique===true]);
  }
 }
 for(const [key,values] of Object.entries(NAMED_DEVICE_PICKLISTS)){
  const [object,field]=key.split('.');
  for(const [index,value] of values.entries()){
   await client.query(`INSERT INTO md_field_picklist_values(tenant_id,object_api,field_api,value,sort_order)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tenantId,object,field,value,(index+1)*10]);
  }
 }
}

/** DEVICE(DeviceType, Command, Text): send a command to the default Named Device of a type.
 * Runs in the browser. USB, Serial and Bluetooth use the browser's device APIs (Chrome/Edge,
 * permission given once in Setup → Named Devices). Network printers use Star CloudPRNT: the job
 * is queued on our server and the printer collects it. Commands: Print, Open (cash drawer), Cut. */
type Request=<T>(path:string,init?:{method:string;body?:string})=>Promise<T>;
type Device={Name?:string;DeviceType?:string;Connection?:string;DeviceId?:string;Address?:string;IsDefault?:boolean;Active?:boolean};
const ESC=0x1b,GS=0x1d;
const COMMANDS=['PRINT','OPEN','CUT'];

/** ESC/POS bytes. Text uses code page 437 (the common receipt printer default; £ is 0x9C). */
export function escPos(command:string,text=''):Uint8Array{
 const upper=command.toUpperCase();
 const out:number[]=[ESC,0x40];
 if(upper==='OPEN')out.push(ESC,0x70,0x00,0x19,0xfa);
 if(upper==='PRINT'){
  for(const char of text.replace(/\r\n?/g,'\n')){
   const code=char.codePointAt(0)!;
   out.push(char==='£'?0x9c:char==='€'?0xd5:code<128?code:0x3f);
  }
  out.push(0x0a,0x0a,0x0a,0x0a);
 }
 if(upper==='PRINT'||upper==='CUT')out.push(GS,0x56,0x01);
 return new Uint8Array(out);
}

async function findDevice(request:Request,type:string):Promise<Device>{
 const list=async(kind:string)=>{
  const filters=[{field:'DeviceType',operator:'eq',value:kind},{field:'Active',operator:'eq',value:'true'}];
  const result=await request<{records?:Device[]}>('/records/NamedDevice?limit=20&filters='+encodeURIComponent(JSON.stringify(filters)));
  const devices=result.records??[];
  return devices.find(item=>item.IsDefault===true)??(devices.length===1?devices[0]:undefined);
 };
 // A cash drawer normally hangs off the receipt printer (RJ11 kick port).
 const device=await list(type)??(type==='Cash Drawer'?await list('Receipt Printer'):undefined);
 if(!device)throw Error('Add a default '+type+' in Setup → Named Devices');
 return device;
}

type UsbDevice={vendorId:number;productId:number;serialNumber?:string;opened:boolean;configuration:null|{interfaces:Array<{interfaceNumber:number;alternate:{endpoints:Array<{direction:string;type:string;endpointNumber:number}>}}>};
 open():Promise<void>;selectConfiguration(n:number):Promise<void>;claimInterface(n:number):Promise<void>;transferOut(e:number,d:Uint8Array):Promise<unknown>};
type SerialPort={getInfo():{usbVendorId?:number;usbProductId?:number};open(o:{baudRate:number}):Promise<void>;close():Promise<void>;
 writable:{getWriter():{write(d:Uint8Array):Promise<void>;releaseLock():void}}};
type BtCharacteristic={properties:{write:boolean;writeWithoutResponse:boolean};writeValueWithoutResponse?(d:Uint8Array):Promise<void>;writeValue(d:Uint8Array):Promise<void>};
type BtDevice={id:string;gatt?:{connected:boolean;connect():Promise<{getPrimaryServices():Promise<Array<{getCharacteristics():Promise<BtCharacteristic[]>}>>}>}};
const nav=()=>(globalThis as {navigator?:{usb?:{getDevices():Promise<UsbDevice[]>};serial?:{getPorts():Promise<SerialPort[]>};bluetooth?:{getDevices?():Promise<BtDevice[]>}}}).navigator;
const hex=(value:number|undefined)=>(value??0).toString(16).padStart(4,'0');

async function sendUsb(address:string,bytes:Uint8Array){
 const usb=nav()?.usb;
 if(!usb)throw Error('This browser cannot reach USB devices. Use Chrome or Edge.');
 const [,vendor,product]=address.split(':');
 const device=(await usb.getDevices()).find(item=>hex(item.vendorId)===vendor&&hex(item.productId)===product);
 if(!device)throw Error('Printer not allowed in this browser. Open Setup → Named Devices → Find device once on this till.');
 if(!device.opened)await device.open();
 if(!device.configuration)await device.selectConfiguration(1);
 const iface=device.configuration!.interfaces.find(item=>item.alternate.endpoints.some(e=>e.direction==='out'&&e.type==='bulk'));
 if(!iface)throw Error('This USB device has no printer output');
 await device.claimInterface(iface.interfaceNumber).catch(()=>undefined);
 const endpoint=iface.alternate.endpoints.find(e=>e.direction==='out'&&e.type==='bulk')!;
 await device.transferOut(endpoint.endpointNumber,bytes);
}
async function sendSerial(address:string,bytes:Uint8Array){
 const serial=nav()?.serial;
 if(!serial)throw Error('This browser cannot reach serial devices. Use Chrome or Edge.');
 const [,vendor,product]=address.split(':');
 const port=(await serial.getPorts()).find(item=>hex(item.getInfo().usbVendorId)===vendor&&hex(item.getInfo().usbProductId)===product);
 if(!port)throw Error('Device not allowed in this browser. Open Setup → Named Devices → Find device once on this till.');
 await port.open({baudRate:9600}).catch(()=>undefined);
 const writer=port.writable.getWriter();
 try{await writer.write(bytes);}finally{writer.releaseLock();await port.close().catch(()=>undefined);}
}
async function sendBluetooth(address:string,bytes:Uint8Array){
 const bt=nav()?.bluetooth;
 if(!bt?.getDevices)throw Error('This browser cannot reconnect Bluetooth devices. Use Chrome or Edge.');
 const id=address.replace(/^bluetooth:/,'');
 const device=(await bt.getDevices()).find(item=>item.id===id);
 if(!device?.gatt)throw Error('Bluetooth device not allowed in this browser. Find it again in Setup → Named Devices.');
 const server=await device.gatt.connect();
 for(const service of await server.getPrimaryServices()){
  for(const characteristic of await service.getCharacteristics()){
   if(!characteristic.properties.write&&!characteristic.properties.writeWithoutResponse)continue;
   for(let i=0;i<bytes.length;i+=100){
    const chunk=bytes.slice(i,i+100);
    if(characteristic.properties.writeWithoutResponse&&characteristic.writeValueWithoutResponse)
     await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
   }
   return;
  }
 }
 throw Error('No writable printer service found on this Bluetooth device');
}

export async function runDeviceCommand(request:Request,type:unknown,command:unknown,text:unknown):Promise<{Device:string;Connection:string}>{
 if(typeof type!=='string'||!type.trim())throw Error('DEVICE needs a device type, for example "Receipt Printer"');
 if(typeof command!=='string'||!COMMANDS.includes(command.toUpperCase()))throw Error('DEVICE command must be Print, Open or Cut');
 const body=text===undefined||text===null?'':String(text);
 if(body.length>20000)throw Error('DEVICE text is limited to 20,000 characters');
 const device=await findDevice(request,type.trim());
 const connection=String(device.Connection??'');
 const address=String(device.Address??'');
 if(connection==='Network'){
  await request('/action-formulas/device-job',{method:'POST',
   body:JSON.stringify({key:device.DeviceId,command:command.toUpperCase(),text:body})});
 }else{
  const bytes=escPos(command,body);
  if(connection==='USB')await sendUsb(address,bytes);
  else if(connection==='Serial')await sendSerial(address,bytes);
  else if(connection==='Bluetooth')await sendBluetooth(address,bytes);
  else throw Error(String(device.Name??type)+' is a '+connection+' device; DEVICE works with USB, Serial, Bluetooth or Network devices');
 }
 return {Device:String(device.Name??''),Connection:connection};
}

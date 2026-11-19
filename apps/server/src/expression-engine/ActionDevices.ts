/** DEVICE(DeviceType, Command, Text): send a command to the default Named Device of a type.
 * Runs in the browser. USB, Serial and Bluetooth use the browser's device APIs (Chrome/Edge,
 * permission given once in Setup → Named Devices). Network printers use Star CloudPRNT: the job
 * is queued on our server and the printer collects it. Commands: Print, Open (cash drawer), Cut. */
type Request=<T>(path:string,init?:{method:string;body?:string})=>Promise<T>;
export type Device={Name?:string;DeviceType?:string;Connection?:string;DeviceId?:string;Address?:string;IsDefault?:boolean;Active?:boolean};
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

/** Most 80 mm receipt printers are 203 dpi and print 72 mm: 576 dots across. */
export const PRINTER_DPI=203;
export const MAX_RECEIPT_DOTS=576;
/** Printer dots for a width designed in CSS pixels (96 per inch), printed at the designed size. */
export function designedWidthToDots(cssPixels:number):number{
 const dots=Math.round(Math.max(8,cssPixels)*PRINTER_DPI/96);
 return Math.min(MAX_RECEIPT_DOTS,Math.ceil(dots/8)*8);
}
/** Black-and-white printer bits (1 = black) from RGBA pixels; dark pixels print. */
export function rasterBits(rgba:ArrayLike<number>,width:number,height:number,threshold=160):Uint8Array{
 const bytesPerRow=Math.ceil(width/8);
 const bits=new Uint8Array(bytesPerRow*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,alpha=rgba[i+3]/255;
  // Transparent pixels are paper (white).
  const light=(0.299*rgba[i]+0.587*rgba[i+1]+0.114*rgba[i+2])*alpha+255*(1-alpha);
  if(light<threshold)bits[y*bytesPerRow+(x>>3)]|=0x80>>(x&7);
 }
 return bits;
}
/** ESC/POS raster image (GS v 0) in bands of rows, so small printer buffers keep up; then feed and cut. */
export function escPosRaster(bits:Uint8Array,bytesPerRow:number,height:number,band=128):Uint8Array{
 if(bytesPerRow<1||height<1||bits.length<bytesPerRow*height)throw Error('Invalid receipt image');
 const out:number[]=[ESC,0x40];
 for(let top=0;top<height;top+=band){
  const rows=Math.min(band,height-top);
  out.push(GS,0x76,0x30,0x00,bytesPerRow&255,bytesPerRow>>8,rows&255,rows>>8);
  const slice=bits.subarray(top*bytesPerRow,(top+rows)*bytesPerRow);
  for(const byte of slice)out.push(byte);
 }
 out.push(0x0a,0x0a,0x0a,0x0a,GS,0x56,0x01);
 return new Uint8Array(out);
}

async function listDevices(request:Request,kind:string):Promise<Device|undefined>{
 const filters=[{field:'DeviceType',operator:'eq',value:kind},{field:'Active',operator:'eq',value:'true'}];
 const result=await request<{records?:Device[]}>('/records/NamedDevice?limit=20&filters='+encodeURIComponent(JSON.stringify(filters)));
 const devices=result.records??[];
 return devices.find(item=>item.IsDefault===true)??(devices.length===1?devices[0]:undefined);
}
/** The default active Named Device of a type, or undefined when there is none. */
export async function findDefaultDevice(request:Request,type:string):Promise<Device|undefined>{
 return listDevices(request,type);
}
async function findDevice(request:Request,type:string):Promise<Device>{
 // A cash drawer normally hangs off the receipt printer (RJ11 kick port).
 const device=await listDevices(request,type)??(type==='Cash Drawer'?await listDevices(request,'Receipt Printer'):undefined);
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
 // Receipt images are large: send them in pieces the printer's USB buffer accepts.
 for(let i=0;i<bytes.length;i+=16384)
  await device.transferOut(endpoint.endpointNumber,bytes.subarray(i,i+16384));
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

/** Connections a Print Template can be sent to without the browser's print window. */
export const DIRECT_PRINT_CONNECTIONS=['USB','Serial','Bluetooth','Network'];
/** Print a rendered Print Template image on a Named Device: ESC/POS raster for USB, Serial and
 * Bluetooth; a PNG job for Network (Star CloudPRNT) printers. */
export async function printImageOnDevice(request:Request,device:Device,image:{
 bits:Uint8Array;bytesPerRow:number;height:number;png:()=>Promise<string>}){
 const connection=String(device.Connection??'');
 const address=String(device.Address??'');
 if(connection==='Network'){
  await request('/action-formulas/device-job',{method:'POST',
   body:JSON.stringify({key:device.DeviceId,command:'PRINT',image:await image.png()})});
  return;
 }
 const bytes=escPosRaster(image.bits,image.bytesPerRow,image.height);
 if(connection==='USB')await sendUsb(address,bytes);
 else if(connection==='Serial')await sendSerial(address,bytes);
 else if(connection==='Bluetooth')await sendBluetooth(address,bytes);
 else throw Error(String(device.Name??'Printer')+' is a '+connection+' device and cannot print templates');
}

/** Browser pairing for local devices. Chrome and Edge only; the browser shows its own
 * device picker and the person chooses. Nothing is opened until a later action uses it.
 * The saved Address is what an app action uses to find the device again. */
type Found={name:string;address:string};
type SerialInfo={getInfo:()=>{usbVendorId?:number;usbProductId?:number}};
type Nav=Navigator&{
 usb?:{requestDevice:(o:{filters:unknown[]})=>Promise<{productName?:string;vendorId:number;productId:number;serialNumber?:string}>};
 serial?:{requestPort:(o?:unknown)=>Promise<SerialInfo>;getPorts:()=>Promise<SerialInfo[]>};
 bluetooth?:{requestDevice:(o:{acceptAllDevices:boolean;optionalServices?:string[]})=>Promise<{id:string;name?:string}>};
};
const hex=(value:number|undefined)=>(value??0).toString(16).padStart(4,'0');
export const browserSupports=(connection:string)=>{
 const nav=navigator as Nav;
 return connection==='USB'?Boolean(nav.usb):connection==='Serial'?Boolean(nav.serial)
  :connection==='Bluetooth'?Boolean(nav.bluetooth):false;
};
export async function findLocalDevice(connection:string):Promise<Found>{
 const nav=navigator as Nav;
 if(connection==='USB'){
  if(!nav.usb)throw Error('This browser cannot reach USB devices. Use Chrome or Edge.');
  const device=await nav.usb.requestDevice({filters:[]});
  return {name:device.productName||'USB device',
   address:'usb:'+hex(device.vendorId)+':'+hex(device.productId)+(device.serialNumber?':'+device.serialNumber:'')};
 }
 if(connection==='Serial'){
  if(!nav.serial)throw Error('This browser cannot reach serial devices. Use Chrome or Edge.');
  const port=await nav.serial.requestPort();
  const info=port.getInfo();
  const id=hex(info.usbVendorId)+':'+hex(info.usbProductId);
  // Built-in COM ports all read 0000:0000: keep which one of them this is.
  const same=(await nav.serial.getPorts()).filter(item=>{const i=item.getInfo();return hex(i.usbVendorId)+':'+hex(i.usbProductId)===id;});
  const index=Math.max(0,same.indexOf(port));
  return {name:info.usbVendorId?'Serial device':'COM port',address:'serial:'+id+(index?':'+index:'')};
 }
 if(connection==='Bluetooth'){
  if(!nav.bluetooth)throw Error('This browser cannot reach Bluetooth devices. Use Chrome or Edge.');
  // Common Bluetooth receipt-printer services, so DEVICE(...) can write to them later.
  const device=await nav.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[
   '000018f0-0000-1000-8000-00805f9b34fb','e7810a71-73ae-499d-8c15-faa9aef0c3f2',
   '49535343-fe7d-4ae5-8fa9-9fafd205e455','0000ff00-0000-1000-8000-00805f9b34fb']});
  return {name:device.name||'Bluetooth device',address:'bluetooth:'+device.id};
 }
 throw Error('Type the network address (for example 192.168.1.50:9100)');
}

/** Random key for a Star CloudPRNT printer: its poll URL is /api/cloudprnt/<key>. */
export function newCloudPrntKey():string{
 const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

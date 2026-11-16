/** Browser pairing for local devices. Chrome and Edge only; the browser shows its own
 * device picker and the person chooses. Nothing is opened until a later action uses it.
 * The saved Address is what an app action uses to find the device again. */
type Found={name:string;address:string};
type Nav=Navigator&{
 usb?:{requestDevice:(o:{filters:unknown[]})=>Promise<{productName?:string;vendorId:number;productId:number;serialNumber?:string}>};
 serial?:{requestPort:(o?:unknown)=>Promise<{getInfo:()=>{usbVendorId?:number;usbProductId?:number}}>};
 bluetooth?:{requestDevice:(o:{acceptAllDevices:boolean})=>Promise<{id:string;name?:string}>};
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
  const info=(await nav.serial.requestPort()).getInfo();
  return {name:'Serial device',address:'serial:'+hex(info.usbVendorId)+':'+hex(info.usbProductId)};
 }
 if(connection==='Bluetooth'){
  if(!nav.bluetooth)throw Error('This browser cannot reach Bluetooth devices. Use Chrome or Edge.');
  const device=await nav.bluetooth.requestDevice({acceptAllDevices:true});
  return {name:device.name||'Bluetooth device',address:'bluetooth:'+device.id};
 }
 throw Error('Type the network address (for example 192.168.1.50:9100)');
}

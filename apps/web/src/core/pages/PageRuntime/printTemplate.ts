import {renderTemplateCanvas} from './renderTemplatePages';
import {printPageCss,printPageSize,type PrintPageSize} from './printPaper';
import {openTemplateRender} from './createTemplatePdf';
import {DIRECT_PRINT_CONNECTIONS,designedWidthToDots,findDefaultDevice,printImageOnDevice,rasterBits}
 from '../../../../../server/src/expression-engine/ActionDevices.js';

/**
 * PRINT(template, record): one click prints.
 * - A receipt-size template (roll paper) goes straight to the default Receipt Printer in
 *   Setup → Named Devices (USB, Serial, Bluetooth or Network): no preview, no print window.
 * - Otherwise (no printer, an A4-size template, or the printer cannot be reached) the browser's
 *   own print window opens directly; it already shows a preview, so there is no second one.
 * Either way the template prints at exactly the size it was designed (never scaled to fit).
 */
type Request=<T>(path:string,init?:{method:string;body?:string})=>Promise<T>;

const pngBase64=(canvas:HTMLCanvasElement)=>new Promise<string>((resolve,reject)=>{
 canvas.toBlob(blob=>{
  if(!blob){reject(Error('Unable to capture receipt image'));return;}
  const reader=new FileReader();
  reader.onerror=()=>reject(Error('Unable to encode receipt image'));
  reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
  reader.readAsDataURL(blob);
 },'image/png');
});

/** Send the rendered receipt to the default Receipt Printer. False when there is none to use. */
async function printOnReceiptPrinter(root:HTMLElement,width:number,request:Request):Promise<boolean>{
 const device=await findDefaultDevice(request,'Receipt Printer').catch(()=>undefined);
 if(!device||!DIRECT_PRINT_CONNECTIONS.includes(String(device.Connection??'')))return false;
 const dots=designedWidthToDots(width);
 const canvas=await renderTemplateCanvas(root,dots);
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('Canvas is unavailable');
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 await printImageOnDevice(request,device,{bits:rasterBits(pixels,canvas.width,canvas.height),
  bytesPerRow:Math.ceil(canvas.width/8),height:canvas.height,png:()=>pngBase64(canvas)});
 return true;
}

/** Copy the rendered template into a hidden frame and open the browser's print window for it. */
export async function printInBrowser(root:HTMLElement,size:PrintPageSize){
 const frame=document.createElement('iframe');
 frame.setAttribute('aria-hidden','true');
 frame.tabIndex=-1;
 frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
 document.body.appendChild(frame);
 const win=frame.contentWindow,doc=frame.contentDocument;
 if(!win||!doc){frame.remove();throw Error('Unable to open the print window');}
 doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');doc.close();
 doc.title=document.title;
 // The app's stylesheets, so components look exactly as they do in the template.
 for(const sheet of document.querySelectorAll('link[rel="stylesheet"],style'))
  doc.head.appendChild(doc.importNode(sheet,true));
 const page=doc.createElement('style');
 page.textContent=printPageCss(size);
 doc.head.appendChild(page);
 const wrapper=doc.createElement('div');
 wrapper.className='md-print-frame-page';
 // Theme colours (CSS variables) set on the template's surroundings.
 const computed=getComputedStyle(root);
 for(let i=0;i<computed.length;i++){
  const name=computed[i];
  if(name.startsWith('--'))wrapper.style.setProperty(name,computed.getPropertyValue(name));
 }
 const copy=doc.importNode(root,true) as HTMLElement;
 // Drawings and typed values are not part of a copy: carry them over.
 const sourceCanvases=root.querySelectorAll('canvas'),copyCanvases=copy.querySelectorAll('canvas');
 sourceCanvases.forEach((canvas,i)=>{
  try{
   const image=doc.createElement('img');
   image.src=canvas.toDataURL('image/png');
   image.style.cssText=canvas.style.cssText;
   image.width=canvas.clientWidth||canvas.width;image.height=canvas.clientHeight||canvas.height;
   copyCanvases[i]?.replaceWith(image);
  }catch{/* a canvas with outside images cannot be copied */}
 });
 const sourceFields=root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select');
 const copyFields=copy.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select');
 sourceFields.forEach((field,i)=>{
  const target=copyFields[i];
  if(!target)return;
  if(target instanceof HTMLTextAreaElement||target.tagName==='TEXTAREA')target.textContent=field.value;
  else if(target.tagName==='SELECT')(target as HTMLSelectElement).value=field.value;
  else target.setAttribute('value',field.value);
 });
 // Buttons never print (as in CREATEPDF).
 copy.querySelectorAll<HTMLElement>('button,[data-print-hide]').forEach(node=>{node.style.visibility='hidden';});
 wrapper.appendChild(copy);
 doc.body.appendChild(wrapper);
 await Promise.all([...doc.images].map(image=>image.complete?undefined:new Promise<void>(resolve=>{
  image.addEventListener('load',()=>resolve(),{once:true});
  image.addEventListener('error',()=>resolve(),{once:true});
  setTimeout(resolve,4000);
 })));
 await (doc as Document&{fonts?:{ready:Promise<unknown>}}).fonts?.ready;
 await new Promise<void>(resolve=>setTimeout(resolve,50));
 let removed=false;
 const remove=()=>{if(removed)return;removed=true;frame.remove();};
 win.addEventListener('afterprint',()=>setTimeout(remove,500),{once:true});
 // Chrome waits here until the print window closes; other browsers return at once.
 win.focus();
 win.print();
 setTimeout(remove,60000);
}

/** PRINT(): render the template invisibly, then print it on the receipt printer or in the browser. */
export async function printTemplate(template:string,request:Request,openRender:()=>Promise<unknown>){
 const {dialog,root,close}=await openTemplateRender(template,openRender);
 try{
  const width=Number(root.dataset.printWidth)||root.getBoundingClientRect().width;
  const size=printPageSize(width,root.getBoundingClientRect().height,Number(root.dataset.printHeight));
  if(size.roll){
   try{
    if(await printOnReceiptPrinter(root,size.width,request))return;
   }catch(error){
    // The printer could not be reached: print through the browser instead, so the receipt is not lost.
    console.warn('Receipt printer failed; opening the print window instead',error);
   }
  }
  if(!dialog.isConnected)throw Error('Print Template was closed');
  await printInBrowser(root,size);
 }finally{close();}
}

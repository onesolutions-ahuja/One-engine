import {renderTemplatePages} from './renderTemplatePages';

type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const afterPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
async function waitForReadyPrint(dialog:HTMLDialogElement){
 await afterPaint();
 const started=Date.now();let lastChange=Date.now();
 const observer=new MutationObserver(()=>{lastChange=Date.now();});
 observer.observe(dialog,{subtree:true,childList:true,characterData:true,attributes:true,
  attributeFilter:['aria-busy','src','style','class']});
 try{
  while(true){
   const loading=[...dialog.querySelectorAll('[aria-busy="true"],[role="status"]')]
    .some(node=>/loading|fetching|please wait/i.test(node.textContent??''));
   if(!loading&&Date.now()-started>=600&&Date.now()-lastChange>=250)break;
   if(Date.now()-started>12000)throw Error('Print Template data did not finish loading');
   await new Promise<void>(resolve=>setTimeout(resolve,100));
  }
  await afterPaint();
 }finally{observer.disconnect();}
}
function asciiBytes(source:string){const bytes=new Uint8Array(source.length);
 for(let i=0;i<source.length;i++)bytes[i]=source.charCodeAt(i)&255;
 return bytes;
}
function concatBytes(...arrays:Uint8Array[]){const total=arrays.reduce((n,a)=>n+a.length,0);
 const out=new Uint8Array(total);let offset=0;
 for(const arr of arrays){out.set(arr,offset);offset+=arr.length;}
 return out;
}
/** PDF pages are JPEG streams of the actual authorised browser Print Template.
 * No HTML/SVG foreignObject (which would taint the canvas) and no external PDF
 * service, runtime evaluation, or duplicate Page Builder rendering engine. */
export function imagesToPdf(images:readonly Uint8Array[],widthPx:number,heightPx:number):Uint8Array{
 if(images.length===0||images.length>100||widthPx<1||heightPx<1)
  throw Error('Invalid print page dimensions');
 const width=(widthPx*.75).toFixed(2),height=(heightPx*.75).toFixed(2);
 const parts:Uint8Array[]=[asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
 const offsets:number[]=[0];
 let length=parts[0].length;
 const append=(chunk:Uint8Array)=>{parts.push(chunk);length+=chunk.length;};
 const object=(id:number,content:Uint8Array)=>{
  offsets[id]=length;append(asciiBytes(id+' 0 obj\n'));append(content);append(asciiBytes('\nendobj\n'));
 };
 object(1,asciiBytes('<< /Type /Catalog /Pages 2 0 R >>'));
 object(2,asciiBytes('<< /Type /Pages /Count '+images.length+' /Kids ['+
  images.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>'));
 for(const [i,jpeg] of images.entries()){
  const pageId=3+i*3,imageId=pageId+1,streamId=pageId+2;
  object(pageId,asciiBytes('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+width+' '+height+
   '] /Resources << /XObject << /Im0 '+imageId+' 0 R >> >> /Contents '+streamId+' 0 R >>'));
  object(imageId,concatBytes(asciiBytes('<< /Type /XObject /Subtype /Image /Width '+widthPx+
   ' /Height '+heightPx+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+
   ' >>\nstream\n'),jpeg,asciiBytes('\nendstream')));
  const commands=asciiBytes('q '+width+' 0 0 '+height+' 0 0 cm /Im0 Do Q\n');
  object(streamId,concatBytes(asciiBytes('<< /Length '+commands.length+' >>\nstream\n'),commands,asciiBytes('endstream')));
 }
 const xref=length;
 append(asciiBytes('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'));
 for(let i=1;i<offsets.length;i++)
  append(asciiBytes(String(offsets[i]).padStart(10,'0')+' 00000 n \n'));
 append(asciiBytes('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF'));
 return concatBytes(...parts);
}
const toBase64=(bytes:Uint8Array)=>new Promise<string>((resolve,reject)=>{
 const reader=new FileReader();
 reader.onerror=()=>reject(Error('Could not encode generated PDF'));
 reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
 reader.readAsDataURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));
});
/** Same Print Template used by PRINT() and CREATEPDF(); FileId is a reusable
 * tenant-scoped file reference, not a URL or an unauthorised data payload. */
export async function createTemplatePdf(template:string,id:string,request:Request,
 openPreview:()=>Promise<void>,pageSize:{width:number;height:number}):Promise<{FileId:string;AssetRef:string}>{
 const before=new Set(document.querySelectorAll('dialog.formula-print-preview'));
 await openPreview();
 const dialog=[...document.querySelectorAll<HTMLDialogElement>('dialog.formula-print-preview')]
  .find(item=>!before.has(item))??[...document.querySelectorAll<HTMLDialogElement>('dialog.formula-print-preview')].at(-1);
 if(!dialog||dialog.getAttribute('aria-label')!==template)
  throw Error('Print Template did not render');
 try{
  await waitForReadyPrint(dialog);
  const root=dialog.querySelector('.free-canvas-runtime')??dialog.querySelector('main')??dialog;
  const images=await renderTemplatePages(root,Math.round(pageSize.width),Math.round(pageSize.height));
  const contentBase64=await toBase64(imagesToPdf(images,Math.round(pageSize.width),Math.round(pageSize.height)));
  const saved=await request<{id:string}>('/media-assets',{method:'POST',
   body:JSON.stringify({name:template+'-'+id+'.pdf',contentType:'application/pdf',contentBase64})});
  if(!saved.id)throw Error('PDF storage did not return a file ID');
  return {FileId:'asset:'+saved.id,AssetRef:'asset:'+saved.id};
 }finally{
  dialog.querySelector<HTMLButtonElement>('button')?.click();
 }
}

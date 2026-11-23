/** Page Builder upload/download as one Excel workbook (Pages + Guide + Sample sheets).
 * The server converts between the workbook and the page CSV; validate/apply are unchanged. */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadPageExcel(request:Request,csv:string,fileName:string):Promise<void>{
 const {base64}=await request<{base64:string}>('/metadata/pages/inventory/xlsx/write',
  {method:'POST',body:JSON.stringify({csv})});
 const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:XLSX}));
 const link=document.createElement('a');
 link.href=url;link.download=fileName.replace(/\.(csv|xlsx)$/i,'')+'.xlsx';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** An uploaded .xlsx (or .csv, still accepted) -> page CSV text. */
export async function pageCsvFromFile(request:Request,file:File):Promise<string>{
 if(file.name.toLowerCase().endsWith('.csv'))return file.text();
 const bytes=new Uint8Array(await file.arrayBuffer());
 let binary='';
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 const {csv}=await request<{csv:string}>('/metadata/pages/inventory/xlsx/read',
  {method:'POST',body:JSON.stringify({base64:btoa(binary)})});
 return csv;
}

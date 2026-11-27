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

/** Download the ticked pages as ONE workbook (same columns as a single page's download).
 * Only the chosen pages are read. Returns the labels of pages that could not be read. */
export async function downloadPagesExcel(request:Request,pages:ReadonlyArray<{apiName:string;label:string}>,
 variant:string,fileName:string):Promise<string[]>{
 const parts:string[]=[];
 const failed:string[]=[];
 for(const item of pages){
  try{
   const {csv}=await request<{csv:string}>('/metadata/pages/'+encodeURIComponent(item.apiName)+'/inventory?variant='+variant);
   // The header is one line: keep it from the first page only.
   const rows=csv.replace(/\r?\n$/,'');
   const cut=rows.search(/\r?\n/);
   if(cut<0){if(!parts.length)parts.push(rows);continue;}
   parts.push(parts.length?rows.slice(cut).replace(/^\r?\n/,''):rows);
  }catch{failed.push(item.label||item.apiName);}
 }
 if(parts.length)await downloadPageExcel(request,parts.filter(Boolean).join('\r\n')+'\r\n',fileName);
 return failed;
}

/**
 * Download a page's code as the files the app runs from (publish to code): the newest
 * version's .tsx, .css, .formulas.ts, .actions.ts, .data.ts and manifest.json in one .zip.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;

const CRC_TABLE=(()=>{
 const table=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
 return table;
})();
function crc32(bytes:Uint8Array):number{
 let crc=0xffffffff;
 for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
/** A .zip of text files (stored, not compressed: code files are small). */
export function zipFiles(files:ReadonlyArray<{path:string;content:string}>):Uint8Array{
 const encoder=new TextEncoder();
 const parts:Uint8Array[]=[],central:Uint8Array[]=[];
 let offset=0;
 for(const file of files){
  const name=encoder.encode(file.path),data=encoder.encode(file.content),crc=crc32(data);
  const local=new DataView(new ArrayBuffer(30));
  local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(6,0x0800,true);
  local.setUint32(14,crc,true);local.setUint32(18,data.length,true);local.setUint32(22,data.length,true);
  local.setUint16(26,name.length,true);
  parts.push(new Uint8Array(local.buffer),name,data);
  const entry=new DataView(new ArrayBuffer(46));
  entry.setUint32(0,0x02014b50,true);entry.setUint16(4,20,true);entry.setUint16(6,20,true);entry.setUint16(8,0x0800,true);
  entry.setUint32(16,crc,true);entry.setUint32(20,data.length,true);entry.setUint32(24,data.length,true);
  entry.setUint16(28,name.length,true);entry.setUint32(42,offset,true);
  central.push(new Uint8Array(entry.buffer),name);
  offset+=30+name.length+data.length;
 }
 const centralSize=central.reduce((n,part)=>n+part.length,0);
 const end=new DataView(new ArrayBuffer(22));
 end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);
 end.setUint32(12,centralSize,true);end.setUint32(16,offset,true);
 const all=[...parts,...central,new Uint8Array(end.buffer)];
 const out=new Uint8Array(all.reduce((n,part)=>n+part.length,0));
 let at=0;for(const part of all){out.set(part,at);at+=part.length;}
 return out;
}

const text=(value:unknown):string=>typeof value==='string'?value
 :value&&typeof value==='object'&&typeof (value as {content?:unknown}).content==='string'?(value as {content:string}).content:'';

/** The newest code version of a page layout, as files. Throws when the page has no code yet. */
export async function pageCodeFiles(request:Request,apiName:string,variant:string):Promise<{version:number;files:Array<{path:string;content:string}>}>{
 const base='/metadata/pages/'+encodeURIComponent(apiName)+'/code-versions';
 const list=await request<{versions?:Array<{version:number}>}>(base+'?variant='+encodeURIComponent(variant));
 const version=list.versions?.[0]?.version;
 if(!version)throw Error('This page has no code yet: publish it (or rebuild the app) first.');
 const file=(path:string)=>request<unknown>(base+'/'+version+'/file?format=json&variant='+encodeURIComponent(variant)+'&path='+encodeURIComponent(path)).then(text);
 const manifest=await file('manifest.json');
 let paths:string[]=[];
 try{paths=(JSON.parse(manifest).files as unknown[]).filter((path):path is string=>typeof path==='string');}catch{paths=[];}
 if(!paths.length)paths=['.tsx','.css','.formulas.ts','.actions.ts','.data.ts'].map(suffix=>apiName+suffix).concat('manifest.json');
 const files=await Promise.all(paths.map(async path=>({path,content:path==='manifest.json'?manifest:await file(path)})));
 return {version,files};
}

/** Save the page's code files (newest version) as <page>_<layout>_v<n>.zip. */
export async function downloadPageCode(request:Request,apiName:string,variant:string):Promise<void>{
 const {version,files}=await pageCodeFiles(request,apiName,variant);
 const bytes=zipFiles(files);
 const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/zip'}));
 const link=document.createElement('a');
 link.href=url;link.download=(apiName+'_'+variant+'_v'+version+'.zip').replace(/[^A-Za-z0-9_.-]+/g,'_');
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}

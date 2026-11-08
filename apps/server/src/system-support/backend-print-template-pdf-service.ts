import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateSync,deflateSync} from 'node:zlib';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
import type {RecordEngine} from '../system-files/record-engine.js';
import {PageRuntime} from '../system-files/page-runtime.js';
import {TenantMediaService} from '../system-files/tenant-media-service.js';
import {evaluateFlowFormula} from '../system-files/flow-formula-runtime.js';

const identifier=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
const object=(v:unknown):Record<string,unknown>=>
 v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(v:unknown,fallback:number,min:number,max:number)=>
 typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
const cssColor=(v:unknown,fallback:string)=>
 typeof v==='string'&&/^(?:#[0-9a-f]{3,8}|transparent|[a-z]{3,20})$/i.test(v)?v:fallback;
const cssText=(v:unknown,fallback:string,options:readonly string[])=>
 typeof v==='string'&&options.includes(v)?v:fallback;
const recordValue=(v:unknown):string=>v==null?'':v instanceof Date?v.toISOString():
 typeof v==='object'?JSON.stringify(v):String(v);
type PrintComponent={
 id:string;type:string;label:string;visible:boolean;parentId?:string;
 position?:{x:number;y:number;width:number;height:number};
 properties:Record<string,unknown>
};
type PrintPage={
 apiName:string;pageType:string;status:string;targetObject:string;layoutMode:string;
 canvasWidth:number;canvasHeight:number;canvasFillColor?:string;components:PrintComponent[]
};
/** Only allow references to the authorised record. No remote URLs or HTML input
 * are executed. The same published page/version is used for immediate and delayed jobs. */
export function resolvePrintValue(value:unknown,record:Record<string,unknown>,objectApi:string):string{
 if(typeof value!=='string')return recordValue(value);
 const source=value.trim();
 if(!source)return '';
 const field=/^@(?:([A-Za-z][A-Za-z0-9_]*)\.)?([A-Za-z][A-Za-z0-9_]*)$/.exec(source);
 if(field){
  if(field[1]&&field[1]!==objectApi)throw Error('Print binding references another object');
  if(!Object.hasOwn(record,field[2]))throw Error('Print field is unavailable: '+field[2]);
  return recordValue(record[field[2]]);
 }
 if(!source.startsWith('=')&&!source.startsWith('IF(')&&!source.startsWith('TEXT(')){
  // Printed documents can contain literal captions with embedded record fields.
  return value.replace(/(?:\{!|\{\{|@)([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)(?:\}|\}\})?/g,
    (match,objectName:string,fieldName:string)=>{
     if(objectName!==objectApi)return match;
     if(!Object.hasOwn(record,fieldName))throw Error('Print field is unavailable: '+fieldName);
     return recordValue(record[fieldName]);
    });
 }
 const expression=source.startsWith('=')?source.slice(1):source;
 const result=evaluateFlowFormula(expression,reference=>{
  const parts=reference.split('.');
  const key=parts.at(-1)??'';
  if(parts.length>2||(parts.length===2&&parts[0]!==objectApi))
   throw Error('Print formula references another object');
  if(!Object.hasOwn(record,key))throw Error('Print field is unavailable: '+key);
  return record[key];
 },{},'flow_formula');
 return recordValue(result);
}
function textSource(component:PrintComponent,record:Record<string,unknown>,objectApi:string){
 const p=component.properties;
 const source=p.textSource??p.content??p.value??p.labelText??p.title??p.defaultValue??component.label;
 return resolvePrintValue(source,record,objectApi);
}
function layoutStyle(component:PrintComponent,page:PrintPage,index:number){
 const p=component.properties,visual=object(p.visualStyle),layout=object(p.layoutStyle);
 const style={...visual,...layout,...p};
 const pos=component.position;
 const x=finite(pos?.x,20,0,10000),y=finite(pos?.y,20+index*58,0,10000);
 const width=finite(pos?.width,page.canvasWidth-40,20,10000);
 const height=finite(pos?.height,48,20,10000);
 const color=cssColor(style.color??style.textColor??style.fontColor,'#202124');
 const background=cssColor(style.backgroundColor??style.bodyBackgroundColor,'transparent');
 const border=cssColor(style.borderColor,'#dddddd');
 const fontSize=finite(style.fontSize??style.textSize,14,6,96);
 const padding=finite(style.padding,8,0,120);
 const weight=cssText(String(style.fontWeight??'400'),'400',['100','200','300','400','500','600','700','800','900']);
 const align=cssText(style.textAlign??style.labelAlignment,'left',['left','center','right','justify']);
 const borderWidth=finite(style.borderWidth,0,0,20);
 return {x,y,width,height,fontSize,padding,color,background,border,borderWidth,weight,align};
}
type PdfElement={html:string;text:string;x:number;y:number;width:number;height:number;fontSize:number;
 color:string;background:string;border:string;borderWidth:number;padding:number;weight:string;align:string;
 image?:{contentType:string;contentBase64:string}};
const dataAsset=/^asset:([0-9a-f-]{36})$/i;
export async function buildPrintDocument(page:PrintPage,record:Record<string,unknown>,
 loadImage?:(assetId:string)=>Promise<{contentType:string;contentBase64:string}>,
 loadRows?:(component:PrintComponent)=>Promise<Record<string,unknown>[]>){
 if(!Number.isFinite(page.canvasWidth)||!Number.isFinite(page.canvasHeight)||
  page.canvasWidth<100||page.canvasWidth>10000||page.canvasHeight<100||page.canvasHeight>10000)
  throw Error('Invalid published Print Template size');
 if(!Array.isArray(page.components)||page.components.length>400)
  throw Error('Invalid published Print Template');
 const elements:PdfElement[]=[];
 let maxBottom=page.canvasHeight;
 for(const [index,component] of page.components.entries()){
  if(!component.visible)continue;
  const p=object(component.properties);
  // Actions are never executed while rendering documents.
  const style=layoutStyle(component,page,index);
  const value=textSource(component,record,page.targetObject);
  const kind=component.type.toLowerCase();
  const imageSource=p.imageSource??p.src;
  const image=typeof imageSource==='string'?
   resolvePrintValue(imageSource,record,page.targetObject):'';
  let content=escapeHtml(value).replace(/\r?\n/g,'<br>');
  let embeddedImage:PdfElement['image'];
  let contentRows:Record<string,unknown>[]|null=null;
  if(/image|logo|avatar/.test(kind)&&image){
   const match=dataAsset.exec(image);
   if(!match||!loadImage)throw Error('Print images must use permitted tenant media assets');
   const asset=await loadImage(match[1]);
   if(!['image/png','image/jpeg','image/webp'].includes(asset.contentType))
    throw Error('Unsupported Print Template image type');
   embeddedImage=asset;
   content='<img alt="" style="max-width:100%;max-height:100%;object-fit:contain" src="data:'+
     asset.contentType+';base64,'+asset.contentBase64+'">';
  }
  if(/table|related_list|relatedlist/.test(kind)){
   if(!loadRows)throw Error('Print Table data loader unavailable');
   contentRows=await loadRows(component);
   if(contentRows.length>5000)throw Error('Print table exceeds 5000 records');
   const columns=Array.isArray(object(p.dataCollection).columns)
    ?(object(p.dataCollection).columns as unknown[])
    :Array.isArray(p.columns)?p.columns:[];
   const names=columns.filter((entry):entry is string=>typeof entry==='string'
    &&identifier.test(entry)).slice(0,24);
   const fields=names.length?names:Object.keys(contentRows[0]??record).filter(key=>
    identifier.test(key)&&!['Id','RecordTypeId','OwnerId'].includes(key)&&!key.startsWith('__')).slice(0,24);
   const headerColor=cssColor(p.headerBodyColor,'#f3f6fb');
   const rowsHtml=contentRows.map(row=>'<tr>'+
    fields.map(name=>'<td>'+escapeHtml(recordValue(row[name]))+'</td>').join('')+'</tr>').join('');
   content='<table style="width:100%;border-collapse:collapse;table-layout:fixed;font:inherit">'+
    '<thead><tr>'+fields.map(name=>'<th style="background:'+headerColor+
     ';padding:6px;border:1px solid #d0d5dd;text-align:left">'+escapeHtml(name)+'</th>').join('')+
    '</tr></thead><tbody>'+rowsHtml+'</tbody></table>';
  }
  const left=page.layoutMode==='free-canvas'?style.x:20;
  const top=page.layoutMode==='free-canvas'?style.y:20+index*style.height;
  const width=page.layoutMode==='free-canvas'?style.width:Math.max(100,page.canvasWidth-40);
  const height=contentRows?Math.max(style.height,28*(contentRows.length+1)):style.height;
  maxBottom=Math.max(maxBottom,top+height);
  const css='position:absolute;box-sizing:border-box;overflow-wrap:anywhere;white-space:normal;'+
   'left:'+left+'px;top:'+top+'px;width:'+width+'px;min-height:'+height+'px;'+
   'padding:'+style.padding+'px;color:'+style.color+';background:'+style.background+';'+
   'border:'+style.borderWidth+'px solid '+style.border+';'+
   'font: '+style.weight+' '+style.fontSize+'px Arial,sans-serif;'+
   'text-align:'+style.align+';';
  const tableText=contentRows?[
    (Array.isArray(object(p.dataCollection).columns)
      ?object(p.dataCollection).columns as string[]:[]).join('  |  '),
    ...contentRows.map(row=>Object.entries(row).filter(([key])=>key!=='Id'&&
      !key.startsWith('__')).slice(0,12).map(([,item])=>recordValue(item)).join('  |  '))
  ].join('\n'):value;
  elements.push({...style,text:tableText,x:left,y:top,width,height,
   html:'<div style="'+css+'">'+content+'</div>',image:embeddedImage});
 }
 const pages=Math.ceil(maxBottom/page.canvasHeight);
 if(pages>100)throw Error('Print Template exceeds 100 pages');
 const body=elements.map(e=>e.html).join('');
 const html='<!doctype html><html><head><meta charset="utf-8">'+
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\';">'+
  '<style>@page{size:'+page.canvasWidth+'px '+page.canvasHeight+'px;margin:0;}'+
  '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0}'+
  '#paper{position:relative;width:'+page.canvasWidth+'px;min-height:'+
  (pages*page.canvasHeight)+'px;background:'+
  cssColor(page.canvasFillColor,'#ffffff')+';}</style></head><body>'+
  '<main id="paper">'+body+'</main></body></html>';
 return {html,elements,width:page.canvasWidth,height:page.canvasHeight,pages};
}
function pdfLiteral(text:string){
 // Standard PDF Base14 font supports Windows Latin-1 for the common record values.
 const safe=Array.from(text).map(c=>c.charCodeAt(0)<=255?c:'?').join('');
 return '('+safe.replace(/[\\()]/g,'\\$&').replace(/[\r\n]/g,' ')+')';
}
function rgb(value:string):string{
 const hex=/^#([0-9a-f]{6})$/i.exec(value);
 if(!hex)return '0 0 0';
 const h=hex[1];return [0,2,4].map(i=>(parseInt(h.slice(i,i+2),16)/255).toFixed(3)).join(' ');
}

function preparePdfImage(image:{contentType:string;contentBase64:string}):{
 width:number;height:number;bytes:Buffer;filter:'DCTDecode'|'FlateDecode'
}{
 const data=Buffer.from(image.contentBase64,'base64');
 if(data.length>5*1024*1024||data.length<8)throw Error('Invalid Print Template image');
 if(image.contentType==='image/jpeg'){
  if(data[0]!==255||data[1]!==216)throw Error('Invalid JPEG attachment');
  let offset=2;
  while(offset+9<data.length){
   if(data[offset]!==255){offset++;continue;}
   const marker=data[offset+1],length=data.readUInt16BE(offset+2);
   if([192,193,194].includes(marker)){
    const height=data.readUInt16BE(offset+5),width=data.readUInt16BE(offset+7);
    if(width>0&&height>0&&width*height<=10000000)
     return {width,height,bytes:data,filter:'DCTDecode'};
   }
   if(length<2||offset+2+length>data.length)break;
   offset+=2+length;
  }
  throw Error('Unsupported JPEG dimensions');
 }
 if(image.contentType!=='image/png')throw Error('Vector backend requires PNG or JPEG image');
 if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
  throw Error('Invalid PNG attachment');
 let width=0,height=0,depth=0,colorType=0,interlace=1;
 const idat:Buffer[]=[];let palette:Buffer|undefined;
 for(let i=8;i+12<=data.length;){
  const n=data.readUInt32BE(i),type=data.toString('ascii',i+4,i+8);
  if(n>5*1024*1024||i+12+n>data.length)throw Error('Malformed PNG');
  const chunk=data.subarray(i+8,i+8+n);
  if(type==='IHDR'){
   width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);depth=chunk[8];
   colorType=chunk[9];interlace=chunk[12];
  }else if(type==='PLTE')palette=chunk;
  else if(type==='IDAT')idat.push(chunk);
  else if(type==='IEND')break;
  i+=12+n;
 }
 if(!width||!height||width*height>10000000||depth!==8||interlace!==0||
  ![0,2,3,4,6].includes(colorType))throw Error('Unsupported PNG format');
 const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
 const bpp=channels[colorType],stride=width*bpp;
 const inflated=inflateSync(Buffer.concat(idat),{maxOutputLength:height*(stride+1)});
 if(inflated.length!==height*(stride+1))throw Error('PNG scanline length mismatch');
 const rgb=Buffer.alloc(width*height*3);let previous=Buffer.alloc(stride),cursor=0;
 const paeth=(a:number,b:number,c:number)=>{
  const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
  return da<=db&&da<=dc?a:db<=dc?b:c;
 };
 for(let row=0;row<height;row++){
  const filter=inflated[cursor++];
  if(filter>4)throw Error('Invalid PNG filter');
  const scan=Buffer.from(inflated.subarray(cursor,cursor+stride));cursor+=stride;
  for(let i=0;i<stride;i++){
   const a=i>=bpp?scan[i-bpp]:0,b=previous[i],c=i>=bpp?previous[i-bpp]:0;
   const predictor=filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):
    filter===4?paeth(a,b,c):0;
   scan[i]=(scan[i]+predictor)&255;
  }
  for(let col=0;col<width;col++){
   const i=col*bpp,out=(row*width+col)*3;
   const color=colorType===3?palette?.subarray(scan[i]*3,scan[i]*3+3):null;
   if(colorType===3&&(!color||color.length!==3))throw Error('PNG palette is unavailable');
   const r=colorType===0||colorType===4?scan[i]:color?color[0]:scan[i];
   const g=colorType===0||colorType===4?scan[i]:color?color[1]:scan[i+1];
   const b=colorType===0||colorType===4?scan[i]:color?color[2]:scan[i+2];
   const alpha=colorType===4?scan[i+1]:colorType===6?scan[i+3]:255;
   rgb[out]=Math.round((r*alpha+255*(255-alpha))/255);
   rgb[out+1]=Math.round((g*alpha+255*(255-alpha))/255);
   rgb[out+2]=Math.round((b*alpha+255*(255-alpha))/255);
  }
  previous=scan;
 }
 return {width,height,bytes:deflateSync(rgb),filter:'FlateDecode'};
}

/** Guaranteed backend fallback when a headless Chrome binary is unavailable.
 * It retains text, record values, geometry and solid fills with no user browser. */
export function vectorPdf(document:Awaited<ReturnType<typeof buildPrintDocument>>):Buffer{
 const objects:Buffer[]=[Buffer.alloc(0)];
 const add=(body:string|Buffer)=>{objects.push(Buffer.isBuffer(body)?body:Buffer.from(body,'latin1'));return objects.length-1};
 const catalog=add(''),pages=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
 const kids:number[]=[];
 const scale=.75,w=(document.width*scale).toFixed(2),h=(document.height*scale).toFixed(2);
 for(let p=0;p<document.pages;p++){
  const commands:string[]=[];
  const imageResources:string[]=[];
  // Preserve the authored page background, independently of component fills.
  const fillColor=document.html.match(/#paper\{[^}]*background:(#[0-9a-fA-F]{6})/)?.[1]??'#ffffff';
  commands.push(rgb(fillColor)+' rg 0 0 '+w+' '+h+' re f');
  for(const e of document.elements){
   if(e.y>=document.height*(p+1)||e.y+e.height<=document.height*p)continue;
   const x=(e.x*scale).toFixed(2),y=((document.height*(p+1)-e.y-e.height)*scale).toFixed(2),
    ww=(e.width*scale).toFixed(2),hh=(e.height*scale).toFixed(2);
   if(/^#[0-9a-f]{6}$/i.test(e.background))
    commands.push(rgb(e.background)+' rg '+x+' '+y+' '+ww+' '+hh+' re f');
   if(e.borderWidth>0)commands.push(rgb(e.border)+' RG '+(e.borderWidth*scale).toFixed(2)+
    ' w '+x+' '+y+' '+ww+' '+hh+' re S');
   if(e.image){
    const prepared=preparePdfImage(e.image);
    const imageId=add(Buffer.concat([Buffer.from(
     '<< /Type /XObject /Subtype /Image /Width '+prepared.width+
     ' /Height '+prepared.height+
     ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /'+prepared.filter+
     ' /Length '+prepared.bytes.length+' >>\nstream\n'),prepared.bytes,Buffer.from('\nendstream')]));
    const imageName='Im'+imageResources.length;
    imageResources.push('/'+imageName+' '+imageId+' 0 R');
    const ratio=Math.min(e.width/prepared.width,e.height/prepared.height);
    const dw=prepared.width*ratio*scale,dh=prepared.height*ratio*scale;
    const dx=(e.x*scale+(e.width*scale-dw)/2).toFixed(2);
    const dy=((document.height*(p+1)-e.y)*scale-(e.height*scale+dh)/2).toFixed(2);
    commands.push('q '+dw.toFixed(2)+' 0 0 '+dh.toFixed(2)+' '+dx+' '+dy+
     ' cm /'+imageName+' Do Q');
    continue;
   }
   const fontSize=Math.min(72,Math.max(5,e.fontSize*scale));
   const maxChars=Math.max(1,Math.floor((e.width-2*e.padding)*scale/(fontSize*.53)));
   const lineHeight=fontSize*1.25;
   let line=0;
   for(const paragraph of e.text.split(/\r?\n/)){
    const words=paragraph.split(/\s+/);let row='';
    const flush=(text:string)=>{
     if(!text)return;
     const ty=(document.height*(p+1)-e.y-e.padding)*scale-fontSize-line*lineHeight;
     line++;
     if(ty<0||ty>document.height*scale)return;
     const measured=text.length*fontSize*.52;
     const available=Math.max(0,(e.width-2*e.padding)*scale-measured);
     const shift=e.align==='center'?available/2:e.align==='right'?available:0;
     const tx=e.x*scale+e.padding*scale+shift;
     const selectedFont=Number(e.weight)>=600?'F2':'F1';
     commands.push('BT '+rgb(e.color)+' rg /'+selectedFont+' '+fontSize.toFixed(2)+' Tf '+
      tx.toFixed(2)+' '+ty.toFixed(2)+' Td '+pdfLiteral(text)+' Tj ET');
    };
    for(const word of words){
     if((row+' '+word).trim().length>maxChars&&row){flush(row);row='';}
     if(word.length>maxChars){for(let j=0;j<word.length;j+=maxChars)flush(word.slice(j,j+maxChars));}
     else row=(row+' '+word).trim();
    }flush(row);line++;
   }
  }
  const stream=commands.join('\n')+'\n';
  const bytes=Buffer.from(stream,'latin1');
  const content=add('<< /Length '+bytes.length+' >>\nstream\n'+stream+'endstream');
  const page=add('<< /Type /Page /Parent '+pages+' 0 R /MediaBox [0 0 '+w+' '+h+
   '] /Resources << /Font << /F1 '+font+' 0 R /F2 '+bold+' 0 R >>'+
   (imageResources.length?' /XObject << '+imageResources.join(' ')+' >>':'')+
   ' >> /Contents '+content+' 0 R >>');
  kids.push(page);
 }
 objects[catalog]=Buffer.from('<< /Type /Catalog /Pages '+pages+' 0 R >>');
 objects[pages]=Buffer.from('<< /Type /Pages /Count '+kids.length+' /Kids ['+
  kids.map(id=>id+' 0 R').join(' ') +'] >>');
 const chunks:Buffer[]=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')];
 const offsets=[0];let offset=chunks[0].length;
 for(let i=1;i<objects.length;i++){
  offsets.push(offset);
  const block=Buffer.concat([Buffer.from(i+' 0 obj\n'),objects[i],Buffer.from('\nendobj\n')]);
  chunks.push(block);offset+=block.length;
 }
 const trailer='xref\n0 '+objects.length+'\n0000000000 65535 f \n'+
  offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+
  'trailer\n<< /Size '+objects.length+' /Root '+catalog+' 0 R >>\nstartxref\n'+offset+'\n%%EOF\n';
 chunks.push(Buffer.from(trailer));return Buffer.concat(chunks);
}
async function chromiumPdf(html:string):Promise<Buffer|null>{
 const bin=process.env.METADRIVE_PDF_CHROMIUM_BIN??
   ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',
    '/opt/google/chrome/chrome'].find(existsSync);
 if(!bin)return null; // Browserless vector renderer always remains available.
 const dir=await mkdtemp(join(tmpdir(),'oneengine-pdf-'));
 try{
  const source=join(dir,'template.html'),target=join(dir,'template.pdf');
  await writeFile(source,html,{mode:0o600});
  const args=['--headless','--disable-gpu','--disable-extensions','--disable-background-networking',
   '--no-first-run','--no-default-browser-check','--disable-sync','--disable-dev-shm-usage',
   '--user-data-dir='+join(dir,'profile'),'--print-to-pdf='+target,
   '--no-pdf-header-footer',pathToFileURL(source).href];
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(bin,args,{stdio:'ignore',env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:dir}});
   const timeout=setTimeout(()=>child.kill('SIGKILL'),25000);
   child.once('error',error=>{clearTimeout(timeout);reject(error);});
   child.once('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('Headless PDF renderer failed'));});
  });
  const pdf=await readFile(target);
  if(pdf.length<100||pdf.length>5*1024*1024||pdf.toString('ascii',0,5)!=='%PDF-')
   throw Error('Invalid rendered PDF');
  return pdf;
 }finally{await rm(dir,{recursive:true,force:true});}
}
export class BackendPrintTemplatePdfService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine,
  private readonly records:RecordEngine){}
 async create(tenantId:string,userId:string,template:string,recordId:string){
  if(!identifier.test(template)||!uuid.test(recordId))throw Error('Invalid Print Template or record ID');
  const loaded=await new PageRuntime(this.db).load(tenantId,template,'Desktop');
  const page=loaded?.page as PrintPage|undefined;
  if(!page||page.pageType!=='Print Template'||page.status!=='Active'||
   !identifier.test(page.targetObject))throw Error('Published Print Template unavailable');
  const record=await this.records.get(tenantId,userId,page.targetObject,recordId);
  const media=new TenantMediaService(this.db,this.rbac);
  const doc=await buildPrintDocument(page,record,async id=>{
   const result=await media.read(tenantId,userId,id);
   return {contentType:result.contentType,contentBase64:result.contentBase64};
  },async component=>{
   const props=object(component.properties);
   const collection=object(props.dataCollection);
   const source=typeof collection.objectApiName==='string'&&collection.objectApiName?
    collection.objectApiName:typeof props.objectApiName==='string'&&props.objectApiName?
    props.objectApiName:page.targetObject;
   if(!identifier.test(source))throw Error('Invalid Print Table source');
   if(source===page.targetObject)return [record];
   const relation=props.relatedFieldApiName;
   if(typeof relation!=='string'||!identifier.test(relation))
    throw Error('Print Table requires a scoped parent-record relationship');
   const rows:Record<string,unknown>[]=[];
   for(let offset=0;offset<5000;offset+=100){
    const result=await this.records.list(tenantId,userId,source,100,offset,{
     filterField:relation,filterValue:recordId,filterOperator:'Equals'
    });
    rows.push(...result.records);
    if(rows.length>=result.total)return rows;
   }
   throw Error('Print Table exceeds 5000 records');
  });
  const binary=await chromiumPdf(doc.html)??vectorPdf(doc);
  if(binary.length>5*1024*1024)throw Error('Generated PDF exceeds file size limit');
  const saved=await media.upload(tenantId,userId,{
   name:template+'-'+recordId+'.pdf',contentType:'application/pdf',contentBase64:binary.toString('base64')
  });
  return {FileId:saved.assetRef,AssetRef:saved.assetRef};
 }
}

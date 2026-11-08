/** Small, dependency-free XLSX reader/writer for the Metadata Loader's tabular format.
 * Treat uploaded workbooks as untrusted input. No macros, formulas or external links run.
 */
import {inflateRawSync} from 'node:zlib';

export type LoaderTable={name:string;columns:string[];rows:Record<string,string>[];validations?:Array<{cells:string;choices:string[]}>};
const encoder=(value:unknown)=>String(value??'');
const escapeXml=(value:unknown)=>encoder(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const unescapeXml=(value:string)=>value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi,(all,num,named)=>{
 if(named)return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[named]??all;
 const code=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num);
 return Number.isInteger(code)&&code>=0&&code<=0x10ffff?String.fromCodePoint(code):all;
});
const crcTable=Array.from({length:256},(_,i)=>{
 let n=i;for(let j=0;j<8;j++)n=(n&1)?(0xedb88320^(n>>>1)):(n>>>1);return n>>>0;
});
function crc32(b:Buffer){let n=0xffffffff;for(const byte of b)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function attr(tag:string,name:string){return new RegExp('(?:^|\\s)'+name.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')+'="([^"]*)"').exec(tag)?.[1]??'';}
function columnNumber(ref:string){
 const letters=/^[A-Z]+/.exec(ref)?.[0]??'';let n=0;
 for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return n-1;
}
function columnName(n:number){let name='';for(n++;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
function buildZip(entries:Array<{name:string;data:Buffer}>):Buffer{
 const parts:Buffer[]=[];const directory:Buffer[]=[];let offset=0;
 for(const entry of entries){
  const filename=Buffer.from(entry.name,'utf8'),body=entry.data,crc=crc32(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt16LE(0x800,6);local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(filename.length,26);
  parts.push(local,filename,body);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);
  central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);
  central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(filename.length,28);
  central.writeUInt32LE(offset,42);directory.push(central,filename);
  offset+=local.length+filename.length+body.length;
 }
 const directoryBytes=Buffer.concat(directory);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(directoryBytes.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,directoryBytes,end]);
}
function readZip(buffer:Buffer):Map<string,string>{
 if(buffer.length>12_000_000)throw Error('Workbook exceeds 12 MB');
 let eocd=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){
  if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 }
 if(eocd<0)throw Error('Invalid XLSX archive');
 const count=buffer.readUInt16LE(eocd+10),offset=buffer.readUInt32LE(eocd+16);
 if(count>200||offset>=buffer.length)throw Error('Invalid XLSX directory');
 const result=new Map<string,string>();let at=offset,total=0;
 for(let i=0;i<count;i++){
  if(at+46>buffer.length||buffer.readUInt32LE(at)!==0x02014b50)throw Error('Invalid XLSX directory entry');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10);
  const compressed=buffer.readUInt32LE(at+20),plain=buffer.readUInt32LE(at+24);
  const nameSize=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32);
  const localOffset=buffer.readUInt32LE(at+42);
  const name=buffer.subarray(at+46,at+46+nameSize).toString('utf8');at+=46+nameSize+extra+comment;
  if(flags&1||![0,8].includes(method)||!name||name.includes('..')||name.startsWith('/'))throw Error('Unsupported XLSX entry');
  if(plain>15_000_000||(total+=plain)>35_000_000)throw Error('Workbook expanded size limit exceeded');
  if(localOffset+30>buffer.length||buffer.readUInt32LE(localOffset)!==0x04034b50)throw Error('Invalid XLSX entry');
  const start=localOffset+30+buffer.readUInt16LE(localOffset+26)+buffer.readUInt16LE(localOffset+28);
  if(start+compressed>buffer.length)throw Error('Truncated XLSX entry');
  const bytes=buffer.subarray(start,start+compressed);
  const raw=method===0?bytes:inflateRawSync(bytes,{maxOutputLength:15_000_001});
  if(raw.length!==plain||crc32(raw)!==buffer.readUInt32LE(at-(46+nameSize+extra+comment)+16))
   throw Error('Corrupted XLSX entry');
  if(name.startsWith('xl/')||name==='[Content_Types].xml'||name==='_rels/.rels')
   result.set(name,raw.toString('utf8'));
 }
 return result;
}
function excelValidationXml(table:LoaderTable){
 const requested=table.validations??[];
 if(requested.length>1000)throw Error('Too many Excel dropdowns');
 const rules=requested.map(entry=>{
  if(!/^[A-Z]{1,2}[1-9]\d{0,4}(?::[A-Z]{1,2}[1-9]\d{0,4})?$/.test(entry.cells)
   ||!Array.isArray(entry.choices)||!entry.choices.length||entry.choices.length>100)
   throw Error('Invalid Excel validation definition');
  const options=[...new Set(entry.choices)];
  if(options.some(option=>typeof option!=='string'||option.length>100
    ||/[",\r\n]/.test(option)))throw Error('Unsafe Excel validation choice');
  const csv=options.join(',');
  if(csv.length>255)return '';
  return '<dataValidation type="list" allowBlank="1" showErrorMessage="0" showDropDown="0" sqref="'
   +escapeXml(entry.cells)+'"><formula1>"'+escapeXml(csv)+'"</formula1></dataValidation>';
 }).filter(Boolean);
 return rules.length?'<dataValidations count="'+rules.length+'">'+rules.join('')+'</dataValidations>':'';
}
function sheetXml(table:LoaderTable){
 const rows=[table.columns.map(encoder),...table.rows.map(row=>table.columns.map(c=>encoder(row[c])))];
 const body=rows.map((cells,i)=>'<row r="'+(i+1)+'">'+cells.map((v,j)=>{
  if(!v)return '';
  return '<c r="'+columnName(j)+(i+1)+'" t="inlineStr"><is><t xml:space="preserve">'+escapeXml(v)+'</t></is></c>';
 }).join('')+'</row>').join('');
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+body+'</sheetData>'
  +excelValidationXml(table)+'</worksheet>';
}
export function writeLoaderWorkbook(tables:LoaderTable[]):Buffer{
 if(tables.length<1||tables.length>20||tables.some(t=>t.columns.length>80||t.rows.length>10000))throw Error('Invalid workbook size');
 const entries:Array<{name:string;data:Buffer}>=[];
 const add=(name:string,xml:string)=>entries.push({name,data:Buffer.from(xml,'utf8')});
 const root='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 add('[Content_Types].xml',root+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  +'<Default Extension="xml" ContentType="application/xml"/>'
  +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  +tables.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>');
 add('_rels/.rels',root+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 add('xl/workbook.xml',root+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  +'<sheets>'+tables.map((t,i)=>'<sheet name="'+escapeXml(t.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>');
 add('xl/_rels/workbook.xml.rels',root+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  +tables.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>');
 tables.forEach((table,i)=>add('xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(table)));
 return buildZip(entries);
}
export function readLoaderWorkbook(buffer:Buffer):LoaderTable[]{
 const files=readZip(buffer),workbook=files.get('xl/workbook.xml')??'';
 const relations=files.get('xl/_rels/workbook.xml.rels')??'';
 if(!workbook||!relations)throw Error('XLSX workbook metadata is missing');
 const targets=new Map<string,string>();
 for(const rel of relations.match(/<Relationship\b[^>]*\/?>/g)??[]){
  let target=attr(rel,'Target');if(target.startsWith('/'))target=target.slice(1);
  else if(!target.startsWith('xl/'))target='xl/'+target;
  if(!target.includes('..'))targets.set(attr(rel,'Id'),target);
 }
 const shared=(files.get('xl/sharedStrings.xml')??'').match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g)?.map(si=>
  [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>unescapeXml(m[1])).join(''))??[];
 const tables:LoaderTable[]=[];
 for(const sheetTag of workbook.match(/<sheet\b[^>]*\/?>/g)??[]){
  const name=unescapeXml(attr(sheetTag,'name')),filename=targets.get(attr(sheetTag,'r:id'));
  if(!filename)continue;
  const xml=files.get(filename);if(!xml)throw Error('Worksheet is missing: '+name);
  const parsed:Array<{line:number;cells:string[]}>=[],rows=xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g)??[];
  if(rows.length>10002)throw Error('Worksheet exceeds 10,000 rows');
  for(const row of rows){
   const opening=/^<row\b[^>]*>/.exec(row)?.[0]??'';
   const line=Number(attr(opening,'r')||parsed.length+1);
   const cells:string[]=[];
   for(const match of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const raw=match[2]??'',column=columnNumber(attr(match[1],'r'));
    if(column<0||column>79)continue;
    if(/<f(?:\s|>)/.test(raw))throw Error('Excel formulas are not accepted in input cells');
    const value=attr(match[1],'t')==='inlineStr'
     ?[...raw.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>unescapeXml(m[1])).join('')
     :unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(raw)?.[1]??'');
    cells[column]=attr(match[1],'t')==='s'?shared[Number(value)]??'':value;
   }
   parsed.push({line,cells});
  }
  const headings=parsed.shift()?.cells??[];
  if(!headings.length||new Set(headings.filter(Boolean)).size!==headings.filter(Boolean).length)
   throw Error('Invalid or duplicate worksheet headings: '+name);
  tables.push({name,columns:headings,rows:parsed.filter(r=>r.cells.some(c=>c!==undefined&&c!==''))
   .map(r=>Object.fromEntries(headings.map((heading,j)=>[heading,r.cells[j]??'']).concat([['__excelRow',String(r.line)]])))});
 }
 return tables;
}

import type {FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
import {flowGraphDiagnostics} from './flowGraphOperations.mjs';

// Excel 2003 XML is a real multi-sheet Excel format with no third-party runtime.
// The workbook is deliberately scoped to an existing flow and never contains an API to create one.
type Row=string[];
type Sheet={name:string;rows:Row[]};
const columns={
  Manifest:['Flow API','Flow Version','Snapshot','Format'],
  Nodes:['Action','Node ID','Type','Label'],
  Inputs:['Action','Node ID','Property','Value (JSON)'],
  Connections:['Action','Connection ID','From Node','To Node','Label','Kind','Scheduled Path (JSON)'],
  Resources:['Action','Name','Label','Type','Data Type','Collection','Input','Output','Value (JSON)']
};
type SheetName=keyof typeof columns;
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):
 value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>)
 .sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
const stable=(flow:FlowDefinitionMetadata)=>JSON.stringify(canonical({
  apiName:flow.apiName,versionNumber:flow.versionNumber,flowType:flow.flowType,
  status:flow.status,startConfig:flow.startConfig??{},
  elements:flow.elements,connectors:flow.connectors,resources:flow.resources
}));
export const flowExcelFingerprint=(flow:FlowDefinitionMetadata)=>digest(stable(flow));
export async function ensureFlowUnchanged(flow:FlowDefinitionMetadata):Promise<void>{
 const {apiRequest}=await import('../../authentication/Client/authClient');
 const response=await apiRequest<{flow:FlowDefinitionMetadata}>('/metadata/flows/'+encodeURIComponent(flow.apiName));
 if(flowExcelFingerprint(response.flow)!==flowExcelFingerprint(flow))
  throw Error('Existing flow changed on the server. Reload the flow and download a fresh Excel workbook.');
}
function digest(source:string) {
  let value=2166136261;
  for(let i=0;i<source.length;i++) {value^=source.charCodeAt(i);value=Math.imul(value,16777619);}
  return (value>>>0).toString(16).padStart(8,'0');
}
// Each nested input/output becomes an editable Excel row; empty containers stay explicit.
function flattenConfig(value:unknown,path=''):Array<[string,unknown]>{
 if(value===undefined)return [];
 if(Array.isArray(value)){
  if(!value.length)return path?[[path,[]]]:[];
  return value.flatMap((item,index)=>flattenConfig(item,path+'['+index+']'));
 }
 if(value&&typeof value==='object'){
  const entries=Object.entries(value as Record<string,unknown>);
  if(!entries.length)return path?[[path,{}]]:[];
  return entries.flatMap(([key,item])=>flattenConfig(item,path?path+'.'+key:key));
 }
 return [[path,value]];
}
function parseConfigPath(path:string):Array<string|number>{
 if(path.length>512||!path||!/^[_$a-zA-Z][\w$-]*(?:(?:\.[_$a-zA-Z][\w$-]*)|(?:\[(?:0|[1-9]\d{0,3})\]))*$/.test(path))
  throw Error('Invalid nested property path: '+path);
 const tokens:Array<string|number>=[];
 for(const match of path.matchAll(/([_$a-zA-Z][\w$-]*)|\[(\d+)\]/g)){
  const token=match[1]??Number(match[2]);
  if(['__proto__','constructor','prototype'].includes(String(token)))throw Error('Unsafe property path');
  tokens.push(token);
 }
 if(tokens.length>40)throw Error('Property path nesting limit exceeded');
 return tokens;
}
function upsertConfigValue(config:Record<string,unknown>,path:string,value:unknown,remove=false):boolean{
 const tokens=parseConfigPath(path);
 let node:Record<string,unknown>|unknown[]=config;
 for(let i=0;i<tokens.length-1;i++){
  const key=tokens[i],next=tokens[i+1];
  const current=(node as Record<string|number,unknown>)[key];
  if(!current||typeof current!=='object'||Array.isArray(current)!==(typeof next==='number')){
   if(remove)return false;
   (node as Record<string|number,unknown>)[key]=typeof next==='number'?[]:{};
  }
  node=(node as Record<string|number,unknown>)[key] as Record<string,unknown>|unknown[];
 }
 const last=tokens[tokens.length-1];
 if(remove){
  if(Array.isArray(node)&&typeof last==='number'){
   if(last>=node.length)return false;
   node.splice(last,1);return true;
  }
  if(!Object.prototype.hasOwnProperty.call(node,last))return false;
  delete (node as Record<string|number,unknown>)[last];return true;
 }
 const old=(node as Record<string|number,unknown>)[last];
 if(JSON.stringify(old)===JSON.stringify(value))return false;
 (node as Record<string|number,unknown>)[last]=value;
 return true;
}
function makeSheets(flow:FlowDefinitionMetadata):Sheet[] {
  const data:Record<SheetName,Row[]>={
    Manifest:[[flow.apiName,String(flow.versionNumber),digest(stable(flow)),'FlowExcelV1']],
    Nodes:flow.elements.map(node=>['UPSERT',String(node.id),node.type,node.label]),
    Inputs:flow.elements.flatMap(node=>flattenConfig(node.config??{}).map(([key,value])=>['UPSERT',String(node.id),key,JSON.stringify(value)??'null'])),
    Connections:flow.connectors.map(edge=>['UPSERT',edge.id,String(edge.from),String(edge.to),edge.label,edge.kind,edge.scheduledPath?JSON.stringify(edge.scheduledPath):'']),
    Resources:flow.resources.map(r=>['UPSERT',r.name,r.label,r.type,r.dataType,String(r.isCollection),String(r.availableForInput),String(r.availableForOutput),r.value===undefined?'':JSON.stringify(r.value)])
  };
  return (Object.keys(columns) as SheetName[]).map(name=>({name,rows:[columns[name],...data[name]]}));
}
export type FlowWorkbookTable={name:string;columns:string[];rows:Record<string,string>[];
 validations?:Array<{cells:string;choices:string[]}>};
export type FlowExcelCatalog={
 nodeTypes:string[];
 objects:Array<{apiName:string;label:string;fields:Array<{apiName:string;label:string;dataType:string}>}>;
};
export function flowWorkbookTables(flow:FlowDefinitionMetadata,catalog?:FlowExcelCatalog):FlowWorkbookTable[]{
 const tables:FlowWorkbookTable[]=makeSheets(flow).map(sheet=>({name:sheet.name,columns:sheet.rows[0],
  rows:sheet.rows.slice(1).map(row=>Object.fromEntries(sheet.rows[0].map((heading,index)=>[heading,row[index]??''])))}));
 const actions=[{cells:'A2:A10000',choices:['UPSERT','DELETE']}];
 const types=[...new Set(catalog?.nodeTypes??flow.elements.map(node=>node.type))].filter(Boolean);
 tables.find(t=>t.name==='Nodes')!.validations=[...actions,{cells:'C2:C10000',choices:types.slice(0,100)}];
 tables.find(t=>t.name==='Inputs')!.validations=[...actions];
 tables.find(t=>t.name==='Connections')!.validations=[...actions,
  {cells:'F2:F10000',choices:['normal','fault','scheduled','async']}];
 tables.find(t=>t.name==='Resources')!.validations=[...actions,
  {cells:'D2:D10000',choices:['Variable','Record','Record Collection','Formula','Constant','Choice','Choice Set','Text Template']},
  ...['F','G','H'].map(col=>({cells:col+'2:'+col+'10000',choices:['true','false']}))];
 const objs=catalog?.objects??[];
 const allFields=objs.flatMap(obj=>obj.fields.map(field=>({
  Category:'Field','Object API':obj.apiName,'API Name':field.apiName,Label:field.label,
  'Data Type':field.dataType
 })));
 const catalogRows:Record<string,string>[]=[
  ...types.map(type=>({Category:'Node Type','Object API':'','API Name':type,Label:type,'Data Type':''})),
  ...objs.map(obj=>({Category:'Object','Object API':obj.apiName,'API Name':obj.apiName,Label:obj.label,'Data Type':''})),
  ...allFields,
  ...flow.resources.map(resource=>({Category:'Resource','Object API':'','API Name':resource.name,
    Label:resource.label,'Data Type':resource.dataType}))
 ];
 tables.push({name:'Catalog',columns:['Category','Object API','API Name','Label','Data Type'],
  rows:catalogRows.slice(0,9000)});
 const inputs=tables.find(t=>t.name==='Inputs')!;
 const byNode=new Map(flow.elements.map(node=>[String(node.id),node]));
 const objectNames=objs.map(obj=>obj.apiName);
 inputs.rows.forEach((row,index)=>{
  const path=row.Property;
  let options:string[]=[];
  if(path==='object'||path==='objectApiName'||path.endsWith('.objectApiName'))
   options=objectNames;
  else if(/(?:fieldApiName|field)$/.test(path)){
   const node=byNode.get(row['Node ID']);
   const objectName=String(node?.config?.object??node?.config?.objectApiName??'');
   options=objs.find(obj=>obj.apiName===objectName)?.fields.map(field=>field.apiName)??[];
  }else if(/(?:outputVariable|resourceName)$/.test(path))
   options=flow.resources.map(resource=>resource.name);
  if(options.length>0&&options.length<=100)
   inputs.validations!.push({cells:'D'+(index+2),choices:options});
 });
 return tables;
}
export function decodeFlowWorkbook(base64:string):Uint8Array {
 const raw=atob(base64);const bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return bytes;
}
export async function encodeFlowWorkbook(file:File):Promise<string>{
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.length>5_000_000)throw Error('Excel exceeds 5 MB');
 let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(result);
}
export async function downloadFlowExcel(flow:FlowDefinitionMetadata,catalog?:FlowExcelCatalog) {
 const {apiRequest}=await import('../../authentication/Client/authClient');
 const result=await apiRequest<{workbook:string}>('/metadata/loader/flow-excel/write',{
  method:'POST',body:JSON.stringify({flowApi:flow.apiName,tables:flowWorkbookTables(flow,catalog)})});
 const bytes=decodeFlowWorkbook(result.workbook);
 const url=URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=flow.apiName+'_nodes.xlsx';anchor.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function readFlowExcel(file:File,flowApi:string):Promise<FlowWorkbookTable[]> {
 if(!/\\.xlsx$/i.test(file.name))throw Error('Only .xlsx files downloaded from Flow Builder are supported.');
 const {apiRequest}=await import('../../authentication/Client/authClient');
 const result=await apiRequest<{tables:FlowWorkbookTable[]}>('/metadata/loader/flow-excel/read',{
  method:'POST',body:JSON.stringify({flowApi,workbook:await encodeFlowWorkbook(file)})});
 return result.tables;
}
function parseSheets(tables:FlowWorkbookTable[]):Map<string,Row[]>{
 const result=new Map<string,Row[]>();
 for(const table of tables) {
  if(result.has(table.name))throw Error('Duplicate worksheet: '+table.name);
  result.set(table.name,[table.columns,...table.rows.map(row=>table.columns.map(heading=>row[heading]??''))]);
 }
 return result;
}
const bool=(value:string)=>{if(value!=='true'&&value!=='false')throw Error('Expected true or false, got '+value);return value==='true';};
const parseJson=(value:string)=>{
 const clean=value.trim();
 if(!clean)throw Error('Input value is missing');
 try{return JSON.parse(clean);}catch{
  // Dropdowns return plain object, field, or resource names.
  if(!/[{}\[\]"\r\n]/.test(clean))return clean;
  throw Error('Invalid JSON value: '+value.slice(0,50));
 }
};
function numericId(value:string){
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid numeric node ID: '+value);
  return number;
}
export type FlowImportPreview={draft:FlowDefinitionMetadata;changes:string[];errors:string[]};
export function previewFlowExcel(tables:FlowWorkbookTable[],original:FlowDefinitionMetadata,allowedTypes:string[]):FlowImportPreview {
  const errors:string[]=[];const changes:string[]=[];
  const sheets=parseSheets(tables);
  const manifest=sheets.get('Manifest');
  if(!manifest||manifest.length<2||manifest[1][3]!=='FlowExcelV1')throw Error('Invalid or unsupported Flow Excel template.');
  if(manifest[1][0]!==original.apiName)throw Error('Workbook belongs to another flow. Open that flow instead.');
  if(Number(manifest[1][1])!==original.versionNumber||manifest[1][2]!==digest(stable(original)))
    throw Error('The flow changed since download. Download a fresh workbook to avoid overwriting edits.');
  const rows=(name:SheetName):Row[]=>{
    const sheet=sheets.get(name);
    if(!sheet||JSON.stringify(sheet[0])!==JSON.stringify(columns[name]))throw Error(name+' columns were changed. Restore the original template.');
    return sheet.slice(1).filter(row=>row.some(value=>value.trim()));
  };
  const draft:FlowDefinitionMetadata={...original,elements:structuredClone(original.elements),
    connectors:structuredClone(original.connectors),resources:structuredClone(original.resources),status:'Draft'};
  const aliases=new Map<string,number>();
  let newId=Math.max(0,...draft.elements.map(node=>node.id));
  const resolve=(value:string)=>aliases.get(value)??numericId(value);
  const seenNodes=new Set<string>();
  const pendingNodeDeletes:string[]=[];
  rows('Nodes').forEach((r,i)=>{try{
    const [action,id,type,label]=r; if(!id)throw Error('Node ID is required.');
    if(seenNodes.has(id))throw Error('Duplicate node row: '+id);seenNodes.add(id);
    if(!['UPSERT','DELETE'].includes(action))throw Error('Action must be UPSERT or DELETE.');
    let node=draft.elements.find(n=>String(n.id)===id);
    if(action==='DELETE'){
      if(!node)throw Error('Node not found: '+id);
      if(node.type==='Start'||node.type==='End')throw Error('Start and End cannot be deleted.');
      pendingNodeDeletes.push(id);return;
    }
    if(node){if(type!==node.type)throw Error('Existing node type cannot change.');if(node.label!==label){node.label=label;changes.push('Update node '+id);}}
    else {
      if(!id.startsWith('NEW_'))throw Error('New nodes require IDs starting NEW_.');
      if(!allowedTypes.includes(type))throw Error('Node type not enabled: '+type);
      const allocated=++newId;aliases.set(id,allocated);
      draft.elements.push({id:allocated,type,label,config:{}});changes.push('Create node '+id+' (#'+allocated+')');
    }
  }catch(e){errors.push('Nodes row '+(i+2)+': '+String(e instanceof Error?e.message:e));}});
  rows('Inputs').forEach((r,i)=>{try{
    const [action,id,key,raw]=r;const node=draft.elements.find(n=>n.id===resolve(id));
    if(!node)throw Error('Node not found: '+id);
    if(!key||['__proto__','constructor','prototype'].includes(key))throw Error('Invalid config property.');
    if(action==='DELETE'){if(upsertConfigValue(node.config,key,undefined,true))changes.push('Delete input '+id+'.'+key);}
    else if(action==='UPSERT'){const value=parseJson(raw);if(upsertConfigValue(node.config,key,value))changes.push('Upsert input '+id+'.'+key);}
    else throw Error('Action must be UPSERT or DELETE.');
  }catch(e){errors.push('Inputs row '+(i+2)+': '+String(e instanceof Error?e.message:e));}});
  const seenEdges=new Set<string>();
  rows('Connections').forEach((r,i)=>{try{
    const [action,id,from,to,label,kind,scheduled]=r;
    if(!id)throw Error('Connection ID is required.');
    if(seenEdges.has(id))throw Error('Duplicate connection ID');seenEdges.add(id);
    const existing=draft.connectors.find(e=>e.id===id);
    if(action==='DELETE'){if(!existing)throw Error('Connection not found.');draft.connectors=draft.connectors.filter(e=>e.id!==id);changes.push('Delete connection '+id);return;}
    if(action!=='UPSERT')throw Error('Action must be UPSERT or DELETE.');
    if(!['normal','fault','scheduled','async'].includes(kind))throw Error('Invalid connector kind.');
    const fromId=resolve(from),toId=resolve(to);
    if(!draft.elements.some(n=>n.id===fromId)||!draft.elements.some(n=>n.id===toId))throw Error('Connection references missing node.');
    const path=scheduled?parseJson(scheduled):undefined;
    const updated={id,from:fromId,to:toId,label,kind:kind as 'normal'|'fault'|'scheduled'|'async',...(path?{scheduledPath:path}:{})};
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(updated)){Object.assign(existing,updated);changes.push('Update connection '+id);}}
    else {draft.connectors.push(updated);changes.push('Add connection '+id);}
  }catch(e){errors.push('Connections row '+(i+2)+': '+String(e instanceof Error?e.message:e));}});
  for(const id of pendingNodeDeletes) {
    const number=numericId(id);
    if(draft.connectors.some(e=>e.from===number||e.to===number)) {
      errors.push('Nodes DELETE '+id+': Remove or DELETE every connected edge in the same workbook.');
    }else {
      draft.elements=draft.elements.filter(node=>node.id!==number);
      changes.push('Delete node '+id);
    }
  }
  const seenResources=new Set<string>();
  rows('Resources').forEach((r,i)=>{try{
    const [action,name,label,type,dataType,collection,input,output,value]=r;
    if(!name)throw Error('Resource name required.');
    if(seenResources.has(name))throw Error('Duplicate resource name.');seenResources.add(name);
    const existing=draft.resources.find(x=>x.name===name);
    if(action==='DELETE'){draft.resources=draft.resources.filter(x=>x.name!==name);changes.push('Delete resource '+name);return;}
    if(action!=='UPSERT')throw Error('Action must be UPSERT or DELETE.');
    const next={name,label,type:type as FlowDefinitionMetadata['resources'][number]['type'],dataType,
      isCollection:bool(collection),availableForInput:bool(input),availableForOutput:bool(output),
      ...(value?{value:parseJson(value)}:{})};
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(next)){Object.assign(existing,next);changes.push('Update resource '+name);}}
    else {draft.resources.push(next);changes.push('Create resource '+name);}
  }catch(e){errors.push('Resources row '+(i+2)+': '+String(e instanceof Error?e.message:e));}});
  for(const p of flowGraphDiagnostics(draft))errors.push('Graph: '+p.description);
  if(draft.elements.filter(node=>node.type==='Start').length!==1)errors.push('Graph must have exactly one Start node.');
  if(draft.elements.some(node=>node.type!=='Start'&&node.type!=='End'&&!allowedTypes.includes(node.type)))errors.push('Flow contains node types unavailable in current capability catalogue.');
  if(changes.length===0)draft.status=original.status;
  return {draft,changes,errors};
}

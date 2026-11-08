import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {readComponentContract} from './component-contract-store.js';
import {availableComponentSettings,componentSettingIssues,type ComponentSettingDefinition} from './component-property-contract.js';
import {PAGE_LAYOUT_VARIANTS,type PageLayoutVariant} from '../system-files/page-layout-version-runtime.js';
import {randomUUID} from 'node:crypto';
import {componentInstanceNames,canonicalComponentName,componentNamePattern,ensureComponentInstanceNames} from './page-component-names.js';
import {pagePropertyContract,conditionSettings,recordFieldSettings,recordSectionSettings} from './page-property-contract.js';

/** One interoperable format for Page Builder inventory export and guarded draft import. */
/** Type and custom name are independent CSV identity columns. Ribbon Tab is display-only.
 * Layout selects the device layout draft (Desktop, Tablet, Mobile or Custom); a file
 * without the column, or a blank cell, keeps the historical Desktop behaviour. */
export const INVENTORY_COLUMNS=['pageapi','component_type','component_name','propertyid','value'] as const;
export const INVENTORY_EXPORT_COLUMNS=[...INVENTORY_COLUMNS,'layout','ribbon_tab'] as const;
/** Optional trailing columns accepted after the five identity/value columns. */
const OPTIONAL_TYPED_TAILS=[[],['ribbon_tab'],['layout'],['layout','ribbon_tab']] as const;
/** SQL Shape choices store the gallery markers "shapes" and "icons", not every id.
 * Accept a well-formed id from the marked gallery; the renderer ignores unknown ids. */
export function inventoryChoiceAllowed(choices:readonly string[],value:string):boolean{
 if(choices.includes(value))return true;
 if(choices.includes('shapes')&&/^shape:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))return true;
 return choices.includes('icons')&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value!=='shapes'&&value!=='icons';
}
/** Case-insensitive layout cell; "Phone" is the runtime alias of Mobile. */
export function inventoryLayout(value:string|undefined,fallback:PageLayoutVariant='Desktop'):PageLayoutVariant|null{
 const text=String(value??'').trim().toLowerCase();
 if(!text)return fallback;
 if(text==='phone')return 'Mobile';
 return PAGE_LAYOUT_VARIANTS.find(variant=>variant.toLowerCase()===text)??null;
}
const LEGACY_INVENTORY_COLUMNS=['pageapi','component_name','component_property','value'] as const;
export type InventoryIssue={row:number;pageapi?:string;component_type?:string;component_name:string;component_property:string;value?:string;remark:string};
type Block={id:string;type:string;label:string;region?:string;visible:boolean;
 position?:{x:number;y:number;width:number;height:number};
 properties:Record<string,unknown>};
export type InventoryPage={apiName:string;draftRevision?:number;layoutMode?:string;canvasWidth?:number;canvasHeight?:number;components:Block[];[key:string]:unknown};
export type InventoryRibbonProperty={
 id:string;tab:string;kind:string;defaultValue?:unknown;valueKey?:string;
 choices?:string[];min?:number;max?:number;
};
export type InventoryDefinitions=Map<string,ComponentSettingDefinition[]> & {
 /** Enabled SQL Ribbon rules, keyed by a published component API name. */
 ribbonProperties?:Map<string,InventoryRibbonProperty[]>;
 /** True when the complete SQL-backed property inventory has been read. */
 completeCatalog?:boolean;
 /** Only explicitly enabled tenant component registrations can be created. */
 installedTypes?:Set<string>;
};
type Definitions=InventoryDefinitions;
const componentApi=(type:string)=>type.startsWith('Custom:')?type.slice(7):type;
const componentType=(api:string)=>'Custom:'+api;
const validComponentApi=(api:string)=>/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(api);
const unsafe=new Set(['__proto__','prototype','constructor']);
// Internal hierarchy links and obsolete Advanced placeholders are not user-editable
// component properties. Their saved SQL values remain untouched by inventory import.
const excludedInventoryProperties=new Set(['cssClass','allowedChildTypes','maxChildren','layoutParentId','parentId','navigatorName','libraryComponentId']);
const inventoryPropertyAllowed=(key:string)=>!excludedInventoryProperties.has(key);
/** Existing shared Page Runtime metadata, present independently of a component's
 * optional SQL Ribbon slots. Do not invent per-page keys from saved values. */
const sharedPageSettings:ComponentSettingDefinition[]=[
 {...pagePropertyContract,section:'Advanced'},
 {propertyKey:'visibilityRules',label:'Visibility conditions',kind:'GROUP',
  fields:conditionSettings,section:'View'},
 {propertyKey:'actionFlows',label:'Configured Actions',kind:'GROUP',section:'Actions'},
 {propertyKey:'editorLocked',label:'Lock component in designer',kind:'BOOLEAN',
  defaultValue:false,section:'Arrange'}
];
const pageSettingsFor=(type:string):ComponentSettingDefinition[]=>[
 ...sharedPageSettings,
 ...(type==='Record Field'?recordFieldSettings:type==='Field Section'?recordSectionSettings:[])
];
const isPlain=(value:unknown):value is Record<string,unknown>=>value!==null
 &&typeof value==='object'&&!Array.isArray(value);
const safeParts=(path:string):string[]|null=>{
 const parts=path.split('.');
 return parts.length>0&&parts.length<=12&&parts.every(p=>/^[A-Za-z][A-Za-z0-9_]*$/.test(p)&&!unsafe.has(p))?parts:null;
};
const csvCell=(value:unknown)=>{
 const text=String(value??'');
 return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
};
export function inventoryCsv(rows:readonly (readonly unknown[])[]):string{
 return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
function valueText(value:unknown):string{
 return value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
}
function flatten(out:Map<string,string>,prefix:string,value:unknown):void{
 if(isPlain(value)&&Object.keys(value).length){
  for(const [key,child] of Object.entries(value))flatten(out,prefix+'.'+key,child);
 }else out.set(prefix,valueText(value));
}
function schemaLeaves(out:Map<string,{tab:string;defaultValue?:unknown;kind?:string}>,
 definitions:readonly ComponentSettingDefinition[],prefix='',section='Advanced'):void{
 for(const item of definitions){
  if(!prefix&&!inventoryPropertyAllowed(item.propertyKey))continue;
  const key=prefix+item.propertyKey,tab=item.section??section;
  if(item.kind==='GROUP'&&item.fields?.length)schemaLeaves(out,item.fields,key+'.',tab);
  else if(!out.has(key))out.set(key,{tab,defaultValue:item.defaultValue,kind:item.kind});
 }
}
/** Read through declared metadata paths only, not arbitrary instance keys. */
function pathValue(source:Record<string,unknown>,path:string):unknown{
 const parts=safeParts(path);
 if(!parts)return undefined;
 let value:unknown=source;
 for(const part of parts){if(!isPlain(value))return undefined;value=value[part];}
 return value;
}
const effective=(saved:unknown,defaultValue:unknown):unknown=>
 saved===undefined||saved===null||saved===''?defaultValue??saved:saved;

/** SQL defines tenant availability and component/ribbon applicability.
 * Published library contracts supplement shared UI property definitions.
 */
export async function inventoryDefinitions(db:SqlPersistence,tenant:string,
 components:readonly Block[],variant:PageLayoutVariant,extraTypes:readonly string[]=[]):Promise<Definitions>{
 const names=[...new Set([...components.map(c=>c.type),...extraTypes]
  .map(componentApi).filter(validComponentApi))];
 const definitions=new Map<string,ComponentSettingDefinition[]>() as Definitions;
 definitions.completeCatalog=true;
 definitions.installedTypes=new Set();
 if(!names.length){definitions.ribbonProperties=new Map();return definitions;}
 const available=await db.query<{api_name:string}>(`
  SELECT api_name FROM md_component_definitions
  WHERE tenant_id=$1 AND enabled=true AND api_name=ANY($2::text[])`,[tenant,names]);
 const installed=available.rows.map(row=>row.api_name);
 definitions.installedTypes=new Set(installed.map(componentType));
 if(!installed.length){definitions.ribbonProperties=new Map();return definitions;}
 const [published,ribbons]=await Promise.all([
  db.query<{component_api:string;published_version:number}>(`
   SELECT component_api,published_version FROM md_component_library_heads
   WHERE tenant_id=$1 AND component_api=ANY($2::text[]) AND published_version IS NOT NULL`,
   [tenant,installed]),
  db.query<{component_api:string;property_key:string;tab:string;kind:string;
   default_value:unknown;value_key:string|null;choices:unknown;min_value:number|null;max_value:number|null}>(`
   SELECT r.component_api,p.property_key,p.tab,
     COALESCE(r.control_kind_override,p.control_kind) AS kind,
     COALESCE(r.default_value_override,p.default_value) AS default_value,
     r.value_key,COALESCE(r.choices_override,p.choices) AS choices,p.min_value,p.max_value
   FROM md_builder_ribbon_component_rules r
   JOIN md_builder_shared_properties p ON p.property_key=r.property_key
   WHERE r.enabled=true AND p.scope='component'
     AND p.control_kind NOT IN ('command','readonly')
     AND r.component_api=ANY($1::text[])
   ORDER BY p.sort_order,p.property_key`,[installed])
 ]);
 for(const api of installed)definitions.set(componentType(api),[]);
 for(const row of published.rows){
  const contract=await readComponentContract(db,tenant,row.component_api,row.published_version);
  definitions.set(componentType(row.component_api),availableComponentSettings(
   contract.propertyDefinitions??[],variant,row.published_version));
 }
 const ribbonProperties=new Map<string,InventoryRibbonProperty[]>();
 for(const item of ribbons.rows){
  const type=componentType(item.component_api);
  if(!ribbonProperties.has(type))ribbonProperties.set(type,[]);
  if(!inventoryPropertyAllowed(item.property_key))continue;
  ribbonProperties.get(type)!.push({id:item.property_key,tab:item.tab,kind:item.kind,
   defaultValue:item.default_value??undefined,valueKey:item.value_key??undefined,
   choices:Array.isArray(item.choices)?item.choices.filter((x):x is string=>typeof x==='string'):[],
   min:item.min_value??undefined,max:item.max_value??undefined});
 }
 definitions.ribbonProperties=ribbonProperties;
 return definitions;
}
/** A stable, metadata-complete list per component type, independent of how many
 * instance keys happen to have been saved. Never writes defaults back to SQL. */
export function exportInventoryCsv(page:InventoryPage,definitions:Definitions=new Map(),
 variant:PageLayoutVariant='Desktop'):string{
 const rows:unknown[][]=[[...INVENTORY_EXPORT_COLUMNS]];
 const names=componentInstanceNames(page.components);
 for(const component of page.components){
  const values=new Map<string,{value:unknown;tab:string}>([
   ['component.visible',{value:component.visible,tab:'View'}],
   ['component.region',{value:component.region??'main',tab:'Layout'}],
   ['component.position.x',{value:component.position?.x,tab:'Layout'}],
   ['component.position.y',{value:component.position?.y,tab:'Layout'}],
   ['component.position.width',{value:component.position?.width,tab:'Layout'}],
   ['component.position.height',{value:component.position?.height,tab:'Layout'}]
  ]);
  const properties=component.properties??{};
  const published=new Map<string,{tab:string;defaultValue?:unknown;kind?:string}>();
  for(const item of definitions.ribbonProperties?.get(component.type)??[])
   published.set(item.id,{tab:item.tab,defaultValue:item.defaultValue,kind:item.kind});
  schemaLeaves(published,definitions.get(component.type)??[]);
  schemaLeaves(published,pageSettingsFor(component.type));
  // Old call sites with no SQL catalogue retain their saved-property export.
  // Real API downloads always supply completeCatalog and use the stable list.
  if(!definitions.completeCatalog||(!component.type.startsWith('Custom:')&&
    !(definitions.get(component.type)?.length||definitions.ribbonProperties?.get(component.type)?.length))){
   const legacy=new Map<string,string>();
   for(const [key,value] of Object.entries(properties))
    if(inventoryPropertyAllowed(key))flatten(legacy,key,value);
   for(const [key,value] of legacy)values.set(key,{value,tab:published.get(key)?.tab??'Advanced'});
  }
  for(const [id,descriptor] of published){
   const ribbon=definitions.ribbonProperties?.get(component.type)?.find(row=>row.id===id);
   values.set(id,{value:effective(pathValue(properties,ribbon?.valueKey??id),descriptor.defaultValue),
    tab:descriptor.tab});
  }
  for(const [key,{value,tab}] of values)
   rows.push([page.apiName,componentApi(component.type),names.get(component.id),key,valueText(value),variant,tab]);
 }
 return inventoryCsv(rows);
}
type CsvRow={line:number;cells:string[]};
type CsvFormat='typed'|'legacy';
function parseCsv(text:string):{rows:CsvRow[];issues:InventoryIssue[];columns:number;format:CsvFormat;
 layoutIndex:number;header:string[]}{
 const issues:InventoryIssue[]=[];
 if(text.length>1800000)return {rows:[],columns:5,format:'typed',layoutIndex:-1,header:[],issues:[{row:1,component_name:'',component_property:'',remark:'CSV exceeds the 1.8 MB import limit'}]};
 const rows:CsvRow[]=[],current:string[]=[];
 let cell='',quoted=false,afterQuote=false,line=1,start=1;
 const finishCell=()=>{current.push(cell);cell='';afterQuote=false;};
 const finishRow=()=>{
  finishCell();
  if(current.some(x=>x.trim()))rows.push({line:start,cells:[...current]});
  current.length=0;start=line;
 };
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
   else if(ch==='"'){quoted=false;afterQuote=true;}
   else{cell+=ch;if(ch==='\n')line++;}
  }else if(ch==='"'&&!cell&&!afterQuote)quoted=true;
  else if(ch===',')finishCell();
  else if(ch==='\n'||ch==='\r'){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   line++;finishRow();
  }else if(afterQuote&&!/\s/.test(ch)){
   issues.push({row:start,component_name:'',component_property:'',remark:'Unexpected characters after a quoted CSV value'});
   cell+=ch;
  }else if(ch==='"'){
   issues.push({row:start,component_name:'',component_property:'',remark:'Unexpected quote in CSV value'});
  }else cell+=ch;
  if(rows.length>50000){
   issues.push({row:line,component_name:'',component_property:'',remark:'CSV exceeds 50,000 rows'});
   break;
  }
 }
 if(quoted)issues.push({row:start,component_name:'',component_property:'',remark:'Unclosed quoted CSV value'});
 if(current.length||cell)finishRow();
 if(!rows.length)issues.push({row:1,component_name:'',component_property:'',remark:'CSV is empty'});
 const header=rows[0]?.cells.map((v,i)=>i===0?v.replace(/^\uFEFF/,'').trim().toLowerCase():v.trim().toLowerCase())??[];
 const typed=header.length>=5&&header.slice(0,5).every((value,i)=>value===INVENTORY_COLUMNS[i])&&
  OPTIONAL_TYPED_TAILS.some(tail=>tail.length===header.length-5&&tail.every((value,i)=>header[5+i]===value));
 const legacy=header.length>=4&&header.slice(0,4).every((value,i)=>value===LEGACY_INVENTORY_COLUMNS[i])&&
  (header.length===4||header.length===5&&header[4]==='ribbon_tab');
 const format:CsvFormat=typed?'typed':'legacy';
 const columns=typed||legacy?header.length:format==='typed'?5:4;
 if(!typed&&!legacy&&rows.length)issues.push({row:rows[0].line,component_name:'',component_property:'',
  remark:'Expected CSV columns: '+INVENTORY_COLUMNS.join(',')+'[,layout][,ribbon_tab]'});
 return {rows:rows.slice(1),issues,columns,format,layoutIndex:typed?header.indexOf('layout'):-1,
  header:typed||legacy?header:[]};
}
/**
 * Partition a downloaded inventory CSV by its authored pageapi column.
 * Each partition is passed to the existing validated, per-page upsert engine.
 * Preserve original CSV line numbers in error reports, including quoted line breaks.
 */
export type InventoryCsvPageGroup={
 pageapi:string; variant:PageLayoutVariant; key:string;
 csv:string; originalLines:Record<number,number>; firstRow:number
};
/** Draft-revision key of one page layout in a batch. Desktop keeps the plain page API. */
export const inventoryGroupKey=(pageapi:string,variant:PageLayoutVariant)=>
 variant==='Desktop'?pageapi:pageapi+'|'+variant;
export function inventoryCsvPageGroups(text:string,defaultVariant:PageLayoutVariant='Desktop'):{
 groups:InventoryCsvPageGroup[];issues:InventoryIssue[]
}{
 const parsed=parseCsv(text);
 const issues=[...parsed.issues];
 if(issues.length)return {groups:[],issues};
 // The per-page engine receives the same columns without Layout: each group is one layout.
 const layoutIndex=parsed.layoutIndex;
 const withoutLayout=<T,>(cells:readonly T[])=>layoutIndex<0?[...cells]:cells.filter((_,i)=>i!==layoutIndex);
 const header=withoutLayout(parsed.header);
 const grouped=new Map<string,{pageapi:string;variant:PageLayoutVariant;rows:string[][];
  originalLines:Record<number,number>;nextLine:number;firstRow:number}>();
 for(const row of parsed.rows){
  const pageapi=(row.cells[0]??'').trim();
  if(!pageapi||!validComponentApi(pageapi)){
   issues.push({row:row.line,pageapi,component_name:row.cells[parsed.format==='typed'?2:1]??'',
    component_property:row.cells[parsed.format==='typed'?3:2]??'',
    remark:pageapi?'Invalid Page API name':'Page API is required'});
   continue;
  }
  const variant=inventoryLayout(layoutIndex<0?'':row.cells[layoutIndex],defaultVariant);
  if(!variant){
   issues.push({row:row.line,pageapi,component_type:row.cells[1]??'',component_name:row.cells[2]??'',
    component_property:row.cells[3]??'',value:row.cells[layoutIndex]??'',
    remark:'Layout must be Desktop, Tablet, Mobile or Custom'});
   continue;
  }
  const key=inventoryGroupKey(pageapi,variant);
  let entry=grouped.get(key);
  if(!entry){
   if(grouped.size>=50){
    issues.push({row:row.line,pageapi,component_name:'',component_property:'',
      remark:'CSV may reference at most 50 existing page layouts'});
    continue;
   }
   entry={pageapi,variant,rows:[],originalLines:{},nextLine:2,firstRow:row.line};
   grouped.set(key,entry);
  }
  const cells=withoutLayout(row.cells);
  entry.originalLines[entry.nextLine]=row.line;
  entry.rows.push(cells);
  const serialized=inventoryCsv([cells]);
  // Same newline accounting as parseCsv for quoted multi-line values.
  entry.nextLine+=(serialized.match(/\r\n|\r|\n/g)??[]).length;
 }
 return {groups:[...grouped.entries()].map(([key,group])=>({
  pageapi:group.pageapi,variant:group.variant,key,csv:inventoryCsv([header,...group.rows]),
  originalLines:group.originalLines,firstRow:group.firstRow
 })),issues};
}
export function originalInventoryIssue(group:InventoryCsvPageGroup,issue:InventoryIssue):InventoryIssue{
 const candidate=Object.keys(group.originalLines).map(Number)
  .filter(line=>line<=issue.row).sort((a,b)=>b-a)[0];
 return {...issue,pageapi:group.pageapi,
  row:candidate===undefined?group.firstRow:group.originalLines[candidate]};
}

function lookupSchema(defs:readonly ComponentSettingDefinition[],parts:readonly string[]):ComponentSettingDefinition|undefined{
 let current=defs,found:ComponentSettingDefinition|undefined;
 for(let i=0;i<parts.length;i++){
  found=current.find(d=>d.propertyKey===parts[i]);
  if(!found)return;
  if(i!==parts.length-1){
   if(found.kind!=='GROUP'||!found.fields)return;
   current=found.fields as ComponentSettingDefinition[];
  }
 }
 return found;
}
function parsedValue(input:string,original:unknown,kind?:string):unknown{
 const trimmed=input.trim();
 if(typeof original==='number'||kind==='NUMBER'||kind==='CURRENCY'||kind==='number'){
  const number=Number(trimmed);
  if(!trimmed||!Number.isFinite(number))throw Error('Enter a finite numeric value');
  return number;
 }
 if(kind==='position'&&trimmed&&Number.isFinite(Number(trimmed)))return Number(trimmed);
 if(typeof original==='boolean'||kind==='BOOLEAN'||kind==='boolean'){
  if(trimmed.toLowerCase()==='true')return true;
  if(trimmed.toLowerCase()==='false')return false;
  throw Error('Enter true or false');
 }
 const list=['COLLECTION','STRING_LIST','FIELD_LIST','COLUMNS','OPTIONS','RECORD_LIST'];
 if(Array.isArray(original)||kind==='weekdays'||kind&&list.includes(kind)){
  try{const value=JSON.parse(input);if(Array.isArray(value))return value;}catch{}
  throw Error('Enter a valid JSON array');
 }
 if(isPlain(original)||kind==='GROUP'){
  try{const value=JSON.parse(input);if(isPlain(value))return value;}catch{}
  throw Error('Enter a valid JSON object');
 }
 return input;
}
/** Resolve installed component APIs ahead of importer validation. */
export function inventoryRequestedTypes(csv:string):string[]{
 const {rows,columns,issues,format}=parseCsv(csv);
 if(issues.length)return [];
 const candidates=rows.filter(row=>row.cells.length===columns);
 const types=format==='typed'?candidates.map(row=>row.cells[1].trim()):
  candidates.filter(row=>row.cells[2].trim()==='component.type').map(row=>row.cells[3].trim());
 return [...new Set(types.map(componentApi).filter(validComponentApi).map(componentType))].slice(0,100);
}
type ImportedRow={row:CsvRow;api:string;type:string;name:string;property:string;value:string};
export function applyInventoryCsv(page:InventoryPage,csv:string,definitions:Definitions=new Map(),
 variant:PageLayoutVariant='Desktop'){
 const {rows,issues,columns,format,layoutIndex}=parseCsv(csv);
 // A single-page upload may carry the Layout column; it must name the layout being edited.
 const layoutMatches=(row:CsvRow)=>layoutIndex<0||inventoryLayout(row.cells[layoutIndex],variant)===variant;
 const entries:ImportedRow[]=rows.map(row=>({
  row,api:row.cells[0]??'',type:format==='typed'?row.cells[1]??'':'',
  name:row.cells[format==='typed'?2:1]??'',
  property:row.cells[format==='typed'?3:2]??'',
  value:row.cells[format==='typed'?4:3]??''
 }));
 const copy=structuredClone(page);
 const names=componentInstanceNames(copy.components);
 const byName=new Map([...copy.components].map(c=>[canonicalComponentName(names.get(c.id)!),c]));
 const byId=new Map(copy.components.map(c=>[c.id,c]));
 const seen=new Set<string>(),rejectedNames=new Set<string>();
 let changes=0,skipped=0;
 const report=(entry:ImportedRow,remark:string)=>issues.push({
  row:entry.row.line,pageapi:entry.api,component_type:entry.type,
  component_name:entry.name,component_property:entry.property,value:entry.value,remark
 });
 const legacyTypes=new Map<string,string>();
 if(format==='legacy')for(const entry of entries){
  if(entry.property.trim()==='component.type'){
   const key=canonicalComponentName(entry.name),previous=legacyTypes.get(key);
   if(previous&&previous!==entry.value.trim())report(entry,'Conflicting component types for one name');
   else legacyTypes.set(key,entry.value.trim());
  }
 }
 // Resolve every instance once before applying properties. Order is irrelevant.
 for(const entry of entries){
  if(issues.length>=500)break;
  if(entry.row.cells.length!==columns||entry.api.trim()!==page.apiName||!entry.name.trim()||!layoutMatches(entry.row))continue;
  const key=canonicalComponentName(entry.name);
  if(byName.has(key)||format==='legacy'&&byId.has(entry.name)||rejectedNames.has(key))continue;
  if(!componentNamePattern.test(entry.name)){
   report(entry,'New component name must begin with a letter (max 80 characters)');
   rejectedNames.add(key);continue;
  }
  const rawType=format==='typed'?entry.type.trim():legacyTypes.get(key)??'';
  const api=componentApi(rawType);
  if(!rawType||!validComponentApi(api)){
   report(entry,format==='legacy'
    ?'Component does not exist. Add a component.type row with a valid Custom: component type.'
    :'Component type is missing or invalid');
   rejectedNames.add(key);continue;
  }
  const type=componentType(api);
  if(!definitions.has(type)||(definitions.completeCatalog&&definitions.installedTypes&&
      !definitions.installedTypes.has(type))){
   report(entry,'Component type is not enabled for this tenant or has no installed metadata');
   rejectedNames.add(key);continue;
  }
  if(copy.components.length>=400){
   report(entry,'Page layout cannot contain more than 400 components');rejectedNames.add(key);continue;
  }
  const canvas=page.layoutMode==='free-canvas';
  const component:Block={id:'import-'+randomUUID(),type,label:api,region:'main',visible:true,
   properties:{navigatorName:entry.name,libraryComponentId:api},
   ...(canvas?{position:{x:0,y:0,width:Math.min(page.canvasWidth??1440,320),
    height:Math.min(page.canvasHeight??900,180)}}:{})
  };
  copy.components.push(component);byName.set(key,component);byId.set(component.id,component);changes++;
 }
 for(const entry of entries){
  if(issues.length>=500)break;
  if(entry.row.cells.length!==columns){report(entry,'Expected '+columns+' CSV columns');continue;}
  if(!layoutMatches(entry.row)){report(entry,'Layout does not match the selected layout: '+variant);continue;}
  if(entry.api.trim()!==page.apiName){report(entry,'Page API does not match selected page: '+page.apiName);continue;}
  const component=byName.get(canonicalComponentName(entry.name))??
   (format==='legacy'?byId.get(entry.name):undefined);
  if(!component){
   if(!issues.some(issue=>issue.component_name===entry.name))
    report(entry,'Component not found or could not be created: '+entry.name);
   continue;
  }
  if(format==='typed'){
   const requested=componentApi(entry.type.trim());
   if(requested!==componentApi(component.type)){
    report(entry,'Component type mismatch: existing instance is '+componentApi(component.type));continue;
   }
  }
  const property=entry.property.trim();
  if(!property){report(entry,'Property ID is required');continue;}
  const pair=component.id+'\u0000'+property;
  if(seen.has(pair)){report(entry,'Duplicate component property in CSV');continue;}
  seen.add(pair);
  if(entry.value.trim()===''){skipped++;continue;}
  const value=entry.value;
  if(property.startsWith('component.')){
   const name=property.slice('component.'.length);
   if(name==='type'){
    if(format==='typed')report(entry,'Component type belongs in component_type, not propertyid');
    else if(value!==component.type)report(entry,'Component type cannot be changed');
   }else if(name==='id'){
    if(format==='typed')report(entry,'Component ID is immutable; use the custom component name');
    else if(value!==component.id)report(entry,'Component ID is immutable');
   }else if(name==='label'){
    if(value.length>200){report(entry,'Component label exceeds 200 characters');continue;}
    if(component.label!==value){component.label=value;changes++;}
   }else if(name==='visible'){
    if(!/^(true|false)$/i.test(value.trim())){report(entry,'Visibility must be true or false');continue;}
    const next=value.trim().toLowerCase()==='true';
    if(component.visible!==next){component.visible=next;changes++;}
   }else if(name==='region'){
    if(!['header','main','sidebar'].includes(value.trim())){report(entry,'Invalid component region');continue;}
    if(component.region!==value.trim()){component.region=value.trim();changes++;}
   }else if(name.startsWith('position.')){
    const coord=name.slice('position.'.length);
    if(!['x','y','width','height'].includes(coord)){report(entry,'Unknown canvas position property');continue;}
    if(!component.position){report(entry,'Component has no editable canvas position on this layout');continue;}
    const number=Number(value.trim());
    if(!Number.isFinite(number)||Math.abs(number)>100000||(['width','height'].includes(coord)&&number<=0)){
     report(entry,'Canvas position must be a finite number; width and height must be positive');continue;
    }
    const pos=component.position as unknown as Record<string,number>;
    if(pos[coord]!==number){pos[coord]=number;changes++;}
   }else report(entry,'Unknown or protected component property');
   continue;
  }
  const path=property.startsWith('properties.')?property.slice(11):property;
  const parts=safeParts(path);
  if(!parts){report(entry,'Invalid property path');continue;}
  if(!inventoryPropertyAllowed(parts[0])){
   report(entry,'This property is internal or retired and cannot be changed by CSV');continue;
  }
  const schema=lookupSchema([
   ...(definitions.get(component.type)??[]),...pageSettingsFor(component.type)],parts);
  const ribbon=parts.length===1?definitions.ribbonProperties?.get(component.type)?.find(item=>item.id===parts[0]):undefined;
  const storageParts=ribbon?.valueKey?safeParts(ribbon.valueKey):parts;
  if(!storageParts){report(entry,'Invalid shared Ribbon property storage path');continue;}
  const original=pathValue(component.properties??{},storageParts.join('.'));
  const hasPublishedCatalog=Boolean(definitions.completeCatalog&&component.type.startsWith('Custom:')&&
   ((definitions.ribbonProperties?.get(component.type)?.length??0)>0||
    (definitions.get(component.type)?.length??0)>0));
  if(!schema&&!ribbon&&(original===undefined||hasPublishedCatalog)){
   report(entry,'Unknown or disabled component metadata property');continue;
  }
  try{
   // A Ribbon choice can represent a multi-select when SQL stores an array
   // default (e.g. Smart Cart columnVisibility). An unsaved target instance
   // must inherit that value shape just as an exported source instance does.
   const defaultValue=ribbon?.defaultValue??schema?.defaultValue;
   const valueShape=original===undefined||original===null||original===''?defaultValue:original;
   const next=parsedValue(value,valueShape,schema?.kind??ribbon?.kind);
   const schemaIssue=schema?componentSettingIssues(schema,next,property)[0]:undefined;
   if(schemaIssue){report(entry,schemaIssue.path+': '+schemaIssue.message);continue;}
   const choices=ribbon?.choices??[];
   if(choices.length&&(Array.isArray(next)
    ?next.some(item=>typeof item!=='string'||!inventoryChoiceAllowed(choices,item))
    :!inventoryChoiceAllowed(choices,String(next)))){
    report(entry,'Choose a listed option for '+property);continue;
   }
   if((ribbon?.kind==='number'||ribbon?.kind==='position')&&typeof next==='number'&&
      (ribbon.min!==undefined&&next<ribbon.min||ribbon.max!==undefined&&next>ribbon.max)){
    report(entry,'Enter a number within the allowed range');continue;
   }
   // Importing a complete export must not turn defaults into explicit overrides.
   if((original===undefined||original===null||original==='')&&
    defaultValue!==undefined&&JSON.stringify(next)===JSON.stringify(defaultValue)){
    skipped++;continue;
   }
   if(JSON.stringify(original)===JSON.stringify(next))continue;
   let target:Record<string,unknown>=component.properties??(component.properties={});
   let missingParent=false;
   for(const segment of storageParts.slice(0,-1)){
    const candidate=target[segment];
    if(candidate===undefined){if(!schema&&!ribbon){missingParent=true;break;}target[segment]={};}
    else if(!isPlain(candidate)){missingParent=true;break;}
    target=target[segment] as Record<string,unknown>;
   }
   if(missingParent){report(entry,'Nested component property does not exist');continue;}
   target[storageParts[storageParts.length-1]]=next;changes++;
  }catch(error){report(entry,error instanceof Error?error.message:'Invalid component property value');}
 }
 if(issues.length===0&&changes>0)copy.components=ensureComponentInstanceNames(copy.components);
 issues.sort((a,b)=>a.row-b.row);
 return {valid:issues.length===0,issues,changes,skipped,page:copy};
}

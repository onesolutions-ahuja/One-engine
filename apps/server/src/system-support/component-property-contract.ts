/** Browser/server-safe Property Engine contract. No IO, permissions or executable expressions. */
export const PROPERTY_SCHEMA_VERSION = 1;
export const propertyKinds = ['TEXT','NUMBER','BOOLEAN','COLOR','IMAGE','SELECT','OBJECT',
 'OBJECT_FIELD','FLOW','CURRENCY','FIELD_LIST','COLUMNS','OPTIONS','RECORD_LIST',
 'GROUP','COLLECTION','STRING_LIST'] as const;
export type ComponentSettingKind = typeof propertyKinds[number];
export type PropertyDevice = 'Mobile'|'Desktop'|'Tablet'|'Custom';
export type ComponentSettingDefinition = {
 propertyKey:string; label:string; kind:ComponentSettingKind;
 required?:boolean; isBindable?:boolean; displayOrder?:number;
 choices?:ReadonlyArray<{key:string;label:string}>;
 defaultValue?:string|number|boolean|readonly unknown[]|Readonly<Record<string,unknown>>|null;
 fields?:readonly ComponentSettingDefinition[];
 min?:number; max?:number; maxLength?:number; minItems?:number; maxItems?:number;
 schemaVersion?:number; sinceVersion?:number; devices?:readonly PropertyDevice[];
 helpText?:string;
 /** Ribbon journey tab and selected component part. Stable persisted property keys are unchanged. */
 section?:'Data'|'Content'|'Design'|'Layout'|'Actions'|'Responsive'|'Appearance'|string;
 group?:string;
};
export type PropertyIssue={path:string;message:string};
const keyPattern=/^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const blocked=new Set(['__proto__','constructor','prototype']);
export const isPropertyRecord=(value:unknown):value is Record<string,unknown> => Boolean(value)
 &&typeof value==='object'&&!Array.isArray(value)
 &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
export function sortComponentSettings(definitions:readonly ComponentSettingDefinition[]):ComponentSettingDefinition[]{
 return [...definitions].sort((a,b)=>(a.displayOrder??0)-(b.displayOrder??0)||a.propertyKey.localeCompare(b.propertyKey));
}
/** Merge definitions, not values. A local schema owns the complete key contract. */
export function mergeComponentSettings(shared:readonly ComponentSettingDefinition[],local:readonly ComponentSettingDefinition[]){
 const map=new Map(shared.map(d=>[d.propertyKey,d]));
 for(const d of local)map.set(d.propertyKey,d);
 return [...map.values()];
}
/** Missing differs from explicitly cleared. Never mutate defaults or discard unknown instance keys. */
export function resolveComponentSettings(definitions:readonly ComponentSettingDefinition[],instance:Readonly<Record<string,unknown>>):Record<string,unknown>{
 const result:Record<string,unknown>={...instance};
 for(const d of definitions){
  if(blocked.has(d.propertyKey))continue;
  if(!Object.prototype.hasOwnProperty.call(instance,d.propertyKey)&&d.defaultValue!==undefined)
   result[d.propertyKey]=structuredClone(d.defaultValue);
  const value=result[d.propertyKey];
  if(d.kind==='GROUP'&&d.fields&&isPropertyRecord(value))result[d.propertyKey]=resolveComponentSettings(d.fields,value);
  if(d.kind==='COLLECTION'&&d.fields&&Array.isArray(value))result[d.propertyKey]=value.map(row=>
   isPropertyRecord(row)?resolveComponentSettings(d.fields!,row):row);
 }
 return result;
}
export function componentSettingAvailable(d:ComponentSettingDefinition,device?:PropertyDevice,version?:number){
 return (!device||!d.devices||d.devices.includes(device))&&(!version||!d.sinceVersion||d.sinceVersion<=version);
}
/** Apply eligibility recursively without changing the saved instance. */
export function availableComponentSettings(definitions:readonly ComponentSettingDefinition[],device?:PropertyDevice,version?:number):ComponentSettingDefinition[]{
 return definitions.filter(d=>componentSettingAvailable(d,device,version)).map(d=>d.fields
  ?{...d,fields:availableComponentSettings(d.fields,device,version)}:d);
}
/** Validate values without coercing, pruning or silently upgrading saved metadata. */
export function componentSettingIssues(d:ComponentSettingDefinition,value:unknown,path=d.propertyKey,depth=0):PropertyIssue[]{
 const fail=(message:string)=>[{path,message}];
 if(depth>8)return fail('Property nesting is too deep');
 if(d.schemaVersion!==undefined&&d.schemaVersion!==PROPERTY_SCHEMA_VERSION)return fail('Unsupported property schema version');
 if(value===undefined||value===null||value==='')return d.required?fail('A value is required'):[];
 if(d.kind==='GROUP')return isPropertyRecord(value)?validateComponentSettings(d.fields??[],value,path,depth+1):fail('Choose a settings group');
 if(d.kind==='COLLECTION'||d.kind==='STRING_LIST'||['FIELD_LIST','COLUMNS','OPTIONS','RECORD_LIST'].includes(d.kind)){
  if(!Array.isArray(value))return fail('Choose a list');
  if(value.length<(d.minItems??0)||value.length>(d.maxItems??500))return fail('List length is outside the allowed range');
  return value.flatMap((row,i)=>d.kind==='STRING_LIST'
   ?typeof row==='string'&&row.length<=(d.maxLength??20000)?[]:[{path:path+'.'+i,message:'Enter text'}]
   :isPropertyRecord(row)?(d.fields?validateComponentSettings(d.fields,row,path+'.'+i,depth+1):[]):[{path:path+'.'+i,message:'Choose a settings row'}]);
 }
 if(d.kind==='NUMBER'||d.kind==='CURRENCY')return typeof value==='number'&&Number.isFinite(value)
  &&(d.min===undefined||value>=d.min)&&(d.max===undefined||value<=d.max)?[]:fail('Enter a number within the allowed range');
 if(d.kind==='BOOLEAN')return typeof value==='boolean'?[]:fail('Choose yes or no');
 if(d.kind==='SELECT')return typeof value==='string'&&d.choices?.some(c=>c.key===value)?[]:fail('Choose a listed option');
 return typeof value==='string'&&value.length<=(d.maxLength??20000)?[]:fail('Enter text within the allowed length');
}
export function validateComponentSettings(definitions:readonly ComponentSettingDefinition[],values:Readonly<Record<string,unknown>>,prefix='',depth=0):PropertyIssue[]{
 return definitions.flatMap(d=>componentSettingIssues(d,values[d.propertyKey],prefix?prefix+'.'+d.propertyKey:d.propertyKey,depth));
}
export const validateComponentSetting=(d:ComponentSettingDefinition,value:unknown)=>componentSettingIssues(d,value).length===0;
/** Bound the schema itself before recursive editor/runtime use. */
export function validateComponentDefinitions(raw:unknown):PropertyIssue[]{
 let count=0;
 const walk=(items:unknown,path:string,depth:number):PropertyIssue[]=>{
  if(!Array.isArray(items)||items.length>500||depth>6)return [{path,message:'Invalid property definitions'}];
  const seen=new Set<string>();
  return items.flatMap((item,index):PropertyIssue[]=>{
   const p=path+'.'+index;
   if(++count>2000||!isPropertyRecord(item))return [{path:p,message:'Invalid property definition'}];
   const d=item as unknown as ComponentSettingDefinition;
   if(typeof d.propertyKey!=='string'||!keyPattern.test(d.propertyKey)||blocked.has(d.propertyKey)||seen.has(d.propertyKey)
    ||typeof d.label!=='string'||!d.label.trim()||d.label.length>200||!propertyKinds.includes(d.kind))return [{path:p,message:'Invalid or duplicate property identity/type'}];
   seen.add(d.propertyKey);
   const issues:PropertyIssue[]=[];
   if(d.schemaVersion!==undefined&&d.schemaVersion!==PROPERTY_SCHEMA_VERSION)issues.push({path:p,message:'Unsupported property schema version'});
   if(d.sinceVersion!==undefined&&(!Number.isSafeInteger(d.sinceVersion)||d.sinceVersion<1))issues.push({path:p,message:'Invalid component version'});
   for(const k of ['required','isBindable'] as const)if(d[k]!==undefined&&typeof d[k]!=='boolean')issues.push({path:p+'.'+k,message:'Expected boolean'});
   for(const k of ['min','max','displayOrder'] as const)if(d[k]!==undefined&&(typeof d[k]!=='number'||!Number.isFinite(d[k])))issues.push({path:p+'.'+k,message:'Expected finite number'});
   for(const k of ['minItems','maxItems','maxLength'] as const)if(d[k]!==undefined&&(!Number.isSafeInteger(d[k])||d[k]!<0||d[k]!>(k==='maxLength'?20000:500)))issues.push({path:p+'.'+k,message:'Invalid size limit'});
   if(d.min!==undefined&&d.max!==undefined&&d.min>d.max||d.minItems!==undefined&&d.maxItems!==undefined&&d.minItems>d.maxItems)issues.push({path:p,message:'Minimum exceeds maximum'});
   if(d.devices!==undefined&&(!Array.isArray(d.devices)||!d.devices.length||new Set(d.devices).size!==d.devices.length||d.devices.some(x=>!['Mobile','Desktop','Tablet','Custom'].includes(x))))issues.push({path:p,message:'Invalid device list'});
   if(d.helpText!==undefined&&(typeof d.helpText!=='string'||d.helpText.length>2000))issues.push({path:p,message:'Invalid help text'});
   for(const name of ['section','group'] as const)
    if(d[name]!==undefined&&(typeof d[name]!=='string'||!d[name]!.trim()||d[name]!.length>100))
     issues.push({path:p+'.'+name,message:'Choose a readable ribbon section or component part (up to 100 characters)'});
   if(d.kind==='SELECT'&&(!Array.isArray(d.choices)||!d.choices.length||d.choices.length>500||d.choices.some(c=>!isPropertyRecord(c)||typeof c.key!=='string'||typeof c.label!=='string')||new Set(d.choices.map(c=>c.key)).size!==d.choices.length))issues.push({path:p,message:'Invalid choices'});
   if(d.kind==='GROUP'||d.kind==='COLLECTION')issues.push(...walk(d.fields,p+'.fields',depth+1));
   else if(d.fields!==undefined)issues.push({path:p,message:'Only groups and collections have fields'});
   if(!issues.length&&d.defaultValue!==undefined)issues.push(...componentSettingIssues(d,resolveComponentSettings([d],{})[d.propertyKey],p+'.defaultValue'));
   return issues;
  });
 };
 return walk(raw,'properties',0);
}

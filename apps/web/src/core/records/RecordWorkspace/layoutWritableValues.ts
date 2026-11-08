import type {PageLayoutMetadata} from '../../metadata/Definitions/metadata';

/** Layout constraints are not permissions. The Record API still enforces RBAC.
 * Keep schema-required fields present in payloads for legacy page compatibility;
 * avoid submitting a value for a field the authored page hid or made read-only.
 */
export function filterLayoutWritableValues(
  values:Readonly<Record<string,unknown>>,
  layout:PageLayoutMetadata|undefined,
  schemaRequired:ReadonlySet<string>,
  authoredDynamicFields=false
):Record<string,unknown>{
  if(!layout)return {...values};
  const visible=new Set(layout.sections.flatMap(section=>section.fieldApiNames));
  const readOnly=new Set(layout.sections.flatMap(section=>section.readOnlyFieldApiNames??[]));
  return Object.fromEntries(Object.entries(values).filter(([name])=>
    name==='RecordTypeId'||(!readOnly.has(name)&&(visible.has(name)||(!authoredDynamicFields&&schemaRequired.has(name))))
  ));
}

/** Validate only writable, visible layout-required fields. Hidden conditional
 * fields cannot block submission; read-only fields cannot demand an input.
 * Schema/server validation is intentionally independent and remains authoritative.
 */
export function missingLayoutRequiredFields(
  values:Readonly<Record<string,unknown>>,
  layout:PageLayoutMetadata|undefined,
  writable:ReadonlySet<string>
):string[]{
  if(!layout)return [];
  const missing:string[]=[];
  const visited=new Set<string>();
  for(const section of layout.sections){
    const visible=new Set(section.fieldApiNames);
    const disabled=new Set(section.readOnlyFieldApiNames??[]);
    for(const name of section.requiredFieldApiNames??[]){
      if(visited.has(name)||!visible.has(name)||disabled.has(name)||!writable.has(name))continue;
      visited.add(name);
      const value=values[name];
      if(value===null||value===undefined||(typeof value==='string'&&value.trim()===''))
        missing.push(name);
    }
  }
  return missing;
}

/** Use the same defaults presented by the create form when a required input
 * was not changed. Preserve explicit false, zero and empty values.
 */
export function applyRequiredLayoutDefaults(
 values:Readonly<Record<string,unknown>>,
 layout:PageLayoutMetadata|undefined,
 fields:ReadonlyArray<{apiName:string;defaultValue?:unknown}>,
 writable:ReadonlySet<string>
):Record<string,unknown>{
 const result={...values};
 if(!layout)return result;
 const required=new Set(layout.sections.flatMap(section=>
   (section.requiredFieldApiNames??[]).filter(name=>
     section.fieldApiNames.includes(name)&&!(section.readOnlyFieldApiNames??[]).includes(name))));
 for(const field of fields){
   if(!required.has(field.apiName)||!writable.has(field.apiName)
     ||Object.prototype.hasOwnProperty.call(result,field.apiName)
     ||field.defaultValue===undefined||field.defaultValue===null)continue;
   result[field.apiName]=field.defaultValue;
 }
 return result;
}

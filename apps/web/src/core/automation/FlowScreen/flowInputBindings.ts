import type { FieldMetadata, FlowDefinitionMetadata, FlowResourceMetadata } from '../../metadata/Definitions/metadata';

export type InputSourceKind = 'Unmapped' | 'Literal' | 'Event' | 'Event Field' | 'Record Field' | 'Page State' | 'Numeric Page State' | 'Record Collection' | 'Session' | 'Legacy';
export type InputSource = { kind: InputSourceKind; detail: string; value: unknown };
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
export const sessionInputFields=Object.freeze([
 {key:'id',label:'Page session ID'},
 {key:'cartId',label:'Active Cart record ID'},
 {key:'user.id',label:'Logged-in user ID'},
 {key:'user.email',label:'Logged-in user email'},
 {key:'user.name',label:'Logged-in user name'},
 {key:'tenant.id',label:'Current tenant ID'},
 {key:'tenant.name',label:'Company name'},
 {key:'tenant.logo',label:'Company logo'}
] as const);
const isSessionField=(value:string):boolean=>
 sessionInputFields.some(item=>item.key===value);
const eventPath = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
const isSafeEventPath = (path: string): boolean => eventPath.test(path)
  && !path.split('.').some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment));

/** Read the resources that the active Flow version actually exposes. */
export function declaredFlowInputs(flow?: FlowDefinitionMetadata): FlowResourceMetadata[] {
  if (!flow) return [];
  const version = flow.versions?.find(item => item.versionNumber === flow.activeVersion);
  const resources = version?.resources ?? flow.resources ?? [];
  return resources.filter(item => item.availableForInput && identifier.test(item.name));
}

export function declaredFlowOutputs(flow?: FlowDefinitionMetadata): FlowResourceMetadata[] {
  if (!flow) return [];
  const version = flow.versions?.find(item => item.versionNumber === flow.activeVersion);
  const resources = version?.resources ?? flow.resources ?? [];
  return resources.filter(item => item.availableForOutput && identifier.test(item.name));
}

export function resolveFlowOutputBindings(
  outputs: Record<string, unknown>,
  mappings: unknown
): Array<{ key: string; value: unknown }> {
  if (mappings === undefined || mappings === null) return [];
  if (typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('Flow output mappings must be an object.');
  }
  return Object.entries(mappings).flatMap(([name, target]) => {
    if (!identifier.test(name) || typeof target !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(target)) {
      throw new Error('Flow output mapping requires valid variable names.');
    }
    return Object.hasOwn(outputs, name) ? [{ key: target, value: outputs[name] }] : [];
  });
}

/** Reusable declarative Flow input transforms; no runtime POS-specific code. */
export function resolveStructuredFlowInput(
 option:Record<string,unknown>,resolve:(source:unknown)=>unknown
):unknown {
 if(option.source==='ToNumber'){
  const raw=resolve(option.value);
  if(typeof raw==='number')return Number.isFinite(raw)?raw:undefined;
  if(typeof raw!=='string'||!/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(raw.trim()))return undefined;
  const amount=Number(raw.trim());
  return Number.isFinite(amount)?amount:undefined;
 }
 if(option.source==='ProjectRecords'){
  const raw=resolve(option.value),fields=option.fields;
  if(!Array.isArray(raw)||raw.length>200||!Array.isArray(fields)
   ||fields.length<1||fields.length>20||new Set(fields).size!==fields.length
   ||fields.some(field=>typeof field!=='string'||!identifier.test(field)
    ||field==='Id'||['__proto__','prototype','constructor'].includes(field)))return undefined;
  const result:Array<Record<string,string|number|boolean|null>>=[];
  for(const item of raw){
   if(!item||typeof item!=='object'||Array.isArray(item))return undefined;
   const row=item as Record<string,unknown>,selected:Record<string,string|number|boolean|null>={};
   for(const field of fields as string[]){
    if(!Object.prototype.hasOwnProperty.call(row,field))return undefined;
    const value=row[field];
    if(value!==null&&typeof value!=='string'&&typeof value!=='boolean'
     &&(typeof value!=='number'||!Number.isFinite(value)))return undefined;
    selected[field]=value as string|number|boolean|null;
   }
   result.push(selected);
  }
  return result;
 }
 return undefined;
}

export function decodeInputSource(value: unknown, hasMapping = true): InputSource {
  if (!hasMapping) return { kind: 'Unmapped', detail: '', value: undefined };
  if (value === '$session'||value==='$session.id')
    return {kind:'Session',detail:'id',value};
  if(typeof value==='string'&&value.startsWith('$session.')){
    const detail=value.slice(9);
    return isSessionField(detail)?{kind:'Session',detail,value}
     :{kind:'Legacy',detail:'',value};
  }
  if (value === '$event') return { kind: 'Event', detail: '', value };
  if (typeof value === 'string' && value.startsWith('$event.')) {
    const path = value.slice(7);
    return isSafeEventPath(path)
      ? { kind: 'Event Field', detail: path, value }
      : { kind: 'Legacy', detail: '', value };
  }
  if (typeof value === 'string' && value.startsWith('$state.')) {
    const key=value.slice(7);
    return identifier.test(key)&&key.length<=64
      ?{kind:'Page State',detail:key,value}
      :{kind:'Legacy',detail:'',value};
  }
  if (typeof value === 'string' && value.startsWith('$record.')) {
    const field = value.slice(8);
    return identifier.test(field)
      ? { kind: 'Record Field', detail: field, value }
      : { kind: 'Legacy', detail: '', value };
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const o=value as Record<string,unknown>;
    if(o.source==='ToNumber'&&typeof o.value==='string'&&/^\$state\.[A-Za-z][A-Za-z0-9_]*$/.test(o.value))
     return {kind:'Numeric Page State',detail:o.value.slice(7),value};
    if(o.source==='ProjectRecords'&&typeof o.value==='string'
     &&/^\$state\.[A-Za-z][A-Za-z0-9_]*$/.test(o.value)&&Array.isArray(o.fields))
     return {kind:'Record Collection',detail:o.value.slice(7)+':'+o.fields.join(','),value};
    return {kind:'Legacy',detail:'',value};
  }
  return { kind: 'Literal', detail: String(value ?? ''), value };
}

export function encodeInputSource(
  kind: Exclude<InputSourceKind, 'Legacy'>,
  detail: string,
  fields: ReadonlyArray<Pick<FieldMetadata, 'apiName'>>,
  dataType = ''
): unknown {
  if (kind === 'Unmapped') return undefined;
  if (kind === 'Session') {
    if(!detail)return '$session'; // Previously saved page-session mapping.
    if(!isSessionField(detail))throw Error('Choose a supported session field.');
    return '$session.'+detail;
  }
  if (kind === 'Page State') {
    if(!identifier.test(detail)||detail.length>64)throw new Error('Choose a valid page state key.');
    return '$state.'+detail;
  }
  if(kind==='Numeric Page State'){
    if(!identifier.test(detail)||detail.length>64)throw Error('Enter a Page State key.');
    return {source:'ToNumber',value:'$state.'+detail};
  }
  if(kind==='Record Collection'){
    const [key,...tail]=detail.split(':');
    const items=tail.join(':').split(',').map(s=>s.trim()).filter(Boolean);
    if(!identifier.test(key)||key.length>64||items.length<1||items.length>20
     ||new Set(items).size!==items.length
     ||items.some(item=>!identifier.test(item)||item==='Id'))
      throw Error('Enter state key and field names, excluding Id.');
    return {source:'ProjectRecords',value:'$state.'+key,fields:items};
  }
  if (kind === 'Event') return '$event';
  if (kind === 'Event Field') {
    if (!isSafeEventPath(detail)) throw new Error('Choose a valid event property (for example item.id).');
    return '$event.' + detail;
  }
  if (kind === 'Record Field') {
    if (!fields.some(field => field.apiName === detail)) {
      throw new Error('Select an available field from the component data object.');
    }
    return '$record.' + detail;
  }
  // The existing runtime treats special $ prefixes as expressions; do not
  // let a text literal masquerade as an event, record or session reference.
  if (detail.startsWith('$event') || detail.startsWith('$record') || detail.startsWith('$state') || detail === '$session') {
    throw new Error('This literal is reserved for a metadata reference.');
  }
  const type = dataType.toLowerCase().trim();
  if (type === 'boolean' || type === 'checkbox') {
    if (detail !== 'true' && detail !== 'false') throw new Error('Boolean literals must be true or false.');
    return detail === 'true';
  }
  if (/^(number|currency|percent|integer|decimal|double)(\(|$)/.test(type)) {
    if (detail.trim() === '' || !Number.isFinite(Number(detail))) throw new Error('Enter a finite numeric value.');
    return Number(detail);
  }
  return detail;
}

export function mappedInputNames(flow: FlowDefinitionMetadata | undefined, inputs: Record<string, unknown>): string[] {
  const declared = declaredFlowInputs(flow).map(item => item.name);
  return [...new Set([...declared, ...Object.keys(inputs)])];
}

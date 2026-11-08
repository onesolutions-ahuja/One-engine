import type { FieldMetadata, ObjectMetadata } from '../../../../core/metadata/Definitions/metadata';

export type MentionKind = 'text' | 'image' | 'url' | 'number' | 'formula';
export type MentionField = {
  objectApiName: string; objectLabel: string; fieldApiName: string;
  fieldLabel: string; dataType: string; path: string; reference: string;
};
export type MentionGroup = {
  objectApiName: string; label: string; primary: boolean; path: string;
  via: string; fields: MentionField[];
};
export type MentionPath = {
  path: string; root: string; target: ObjectMetadata;
  field: FieldMetadata; steps: Array<{ source: string; target: string; lookupField: string; name: string }>;
};
type DataRecord = Record<string, unknown>;
export type MentionContext = { records: Record<string, DataRecord | undefined>; fields: Record<string, string[]> };

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const REFERENCE = /(^|[^A-Za-z0-9_@])@([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){1,4})(?![A-Za-z0-9_.])/g;
const MAX_HOPS = 3;
const MAX_REFERENCES = 64;
const emptyContext = (): MentionContext => ({ records: {}, fields: {} });
const recordIdField: FieldMetadata = { apiName: 'Id', label: 'Record ID', dataType: 'Id', required: true, unique: true };
const objectFields = (object: ObjectMetadata): FieldMetadata[] =>
  object.fields.some(field => field.apiName === 'Id') ? object.fields : [recordIdField, ...object.fields];

export function isCompatibleField(dataType: string, kind: MentionKind): boolean {
  if (kind === 'text' || kind === 'formula') return true;
  if (kind === 'number') return /^(number|integer|decimal|double|currency|percent)/i.test(dataType);
  if (kind === 'image') return /^(url|image|text|formula)/i.test(dataType);
  return /^(url|email|text|phone|formula)/i.test(dataType);
}

/** Only parent (single-record) lookups; reverse child relationships are collections, not scalar values. */
export function mentionPaths(objects: readonly ObjectMetadata[], root: string): Array<{
  path: string; object: ObjectMetadata; via: string; steps: MentionPath['steps'];
}> {
  const first = objects.find(object => object.apiName === root);
  if (!first) return [];
  const paths = [{ path: root, object: first, via: '', steps: [] as MentionPath['steps'], visited: [root] }];
  for (let index = 0; index < paths.length && paths.length < 100; index++) {
    const current = paths[index];
    if (current.steps.length >= MAX_HOPS) continue;
    const candidates = current.object.fields.filter(field => field.relationship && NAME.test(field.relationship.relationshipName));
    for (const field of candidates) {
      const relation = field.relationship!;
      const target = objects.find(object => object.apiName === relation.targetObject);
      if (!target || current.visited.includes(target.apiName)) continue;
      // No guessing between duplicate or damaged relationship metadata.
      if (candidates.filter(other => other.relationship?.relationshipName === relation.relationshipName).length !== 1) continue;
      paths.push({
        path: current.path + '.' + relation.relationshipName, object: target,
        via: current.via ? current.via + ' → ' + relation.relationshipName : current.object.label + ' → ' + relation.relationshipName,
        steps: [...current.steps, { source: current.object.apiName, target: target.apiName,
          lookupField: field.apiName, name: relation.relationshipName }],
        visited: [...current.visited, target.apiName]
      });
      if (paths.length >= 100) break;
    }
  }
  return paths.map(({ visited: _visited, ...path }) => path);
}

/** Picker: current Object, then reachable lookup relationships; app membership never creates a relationship. */
export function mentionGroups(
  objects: readonly ObjectMetadata[], primaryObjectApiName = '',
  _appObjectApiNames: readonly string[] = [], query = '', kind: MentionKind = 'text'
): MentionGroup[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  return mentionPaths(objects, primaryObjectApiName).filter(node => kind !== 'formula' || node.steps.length === 0).map(node => ({
    objectApiName: node.object.apiName, label: node.object.label,
    primary: node.path === primaryObjectApiName, path: node.path, via: node.via,
    fields: objectFields(node.object).filter(field => {
      if (!isCompatibleField(field.formula?.returnType ?? field.dataType, kind)) return false;
      const pathLabel = node.path.toLowerCase();
      const pathQuery = q.includes('.') && q.startsWith(pathLabel + '.')
        ? q.slice(pathLabel.length + 1) : undefined;
      return !q || [node.object.label, node.object.apiName, node.path, node.via, field.label, field.apiName]
        .some(value => value.toLowerCase().includes(q))
        || (pathQuery !== undefined && field.apiName.toLowerCase().startsWith(pathQuery))
        || (q.includes('.') && pathLabel.split('.').length === q.split('.').length - 1
          && pathLabel.startsWith(q.slice(0, q.lastIndexOf('.')))
          && field.apiName.toLowerCase().startsWith(q.slice(q.lastIndexOf('.') + 1)));
    }).map(field => ({
      objectApiName: node.object.apiName, objectLabel: node.object.label,
      fieldApiName: field.apiName, fieldLabel: field.label,
      dataType: field.formula?.returnType ?? field.dataType,
      path: node.path, reference: '@' + node.path + '.' + field.apiName
    }))
  })).filter(group => group.fields.length > 0);
}

/** Resolve each path step against validated Object Manager relationship metadata. */
export function validateMentionPath(
  rawPath: string, objects: readonly ObjectMetadata[], rootObjectApiName: string,
  kind: MentionKind = 'text'
): MentionPath | null {
  const parts = rawPath.replace(/^@/, '').split('.');
  if (parts.length < 2 || parts.length > MAX_HOPS + 2 || parts[0] !== rootObjectApiName
    || !parts.every(part => NAME.test(part))) return null;
  let current = objects.find(object => object.apiName === rootObjectApiName);
  if (!current) return null;
  const steps: MentionPath['steps'] = [], seen = new Set([rootObjectApiName]);
  for (const name of parts.slice(1, -1)) {
    if (!current) return null;
    const source: ObjectMetadata = current;
    const options: FieldMetadata[] = source.fields.filter(field => field.relationship?.relationshipName === name);
    if (options.length !== 1) return null;
    const relation: NonNullable<FieldMetadata['relationship']> = options[0].relationship!;
    const target: ObjectMetadata | undefined = objects.find(object => object.apiName === relation.targetObject);
    if (!target || seen.has(target.apiName)) return null;
    steps.push({ source: source.apiName, target: target.apiName, lookupField: options[0].apiName, name });
    current = target;
    seen.add(target.apiName);
  }
  if (!current) return null;
  if (kind === 'formula' && steps.length > 0) return null; // server formula runtime has no related-record context
  const field = objectFields(current).find(field => field.apiName === parts[parts.length - 1]);
  if (!field || !isCompatibleField(field.formula?.returnType ?? field.dataType, kind)) return null;
  return { path: parts.slice(0, -1).join('.'), root: rootObjectApiName, target: current, field, steps };
}

export type MentionSegment = { text: string; reference: boolean };
export function mentionSegments(
  value: string, objects: readonly ObjectMetadata[], kind: MentionKind = 'text',
  rootObjectApiName = ''
): MentionSegment[] {
  const output: MentionSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(REFERENCE)) {
    const start = match.index + match[1].length;
    const end = match.index + match[0].length;
    if (!validateMentionPath(match[2], objects, rootObjectApiName, kind)) continue;
    if (start > last) output.push({ text: value.slice(last, start), reference: false });
    output.push({ text: value.slice(start, end), reference: true });
    last = end;
  }
  if (last < value.length) output.push({ text: value.slice(last), reference: false });
  return output.length ? output : [{ text: value, reference: false }];
}

export function referencedMentionPaths(
  properties: Readonly<Record<string, unknown>>, objects: readonly ObjectMetadata[], root: string
): MentionPath[] {
  const distinct = new Map<string, MentionPath>();
  for (const raw of Object.values(properties)) {
    if (typeof raw !== 'string') continue;
    for (const match of raw.matchAll(REFERENCE)) {
      const path = validateMentionPath(match[2], objects, root);
      if (path) distinct.set(path.path, path);
      if (distinct.size >= MAX_REFERENCES) return [...distinct.values()];
    }
  }
  return [...distinct.values()];
}
function allowFields(context: MentionContext, path: string, record: DataRecord | undefined, object: ObjectMetadata) {
  context.records[path] = record;
  context.fields[path] = record ? objectFields(object).filter(field => Object.hasOwn(record, field.apiName))
    .map(field => field.apiName) : [];
}

/** All records are already OneEngine-authorised. Follow stored lookup IDs only; no first-record fallback. */
export function loadedMentionContext(
  objects: readonly ObjectMetadata[], root: string, record: DataRecord | undefined,
  availableRecords: Readonly<Record<string, readonly DataRecord[]>>, properties: Readonly<Record<string, unknown>>
): MentionContext {
  const context = emptyContext(), source = objects.find(item => item.apiName === root);
  if (!source || !record) return context;
  allowFields(context, root, record, source);
  const paths = referencedMentionPaths(properties, objects, root).sort((a, b) => a.steps.length - b.steps.length);
  for (const path of paths) {
    if (!path.steps.length) continue;
    let node: DataRecord | undefined = record, prefix = root;
    for (const step of path.steps) {
      prefix += '.' + step.name;
      if (context.records[prefix]) { node = context.records[prefix]; continue; }
      const lookup = node?.[step.lookupField];
      const related = typeof lookup === 'string' && lookup.length > 0
        ? availableRecords[step.target]?.find(item => item.Id === lookup) : undefined;
      const target = objects.find(item => item.apiName === step.target)!;
      allowFields(context, prefix, related, target);
      node = related;
    }
  }
  return context;
}

/** For Page runtime: fetch exact related IDs through the existing tenant- and RBAC-checked record endpoint. */
export async function loadMentionContext(
  objects: readonly ObjectMetadata[], root: string, record: DataRecord | undefined,
  properties: Readonly<Record<string, unknown>>,
  getRecord: (objectApiName: string, id: string) => Promise<DataRecord | undefined>
): Promise<MentionContext> {
  const context = emptyContext(), source = objects.find(item => item.apiName === root);
  if (!source || !record) return context;
  allowFields(context, root, record, source);
  const cache = new Map<string, DataRecord | undefined>();
  const paths = referencedMentionPaths(properties, objects, root).sort((a, b) => a.steps.length - b.steps.length);
  for (const path of paths) {
    let node: DataRecord | undefined = record, prefix = root;
    for (const step of path.steps) {
      prefix += '.' + step.name;
      if (Object.hasOwn(context.records, prefix)) { node = context.records[prefix]; continue; }
      const id = node?.[step.lookupField];
      let related: DataRecord | undefined;
      if (typeof id === 'string' && id.length > 0 && id.length <= 256) {
        const key = step.target + ':' + id;
        if (!cache.has(key)) {
          try { cache.set(key, await getRecord(step.target, id)); } catch { cache.set(key, undefined); }
        }
        related = cache.get(key);
        if (related?.Id !== id) related = undefined;
      }
      const target = objects.find(item => item.apiName === step.target)!;
      allowFields(context, prefix, related, target);
      node = related;
    }
  }
  return context;
}

/** Unknown, mistyped or inaccessible references remain literal, never become dynamic. */
export function resolveMentionValue(
  raw: unknown, recordsByPath: Readonly<Record<string, DataRecord | undefined>>,
  fieldsByPath: Readonly<Record<string, readonly string[]>>,
  objects: readonly ObjectMetadata[] = [], root = ''
): unknown {
  if (typeof raw !== 'string' || !raw.includes('@')) return raw;
  const resolve = (rawPath: string) => {
    const parts = rawPath.split('.'), field = parts.pop()!, path = parts.join('.');
    if (!fieldsByPath[path]?.includes(field) || !Object.hasOwn(recordsByPath[path] ?? {}, field)) {
      return { found: false, known: Boolean(root && validateMentionPath(rawPath, objects, root)) };
    }
    const value = recordsByPath[path]?.[field];
    return { found: true, value: ['string', 'number', 'boolean'].includes(typeof value) ? value : '' };
  };
  const exact = /^@([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){1,4})$/.exec(raw);
  if (exact) { const result = resolve(exact[1]); return result.found ? result.value : result.known ? '' : raw; }
  return raw.replace(REFERENCE, (whole, prefix: string, path: string) => {
    const result = resolve(path);
    return result.found ? prefix + String(result.value ?? '') : result.known ? prefix : whole;
  });
}
export function resolveMentionProperties(
  properties: Record<string, unknown>, recordsByPath: Readonly<Record<string, DataRecord | undefined>>,
  fieldsByPath: Readonly<Record<string, readonly string[]>>,
  objects: readonly ObjectMetadata[] = [], root = ''
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) =>
    [key, resolveMentionValue(value, recordsByPath, fieldsByPath, objects, root)]));
}

/**
 * Resolve metadata-declared parent lookups for each row of a bounded record
 * collection. The authenticated caller supplies an exact-ID record loader.
 * Reuse requests by object/Id, limit concurrent rows and never infer a parent
 * from an unrelated list or return an unverified record.
 */
export async function resolveCollectionMentionRows(
  objects: readonly ObjectMetadata[], root: string,
  rows: readonly DataRecord[], properties: Readonly<Record<string, unknown>>,
  getRecord: (objectApiName: string, id: string) => Promise<DataRecord | undefined>,
  getRecords?: (objectApiName: string, ids: readonly string[]) => Promise<readonly DataRecord[]>
): Promise<DataRecord[]> {
  const paths=referencedMentionPaths(properties,objects,root);
  if(!paths.length)return [...rows];
  const work=rows.slice(0,100);
  const cache=new Map<string,Promise<DataRecord|undefined>>();
  // First-hop parents (CartLine -> Product) for every row arrive in ONE authorised
  // list request per Object (Id IN, max 100), not one request per row. Deeper hops
  // and any Id the list did not return fall back to the exact-Id loader.
  if(getRecords){
    const wanted=new Map<string,Set<string>>();
    for(const path of paths){
      const step=path.steps[0];
      if(!step)continue;
      for(const row of work){
        const id=row[step.lookupField];
        if(typeof id!=='string'||!id||id.length>256)continue;
        if(!wanted.has(step.target))wanted.set(step.target,new Set());
        wanted.get(step.target)!.add(id);
      }
    }
    await Promise.all([...wanted].map(async([objectApiName,idSet])=>{
      const ids=[...idSet];
      for(let start=0;start<ids.length;start+=100){
        const chunk=ids.slice(start,start+100);
        let found:readonly DataRecord[]=[];
        try{found=await getRecords(objectApiName,chunk);}catch{found=[];}
        for(const record of found)
          if(typeof record?.Id==='string'&&chunk.includes(record.Id))
            cache.set(JSON.stringify([objectApiName,record.Id]),Promise.resolve(record));
      }
    }));
  }
  const cached=async(objectApiName:string,id:string):Promise<DataRecord|undefined>=>{
    if(id.length>256)return undefined;
    const key=JSON.stringify([objectApiName,id]);
    let pending=cache.get(key);
    if(!pending){
      if(cache.size>=300)return undefined;
      pending=getRecord(objectApiName,id).then(record=>
        record?.Id===id?record:undefined).catch(()=>undefined);
      cache.set(key,pending);
    }
    return pending;
  };
  const resolved:DataRecord[]=new Array(work.length);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,work.length)},async()=>{
    while(cursor<work.length){
      const index=cursor++;
      const record=work[index];
      const context=await loadMentionContext(objects,root,record,properties,cached);
      const values:Record<string,unknown>={};
      for(const path of paths){
        const ref='@'+path.path+'.'+path.field.apiName;
        values[ref]=resolveMentionValue(ref,context.records,context.fields,objects,root);
      }
      resolved[index]={...record,__mentionValues:values};
    }
  }));
  return resolved;
}

import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';

/** Component IDs are page-scoped keys, not renderer types or display labels.
 * Existing generated IDs are retained; only a user-authored rename must meet
 * the new readable-identifier contract. */
export const COMPONENT_ID_MAX_LENGTH=128;
const editableId=/^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const reserved=new Set(['__proto__','prototype','constructor']);

export function validateComponentId(
 value:string,components:readonly Pick<PageComponentMetadata,'id'>[],originalId:string
):string|null{
 const proposed=value.trim();
 if(!proposed)return 'Component ID is required.';
 if(proposed.length>COMPONENT_ID_MAX_LENGTH||!editableId.test(proposed)
   ||reserved.has(proposed.toLowerCase()))
  return 'Start with a letter; use only letters, numbers, underscores or hyphens (maximum 128 characters).';
 if(components.some(component=>component.id!==originalId
   &&component.id.toLowerCase()===proposed.toLowerCase()))
  return 'This Component ID is already used on this page.';
 return null;
}

/** Final save guard also covers imported or externally modified page drafts. */
export function duplicatePageComponentId(
 components:readonly Pick<PageComponentMetadata,'id'>[]
):string|null{
 const ids=new Set<string>();
 for(const component of components){
  if(typeof component.id!=='string'||!component.id.trim())
   return 'Every component must have an ID.';
  const key=component.id.toLowerCase();
  if(ids.has(key))return 'Duplicate Component ID on this page: '+component.id;
  ids.add(key);
 }
 return null;
}

const referenceKeys=new Set([
 'parentId','layoutParentId','targetComponentId','sourceComponentId','componentId'
]);
/** Only known component-reference slots are rewritten. Formulas, user text,
 * record IDs, source names and unrelated metadata are left untouched. */
function remapReferences(value:unknown,from:string,to:string,depth=0):unknown{
 if(depth>24)return value;
 if(Array.isArray(value)){
  let changed=false;
  const result=value.map(item=>{
   const next=remapReferences(item,from,to,depth+1);
   if(next!==item)changed=true;
   return next;
  });
  return changed?result:value;
 }
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)
  return value;
 const source=value as Record<string,unknown>;
 let changed=false;
 const next:Record<string,unknown>={...source};
 for(const [key,entry]of Object.entries(source)){
  const mapped=referenceKeys.has(key)&&entry===from?to:remapReferences(entry,from,to,depth+1);
  if(mapped!==entry){next[key]=mapped;changed=true;}
 }
 return changed?next:value;
}

/** Rename one selected component and its internal page references atomically.
 * The caller commits the resulting page through the normal draft/undo engine. */
export function renamePageComponentId<T extends PageComponentMetadata>(
 components:readonly T[],oldId:string,proposed:string
):T[]{
 if(!components.some(component=>component.id===oldId))
  throw Error('Selected component no longer exists.');
 const nextId=proposed.trim();
 const error=validateComponentId(nextId,components,oldId);
 if(error)throw Error(error);
 if(nextId===oldId)return [...components];
 return components.map(component=>{
  const properties=remapReferences(component.properties,oldId,nextId) as T['properties'];
  const parentId=component.parentId===oldId?nextId:component.parentId;
  if(component.id===oldId)return {...component,id:nextId,parentId,properties};
  if(properties!==component.properties||parentId!==component.parentId)
   return {...component,parentId,properties};
  return component;
 });
}

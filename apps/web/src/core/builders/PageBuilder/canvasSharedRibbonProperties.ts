import type {PageComponentMetadata} from '../../metadata/Definitions/metadata';
import type {BuilderRibbonProperty,BuilderTab} from './builderPropertyInventory';

type Values=Record<string,unknown>;
type Position=NonNullable<PageComponentMetadata['position']>;
const apiOf=(item:PageComponentMetadata)=>item.type.startsWith('Custom:')?item.type.slice(7):'';
const parentOf=(item:PageComponentMetadata)=>typeof item.properties.layoutParentId==='string'
  && item.properties.layoutParentId?item.properties.layoutParentId:item.parentId??null;
const keyOf=(property:BuilderRibbonProperty,item:PageComponentMetadata)=>
  property.valueKeys?.[apiOf(item)]??property.id;
const kindOf=(property:BuilderRibbonProperty,item:PageComponentMetadata)=>
  property.kindOverrides?.[apiOf(item)]??property.kind;

const choicesOf=(property:BuilderRibbonProperty,item:PageComponentMetadata)=>
  property.choicesOverrides?.[apiOf(item)]??property.choices??[];
const conditionAllows=(property:BuilderRibbonProperty,item:PageComponentMetadata,
  definitions:readonly BuilderRibbonProperty[])=>{
  const condition=property.enabledWhenOverrides?.[apiOf(item)]??property.enabledWhen;
  if(!condition)return true;
  const controlling=definitions.find(p=>p.id===condition.property);
  const value=item.properties[condition.property]??
    controlling?.defaultsOverrides?.[apiOf(item)]??controlling?.default;
  return condition.in.includes(String(value??''));
};
/** The intersection must include not just type/kind, but conditional enablement
 * and available choices for every selected component. An incompatible editor
 * stays visible but disabled rather than writing invalid properties. */
export function isSharedCanvasProperty(property:BuilderRibbonProperty,
  members:readonly PageComponentMetadata[],definitions:readonly BuilderRibbonProperty[]=[property]){
  if(!members.length)return false;
  const primary=members[0];
  if(!members.every(item=>
    property.components.includes(apiOf(item)) &&
    item.properties.editorLocked!==true &&
    parentOf(item)===parentOf(primary) &&
    kindOf(property,item)===kindOf(property,primary) &&
    conditionAllows(property,item,definitions)))return false;
  if(kindOf(property,primary)==='choice'){
    const declared=members.map(item=>choicesOf(property,item));
    // An unrestricted property has no fixed choices. Otherwise, every selected
    // component must have at least one permitted common choice.
    if(declared.every(choices=>choices.length))
      return declared[0].some(choice=>declared.every(choices=>choices.includes(choice)));
  }
  return true;
}
const choiceAllows=(property:BuilderRibbonProperty,members:readonly PageComponentMetadata[],
  nextValue:unknown)=>{
  if(kindOf(property,members[0])!=='choice')return true;
  // The ribbon's blank "Select" entry clears an override and is available
  // even when the SQL metadata enumerates only non-empty choices.
  if(nextValue===''||nextValue===null)return true;
  return members.every(member=>{
    const choices=choicesOf(property,member);
    if(!choices.length)return true;
    return Array.isArray(nextValue)
      ?nextValue.every(value=>typeof value==='string'&&choices.includes(value))
      :typeof nextValue==='string'&&choices.includes(nextValue);
  });
};

export function mixedCanvasPropertyIds(
  definitions:readonly BuilderRibbonProperty[],tab:BuilderTab,
  members:readonly PageComponentMetadata[]
):string[]{
  if(members.length<2)return [];
  return definitions.filter(p=>p.tab===tab&&isSharedCanvasProperty(p,members,definitions)&&
    members.some(item=>JSON.stringify(item.properties[keyOf(p,item)]??p.defaultsOverrides?.[apiOf(item)]??p.default)
      !==JSON.stringify(members[0].properties[keyOf(p,members[0])]??
        p.defaultsOverrides?.[apiOf(members[0])]??p.default)))
    .map(p=>p.id);
}

/** One history entry for all members, preserving unrelated metadata and each
 * component's registry-defined value key. Never edit a non-shared property. */
export function updateSharedCanvasProperties(
  components:readonly PageComponentMetadata[],primaryId:string,members:readonly PageComponentMetadata[],
  definitions:readonly BuilderRibbonProperty[],tab:BuilderTab,next:Values,
  editedKeys:readonly string[]=[]
):PageComponentMetadata[]{
  const primary=members.find(item=>item.id===primaryId);
  if(!primary||members.length<2)return [...components];
  // Explicit user actions must reach every selected component even if the
  // primary already has that value (e.g. mixed borders, colours or typography).
  // Do not propagate *other* mixed properties included in the full form snapshot.
  const edited=new Set(editedKeys);
  const changed=definitions.filter(p=>p.tab===tab&&isSharedCanvasProperty(p,members,definitions)&&
    choiceAllows(p,members,next[keyOf(p,primary)]) &&
    (edited.has(keyOf(p,primary))||
      !Object.is(next[keyOf(p,primary)],primary.properties[keyOf(p,primary)])));
  if(!changed.length)return [...components];
  const selectedIds=new Set(members.map(item=>item.id));
  return components.map(item=>{
    if(!selectedIds.has(item.id))return item;
    const properties={...item.properties};
    for(const property of changed){
      properties[keyOf(property,item)]=next[keyOf(property,primary)];
      // Media source mode is part of the same image-source user action.
      if(property.id==='imageSource'&&next.imageSourceMode!==undefined)
        properties.imageSourceMode=next.imageSourceMode;
    }
    return {...item,properties};
  });
}

export function updateSharedCanvasPositions(
  components:readonly PageComponentMetadata[],primaryId:string,members:readonly PageComponentMetadata[],
  definitions:readonly BuilderRibbonProperty[],next:Position,
  editedFields:readonly (keyof Position)[]=[]
):PageComponentMetadata[]{
  const primary=members.find(item=>item.id===primaryId);
  if(!primary?.position||members.length<2)return [...components];
  const edited=new Set(editedFields);
  const fields=(['x','y','width','height'] as const).filter(field=>
    (edited.has(field)||next[field]!==primary.position![field]) &&
    definitions.some(p=>(p.tab==='Layout'||p.tab==='Design2')&&p.id===field&&isSharedCanvasProperty(p,members,definitions)));
  if(!fields.length)return [...components];
  const ids=new Set(members.map(item=>item.id));
  return components.map(item=>{
    if(!ids.has(item.id)||!item.position)return item;
    const position={...item.position};
    for(const field of fields)position[field]=next[field];
    return {...item,position};
  });
}

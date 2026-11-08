/** Phase 3a: common accessible primitive metadata for all registered surfaces.
 * Describes existing React-hosted UI; never creates a second renderer.
 */
export type PrimitiveKind='text'|'button'|'input'|'image'|'icon'|'divider';
export type PrimitiveMetadata={
  kind:PrimitiveKind;
  label?:string;
  accessibleName?:string;
  description?:string;
  decorative?:boolean;
  disabled?:boolean;
  required?:boolean;
  actionEvent?:string;
};
export type PrimitiveValidation={valid:boolean;errors:string[]};
export const sharedPrimitiveKinds:ReadonlyArray<PrimitiveKind>=Object.freeze([
  'text','button','input','image','icon','divider'
]);
const eventPattern=/^[A-Za-z][A-Za-z0-9_]*$/;
/** Validate accessibility independently of presentation properties and RBAC. */
export function validatePrimitiveMetadata(raw:unknown):PrimitiveValidation{
  const errors:string[]=[];
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    return {valid:false,errors:['Primitive metadata must be an object.']};
  const value=raw as PrimitiveMetadata;
  if(!sharedPrimitiveKinds.includes(value.kind))errors.push('Unknown primitive kind.');
  for(const key of ['label','accessibleName','description'] as const)
    if(value[key]!==undefined && typeof value[key]!=='string')errors.push('Invalid '+key+'.');
  for(const key of ['decorative','disabled','required'] as const)
    if(value[key]!==undefined && typeof value[key]!=='boolean')errors.push('Invalid '+key+'.');
  const name=(value.accessibleName||value.label||'').trim();
  if(['button','input'].includes(value.kind)&&!name)
    errors.push('Interactive primitive requires an accessible name.');
  if(['image','icon'].includes(value.kind)&&value.decorative!==true&&!name)
    errors.push('Non-decorative media requires alternative text.');
  if(value.kind==='divider'&&value.actionEvent!==undefined)
    errors.push('Divider does not support actions.');
  if(value.actionEvent!==undefined&&
    (value.kind!=='button'||typeof value.actionEvent!=='string'||!eventPattern.test(value.actionEvent)))
    errors.push('Actions require a valid button event.');
  if(value.decorative&&value.actionEvent)errors.push('Decorative elements cannot emit actions.');
  return {valid:errors.length===0,errors};
}
export function primitiveAccessibilityProps(value:PrimitiveMetadata):Record<string,string|boolean>{
  const check=validatePrimitiveMetadata(value);
  if(!check.valid)throw Error(check.errors.join('; '));
  const name=(value.accessibleName||value.label||'').trim();
  return {
    ...(name?{'aria-label':name}:{}),
    ...(value.description?{'aria-description':value.description}:{}),
    ...(['image','icon'].includes(value.kind)&&value.decorative?{'aria-hidden':true}:{}),
    ...(value.disabled?{'aria-disabled':true}:{}),
    ...(value.required&&value.kind==='input'?{'aria-required':true}:{})
  };
}

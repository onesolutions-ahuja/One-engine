export type FieldAccess={read:boolean;edit:boolean;create?:boolean;delete?:boolean};
export type FieldAccessLevel='Hidden'|'ReadOnly'|'Edit';
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
/** Generate a patch for the existing OneEngine Field permission matrix. No new permission engine. */
export function applyFieldSecurity(
 current:Record<string,FieldAccess>,objectApi:string,fields:readonly string[],
 level:FieldAccessLevel
):Record<string,FieldAccess>{
 if(!identifier.test(objectApi)||!['Hidden','ReadOnly','Edit'].includes(level))
  throw new Error('Invalid field-security selection');
 const next={...current};
 for(const name of new Set(fields)){
  if(!identifier.test(name))throw new Error('Invalid field API name');
  const key=objectApi+'.'+name;
  const previous=current[key]??{read:false,edit:false};
  next[key]=level==='Hidden'?{...previous,read:false,edit:false,create:false,delete:false}
   :level==='ReadOnly'?{...previous,read:true,edit:false,create:false,delete:false}
   :{...previous,read:true,edit:true,create:true};
 }
 return next;
}

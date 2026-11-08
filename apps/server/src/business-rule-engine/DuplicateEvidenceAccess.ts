/** Readback of matching evidence is not permission to see the matched fields.
 * Shared by duplicate routes, independent of the metadata Builder and of apps.
 */
export type DuplicateEvidence={ruleApi:string;recordId:string;matchedObjectApi:string};
export type DuplicateMatchField={ruleApi:string;fieldApi:string;targetFieldApi:string|null};

export async function filterReadableDuplicateEvidence<T extends DuplicateEvidence>(
 candidates:readonly T[],fields:readonly DuplicateMatchField[],sourceObjectApi:string,
 requireRead:(resource:string)=>Promise<void>):Promise<T[]>{
 const byRule=new Map<string,DuplicateMatchField[]>();
 for(const field of fields){
  const list=byRule.get(field.ruleApi)??[];
  list.push(field);
  byRule.set(field.ruleApi,list);
 }
 const grants=new Map<string,boolean>();
 const allowed=async(resource:string):Promise<boolean>=>{
  if(grants.has(resource))return grants.get(resource)!;
  try{await requireRead(resource);grants.set(resource,true);return true;}
  catch{grants.set(resource,false);return false;}
 };
 const readable:T[]=[];
 for(const candidate of candidates){
  const ruleFields=byRule.get(candidate.ruleApi);
  if(!ruleFields?.length)continue; // Removed/incomplete rule is never disclosed.
  const targetObject=candidate.matchedObjectApi;
  if(!await allowed(targetObject))continue;
  let permitted=true;
  for(const field of ruleFields){
   const targetField=targetObject===sourceObjectApi?field.fieldApi:
    field.targetFieldApi??field.fieldApi;
   if(!await allowed(sourceObjectApi+'.'+field.fieldApi)
      ||!await allowed(targetObject+'.'+targetField)){
    permitted=false;break;
   }
  }
  if(permitted)readable.push(candidate);
 }
 return readable;
}

import type {LightningAppMetadata,LightningPageMetadata} from '../../metadata/Definitions/metadata';

/** App ownership comes only from installed tenant app navigation and page activation metadata. */
export function pageAppMembership(
 apps:ReadonlyArray<Pick<LightningAppMetadata,'apiName'|'navigationPageApiNames'|'navigationOrder'>>,
 pages:ReadonlyArray<Pick<LightningPageMetadata,'apiName'|'activationAssignments'|'ownerNamespace'>>
):Map<string,Set<string>>{
 const result=new Map(apps.map(app=>[app.apiName,new Set<string>()]));
 for(const app of apps){
  const members=result.get(app.apiName)!;
  for(const name of app.navigationPageApiNames??[])members.add(name);
  for(const item of app.navigationOrder??[])if(item.type==='App Page')members.add(item.apiName);
 }
 for(const page of pages){
  if(page.ownerNamespace&&result.has(page.ownerNamespace))
   result.get(page.ownerNamespace)!.add(page.apiName);
  for(const assignment of page.activationAssignments??[])
   if(assignment.appId&&result.has(assignment.appId))result.get(assignment.appId)!.add(page.apiName);
 }
 return result;
}
export const pageIsUnassigned=(apiName:string,membership:Map<string,Set<string>>)=>
 ![...membership.values()].some(members=>members.has(apiName));

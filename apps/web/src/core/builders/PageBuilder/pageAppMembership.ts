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

/** Every installed app that already owns, assigns or navigates to this page. */
export const pageActivationAppCandidates=(
 apps:ReadonlyArray<Pick<LightningAppMetadata,'apiName'|'navigationPageApiNames'|'navigationOrder'>>,
 page:Pick<LightningPageMetadata,'apiName'|'activationAssignments'|'ownerNamespace'>
):string[]=>{
 const membership=pageAppMembership(apps,[page]);
 return apps.filter(app=>membership.get(app.apiName)?.has(page.apiName)).map(app=>app.apiName);
};

/** Never borrow the open editor's app for a different list row.
 * A filter selects an associated app; an explicit editor selection may assign a new app.
 * Ambiguous/unassigned pages require an explicit choice rather than guessing. */
export const resolvePageActivationApp=(
 apps:ReadonlyArray<Pick<LightningAppMetadata,'apiName'|'navigationPageApiNames'|'navigationOrder'>>,
 page:Pick<LightningPageMetadata,'apiName'|'activationAssignments'|'ownerNamespace'>,
 preferredAppApiName='',
 allowExplicitAssignment=false
):string|null=>{
 const candidates=pageActivationAppCandidates(apps,page);
 const assigned=[...new Set((page.activationAssignments??[])
  .filter(a=>a.scope==='App Default'&&a.appId&&candidates.includes(a.appId))
  .map(a=>a.appId as string))];
 // Persisted App Default assignment is authoritative: never switch app by accident.
 if(assigned.length===1)return assigned[0];
 if(assigned.length>1)return preferredAppApiName&&assigned.includes(preferredAppApiName)
   ?preferredAppApiName:null;
 if(preferredAppApiName&&apps.some(app=>app.apiName===preferredAppApiName)
   &&(allowExplicitAssignment||candidates.includes(preferredAppApiName)))return preferredAppApiName;
 if(page.ownerNamespace&&candidates.includes(page.ownerNamespace))return page.ownerNamespace;
 return candidates.length===1?candidates[0]:null;
};

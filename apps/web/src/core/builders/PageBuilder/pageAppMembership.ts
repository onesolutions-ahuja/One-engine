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

/** Apps of every page, where a popup (opened with SCREEN(page, ...)) also belongs to every
 * app whose pages open it, through popups that open popups. */
export function pageAppsWithPopups(
 apps:ReadonlyArray<Pick<LightningAppMetadata,'apiName'|'navigationPageApiNames'|'navigationOrder'>>,
 pages:ReadonlyArray<Pick<LightningPageMetadata,'apiName'|'activationAssignments'|'ownerNamespace'>&{components?:unknown;opensPages?:unknown}>
):Map<string,string[]>{
 const result=new Map(pages.map(page=>[page.apiName,new Set(pageActivationAppCandidates(apps,page))]));
 const opens=new Map(pages.map(page=>{
  let text='';try{text=JSON.stringify(page.components??[]);}catch{/* not serialisable */}
  const found=new Set<string>();
  for(const match of text.matchAll(/SCREEN\(\s*([A-Za-z][A-Za-z0-9_]*)/gi))found.add(match[1].toLowerCase());
  // The server lists the pages opened from every layout (a page built only in Custom too).
  if(Array.isArray(page.opensPages))for(const name of page.opensPages)
   if(typeof name==='string'&&name)found.add(name.toLowerCase());
  return [page.apiName,found];
 }));
 const byLower=new Map(pages.map(page=>[page.apiName.toLowerCase(),page.apiName]));
 for(let pass=0,changed=true;changed&&pass<5;pass++){
  changed=false;
  for(const [opener,targets] of opens){
   const openerApps=result.get(opener);
   if(!openerApps?.size)continue;
   for(const lower of targets){
    const target=byLower.get(lower);
    const targetApps=target?result.get(target):undefined;
    if(!targetApps||target===opener)continue;
    for(const app of openerApps)if(!targetApps.has(app)){targetApps.add(app);changed=true;}
   }
  }
 }
 return new Map([...result].map(([name,set])=>[name,[...set]]));
}

import type {LightningAppMetadata,LightningPageMetadata,PageComponentMetadata} from '../../../../metadata/Definitions/metadata';
import {pageAppsWithPopups} from '../../pageAppMembership';
import {brokenPageLinks} from '../../pageLinkCheck';

/**
 * App versions from Page Builder: Save records a version of the whole app (server keeps the
 * last 10), Publish makes one version live. A version with broken links (a component opening a
 * page that no longer exists, on ANY page of the app) is saved but cannot be published.
 */
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type AppVersion={version:number;published:boolean;errorCount:number;errors:string[];pages:number;
 createdAt:string;createdBy:string;modifiedAt:string;modifiedBy:string};
export type AppLinkError={page:string;component:string;message:string};

/** The app's pages: its navigation and assigned pages, and the popups they open. */
export function appPageNames(appId:string,apps:readonly LightningAppMetadata[],pages:readonly LightningPageMetadata[],
 extra:readonly string[]=[]):string[]{
 const owners=pageAppsWithPopups(apps,pages);
 const names=new Set(extra);
 for(const page of pages)if(owners.get(page.apiName)?.includes(appId))names.add(page.apiName);
 return [...names];
}

/** Broken links on every page of the app. Pages being edited are checked as they are now; the
 * others as saved (Desktop holds a page's actions and formulas for every layout). */
export async function appBrokenLinks(request:Request,names:readonly string[],pages:readonly LightningPageMetadata[],
 edited:ReadonlyMap<string,readonly PageComponentMetadata[]>):Promise<AppLinkError[]>{
 const label=(name:string)=>pages.find(page=>page.apiName===name)?.label||name;
 const errors:AppLinkError[]=[];
 const queue=[...names];
 const worker=async()=>{
  for(let name=queue.shift();name!==undefined;name=queue.shift()){
   let components=edited.get(name);
   if(!components){
    const result=await request<{page:LightningPageMetadata}>(
     '/metadata/pages/'+encodeURIComponent(name)+'/layouts/Desktop/editor').catch(()=>null);
    components=result?.page.components??[];
   }
   for(const link of brokenPageLinks(components,pages))
    errors.push({page:label(name),component:link.component,message:link.message});
  }
 };
 await Promise.all(Array.from({length:Math.min(6,queue.length)},worker));
 return errors.sort((a,b)=>a.page.localeCompare(b.page)||a.component.localeCompare(b.component));
}

export const describeLinkErrors=(errors:readonly AppLinkError[],max=3)=>errors.slice(0,max)
 .map(error=>error.page+' › '+error.component+': '+error.message).join('; ')+(errors.length>max?' …':'');

export async function recordAppVersion(request:Request,appId:string,names:readonly string[],errors:readonly AppLinkError[]){
 return request<{version:number;versions:AppVersion[]}>('/metadata/apps/'+encodeURIComponent(appId)+'/versions',
  {method:'POST',body:JSON.stringify({pages:names,errors})});
}
export async function listAppVersions(request:Request,appId:string){
 return (await request<{versions:AppVersion[]}>('/metadata/apps/'+encodeURIComponent(appId)+'/versions')).versions;
}
export async function publishAppVersion(request:Request,appId:string,version:number){
 return (await request<{versions:AppVersion[]}>('/metadata/apps/'+encodeURIComponent(appId)+'/versions/'+version+'/publish',
  {method:'POST',body:'{}'})).versions;
}

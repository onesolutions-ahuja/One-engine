import type {RbacEngine} from '../system-files/rbac-engine.js';
/** Navigation grants are independent of Object CRUD and installation/licence checks.
 *  All app and tab checks go to the RBAC engine in one batch (it was one per app). */
export async function permittedApps<T extends {apiName:string;navigationItems:string[];navigationOrder:{type:string;apiName:string}[]}>(rbac:RbacEngine,t:string,u:string,apps:T[]){
 const checks=apps.flatMap(a=>[{resource:'App:'+a.apiName,action:'read'},
  ...a.navigationItems.map(name=>({resource:'Tab:'+name,action:'read'}))]);
 const rights=await rbac.allowedMany(t,u,checks);
 const visible:T[]=[];let cursor=0;
 for(const app of apps){
  const appAllowed=rights[cursor++];
  const allowed=new Set(app.navigationItems.filter((_,i)=>rights[cursor+i]));
  cursor+=app.navigationItems.length;
  if(!appAllowed)continue;
  visible.push({...app,navigationItems:app.navigationItems.filter(n=>allowed.has(n)),
   navigationOrder:app.navigationOrder.filter(n=>n.type!=='Object'||allowed.has(n.apiName))});
 }
 return visible;
}

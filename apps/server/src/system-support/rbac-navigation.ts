import type {RbacEngine} from '../system-files/rbac-engine.js';
/** Navigation grants are independent of Object CRUD and installation/licence checks. */
export async function permittedApps<T extends {apiName:string;navigationItems:string[];navigationOrder:{type:string;apiName:string}[]}>(rbac:RbacEngine,t:string,u:string,apps:T[]){
 const access=await rbac.allowedMany(t,u,apps.map(a=>({resource:'App:'+a.apiName,action:'read'})));
 const visible:T[]=[];
 for(const [index,app] of apps.entries()){
  if(!access[index])continue;
  const tabs=await rbac.allowedMany(t,u,app.navigationItems.map(name=>({resource:'Tab:'+name,action:'read'})));
  const allowed=new Set(app.navigationItems.filter((_,i)=>tabs[i]));
  visible.push({...app,navigationItems:app.navigationItems.filter(n=>allowed.has(n)),
   navigationOrder:app.navigationOrder.filter(n=>n.type!=='Object'||allowed.has(n.apiName))});
 }
 return visible;
}

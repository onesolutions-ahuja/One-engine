import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadTenantApps} from './TenantAppLoader.js';
import {loadAppNavigation} from './AppNavigationRegistry.js';
/** Resolve only tenant-installed, entitled app metadata; no global app cache. */
export async function resolveTenantAppMetadata(db:SqlPersistence,tenantId:string){
 const rows=await loadTenantApps(db,tenantId);
 if(!rows.length)return [];
 const {navigation,utilities}=await loadAppNavigation(db,tenantId,rows.map(row=>row.id));
 return rows.map(row=>{
  const entries=navigation.filter(item=>item.app_id===row.id).map(item=>({type:item.entry_type,apiName:item.api_name}));
  return {apiName:row.api_name,label:row.label,description:row.description??'',
   navigationItems:entries.filter(item=>item.type==='Object').map(item=>item.apiName),
   navigationPageApiNames:entries.filter(item=>item.type==='App Page').map(item=>item.apiName),
   navigationOrder:entries,brandColor:row.brand_color??'#1d4ed8',
   utilityItems:utilities.filter(item=>item.app_id===row.id).map(item=>item.utility_name),
   ...(row.revision===null?{}:{revision:row.revision})};
 });
}

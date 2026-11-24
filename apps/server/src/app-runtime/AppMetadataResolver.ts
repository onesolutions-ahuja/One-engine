import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadTenantApps} from './TenantAppLoader.js';
import {loadAppNavigation} from './AppNavigationRegistry.js';
/** Resolve only tenant-installed, entitled app metadata; no global app cache. */
export async function resolveTenantAppMetadata(db:SqlPersistence,tenantId:string){
 const rows=await loadTenantApps(db,tenantId);
 if(!rows.length)return [];
 const ids=rows.map(row=>row.id);
 const [{navigation,utilities},homes]=await Promise.all([loadAppNavigation(db,tenantId,ids),
  // The app's chosen Home Page (desktop row; saving writes the same page for every device).
  db.query<{app_id:string;api_name:string}>(`SELECT h.app_id,p.api_name FROM md_app_home_pages h
   JOIN md_page_definitions p ON p.tenant_id=h.tenant_id AND p.id=h.page_id
   WHERE h.tenant_id=$1 AND h.app_id=ANY($2::uuid[]) AND h.form_factor='desktop'`,[tenantId,ids])]);
 return rows.map(row=>{
  const entries=navigation.filter(item=>item.app_id===row.id).map(item=>({type:item.entry_type,apiName:item.api_name}));
  return {apiName:row.api_name,label:row.label,description:row.description??'',
   navigationItems:entries.filter(item=>item.type==='Object').map(item=>item.apiName),
   navigationPageApiNames:entries.filter(item=>item.type==='App Page').map(item=>item.apiName),
   navigationOrder:entries,brandColor:row.brand_color??'#1d4ed8',
   homePageApiName:homes.rows.find(item=>item.app_id===row.id)?.api_name??'',
   // Lock screen: the app locks itself after idle minutes (0 = only LOCKSCREEN() / Lock button).
   lockScreen:{enabled:row.lock_enabled===true,idleMinutes:row.lock_idle_minutes??5},
   utilityItems:utilities.filter(item=>item.app_id===row.id).map(item=>item.utility_name),
   ...(row.revision===null?{}:{revision:row.revision})};
 });
}

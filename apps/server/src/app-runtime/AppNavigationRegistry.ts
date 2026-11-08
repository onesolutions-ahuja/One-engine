import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** App navigation is always scoped to installed tenant app IDs. */
export async function loadAppNavigation(db:SqlPersistence,tenantId:string,appIds:readonly string[]){
 if(!appIds.length)return {navigation:[],utilities:[]};
 const [navigation,utilities]=await Promise.all([
  db.query<{app_id:string;entry_type:'Object'|'App Page';api_name:string;sort_order:number}>(`
   SELECT app_id,entry_type,api_name,sort_order FROM md_tenant_app_navigation
   WHERE tenant_id=$1 AND app_id=ANY($2::uuid[]) ORDER BY sort_order`,[tenantId,appIds]),
  db.query<{app_id:string;utility_name:'Notes'|'History'}>(`
   SELECT app_id,utility_name FROM md_tenant_app_utilities
   WHERE tenant_id=$1 AND app_id=ANY($2::uuid[]) ORDER BY sort_order`,[tenantId,appIds])
 ]);
 return {navigation:navigation.rows,utilities:utilities.rows};
}

/** Validate and order authored navigation before tenant SQL writes. */
export function validateAppNavigation(p:Record<string,unknown>){
    const objects=p.navigationItems as unknown[],pages=p.navigationPageApiNames as unknown[];
    if([...objects,...pages].some(name=>typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)))
      throw new Error('Invalid App navigation');
    if(new Set(objects).size!==objects.length||new Set(pages).size!==pages.length)
      throw new Error('Duplicate App navigation');
    const allowed=new Set<string>([
      ...objects.map(name=>'Object:'+name),
      ...pages.map(name=>'App Page:'+name)
    ]);
    const order:Array<{type:'Object'|'App Page';apiName:string}>=[];
    const chosen=new Set<string>();
    for(const rawEntry of p.navigationOrder as unknown[]){
      if(!rawEntry||typeof rawEntry!=='object'||Array.isArray(rawEntry))
        throw new Error('Invalid App navigation');
      const item=rawEntry as Record<string,unknown>;
      const key=item.type+':'+item.apiName;
      if(!allowed.has(key)||chosen.has(key))throw new Error('Invalid App navigation order');
      chosen.add(key);
      order.push({type:item.type as 'Object'|'App Page',apiName:item.apiName as string});
    }
    for(const key of allowed)if(!chosen.has(key)){
      const type=key.startsWith('Object:')?'Object':'App Page';
      order.push({type,apiName:key.slice(type.length+1)});
    }
    const utilityItems=p.utilityItems as unknown[];
    if(utilityItems.some(item=>item!=='Notes'&&item!=='History')||
      new Set(utilityItems).size!==utilityItems.length)
      throw new Error('Invalid App utilities');

    return {objects,pages,order,utilityItems};
}

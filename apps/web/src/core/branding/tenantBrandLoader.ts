import {apiRequest,getAccessToken} from '../authentication/Client/authClient';
import {setTenantBrand,clearTenantBrand} from '../../component-libraries/shared/TenantBrand.js';

/** Keep successful tenant branding cached; retry temporary failures and allow
 * Company Settings to refresh the image without a page reload. A stale request
 * from an earlier sign-in must never replace the current tenant's brand. */
let loadedFor:string|undefined;
let pending:Promise<void>|null=null;
let loaded=false;
let generation=0;

function loadTenantBrand(force:boolean):Promise<void>{
  const token=getAccessToken()??'';
  if(loadedFor!==token){
    loadedFor=token;
    loaded=false;
    generation++;
    pending=null;
    clearTenantBrand();
  }
  if(!force&&loaded)return Promise.resolve();
  if(!force&&pending)return pending;
  const requestGeneration=++generation;
  const work=(async()=>{
    for(let attempt=0;attempt<3;attempt++){
      try{
        const brand=await apiRequest<{name?:unknown;logo?:unknown}>('/tenant/brand');
        if(requestGeneration===generation&&loadedFor===token&&(getAccessToken()??'')===token){
          setTenantBrand(brand);
          loaded=true;
        }
        return;
      }catch{
        if(requestGeneration!==generation||loadedFor!==token||(getAccessToken()??'')!==token)return;
        if(attempt===2){
          loaded=false;
          return;
        }
        await new Promise<void>(resolve=>setTimeout(resolve,150*(attempt+1)));
      }
    }
  })();
  pending=work;
  void work.finally(()=>{if(pending===work)pending=null;});
  return work;
}

export const ensureTenantBrand=():Promise<void>=>loadTenantBrand(false);
export const refreshTenantBrand=():Promise<void>=>loadTenantBrand(true);

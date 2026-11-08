/** The signed-in tenant's public brand for page formulas: $session.tenant.name and $session.tenant.logo.
 * Smart components run from separately compiled bundles, each with its own copy of
 * this module, so the value lives on ONE well-known global key that every copy shares.
 * It holds only the trading name and logo, never other company data. */
const KEY=Symbol.for("une.tenantBrand");
const empty=Object.freeze({name:"",logo:""});
const store=()=>{
 const root=globalThis;
 if(!root[KEY])Object.defineProperty(root,KEY,{value:{brand:empty,listeners:new Set()},configurable:false,enumerable:false,writable:false});
 return root[KEY];
};
const logoPattern=/^(?:https:\/\/\S+|asset:[0-9a-f-]{36}|data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2})$/i;
/** Only an https URL, a tenant media asset or an inline raster image is usable as a logo. */
export const safeTenantLogo=value=>typeof value==="string"&&logoPattern.test(value.trim())?value.trim():"";
export function setTenantBrand(next){
 const state=store();
 const name=typeof next?.name==="string"?next.name.trim().slice(0,200):"";
 const logo=safeTenantLogo(next?.logo);
 if(name===state.brand.name&&logo===state.brand.logo)return;
 state.brand=Object.freeze({name,logo});
 for(const listener of [...state.listeners])listener();
}
export const clearTenantBrand=()=>setTenantBrand(empty);
export const getTenantBrand=()=>store().brand;
export function subscribeTenantBrand(listener){
 const state=store();
 state.listeners.add(listener);
 return ()=>{state.listeners.delete(listener);};
}
/** Formula references this store answers. */
export const TENANT_FORMULA_REFERENCES=Object.freeze(["$session.tenant.name","$session.tenant.logo"]);

/** The signed-in tenant's public brand for page formulas: @ThisTenant.Company.Name and @ThisTenant.Company.Logo.
 * Smart components run from separately compiled bundles, each with its own copy of
 * this module, so the value lives on ONE well-known global key that every copy shares.
 * It holds the trading name, logo and the Company Settings values page formulas read. */
const KEY=Symbol.for("une.tenantBrand");
const empty=Object.freeze({name:"",logo:"",company:Object.freeze({})});
const store=()=>{
 const root=globalThis;
 if(!root[KEY])Object.defineProperty(root,KEY,{value:{brand:empty,listeners:new Set()},configurable:false,enumerable:false,writable:false});
 return root[KEY];
};
const logoPattern=/^(?:https:\/\/\S+|asset:[0-9a-f-]{36}|data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2})$/i;
/** Only an https URL, a tenant media asset or an inline raster image is usable as a logo. */
export const safeTenantLogo=value=>typeof value==="string"&&logoPattern.test(value.trim())?value.trim():"";
/** Company Settings values (@ThisTenant.Company.<Field>): text, numbers and Yes/No only. */
const companyValues=value=>{
 const out=Object.create(null);
 if(value&&typeof value==="object"&&!Array.isArray(value))for(const [key,item] of Object.entries(value)){
  if(!/^[a-z][a-z0-9_]{0,79}$/.test(key))continue;
  if(typeof item==="string")out[key]=item.slice(0,2048);
  else if(typeof item==="boolean"||typeof item==="number"&&Number.isFinite(item))out[key]=item;
 }
 return Object.freeze(out);
};
export function setTenantBrand(next){
 const state=store();
 const name=typeof next?.name==="string"?next.name.trim().slice(0,200):"";
 const logo=safeTenantLogo(next?.logo);
 const company=companyValues(next?.company);
 if(name===state.brand.name&&logo===state.brand.logo&&JSON.stringify(company)===JSON.stringify(state.brand.company))return;
 state.brand=Object.freeze({name,logo,company});
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
export const TENANT_FORMULA_REFERENCES=Object.freeze(["@ThisTenant.Company.Name","@ThisTenant.Company.Logo"]);
/** @ThisTenant.Company.<Field>: name and logo, else any Company Settings value ('' when not set). */
export function tenantCompanyValue(field){
 const brand=getTenantBrand(),key=String(field??"").toLowerCase();
 if(key==="name")return brand.name;
 if(key==="logo")return brand.logo;
 if(!(key in (brand.company??{})))throw Error('Unknown tenant value @ThisTenant.Company.'+field);
 const value=brand.company?.[key];
 return value===undefined||value===null?"":value;
}

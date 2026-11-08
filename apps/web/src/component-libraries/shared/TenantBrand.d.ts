export type TenantBrand={readonly name:string;readonly logo:string};
export declare const safeTenantLogo:(value:unknown)=>string;
export declare function setTenantBrand(next:{name?:unknown;logo?:unknown}|null|undefined):void;
export declare const clearTenantBrand:()=>void;
export declare const getTenantBrand:()=>TenantBrand;
export declare function subscribeTenantBrand(listener:()=>void):()=>void;
export declare const TENANT_FORMULA_REFERENCES:readonly string[];

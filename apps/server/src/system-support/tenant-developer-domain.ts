/** A tenant login host is platform-owned; do not use user-supplied website URLs. */
export function tenantDeveloperDomain(slug:string,baseDomain:string|undefined=process.env.METADRIVE_TENANT_BASE_DOMAIN):string {
 const tenant=slug.toLowerCase();
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)||tenant.length>54)
   throw new Error('Invalid tenant identifier');
 const base=baseDomain?.trim().toLowerCase();
 if(!base||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(base))
   throw new Error('Tenant login base domain is not configured');
 return tenant+'.'+base;
}

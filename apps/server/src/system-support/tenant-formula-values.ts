/** Values page formulas read with @ThisTenant.Company.<Field>: every Company Settings value
 * (receipts, VAT number, address …) plus the corporate Currency and VatRate. Keys are lower case
 * (@ThisTenant.Company.VatNumber -> vatnumber). The same map goes to the browser (/api/tenant/brand)
 * and to server page actions, so a formula gives the same answer in both. */
import type {SqlPersistence} from '../system-files/sql-persistence.js';
type Query=Pick<SqlPersistence,'query'>;
const plain=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
 ?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value.trim():'';

export async function loadCompanyValues(db:Query,tenantId:string):Promise<Record<string,string|number|boolean>>{
 const [settings,tenant]=await Promise.all([
  db.query<{setting_key:string;properties:unknown}>(
   "SELECT setting_key,properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key IN('company-profile','currencies')",[tenantId]),
  db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[tenantId])
 ]);
 const profile=plain(settings.rows.find(row=>row.setting_key==='company-profile')?.properties);
 const money=plain(settings.rows.find(row=>row.setting_key==='currencies')?.properties);
 const values:Record<string,string|number|boolean>=Object.create(null);
 for(const [key,value] of Object.entries(profile))
  if(key!=='logoUrl'&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)){
   if(typeof value==='string')values[key.toLowerCase()]=value.trim();
   // Yes/No and number settings (Receipts) keep their type: IF(@ThisTenant.Company.ReceiptAutoPrint, …).
   else if(typeof value==='number'&&Number.isFinite(value))values[key.toLowerCase()]=value;
   else if(typeof value==='boolean')values[key.toLowerCase()]=value;
  }
 values.name=text(profile.tradingName)||text(profile.legalName)||text(tenant.rows[0]?.name);
 values.logo=text(profile.logoUrl);
 values.currency=typeof money.corporateCurrency==='string'&&/^[A-Z]{3}$/.test(money.corporateCurrency)?money.corporateCurrency:'GBP';
 values.vatrate=typeof money.standardVatRate==='number'&&Number.isFinite(money.standardVatRate)?money.standardVatRate:'';
 return values;
}

/** Names in `$.permission("Name")` calls of generated page code. */
export function permissionNames(source:string):string[]{
 return [...new Set([...source.matchAll(/\$\.permission\(\s*"([A-Za-z_][A-Za-z0-9_.]{0,79})"\s*\)/g)].map(match=>match[1]))].slice(0,50);
}
/** Custom field values of a user (md_users.custom_fields), only fields still defined on User. */
export async function loadUserCustomFields(db:Query,tenantId:string,userId:string):Promise<Record<string,unknown>>{
 const {rows}=await db.query<{api_name:string;value:unknown}>(`
  SELECT f.api_name,u.custom_fields->f.api_name AS value
  FROM md_users u JOIN md_field_definitions f ON f.tenant_id=u.tenant_id AND f.object_api='User' AND f.deleted_at IS NULL
  WHERE u.tenant_id=$1 AND u.id=$2 AND u.custom_fields ? f.api_name`,[tenantId,userId]);
 const out:Record<string,unknown>=Object.create(null);
 for(const row of rows)if(row.value===null||['string','number','boolean'].includes(typeof row.value))out[row.api_name]=row.value;
 return out;
}

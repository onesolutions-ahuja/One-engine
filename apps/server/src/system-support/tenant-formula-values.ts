import {receiptSettings} from '../expression-engine/ReceiptSettings.js';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadNativeFields,nativeTableSql,nativeValueSql} from '../system-files/native-object-query.js';
type Query=Pick<SqlPersistence,'query'>;
const plain=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
 ?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value.trim():'';

/** Values page formulas read with @ThisTenant.Company.<Field>: every field of the tenant's ONE
 * Company record (Object Manager fields included), plus Logo (Company Settings → Branding),
 * Currency and VatRate (Currency & Locale). Keys are lower case (@ThisTenant.Company.VatNumber ->
 * vatnumber). The same map goes to the browser (/api/tenant/brand) and to server page actions,
 * so a formula gives the same answer in both. Every signed-in user of the tenant can read them. */
export async function loadCompanyValues(db:Query,tenantId:string):Promise<Record<string,string|number|boolean>>{
 const [settings,tenant,company]=await Promise.all([
  db.query<{setting_key:string;properties:unknown}>(
   "SELECT setting_key,properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key IN('company-profile','currencies')",[tenantId]),
  db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[tenantId]),
  companyRecord(db,tenantId)
 ]);
 const profile=plain(settings.rows.find(row=>row.setting_key==='company-profile')?.properties);
 const money=plain(settings.rows.find(row=>row.setting_key==='currencies')?.properties);
 const values:Record<string,string|number|boolean>=Object.create(null);
 for(const [key,value] of Object.entries(company??{})){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key))continue;
  if(value==null){values[key.toLowerCase()]='';continue;}
  if(typeof value==='string')values[key.toLowerCase()]=value.trim();
  else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))values[key.toLowerCase()]=value;
 }
 values.id=tenantId;
 values.name=text(values.name)||text(values.legalname)||text(tenant.rows[0]?.name);

 values.logo=text(profile.logoUrl);

 // Each receipt setting answers to both names: the Company field (@ThisTenant.Company.ReceiptAutoPrint)
 // and its settings key (@ThisTenant.Company.AutoPrintReceipt), with the default when blank.
 for(const setting of receiptSettings){
  const value=(company?.[setting.field]??setting.initial??'') as string|number|boolean;
  values[setting.field.toLowerCase()]=value;
  values[setting.key.toLowerCase()]=value;
 }
 values.receiptdisplayname=values.receiptdisplayname||values.name;
 values.currency=typeof money.corporateCurrency==='string'&&/^[A-Z]{3}$/.test(money.corporateCurrency)?money.corporateCurrency:'GBP';
 values.vatrate=typeof money.standardVatRate==='number'&&Number.isFinite(money.standardVatRate)?money.standardVatRate:'';
 return values;
}

/** The tenant's Company record (field -> value, typed), or null before it exists. System read:
 * company details are shown to every user of the tenant (receipts, tills). */
export async function companyRecord(db:Query,tenantId:string):Promise<Record<string,unknown>&{Id:string}|null>{
 const ids=await db.query<{id:string}>(`SELECT id FROM md_records WHERE tenant_id=$1 AND object_api='Company'
  AND is_deleted=false ORDER BY created_at,id LIMIT 1`,[tenantId]);
 const id=ids.rows[0]?.id;
 if(!id)return null;
 const meta=await loadNativeFields(db as never,tenantId,'Company');
 const names=[...meta.fields.keys()].filter(name=>/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name));
 const out:Record<string,unknown>&{Id:string}={Id:id};
 if(!names.length)return out;
 const {rows}=await db.query<Record<string,unknown>>(`SELECT ${names.map((name,i)=>nativeValueSql(meta,name,'nr')+' AS "c'+i+'"').join(',')}
  FROM ${nativeTableSql(meta)} nr WHERE nr.tenant_id=$1 AND nr.id=$2`,[tenantId,id]);
 const row=rows[0]??{};
 names.forEach((name,i)=>{
  const type=meta.fields.get(name)?.dataType??'';
  let value=row['c'+i];
  if(value instanceof Date)value=value.toISOString();
  else if(['number','currency','percent'].includes(type)&&value!==null&&value!==undefined)value=Number(value);
  out[name]=value===undefined?null:value;
 });
 return out;
}

/** Names in `$.permission("Name")` calls of generated page code. */
export function permissionNames(source:string):string[]{
 return [...new Set([...source.matchAll(/\$\.permission\(\s*"([A-Za-z_][A-Za-z0-9_.]{0,79})"\s*\)/g)].map(match=>match[1]))].slice(0,50);
}
/** Custom field values of a user (md_users.custom_fields), only fields still defined on User. */
export async function loadUserCustomFields(db:Query,tenantId:string,userId:string):Promise<Record<string,unknown>>{
 const {rows}=await db.query<{api_name:string;value:unknown}>(`
  SELECT permitted.* FROM (SELECT f.api_name,u.custom_fields->f.api_name AS value
  FROM md_users u JOIN md_field_definitions f ON f.tenant_id=u.tenant_id AND f.object_api='User' AND f.deleted_at IS NULL
  WHERE u.tenant_id=$1 AND u.id=$2 AND f.api_name NOT IN ('Password','Username','Enabled','IsActive','Tenant','ReportsToId','LandingApp')
  UNION ALL
  SELECT field.key,field.value FROM md_users u CROSS JOIN LATERAL jsonb_each(jsonb_build_object(
   'Username',u.email,'Enabled',u.enabled,'IsActive',u.enabled,'Tenant',u.tenant_id,'ReportsToId',u.reports_to_user_id,
   'LandingApp',u.landing_app_api)) field WHERE u.tenant_id=$1 AND u.id=$2) permitted
  CROSS JOIN LATERAL md_rbac_decision($1,$2,'User.'||permitted.api_name,'read') rights
  WHERE rights.allow_granted AND NOT rights.deny_granted`,[tenantId,userId]);
 const out:Record<string,unknown>=Object.create(null);
 for(const row of rows)if(row.value===null||['string','number','boolean'].includes(typeof row.value))out[row.api_name]=row.value;
 return out;
}

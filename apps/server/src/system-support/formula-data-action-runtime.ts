import type {SqlPersistence} from '../system-files/sql-persistence.js';
/** Signed-in identity for server formulas (page code actions). The previous server action
 * interpreter is gone: actions run as page code. */
type Actor={tenant_id:string;user_id:string};
type Sql=Pick<SqlPersistence,'transaction'|'query'>;

export async function tenantServerFormulaEnabled(db:Pick<SqlPersistence,'query'>,tenant:string){
 const {rows}=await db.query<{enabled:boolean}>(`
  SELECT COALESCE(properties->>'formulaServerExecutionEnabled','true')='true' AS enabled
  FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='automation-settings'`,[tenant]);
 return rows[0]?.enabled!==false;
}

export type TrustedFormulaSession={
 user:{id:string;name:string;email:string;timeZone:string;locale:string;currencyIsoCode:string;managerId:string;managerName:string};
 tenant:{id:string;name:string;logo:string};
};
/** Server formulas derive identity from the authenticated actor, never browser scope. */
export async function trustedFormulaSession(db:Sql,actor:Actor):Promise<TrustedFormulaSession>{
 const [users,tenants,profiles]=await Promise.all([
  db.query<{email:string;display_name:string;time_zone:string;locale:string;currency_iso_code:string|null;
   manager_id:string|null;manager_name:string|null}>(
   'SELECT u.email,u.display_name,u.time_zone,u.locale,u.currency_iso_code,m.id AS manager_id,m.display_name AS manager_name'+
   ' FROM md_users u LEFT JOIN md_users m ON m.tenant_id=u.tenant_id AND m.id=u.reports_to_user_id AND m.enabled=true'+
   ' WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true',
   [actor.tenant_id,actor.user_id]),
  db.query<{name:string}>('SELECT name FROM md_tenants WHERE id=$1',[actor.tenant_id]),
  db.query<{properties:unknown}>("SELECT properties FROM md_tenant_settings WHERE tenant_id=$1 AND setting_key='company-profile'",[actor.tenant_id])
 ]);
 const user=users.rows[0];
 if(!user||!tenants.rows[0])throw Error('Authenticated formula identity is unavailable');
 const raw=profiles.rows[0]?.properties;
 const company=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const string=(value:unknown)=>typeof value==='string'?value.trim():'';
 return {user:{id:actor.user_id,email:user.email,name:user.display_name,
   timeZone:user.time_zone,locale:user.locale,currencyIsoCode:user.currency_iso_code??'',
   managerId:user.manager_id??'',managerName:user.manager_name??''},
  tenant:{id:actor.tenant_id,name:string(company.tradingName)||string(company.legalName)||tenants.rows[0].name,
   logo:string(company.logoUrl)}};
}

import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {loadCompanyValues,loadUserCustomFields} from './tenant-formula-values.js';
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
 user:{id:string;name:string;email:string;timeZone:string;locale:string;currencyIsoCode:string;managerId:string;managerName:string;
  /** Custom fields on the User object (@ThisTenant.User.RefundLimit), read from SQL, never the browser. */
  fields:Record<string,unknown>};
 tenant:{id:string;name:string;logo:string;
  /** Company Settings values, lower-case keys (@ThisTenant.Company.VatNumber -> vatnumber). */
  company:Record<string,string|number|boolean>};
};
/** Server formulas derive identity from the authenticated actor, never browser scope. */
export async function trustedFormulaSession(db:Sql,actor:Actor):Promise<TrustedFormulaSession>{
 const [users,company,fields]=await Promise.all([
  db.query<{email:string;display_name:string;time_zone:string;locale:string;currency_iso_code:string|null;
   manager_id:string|null;manager_name:string|null}>(
   'SELECT u.email,u.display_name,u.time_zone,u.locale,u.currency_iso_code,m.id AS manager_id,m.display_name AS manager_name'+
   ' FROM md_users u LEFT JOIN md_users m ON m.tenant_id=u.tenant_id AND m.id=u.reports_to_user_id AND m.enabled=true'+
   ' WHERE u.tenant_id=$1 AND u.id=$2 AND u.enabled=true',
   [actor.tenant_id,actor.user_id]),
  loadCompanyValues(db,actor.tenant_id),
  loadUserCustomFields(db,actor.tenant_id,actor.user_id)
 ]);
 const user=users.rows[0];
 if(!user)throw Error('Authenticated formula identity is unavailable');
 return {user:{id:actor.user_id,email:user.email,name:user.display_name,
   timeZone:user.time_zone,locale:user.locale,currencyIsoCode:user.currency_iso_code??'',
   managerId:user.manager_id??'',managerName:user.manager_name??'',fields},
  tenant:{id:actor.tenant_id,name:String(company.name??''),logo:String(company.logo??''),company}};
}

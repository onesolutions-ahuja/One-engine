import type {SqlExecutor} from '../system-files/sql-persistence.js';
import {connectorApps} from '../app-seeders/connector-apps.js';
import {SYSTEM_CONNECTOR_PREFIX,connectionKey,type ConnectionSnapshot} from '../expression-engine/FormulaConnections.js';

/** Key of every system connector the platform ships. A new connector added to
 * the connector app list is picked up here automatically. */
export const systemConnectorKeys=():string[]=>
 Object.values(connectorApps).map(code=>connectionKey(code)).filter(Boolean).sort();
/** Connector app API name for a key, e.g. "whatsapp" → "WhatsAppConnector". */
export function connectorAppForKey(key:string):string|undefined{
 return (Object.entries(connectorApps) as Array<[string,string]>)
  .find(([,code])=>connectionKey(code)===connectionKey(key))?.[0];
}

/** What CONNECTED() can see for one tenant. Names only, never secrets.
 * "Connected" means: enabled HTTPS credential that has keys (or needs none);
 * a system connector must also be installed, and is matched through its
 * connector app binding, so legacy credential names still count. */
export async function loadConnectionSnapshot(db:SqlExecutor,tenantId:string):Promise<ConnectionSnapshot>{
 const {rows}=await db.query<{name:string;connector_app:string|null}>(`
  SELECT c.name,a.api_name AS connector_app FROM md_named_credentials c
  LEFT JOIN md_connector_app_credentials b ON b.tenant_id=c.tenant_id AND b.credential_id=c.id
  LEFT JOIN md_apps a ON a.id=b.app_id AND a.app_type='ConnectorApp' AND a.tenant_owner_id IS NULL
  LEFT JOIN md_app_installations i ON i.tenant_id=c.tenant_id AND i.app_id=b.app_id
  WHERE c.tenant_id=$1 AND c.enabled=true AND c.protocol='HTTPS'
   AND (c.secret_ciphertext IS NOT NULL OR c.configuration_ciphertext IS NOT NULL OR c.auth_type='None')
   AND (b.app_id IS NULL OR i.app_id IS NOT NULL)`,[tenantId]);
 const systemConnected=new Set<string>(),customConnected=new Set<string>();
 for(const row of rows){
  const app=row.connector_app?connectorApps[row.connector_app as keyof typeof connectorApps]:undefined;
  if(app)systemConnected.add(connectionKey(app));
  else if(!row.name.toLowerCase().startsWith(SYSTEM_CONNECTOR_PREFIX)){
   const key=connectionKey(row.name);
   if(key)customConnected.add(key);
  }
 }
 return {systemAvailable:systemConnectorKeys(),systemConnected:[...systemConnected].sort(),
  customConnected:[...customConnected].sort()};
}

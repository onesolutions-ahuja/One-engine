import {existsSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';

export const connectorApps=Object.freeze({
 WhatsAppConnector:'whatsapp',SmsGateConnector:'sms-gate',BrevoConnector:'brevo',
 UberEatsConnector:'uber-eats',DeliverooConnector:'deliveroo',JustEatConnector:'just-eat'
} as const);
export type ConnectorAppName=keyof typeof connectorApps;
export const isConnectorApp=(name:string):name is ConnectorAppName=>
 Object.prototype.hasOwnProperty.call(connectorApps,name);
type Field={apiName:string;label:string;required:boolean;defaultValue:string};
type Operation={method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';path:string;
 communicationFields?:{recipient?:string;sender?:string;body?:string;responseId?:string}};
type Definition={folder:string;appApi:string;label:string;description:string;credential:string;url:string;
 auth:string;header:string;fields:Field[];operations:Record<string,Operation>;docs:string;notes:string;
 communicationChannel?:string;defaultCommunicationFields?:Record<string,string>};
const id=/^[A-Za-z][A-Za-z0-9_]*$/;
function validate(value:Definition,apiName:string):Definition{
 if(value.appApi!==apiName||!id.test(value.credential)||!value.label||!value.description
  ||!['Bearer','Basic','API Key','OAuth Client Credentials','OAuth Authorization Code','Authorization Scheme'].includes(value.auth)
  ||new URL(value.url).protocol!=='https:')throw Error('Invalid connector manifest: '+apiName);
 const names=new Set<string>();
 for(const field of value.fields){
  if(!/^public_[A-Za-z][A-Za-z0-9_]*$/.test(field.apiName)||names.has(field.apiName)
   ||!field.label||typeof field.defaultValue!=='string')throw Error('Invalid connector field: '+apiName);
  names.add(field.apiName);
 }
 for(const [operation,definition] of Object.entries(value.operations)){
  if(!id.test(operation)||!['GET','POST','PUT','PATCH','DELETE'].includes(definition.method)
   ||!definition.path||definition.path.startsWith('/')||definition.path.includes('\\'))
    throw Error('Invalid connector operation: '+apiName);
 }
 return value;
}
/** Installed copies live next to the compiled server; development reads source-owned scripts. */
async function manifest(appName:ConnectorAppName):Promise<Definition>{
 const file=connectorApps[appName]+'/scripts/install.mjs';
 const bundled=resolve(fileURLToPath(new URL('../connector-scripts/',import.meta.url)),file);
 const source=resolve(fileURLToPath(new URL('../../../connectors/',import.meta.url)),file);
 const filename=existsSync(bundled)?bundled:source;
 if(!existsSync(filename))throw Error('Connector script is missing: '+appName);
 const module=(await import(pathToFileURL(filename).href)) as {default:Definition};
 return validate(module.default,appName);
}

/** Catalog only. No tenant grant, install, secrets or connected-state side effects. */
export async function seedConnectorAppCatalog(db:Pick<SqlPersistence,'transaction'>):Promise<void>{
 await db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['metadrive:connector-app-catalog']);
  for(const name of Object.keys(connectorApps) as ConnectorAppName[]){
   const d=await manifest(name);
   await client.query(`INSERT INTO md_apps(api_name,label,enabled,tenant_owner_id,app_type)
      VALUES($1,$2,true,NULL,'ConnectorApp')
      ON CONFLICT(api_name) DO UPDATE SET app_type='ConnectorApp'
      WHERE md_apps.tenant_owner_id IS NULL`,[name,d.label]);
   const {rows}=await client.query<{id:string}>(`SELECT id FROM md_apps
      WHERE api_name=$1 AND enabled=true AND tenant_owner_id IS NULL`,[name]);
   if(!rows[0])throw Error('Connector catalogue registration conflict: '+name);
   await client.query(`INSERT INTO md_app_package_versions
      (app_id,version,published,description,brand_color)
      VALUES($1,1,true,$2,'#3A6073')
      ON CONFLICT(app_id,version) DO NOTHING`,[rows[0].id,d.description]);
   // Upgrade only already-installed connector metadata. Do not install apps,
   // replace tenant credentials or overwrite customer-authored properties.
   if(d.defaultCommunicationFields){
    const defaults={channelId:'onesys_'+d.folder.replace(/-/g,'_'),
     ...(d.communicationChannel?{communicationChannel:d.communicationChannel}:{}),
     defaultCommunicationFields:d.defaultCommunicationFields};
    await client.query(`
     UPDATE md_system_definitions p
     SET properties=$2::jsonb || p.properties,updated_at=now()
     FROM md_apps a JOIN md_app_installations i ON i.app_id=a.id
     WHERE a.api_name=$1 AND a.tenant_owner_id IS NULL
       AND p.tenant_id=i.tenant_id AND p.api_name=a.api_name
       AND p.kind='connector-providers' AND p.enabled=true
       AND NOT (p.properties ? 'defaultCommunicationFields')`,
      [name,JSON.stringify(defaults)]);
   }
  }
 });
}

/** AppExchange has already authorised entitlement and installation in the same transaction. */
export async function installConnectorApp(client:PoolClient,tenantId:string,name:ConnectorAppName):Promise<void>{
 const d=await manifest(name);
 const {rows:apps}=await client.query<{id:string}>(`SELECT id FROM md_apps
  WHERE api_name=$1 AND enabled=true AND tenant_owner_id IS NULL`,[name]);
 const appId=apps[0]?.id;
 if(!appId)throw Error('Connector app missing from published catalogue: '+name);
 // Existing Named Credentials can have customer-renamed labels, custom endpoints and ciphertext.
 // A system credential uses an immutable AppExchange-controlled namespace.
 // Keep legacy tenant credentials reusable until references can be migrated safely.
 const systemChannelId='onesys_'+connectorApps[name].replace(/-/g,'_');
 const systemCredentialName=systemChannelId;
 const {rows:legacyBinding}=await client.query<{credential_id:string;credential_name:string}>(`
  SELECT b.credential_id,b.credential_name FROM md_connector_app_credentials b
  WHERE b.tenant_id=$1 AND b.app_id=$2 LIMIT 1`,[tenantId,appId]);
 const credentialName=legacyBinding[0]?.credential_name??systemCredentialName;
 const {rows:credentials}=await client.query<{id:string}>(`INSERT INTO md_named_credentials
   (tenant_id,name,label,protocol,base_url,auth_type,header_name,enabled)
   VALUES($1,$2,$3,'HTTPS',$4,$5,$6,true)
   ON CONFLICT(tenant_id,name) DO NOTHING RETURNING id`,
   [tenantId,credentialName,d.label,d.url,d.auth,d.header]);
 // An existing unbound system name is not automatically owned by this connector.
 if(!credentials[0]&&!legacyBinding[0]){
  const {rows:owner}=await client.query<{app_id:string}>(`
   SELECT app_id FROM md_connector_app_credentials
   WHERE tenant_id=$1 AND credential_name=$2 LIMIT 1`,[tenantId,credentialName]);
  if(!owner[0])throw Error('System credential name collision: '+credentialName);
 }
 const created=Boolean(credentials[0]);
 const {rows:current}=created?{rows:credentials}:await client.query<{id:string}>(`
  SELECT id FROM md_named_credentials WHERE tenant_id=$1 AND name=$2 FOR UPDATE`,
  [tenantId,credentialName]);
 if(!current[0])throw Error('Connector credential could not be resolved: '+name);
 const credentialId=current[0].id;
 const {rows:existingOwner}=await client.query<{credential_id:string}>(`
  SELECT credential_id FROM md_connector_app_credentials
  WHERE tenant_id=$1 AND app_id=$2 AND credential_name=$3`,[tenantId,appId,credentialName]);
 if(existingOwner[0]&&existingOwner[0].credential_id!==credentialId)
  throw Error('Connector credential binding cannot change: '+name);
 await client.query(`INSERT INTO md_connector_app_credentials
   (tenant_id,app_id,credential_id,credential_name,provisioned)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
   [tenantId,appId,credentialId,credentialName,created]);
 // Reinstall re-enables managed resources without modifying existing customer secret/URL/auth.
 await client.query(`UPDATE md_named_credentials SET enabled=true,updated_at=now()
  WHERE tenant_id=$1 AND id=$2`,[tenantId,credentialId]);
 for(const field of d.fields){
  await client.query(`INSERT INTO md_connector_app_fields
    (tenant_id,app_id,credential_name,field_api,label,required,default_value)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO UPDATE
    SET label=EXCLUDED.label,required=EXCLUDED.required,default_value=EXCLUDED.default_value`,
    [tenantId,appId,credentialName,field.apiName,field.label,field.required,field.defaultValue]);
 }
 // These rows are connector-package declarations, never customer-defined Named Credential
 // variables. Remove stale optional declarations on reinstall; do not touch ciphertext.
 await client.query(`DELETE FROM md_connector_app_fields
  WHERE tenant_id=$1 AND app_id=$2 AND credential_name=$3
    AND NOT (field_api=ANY($4::text[]))`,
  [tenantId,appId,credentialName,d.fields.map(field=>field.apiName)]);
 const properties={status:'ACTIVE',baseUrl:d.url,operations:d.operations,documentation:d.docs,
  channelId:systemChannelId,credentialName,
  ...(d.communicationChannel?{communicationChannel:d.communicationChannel}:{}),
  ...(d.defaultCommunicationFields?{defaultCommunicationFields:d.defaultCommunicationFields}:{})};
 await client.query(`INSERT INTO md_system_definitions
  (tenant_id,kind,api_name,label,properties,enabled)
  VALUES($1,'connector-providers',$2,$3,$4::jsonb,true)
  ON CONFLICT(tenant_id,kind,api_name)
  DO UPDATE SET enabled=true,
    properties=EXCLUDED.properties || md_system_definitions.properties,
    updated_at=now()`,
  [tenantId,name,d.label,JSON.stringify(properties)]);
 const connection={status:'ACTIVE',connectorKey:name,configuration:{namedCredentialId:credentialId}};
 await client.query(`INSERT INTO md_system_definitions
  (tenant_id,kind,api_name,label,properties,enabled)
  VALUES($1,'integration-connections',$2,$3,$4::jsonb,true)
  ON CONFLICT(tenant_id,kind,api_name)
  DO UPDATE SET enabled=true,updated_at=now()`,
  [tenantId,name,name,JSON.stringify(connection)]);
}
/** Called by AppExchange only after tenant dependencies are checked and before removing installation. */
export async function uninstallConnectorApp(client:PoolClient,tenantId:string,name:string):Promise<void>{
 if(!isConnectorApp(name))return;
 const {rows:apps}=await client.query<{id:string}>(`SELECT id FROM md_apps
  WHERE api_name=$1 AND tenant_owner_id IS NULL`,[name]);
 if(!apps[0])return;
 const {rows:credentials}=await client.query<{credential_id:string;provisioned:boolean}>(`
  SELECT credential_id,provisioned FROM md_connector_app_credentials
  WHERE tenant_id=$1 AND app_id=$2`,[tenantId,apps[0].id]);
 // Only connector-owned definitions are disabled. Never DELETE or clear tenant ciphertext.
 await client.query(`UPDATE md_system_definitions SET enabled=false,updated_at=now()
  WHERE tenant_id=$1 AND api_name=$2 AND kind IN ('connector-providers','integration-connections')`,
  [tenantId,name]);
 for(const row of credentials){
  // A credential that existed before connector installation belongs to the tenant;
  // an unrelated app or Flow may be using it. Disable only connector-owned credentials.
  if(!row.provisioned)continue;
  // A shared, still-installed connector may rely on the same credential.
  const {rows:other}=await client.query<{in_use:boolean}>(`
   SELECT EXISTS(SELECT 1 FROM md_connector_app_credentials binding
    JOIN md_app_installations installed ON installed.tenant_id=binding.tenant_id AND installed.app_id=binding.app_id
    WHERE binding.tenant_id=$1 AND binding.credential_id=$2 AND binding.app_id<>$3) AS in_use`,
    [tenantId,row.credential_id,apps[0].id]);
  if(other[0]?.in_use)continue;
  await client.query(`UPDATE md_named_credentials SET enabled=false,updated_at=now()
    WHERE tenant_id=$1 AND id=$2`,[tenantId,row.credential_id]);
  await client.query(`UPDATE md_inbound_webhook_endpoints SET enabled=false,updated_at=now()
    WHERE tenant_id=$1 AND credential_id=$2`,[tenantId,row.credential_id]);
 }
}

import type {PoolClient} from 'pg';

/** Shared AppExchange install hook. Each application owns its independent seeder.
 * This module is lazy-imported only during an actual tenant installation,
 * never during Core boot or by an uninstalled frontend.
 */
/** Run within the installer's existing SQL transaction and licence checks. */
export async function seedInstalledAppMetadata(
 client:PoolClient,tenantId:string,appApiName:string
):Promise<void>{
 // AppExchange has already checked the tenant's licence and installation.
 const {isConnectorApp,installConnectorApp}=await import('./connector-apps.js');
 if(isConnectorApp(appApiName))await installConnectorApp(client,tenantId,appApiName);
}

import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {SqlPersistence} from '../system-files/sql-persistence.js';
import {FRESH_CORE_OBJECTS,seedFreshCoreObjects} from './fresh-core-objects.js';
import {FRESH_STANDARD_FIELDS} from './fresh-standard-fields.js';
import {COMMUNICATION_OBJECTS,COMMUNICATION_PICKLISTS,COMMUNICATION_ACTIVITY_FIELDS,seedCommunicationObjects} from './core-communication-objects.js';
import {QUOTATION_OBJECTS,seedQuotationObjects} from './core-quotation-objects.js';
import {LOCATION_SRN_FIELDS,seedLocationSrnMetadata} from './core-location-srn.js';
import {APPOINTMENT_OBJECTS,APPOINTMENT_STATUSES,seedAppointmentObjects} from './core-appointment-objects.js';
import {CART_OBJECTS,seedCartObjects} from './cart-objects.js';
import {CORE_CASH_LEDGER_FIELDS,seedCoreCashLedger} from './core-cash-ledger.js';
import {PRODUCT_IMAGE_FIELD,seedFreshProductImageField} from './product-image-field.js';
import {SMART_COMPONENTS,seedFreshSmartComponents} from './smart-components.js';
import {deactivateUnavailableBundledComponents} from './bundled-components.js';
import {reconcileCoreObjectDefaults} from './core-object-defaults.js';

/** The single CoreObjects entry point for tenant creation and existing-tenant reconciliation.
 * The imported modules are metadata catalogs, not independent startup seeders.
 * No business records, app installations, app flows, or user permissions are created here.
 */
export async function seedCoreObjects(client:PoolClient,tenantId:string):Promise<void>{
 await seedFreshCoreObjects(client,tenantId);
 await seedCommunicationObjects(client,tenantId);
 // The communication logger is a disabled, tenant-scoped service identity,
 // not a human bootstrap user.
 await client.query('SELECT md_ensure_communication_logger($1::uuid)',[tenantId]);
 await seedQuotationObjects(client,tenantId);
 await seedLocationSrnMetadata(client,tenantId);
 await seedAppointmentObjects(client,tenantId);
 await seedCartObjects(client,tenantId);
 await seedCoreCashLedger(client,tenantId);
 await seedFreshProductImageField(client,tenantId);
 await seedFreshSmartComponents(client,tenantId);
}

// Bump this whenever any catalog below changes (for example a new Smart
// component in SMART_COMPONENTS). A changed catalog under an old version stops
// API startup on purpose. v3: smart_keyboard, smart_dock, smart_chart.
export const CORE_OBJECTS_BOOTSTRAP_VERSION='core-objects-unified-v3';
const metadata=[
 FRESH_CORE_OBJECTS,FRESH_STANDARD_FIELDS,COMMUNICATION_OBJECTS,
 COMMUNICATION_PICKLISTS,COMMUNICATION_ACTIVITY_FIELDS,QUOTATION_OBJECTS,
 LOCATION_SRN_FIELDS,APPOINTMENT_OBJECTS,APPOINTMENT_STATUSES,CART_OBJECTS,
 CORE_CASH_LEDGER_FIELDS,PRODUCT_IMAGE_FIELD,SMART_COMPONENTS
];

/** One upgrade-safe reconciliation for all shared Core metadata. Existing
 * tenant choices are retained by the catalogs' conflict-safe inserts.
 */
export async function reconcileCoreObjects(db:SqlPersistence):Promise<number>{
 const checksum=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
 const count=await db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['metadrive:system:migrations']);
  const applied=await client.query<{checksum:string}>(
   'SELECT checksum FROM md_system_migrations WHERE version=$1',[CORE_OBJECTS_BOOTSTRAP_VERSION]);
  if(applied.rows[0]&&applied.rows[0].checksum!==checksum)
   throw Error('Unified CoreObjects metadata changed; create a new version');
  const {rows}=await client.query<{id:string}>('SELECT id FROM md_tenants ORDER BY id');
  for(const {id} of rows){
   await seedCoreObjects(client,id);
   // Retire only unreferenced system renderers; never remove tenant or app components.
   await deactivateUnavailableBundledComponents(client,id);
  }
  if(!applied.rows[0])await client.query(
   'INSERT INTO md_system_migrations(version,checksum) VALUES($1,$2)',
   [CORE_OBJECTS_BOOTSTRAP_VERSION,checksum]);
  return rows.length;
 });
 await reconcileCoreObjectDefaults(db);
 return count;
}

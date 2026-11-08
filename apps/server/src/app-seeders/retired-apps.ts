import type {SqlPersistence} from '../system-files/sql-persistence.js';

/** Stop exposing discontinued built-in apps before full metadata retirement.
 * This step does not mutate any business records, Objects, or Flows.
 */
export async function retireRemovedApps(db:Pick<SqlPersistence,'query'>):Promise<void>{
  await db.query(`UPDATE md_apps SET enabled=false
    WHERE tenant_owner_id IS NULL AND api_name = ANY($1::text[]) AND enabled=true`,
    [['Acetill','AceAssist','AceKiosk']]);
}

/** Only presentation/app metadata is retired; business Objects, their records,
 * and every Flow definition/version/run are deliberately outside this transaction.
 * These names are exact built-in identities, never broad Communication matches.
 */
export const CHATTER_APP_APIS = ['AceChatter','OneChatter','UNEAceChatter'] as const;
export const REMOVED_APP_APIS = ['Acetill','AceAssist','AceKiosk',...CHATTER_APP_APIS] as const;
export const CHATTER_PAGE_APIS = ['OneChatterInbox','UNEAceChatterDesktop',
  'UNEAceChatterTablet','UNEAceChatterMobile','UNEAceChatterCustom'] as const;
export const CHATTER_COMPONENT_APIS = [
  'onechatter_input','onechatter_conversation',
  'uneacechatter_input','uneacechatter_conversation','uneacechatter_modal',
  'uneacechatter_tabs','uneacechatter_stack','uneacechatter_lookup',
  'uneacechatter_button','uneacechatter_search'
] as const;
const CHATTER_PERMISSION_SETS = ['AcetillCashier','AceAssistUser','AceAssistCashier',
  'AceKioskUser','AceChatterUser','OneChatterUser','UNEAceChatterUser'] as const;

export async function deleteRetiredChatterMetadata(
  db:Pick<SqlPersistence,'transaction'>
):Promise<{apps:number;pages:number;components:number;referencedComponents:number}> {
  return db.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      ['metadrive:retired-chat-app-metadata']);
    const {rows:apps}=await client.query<{id:string}>(
      'SELECT id FROM md_apps WHERE tenant_owner_id IS NULL AND api_name = ANY($1::text[]) FOR UPDATE',
      [[...REMOVED_APP_APIS]]);
    const appIds=apps.map(app=>app.id);
    // A retired app cannot remain the user's sign-in landing destination.
    await client.query("UPDATE md_users SET landing_app_api='Setup' "+
      'WHERE landing_app_api=ANY($1::text[])',[[...REMOVED_APP_APIS]]);

    // Capture proven app-owned pages only. Never delete other apps' pages.
    await client.query('CREATE TEMP TABLE md_retired_chatter_pages '+
      '(tenant_id uuid NOT NULL,page_id uuid NOT NULL,PRIMARY KEY(tenant_id,page_id)) ON COMMIT DROP');
    const {rowCount:pages}=await client.query(
      'INSERT INTO md_retired_chatter_pages(tenant_id,page_id) '+
      'SELECT p.tenant_id,p.id FROM md_page_definitions p '+
      'WHERE (p.api_name=ANY($1::text[]) '+
      'OR EXISTS (SELECT 1 FROM md_app_seed_pages s WHERE s.tenant_id=p.tenant_id '+
      'AND s.page_id=p.id AND s.app_id=ANY($3::uuid[])) '+
      'OR EXISTS (SELECT 1 FROM md_app_package_seed_receipts r '+
      "WHERE r.tenant_id=p.tenant_id AND r.resource_type='App Page' "+
      'AND r.api_name=p.api_name AND r.app_id=ANY($3::uuid[])) '+
      'OR EXISTS (SELECT 1 FROM md_app_package_page_templates t '+
      'WHERE t.api_name=p.api_name AND t.app_id=ANY($3::uuid[]))) '+
      'AND NOT EXISTS (SELECT 1 FROM md_app_home_pages h '+
      'WHERE h.tenant_id=p.tenant_id AND h.page_id=p.id AND h.app_id<>ALL($3::uuid[])) '+
      'AND NOT EXISTS (SELECT 1 FROM md_app_seed_pages s '+
      'WHERE s.tenant_id=p.tenant_id AND s.page_id=p.id AND s.app_id<>ALL($3::uuid[])) '+
      'AND NOT EXISTS (SELECT 1 FROM md_tenant_app_navigation n '+
      "WHERE n.tenant_id=p.tenant_id AND n.entry_type='App Page' "+
      'AND n.api_name=p.api_name AND n.app_id<>ALL($3::uuid[])) '+
      'AND NOT EXISTS (SELECT 1 FROM md_lightning_page_activation a '+
      'WHERE a.tenant_id=p.tenant_id AND a.page_id=p.id '+
      'AND a.app_api IS NOT NULL AND a.app_api<>ALL($2::text[])) '+
      'AND NOT EXISTS (SELECT 1 FROM md_object_lifecycle_page_states o '+
      'WHERE o.tenant_id=p.tenant_id AND o.page_id=p.id) '+
      'AND (EXISTS(SELECT 1 FROM md_app_home_pages h '+
      'WHERE h.tenant_id=p.tenant_id AND h.page_id=p.id AND h.app_id=ANY($3::uuid[])) '+
      'OR EXISTS(SELECT 1 FROM md_app_seed_pages s WHERE s.tenant_id=p.tenant_id '+
      'AND s.page_id=p.id AND s.app_id=ANY($3::uuid[])) '+
      'OR EXISTS(SELECT 1 FROM md_app_package_seed_receipts r '+
      "WHERE r.tenant_id=p.tenant_id AND r.resource_type='App Page' "+
      'AND r.api_name=p.api_name AND r.app_id=ANY($3::uuid[])) '+
      'OR EXISTS(SELECT 1 FROM md_lightning_page_activation a '+
      'WHERE a.tenant_id=p.tenant_id AND a.page_id=p.id AND a.app_api=ANY($2::text[])))',
      [[...CHATTER_PAGE_APIS,'AcetillRegister','AcetillRegisterEditable','AceAssist_Calendar'],[...REMOVED_APP_APIS],appIds]);

    // Remove only app navigation/activations on unrelated shared pages.
    await client.query('DELETE FROM md_lightning_page_activation '+
      'WHERE app_api=ANY($1::text[])',[[...REMOVED_APP_APIS]]);
    await client.query('DELETE FROM md_page_layout_version_activation '+
      'WHERE app_api=ANY($1::text[])',[[...REMOVED_APP_APIS]]);

    // Remove page foreign-key owners before deleting Page Definitions.
    await client.query('DELETE FROM md_app_seed_pages WHERE app_id=ANY($1::uuid[]) '+
      'OR (tenant_id,page_id) IN (SELECT tenant_id,page_id FROM md_retired_chatter_pages)',[appIds]);
    const {rows:seedVersionTable}=await client.query<{exists:boolean}>(
      "SELECT to_regclass('md_app_seed_page_versions') IS NOT NULL AS exists");
    if(seedVersionTable[0]?.exists) {
      await client.query('DELETE FROM md_app_seed_page_versions WHERE '+
        '(tenant_id,page_id) IN (SELECT tenant_id,page_id FROM md_retired_chatter_pages)');
    }
    await client.query('DELETE FROM md_app_home_pages WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_page_layout_heads WHERE (tenant_id,page_id) '+
      'IN (SELECT tenant_id,page_id FROM md_retired_chatter_pages)');
    await client.query('DELETE FROM md_page_components WHERE (tenant_id,page_id) '+
      'IN (SELECT tenant_id,page_id FROM md_retired_chatter_pages)');
    await client.query('DELETE FROM md_page_definitions WHERE (tenant_id,id) '+
      'IN (SELECT tenant_id,page_id FROM md_retired_chatter_pages)');

    // These permission sets belong to the removed apps. Do not remove Flow
    // definitions or any Flow/Object permissions from other permission sets.
    const permissionIds='SELECT tenant_id,id FROM md_permission_sets '+
      'WHERE api_name=ANY($1::text[])';
    for(const table of ['md_permission_assignments','md_role_permission_sets',
      'md_permission_group_sets','md_profile_permission_sets',
      'md_permission_set_license_requirements','md_permission_rules']) {
      await client.query('DELETE FROM '+table+' WHERE (tenant_id,permission_set_id) '+
        'IN ('+permissionIds+')',[[...CHATTER_PERMISSION_SETS]]);
    }
    // The optional profile editor pointer is a non-cascading FK to the set.
    await client.query('UPDATE md_profiles SET editor_set_id=NULL '+
      'WHERE (tenant_id,editor_set_id) IN ('+permissionIds+')',[[...CHATTER_PERMISSION_SETS]]);
    await client.query('DELETE FROM md_permission_sets '+
      'WHERE api_name=ANY($1::text[])',[[...CHATTER_PERMISSION_SETS]]);
    await client.query('DELETE FROM md_permission_rules '+
      "WHERE resource=ANY($1::text[])",[
        REMOVED_APP_APIS.map(name=>'App:'+name)]);

    // A tenant may have reused a component on a different, retained page.
    // Preserve its renderer and metadata while any surviving page references it.
    // Only app-owned bundled renderers. Names with a shared Smart/UNE identity
    // are intentionally excluded to protect surviving applications.
    const retiredRenderer="d.renderer_key='one-bundled:'||d.api_name "+
      "AND (d.api_name='ChatterInbox' OR d.api_name ~ '^(acetill_|aceassist_|acekiosk_|onechatter_|uneacechatter_|ui_)')";
    const referenced='EXISTS(SELECT 1 FROM md_page_components p '+
      'WHERE p.tenant_id=d.tenant_id AND p.component_api=d.api_name) '+
      'OR EXISTS(SELECT 1 FROM md_lightning_page_nodes n '+
      "WHERE n.tenant_id=d.tenant_id AND n.component_type='Custom:'||d.api_name) "+
      'OR EXISTS(SELECT 1 FROM md_page_layout_version_nodes n '+
      "WHERE n.tenant_id=d.tenant_id AND n.component_type='Custom:'||d.api_name)";
    const unreferenced='('+retiredRenderer+') AND NOT ('+referenced+')';
    await client.query('UPDATE md_component_definitions d SET enabled=false WHERE '+unreferenced);
    await client.query('DELETE FROM md_component_library_heads h WHERE EXISTS ('+
      'SELECT 1 FROM md_component_definitions d WHERE d.tenant_id=h.tenant_id '+
      'AND d.api_name=h.component_api AND '+unreferenced+')');
    await client.query('DELETE FROM md_component_library_versions v WHERE EXISTS ('+
      'SELECT 1 FROM md_component_definitions d WHERE d.tenant_id=v.tenant_id '+
      'AND d.api_name=v.component_api AND '+unreferenced+')');
    const removedComponents=await client.query(
      'DELETE FROM md_component_definitions d WHERE '+unreferenced);
    const {rows:remaining}=await client.query<{count:string}>(
      'SELECT count(*)::text AS count FROM md_component_definitions d WHERE '+retiredRenderer);

    // These are app-owned webhook/integration registrations, never Communication
    // Object records. Deleting their metadata leaves all Flows and Objects intact.
    await client.query('DELETE FROM md_inbound_webhook_events e USING md_inbound_webhook_endpoints p '+
      'WHERE e.tenant_id=p.tenant_id AND e.endpoint_id=p.id '+
      'AND p.app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_inbound_webhook_endpoints WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_connector_app_fields WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_connector_app_credentials WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_retired_app_package_version_archive WHERE app_id=ANY($1::uuid[])',[appIds]);
    // Package templates are presentation metadata, not Object/Flow definitions.
    await client.query('DELETE FROM md_app_route_aliases WHERE app_api=ANY($1::text[])',
      [[...REMOVED_APP_APIS]]);
    await client.query('DELETE FROM md_tenant_app_installed_versions WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_tenant_app_metadata WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_app_entitlements WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_app_installations WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_app_package_seed_receipts WHERE app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_app_package_dependencies '+
      'WHERE required_app_id=ANY($1::uuid[])',[appIds]);
    await client.query('DELETE FROM md_app_package_versions WHERE app_id=ANY($1::uuid[])',[appIds]);
    const removedApps=await client.query('DELETE FROM md_apps WHERE id=ANY($1::uuid[])',[appIds]);
    return {apps:removedApps.rowCount??0,pages:pages??0,
      components:removedComponents.rowCount??0,referencedComponents:Number(remaining[0]?.count??0)};
  });
}

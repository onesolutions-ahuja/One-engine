import {AsyncLocalStorage} from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import {auditContext,setSqlAuditContext} from '../system-support/audit-context.js';
export function resolveSqlConnection(databaseUrl:string,env:NodeJS.ProcessEnv) {
  if(!databaseUrl)throw new Error('DATABASE_URL is required');
  const uri=new URL(databaseUrl);
  if(!['postgres:','postgresql:'].includes(uri.protocol))throw new Error('Invalid PostgreSQL connection URL');
  const override=env.METADRIVE_DB_NAME_OVERRIDE?.trim();
  if(override) {
    if(!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(override))throw new Error('Invalid database name override');
    uri.pathname='/'+override;
  }
  const raw=env.METADRIVE_DB_CA_CERT?.trim();
  if(!raw)return {connectionString:uri.toString()};
  const candidate=raw.includes('BEGIN CERTIFICATE')?raw.replace(/\\n/g,'\n'):Buffer.from(raw,'base64').toString('utf8');
  if(!candidate.includes('-----BEGIN CERTIFICATE-----')||!candidate.includes('-----END CERTIFICATE-----'))
    throw new Error('Invalid configured PostgreSQL CA certificate');
  // pg-connection-string gives sslmode precedence over explicit ssl options.
  // Remove it so node TLS uses this CA and still verifies the server identity.
  uri.searchParams.delete('sslmode');
  uri.searchParams.delete('sslrootcert');
  return {
    connectionString:uri.toString(),
    ssl:{ca:candidate,rejectUnauthorized:true,servername:uri.hostname}
  };
}
export function resolveSqlPoolSize(env:NodeJS.ProcessEnv):number {
  const raw=env.METADRIVE_DB_POOL_MAX?.trim();
  if(!raw)return 5; // Leave headroom for additional replicas, workers and administrative connections.
  if(!/^[1-9][0-9]*$/.test(raw))throw new Error('Invalid SQL connection pool size');
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value>50)throw new Error('Invalid SQL connection pool size');
  return value;
}
export class SqlPersistence {
  readonly pool: Pool;
  private readonly activeTransaction = new AsyncLocalStorage<PoolClient>();
  private savepointSequence = 0;
  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required; JSON fallback is forbidden');
    // Aiven's dedicated SQL database is selected by environment configuration.
    // Retain TLS and credential options from the original DATABASE_URL.
    const config=resolveSqlConnection(databaseUrl,process.env);
    this.pool = new Pool({ ...config, max: resolveSqlPoolSize(process.env), connectionTimeoutMillis: 10000 });
  }
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params: readonly unknown[] = []) {
    const active=this.activeTransaction.getStore();
    if(active)return active.query<T>(sql,[...params]);
    const context=auditContext();
    if(context?.actorUser&&/^\s*(INSERT|UPDATE|DELETE|WITH|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(sql))
      return this.transaction(client=>client.query<T>(sql,[...params]));
    return this.pool.query<T>(sql, [...params]);
  }
  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const active=this.activeTransaction.getStore();
    if(active){
      // Nested services (notably RBAC) must never acquire a second pooled connection.
      // A savepoint retains inner rollback semantics without ending the outer transaction.
      const name='md_nested_'+(++this.savepointSequence);
      await active.query('SAVEPOINT '+name);
      try{
        const value=await run(active);
        await active.query('RELEASE SAVEPOINT '+name);
        return value;
      }catch(error){
        try{await active.query('ROLLBACK TO SAVEPOINT '+name);}
        finally{await active.query('RELEASE SAVEPOINT '+name);}
        throw error;
      }
    }
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const context=auditContext();
      if(context)await setSqlAuditContext(client,context);
      return await this.activeTransaction.run(client,async()=>{
        const value=await run(client);
        await client.query('COMMIT');
        return value;
      });
    }catch(error){
      try{await client.query('ROLLBACK');}catch(rollbackError){
        console.error('SQL rollback failed',rollbackError);
      }
      throw error;
    }finally{client.release();}
  }
  async verifySchema() {
    const names=["md_rbac_revisions","md_permission_set_groups","md_permission_group_sets","md_permission_group_mutes","md_user_permission_groups","md_access_groups","md_access_group_members","md_queue_objects","md_sharing_settings","md_record_policies","md_policy_owner_roles","md_policy_conditions","md_policy_condition_values","md_tenants","md_users","md_tenant_domains","md_sessions","md_refresh_sessions","md_roles","md_user_roles","md_permission_sets","md_permission_assignments","md_role_permission_sets","md_permission_rules","md_object_definitions","md_field_definitions","md_field_picklist_values","md_records","md_record_values","md_component_definitions","md_component_properties","md_page_definitions","md_page_components","md_page_properties","md_flow_definitions","md_flow_nodes","md_flow_edges","md_flow_runs","md_flow_editor_values","md_flow_interview_state","md_flow_interview_values","md_apps","md_tenant_app_metadata","md_tenant_app_navigation","md_tenant_app_utilities","md_app_installations","md_app_entitlements","md_app_home_pages","md_flow_node_properties","md_flow_run_inputs","md_initial_password_rotations","md_page_component_properties","md_app_seed_pages","md_system_definitions","md_platform_event_details","md_platform_event_fields","md_platform_event_picklist_values","md_named_credentials","md_app_route_aliases","md_tenant_settings","md_tenant_lifecycle_audit","md_object_layout_versions","md_object_page_layouts","md_object_page_layout_sections","md_object_page_layout_fields","md_object_page_layout_actions","md_object_page_layout_related_lists","md_object_page_layout_links","md_object_page_layout_assignments","md_lightning_page_details","md_lightning_page_nodes","md_lightning_page_node_properties","md_lightning_page_activation","md_page_layout_versions","md_page_layout_heads","md_page_layout_version_nodes","md_page_layout_version_properties","md_page_layout_version_activation","md_page_layout_audit","md_profiles","md_user_profiles","md_profile_permission_sets","md_object_record_types","md_object_record_type_values","md_bootstrap_password_repairs","md_tenant_provisioning_requests","md_notifications","md_approval_requests","md_record_activities","md_record_chatter_posts","md_record_chatter_comments","md_password_recovery_settings","md_security_events","md_record_history","md_component_library_versions","md_component_library_heads","md_dashboard_snapshots","md_dashboard_subscriptions","md_tenant_developer_accounts","md_tenant_recovery_contacts","md_tenant_recovery_cases","md_tenant_recovery_case_proofs","md_tenant_recovery_approvals","md_field_dependencies","md_field_dependency_values","md_auto_number_counters","md_record_multi_values","md_flow_interview_records","md_flow_interview_record_fields","md_flow_interview_loop_state","md_http_callout_jobs","md_http_callout_job_values","md_object_manager_settings","md_object_field_sets","md_object_field_set_items","md_object_actions","md_global_value_sets","md_global_value_set_values","md_global_value_set_audit","md_field_global_value_sets","md_custom_labels","md_custom_metadata_types","md_custom_metadata_fields","md_custom_metadata_records","md_custom_metadata_values","md_custom_settings","md_custom_setting_fields","md_custom_setting_entries","md_custom_setting_values","md_encrypted_field_access_audit"];
    names.push('md_field_rollup_filters','md_field_type_migrations','md_field_type_migration_values',
      'md_field_type_migration_config','md_field_type_migration_picklist_values',
      'md_field_type_migration_rollup_filters');
    names.push('md_flow_email_jobs','md_record_files');
    names.push('md_communication_delivery_outbox');
    names.push('md_tenant_automation_settings');
    names.push('md_tenant_api_usage_daily');
    names.push('md_metadata_package_installations','md_metadata_package_versions',
      'md_metadata_package_components');
    names.push('md_flow_execution_audit','md_validation_rules','md_field_default_formulas',
      'md_validation_rule_history','md_field_default_formula_history','md_password_policies',
      'md_password_history','md_session_policies','md_login_ip_ranges','md_login_hours',
      'md_mfa_backup_codes','md_webauthn_credentials','md_webauthn_challenges',
      'md_identity_providers','md_federated_identities','md_federation_requests',
      'md_saml_request_ids','md_federation_tickets');
    names.push('md_system_permission_catalogue','md_license_entitlements','md_license_capabilities','md_user_license_assignments','md_permission_set_license_requirements','md_setup_audit_events','md_setup_audit_tables','md_monitor_settings','md_monitor_events','md_transaction_security_rules','md_security_rule_windows','md_oauth_clients','md_oauth_codes','md_oauth_tokens','md_oauth_consents');
    const {rows}=await this.query<{table_name:string}>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[])',
      [names]);
    const present=new Set(rows.map(row=>row.table_name));
    const missing=names.filter(name=>!present.has(name));
    if(missing.length)throw new Error('SQL system schema incomplete: '+missing.join(', '));
  }
  async close() { await this.pool.end(); }
}
export type SqlExecutor = Pick<SqlPersistence, 'query'>;

-- Fresh, isolated system runtime schema. No legacy tables or JSON state imports.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS md_tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE IF NOT EXISTS md_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), email text NOT NULL, password_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true, landing_app_api text NOT NULL DEFAULT 'Setup', UNIQUE(tenant_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS md_users_email_per_tenant ON md_users (tenant_id,lower(email));
CREATE TABLE IF NOT EXISTS md_tenant_domains (domain text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES md_tenants(id), CHECK (domain=lower(domain)));
CREATE TABLE IF NOT EXISTS md_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), user_id uuid NOT NULL, FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id), token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS md_refresh_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), user_id uuid NOT NULL, FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id), token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS md_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),api_name text NOT NULL,label text NOT NULL,parent_role_id uuid, UNIQUE(tenant_id,api_name), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,parent_role_id) REFERENCES md_roles(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_user_roles (tenant_id uuid NOT NULL REFERENCES md_tenants(id),user_id uuid NOT NULL,role_id uuid NOT NULL,FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id), FOREIGN KEY(tenant_id,role_id) REFERENCES md_roles(tenant_id,id),PRIMARY KEY(tenant_id,user_id,role_id));
CREATE TABLE IF NOT EXISTS md_permission_sets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), api_name text NOT NULL, UNIQUE(tenant_id,api_name), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_permission_assignments (tenant_id uuid NOT NULL REFERENCES md_tenants(id), user_id uuid NOT NULL, permission_set_id uuid NOT NULL, FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id), FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id), PRIMARY KEY(tenant_id,user_id,permission_set_id));
CREATE TABLE IF NOT EXISTS md_role_permission_sets (tenant_id uuid NOT NULL REFERENCES md_tenants(id),role_id uuid NOT NULL, permission_set_id uuid NOT NULL, FOREIGN KEY(tenant_id,role_id) REFERENCES md_roles(tenant_id,id), FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id), PRIMARY KEY(tenant_id,role_id,permission_set_id));
CREATE TABLE IF NOT EXISTS md_permission_rules (tenant_id uuid NOT NULL REFERENCES md_tenants(id), permission_set_id uuid NOT NULL, FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id), resource text NOT NULL, action text NOT NULL, effect text NOT NULL CHECK (effect IN ('allow','deny')), PRIMARY KEY(tenant_id,permission_set_id,resource,action));
CREATE TABLE IF NOT EXISTS md_object_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), api_name text NOT NULL, label text NOT NULL, is_system boolean NOT NULL DEFAULT false, UNIQUE(tenant_id,api_name));
-- Soft-delete reserves the API name and retains all foreign-key references.
ALTER TABLE md_object_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS md_field_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), object_api text NOT NULL, api_name text NOT NULL, label text, data_type text NOT NULL, related_object text, track_history boolean NOT NULL DEFAULT false, max_length integer CHECK (max_length BETWEEN 1 AND 1000000), required boolean NOT NULL DEFAULT false, UNIQUE(tenant_id,object_api,api_name), UNIQUE(tenant_id,object_api,id), FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name), FOREIGN KEY(tenant_id,related_object) REFERENCES md_object_definitions(tenant_id,api_name));
CREATE TABLE IF NOT EXISTS md_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), object_api text NOT NULL, is_clone boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), is_deleted boolean NOT NULL DEFAULT false, deleted_at timestamptz, deleted_by uuid, deletion_group_id uuid, deletion_root_id uuid, UNIQUE(tenant_id,id), UNIQUE(tenant_id,id,object_api), FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name));
CREATE TABLE IF NOT EXISTS md_record_values (tenant_id uuid NOT NULL REFERENCES md_tenants(id), record_id uuid NOT NULL, object_api text NOT NULL, field_api text NOT NULL, value_text text, reference_record_id uuid, PRIMARY KEY(tenant_id,record_id,field_api), FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE, FOREIGN KEY(tenant_id,object_api,field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name), FOREIGN KEY(tenant_id,reference_record_id) REFERENCES md_records(tenant_id,id));
-- Recycle Bin storage is relational and tenant-scoped. Also maintained by the
-- upgrade-safe 20261105 migration for existing installations.
CREATE INDEX IF NOT EXISTS md_records_active_lookup
 ON md_records(tenant_id,object_api,id) WHERE is_deleted=false;
CREATE INDEX IF NOT EXISTS md_records_recycle_bin
 ON md_records(tenant_id,object_api,deleted_at DESC,id) WHERE is_deleted=true;
CREATE INDEX IF NOT EXISTS md_records_deletion_group
 ON md_records(tenant_id,deletion_group_id) WHERE is_deleted=true;
CREATE TABLE IF NOT EXISTS md_deleted_lookup_links(
 tenant_id uuid NOT NULL, deletion_group_id uuid NOT NULL,
 source_record_id uuid NOT NULL, source_object_api text NOT NULL,
 field_api text NOT NULL, target_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,deletion_group_id,source_record_id,field_api),
 FOREIGN KEY(tenant_id,source_record_id,source_object_api)
 REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_deleted_lookup_links_target
 ON md_deleted_lookup_links(tenant_id,deletion_group_id,target_record_id);
-- Automatic permanent purge is OFF unless explicitly enabled by an authorized tenant admin.
CREATE TABLE IF NOT EXISTS md_record_retention_settings (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 retention_days integer NOT NULL DEFAULT 15 CHECK(retention_days BETWEEN 1 AND 3650),
 automatic_purge_enabled boolean NOT NULL DEFAULT false,
 configured_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,configured_by) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_record_retention_audit (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 retention_days integer NOT NULL,
 automatic_purge_enabled boolean NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_retention_audit_lookup
 ON md_record_retention_audit(tenant_id,changed_at DESC);

CREATE TABLE IF NOT EXISTS md_record_lifecycle_audit(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 record_id uuid NOT NULL, object_api text NOT NULL, deletion_group_id uuid,
 actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('delete','restore','purge')),
 happened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_lifecycle_audit_record
 ON md_record_lifecycle_audit(tenant_id,object_api,record_id,happened_at DESC);
CREATE TABLE IF NOT EXISTS md_component_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), api_name text NOT NULL, renderer_key text NOT NULL, enabled boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,api_name), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_page_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), api_name text NOT NULL, title text NOT NULL, enabled boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,api_name), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_page_components (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), page_id uuid NOT NULL, component_api text NOT NULL, FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id), FOREIGN KEY(tenant_id,component_api) REFERENCES md_component_definitions(tenant_id,api_name), slot text NOT NULL, sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS md_flow_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), api_name text NOT NULL, label text, flow_type text NOT NULL DEFAULT 'Autolaunched Flow', version integer NOT NULL, active boolean NOT NULL DEFAULT false, UNIQUE(tenant_id,api_name,version), UNIQUE(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_flow_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id), flow_id uuid NOT NULL, started_by uuid NOT NULL, FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id), FOREIGN KEY(tenant_id,started_by) REFERENCES md_users(tenant_id,id), status text NOT NULL CHECK(status IN ('pending','waiting','completed','failed','cancelled')), wait_kind text NOT NULL DEFAULT 'wait' CHECK(wait_kind IN ('wait','scheduled-path','orchestration')), UNIQUE(tenant_id,id), started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,error_code text,wait_until timestamptz);
CREATE TABLE IF NOT EXISTS md_apps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_name text NOT NULL UNIQUE, label text NOT NULL, enabled boolean NOT NULL DEFAULT true, app_type text NOT NULL DEFAULT 'Application' CHECK (app_type IN ('Application','ConnectorApp')));
CREATE TABLE IF NOT EXISTS md_app_installations (tenant_id uuid NOT NULL REFERENCES md_tenants(id), app_id uuid NOT NULL REFERENCES md_apps(id), PRIMARY KEY(tenant_id,app_id));

-- Relational component/page/flow properties; values never execute server-side code.
CREATE TABLE IF NOT EXISTS md_component_properties (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id), component_id uuid NOT NULL, FOREIGN KEY(tenant_id,component_id) REFERENCES md_component_definitions(tenant_id,id) ON DELETE CASCADE,
 api_name text NOT NULL, value_text text, data_type text NOT NULL DEFAULT 'text', PRIMARY KEY(tenant_id,component_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_page_properties (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id), page_id uuid NOT NULL, FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id) ON DELETE CASCADE,
 api_name text NOT NULL, value_text text, PRIMARY KEY(tenant_id,page_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_flow_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 flow_id uuid NOT NULL, FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id) ON DELETE CASCADE,
 api_name text NOT NULL,node_type text NOT NULL,sort_order integer NOT NULL DEFAULT 0, UNIQUE(tenant_id,id), UNIQUE(tenant_id,flow_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_flow_edges (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),flow_id uuid NOT NULL, FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id) ON DELETE CASCADE,
 source_api text NOT NULL,target_api text NOT NULL,outcome text NOT NULL DEFAULT 'default',
 PRIMARY KEY(tenant_id,flow_id,source_api,outcome)
);
CREATE TABLE IF NOT EXISTS md_app_entitlements (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),app_id uuid NOT NULL REFERENCES md_apps(id),
 active boolean NOT NULL DEFAULT false, expires_at timestamptz,
 PRIMARY KEY(tenant_id,app_id)
);

-- SQL app-specific Home Page assignment. Null assignment is represented by no row.
CREATE TABLE IF NOT EXISTS md_app_home_pages (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  app_id uuid NOT NULL REFERENCES md_apps(id),
  form_factor text NOT NULL CHECK (form_factor IN ('desktop','tablet','phone','custom')),
  page_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,app_id,form_factor),
  FOREIGN KEY(tenant_id,app_id) REFERENCES md_app_installations(tenant_id,app_id),
  FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS md_flow_node_properties (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  node_id uuid NOT NULL,
  api_name text NOT NULL,
  value_text text,
  data_type text NOT NULL CHECK(data_type IN ('text','string','number','boolean','null')),
  PRIMARY KEY(tenant_id,node_id,api_name),
  FOREIGN KEY(tenant_id,node_id) REFERENCES md_flow_nodes(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_run_inputs (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  run_id uuid NOT NULL,
  api_name text NOT NULL,
  value_text text,
  data_type text NOT NULL CHECK(data_type IN ('text','string','number','boolean','null')),
  PRIMARY KEY(tenant_id,run_id,api_name),
  FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS md_bootstrap_password_repairs (tenant_id uuid NOT NULL, user_id uuid NOT NULL, reconciled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id));

CREATE TABLE IF NOT EXISTS md_initial_password_rotations (tenant_id uuid NOT NULL, user_id uuid NOT NULL, rotated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id));
-- Stable references remain tenant-scoped even when API names change.
CREATE UNIQUE INDEX IF NOT EXISTS md_object_definition_tenant_id ON md_object_definitions(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS md_field_definition_tenant_id ON md_field_definitions(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS md_page_component_tenant_id ON md_page_components(tenant_id,id);
CREATE TABLE IF NOT EXISTS md_page_component_properties (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id), component_id uuid NOT NULL,
 property_path text NOT NULL, value_text text,
 data_type text NOT NULL CHECK(data_type IN ('string','number','boolean','null','reference','array','object')),
 object_id uuid,field_id uuid,flow_id uuid,
 PRIMARY KEY(tenant_id,component_id,property_path),
 FOREIGN KEY(tenant_id,component_id) REFERENCES md_page_components(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_id) REFERENCES md_object_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,field_id) REFERENCES md_field_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id),
 CHECK((data_type='reference' AND num_nonnulls(object_id,field_id,flow_id)=1 AND value_text IS NULL)
  OR (data_type<>'reference' AND num_nonnulls(object_id,field_id,flow_id)=0))
);
CREATE TABLE IF NOT EXISTS md_app_seed_pages (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),app_id uuid NOT NULL REFERENCES md_apps(id),seed_key text NOT NULL,
 page_id uuid NOT NULL,component_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(tenant_id,app_id,seed_key),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,component_id) REFERENCES md_page_components(tenant_id,id)
);

-- Run by the versioned SQL migration runner before enabling the new routes.
-- Shared metadata for optional runtime definitions. Never stores credentials or secrets.
CREATE TABLE IF NOT EXISTS md_system_definitions (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 kind text NOT NULL CHECK (kind IN ('platform-events','email-alerts','approval-processes','dashboards','dashboard-folders','dashboard-territories','report-folders','reports','connector-providers','integration-connections')),
 api_name text NOT NULL,
 label text NOT NULL,
 properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties)='object'),
 enabled boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,kind,api_name)
);
CREATE INDEX IF NOT EXISTS md_system_definitions_lookup ON md_system_definitions(tenant_id,kind,enabled);
CREATE TABLE IF NOT EXISTS md_platform_event_details (
 tenant_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'platform-events' CHECK(kind='platform-events'),
 event_api_name text NOT NULL,
 description text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,event_api_name),
 FOREIGN KEY(tenant_id,kind,event_api_name)
  REFERENCES md_system_definitions(tenant_id,kind,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_platform_event_fields (
 tenant_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'platform-events' CHECK(kind='platform-events'),
 event_api_name text NOT NULL,
 field_api text NOT NULL,
 label text NOT NULL,
 data_type text NOT NULL CHECK(data_type IN (
  'Text(255)','Long Text Area','Number','Currency','Percent','Checkbox','Date','DateTime','Picklist')),
 required boolean NOT NULL DEFAULT false,
 picklist_restricted boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
 PRIMARY KEY(tenant_id,event_api_name,field_api),
 FOREIGN KEY(tenant_id,kind,event_api_name)
  REFERENCES md_system_definitions(tenant_id,kind,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_platform_event_picklist_values (
 tenant_id uuid NOT NULL,
 event_api_name text NOT NULL,
 field_api text NOT NULL,
 value_text text NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order>=0),
 PRIMARY KEY(tenant_id,event_api_name,field_api,value_text),
 FOREIGN KEY(tenant_id,event_api_name,field_api)
  REFERENCES md_platform_event_fields(tenant_id,event_api_name,field_api) ON DELETE CASCADE
);

-- Isolated encrypted credential storage. The SQL record never contains plaintext secrets.
CREATE TABLE IF NOT EXISTS md_named_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 name text NOT NULL,
 label text NOT NULL,
 protocol text NOT NULL CHECK(protocol IN ('HTTPS','SMTP')),
 base_url text NOT NULL,
 auth_type text NOT NULL,
 header_name text NOT NULL DEFAULT '',
 secret_ciphertext bytea,
 configuration_ciphertext bytea,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,name),UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_flow_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 run_id uuid NOT NULL,
 flow_id uuid NOT NULL,
 flow_version integer NOT NULL CHECK(flow_version>0),
 node_id integer NOT NULL,
 step integer NOT NULL CHECK(step BETWEEN 0 AND 199),
 user_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 payload_ciphertext bytea NOT NULL,
 encryption_key_id text NOT NULL,
 status text NOT NULL DEFAULT 'queued'
  CHECK(status IN ('queued','sending','completed','failed')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 completed_at timestamptz,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,run_id,node_id,step),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_flow_email_jobs_queue
 ON md_flow_email_jobs(status,created_at,id) WHERE status='queued';
-- Queued Quick Action email reuses the existing encrypted SMTP credential service.
-- A client-generated request key deduplicates retries without retrying unknown SMTP outcomes.
CREATE TABLE IF NOT EXISTS md_quick_action_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 object_api text NOT NULL,
 record_id uuid,
 action_id text NOT NULL,
 credential_id uuid NOT NULL,
 payload_ciphertext bytea NOT NULL,
 encryption_key_id text NOT NULL,
 request_key uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'queued'
  CHECK(status IN ('queued','sending','completed','failed')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 completed_at timestamptz,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,user_id,request_key),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_quick_action_email_jobs_queue
 ON md_quick_action_email_jobs(status,created_at,id) WHERE status='queued';

CREATE TABLE IF NOT EXISTS md_email_alert_details (
 tenant_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'email-alerts' CHECK(kind='email-alerts'),
 alert_api_name text NOT NULL,
 object_api text NOT NULL,
 credential_id uuid NOT NULL,
 from_email text NOT NULL,
 recipients text NOT NULL,
 subject text NOT NULL,
 body text NOT NULL,
 PRIMARY KEY(tenant_id,alert_api_name),
 FOREIGN KEY(tenant_id,kind,alert_api_name)
  REFERENCES md_system_definitions(tenant_id,kind,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);

-- Tenant-level settings persisted independently from Core metadata.
CREATE TABLE IF NOT EXISTS md_tenant_settings (tenant_id uuid NOT NULL REFERENCES md_tenants(id), setting_key text NOT NULL CHECK (setting_key IN ('company-profile','currencies','automation-settings','business-calendar','offline-briefcase')), properties jsonb NOT NULL CHECK (jsonb_typeof(properties)='object'),revision integer NOT NULL DEFAULT 1 CHECK (revision>0),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,setting_key));
CREATE TABLE IF NOT EXISTS md_metadata_package_installations(tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,package_api text NOT NULL,label text NOT NULL,package_type text NOT NULL CHECK(package_type IN ('Managed','Unlocked')),version integer NOT NULL CHECK(version>0),digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),active boolean NOT NULL DEFAULT true,installed_by uuid NOT NULL REFERENCES md_users(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,package_api));
CREATE TABLE IF NOT EXISTS md_metadata_package_versions(tenant_id uuid NOT NULL,package_api text NOT NULL,version integer NOT NULL CHECK(version>0),digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),installed_by uuid NOT NULL,installed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,package_api,version),FOREIGN KEY(tenant_id,package_api) REFERENCES md_metadata_package_installations(tenant_id,package_api) ON DELETE CASCADE,FOREIGN KEY(tenant_id,installed_by) REFERENCES md_users(tenant_id,id));
CREATE TABLE IF NOT EXISTS md_metadata_package_components(tenant_id uuid NOT NULL,package_api text NOT NULL,component_type text NOT NULL CHECK(component_type IN ('object','page','component')),component_api text NOT NULL,component_state text NOT NULL DEFAULT 'Active' CHECK(component_state IN ('Active','Disabled','Retained')),component_digest text NOT NULL CHECK(component_digest ~ '^[0-9a-f]{64}$'),PRIMARY KEY(tenant_id,package_api,component_type,component_api),FOREIGN KEY(tenant_id,package_api) REFERENCES md_metadata_package_installations(tenant_id,package_api) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS md_tenant_automation_settings (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id) ON DELETE CASCADE,
 flow_service_user_id uuid,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,flow_service_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,updated_by) REFERENCES md_users(tenant_id,id)
);

-- Fresh-install tenant lifecycle fields mirror the additive migration.
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED'));
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS retention_until timestamptz;
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS md_tenant_lifecycle_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_tenant_id uuid NOT NULL REFERENCES md_tenants(id),actor_user_id uuid NOT NULL,target_tenant_id uuid NOT NULL REFERENCES md_tenants(id),operation text NOT NULL,previous_status text NOT NULL,new_status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(actor_tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id));
CREATE INDEX IF NOT EXISTS md_tenant_lifecycle_audit_target ON md_tenant_lifecycle_audit(target_tenant_id,created_at DESC);

ALTER TABLE md_users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS landing_app_api text NOT NULL DEFAULT 'Setup';
CREATE TABLE IF NOT EXISTS md_tenant_provisioning_requests (actor_tenant_id uuid NOT NULL REFERENCES md_tenants(id),actor_user_id uuid NOT NULL,request_key uuid NOT NULL,request_digest text NOT NULL,target_tenant_id uuid NOT NULL REFERENCES md_tenants(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_tenant_id,actor_user_id,request_key),FOREIGN KEY(actor_tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id));

-- Versioned, tenant-bound route aliases for installed apps.
CREATE TABLE IF NOT EXISTS md_app_route_aliases (tenant_id uuid NOT NULL REFERENCES md_tenants(id), app_api text NOT NULL REFERENCES md_apps(api_name), slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'), kind text NOT NULL CHECK (kind IN ('App Home','App Page','Record List')), target_api text NOT NULL, status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Disabled')), version integer NOT NULL DEFAULT 1 CHECK (version>=1), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,app_api,slug));

-- Fresh installs use the same durable notification structure as additive migrations.
CREATE TABLE IF NOT EXISTS md_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 recipient_id uuid NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '',
 flow_api_name text NOT NULL DEFAULT '', sent_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz, FOREIGN KEY(tenant_id,recipient_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,sent_by) REFERENCES md_users(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_notifications_inbox ON md_notifications(tenant_id,recipient_id,created_at DESC);

-- Tenant-safe durable approval requests. Decisions are atomic and auditable.
CREATE TABLE IF NOT EXISTS md_approval_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 group_id uuid NOT NULL DEFAULT gen_random_uuid(),
 object_api text NOT NULL,
 object_label text NOT NULL,
 record_id uuid NOT NULL,
 record_name text NOT NULL,
 flow_api_name text NOT NULL,
 submitted_by uuid NOT NULL,
 approver_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Canceled')),
 comments text NOT NULL DEFAULT '',
 decision_comments text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api),
 FOREIGN KEY(tenant_id,submitted_by) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,approver_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,decided_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_approval_requests_inbox ON md_approval_requests(tenant_id,approver_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS md_flow_approval_stages (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 element_id integer NOT NULL CHECK(element_id > 0),
 group_id uuid NOT NULL,
 rule text NOT NULL CHECK(rule IN ('ANY','ALL')),
 status text NOT NULL DEFAULT 'waiting'
  CHECK(status IN ('waiting','Approved','Rejected','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY(tenant_id,run_id,element_id),
 UNIQUE(tenant_id,group_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_flow_approval_stages_pending
 ON md_flow_approval_stages(tenant_id,run_id,status) WHERE status='waiting';


ALTER TABLE md_records ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS md_record_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 object_api text NOT NULL,record_id uuid NOT NULL,created_by uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('Task','Call','Event')),subject text NOT NULL,
 description text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Completed')),
 due_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_activities_record ON md_record_activities(tenant_id,object_api,record_id,created_at DESC);
CREATE TABLE IF NOT EXISTS md_record_chatter_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 object_api text NOT NULL,record_id uuid NOT NULL,created_by uuid NOT NULL,
 body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_chatter_record ON md_record_chatter_posts(tenant_id,object_api,record_id,created_at DESC);
CREATE TABLE IF NOT EXISTS md_record_chatter_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 post_id uuid NOT NULL,created_by uuid NOT NULL,body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,post_id) REFERENCES md_record_chatter_posts(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_chatter_comments_post ON md_record_chatter_comments(tenant_id,post_id,created_at);

CREATE TABLE IF NOT EXISTS md_password_recovery_settings (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 smtp_credential_id uuid,
 from_email text NOT NULL DEFAULT '',
 policy jsonb NOT NULL DEFAULT '{"method":"OTP","defaultChannel":"email","allowedChannels":["email"]}'::jsonb
   CHECK (jsonb_typeof(policy)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,smtp_credential_id) REFERENCES md_named_credentials(tenant_id,id)
);

-- Tenant-scoped relational Page Layout metadata. No prior layouts or records are changed.
CREATE TABLE IF NOT EXISTS md_object_layout_versions (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,object_api),
  FOREIGN KEY (tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layouts (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL CHECK (length(layout_id) BETWEEN 1 AND 128),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id),
  FOREIGN KEY (tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_sections (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL,
  section_id text NOT NULL CHECK (length(section_id) BETWEEN 1 AND 128),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  columns smallint NOT NULL CHECK (columns IN (1,2)),
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id,section_id),
  FOREIGN KEY (tenant_id,object_api,layout_id) REFERENCES md_object_page_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_fields (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL,
  section_id text NOT NULL,
  field_api text NOT NULL,
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id,section_id,field_api),
  FOREIGN KEY (tenant_id,object_api,layout_id,section_id) REFERENCES md_object_page_layout_sections(tenant_id,object_api,layout_id,section_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,object_api,field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_actions (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL,
  action_name text NOT NULL CHECK (length(action_name) BETWEEN 1 AND 128),
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id,action_name),
  FOREIGN KEY (tenant_id,object_api,layout_id) REFERENCES md_object_page_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_related_lists (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL,
  list_name text NOT NULL CHECK (length(list_name) BETWEEN 1 AND 128),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object'),
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id,list_name),
  FOREIGN KEY (tenant_id,object_api,layout_id) REFERENCES md_object_page_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_links (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  layout_id text NOT NULL,
  link_id text NOT NULL CHECK (length(link_id) BETWEEN 1 AND 128),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  url text NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  open_in_new_window boolean NOT NULL DEFAULT false,
  visible_when_field text,
  visible_when_value text,
  CONSTRAINT md_record_link_visibility_pair CHECK (
    (visible_when_field IS NULL AND visible_when_value IS NULL)
    OR (visible_when_field ~ '^[A-Za-z][A-Za-z0-9_]*$'
      AND visible_when_value IS NOT NULL AND length(visible_when_value)<=256)),
  sort_order integer NOT NULL,
  PRIMARY KEY (tenant_id,object_api,layout_id,link_id),
  FOREIGN KEY (tenant_id,object_api,layout_id) REFERENCES md_object_page_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_page_layout_assignments (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  profile_id text NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 128),
  record_type_id text NOT NULL CHECK (length(record_type_id) BETWEEN 1 AND 128),
  layout_id text NOT NULL,
  PRIMARY KEY (tenant_id,object_api,profile_id,record_type_id),
  FOREIGN KEY (tenant_id,object_api,layout_id) REFERENCES md_object_page_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_object_page_layout_fields_lookup ON md_object_page_layout_fields(tenant_id,object_api,layout_id);


-- Idempotent backfill: add a default only where the object has no Page Layout.
-- Never overwrite or replace tenant-owned configurations.
INSERT INTO md_object_page_layouts(tenant_id,object_api,layout_id,label,sort_order)
SELECT o.tenant_id,o.api_name,'default',o.label||' Layout',0
FROM md_object_definitions o WHERE NOT EXISTS (
 SELECT 1 FROM md_object_page_layouts l
 WHERE l.tenant_id=o.tenant_id AND l.object_api=o.api_name
) ON CONFLICT DO NOTHING;
INSERT INTO md_object_page_layout_sections(tenant_id,object_api,layout_id,section_id,label,columns,sort_order)
SELECT l.tenant_id,l.object_api,l.layout_id,'details','Record Information',2,0
FROM md_object_page_layouts l
WHERE l.layout_id='default' AND NOT EXISTS (
 SELECT 1 FROM md_object_page_layout_sections s
 WHERE s.tenant_id=l.tenant_id AND s.object_api=l.object_api AND s.layout_id=l.layout_id
) ON CONFLICT DO NOTHING;
INSERT INTO md_object_page_layout_fields(tenant_id,object_api,layout_id,section_id,field_api,sort_order)
SELECT s.tenant_id,s.object_api,s.layout_id,s.section_id,f.api_name,
 row_number() OVER (PARTITION BY s.tenant_id,s.object_api,s.layout_id,s.section_id ORDER BY f.api_name)-1
FROM md_object_page_layout_sections s JOIN md_field_definitions f
 ON f.tenant_id=s.tenant_id AND f.object_api=s.object_api
WHERE s.layout_id='default' AND s.section_id='details'
AND NOT EXISTS (
 SELECT 1 FROM md_object_page_layout_fields pf
 WHERE pf.tenant_id=s.tenant_id AND pf.object_api=s.object_api AND pf.layout_id=s.layout_id
) ON CONFLICT DO NOTHING;
INSERT INTO md_object_page_layout_actions(tenant_id,object_api,layout_id,action_name,sort_order)
SELECT l.tenant_id,l.object_api,l.layout_id,a.action_name,a.sort_order
FROM md_object_page_layouts l
CROSS JOIN (VALUES ('New',0),('Edit',1),('Delete',2)) AS a(action_name,sort_order)
WHERE l.layout_id='default' AND NOT EXISTS (
 SELECT 1 FROM md_object_page_layout_actions x
 WHERE x.tenant_id=l.tenant_id AND x.object_api=l.object_api AND x.layout_id=l.layout_id
) ON CONFLICT DO NOTHING;

-- Normalized, tenant-scoped Lightning Page definition, component tree and activation.
-- Existing app seed pages are retained; no JSON/JSONB storage.
CREATE TABLE IF NOT EXISTS md_lightning_page_details (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 page_type text NOT NULL CHECK(page_type IN ('Record Page','App Page','Home Page','In-Screen Page','Print Template')),
 target_object text NOT NULL DEFAULT '',
 layout_mode text NOT NULL CHECK(layout_mode IN ('template','free-canvas')),
 template text,
 canvas_width integer NOT NULL CHECK(canvas_width BETWEEN 320 AND 10000),
 canvas_height integer NOT NULL CHECK(canvas_height BETWEEN 320 AND 10000),
 status text NOT NULL CHECK(status IN ('Draft','Active')),
 devices text[] NOT NULL CHECK(cardinality(devices) BETWEEN 1 AND 2),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,page_id),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_lightning_page_nodes (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 component_key text NOT NULL CHECK(length(component_key) BETWEEN 1 AND 128),
 component_type text NOT NULL CHECK(length(component_type) BETWEEN 1 AND 128),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 region text NOT NULL DEFAULT 'main',
 visible boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,page_id,component_key),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_lightning_page_node_properties (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 component_key text NOT NULL,
 property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
 value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null','array','object')),
 value_text text,
 PRIMARY KEY(tenant_id,page_id,component_key,property_path),
 FOREIGN KEY(tenant_id,page_id,component_key)
   REFERENCES md_lightning_page_nodes(tenant_id,page_id,component_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_lightning_page_activation (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 assignment_id text NOT NULL CHECK(length(assignment_id) BETWEEN 1 AND 128),
 scope text NOT NULL CHECK(scope IN ('Org Default','App Default','App and Profile','App, Record Type, and Profile')),
 app_api text, profile_id text, record_type_id text,
 desktop boolean NOT NULL DEFAULT true,
 phone boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,page_id,assignment_id),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE,
 CHECK(desktop OR phone)
);
CREATE INDEX IF NOT EXISTS md_lightning_page_active_lookup
 ON md_lightning_page_details(tenant_id,target_object,page_type,status);


-- Independent, immutable, tenant-scoped Page Builder revisions. Existing published pages remain unchanged.
-- The four layout identities share their page_id, Flows, permissions and activation assignments.
CREATE TABLE IF NOT EXISTS md_page_layout_versions (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 variant text NOT NULL CHECK(variant IN ('Mobile','Desktop','Tablet','Custom')),
 version integer NOT NULL CHECK(version>0),
 page_label text NOT NULL CHECK(length(page_label) BETWEEN 1 AND 200),
 layout_mode text NOT NULL CHECK(layout_mode IN ('template','free-canvas')),
 template text,
 canvas_width integer NOT NULL CHECK(canvas_width BETWEEN 320 AND 10000),
 canvas_height integer NOT NULL CHECK(canvas_height BETWEEN 320 AND 10000),
 inherits_desktop boolean NOT NULL DEFAULT false,
 canvas_fill_override boolean NOT NULL DEFAULT false,
 desktop_base_version integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,page_id,variant,version),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_page_layout_heads (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL,
 variant text NOT NULL CHECK(variant IN ('Mobile','Desktop','Tablet','Custom')),
 draft_version integer,
 published_version integer,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,page_id,variant),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,page_id,variant,draft_version) REFERENCES md_page_layout_versions(tenant_id,page_id,variant,version),
 FOREIGN KEY(tenant_id,page_id,variant,published_version) REFERENCES md_page_layout_versions(tenant_id,page_id,variant,version)
);
CREATE TABLE IF NOT EXISTS md_page_layout_version_nodes (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL, variant text NOT NULL,
 version integer NOT NULL,
 component_key text NOT NULL CHECK(length(component_key) BETWEEN 1 AND 128),
 component_type text NOT NULL CHECK(length(component_type) BETWEEN 1 AND 128),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 region text NOT NULL DEFAULT 'main',
 visible boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,page_id,variant,version,component_key),
 FOREIGN KEY(tenant_id,page_id,variant,version)
  REFERENCES md_page_layout_versions(tenant_id,page_id,variant,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_page_layout_version_properties (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL, variant text NOT NULL,
 version integer NOT NULL, component_key text NOT NULL,
 property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
 value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null','array','object')),
 value_text text,
 PRIMARY KEY(tenant_id,page_id,variant,version,component_key,property_path),
 FOREIGN KEY(tenant_id,page_id,variant,version,component_key)
  REFERENCES md_page_layout_version_nodes(tenant_id,page_id,variant,version,component_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_page_layout_version_activation (
 tenant_id uuid NOT NULL, page_id uuid NOT NULL, variant text NOT NULL,
 version integer NOT NULL,
 assignment_id text NOT NULL CHECK(length(assignment_id) BETWEEN 1 AND 128),
 scope text NOT NULL CHECK(scope IN ('Org Default','App Default','App and Profile','App, Record Type, and Profile')),
 app_api text, profile_id text, record_type_id text,
 desktop boolean NOT NULL DEFAULT true,
 phone boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,page_id,variant,version,assignment_id),
 FOREIGN KEY(tenant_id,page_id,variant,version)
  REFERENCES md_page_layout_versions(tenant_id,page_id,variant,version) ON DELETE CASCADE,
 CHECK(desktop OR phone)
);
CREATE INDEX IF NOT EXISTS md_page_layout_history ON md_page_layout_versions(tenant_id,page_id,variant,version DESC);


CREATE TABLE IF NOT EXISTS md_page_layout_audit (
 tenant_id uuid NOT NULL,
 page_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,
 variant text NOT NULL CHECK(variant IN ('Mobile','Desktop','Tablet','Custom')),
 version integer NOT NULL CHECK(version>0),
 operation text NOT NULL CHECK(operation IN ('SaveDraft','Publish','RestoreDraft')),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_page_layout_audit_tenant_page
 ON md_page_layout_audit(tenant_id,page_id,occurred_at DESC);

-- Explicit tenant profiles and grants. Permission evaluation continues to use the shared SQL RBAC engine.
CREATE TABLE IF NOT EXISTS md_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 api_name text NOT NULL,
 label text NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_user_profiles (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,profile_id) REFERENCES md_profiles(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_profile_permission_sets (
 tenant_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 permission_set_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,profile_id,permission_set_id),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES md_profiles(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id) ON DELETE CASCADE
);
INSERT INTO md_profiles(tenant_id,api_name,label)
 SELECT id,'Default','Default Profile' FROM md_tenants
 ON CONFLICT(tenant_id,api_name) DO NOTHING;
INSERT INTO md_user_profiles(tenant_id,user_id,profile_id)
 SELECT u.tenant_id,u.id,p.id FROM md_users u
 JOIN md_profiles p ON p.tenant_id=u.tenant_id AND p.api_name='Default'
 ON CONFLICT(tenant_id,user_id) DO NOTHING;


-- Record types and allowed picklist values are object-scoped relational rows.
CREATE TABLE IF NOT EXISTS md_object_record_types (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 record_type_id text NOT NULL CHECK(length(record_type_id) BETWEEN 1 AND 128),
 developer_name text NOT NULL,
 label text NOT NULL,
 description text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 is_default boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,object_api,record_type_id),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_record_type_values (
 tenant_id uuid NOT NULL,object_api text NOT NULL,record_type_id text NOT NULL,
 field_api text NOT NULL,field_value text NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,object_api,record_type_id,field_api,field_value),
 FOREIGN KEY(tenant_id,object_api,record_type_id)
  REFERENCES md_object_record_types(tenant_id,object_api,record_type_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS record_type_id text;
INSERT INTO md_object_record_types(tenant_id,object_api,record_type_id,developer_name,label,active,is_default,sort_order)
 SELECT o.tenant_id,o.api_name,'master','Master','Master',true,true,0
 FROM md_object_definitions o WHERE NOT EXISTS(
  SELECT 1 FROM md_object_record_types r WHERE r.tenant_id=o.tenant_id AND r.object_api=o.api_name
 ) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS md_security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 actor_user_id uuid NOT NULL,
 action text NOT NULL,
 subject_user_id uuid,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,subject_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_security_events_tenant_created ON md_security_events(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS md_record_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 record_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 changed_by uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 old_value text,
 new_value text,
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,changed_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_history_lookup ON md_record_history(tenant_id,object_api,record_id,changed_at DESC);

-- Extended scalar field metadata stays fully relational and tenant-scoped.
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS picklist_restricted boolean NOT NULL DEFAULT true;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS is_unique boolean NOT NULL DEFAULT false;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS external_id boolean NOT NULL DEFAULT false;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS case_sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS help_text text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS precision integer CHECK (precision BETWEEN 1 AND 38);
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS scale integer CHECK (scale BETWEEN 0 AND 38);
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS default_value text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS relationship_type text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS formula_expression text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS formula_return_type text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS auto_number_format text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS relationship_name text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS child_relationship_name text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS delete_behavior text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS allow_reparenting boolean NOT NULL DEFAULT false;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_child_object text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_relationship_field text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_operation text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_source_field text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_filter_logic text NOT NULL DEFAULT 'All'
  CHECK(rollup_filter_logic IN ('All','Any'));
CREATE TABLE IF NOT EXISTS md_field_rollup_filters (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  child_object text NOT NULL,
  rollup_field_api text NOT NULL,
  filter_field_api text NOT NULL,
  operator text NOT NULL CHECK(operator IN
    ('Equals','Not Equal To','Greater Than','Less Than','Contains','Is Null','Is Not Null')),
  value_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL CHECK(sort_order>=0),
  PRIMARY KEY(tenant_id,object_api,rollup_field_api,sort_order),
  FOREIGN KEY(tenant_id,object_api,rollup_field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,child_object,filter_field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_field_rollup_filters_lookup
  ON md_field_rollup_filters(tenant_id,object_api,rollup_field_api,sort_order);
CREATE INDEX IF NOT EXISTS md_field_definitions_recycle_bin
  ON md_field_definitions(tenant_id,deleted_at) WHERE deleted_at IS NOT NULL;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS is_unique boolean NOT NULL DEFAULT false;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS case_sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS geo_latitude double precision;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS geo_longitude double precision;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_postal_code text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_country text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS record_is_deleted boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS md_record_values_unique_ci
  ON md_record_values(tenant_id,object_api,field_api,lower(value_text))
  WHERE is_unique AND NOT case_sensitive AND value_text IS NOT NULL AND record_is_deleted=false;
CREATE UNIQUE INDEX IF NOT EXISTS md_record_values_unique_cs
  ON md_record_values(tenant_id,object_api,field_api,value_text)
  WHERE is_unique AND case_sensitive AND value_text IS NOT NULL AND record_is_deleted=false;
-- Field lookups remain indexed even when External ID is not Unique.
CREATE INDEX IF NOT EXISTS md_record_values_lookup_ci
 ON md_record_values(tenant_id,object_api,field_api,lower(value_text))
 WHERE value_text IS NOT NULL AND record_is_deleted=false;
CREATE INDEX IF NOT EXISTS md_record_values_lookup_cs
 ON md_record_values(tenant_id,object_api,field_api,value_text)
 WHERE value_text IS NOT NULL AND record_is_deleted=false;
CREATE TABLE IF NOT EXISTS md_record_multi_values (
  tenant_id uuid NOT NULL,
  record_id uuid NOT NULL,
  object_api text NOT NULL,
  field_api text NOT NULL,
  value text NOT NULL CHECK(length(value) BETWEEN 1 AND 512),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  PRIMARY KEY(tenant_id,record_id,field_api,value),
  FOREIGN KEY(tenant_id,record_id,object_api)
    REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_record_multi_values_lookup
  ON md_record_multi_values(tenant_id,object_api,field_api,value,record_id);
CREATE TABLE IF NOT EXISTS md_auto_number_counters (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  object_api text NOT NULL,
  field_api text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value > 0),
  PRIMARY KEY(tenant_id,object_api,field_api),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_field_picklist_values (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  field_api text NOT NULL,
  value text NOT NULL CHECK(length(value) BETWEEN 1 AND 512),
  sort_order integer NOT NULL,
  PRIMARY KEY(tenant_id,object_api,field_api,value),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_field_picklist_values_order
  ON md_field_picklist_values(tenant_id,object_api,field_api,sort_order);
CREATE TABLE IF NOT EXISTS md_field_dependencies (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  field_api text NOT NULL,
  controller_field_api text NOT NULL,
  PRIMARY KEY(tenant_id,object_api,field_api),
  CHECK(field_api<>controller_field_api),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,object_api,controller_field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_field_dependency_values (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  field_api text NOT NULL,
  controller_value text NOT NULL CHECK(length(controller_value) BETWEEN 1 AND 512),
  picklist_value text NOT NULL CHECK(length(picklist_value) BETWEEN 1 AND 512),
  PRIMARY KEY(tenant_id,object_api,field_api,controller_value,picklist_value),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_dependencies(tenant_id,object_api,field_api) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_field_dependency_values_lookup
  ON md_field_dependency_values(tenant_id,object_api,field_api,controller_value);

CREATE TABLE IF NOT EXISTS md_record_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  object_api text NOT NULL,
  record_id uuid NOT NULL,
  field_api text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/gif','image/webp')),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(octet_length(content)=byte_size),
  FOREIGN KEY(tenant_id,record_id,object_api)
    REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_files_record_field
  ON md_record_files(tenant_id,object_api,record_id,field_api,created_at);

-- Additive, tenant-scoped Builder metadata. No business records or existing app installations are removed.
-- General metadata values use relational path/value rows shared with the Component and Page engines.
CREATE TABLE IF NOT EXISTS md_flow_editor_values (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 flow_id uuid NOT NULL,
 property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
 value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null','array','object')),
 value_text text,
 PRIMARY KEY(tenant_id,flow_id,property_path),
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_trigger_subscriptions (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 flow_id uuid NOT NULL,
 flow_type text NOT NULL CHECK(flow_type IN (
  'Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow')),
 trigger_key text NOT NULL CHECK(length(trigger_key) BETWEEN 1 AND 255),
 app_api_name text,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,flow_id),
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_flow_trigger_subscriptions_dispatch
 ON md_flow_trigger_subscriptions(tenant_id,flow_type,trigger_key,flow_id) WHERE active=true;
CREATE TABLE IF NOT EXISTS md_platform_event_messages (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 replay_id bigserial NOT NULL,
 event_api_name text NOT NULL,
 published_by uuid NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','queued','completed','failed')),
 idempotency_key text,
 error_code text,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,published_by) REFERENCES md_users(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS md_platform_event_messages_replay
 ON md_platform_event_messages(tenant_id,replay_id);
CREATE UNIQUE INDEX IF NOT EXISTS md_platform_event_messages_idempotency
 ON md_platform_event_messages(tenant_id,event_api_name,idempotency_key)
 WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_platform_event_messages_pending
 ON md_platform_event_messages(tenant_id,published_at,id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS md_platform_event_values (
 tenant_id uuid NOT NULL,
 event_id uuid NOT NULL,
 field_api text NOT NULL,
 value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null')),
 value_text text,
 PRIMARY KEY(tenant_id,event_id,field_api),
 FOREIGN KEY(tenant_id,event_id) REFERENCES md_platform_event_messages(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_platform_event_deliveries (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL,
 flow_id uuid NOT NULL,
 flow_version integer NOT NULL CHECK(flow_version>0),
 actor_user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','completed','failed')),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,event_id,flow_id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES md_platform_event_messages(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_platform_event_deliveries_queue
 ON md_platform_event_deliveries(tenant_id,status,created_at,id) WHERE status='queued';
CREATE TABLE IF NOT EXISTS md_webhook_subscriptions (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 api_name text NOT NULL,
 event_api_name text NOT NULL,
 credential_id uuid NOT NULL,
 relative_path text NOT NULL,
 start_replay_id bigint NOT NULL CHECK(start_replay_id>=1),
 enabled boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,api_name),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_webhook_subscriptions_event
 ON md_webhook_subscriptions(tenant_id,event_api_name,start_replay_id) WHERE enabled=true;
CREATE TABLE IF NOT EXISTS md_webhook_deliveries (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL,
 event_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','delivered','failed')),
 response_status integer,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,subscription_id,event_id),
 FOREIGN KEY(tenant_id,subscription_id) REFERENCES md_webhook_subscriptions(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES md_platform_event_messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_webhook_deliveries_queue
 ON md_webhook_deliveries(tenant_id,status,created_at,id) WHERE status='queued';
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS md_flow_definitions_latest
 ON md_flow_definitions(tenant_id,api_name,version DESC) WHERE archived=false;
CREATE UNIQUE INDEX IF NOT EXISTS md_flow_definitions_one_active_version
 ON md_flow_definitions(tenant_id,api_name) WHERE active=true;
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS system_context_approved_by uuid;
ALTER TABLE md_flow_definitions DROP CONSTRAINT IF EXISTS md_flow_definitions_system_context_approved_by_fkey;
ALTER TABLE md_flow_definitions ADD CONSTRAINT md_flow_definitions_system_context_approved_by_fkey
 FOREIGN KEY(tenant_id,system_context_approved_by) REFERENCES md_users(tenant_id,id);
ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS initiated_by uuid;
UPDATE md_flow_runs SET initiated_by=started_by WHERE initiated_by IS NULL;
ALTER TABLE md_flow_runs ALTER COLUMN initiated_by SET NOT NULL;
ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS execution_context text NOT NULL DEFAULT 'User';
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_execution_context_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_execution_context_check
 CHECK(execution_context IN ('User','System'));
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_initiated_by_fkey;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_initiated_by_fkey
 FOREIGN KEY(tenant_id,initiated_by) REFERENCES md_users(tenant_id,id);
CREATE TABLE IF NOT EXISTS md_flow_execution_audit (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 flow_id uuid NOT NULL,
 run_id uuid,
 actor_user_id uuid NOT NULL,
 initiating_user_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('system-context-approved','system-context-run')),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,flow_id) REFERENCES md_flow_definitions(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,initiating_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_flow_execution_audit_lookup
 ON md_flow_execution_audit(tenant_id,flow_id,occurred_at DESC);

-- Tenant-owned custom application definitions have independent public API names.
-- md_apps remains the global licensed catalog with an internal unique identity.
ALTER TABLE md_apps ADD COLUMN IF NOT EXISTS tenant_owner_id uuid REFERENCES md_tenants(id);
CREATE TABLE IF NOT EXISTS md_tenant_app_metadata (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_id uuid NOT NULL REFERENCES md_apps(id),
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '',
 brand_color text NOT NULL DEFAULT '#2563eb',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,app_id),
 UNIQUE(tenant_id,api_name),
 FOREIGN KEY(app_id) REFERENCES md_apps(id)
);
CREATE TABLE IF NOT EXISTS md_tenant_app_navigation (
 tenant_id uuid NOT NULL,
 app_id uuid NOT NULL,
 entry_type text NOT NULL CHECK(entry_type IN ('Object','App Page')),
 api_name text NOT NULL,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,app_id,entry_type,api_name),
 FOREIGN KEY(tenant_id,app_id) REFERENCES md_tenant_app_metadata(tenant_id,app_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_tenant_app_utilities (
 tenant_id uuid NOT NULL, app_id uuid NOT NULL,
 utility_name text NOT NULL CHECK(utility_name IN ('Notes','History')),
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,app_id,utility_name),
 FOREIGN KEY(tenant_id,app_id) REFERENCES md_tenant_app_metadata(tenant_id,app_id) ON DELETE CASCADE
);

-- Durable tenant-isolated Screen Flow cursor and typed values. No JSON/JSONB.
CREATE TABLE IF NOT EXISTS md_flow_interview_state (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 current_element integer NOT NULL,
 history_elements integer[] NOT NULL DEFAULT '{}',
 step_count integer NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 200),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,run_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_interview_values (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 value_text text,
 data_type text NOT NULL CHECK(data_type IN ('string','number','boolean','null')),
 PRIMARY KEY(tenant_id,run_id,api_name),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_interview_state(tenant_id,run_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_interview_records (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^(\$[A-Za-z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*)$'),
 object_api text NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 199),
 record_id uuid,
 is_collection boolean NOT NULL,
 PRIMARY KEY(tenant_id,run_id,api_name,sort_order),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_interview_state(tenant_id,run_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_interview_record_fields (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 api_name text NOT NULL,
 sort_order integer NOT NULL,
 field_api text NOT NULL CHECK(field_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 value_text text,
 data_type text NOT NULL CHECK(data_type IN ('string','number','boolean','null')),
 PRIMARY KEY(tenant_id,run_id,api_name,sort_order,field_api),
 FOREIGN KEY(tenant_id,run_id,api_name,sort_order)
   REFERENCES md_flow_interview_records(tenant_id,run_id,api_name,sort_order) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_flow_interview_loop_state (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 element_id integer NOT NULL,
 next_index integer NOT NULL CHECK(next_index BETWEEN -1 AND 200),
 PRIMARY KEY(tenant_id,run_id,element_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_interview_state(tenant_id,run_id) ON DELETE CASCADE
);

-- Durable tenant-scoped asynchronous Flow HTTP Callouts.
CREATE TABLE IF NOT EXISTS md_http_callout_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 node_id integer NOT NULL,
 user_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 connection_api text,
 operation_api text,
 operation_path_ciphertext bytea,
 method text NOT NULL CHECK(method IN ('GET','POST','PUT','PATCH','DELETE')),
 path_ciphertext bytea NOT NULL,
 headers_ciphertext bytea NOT NULL,
 body_ciphertext bytea,
 idempotency_key_ciphertext bytea,
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 5),
 timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 30000),
 status text NOT NULL DEFAULT 'queued'
  CHECK(status IN ('queued','processing','retrying','completed','failed')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id),
 CONSTRAINT md_http_callout_provider_pair CHECK ((connection_api IS NULL AND operation_api IS NULL AND operation_path_ciphertext IS NULL)
   OR (connection_api ~ '^[A-Za-z][A-Za-z0-9_]*$' AND operation_api ~ '^[A-Za-z][A-Za-z0-9_]*$'
   AND operation_path_ciphertext IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS md_http_callout_jobs_ready
 ON md_http_callout_jobs(status,next_attempt_at,created_at);
CREATE TABLE IF NOT EXISTS md_http_callout_job_values (
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_.]*$'),
 value_ciphertext bytea NOT NULL,
 data_type text NOT NULL CHECK(data_type IN ('string','number','boolean','null')),
 PRIMARY KEY(tenant_id,job_id,api_name),
 FOREIGN KEY(tenant_id,job_id)
  REFERENCES md_http_callout_jobs(tenant_id,id) ON DELETE CASCADE
);

-- Additive relational RBAC administration. Existing grants, links and records are retained.
ALTER TABLE md_permission_sets ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE md_permission_sets ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE md_permission_sets ADD COLUMN IF NOT EXISTS license text NOT NULL DEFAULT '';
ALTER TABLE md_permission_sets ADD COLUMN IF NOT EXISTS navigation_default_access text NOT NULL DEFAULT 'Deny'
 CHECK(navigation_default_access IN ('Allow','Deny'));
ALTER TABLE md_profiles ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE md_profiles ADD COLUMN IF NOT EXISTS license text NOT NULL DEFAULT 'MetaDrive';
ALTER TABLE md_profiles ADD COLUMN IF NOT EXISTS is_standard boolean NOT NULL DEFAULT false;
-- A profile's editable rules live in an ordinary permission set, using the existing evaluator.
ALTER TABLE md_profiles ADD COLUMN IF NOT EXISTS editor_set_id uuid;
ALTER TABLE md_profiles DROP CONSTRAINT IF EXISTS md_profiles_editor_set_fk;
ALTER TABLE md_profiles ADD CONSTRAINT md_profiles_editor_set_fk
 FOREIGN KEY(tenant_id,editor_set_id) REFERENCES md_permission_sets(tenant_id,id);
CREATE TABLE IF NOT EXISTS md_rbac_revisions (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id), revision integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS md_permission_set_groups (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL DEFAULT gen_random_uuid(),
 api_name text NOT NULL,label text NOT NULL,description text NOT NULL DEFAULT '',calculated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_permission_group_sets (
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,permission_set_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,group_id,permission_set_id),
 FOREIGN KEY(tenant_id,group_id) REFERENCES md_permission_set_groups(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_permission_group_mutes (
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,resource text NOT NULL,action text NOT NULL,
 PRIMARY KEY(tenant_id,group_id,resource,action),
 FOREIGN KEY(tenant_id,group_id) REFERENCES md_permission_set_groups(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_user_permission_groups (
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,group_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,user_id,group_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,group_id) REFERENCES md_permission_set_groups(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_access_groups (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('PublicGroup','Queue')),api_name text NOT NULL,label text NOT NULL,
 description text NOT NULL DEFAULT '',PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,kind,api_name)
);
CREATE TABLE IF NOT EXISTS md_access_group_members (
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,member_kind text NOT NULL
 CHECK(member_kind IN ('User','Role','RoleAndSubordinates','PublicGroup')),member_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,group_id,member_kind,member_id),
 FOREIGN KEY(tenant_id,group_id) REFERENCES md_access_groups(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_queue_objects (
 tenant_id uuid NOT NULL,queue_id uuid NOT NULL,object_api text NOT NULL,
 PRIMARY KEY(tenant_id,queue_id,object_api),
 FOREIGN KEY(tenant_id,queue_id) REFERENCES md_access_groups(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_sharing_settings (
 tenant_id uuid NOT NULL,object_api text NOT NULL,default_access text NOT NULL DEFAULT 'Private'
 CHECK(default_access IN ('Private','Public Read Only','Public Read/Write')),
 use_hierarchy boolean NOT NULL DEFAULT true,portal_enabled boolean NOT NULL DEFAULT false,portal_account_field text,
 PRIMARY KEY(tenant_id,object_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_record_policies (
 tenant_id uuid NOT NULL,id text NOT NULL,kind text NOT NULL CHECK(kind IN ('share','restriction')),
 object_api text NOT NULL,api_name text,label text,enabled boolean NOT NULL,
 rule_type text,condition_logic text NOT NULL CHECK(condition_logic IN ('all','any')),
 target_type text,target_id uuid,access_level text,subject_type text,subject_id uuid,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_policy_owner_roles (
 tenant_id uuid NOT NULL,policy_id text NOT NULL,role_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,policy_id,role_id),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES md_record_policies(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,role_id) REFERENCES md_roles(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_policy_conditions (
 tenant_id uuid NOT NULL,policy_id text NOT NULL,position integer NOT NULL,field_api text NOT NULL,
 operator text NOT NULL,value_type text NOT NULL DEFAULT 'undefined',
 PRIMARY KEY(tenant_id,policy_id,position),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES md_record_policies(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_policy_condition_values (
 tenant_id uuid NOT NULL,policy_id text NOT NULL,condition_position integer NOT NULL,position integer NOT NULL,
 value_text text,PRIMARY KEY(tenant_id,policy_id,condition_position,position),
 FOREIGN KEY(tenant_id,policy_id,condition_position) REFERENCES md_policy_conditions(tenant_id,policy_id,position) ON DELETE CASCADE
);
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-GB';
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS currency_iso_code text;
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT 'internal' CHECK(user_type IN ('internal','external'));
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS external_account_id uuid;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS owner_queue_id uuid;
ALTER TABLE md_records DROP CONSTRAINT IF EXISTS md_records_owner_queue_fk;
ALTER TABLE md_records ADD CONSTRAINT md_records_owner_queue_fk
 FOREIGN KEY(tenant_id,owner_queue_id) REFERENCES md_access_groups(tenant_id,id);
CREATE INDEX IF NOT EXISTS md_records_owner_lookup ON md_records(tenant_id,object_api,owner_id);
CREATE INDEX IF NOT EXISTS md_record_policies_lookup ON md_record_policies(tenant_id,object_api,kind) WHERE enabled;
CREATE INDEX IF NOT EXISTS md_access_members_lookup ON md_access_group_members(tenant_id,member_id);

-- One canonical decision function is shared by HTTP checks and SQL record filtering.
-- Group mutes suppress only group-contributed allows; an explicit deny always wins.
CREATE OR REPLACE FUNCTION md_rbac_decision(t uuid,u uuid,res text,act text)
RETURNS TABLE(allow_granted boolean,deny_granted boolean) LANGUAGE sql STABLE AS $$
 WITH assigned AS (
  SELECT permission_set_id,NULL::uuid AS group_id FROM md_permission_assignments WHERE tenant_id=t AND user_id=u
  UNION SELECT rp.permission_set_id,NULL::uuid FROM md_user_roles ur
   JOIN md_role_permission_sets rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
   WHERE ur.tenant_id=t AND ur.user_id=u
  UNION SELECT pp.permission_set_id,NULL::uuid FROM md_user_profiles up
   JOIN md_profile_permission_sets pp ON pp.tenant_id=up.tenant_id AND pp.profile_id=up.profile_id
   WHERE up.tenant_id=t AND up.user_id=u
  UNION SELECT gs.permission_set_id,ug.group_id FROM md_user_permission_groups ug
   JOIN md_permission_group_sets gs ON gs.tenant_id=ug.tenant_id AND gs.group_id=ug.group_id
   WHERE ug.tenant_id=t AND ug.user_id=u
 ), matched AS (
  SELECT r.effect,a.group_id FROM assigned a JOIN md_permission_rules r
   ON r.tenant_id=t AND r.permission_set_id=a.permission_set_id
   WHERE r.resource IN(res,'*',CASE WHEN res LIKE 'Flow:%' THEN 'Flow' ELSE res END)
   AND r.action IN(act,'*')
  UNION ALL
  SELECT 'allow',a.group_id FROM assigned a JOIN md_permission_sets p ON p.tenant_id=t AND p.id=a.permission_set_id
   WHERE act='read' AND (res LIKE 'App:%' OR res LIKE 'Tab:%') AND p.navigation_default_access='Allow'
 )
 SELECT COALESCE(bool_or(m.effect='allow' AND (m.group_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM md_permission_group_mutes gm WHERE gm.tenant_id=t AND gm.group_id=m.group_id
   AND gm.resource IN(res,'*',CASE WHEN res LIKE 'Flow:%' THEN 'Flow' ELSE res END) AND gm.action IN(act,'*')
 ))),false) AND EXISTS(SELECT 1 FROM md_users WHERE tenant_id=t AND id=u AND enabled AND (user_type='internal' OR (act='read' AND (EXISTS(SELECT 1 FROM md_object_definitions o WHERE o.tenant_id=t AND o.api_name=res) OR EXISTS(SELECT 1 FROM md_field_definitions f WHERE f.tenant_id=t AND f.object_api||'.'||f.api_name=res) OR res LIKE 'RecordType:%')))),
 COALESCE(bool_or(m.effect='deny'),false)
 FROM matched m
$$;
CREATE OR REPLACE FUNCTION md_rbac_allowed(t uuid,u uuid,res text,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT allow_granted AND NOT deny_granted FROM md_rbac_decision(t,u,res,act)
$$;

-- The actor's roles and ancestor roles. UNION terminates even with legacy cycles.
CREATE OR REPLACE FUNCTION md_user_role_tree(t uuid,u uuid)
RETURNS TABLE(role_id uuid) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE ancestors(id) AS (
  SELECT ur.role_id FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u
  UNION SELECT r.parent_role_id FROM ancestors a JOIN md_roles r ON r.tenant_id=t AND r.id=a.id WHERE r.parent_role_id IS NOT NULL
 ) SELECT id FROM ancestors
$$;
CREATE OR REPLACE FUNCTION md_access_member(t uuid,u uuid,g uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE groups(id) AS (
  SELECT id FROM md_access_groups WHERE tenant_id=t AND id=g
  UNION SELECT m.member_id FROM groups x JOIN md_access_group_members m
   ON m.tenant_id=t AND m.group_id=x.id AND m.member_kind='PublicGroup'
   JOIN md_access_groups nested ON nested.tenant_id=t AND nested.id=m.member_id AND nested.kind='PublicGroup'
 )
 SELECT EXISTS(SELECT 1 FROM groups x JOIN md_access_group_members m ON m.tenant_id=t AND m.group_id=x.id
  WHERE (m.member_kind='User' AND m.member_id=u)
   OR (m.member_kind='Role' AND EXISTS(SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=m.member_id))
   OR (m.member_kind='RoleAndSubordinates' AND m.member_id IN(SELECT role_id FROM md_user_role_tree(t,u))))
$$;
CREATE OR REPLACE FUNCTION md_record_field(t uuid,r uuid,f text)
RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE f WHEN 'Id' THEN rec.id::text WHEN 'OwnerId' THEN COALESCE(rec.owner_id,rec.owner_queue_id)::text
  WHEN 'RecordTypeId' THEN rec.record_type_id
  ELSE (SELECT COALESCE(v.reference_record_id::text,v.value_text) FROM md_record_values v
    WHERE v.tenant_id=t AND v.record_id=r AND v.field_api=f) END
 FROM md_records rec WHERE rec.tenant_id=t AND rec.id=r
$$;
CREATE OR REPLACE FUNCTION md_policy_matches(t uuid,p text,r uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH comparisons AS (
 SELECT CASE c.operator
  WHEN 'eq' THEN actual.value IS NOT DISTINCT FROM expected.value_text
  WHEN 'Equals' THEN actual.value IS NOT DISTINCT FROM expected.value_text
  WHEN 'ne' THEN actual.value IS DISTINCT FROM expected.value_text
  WHEN 'Not Equals' THEN actual.value IS DISTINCT FROM expected.value_text
  WHEN 'Contains' THEN position(expected.value_text IN actual.value)>0
  WHEN 'Starts With' THEN starts_with(actual.value,expected.value_text)
  WHEN 'Greater Than' THEN CASE WHEN actual.value ~ '^-?[0-9]+(\.[0-9]+)?$' AND expected.value_text ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN actual.value::numeric > expected.value_text::numeric ELSE false END
  WHEN 'Less Than' THEN CASE WHEN actual.value ~ '^-?[0-9]+(\.[0-9]+)?$' AND expected.value_text ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN actual.value::numeric < expected.value_text::numeric ELSE false END
  WHEN 'isNull' THEN actual.value IS NULL WHEN 'Is Null' THEN actual.value IS NULL
  WHEN 'notNull' THEN actual.value IS NOT NULL
  WHEN 'in' THEN EXISTS(SELECT 1 FROM md_policy_condition_values v WHERE v.tenant_id=t AND v.policy_id=p
     AND v.condition_position=c.position AND v.value_text IS NOT DISTINCT FROM actual.value)
  WHEN 'notIn' THEN NOT EXISTS(SELECT 1 FROM md_policy_condition_values v WHERE v.tenant_id=t AND v.policy_id=p
     AND v.condition_position=c.position AND v.value_text IS NOT DISTINCT FROM actual.value)
  ELSE false END AS ok
 FROM md_policy_conditions c
 CROSS JOIN LATERAL(SELECT md_record_field(t,r,c.field_api) AS value) actual
 LEFT JOIN md_policy_condition_values expected ON expected.tenant_id=t AND expected.policy_id=p
   AND expected.condition_position=c.position AND expected.position=0
 WHERE c.tenant_id=t AND c.policy_id=p
 )
 SELECT COALESCE(CASE WHEN policy.condition_logic='all' THEN (SELECT bool_and(COALESCE(ok,false)) FROM comparisons)
  ELSE (SELECT bool_or(COALESCE(ok,false)) FROM comparisons) END,false)
 FROM md_record_policies policy WHERE policy.tenant_id=t AND policy.id=p
$$;
-- Schema reconciliation must not downgrade the reporting-aware record policy
-- installed by additive system migrations in an existing tenant database.
DO $md_record_guard$
BEGIN
 IF to_regprocedure('md_effective_reporting_scope(uuid,uuid,text)') IS NULL THEN
  EXECUTE $md_legacy_record_definition$
CREATE OR REPLACE FUNCTION md_record_access(t uuid,u uuid,rid uuid,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
 SELECT
 -- Object/record denies and restrictions also narrow ownership and broad grants.
 (NOT rec.is_deleted OR act='delete')
 AND NOT (SELECT deny_granted FROM md_rbac_decision(t,u,'Record:'||rec.id::text,act))
 AND md_rbac_allowed(t,u,rec.object_api,act)
 AND (rec.record_type_id IS NULL OR md_rbac_allowed(t,u,'RecordType:'||rec.object_api||'.'||rec.record_type_id,'read'))
 AND NOT EXISTS(SELECT 1 FROM md_record_policies rp WHERE rp.tenant_id=t AND rp.object_api=rec.object_api
  AND rp.kind='restriction' AND rp.enabled
  AND (rp.subject_type='all' OR (rp.subject_type='external' AND usr.user_type='external')
   OR (rp.subject_type='user' AND rp.subject_id=u) OR (rp.subject_type='role' AND EXISTS(
    SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=rp.subject_id)))
  AND NOT md_policy_matches(t,rp.id,rec.id))
 AND (CASE WHEN usr.user_type='external' THEN act='read' AND COALESCE(setting.portal_enabled,false)
   AND usr.external_account_id IS NOT NULL
   AND md_record_field(t,rec.id,setting.portal_account_field)=usr.external_account_id::text
 ELSE
 rec.owner_id=u OR (rec.owner_queue_id IS NOT NULL AND md_access_member(t,u,rec.owner_queue_id))
 OR md_rbac_allowed(t,u,'Record:'||rec.id::text,act)
 OR md_rbac_allowed(t,u,rec.object_api,'modifyAll')
 OR (act='read' AND (md_rbac_allowed(t,u,rec.object_api,'viewAll') OR md_rbac_allowed(t,u,'Record','viewAll')))
 OR (act='read' AND setting.default_access IN ('Public Read Only','Public Read/Write'))
 OR (act='edit' AND setting.default_access='Public Read/Write')
 OR (COALESCE(setting.use_hierarchy,true) AND EXISTS(
   SELECT 1 FROM md_user_role_tree(t,rec.owner_id) ancestor
   JOIN md_user_roles ur ON ur.tenant_id=t AND ur.user_id=u AND ur.role_id=ancestor.role_id
   WHERE NOT EXISTS(SELECT 1 FROM md_user_roles own WHERE own.tenant_id=t AND own.user_id=rec.owner_id AND own.role_id=ancestor.role_id)))
 OR (act IN ('read','edit') AND EXISTS(SELECT 1 FROM md_record_policies rp
  WHERE rp.tenant_id=t AND rp.object_api=rec.object_api AND rp.kind='share' AND rp.enabled
   AND (act='read' OR rp.access_level='Edit')
   AND (CASE rp.target_type WHEN 'User' THEN rp.target_id=u
    WHEN 'PublicGroup' THEN md_access_member(t,u,rp.target_id)
    WHEN 'Role' THEN EXISTS(SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=rp.target_id)
    WHEN 'RoleAndSubordinates' THEN rp.target_id IN(SELECT role_id FROM md_user_role_tree(t,u)) ELSE false END)
   AND (CASE rp.rule_type WHEN 'OwnerBased' THEN EXISTS(
    SELECT 1 FROM md_policy_owner_roles por JOIN md_user_roles own
     ON own.tenant_id=por.tenant_id AND own.role_id=por.role_id AND own.user_id=rec.owner_id
     WHERE por.tenant_id=t AND por.policy_id=rp.id)
    WHEN 'CriteriaBased' THEN md_policy_matches(t,rp.id,rec.id) ELSE false END)))
 END)
 FROM md_records rec JOIN md_users usr ON usr.tenant_id=t AND usr.id=u AND usr.enabled
 LEFT JOIN md_sharing_settings setting ON setting.tenant_id=t AND setting.object_api=rec.object_api
 WHERE rec.tenant_id=t AND rec.id=rid
 ),false)
$$;
$md_legacy_record_definition$;
 END IF;
END
$md_record_guard$;

 CREATE TABLE IF NOT EXISTS md_object_manager_settings (
   tenant_id uuid NOT NULL REFERENCES md_tenants(id),
   object_api text NOT NULL,
   plural_label text NOT NULL DEFAULT '',
   description text NOT NULL DEFAULT '',
   help_text text NOT NULL DEFAULT '',
   allow_reports boolean NOT NULL DEFAULT true,
   allow_activities boolean NOT NULL DEFAULT false,
   track_field_history boolean NOT NULL DEFAULT false,
   allow_in_chatter boolean NOT NULL DEFAULT false,
   allow_search boolean NOT NULL DEFAULT true,
   deployment_status text NOT NULL DEFAULT 'Deployed'
     CHECK(deployment_status IN ('In Development','Deployed')),
   record_name_type text NOT NULL DEFAULT 'Text'
     CHECK(record_name_type IN ('Text','Auto Number')),
   record_name_format text NOT NULL DEFAULT '',
   updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(tenant_id,object_api),
   FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
   CHECK(length(description)<=1000),
   CHECK(length(plural_label)<=160),
   CHECK(length(help_text)<=1000),
   CHECK(length(record_name_format)<=80)
 );
 CREATE TABLE IF NOT EXISTS md_object_field_sets (
   tenant_id uuid NOT NULL,
   object_api text NOT NULL,
   api_name text NOT NULL,
   label text NOT NULL,
   sort_order integer NOT NULL DEFAULT 0,
   PRIMARY KEY(tenant_id,object_api,api_name),
   FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
   CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
   CHECK(length(label) BETWEEN 1 AND 80)
 );
 CREATE TABLE IF NOT EXISTS md_object_field_set_items (
   tenant_id uuid NOT NULL,
   object_api text NOT NULL,
   field_set_api text NOT NULL,
   field_api text NOT NULL,
   sort_order integer NOT NULL DEFAULT 0,
   PRIMARY KEY(tenant_id,object_api,field_set_api,field_api),
   FOREIGN KEY(tenant_id,object_api,field_set_api)
     REFERENCES md_object_field_sets(tenant_id,object_api,api_name) ON DELETE CASCADE,
   FOREIGN KEY(tenant_id,object_api,field_api)
     REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
 );
CREATE TABLE IF NOT EXISTS md_object_actions (
   tenant_id uuid NOT NULL,
   object_api text NOT NULL,
   action_id text NOT NULL,
   label text NOT NULL,
   action_type text NOT NULL CHECK(action_type IN ('Standard','Custom')),
   enabled boolean NOT NULL DEFAULT true,
   behavior text,
   field_api text,
   value_text text,
   target_object_api text,
   relationship_field_api text,
   flow_api_name text,
   component_api_name text,
   component_bindings jsonb NOT NULL DEFAULT '[]'::jsonb
     CHECK(jsonb_typeof(component_bindings)='array'),
   presentation text NOT NULL DEFAULT 'Modal' CHECK(presentation IN ('Modal','Side Panel')),
   credential_id uuid,
   from_email text,
   sort_order integer NOT NULL DEFAULT 0,
   PRIMARY KEY(tenant_id,object_api,action_id),
   FOREIGN KEY(tenant_id,object_api)
     REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
   FOREIGN KEY(tenant_id,object_api,field_api)
     REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
   CHECK(action_id ~ '^[A-Za-z][A-Za-z0-9_-]*$'),
   CHECK(length(label) BETWEEN 1 AND 80),
   CHECK(value_text IS NULL OR length(value_text)<=10000),
   CONSTRAINT md_object_actions_behavior_contract CHECK(
 (action_type='Standard' AND behavior IS NULL AND field_api IS NULL AND value_text IS NULL
  AND target_object_api IS NULL AND relationship_field_api IS NULL AND flow_api_name IS NULL
  AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (action_type='Custom' AND (
   (behavior='Set Field Value' AND field_api IS NOT NULL AND value_text IS NOT NULL
     AND target_object_api IS NULL AND flow_api_name IS NULL AND relationship_field_api IS NULL
     AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
   OR (behavior='Log Call' AND field_api IS NULL AND target_object_api IS NULL
     AND flow_api_name IS NULL AND relationship_field_api IS NULL AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
   OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND field_api IS NULL
     AND target_object_api IS NULL AND relationship_field_api IS NULL AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
   OR (behavior='Create Related' AND target_object_api IS NOT NULL
     AND relationship_field_api IS NOT NULL AND field_api IS NULL AND flow_api_name IS NULL
     AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
   OR (behavior='Send Email' AND field_api IS NULL AND relationship_field_api IS NULL
     AND target_object_api IS NULL AND value_text IS NULL AND component_api_name IS NULL
     AND ((flow_api_name IS NOT NULL AND credential_id IS NULL AND from_email IS NULL)
       OR (flow_api_name IS NULL AND credential_id IS NOT NULL AND from_email IS NOT NULL
         AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$')))
    OR (behavior='Open Component' AND component_api_name IS NOT NULL AND field_api IS NULL
      AND value_text IS NULL AND target_object_api IS NULL AND relationship_field_api IS NULL
      AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL)
  )))
);

-- Global Quick Actions use one tenant metadata registry and shared execution permissions.
CREATE TABLE IF NOT EXISTS md_global_quick_actions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 action_id text NOT NULL CHECK(action_id ~ '^[A-Za-z][A-Za-z0-9_-]*$' AND length(action_id)<=100),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 behavior text NOT NULL CHECK(behavior IN ('Create Record','Run Flow','Open Component','Send Email')),
 enabled boolean NOT NULL DEFAULT true,
 target_object_api text,
 flow_api_name text,
 component_api_name text,
 component_bindings jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK(jsonb_typeof(component_bindings)='array'),
 presentation text NOT NULL DEFAULT 'Modal' CHECK(presentation IN ('Modal','Side Panel')),
 credential_id uuid,
 from_email text,
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,action_id),
 FOREIGN KEY(tenant_id,target_object_api) REFERENCES md_object_definitions(tenant_id,api_name),
 CHECK(
 (behavior='Create Record' AND target_object_api IS NOT NULL AND flow_api_name IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND target_object_api IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Send Email' AND target_object_api IS NULL AND component_api_name IS NULL
   AND ((flow_api_name IS NOT NULL AND credential_id IS NULL AND from_email IS NULL)
     OR (flow_api_name IS NULL AND credential_id IS NOT NULL AND from_email IS NOT NULL
       AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\\.[^[:space:]@<>]+$')))
 OR (behavior='Open Component' AND component_api_name IS NOT NULL AND target_object_api IS NULL
   AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL))
);
CREATE INDEX IF NOT EXISTS md_global_quick_actions_active
 ON md_global_quick_actions(tenant_id,sort_order,action_id) WHERE enabled=true;

 CREATE TABLE IF NOT EXISTS md_encrypted_field_access_audit (
   tenant_id uuid NOT NULL,
   id uuid NOT NULL DEFAULT gen_random_uuid(),
   record_id uuid NOT NULL,
   object_api text NOT NULL,
   field_api text NOT NULL,
   accessed_by uuid NOT NULL,
   occurred_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(tenant_id,id),
   FOREIGN KEY(tenant_id,record_id,object_api)
     REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
   FOREIGN KEY(tenant_id,object_api,field_api)
     REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
   FOREIGN KEY(tenant_id,accessed_by) REFERENCES md_users(tenant_id,id)
 );
 CREATE INDEX IF NOT EXISTS md_encrypted_field_access_audit_lookup
   ON md_encrypted_field_access_audit(tenant_id,object_api,field_api,occurred_at DESC);
 CREATE TABLE IF NOT EXISTS md_field_type_migrations (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
   object_api text NOT NULL,
   field_api text NOT NULL,
   actor_user_id uuid,
   from_data_type text NOT NULL,
   to_data_type text NOT NULL,
   from_max_length integer,
   from_precision integer,
   from_scale integer,
   from_required boolean NOT NULL,
   from_unique boolean NOT NULL,
   from_external_id boolean NOT NULL,
   from_case_sensitive boolean NOT NULL,
   from_default_value text,
   to_max_length integer,
   to_precision integer,
   to_scale integer,
   to_required boolean NOT NULL,
   to_unique boolean NOT NULL,
   to_external_id boolean NOT NULL,
   to_case_sensitive boolean NOT NULL,
   to_default_value text,
   status text NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','rolled_back')),
   records_migrated integer NOT NULL DEFAULT 0 CHECK(records_migrated>=0),
   created_at timestamptz NOT NULL DEFAULT now(),
   rolled_back_at timestamptz,
   UNIQUE(tenant_id,id),
   FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id),
   FOREIGN KEY(tenant_id,object_api,field_api)
     REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
 );
 CREATE INDEX IF NOT EXISTS md_field_type_migrations_history
   ON md_field_type_migrations(tenant_id,object_api,field_api,created_at DESC);
 CREATE TABLE IF NOT EXISTS md_field_type_migration_values (
   tenant_id uuid NOT NULL,
   migration_id uuid NOT NULL,
   record_id uuid NOT NULL,
   object_api text NOT NULL,
   before_value_text text,
   before_value_number numeric,
   before_value_boolean boolean,
   before_value_date date,
   before_value_datetime timestamptz,
   before_value_exists boolean NOT NULL DEFAULT true,
   before_snapshot_encrypted boolean NOT NULL DEFAULT false,
   before_is_unique boolean NOT NULL,
   before_case_sensitive boolean NOT NULL,
   after_value_text text,
   after_value_number numeric,
   after_value_boolean boolean,
   after_value_date date,
   after_value_datetime timestamptz,
   after_value_exists boolean NOT NULL DEFAULT true,
   before_reference_record_id uuid,
   before_geo_latitude double precision,
   before_geo_longitude double precision,
   before_address_street text,
   before_address_city text,
   before_address_state text,
   before_address_postal_code text,
   before_address_country text,
   after_reference_record_id uuid,
   after_geo_latitude double precision,
   after_geo_longitude double precision,
   after_address_street text,
   after_address_city text,
   after_address_state text,
   after_address_postal_code text,
   after_address_country text,
   PRIMARY KEY(tenant_id,migration_id,record_id),
   FOREIGN KEY(tenant_id,migration_id)
     REFERENCES md_field_type_migrations(tenant_id,id) ON DELETE CASCADE,
   FOREIGN KEY(tenant_id,record_id,object_api)
     REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
 );
 CREATE TABLE IF NOT EXISTS md_field_type_migration_config (
  tenant_id uuid NOT NULL,
  migration_id uuid NOT NULL,
  side text NOT NULL CHECK(side IN ('from','to')),
  related_object text,
  global_value_set_api text,
  controller_field_api text,
  relationship_type text,
  relationship_name text,
  child_relationship_name text,
  delete_behavior text,
  allow_reparenting boolean NOT NULL DEFAULT false,
  picklist_restricted boolean NOT NULL DEFAULT true,
  auto_number_format text,
  formula_expression text,
  formula_return_type text,
  rollup_child_object text,
  rollup_relationship_field text,
  rollup_operation text,
  rollup_source_field text,
  rollup_filter_logic text,
  auto_number_counter_exists boolean NOT NULL DEFAULT false,
  auto_number_next_value bigint,
  PRIMARY KEY(tenant_id,migration_id,side),
  FOREIGN KEY(tenant_id,migration_id)
    REFERENCES md_field_type_migrations(tenant_id,id) ON DELETE CASCADE
 );
 CREATE TABLE IF NOT EXISTS md_field_type_migration_picklist_values (
  tenant_id uuid NOT NULL,
  migration_id uuid NOT NULL,
  side text NOT NULL CHECK(side IN ('from','to')),
  value text NOT NULL,
  sort_order integer NOT NULL,
  PRIMARY KEY(tenant_id,migration_id,side,value),
  FOREIGN KEY(tenant_id,migration_id,side)
    REFERENCES md_field_type_migration_config(tenant_id,migration_id,side) ON DELETE CASCADE
 );
 CREATE TABLE IF NOT EXISTS md_field_type_migration_rollup_filters (
  tenant_id uuid NOT NULL,
  migration_id uuid NOT NULL,
  side text NOT NULL CHECK(side IN ('from','to')),
  filter_field_api text NOT NULL,
  operator text NOT NULL,
  value_text text NOT NULL,
  sort_order integer NOT NULL,
  PRIMARY KEY(tenant_id,migration_id,side,sort_order),
  FOREIGN KEY(tenant_id,migration_id,side)
    REFERENCES md_field_type_migration_config(tenant_id,migration_id,side) ON DELETE CASCADE
 );
CREATE TABLE IF NOT EXISTS md_global_value_sets (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_global_value_set_values (
  tenant_id uuid NOT NULL,
  value_set_id uuid NOT NULL,
  value text NOT NULL CHECK(length(btrim(value)) BETWEEN 1 AND 512),
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,value_set_id,value),
  FOREIGN KEY(tenant_id,value_set_id) REFERENCES md_global_value_sets(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS md_global_value_set_values_unique_ci
  ON md_global_value_set_values(tenant_id,value_set_id,lower(value));
CREATE INDEX IF NOT EXISTS md_global_value_set_values_order
  ON md_global_value_set_values(tenant_id,value_set_id,sort_order,value);
CREATE TABLE IF NOT EXISTS md_global_value_set_audit (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  value_set_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('create','update','delete')),
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_global_value_set_audit_lookup
  ON md_global_value_set_audit(tenant_id,value_set_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS md_field_global_value_sets (
  tenant_id uuid NOT NULL,
  object_api text NOT NULL,
  field_api text NOT NULL,
  value_set_api text NOT NULL,
  PRIMARY KEY(tenant_id,object_api,field_api),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,value_set_api)
    REFERENCES md_global_value_sets(tenant_id,api_name) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS md_field_global_value_sets_lookup
  ON md_field_global_value_sets(tenant_id,value_set_api);
CREATE TABLE IF NOT EXISTS md_custom_labels (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  language text NOT NULL DEFAULT 'en' CHECK(length(language) BETWEEN 2 AND 35),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
  value text NOT NULL CHECK(length(value)<=4000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,api_name,language)
);
CREATE INDEX IF NOT EXISTS md_custom_labels_lookup ON md_custom_labels(tenant_id,language,api_name);
CREATE TABLE IF NOT EXISTS md_custom_metadata_types (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_custom_metadata_fields (
  tenant_id uuid NOT NULL,
  type_api text NOT NULL,
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
  data_type text NOT NULL CHECK(data_type IN ('text','number','boolean','date','datetime')),
  required boolean NOT NULL DEFAULT false,
  max_length integer CHECK(max_length BETWEEN 1 AND 10000),
  sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  PRIMARY KEY(tenant_id,type_api,api_name),
  FOREIGN KEY(tenant_id,type_api) REFERENCES md_custom_metadata_types(tenant_id,api_name) ON DELETE CASCADE,
  CHECK(data_type='text' OR max_length IS NULL)
);
CREATE TABLE IF NOT EXISTS md_custom_metadata_records (
  tenant_id uuid NOT NULL,
  type_api text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 255),
  master_label text NOT NULL CHECK(length(master_label) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,type_api,id),
  UNIQUE(tenant_id,type_api,record_key),
  FOREIGN KEY(tenant_id,type_api) REFERENCES md_custom_metadata_types(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_custom_metadata_values (
  tenant_id uuid NOT NULL,
  type_api text NOT NULL,
  record_id uuid NOT NULL,
  field_api text NOT NULL,
  data_type text NOT NULL CHECK(data_type IN ('text','number','boolean','date','datetime')),
  value_text text,value_number numeric,value_boolean boolean,value_date date,value_datetime timestamptz,
  PRIMARY KEY(tenant_id,type_api,record_id,field_api),
  FOREIGN KEY(tenant_id,type_api,record_id)
    REFERENCES md_custom_metadata_records(tenant_id,type_api,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,type_api,field_api)
    REFERENCES md_custom_metadata_fields(tenant_id,type_api,api_name) ON DELETE CASCADE,
  CHECK(
    (data_type='text' AND value_text IS NOT NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='number' AND value_text IS NULL AND value_number IS NOT NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='boolean' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NOT NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='date' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NOT NULL AND value_datetime IS NULL) OR
    (data_type='datetime' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS md_custom_metadata_records_lookup
  ON md_custom_metadata_records(tenant_id,type_api,master_label,record_key);
CREATE TABLE IF NOT EXISTS md_custom_settings (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_custom_setting_fields (
  tenant_id uuid NOT NULL,
  setting_api text NOT NULL,
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
  data_type text NOT NULL CHECK(data_type IN ('text','number','boolean','date','datetime')),
  required boolean NOT NULL DEFAULT false,
  max_length integer CHECK(max_length BETWEEN 1 AND 10000),
  sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
  PRIMARY KEY(tenant_id,setting_api,api_name),
  FOREIGN KEY(tenant_id,setting_api) REFERENCES md_custom_settings(tenant_id,api_name) ON DELETE CASCADE,
  CHECK(data_type='text' OR max_length IS NULL)
);
CREATE TABLE IF NOT EXISTS md_custom_setting_entries (
  tenant_id uuid NOT NULL,
  setting_api text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK(scope IN ('organization','profile','user')),
  profile_id uuid,user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,setting_api,id),
  FOREIGN KEY(tenant_id,setting_api) REFERENCES md_custom_settings(tenant_id,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,profile_id) REFERENCES md_profiles(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
  CHECK(
    (scope='organization' AND profile_id IS NULL AND user_id IS NULL) OR
    (scope='profile' AND profile_id IS NOT NULL AND user_id IS NULL) OR
    (scope='user' AND profile_id IS NULL AND user_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_setting_org_entry
  ON md_custom_setting_entries(tenant_id,setting_api) WHERE scope='organization';
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_setting_profile_entry
  ON md_custom_setting_entries(tenant_id,setting_api,profile_id) WHERE scope='profile';
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_setting_user_entry
  ON md_custom_setting_entries(tenant_id,setting_api,user_id) WHERE scope='user';
CREATE TABLE IF NOT EXISTS md_custom_setting_values (
  tenant_id uuid NOT NULL,
  setting_api text NOT NULL,
  entry_id uuid NOT NULL,
  field_api text NOT NULL,
  data_type text NOT NULL CHECK(data_type IN ('text','number','boolean','date','datetime')),
  value_text text,value_number numeric,value_boolean boolean,value_date date,value_datetime timestamptz,
  PRIMARY KEY(tenant_id,setting_api,entry_id,field_api),
  FOREIGN KEY(tenant_id,setting_api,entry_id)
    REFERENCES md_custom_setting_entries(tenant_id,setting_api,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,setting_api,field_api)
    REFERENCES md_custom_setting_fields(tenant_id,setting_api,api_name) ON DELETE CASCADE,
  CHECK(
    (data_type='text' AND value_text IS NOT NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='number' AND value_text IS NULL AND value_number IS NOT NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='boolean' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NOT NULL AND value_date IS NULL AND value_datetime IS NULL) OR
    (data_type='date' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NOT NULL AND value_datetime IS NULL) OR
    (data_type='datetime' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_datetime IS NOT NULL)
  )
);

-- Shared Core Flow capabilities are relational SQL metadata, not runtime JSON.
CREATE TABLE IF NOT EXISTS md_flow_capability_flow_types (
 flow_type text PRIMARY KEY,
 description text NOT NULL,
 sort_order integer NOT NULL,
 create_enabled boolean NOT NULL DEFAULT false,
 validate_enabled boolean NOT NULL DEFAULT false,
 debug_enabled boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT true,
 registry_version integer NOT NULL DEFAULT 1 CHECK(registry_version>0)
);
CREATE TABLE IF NOT EXISTS md_flow_capability_elements (
 element_type text PRIMARY KEY,
 display_group text NOT NULL,
 display_icon text NOT NULL,
 sort_order integer NOT NULL,
 builder_enabled boolean NOT NULL DEFAULT false,
 before_save_allowed boolean NOT NULL DEFAULT false,
 config_schema_key text NOT NULL,
 validator_key text NOT NULL,
 runtime_handler_key text NOT NULL,
 debug_behavior text NOT NULL CHECK(debug_behavior IN ('execute','simulate','unsupported')),
 app_api_name text,
 enabled boolean NOT NULL DEFAULT true,
 registry_version integer NOT NULL DEFAULT 1 CHECK(registry_version>0)
);
CREATE TABLE IF NOT EXISTS md_flow_capability_element_flows (
 element_type text NOT NULL REFERENCES md_flow_capability_elements(element_type),
 flow_type text NOT NULL REFERENCES md_flow_capability_flow_types(flow_type),
 builder_allowed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(element_type,flow_type)
);
CREATE TABLE IF NOT EXISTS md_flow_capability_properties (
 element_type text NOT NULL REFERENCES md_flow_capability_elements(element_type),
 property_name text NOT NULL,
 value_type text NOT NULL CHECK(value_type IN ('text','number','boolean','resource','list','object')),
 required boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(element_type,property_name)
);

-- Shared tenant-owned media: reusable by any app, without KFC-specific Core records.
CREATE TABLE IF NOT EXISTS md_tenant_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/gif','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES md_users(tenant_id,id),
  CHECK (octet_length(content)=byte_size)
);
CREATE INDEX IF NOT EXISTS md_tenant_media_assets_created
  ON md_tenant_media_assets(tenant_id,created_at DESC,id);

-- Only executions with a caller-provided, UUID requestId enter this ledger.
-- Explicit tenant+actor scope and a unique request key reject duplicated order Flows.
CREATE TABLE IF NOT EXISTS md_flow_execution_requests (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  actor_id uuid NOT NULL,
  flow_api text NOT NULL,
  request_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,actor_id,flow_api,request_id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES md_users(tenant_id,id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_flow_execution_requests_run
  ON md_flow_execution_requests(tenant_id,run_id) WHERE run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS md_flow_execution_result_values (
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  flow_api text NOT NULL,
  request_id uuid NOT NULL,
  property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
  value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null','array','object')),
  value_text text,
  PRIMARY KEY(tenant_id,actor_id,flow_api,request_id,property_path),
  FOREIGN KEY(tenant_id,actor_id,flow_api,request_id)
    REFERENCES md_flow_execution_requests(tenant_id,actor_id,flow_api,request_id)
    ON DELETE CASCADE
);
-- Central versioned application manifests; no app code is copied into tenant runtime.
-- Tenants receive only installation receipts and metadata needed by the selected app.
CREATE TABLE IF NOT EXISTS md_app_package_versions (
  app_id uuid NOT NULL REFERENCES md_apps(id),
  version integer NOT NULL CHECK(version > 0),
  published boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  brand_color text NOT NULL DEFAULT '#2563eb' CHECK(brand_color ~ '^#[0-9a-fA-F]{6}$'),
  PRIMARY KEY(app_id,version)
);
CREATE TABLE IF NOT EXISTS md_app_package_dependencies (
  app_id uuid NOT NULL,
  version integer NOT NULL,
  required_app_id uuid NOT NULL REFERENCES md_apps(id),
  minimum_version integer NOT NULL DEFAULT 1 CHECK(minimum_version > 0),
  PRIMARY KEY(app_id,version,required_app_id),
  FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE,
  CHECK(app_id <> required_app_id)
);
CREATE TABLE IF NOT EXISTS md_app_package_resources (
  app_id uuid NOT NULL,
  version integer NOT NULL,
  resource_type text NOT NULL CHECK(resource_type IN ('Object','Field','Component','App Page','Flow')),
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  parent_api text NOT NULL DEFAULT '' CHECK(parent_api = '' OR parent_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  PRIMARY KEY(app_id,version,resource_type,api_name,parent_api),
  FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE,
  CHECK((resource_type='Field' AND parent_api <> '') OR (resource_type<>'Field' AND parent_api=''))
);
CREATE TABLE IF NOT EXISTS md_app_package_navigation (
  app_id uuid NOT NULL,
  version integer NOT NULL,
  entry_type text NOT NULL CHECK(entry_type IN ('Object','App Page')),
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id,version,entry_type,api_name),
  FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_tenant_app_installed_versions (
  tenant_id uuid NOT NULL,
  app_id uuid NOT NULL,
  version integer NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,app_id),
  FOREIGN KEY(tenant_id,app_id) REFERENCES md_app_installations(tenant_id,app_id) ON DELETE CASCADE,
  FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version)
);
CREATE INDEX IF NOT EXISTS md_app_package_published_lookup
  ON md_app_package_versions(app_id,version DESC) WHERE published=true;
CREATE INDEX IF NOT EXISTS md_app_package_reverse_deps
  ON md_app_package_dependencies(required_app_id,app_id,version);

-- Immutable-by-convention published package templates. Publisher workflows must create
-- a new version rather than mutate published versions.
CREATE TABLE IF NOT EXISTS md_app_package_object_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 label text NOT NULL CHECK(length(label)>0),
 PRIMARY KEY(app_id,version,api_name),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_app_package_field_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 object_api text NOT NULL CHECK(object_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 label text NOT NULL,data_type text NOT NULL,
 related_object text,max_length integer CHECK(max_length BETWEEN 1 AND 1000000),
 required boolean NOT NULL DEFAULT false,
 PRIMARY KEY(app_id,version,object_api,api_name),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_app_package_component_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 renderer_key text NOT NULL,
 PRIMARY KEY(app_id,version,api_name),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_app_package_page_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 title text NOT NULL CHECK(length(title)>0),
 PRIMARY KEY(app_id,version,api_name),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_app_package_home_page_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 page_api text NOT NULL CHECK(page_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 form_factor text NOT NULL CHECK(form_factor IN ('desktop','tablet','phone')),
 PRIMARY KEY(app_id,version,form_factor),
 FOREIGN KEY(app_id,version,page_api)
   REFERENCES md_app_package_page_templates(app_id,version,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_app_package_page_component_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 page_api text NOT NULL,component_api text NOT NULL,
 slot text NOT NULL,sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(app_id,version,page_api,component_api,slot,sort_order),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE
);
-- Receipts persist after uninstall: existing tenant customisations are never overwritten.
CREATE TABLE IF NOT EXISTS md_app_package_seed_receipts (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_id uuid NOT NULL REFERENCES md_apps(id),
 resource_type text NOT NULL CHECK(resource_type IN ('Object','Field','Component','App Page','Page Component')),
 parent_api text NOT NULL DEFAULT '',api_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,app_id,resource_type,parent_api,api_name)
);

-- Typed Page Component properties are stored centrally and materialised only for
-- installed packages. Reference names resolve to tenant-local SQL metadata IDs.
CREATE TABLE IF NOT EXISTS md_app_package_page_property_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 page_api text NOT NULL,component_api text NOT NULL,
 slot text NOT NULL,sort_order integer NOT NULL DEFAULT 0,
 property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
 data_type text NOT NULL CHECK(data_type IN ('string','number','boolean','null','array','object','reference')),
 value_text text,
 reference_kind text CHECK(reference_kind IN ('Object','Field','Flow')),
 reference_api text,
 reference_parent_api text,
 PRIMARY KEY(app_id,version,page_api,component_api,slot,sort_order,property_path),
 FOREIGN KEY(app_id,version) REFERENCES md_app_package_versions(app_id,version) ON DELETE CASCADE,
 CHECK(
   (data_type='reference' AND reference_kind IS NOT NULL AND reference_api IS NOT NULL
    AND value_text IS NULL)
   OR (data_type<>'reference' AND reference_kind IS NULL AND reference_api IS NULL
       AND reference_parent_api IS NULL)
 )
);

-- Core tenant policy. Defaults preserve existing passwords; failed logins are bounded.
CREATE TABLE IF NOT EXISTS md_password_policies (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 min_length integer NOT NULL DEFAULT 12 CHECK(min_length BETWEEN 12 AND 128),
 require_uppercase boolean NOT NULL DEFAULT false,
 require_lowercase boolean NOT NULL DEFAULT false,
 require_number boolean NOT NULL DEFAULT false,
 require_symbol boolean NOT NULL DEFAULT false,
 max_age_days integer NOT NULL DEFAULT 0 CHECK(max_age_days BETWEEN 0 AND 365),
 history_count integer NOT NULL DEFAULT 5 CHECK(history_count BETWEEN 0 AND 24),
 max_failed_attempts integer NOT NULL DEFAULT 5 CHECK(max_failed_attempts BETWEEN 3 AND 20),
 lockout_minutes integer NOT NULL DEFAULT 15 CHECK(lockout_minutes BETWEEN 1 AND 1440),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO md_password_policies(tenant_id) SELECT id FROM md_tenants ON CONFLICT DO NOTHING;
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS md_password_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_password_history_user ON md_password_history(tenant_id,user_id,id DESC);
-- Unknown-account failures have no user identity; they still belong to the resolved tenant.
ALTER TABLE md_security_events ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE md_security_events ADD COLUMN IF NOT EXISTS login_identifier text;
ALTER TABLE md_security_events ADD COLUMN IF NOT EXISTS source_ip text;

-- Universal, tenant-scoped MFA metadata and one-time authentication challenges.
CREATE TABLE IF NOT EXISTS md_tenant_mfa_policies(
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 mode text NOT NULL DEFAULT 'Off' CHECK(mode IN ('Off','Optional','Required')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS md_user_mfa_secrets(
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 secret_ciphertext bytea NOT NULL,
 key_id text NOT NULL,
 last_counter bigint NOT NULL DEFAULT -1,
 enrolled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_mfa_enrollment_tokens(
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
 secret_ciphertext bytea NOT NULL,
 key_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_mfa_login_challenges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 challenge_hash text NOT NULL UNIQUE CHECK(length(challenge_hash)=64),
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
 enrollment_secret_ciphertext bytea,
 key_id text,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_mfa_login_recent ON md_mfa_login_challenges(tenant_id,user_id,created_at DESC);
ALTER TABLE md_sessions ADD COLUMN IF NOT EXISTS mfa_verified boolean NOT NULL DEFAULT false;
ALTER TABLE md_refresh_sessions ADD COLUMN IF NOT EXISTS mfa_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS md_session_policies(
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 access_minutes integer NOT NULL DEFAULT 60 CHECK(access_minutes BETWEEN 5 AND 1440),
 refresh_minutes integer NOT NULL DEFAULT 43200 CHECK(refresh_minutes BETWEEN 5 AND 43200),
 idle_minutes integer NOT NULL DEFAULT 60 CHECK(idle_minutes BETWEEN 5 AND 1440),
 require_mfa boolean NOT NULL DEFAULT false,
 frame_policy text NOT NULL DEFAULT 'DENY' CHECK(frame_policy IN ('DENY','SAMEORIGIN')),
 csp_enabled boolean NOT NULL DEFAULT true
);
INSERT INTO md_session_policies(tenant_id) SELECT id FROM md_tenants ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS md_login_ip_ranges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 profile_id uuid,kind text NOT NULL CHECK(kind IN ('login','trusted')),network cidr NOT NULL,
 FOREIGN KEY(tenant_id,profile_id) REFERENCES md_profiles(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_login_hours(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 profile_id uuid,weekday integer NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 start_minute integer NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute integer NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
 timezone text NOT NULL DEFAULT 'Europe/London',CHECK(start_minute<end_minute),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES md_profiles(tenant_id,id)
);
ALTER TABLE md_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_sessions ADD COLUMN IF NOT EXISTS source_ip inet;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='md_sessions' AND column_name='family_id') THEN
  UPDATE md_sessions SET revoked_at=now() WHERE revoked_at IS NULL;
 END IF;
END $$;
ALTER TABLE md_sessions ADD COLUMN IF NOT EXISTS family_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE md_refresh_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_refresh_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days';
ALTER TABLE md_refresh_sessions ADD COLUMN IF NOT EXISTS source_ip inet;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='md_refresh_sessions' AND column_name='family_id') THEN
  UPDATE md_refresh_sessions SET revoked_at=now() WHERE revoked_at IS NULL;
 END IF;
END $$;
ALTER TABLE md_refresh_sessions ADD COLUMN IF NOT EXISTS family_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS md_mfa_backup_codes(
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,code_hash text NOT NULL,used_at timestamptz,
 PRIMARY KEY(tenant_id,user_id,code_hash),FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE md_mfa_login_challenges ADD COLUMN IF NOT EXISTS source_ip inet;
CREATE TABLE IF NOT EXISTS md_webauthn_credentials(
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,credential_id text NOT NULL,public_key bytea NOT NULL,
 counter bigint NOT NULL DEFAULT 0,label text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,credential_id),FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_webauthn_challenges(
 token_hash text PRIMARY KEY,tenant_id uuid NOT NULL,user_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('register','authenticate')),challenge text NOT NULL,
 origin text NOT NULL,rp_id text NOT NULL,mfa_challenge_hash text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',consumed_at timestamptz,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_identity_providers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 label text NOT NULL,protocol text NOT NULL CHECK(protocol IN ('oidc','saml')),enabled boolean NOT NULL DEFAULT false,
 issuer text NOT NULL,authorization_url text NOT NULL,token_url text NOT NULL DEFAULT '',jwks_url text NOT NULL DEFAULT '',
 client_id text NOT NULL DEFAULT '',secret_ciphertext bytea,key_id text,certificate text NOT NULL DEFAULT '',
 UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_federated_identities(
 tenant_id uuid NOT NULL,provider_id uuid NOT NULL,subject text NOT NULL,user_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,provider_id,subject),UNIQUE(tenant_id,provider_id,user_id),
 FOREIGN KEY(tenant_id,provider_id) REFERENCES md_identity_providers(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_federation_requests(
 state_hash text PRIMARY KEY,tenant_id uuid NOT NULL,provider_id uuid NOT NULL,
 browser_hash text NOT NULL,nonce text NOT NULL,verifier_ciphertext bytea,key_id text,origin text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',consumed_at timestamptz,
 FOREIGN KEY(tenant_id,provider_id) REFERENCES md_identity_providers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_saml_request_ids(
 tenant_id uuid NOT NULL,provider_id uuid NOT NULL,request_id text NOT NULL,value text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,provider_id,request_id),
 FOREIGN KEY(tenant_id,provider_id) REFERENCES md_identity_providers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_federation_tickets(
 token_hash text PRIMARY KEY,tenant_id uuid NOT NULL,user_id uuid NOT NULL,origin text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 minute',consumed_at timestamptz,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);

-- One reusable SQL boundary predicate for login, refresh and every authenticated request.
CREATE OR REPLACE FUNCTION md_login_boundary_allowed(t uuid,u uuid,ip inet)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH scopes AS (
  SELECT NULL::uuid AS profile_id UNION SELECT profile_id FROM md_user_profiles WHERE tenant_id=t AND user_id=u
 ), clock AS (SELECT h.*,now() AT TIME ZONE h.timezone AS local_time FROM md_login_hours h WHERE h.tenant_id=t)
 SELECT NOT EXISTS(SELECT 1 FROM scopes s WHERE
  (EXISTS(SELECT 1 FROM md_login_ip_ranges r WHERE r.tenant_id=t AND r.kind='login' AND r.profile_id IS NOT DISTINCT FROM s.profile_id)
   AND NOT EXISTS(SELECT 1 FROM md_login_ip_ranges r WHERE r.tenant_id=t AND r.kind='login' AND r.profile_id IS NOT DISTINCT FROM s.profile_id AND ip <<= r.network))
  OR (EXISTS(SELECT 1 FROM clock h WHERE h.profile_id IS NOT DISTINCT FROM s.profile_id)
   AND NOT EXISTS(SELECT 1 FROM clock h WHERE h.profile_id IS NOT DISTINCT FROM s.profile_id
    AND extract(isodow FROM h.local_time)=h.weekday
    AND extract(hour FROM h.local_time)*60+extract(minute FROM h.local_time)>=h.start_minute
    AND extract(hour FROM h.local_time)*60+extract(minute FROM h.local_time)<h.end_minute)))
$$;

-- Phase 3 security governance baseline
CREATE TABLE IF NOT EXISTS md_system_permission_catalogue(
 permission_key text PRIMARY KEY,label text NOT NULL,description text NOT NULL,resource text NOT NULL,action text NOT NULL
);
CREATE TABLE IF NOT EXISTS md_license_entitlements(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL DEFAULT gen_random_uuid(),
 license_key text NOT NULL,label text NOT NULL,kind text NOT NULL CHECK(kind IN ('User','PermissionSet')),
 enabled boolean NOT NULL DEFAULT true,seat_limit integer CHECK(seat_limit>=0),expires_at timestamptz,
 auto_assign boolean NOT NULL DEFAULT false,PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,license_key)
);
CREATE TABLE IF NOT EXISTS md_license_capabilities(
 tenant_id uuid NOT NULL,entitlement_id uuid NOT NULL,resource text NOT NULL,action text NOT NULL,
 PRIMARY KEY(tenant_id,entitlement_id,resource,action),
 FOREIGN KEY(tenant_id,entitlement_id) REFERENCES md_license_entitlements(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_user_license_assignments(
 tenant_id uuid NOT NULL,user_id uuid NOT NULL,entitlement_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,user_id,entitlement_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,entitlement_id) REFERENCES md_license_entitlements(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_permission_set_license_requirements(
 tenant_id uuid NOT NULL,permission_set_id uuid NOT NULL,entitlement_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,permission_set_id,entitlement_id),
 FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,entitlement_id) REFERENCES md_license_entitlements(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_governance_seed_receipts(tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id));
INSERT INTO md_license_entitlements(tenant_id,license_key,label,kind,auto_assign)
 SELECT id,'CoreFull','Core platform user','User',true FROM md_tenants WHERE id NOT IN(SELECT tenant_id FROM md_governance_seed_receipts) ON CONFLICT DO NOTHING;
INSERT INTO md_license_capabilities SELECT tenant_id,id,'*','*' FROM md_license_entitlements WHERE license_key='CoreFull' AND tenant_id NOT IN(SELECT tenant_id FROM md_governance_seed_receipts) ON CONFLICT DO NOTHING;
INSERT INTO md_user_license_assignments SELECT u.tenant_id,u.id,e.id FROM md_users u
 JOIN md_license_entitlements e ON e.tenant_id=u.tenant_id AND e.license_key='CoreFull' WHERE u.tenant_id NOT IN(SELECT tenant_id FROM md_governance_seed_receipts) ON CONFLICT DO NOTHING;
INSERT INTO md_governance_seed_receipts SELECT id FROM md_tenants ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION md_user_licensed(t uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM md_user_license_assignments a JOIN md_license_entitlements e ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
  WHERE a.tenant_id=t AND a.user_id=u AND e.kind='User' AND e.enabled AND (e.expires_at IS NULL OR e.expires_at>now()))
$$;
CREATE OR REPLACE FUNCTION md_user_license_allows(t uuid,u uuid,res text,act text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM md_user_license_assignments a JOIN md_license_entitlements e ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
  JOIN md_license_capabilities c ON c.tenant_id=e.tenant_id AND c.entitlement_id=e.id
  WHERE a.tenant_id=t AND a.user_id=u AND e.kind='User' AND e.enabled AND (e.expires_at IS NULL OR e.expires_at>now())
  AND c.resource IN(res,'*',CASE WHEN res LIKE 'Flow:%' THEN 'Flow' ELSE res END) AND c.action IN(act,'*'))
$$;
CREATE OR REPLACE FUNCTION md_permission_set_licensed(t uuid,u uuid,p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM md_permission_set_license_requirements r WHERE r.tenant_id=t AND r.permission_set_id=p AND NOT EXISTS(
  SELECT 1 FROM md_user_license_assignments a JOIN md_license_entitlements e ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
  WHERE a.tenant_id=t AND a.user_id=u AND a.entitlement_id=r.entitlement_id AND e.kind='PermissionSet' AND e.enabled AND (e.expires_at IS NULL OR e.expires_at>now())))
$$;
CREATE OR REPLACE FUNCTION md_seed_governance_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE eid uuid;
 BEGIN
  INSERT INTO md_license_entitlements(tenant_id,license_key,label,kind,auto_assign) VALUES(NEW.id,'CoreFull','Core platform user','User',true)
   ON CONFLICT(tenant_id,license_key) DO NOTHING;
  SELECT id INTO eid FROM md_license_entitlements WHERE tenant_id=NEW.id AND license_key='CoreFull';
  INSERT INTO md_license_capabilities VALUES(NEW.id,eid,'*','*') ON CONFLICT DO NOTHING;
  INSERT INTO md_governance_seed_receipts VALUES(NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
 END
$$;
DROP TRIGGER IF EXISTS md_seed_governance_tenant ON md_tenants;
CREATE TRIGGER md_seed_governance_tenant AFTER INSERT ON md_tenants FOR EACH ROW EXECUTE FUNCTION md_seed_governance_tenant();
CREATE OR REPLACE FUNCTION md_auto_assign_user_license() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE e record;
 BEGIN
  FOR e IN SELECT * FROM md_license_entitlements WHERE tenant_id=NEW.tenant_id AND kind='User' AND auto_assign AND enabled
   AND (expires_at IS NULL OR expires_at>now()) ORDER BY id FOR UPDATE LOOP
   IF e.seat_limit IS NULL OR (SELECT count(*) FROM md_user_license_assignments WHERE tenant_id=e.tenant_id AND entitlement_id=e.id)<e.seat_limit THEN
    INSERT INTO md_user_license_assignments VALUES(NEW.tenant_id,NEW.id,e.id) ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
  RETURN NEW;
 END
$$;
DROP TRIGGER IF EXISTS md_auto_assign_user_license ON md_users;
CREATE TRIGGER md_auto_assign_user_license AFTER INSERT ON md_users FOR EACH ROW EXECUTE FUNCTION md_auto_assign_user_license();

CREATE TABLE IF NOT EXISTS md_setup_audit_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,actor_tenant_id uuid,actor_user_id uuid,
 correlation_id uuid,table_name text NOT NULL,operation text NOT NULL,row_identifier text NOT NULL,
 changed_fields text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_setup_audit_tenant ON md_setup_audit_events(tenant_id,id DESC);
CREATE TABLE IF NOT EXISTS md_setup_audit_tables(table_name text PRIMARY KEY);
CREATE OR REPLACE FUNCTION md_capture_setup_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE before_row jsonb;after_row jsonb;row_data jsonb;fields text[];target_tenant uuid;
 BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW;END IF;
  IF TG_OP<>'INSERT' THEN before_row=to_jsonb(OLD);END IF;
  IF TG_OP<>'DELETE' THEN after_row=to_jsonb(NEW);END IF;
  row_data=COALESCE(after_row,before_row);
  target_tenant=NULLIF(row_data->>'tenant_id','')::uuid;
  IF TG_TABLE_NAME='md_tenants' THEN target_tenant=(row_data->>'id')::uuid;END IF;
  SELECT array_agg(k ORDER BY k) INTO fields FROM jsonb_object_keys(row_data) k
   WHERE before_row IS NULL OR after_row IS NULL OR before_row->k IS DISTINCT FROM after_row->k;
  INSERT INTO md_setup_audit_events(tenant_id,actor_tenant_id,actor_user_id,correlation_id,table_name,operation,row_identifier,changed_fields)
  VALUES(target_tenant,NULLIF(current_setting('metadrive.actor_tenant',true),'')::uuid,NULLIF(current_setting('metadrive.actor_user',true),'')::uuid,
   NULLIF(current_setting('metadrive.correlation_id',true),'')::uuid,TG_TABLE_NAME,TG_OP,
   left(COALESCE(row_data->>'id',row_data->>'api_name',row_data->>'user_id',row_data->>'tenant_id','global'),200),COALESCE(fields,ARRAY[]::text[]));
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END
$$;
CREATE OR REPLACE FUNCTION md_protect_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Setup audit trail is append-only';END
$$;
DROP TRIGGER IF EXISTS md_protect_setup_audit ON md_setup_audit_events;
CREATE TRIGGER md_protect_setup_audit BEFORE UPDATE OR DELETE ON md_setup_audit_events FOR EACH ROW EXECUTE FUNCTION md_protect_setup_audit();
CREATE TABLE IF NOT EXISTS md_monitor_settings(
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),enabled boolean NOT NULL DEFAULT true,
 retention_days integer NOT NULL DEFAULT 365 CHECK(retention_days BETWEEN 90 AND 3650)
);
CREATE TABLE IF NOT EXISTS md_monitor_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),actor_user_id uuid,
 correlation_id uuid NOT NULL,event_type text NOT NULL,resource text NOT NULL,method text NOT NULL,
 status_code integer NOT NULL,elapsed_ms integer NOT NULL,source_ip inet,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_monitor_events_tenant ON md_monitor_events(tenant_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS md_transaction_security_rules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES md_tenants(id),label text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,event_type text NOT NULL CHECK(event_type IN ('api','metadata','login')),
 method text NOT NULL CHECK(method IN ('*','GET','POST','PUT','PATCH','DELETE')),path_prefix text NOT NULL,
 threshold integer NOT NULL DEFAULT 1 CHECK(threshold BETWEEN 1 AND 100000),window_seconds integer NOT NULL DEFAULT 60 CHECK(window_seconds BETWEEN 1 AND 86400),
 response text NOT NULL CHECK(response IN ('Block','RevokeSessions','Flow')),flow_api text,service_user_id uuid,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,service_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_security_rule_windows(
 tenant_id uuid NOT NULL,rule_id uuid NOT NULL,user_id uuid NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL,
 PRIMARY KEY(tenant_id,rule_id,user_id),FOREIGN KEY(tenant_id,rule_id) REFERENCES md_transaction_security_rules(tenant_id,id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION md_rbac_decision(t uuid,u uuid,res text,act text)
RETURNS TABLE(allow_granted boolean,deny_granted boolean) LANGUAGE sql STABLE AS $$
 WITH assigned AS (
  SELECT permission_set_id,NULL::uuid AS group_id FROM md_permission_assignments WHERE tenant_id=t AND user_id=u
  UNION SELECT rp.permission_set_id,NULL::uuid FROM md_user_roles ur
   JOIN md_role_permission_sets rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
   WHERE ur.tenant_id=t AND ur.user_id=u
  UNION SELECT pp.permission_set_id,NULL::uuid FROM md_user_profiles up
   JOIN md_profile_permission_sets pp ON pp.tenant_id=up.tenant_id AND pp.profile_id=up.profile_id
   WHERE up.tenant_id=t AND up.user_id=u
  UNION SELECT gs.permission_set_id,ug.group_id FROM md_user_permission_groups ug
   JOIN md_permission_group_sets gs ON gs.tenant_id=ug.tenant_id AND gs.group_id=ug.group_id
   WHERE ug.tenant_id=t AND ug.user_id=u
 ), matched AS (
  SELECT r.effect,a.group_id FROM assigned a JOIN md_permission_rules r
   ON r.tenant_id=t AND r.permission_set_id=a.permission_set_id
   WHERE r.resource IN(res,'*',CASE WHEN res LIKE 'Flow:%' THEN 'Flow' ELSE res END)
   AND r.action IN(act,'*') AND (r.effect='deny' OR md_permission_set_licensed(t,u,a.permission_set_id))
  UNION ALL
  SELECT 'allow',a.group_id FROM assigned a JOIN md_permission_sets p ON p.tenant_id=t AND p.id=a.permission_set_id
   WHERE act='read' AND (res LIKE 'App:%' OR res LIKE 'Tab:%') AND p.navigation_default_access='Allow' AND md_permission_set_licensed(t,u,a.permission_set_id)
 )
 SELECT md_user_license_allows(t,u,res,act) AND COALESCE(bool_or(m.effect='allow' AND (m.group_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM md_permission_group_mutes gm WHERE gm.tenant_id=t AND gm.group_id=m.group_id
   AND gm.resource IN(res,'*',CASE WHEN res LIKE 'Flow:%' THEN 'Flow' ELSE res END) AND gm.action IN(act,'*')
 ))),false) AND EXISTS(SELECT 1 FROM md_users WHERE tenant_id=t AND id=u AND enabled AND (user_type='internal' OR (act='read' AND (EXISTS(SELECT 1 FROM md_object_definitions o WHERE o.tenant_id=t AND o.api_name=res) OR EXISTS(SELECT 1 FROM md_field_definitions f WHERE f.tenant_id=t AND f.object_api||'.'||f.api_name=res) OR res LIKE 'RecordType:%')))),
 COALESCE(bool_or(m.effect='deny'),false)
 FROM matched m
$$;
-- Schema reconciliation must not downgrade the reporting-aware record policy
-- installed by additive system migrations in an existing tenant database.
DO $md_record_guard$
BEGIN
 IF to_regprocedure('md_effective_reporting_scope(uuid,uuid,text)') IS NULL THEN
  EXECUTE $md_legacy_record_definition$
CREATE OR REPLACE FUNCTION md_record_access(t uuid,u uuid,rid uuid,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
 SELECT
 -- Object/record denies and restrictions also narrow ownership and broad grants.
 (NOT rec.is_deleted OR act='delete')
 AND NOT (SELECT deny_granted FROM md_rbac_decision(t,u,'Record:'||rec.id::text,act))
 AND md_rbac_allowed(t,u,rec.object_api,act)
 AND (rec.record_type_id IS NULL OR md_rbac_allowed(t,u,'RecordType:'||rec.object_api||'.'||rec.record_type_id,'read'))
 AND NOT EXISTS(SELECT 1 FROM md_record_policies rp WHERE rp.tenant_id=t AND rp.object_api=rec.object_api
  AND rp.kind='restriction' AND rp.enabled
  AND (rp.subject_type='all' OR (rp.subject_type='external' AND usr.user_type='external')
   OR (rp.subject_type='user' AND rp.subject_id=u) OR (rp.subject_type='role' AND EXISTS(
    SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=rp.subject_id)))
  AND NOT md_policy_matches(t,rp.id,rec.id))
 AND (CASE WHEN usr.user_type='external' THEN act='read' AND COALESCE(setting.portal_enabled,false)
   AND usr.external_account_id IS NOT NULL
   AND md_record_field(t,rec.id,setting.portal_account_field)=usr.external_account_id::text
 ELSE
 rec.owner_id=u OR (rec.owner_queue_id IS NOT NULL AND md_access_member(t,u,rec.owner_queue_id))
 OR md_rbac_allowed(t,u,'Record:'||rec.id::text,act)
 OR md_rbac_allowed(t,u,rec.object_api,'modifyAll') OR md_rbac_allowed(t,u,'Record','modifyAll')
 OR (act='read' AND (md_rbac_allowed(t,u,rec.object_api,'viewAll') OR md_rbac_allowed(t,u,'Record','viewAll')))
 OR (act='read' AND setting.default_access IN ('Public Read Only','Public Read/Write'))
 OR (act='edit' AND setting.default_access='Public Read/Write')
 OR (COALESCE(setting.use_hierarchy,true) AND EXISTS(
   SELECT 1 FROM md_user_role_tree(t,rec.owner_id) ancestor
   JOIN md_user_roles ur ON ur.tenant_id=t AND ur.user_id=u AND ur.role_id=ancestor.role_id
   WHERE NOT EXISTS(SELECT 1 FROM md_user_roles own WHERE own.tenant_id=t AND own.user_id=rec.owner_id AND own.role_id=ancestor.role_id)))
 OR (act IN ('read','edit') AND EXISTS(SELECT 1 FROM md_record_policies rp
  WHERE rp.tenant_id=t AND rp.object_api=rec.object_api AND rp.kind='share' AND rp.enabled
   AND (act='read' OR rp.access_level='Edit')
   AND (CASE rp.target_type WHEN 'User' THEN rp.target_id=u
    WHEN 'PublicGroup' THEN md_access_member(t,u,rp.target_id)
    WHEN 'Role' THEN EXISTS(SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=rp.target_id)
    WHEN 'RoleAndSubordinates' THEN rp.target_id IN(SELECT role_id FROM md_user_role_tree(t,u)) ELSE false END)
   AND (CASE rp.rule_type WHEN 'OwnerBased' THEN EXISTS(
    SELECT 1 FROM md_policy_owner_roles por JOIN md_user_roles own
     ON own.tenant_id=por.tenant_id AND own.role_id=por.role_id AND own.user_id=rec.owner_id
     WHERE por.tenant_id=t AND por.policy_id=rp.id)
    WHEN 'CriteriaBased' THEN md_policy_matches(t,rp.id,rec.id) ELSE false END)))
 END)
 FROM md_records rec JOIN md_users usr ON usr.tenant_id=t AND usr.id=u AND usr.enabled
 LEFT JOIN md_sharing_settings setting ON setting.tenant_id=t AND setting.object_api=rec.object_api
 WHERE rec.tenant_id=t AND rec.id=rid
 ),false)
$$;
$md_legacy_record_definition$;
 END IF;
END
$md_record_guard$;

CREATE TABLE IF NOT EXISTS md_oauth_clients(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),id uuid NOT NULL DEFAULT gen_random_uuid(),label text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,client_type text NOT NULL CHECK(client_type IN ('public','confidential')),
 secret_hash text,require_mfa boolean NOT NULL DEFAULT true,PRIMARY KEY(tenant_id,id),UNIQUE(id)
);
CREATE TABLE IF NOT EXISTS md_oauth_redirects(
 tenant_id uuid NOT NULL,client_id uuid NOT NULL,uri text NOT NULL,origin text NOT NULL,
 PRIMARY KEY(tenant_id,client_id,uri),FOREIGN KEY(tenant_id,client_id) REFERENCES md_oauth_clients(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_oauth_client_scopes(
 tenant_id uuid NOT NULL,client_id uuid NOT NULL,scope text NOT NULL CHECK(scope IN ('records:read','records:write','metadata:read','flows:execute')),
 PRIMARY KEY(tenant_id,client_id,scope),FOREIGN KEY(tenant_id,client_id) REFERENCES md_oauth_clients(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_oauth_client_users(
 tenant_id uuid NOT NULL,client_id uuid NOT NULL,user_id uuid NOT NULL,PRIMARY KEY(tenant_id,client_id,user_id),
 FOREIGN KEY(tenant_id,client_id) REFERENCES md_oauth_clients(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_oauth_consents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,client_id uuid NOT NULL,user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,client_id) REFERENCES md_oauth_clients(tenant_id,id),FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_oauth_codes(
 code_hash text PRIMARY KEY,tenant_id uuid NOT NULL,consent_id uuid NOT NULL,redirect_uri text NOT NULL,challenge text NOT NULL,
 mfa_verified boolean NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',consumed_at timestamptz,
 FOREIGN KEY(tenant_id,consent_id) REFERENCES md_oauth_consents(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_oauth_consent_scopes(
 tenant_id uuid NOT NULL,consent_id uuid NOT NULL,scope text NOT NULL,PRIMARY KEY(tenant_id,consent_id,scope),
 FOREIGN KEY(tenant_id,consent_id) REFERENCES md_oauth_consents(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_oauth_tokens(
 token_hash text PRIMARY KEY,tenant_id uuid NOT NULL,consent_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('access','refresh')),
 FOREIGN KEY(tenant_id,consent_id) REFERENCES md_oauth_consents(tenant_id,id)
);
CREATE OR REPLACE FUNCTION md_oauth_token_allowed(t uuid,u uuid,h text,path text,verb text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM md_oauth_tokens WHERE token_hash=h)
 OR EXISTS(SELECT 1 FROM md_oauth_tokens b
  JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id AND c.revoked_at IS NULL
  JOIN md_oauth_clients p ON p.tenant_id=c.tenant_id AND p.id=c.client_id AND p.enabled
  JOIN md_oauth_client_users a ON a.tenant_id=c.tenant_id AND a.client_id=c.client_id AND a.user_id=c.user_id
  JOIN md_oauth_consent_scopes s ON s.tenant_id=c.tenant_id AND s.consent_id=c.id
  JOIN md_oauth_client_scopes allowed ON allowed.tenant_id=c.tenant_id AND allowed.client_id=c.client_id AND allowed.scope=s.scope
  WHERE b.token_hash=h AND b.kind='access' AND b.tenant_id=t AND c.user_id=u AND md_rbac_allowed(t,u,'API','execute')
  AND (CASE s.scope
   WHEN 'records:read' THEN verb='GET' AND path ~ '^/(api/records(/|$)|services/data/v[0-9.]+/(query|queryAll|search|sobjects)(/|$))'
   WHEN 'records:write' THEN verb IN ('POST','PUT','PATCH','DELETE') AND path ~ '^/(api/records/|services/data/v[0-9.]+/sobjects/)'
   WHEN 'metadata:read' THEN verb='GET' AND path ~ '^/api/metadata/(objects|apps|pages|flows)(/|$)'
   WHEN 'flows:execute' THEN verb='POST' AND path ~ '^/api/flows/[A-Za-z][A-Za-z0-9_]*/run$'
   ELSE false END))
$$;
CREATE OR REPLACE FUNCTION md_oauth_refresh_allowed(h text,client uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (client IS NULL AND NOT EXISTS(SELECT 1 FROM md_oauth_tokens WHERE token_hash=h))
 OR EXISTS(SELECT 1 FROM md_oauth_tokens b JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id AND c.revoked_at IS NULL
  JOIN md_oauth_clients p ON p.tenant_id=c.tenant_id AND p.id=c.client_id AND p.enabled
  JOIN md_oauth_client_users a ON a.tenant_id=c.tenant_id AND a.client_id=c.client_id AND a.user_id=c.user_id
  WHERE b.token_hash=h AND b.kind='refresh' AND p.id=client AND md_user_licensed(c.tenant_id,c.user_id) AND md_rbac_allowed(c.tenant_id,c.user_id,'API','execute'))
$$;

-- Catalogue labels are SQL metadata; seeds preserve administrator customisations.
INSERT INTO md_system_permission_catalogue(permission_key,label,description,resource,action) VALUES
('metadata:read','View Setup','Central RBAC: ObjectDefinition / read','ObjectDefinition','read'),
('metadata:write','metadata — write','Central RBAC: ObjectDefinition / create','ObjectDefinition','create'),
('security:read','security — read','Central RBAC: Security / read','Security','read'),
('security:manage','Manage Users and Permissions','Central RBAC: Security / manage','Security','manage'),
('objects:manage','objects — manage','Central RBAC: ObjectDefinition / manage','ObjectDefinition','manage'),
('fields:create','fields — create','Central RBAC: FieldDefinition / create','FieldDefinition','create'),
('fields:delete','fields — delete','Central RBAC: FieldDefinition / delete','FieldDefinition','delete'),
('flows:manage','flows — manage','Central RBAC: FlowDefinition / manage','FlowDefinition','manage'),
('flows:run','flows — run','Central RBAC: Flow / execute','Flow','execute'),
('flows:system-context','flows — system-context','Central RBAC: FlowDefinition / system-context','FlowDefinition','system-context'),
('namedCredentials:manage','namedCredentials — manage','Central RBAC: NamedCredential / manage','NamedCredential','manage'),
('email:send','email — send','Central RBAC: Email / send','Email','send'),
('callouts:execute','callouts — execute','Central RBAC: NamedCredential / execute','NamedCredential','execute'),
('httpCallouts:execute','httpCallouts — execute','Central RBAC: HTTPCallout / execute','HTTPCallout','execute'),
('namedCredentials:read','namedCredentials — read','Central RBAC: NamedCredential / read','NamedCredential','read'),
('platformEvents:publish','platformEvents — publish','Central RBAC: PlatformEvent / publish','PlatformEvent','publish'),
('platformEvents:subscribe','platformEvents — subscribe','Central RBAC: PlatformEvent / subscribe','PlatformEvent','subscribe'),
('webhooks:manage','webhooks — manage','Central RBAC: WebhookSubscription / manage','WebhookSubscription','manage'),
('webhooks:read','webhooks — read','Central RBAC: WebhookSubscription / read','WebhookSubscription','read'),
('webhooks:execute','webhooks — execute','Central RBAC: WebhookSubscription / execute','WebhookSubscription','execute'),
('notifications:send','notifications — send','Central RBAC: Notification / send','Notification','send'),
('approvals:manage','approvals — manage','Central RBAC: ApprovalRequest / manage','ApprovalRequest','manage'),
('reports:manage','reports — manage','Central RBAC: SystemDefinition:reports / manage','SystemDefinition:reports','manage'),
('pages:manage','pages — manage','Central RBAC: PageDefinition / manage','PageDefinition','manage'),
('components:manage','components — manage','Central RBAC: ComponentDefinition / create','ComponentDefinition','create'),
('dashboards:manage','dashboards — manage','Central RBAC: SystemDefinition:dashboards / manage','SystemDefinition:dashboards','manage'),
('dashboards:viewTeam','dashboards — viewTeam','Central RBAC: SystemDefinition:dashboards / read','SystemDefinition:dashboards','read'),
('data:viewAll','View All Data','Central RBAC: Record / viewAll','Record','viewAll'),
('data:modifyAll','Modify All Data','Central RBAC: Record / modifyAll','Record','modifyAll'),
('api:enabled','API Enabled','Central RBAC: API / execute','API','execute'),
('users:read','users — read','Central RBAC: User / read','User','read'),
('users:create','users — create','Central RBAC: User / create','User','create'),
('users:edit','users — edit','Central RBAC: User / edit','User','edit'),
('users:delete','users — delete','Central RBAC: User / delete','User','delete'),
('audit:read','View Setup Audit Trail','Central RBAC: SetupAudit / read','SetupAudit','read'),
('audit:export','Export Setup Audit Trail','Central RBAC: SetupAudit / export','SetupAudit','export'),
('monitoring:read','monitoring — read','Central RBAC: SecurityMonitoring / read','SecurityMonitoring','read'),
('monitoring:manage','monitoring — manage','Central RBAC: SecurityMonitoring / manage','SecurityMonitoring','manage'),
('connectedApps:manage','Manage Connected Apps','Central RBAC: ConnectedApp / manage','ConnectedApp','manage')
ON CONFLICT(permission_key) DO NOTHING;
-- Default-deny classification for newly introduced md_* setup tables: all tables are
-- audited unless explicitly classified as business data, derived runtime state or logs.
CREATE OR REPLACE FUNCTION md_install_setup_audit() RETURNS void LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
 FOR n IN SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND starts_with(tablename,'md_')
  AND tablename NOT IN('md_records','md_record_values','md_record_multi_values','md_deleted_lookup_links','md_record_files','md_record_activities','md_record_chatter_posts','md_record_chatter_comments','md_record_history','md_record_lifecycle_audit','md_record_retention_audit','md_auto_number_counters','md_sessions','md_refresh_sessions','md_security_events','md_setup_audit_events','md_setup_audit_tables','md_monitor_events','md_security_rule_windows','md_rbac_revisions','md_password_history','md_password_reset_challenges','md_mfa_login_challenges','md_mfa_enrollment_tokens','md_mfa_backup_codes','md_webauthn_challenges','md_federation_requests','md_federation_tickets','md_saml_request_ids','md_oauth_codes','md_oauth_tokens','md_oauth_consents','md_oauth_consent_scopes','md_notifications','md_approval_requests','md_dashboard_snapshots','md_flow_runs','md_flow_run_inputs','md_flow_interview_state','md_flow_interview_values','md_flow_interview_records','md_flow_interview_record_fields','md_flow_interview_loop_state','md_flow_execution_audit','md_flow_execution_requests','md_flow_execution_result_values','md_flow_email_jobs','md_http_callout_jobs','md_http_callout_job_values','md_platform_event_deliveries','md_platform_event_messages','md_platform_event_values','md_webhook_deliveries','md_durable_jobs','md_durable_job_events','md_durable_job_values','md_encrypted_field_access_audit','md_tenant_recovery_cases','md_tenant_recovery_case_proofs','md_tenant_recovery_approvals','md_tenant_lifecycle_audit','md_global_value_set_audit','md_tenant_provisioning_requests','md_bootstrap_password_repairs','md_initial_password_rotations','md_system_migrations','md_schema_migrations','md_migrations','md_tenant_api_usage_daily','md_api_usage_daily','md_api_request_counts','md_offline_sync_receipts','md_data_import_jobs','md_data_import_rows','md_data_export_jobs') LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS md_capture_setup_mutation ON %I',n);
  EXECUTE format('CREATE TRIGGER md_capture_setup_mutation AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION md_capture_setup_mutation()',n);
  INSERT INTO md_setup_audit_tables VALUES(n) ON CONFLICT DO NOTHING;
 END LOOP;
END
$$;
SELECT md_install_setup_audit();
DROP TRIGGER IF EXISTS md_protect_setup_audit_truncate ON md_setup_audit_events;
CREATE TRIGGER md_protect_setup_audit_truncate BEFORE TRUNCATE ON md_setup_audit_events FOR EACH STATEMENT EXECUTE FUNCTION md_protect_setup_audit();

-- MCP credentials are explicitly bound to one HTTPS resource and retain central RBAC.
ALTER TABLE md_oauth_consents ADD COLUMN IF NOT EXISTS resource text;
ALTER TABLE md_oauth_client_scopes DROP CONSTRAINT IF EXISTS md_oauth_client_scopes_scope_check;
ALTER TABLE md_oauth_client_scopes ADD CONSTRAINT md_oauth_client_scopes_scope_check
 CHECK(scope IN ('records:read','records:write','metadata:read','metadata:write','flows:execute','mcp:access','operations:manage'));
INSERT INTO md_system_permission_catalogue(permission_key,label,description,resource,action) VALUES
 ('platformOperations:read','Read server operations','Inspect server service status and logs','PlatformOperations','read'),
 ('platformOperations:manage','Manage server operations','Restart services and activate staged releases','PlatformOperations','manage')
ON CONFLICT(permission_key) DO NOTHING;
CREATE OR REPLACE FUNCTION md_oauth_token_allowed(t uuid,u uuid,h text,path text,verb text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM md_oauth_tokens WHERE token_hash=h)
 OR EXISTS(SELECT 1 FROM md_oauth_tokens b
  JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id AND c.revoked_at IS NULL
  JOIN md_oauth_clients p ON p.tenant_id=c.tenant_id AND p.id=c.client_id AND p.enabled
  JOIN md_oauth_client_users a ON a.tenant_id=c.tenant_id AND a.client_id=c.client_id AND a.user_id=c.user_id
  JOIN md_oauth_consent_scopes s ON s.tenant_id=c.tenant_id AND s.consent_id=c.id
  JOIN md_oauth_client_scopes allowed ON allowed.tenant_id=c.tenant_id AND allowed.client_id=c.client_id AND allowed.scope=s.scope
  WHERE b.token_hash=h AND b.kind='access' AND b.tenant_id=t AND c.user_id=u AND md_rbac_allowed(t,u,'API','execute')
  AND (CASE s.scope
   WHEN 'mcp:access' THEN path='/api/mcp' AND verb IN ('POST','GET','DELETE')
   WHEN 'operations:manage' THEN false
   WHEN 'records:read' THEN verb='GET' AND path ~ '^/(api/records(/|$)|services/data/v[0-9.]+/(query|queryAll|search|sobjects)(/|$))'
   WHEN 'records:write' THEN verb IN ('POST','PUT','PATCH','DELETE') AND path ~ '^/(api/records/|services/data/v[0-9.]+/sobjects/)'
   WHEN 'metadata:read' THEN verb='GET' AND path ~ '^/api/metadata/(objects|apps|pages|flows)(/|$)'
   WHEN 'flows:execute' THEN verb='POST' AND path ~ '^/api/flows/[A-Za-z][A-Za-z0-9_]*/run$'
   ELSE false END))
$$;

-- Object Manager: compact highlights and per-object list actions.
CREATE TABLE IF NOT EXISTS md_object_compact_layouts (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 layout_id text NOT NULL CHECK(length(layout_id) BETWEEN 1 AND 128),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,object_api,layout_id),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_compact_layout_fields (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 layout_id text NOT NULL,
 field_api text NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order >= 0),
 PRIMARY KEY(tenant_id,object_api,layout_id,field_api),
 UNIQUE(tenant_id,object_api,layout_id,sort_order),
 FOREIGN KEY(tenant_id,object_api,layout_id) REFERENCES md_object_compact_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE TABLE IF NOT EXISTS md_object_compact_layout_assignments (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 profile_id text NOT NULL,
 record_type_id text NOT NULL,
 layout_id text NOT NULL,
 PRIMARY KEY(tenant_id,object_api,profile_id,record_type_id),
 FOREIGN KEY(tenant_id,object_api,layout_id) REFERENCES md_object_compact_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_list_view_buttons (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 button_name text NOT NULL CHECK(button_name IN ('New','Change Owner','Import','Printable View')),
 enabled boolean NOT NULL,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,object_api,button_name),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);

-- Core lookup-filter controls, mirrored in additive system migrations.
-- Tenant-scoped lookup filter metadata, shared by Record Engine and Object Manager.
CREATE TABLE IF NOT EXISTS md_object_lookup_filters (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 filter_id text NOT NULL CHECK(length(filter_id) BETWEEN 1 AND 128),
 field_api text NOT NULL,
 related_field_api text NOT NULL,
 operator text NOT NULL CHECK(operator IN ('Equals','Not Equal To','Contains','Starts With','Greater Than','Less Than','Is Null','Is Not Null')),
 value_text text NOT NULL DEFAULT '',
 value_field_api text,
 required boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,object_api,filter_id),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name),
 FOREIGN KEY(tenant_id,object_api,value_field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE INDEX IF NOT EXISTS md_object_lookup_filters_field
 ON md_object_lookup_filters(tenant_id,object_api,field_api,sort_order);
CREATE TABLE IF NOT EXISTS md_object_lookup_filter_logic (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 logic text NOT NULL CHECK(logic IN ('All','Any')),
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);

-- Object tab settings are tenant-scoped metadata; absence means no custom tab.
CREATE TABLE IF NOT EXISTS md_object_custom_tabs (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 style text NOT NULL CHECK(style IN ('Blue','Green','Orange','Purple','Red','Teal','Yellow')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);

-- Tenant-managed Object Manager metadata limits. Null = no configured limit.
-- The same trigger applies to APIs, builders, seeders and background operations.
CREATE TABLE IF NOT EXISTS md_object_metadata_limits (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 max_fields integer CHECK (max_fields IS NULL OR max_fields BETWEEN 1 AND 100000),
 max_page_layouts integer CHECK (max_page_layouts IS NULL OR max_page_layouts BETWEEN 1 AND 100000),
 max_record_types integer CHECK (max_record_types IS NULL OR max_record_types BETWEEN 1 AND 100000),
 max_field_sets integer CHECK (max_field_sets IS NULL OR max_field_sets BETWEEN 1 AND 100000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION md_enforce_object_metadata_limit() RETURNS trigger
LANGUAGE plpgsql AS $md_limit$
DECLARE configured_limit integer;
DECLARE used_count bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('metadata-limit:' || NEW.tenant_id::text || ':' || NEW.object_api));
 SELECT CASE TG_TABLE_NAME
  WHEN 'md_field_definitions' THEN max_fields
  WHEN 'md_object_page_layouts' THEN max_page_layouts
  WHEN 'md_object_record_types' THEN max_record_types
  WHEN 'md_object_field_sets' THEN max_field_sets
 END INTO configured_limit
 FROM md_object_metadata_limits
 WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api;
 IF configured_limit IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='md_field_definitions' THEN
  SELECT COUNT(*) INTO used_count FROM md_field_definitions
   WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND deleted_at IS NULL;
 ELSE
  EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id=$1 AND object_api=$2',TG_TABLE_NAME)
   INTO used_count USING NEW.tenant_id,NEW.object_api;
 END IF;
 IF used_count>configured_limit THEN
  RAISE EXCEPTION 'Object metadata limit exceeded for %: % > %',
    TG_TABLE_NAME,used_count,configured_limit USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$md_limit$;

DROP TRIGGER IF EXISTS md_limit_fields ON md_field_definitions;
CREATE TRIGGER md_limit_fields AFTER INSERT ON md_field_definitions
 FOR EACH ROW EXECUTE FUNCTION md_enforce_object_metadata_limit();
DROP TRIGGER IF EXISTS md_limit_page_layouts ON md_object_page_layouts;
CREATE TRIGGER md_limit_page_layouts AFTER INSERT ON md_object_page_layouts
 FOR EACH ROW EXECUTE FUNCTION md_enforce_object_metadata_limit();
DROP TRIGGER IF EXISTS md_limit_record_types ON md_object_record_types;
CREATE TRIGGER md_limit_record_types AFTER INSERT ON md_object_record_types
 FOR EACH ROW EXECUTE FUNCTION md_enforce_object_metadata_limit();
DROP TRIGGER IF EXISTS md_limit_field_sets ON md_object_field_sets;
CREATE TRIGGER md_limit_field_sets AFTER INSERT ON md_object_field_sets
 FOR EACH ROW EXECUTE FUNCTION md_enforce_object_metadata_limit();

-- Phase 2C: enforce relationship target object and active-record integrity at storage.
-- Existing tenant FK alone prevents cross-tenant IDs but not same-tenant wrong-object IDs.
CREATE OR REPLACE FUNCTION md_validate_relationship_record_target()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_object text;
BEGIN
 IF NEW.reference_record_id IS NULL THEN RETURN NEW; END IF;
 SELECT f.related_object INTO target_object
 FROM md_field_definitions f
 WHERE f.tenant_id=NEW.tenant_id AND f.object_api=NEW.object_api
   AND f.api_name=NEW.field_api AND f.data_type='reference' AND f.deleted_at IS NULL;
 IF target_object IS NULL OR NOT EXISTS(
   SELECT 1 FROM md_records r
   WHERE r.tenant_id=NEW.tenant_id AND r.object_api=target_object
     AND r.id=NEW.reference_record_id AND r.is_deleted=false
   FOR SHARE
 ) THEN RAISE EXCEPTION 'Invalid relationship target for field %',NEW.field_api
   USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_validate_relationship_target_record ON md_record_values;
CREATE TRIGGER md_validate_relationship_target_record
 BEFORE INSERT OR UPDATE OF reference_record_id,object_api,field_api
 ON md_record_values FOR EACH ROW
 EXECUTE FUNCTION md_validate_relationship_record_target();

-- Inbound deletes, inverse related lists and relationship metadata traversal stay indexed.
CREATE INDEX IF NOT EXISTS md_record_values_relationship_inbound
 ON md_record_values(tenant_id,reference_record_id,object_api,field_api,record_id)
 WHERE reference_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_field_definitions_relationship_inbound
 ON md_field_definitions(tenant_id,related_object,object_api,api_name)
 WHERE data_type='reference' AND deleted_at IS NULL;

-- One-time platform deployment owner bootstrap receipt. Revocations are never
-- undone by later startup seeders; additional operators are assigned via RBAC.
CREATE TABLE IF NOT EXISTS md_platform_deployment_owner_receipts (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);

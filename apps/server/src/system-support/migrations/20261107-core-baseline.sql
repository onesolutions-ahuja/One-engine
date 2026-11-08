-- One SQL baseline version for fresh disposable/test databases.
-- Starts after src/system-files/schema.sql; preserves original ordering and SQL.
-- Do NOT apply to an existing populated database with old migration receipts.
-- All 279 prior migrations are captured inside this version, not loaded as separate files.

-- BEGIN ORIGINAL MIGRATION 001-metadata-bindings.sql
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'Autolaunched Flow';
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
-- END ORIGINAL MIGRATION 001-metadata-bindings.sql

-- BEGIN ORIGINAL MIGRATION 20261018-address-compound.sql
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_postal_code text;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS address_country text;
-- END ORIGINAL MIGRATION 20261018-address-compound.sql

-- BEGIN ORIGINAL MIGRATION 20261018-named-credentials.sql
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
-- END ORIGINAL MIGRATION 20261018-named-credentials.sql

-- BEGIN ORIGINAL MIGRATION 20261018-record-history.sql
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
-- END ORIGINAL MIGRATION 20261018-record-history.sql

-- BEGIN ORIGINAL MIGRATION 20261018-system-definitions.sql
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
-- END ORIGINAL MIGRATION 20261018-system-definitions.sql

-- BEGIN ORIGINAL MIGRATION 20261018-tenant-domains-usage.sql
-- Shared tenant metadata. Verification never follows from inserting a pending claim.
CREATE TABLE IF NOT EXISTS md_tenant_domain_claims (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 domain text NOT NULL,
 proof_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz,
 PRIMARY KEY(tenant_id,domain),
 UNIQUE(domain),
 CHECK (domain=lower(domain))
);
ALTER TABLE md_tenant_domains
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_tenant_domains
 ADD COLUMN IF NOT EXISTS verified_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS md_tenant_usage_targets (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 metric text NOT NULL CHECK(metric IN ('users','records','objects','flows')),
 target_value bigint NOT NULL CHECK(target_value BETWEEN 1 AND 1000000000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,metric)
);
-- END ORIGINAL MIGRATION 20261018-tenant-domains-usage.sql

-- BEGIN ORIGINAL MIGRATION 20261018-tenant-lifecycle.sql
-- Additive tenant lifecycle fields. Preserve tenants, users, domains and business records.
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS retention_until timestamptz;
ALTER TABLE md_tenants ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='md_tenants_status_check' AND conrelid='md_tenants'::regclass) THEN
  ALTER TABLE md_tenants ADD CONSTRAINT md_tenants_status_check CHECK(status IN ('ACTIVE','SUSPENDED','ARCHIVED'));
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS md_tenant_lifecycle_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 actor_user_id uuid NOT NULL,
 target_tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 operation text NOT NULL,
 previous_status text NOT NULL,
 new_status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (actor_tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_tenant_lifecycle_audit_target ON md_tenant_lifecycle_audit(target_tenant_id,created_at DESC);

ALTER TABLE md_users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS md_tenant_provisioning_requests (
 actor_tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 actor_user_id uuid NOT NULL,
 request_key uuid NOT NULL,
 request_digest text NOT NULL,
 target_tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (actor_tenant_id,actor_user_id,request_key),
 FOREIGN KEY (actor_tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
-- END ORIGINAL MIGRATION 20261018-tenant-lifecycle.sql

-- BEGIN ORIGINAL MIGRATION 20261018-tenant-settings.sql
-- Additive, tenant-isolated settings storage. Preserve existing tenants and metadata.
CREATE TABLE IF NOT EXISTS md_tenant_settings (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  setting_key text NOT NULL CHECK (setting_key IN ('company-profile','currencies','automation-settings')),
  properties jsonb NOT NULL CHECK (jsonb_typeof(properties)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,setting_key)
);
-- END ORIGINAL MIGRATION 20261018-tenant-settings.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zz-flow-run-cancellation.sql
-- Additive upgrade: explicit cancellation state for durable SQL Flow interviews.
-- Preserves all existing runs, statuses and timestamps.
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_status_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_status_check
  CHECK (status IN ('pending','completed','failed','cancelled'));
-- END ORIGINAL MIGRATION 20261018-zz-flow-run-cancellation.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzz-app-route-aliases.sql
-- Tenant-aware versioned friendly app route metadata.
-- Additive only: existing app installations and business records are preserved.
CREATE TABLE IF NOT EXISTS md_app_route_aliases (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  app_api text NOT NULL REFERENCES md_apps(api_name),
  slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  kind text NOT NULL CHECK (kind IN ('App Home','App Page','Record List')),
  target_api text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Disabled')),
  version integer NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,app_api,slug)
);
-- END ORIGINAL MIGRATION 20261018-zzz-app-route-aliases.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzz-notifications.sql
-- Durable tenant- and recipient-scoped shared notifications.
CREATE TABLE IF NOT EXISTS md_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 recipient_id uuid NOT NULL,
 title text NOT NULL,
 body text NOT NULL DEFAULT '',
 flow_api_name text NOT NULL DEFAULT '',
 sent_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,sent_by) REFERENCES md_users(tenant_id,id),
 UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_notifications_inbox ON md_notifications(tenant_id,recipient_id,created_at DESC);
-- END ORIGINAL MIGRATION 20261018-zzzz-notifications.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzz-object-page-layouts.sql
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
 page_type text NOT NULL CHECK(page_type IN ('Record Page','App Page','Home Page')),
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
-- END ORIGINAL MIGRATION 20261018-zzzz-object-page-layouts.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzz-approval-requests.sql
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
-- END ORIGINAL MIGRATION 20261018-zzzzz-approval-requests.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzz-oneengine-identity.sql
-- Preserve existing tenant grants and assignments when adopting the OneEngine name.
-- Never create a second wildcard grant or change another tenant's permission set.
UPDATE md_permission_sets target
SET api_name='OneEngine'
WHERE target.api_name='TenantDeveloper'
  AND NOT EXISTS (
    SELECT 1 FROM md_permission_sets present
    WHERE present.tenant_id=target.tenant_id AND present.api_name='OneEngine'
  );
-- END ORIGINAL MIGRATION 20261018-zzzzzz-oneengine-identity.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzz-record-ownership.sql
-- Universal record ownership is tenant-bound and independent of business Objects.
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='md_records_owner_tenant_fkey') THEN
  ALTER TABLE md_records ADD CONSTRAINT md_records_owner_tenant_fkey
   FOREIGN KEY(tenant_id,owner_id) REFERENCES md_users(tenant_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS md_records_owner_lookup ON md_records(tenant_id,owner_id,object_api);
-- END ORIGINAL MIGRATION 20261018-zzzzzz-record-ownership.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzz-record-collaboration.sql
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
-- END ORIGINAL MIGRATION 20261018-zzzzzzz-record-collaboration.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzzz-password-recovery-settings.sql
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
-- END ORIGINAL MIGRATION 20261018-zzzzzzzz-password-recovery-settings.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzzzz-security-events.sql
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
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
-- END ORIGINAL MIGRATION 20261018-zzzzzzzzz-security-events.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzzzzz-field-types.sql
-- Extended scalar field metadata stays fully relational and tenant-scoped.
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS picklist_restricted boolean NOT NULL DEFAULT true;
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
-- END ORIGINAL MIGRATION 20261018-zzzzzzzzzz-field-types.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzzzzzz-builder-contracts.sql
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
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS md_flow_definitions_latest
 ON md_flow_definitions(tenant_id,api_name,version DESC) WHERE archived=false;

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
-- END ORIGINAL MIGRATION 20261018-zzzzzzzzzzz-builder-contracts.sql

-- BEGIN ORIGINAL MIGRATION 20261018-zzzzzzzzzzzz-record-field-list-fixes.sql
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

ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS is_unique boolean NOT NULL DEFAULT false;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS case_sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS geo_latitude double precision;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS geo_longitude double precision;

CREATE UNIQUE INDEX IF NOT EXISTS md_record_values_unique_ci
  ON md_record_values(tenant_id,object_api,field_api,lower(value_text))
  WHERE is_unique AND NOT case_sensitive AND value_text IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS md_record_values_unique_cs
  ON md_record_values(tenant_id,object_api,field_api,value_text)
  WHERE is_unique AND case_sensitive AND value_text IS NOT NULL;

CREATE TABLE IF NOT EXISTS md_auto_number_counters (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id),
  object_api text NOT NULL,
  field_api text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value > 0),
  PRIMARY KEY(tenant_id,object_api,field_api),
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261018-zzzzzzzzzzzz-record-field-list-fixes.sql

-- BEGIN ORIGINAL MIGRATION 20261019-flow-interviews.sql
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
-- END ORIGINAL MIGRATION 20261019-flow-interviews.sql

-- BEGIN ORIGINAL MIGRATION 20261019-formula-clone-context.sql
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS is_clone boolean NOT NULL DEFAULT false;
-- END ORIGINAL MIGRATION 20261019-formula-clone-context.sql

-- BEGIN ORIGINAL MIGRATION 20261019-global-value-sets.sql
CREATE TABLE IF NOT EXISTS md_global_value_sets (
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
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
  sort_order integer NOT NULL CHECK(sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,value_set_id,value),
  FOREIGN KEY(tenant_id,value_set_id)
    REFERENCES md_global_value_sets(tenant_id,id) ON DELETE CASCADE
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
-- END ORIGINAL MIGRATION 20261019-global-value-sets.sql

-- BEGIN ORIGINAL MIGRATION 20261019-prepare-field-recycle-column.sql
-- Upgrade compatibility: rollup-summaries creates a partial index referencing
-- deleted_at before the later field-recycle-bin migration on existing SQL tenants.
-- This additive precondition is idempotent and never modifies field records.
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- END ORIGINAL MIGRATION 20261019-prepare-field-recycle-column.sql

-- BEGIN ORIGINAL MIGRATION 20261019-record-type-integrity.sql
-- Enforce tenant/object-scoped Record Type references for new writes.
-- NOT VALID preserves existing business rows until a separately audited validation.
-- PostgreSQL still enforces this foreign key for new inserts and changed references.
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conname='md_records_record_type_tenant_object_fk'
     AND conrelid='md_records'::regclass
 ) THEN
   ALTER TABLE md_records
     ADD CONSTRAINT md_records_record_type_tenant_object_fk
     FOREIGN KEY (tenant_id,object_api,record_type_id)
     REFERENCES md_object_record_types(tenant_id,object_api,record_type_id)
     NOT VALID;
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20261019-record-type-integrity.sql

-- BEGIN ORIGINAL MIGRATION 20261019-rich-text-inline-images.sql
CREATE TABLE IF NOT EXISTS md_record_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  object_api text NOT NULL,
  record_id uuid NOT NULL,
  field_api text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/gif','image/webp')),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
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
-- END ORIGINAL MIGRATION 20261019-rich-text-inline-images.sql

-- BEGIN ORIGINAL MIGRATION 20261019-rollup-summaries.sql
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_child_object text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_relationship_field text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_operation text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS rollup_source_field text;
ALTER TABLE md_field_definitions ADD CONSTRAINT md_field_rollup_operation_check
  CHECK (rollup_operation IS NULL OR rollup_operation IN ('COUNT','SUM','MIN','MAX'));
CREATE INDEX IF NOT EXISTS md_field_rollup_child
  ON md_field_definitions(tenant_id,rollup_child_object)
  WHERE data_type='rollup' AND deleted_at IS NULL;
-- END ORIGINAL MIGRATION 20261019-rollup-summaries.sql

-- BEGIN ORIGINAL MIGRATION 20261020-app-package-lifecycle.sql
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
-- END ORIGINAL MIGRATION 20261020-app-package-lifecycle.sql

-- BEGIN ORIGINAL MIGRATION 20261020-b-app-package-templates.sql
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
-- END ORIGINAL MIGRATION 20261020-b-app-package-templates.sql

-- BEGIN ORIGINAL MIGRATION 20261020-c-app-package-page-properties.sql
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
-- END ORIGINAL MIGRATION 20261020-c-app-package-page-properties.sql

-- BEGIN ORIGINAL MIGRATION 20261020-declarative-rules.sql
-- Tenant-scoped declarative validation and formula default definitions.
CREATE TABLE IF NOT EXISTS md_validation_rules (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 expression text NOT NULL CHECK(length(expression) BETWEEN 1 AND 4000),
 error_message text NOT NULL CHECK(length(error_message) BETWEEN 1 AND 1000),
 error_field_api text,
 active boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,api_name),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,error_field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE INDEX IF NOT EXISTS md_validation_rules_active
 ON md_validation_rules(tenant_id,object_api,sort_order,api_name) WHERE active=true;
CREATE TABLE IF NOT EXISTS md_field_default_formulas (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 expression text NOT NULL CHECK(length(expression) BETWEEN 1 AND 4000),
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api,field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261020-declarative-rules.sql

-- BEGIN ORIGINAL MIGRATION 20261020-named-credential-key-version.sql
-- Track encryption-key identity separately from ciphertext.
-- Existing ciphertext retains the legacy key identity until explicitly re-encrypted.
ALTER TABLE md_named_credentials
  ADD COLUMN IF NOT EXISTS encryption_key_id text NOT NULL DEFAULT 'legacy';
-- END ORIGINAL MIGRATION 20261020-named-credential-key-version.sql

-- BEGIN ORIGINAL MIGRATION 20261020-p1-matching-rules.sql
-- Matching is deterministic exact comparison, scoped to a tenant and object.
CREATE TABLE IF NOT EXISTS md_matching_rules (
 tenant_id uuid NOT NULL, object_api text NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 active boolean NOT NULL DEFAULT false,
 match_mode text NOT NULL DEFAULT 'All' CHECK(match_mode IN ('All','Any')),
 action text NOT NULL DEFAULT 'Alert' CHECK(action IN ('Alert','Block')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,api_name),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_matching_rule_fields (
 tenant_id uuid NOT NULL, object_api text NOT NULL, rule_api text NOT NULL,
 field_api text NOT NULL, case_sensitive boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,object_api,rule_api,field_api),
 FOREIGN KEY(tenant_id,object_api,rule_api) REFERENCES md_matching_rules(tenant_id,object_api,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api) REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE TABLE IF NOT EXISTS md_duplicate_record_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,object_api text NOT NULL,rule_api text NOT NULL,
 record_id uuid NOT NULL, matched_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,object_api,rule_api,record_id,matched_record_id),
 FOREIGN KEY(tenant_id,object_api,rule_api) REFERENCES md_matching_rules(tenant_id,object_api,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,record_id,object_api) REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,matched_record_id,object_api) REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
 CHECK(record_id<>matched_record_id)
);
CREATE INDEX IF NOT EXISTS md_duplicate_record_sets_lookup ON md_duplicate_record_sets(tenant_id,object_api,record_id,created_at DESC);
-- END ORIGINAL MIGRATION 20261020-p1-matching-rules.sql

-- BEGIN ORIGINAL MIGRATION 20261020-rbac-administration.sql
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
CREATE OR REPLACE FUNCTION md_record_access(t uuid,u uuid,rid uuid,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
 SELECT
 -- Object/record denies and restrictions also narrow ownership and broad grants.
 NOT (SELECT deny_granted FROM md_rbac_decision(t,u,'Record:'||rec.id::text,act))
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
-- END ORIGINAL MIGRATION 20261020-rbac-administration.sql

-- BEGIN ORIGINAL MIGRATION 20261020-z-declarative-rule-history.sql
-- Preserve declarative rule history across edits while keeping active metadata relational.
ALTER TABLE md_validation_rules ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1
 CHECK(revision>0);
ALTER TABLE md_field_default_formulas ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1
 CHECK(revision>0);

CREATE TABLE IF NOT EXISTS md_validation_rule_history(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 rule_api text NOT NULL,
 revision integer NOT NULL,
 label text NOT NULL,
 expression text NOT NULL,
 error_message text NOT NULL,
 error_field_api text,
 active boolean NOT NULL,
 sort_order integer NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,rule_api,revision),
 FOREIGN KEY(tenant_id,object_api)
   REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_field_default_formula_history(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 revision integer NOT NULL,
 expression text NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,field_api,revision),
 FOREIGN KEY(tenant_id,object_api)
   REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261020-z-declarative-rule-history.sql

-- BEGIN ORIGINAL MIGRATION 20261021-app-package-home-pages.sql
CREATE TABLE IF NOT EXISTS md_app_package_home_page_templates (
 app_id uuid NOT NULL,version integer NOT NULL,
 page_api text NOT NULL CHECK(page_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 form_factor text NOT NULL CHECK(form_factor IN ('desktop','tablet','phone')),
 PRIMARY KEY(app_id,version,form_factor),
 FOREIGN KEY(app_id,version,page_api)
   REFERENCES md_app_package_page_templates(app_id,version,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261021-app-package-home-pages.sql

-- BEGIN ORIGINAL MIGRATION 20261021-component-library-versioning.sql
-- Reuse the tenant-scoped shared Component definition registry for version history.
-- Flexible, schema-validated component display metadata is kept in JSONB; active
-- version, state and revision numbers remain relational and independently queried.
CREATE TABLE IF NOT EXISTS md_component_library_versions(
 tenant_id uuid NOT NULL,
 component_api text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('Draft','Published')),
 properties jsonb NOT NULL CHECK(jsonb_typeof(properties)='object'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,component_api,version),
 FOREIGN KEY(tenant_id,component_api) REFERENCES md_component_definitions(tenant_id,api_name),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_component_library_heads(
 tenant_id uuid NOT NULL,
 component_api text NOT NULL,
 current_version integer NOT NULL CHECK(current_version>0),
 published_version integer CHECK(published_version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,component_api),
 FOREIGN KEY(tenant_id,component_api) REFERENCES md_component_definitions(tenant_id,api_name),
 FOREIGN KEY(tenant_id,component_api,current_version) REFERENCES md_component_library_versions(tenant_id,component_api,version),
 FOREIGN KEY(tenant_id,component_api,published_version) REFERENCES md_component_library_versions(tenant_id,component_api,version)
);
-- END ORIGINAL MIGRATION 20261021-component-library-versioning.sql

-- BEGIN ORIGINAL MIGRATION 20261021-durable-jobs.sql
-- Shared, application-neutral and tenant-isolated durable job substrate.
-- Dispatch and execution must additionally enforce central RBAC, app licensing,
-- active published metadata and execution-context policy.
CREATE TABLE IF NOT EXISTS md_durable_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_api_name text,
 job_type text NOT NULL CHECK (length(job_type) BETWEEN 1 AND 128),
 resource_id text,
 resource_version integer CHECK(resource_version>0),
 actor_user_id uuid,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','completed','failed','cancelled')),
 scheduled_at timestamptz NOT NULL DEFAULT now(),
 recurrence_seconds integer CHECK(recurrence_seconds BETWEEN 60 AND 31536000),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100),
 lease_owner text,
 lease_until timestamptz,
 idempotency_key text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 FOREIGN KEY (tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id),
 CONSTRAINT md_durable_jobs_lease CHECK(status <> 'leased' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS md_durable_jobs_idempotent
 ON md_durable_jobs(tenant_id,job_type,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_durable_jobs_ready
 ON md_durable_jobs(scheduled_at,id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS md_durable_jobs_tenant_status
 ON md_durable_jobs(tenant_id,status,scheduled_at);
CREATE INDEX IF NOT EXISTS md_durable_jobs_expired
 ON md_durable_jobs(lease_until) WHERE status='leased';
-- Payloads are deliberately NOT JSONB. Store versioned execution inputs through
-- typed child rows before enabling dispatch.
CREATE TABLE IF NOT EXISTS md_durable_job_values(
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 name text NOT NULL,
 value_text text,
 value_number numeric,
 value_boolean boolean,
 value_datetime timestamptz,
 reference_id uuid,
 PRIMARY KEY(tenant_id,job_id,name),
 FOREIGN KEY(tenant_id,job_id) REFERENCES md_durable_jobs(tenant_id,id) ON DELETE CASCADE,
 CHECK(num_nonnulls(value_text,value_number,value_boolean,value_datetime,reference_id)<=1)
);
-- END ORIGINAL MIGRATION 20261021-durable-jobs.sql

-- BEGIN ORIGINAL MIGRATION 20261021-field-dependencies.sql
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
-- END ORIGINAL MIGRATION 20261021-field-dependencies.sql

-- BEGIN ORIGINAL MIGRATION 20261021-field-recycle-bin.sql
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS md_field_definitions_recycle_bin
  ON md_field_definitions(tenant_id,deleted_at) WHERE deleted_at IS NOT NULL;
-- END ORIGINAL MIGRATION 20261021-field-recycle-bin.sql

-- BEGIN ORIGINAL MIGRATION 20261021-multipicklist-storage.sql
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

INSERT INTO md_record_multi_values(tenant_id,record_id,object_api,field_api,value,sort_order)
SELECT v.tenant_id,v.record_id,v.object_api,v.field_api,selected.value,
       selected.ordinality::integer-1
FROM md_record_values v
JOIN md_field_definitions f
  ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
CROSS JOIN LATERAL unnest(string_to_array(v.value_text,';')) WITH ORDINALITY AS selected(value,ordinality)
WHERE f.data_type='multipicklist' AND v.value_text IS NOT NULL AND v.value_text<>''
ON CONFLICT(tenant_id,record_id,field_api,value) DO NOTHING;
-- END ORIGINAL MIGRATION 20261021-multipicklist-storage.sql

-- BEGIN ORIGINAL MIGRATION 20261021-relationship-options.sql
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS relationship_name text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS child_relationship_name text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS delete_behavior text;
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS allow_reparenting boolean NOT NULL DEFAULT false;
-- END ORIGINAL MIGRATION 20261021-relationship-options.sql

-- BEGIN ORIGINAL MIGRATION 20261021-typed-record-values.sql
-- Additive typed projections; legacy text remains for backward compatibility.
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS value_number numeric;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS value_date date;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS value_datetime timestamptz;
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS value_boolean boolean;

CREATE OR REPLACE FUNCTION md_record_value_typed_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
 SELECT data_type INTO kind FROM md_field_definitions
 WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND api_name=NEW.field_api;
 NEW.value_number:=NULL;
 NEW.value_date:=NULL;
 NEW.value_datetime:=NULL;
 NEW.value_boolean:=NULL;
 IF NEW.value_text IS NULL THEN RETURN NEW; END IF;
 IF kind IN ('number','currency','percent') THEN
   NEW.value_number:=NEW.value_text::numeric;
 ELSIF kind='date' THEN
   NEW.value_date:=NEW.value_text::date;
 ELSIF kind='datetime' THEN
   NEW.value_datetime:=NEW.value_text::timestamptz;
 ELSIF kind='boolean' THEN
   NEW.value_boolean:=NEW.value_text::boolean;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_record_value_typed_sync ON md_record_values;
CREATE TRIGGER md_record_value_typed_sync
BEFORE INSERT OR UPDATE OF value_text,field_api,object_api ON md_record_values
FOR EACH ROW EXECUTE FUNCTION md_record_value_typed_projection();

-- Legacy numeric/boolean values are backfilled only when safe to cast.
UPDATE md_record_values v SET value_number=v.value_text::numeric
FROM md_field_definitions f
WHERE f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
 AND f.data_type IN ('number','currency','percent')
 AND v.value_text ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
 AND v.value_number IS NULL;
UPDATE md_record_values v SET value_boolean=v.value_text::boolean
FROM md_field_definitions f
WHERE f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
 AND f.data_type='boolean' AND v.value_text IN ('true','false')
 AND v.value_boolean IS NULL;

-- Invalid historical date/time strings remain unchanged; do not abort migration.
CREATE OR REPLACE FUNCTION md_try_record_date(raw text) RETURNS date
LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF raw IS NULL OR raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
 RETURN raw::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION md_try_record_datetime(raw text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF raw IS NULL OR raw !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN NULL; END IF;
 RETURN raw::timestamptz;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;
UPDATE md_record_values v SET value_date=md_try_record_date(v.value_text)
FROM md_field_definitions f
WHERE f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
 AND f.data_type='date' AND v.value_text IS NOT NULL AND v.value_date IS NULL;
UPDATE md_record_values v SET value_datetime=md_try_record_datetime(v.value_text)
FROM md_field_definitions f
WHERE f.tenant_id=v.tenant_id AND f.object_api=v.object_api AND f.api_name=v.field_api
 AND f.data_type='datetime' AND v.value_text IS NOT NULL AND v.value_datetime IS NULL;

CREATE INDEX IF NOT EXISTS md_record_values_numeric_idx ON md_record_values(tenant_id,object_api,field_api,value_number) WHERE value_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_record_values_date_idx ON md_record_values(tenant_id,object_api,field_api,value_date) WHERE value_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_record_values_datetime_idx ON md_record_values(tenant_id,object_api,field_api,value_datetime) WHERE value_datetime IS NOT NULL;
-- END ORIGINAL MIGRATION 20261021-typed-record-values.sql

-- BEGIN ORIGINAL MIGRATION 20261021-user-landing-app.sql
ALTER TABLE md_users
  ADD COLUMN IF NOT EXISTS landing_app_api text NOT NULL DEFAULT 'Setup';
-- END ORIGINAL MIGRATION 20261021-user-landing-app.sql

-- BEGIN ORIGINAL MIGRATION 20261021-validate-record-type-fk.sql
-- Once legacy references have been reconciled, validate the existing tenant/object FK.
-- This does not change any customer record. Invalid legacy references cause a safe failure.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM md_records r
   WHERE r.record_type_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM md_object_record_types t
     WHERE t.tenant_id=r.tenant_id AND t.object_api=r.object_api
       AND t.record_type_id=r.record_type_id
   )
 ) THEN
   RAISE EXCEPTION 'Legacy record type references require correction before FK validation';
 END IF;
END $$;
ALTER TABLE md_records VALIDATE CONSTRAINT md_records_record_type_tenant_object_fk;
-- END ORIGINAL MIGRATION 20261021-validate-record-type-fk.sql

-- BEGIN ORIGINAL MIGRATION 20261022-acetill-visual-drafts.sql
-- The live Acetill React terminal remains the original design.
-- Visual editor changes are saved as drafts, never auto-published.
CREATE TABLE IF NOT EXISTS md_acetill_visual_styles (
  tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id) ON DELETE CASCADE,
  draft_styles jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(draft_styles)='object'),
  published_styles jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(published_styles)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Existing entitled tenants need a visible Page Builder entry now; new installs
-- receive the same draft via the explicit Acetill installation hook.
INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled)
SELECT i.tenant_id,'AcetillRegisterEditable','Acetill Terminal (Editable Copy)',true
FROM md_app_installations i
JOIN md_apps a ON a.id=i.app_id AND a.api_name='Acetill' AND a.enabled=true
JOIN md_app_entitlements e ON e.tenant_id=i.tenant_id AND e.app_id=i.app_id
WHERE e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
ON CONFLICT(tenant_id,api_name) DO NOTHING;

INSERT INTO md_lightning_page_details
 (tenant_id,page_id,page_type,target_object,layout_mode,template,canvas_width,canvas_height,status,devices,revision)
SELECT p.tenant_id,p.id,'App Page','','template','main-sidebar',1440,900,'Draft',ARRAY['Desktop','Phone']::text[],1
FROM md_page_definitions p
JOIN md_app_installations i ON i.tenant_id=p.tenant_id
JOIN md_apps a ON a.id=i.app_id AND a.api_name='Acetill' AND a.enabled=true
JOIN md_app_entitlements e ON e.tenant_id=i.tenant_id AND e.app_id=i.app_id
WHERE p.api_name='AcetillRegisterEditable' AND p.enabled=true
  AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
ON CONFLICT(tenant_id,page_id) DO NOTHING;
-- END ORIGINAL MIGRATION 20261022-acetill-visual-drafts.sql

-- BEGIN ORIGINAL MIGRATION 20261022-dashboard-snapshots.sql
-- Tenant-scoped immutable dashboard results; snapshots do not confer data access.
CREATE TABLE IF NOT EXISTS md_dashboard_snapshots(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 dashboard_kind text NOT NULL DEFAULT 'dashboards' CHECK(dashboard_kind='dashboards'),
 dashboard_api text NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 created_by uuid NOT NULL,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,dashboard_kind,dashboard_api) REFERENCES md_system_definitions(tenant_id,kind,api_name)
);
CREATE INDEX IF NOT EXISTS md_dashboard_snapshots_lookup
 ON md_dashboard_snapshots(tenant_id,dashboard_api,created_at DESC);
-- END ORIGINAL MIGRATION 20261022-dashboard-snapshots.sql

-- BEGIN ORIGINAL MIGRATION 20261022-dashboard-subscriptions.sql
-- Dashboard delivery uses shared metadata and encrypted Named Credentials.
-- SQL owns schedule state, which can be picked up by the shared durable job worker.
CREATE TABLE IF NOT EXISTS md_dashboard_subscriptions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 dashboard_kind text NOT NULL DEFAULT 'dashboards' CHECK(dashboard_kind='dashboards'),
 dashboard_api text NOT NULL,
 owner_user_id uuid NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 frequency text NOT NULL CHECK(frequency IN ('Daily','Weekly')),
 local_time time NOT NULL,
 time_zone text NOT NULL,
 day_of_week integer CHECK(day_of_week BETWEEN 0 AND 6),
 recipient_user_ids uuid[] NOT NULL,
 credential_id uuid NOT NULL,
 from_email text NOT NULL,
 active boolean NOT NULL DEFAULT false,
 save_snapshots boolean NOT NULL DEFAULT true,
 next_run_at timestamptz NOT NULL,
 last_run_at timestamptz,
 last_run_status text NOT NULL DEFAULT 'Never' CHECK(last_run_status IN ('Never','Pending','Success','Failed')),
 last_run_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,dashboard_kind,dashboard_api) REFERENCES md_system_definitions(tenant_id,kind,api_name),
 FOREIGN KEY(tenant_id,owner_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_dashboard_subscriptions_due ON md_dashboard_subscriptions(next_run_at)
 WHERE active=true;
-- END ORIGINAL MIGRATION 20261022-dashboard-subscriptions.sql

-- BEGIN ORIGINAL MIGRATION 20261022-flow-http-callout-jobs.sql
CREATE TABLE IF NOT EXISTS md_http_callout_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 node_id integer NOT NULL,
 user_id uuid NOT NULL,
 credential_id uuid NOT NULL,
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
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
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
-- END ORIGINAL MIGRATION 20261022-flow-http-callout-jobs.sql

-- BEGIN ORIGINAL MIGRATION 20261022-flow-interview-loops.sql
CREATE TABLE IF NOT EXISTS md_flow_interview_loop_state (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 element_id integer NOT NULL,
 next_index integer NOT NULL CHECK(next_index BETWEEN -1 AND 200),
 PRIMARY KEY(tenant_id,run_id,element_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES md_flow_interview_state(tenant_id,run_id) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261022-flow-interview-loops.sql

-- BEGIN ORIGINAL MIGRATION 20261022-flow-interview-records.sql
-- Durable Flow record variables and collections are represented by SQL references.
CREATE TABLE IF NOT EXISTS md_flow_interview_records (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 run_id uuid NOT NULL,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 object_api text NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order >= 0),
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
-- END ORIGINAL MIGRATION 20261022-flow-interview-records.sql

-- BEGIN ORIGINAL MIGRATION 20261022-flow-trigger-record-resources.sql
ALTER TABLE md_flow_interview_records
 DROP CONSTRAINT IF EXISTS md_flow_interview_records_api_name_check;
ALTER TABLE md_flow_interview_records
 ADD CONSTRAINT md_flow_interview_records_api_name_check
 CHECK(api_name ~ '^(\$[A-Za-z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*)$');
-- END ORIGINAL MIGRATION 20261022-flow-trigger-record-resources.sql

-- BEGIN ORIGINAL MIGRATION 20261022-password-reset-tokens.sql
-- Ephemeral one-time password reset challenges. Never persist plaintext tokens.
CREATE TABLE IF NOT EXISTS md_password_reset_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK (length(token_hash)=64),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_password_reset_user_recent
 ON md_password_reset_challenges(tenant_id,user_id,created_at DESC);
-- END ORIGINAL MIGRATION 20261022-password-reset-tokens.sql

-- BEGIN ORIGINAL MIGRATION 20261022-till-pin.sql
-- PIN material never stored in a generic readable User record field.
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS till_pin_hash text;
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS till_pin_failures integer NOT NULL DEFAULT 0;
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS till_pin_locked_until timestamptz;
-- END ORIGINAL MIGRATION 20261022-till-pin.sql

-- BEGIN ORIGINAL MIGRATION 20261023-custom-metadata-foundation.sql
-- Tenant-scoped custom labels, custom metadata and hierarchy custom settings.
-- All definitions and values are stored in relational columns.
CREATE TABLE IF NOT EXISTS md_custom_labels (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 language text NOT NULL DEFAULT 'en' CHECK(length(language) BETWEEN 2 AND 35),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 255),
 value text NOT NULL CHECK(length(value)<=4000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,api_name,language)
);
CREATE INDEX IF NOT EXISTS md_custom_labels_lookup
 ON md_custom_labels(tenant_id,language,api_name);

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
 CHECK((data_type='text') OR max_length IS NULL)
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
 value_text text,
 value_number numeric,
 value_boolean boolean,
 value_date date,
 value_datetime timestamptz,
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
 max_length integer CHECK(max_length BETWEEN 1 AND 10000),
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
 PRIMARY KEY(tenant_id,setting_api,api_name),
 FOREIGN KEY(tenant_id,setting_api) REFERENCES md_custom_settings(tenant_id,api_name) ON DELETE CASCADE,
 CHECK((data_type='text') OR max_length IS NULL)
);
CREATE TABLE IF NOT EXISTS md_custom_setting_entries (
 tenant_id uuid NOT NULL,
 setting_api text NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 scope text NOT NULL CHECK(scope IN ('organization','profile','user')),
 profile_id uuid,
 user_id uuid,
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
 value_text text,
 value_number numeric,
 value_boolean boolean,
 value_date date,
 value_datetime timestamptz,
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
-- END ORIGINAL MIGRATION 20261023-custom-metadata-foundation.sql

-- BEGIN ORIGINAL MIGRATION 20261023-mfa-identity.sql
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
-- END ORIGINAL MIGRATION 20261023-mfa-identity.sql

-- BEGIN ORIGINAL MIGRATION 20261023-object-manager-metadata.sql
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
-- END ORIGINAL MIGRATION 20261023-object-manager-metadata.sql

-- BEGIN ORIGINAL MIGRATION 20261023-tenant-developer-activation.sql
-- A tenant's pre-created developer identity remains disabled until activated by a
-- security administrator with a fresh authenticator challenge.
CREATE TABLE IF NOT EXISTS md_tenant_developer_accounts (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 user_id uuid NOT NULL,
 activated_at timestamptz,
 activated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,activated_by) REFERENCES md_users(tenant_id,id),
 UNIQUE(tenant_id,user_id)
);
-- END ORIGINAL MIGRATION 20261023-tenant-developer-activation.sql

-- BEGIN ORIGINAL MIGRATION 20261023-tenant-recovery.sql
-- Emergency tenant recovery: separately verified durable security evidence.
-- Private contact tokens are hashed. Secrets never enter JSON or audit logs.
CREATE TABLE IF NOT EXISTS md_tenant_recovery_contacts(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 email text NOT NULL,
 verification_hash text NOT NULL,
 verification_expires_at timestamptz NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
 verified_at timestamptz,
 enrolled_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,email),
 FOREIGN KEY(tenant_id,enrolled_by) REFERENCES md_users(tenant_id,id),
 CHECK(email=lower(email))
);
CREATE TABLE IF NOT EXISTS md_tenant_recovery_cases(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 claimant_user_id uuid NOT NULL,
 opened_by_tenant_id uuid NOT NULL,
 opened_by_user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN
  ('PENDING','VERIFIED','DISPUTED','APPROVED','INVITED','REDEEMED','REPAIRED')),
 identity_proof_status text NOT NULL DEFAULT 'PENDING' CHECK(identity_proof_status IN
  ('PENDING','VERIFIED','DISPUTED')),
 opened_at timestamptz NOT NULL DEFAULT now(),
 wait_until timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 approved_at timestamptz,
 invitation_hash text,
 invitation_expires_at timestamptz,
 redeemed_at timestamptz,
 repaired_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(id),
 FOREIGN KEY(tenant_id,claimant_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(opened_by_tenant_id,opened_by_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_tenant_recovery_case_proofs(
 tenant_id uuid NOT NULL,
 case_id uuid NOT NULL,
 email text NOT NULL,
 token_hash text NOT NULL,
 token_expires_at timestamptz NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
 confirmed_at timestamptz,
 disputed_at timestamptz,
 PRIMARY KEY(tenant_id,case_id,email),
 FOREIGN KEY(tenant_id,case_id) REFERENCES md_tenant_recovery_cases(tenant_id,id),
 FOREIGN KEY(tenant_id,email) REFERENCES md_tenant_recovery_contacts(tenant_id,email)
);
CREATE TABLE IF NOT EXISTS md_tenant_recovery_approvals(
 tenant_id uuid NOT NULL,
 case_id uuid NOT NULL,
 operator_tenant_id uuid NOT NULL,
 operator_user_id uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,case_id,operator_tenant_id,operator_user_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES md_tenant_recovery_cases(tenant_id,id),
 FOREIGN KEY(operator_tenant_id,operator_user_id) REFERENCES md_users(tenant_id,id)
);
-- END ORIGINAL MIGRATION 20261023-tenant-recovery.sql

-- BEGIN ORIGINAL MIGRATION 20261024-field-formulas.sql
-- Reusable Formula field definitions use relational tenant/object/field identity.
-- Expressions are parsed by the shared bounded Formula Engine and never eval'd.
CREATE TABLE IF NOT EXISTS md_field_formulas(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 expression text NOT NULL CHECK(length(expression) BETWEEN 1 AND 2048),
 return_type text NOT NULL CHECK(return_type IN ('Number','Currency','Percent','Text','Checkbox')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api,field_api)
   REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
-- END ORIGINAL MIGRATION 20261024-field-formulas.sql

-- BEGIN ORIGINAL MIGRATION 20261024-field-global-value-sets.sql
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
-- END ORIGINAL MIGRATION 20261024-field-global-value-sets.sql

-- BEGIN ORIGINAL MIGRATION 20261024-integration-connection-tests.sql
-- Durable tenant-scoped connector connectivity observations.
CREATE TABLE IF NOT EXISTS md_integration_connection_tests(
 tenant_id uuid NOT NULL,
 connection_api text NOT NULL,
 connection_kind text NOT NULL DEFAULT 'integration-connections' CHECK(connection_kind='integration-connections'),
 status text NOT NULL CHECK(status IN ('Connected','Failed','Not configured','Test unavailable')),
 message text NOT NULL DEFAULT '',
 tested_by uuid NOT NULL,
 tested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connection_api),
 FOREIGN KEY(tenant_id,connection_kind,connection_api) REFERENCES md_system_definitions(tenant_id,kind,api_name),
 FOREIGN KEY(tenant_id,tested_by) REFERENCES md_users(tenant_id,id)
);
-- END ORIGINAL MIGRATION 20261024-integration-connection-tests.sql

-- BEGIN ORIGINAL MIGRATION 20261024-mail-tenant-domains.sql
-- Tenant ownership boundary for the Docker Mailserver provisioning API.
-- Never store mailbox passwords or SMTP credentials in the application database.
CREATE TABLE IF NOT EXISTS md_mail_domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 domain text NOT NULL UNIQUE,
 verified_at timestamptz,
 verification_token text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,domain)
);
CREATE INDEX IF NOT EXISTS md_mail_domains_tenant_idx ON md_mail_domains(tenant_id);

CREATE TABLE IF NOT EXISTS md_mail_accounts (
 email text PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 domain text NOT NULL,
 FOREIGN KEY(tenant_id,domain) REFERENCES md_mail_domains(tenant_id,domain),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','error')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,email)
);
CREATE INDEX IF NOT EXISTS md_mail_accounts_tenant_idx ON md_mail_accounts(tenant_id);

-- Existing system domain only: associate it with its actual registered MetaDrive tenant.
-- Future tenant domains must be explicitly verified before activation.
INSERT INTO md_mail_domains(tenant_id,domain,verified_at)
SELECT DISTINCT tenant_id,domain,now() FROM md_tenant_domains
WHERE domain='unesolutions.co.uk'
ON CONFLICT(domain) DO NOTHING;

-- Existing owner mailbox confirmed present in Docker Mailserver; only register
-- it for the tenant that owns the verified system domain.
INSERT INTO md_mail_accounts(email,tenant_id,domain,description,status)
SELECT 'support@unesolutions.co.uk',tenant_id,domain,'Platform support mailbox','active'
FROM md_mail_domains WHERE domain='unesolutions.co.uk' AND verified_at IS NOT NULL
ON CONFLICT(email) DO NOTHING;
-- END ORIGINAL MIGRATION 20261024-mail-tenant-domains.sql

-- BEGIN ORIGINAL MIGRATION 20261024-user-reporting-hierarchy.sql
-- Tenant-scoped management reporting hierarchy; roles/permission sets remain independent.
-- Additive, repeatable migration. Never delete or replace existing reporting relationships.
ALTER TABLE md_users ADD COLUMN IF NOT EXISTS reports_to_user_id uuid;
CREATE INDEX IF NOT EXISTS md_users_reporting_parent_idx ON md_users(tenant_id,reports_to_user_id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='md_users_reporting_tenant_fk') THEN
  ALTER TABLE md_users ADD CONSTRAINT md_users_reporting_tenant_fk
  FOREIGN KEY(tenant_id,reports_to_user_id) REFERENCES md_users(tenant_id,id);
 END IF;
END $$;

-- Walk one tenant's reporting graph. Level 0 is the requested user.
-- Ancestors and descendants are always based on Reports To, never on roles.
CREATE OR REPLACE FUNCTION md_reporting_users(t uuid, subject uuid, direction text)
RETURNS TABLE(user_id uuid, hierarchy_level integer)
LANGUAGE sql STABLE AS $$
 WITH RECURSIVE chain(id,parent_id,depth,path) AS (
  SELECT u.id,u.reports_to_user_id,0,ARRAY[u.id]::uuid[]
  FROM md_users u WHERE u.tenant_id=t AND u.id=subject
  UNION ALL
  SELECT next.id,next.reports_to_user_id,c.depth+1,c.path||next.id
  FROM chain c JOIN md_users next ON next.tenant_id=t AND
   ((direction='descendants' AND next.reports_to_user_id=c.id)
    OR (direction='ancestors' AND next.id=c.parent_id))
  WHERE c.depth<512 AND NOT(next.id=ANY(c.path))
 )
 SELECT id,depth FROM chain WHERE direction IN ('descendants','ancestors');
$$;

CREATE OR REPLACE FUNCTION md_reporting_scope(t uuid, viewer uuid, target uuid, requested_scope text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE requested_scope
  WHEN 'all' THEN EXISTS(SELECT 1 FROM md_users WHERE tenant_id=t AND id=target)
  WHEN 'own' THEN viewer=target AND EXISTS(SELECT 1 FROM md_users WHERE tenant_id=t AND id=viewer)
  WHEN 'direct' THEN viewer=target OR EXISTS(
   SELECT 1 FROM md_users WHERE tenant_id=t AND id=target AND reports_to_user_id=viewer)
  WHEN 'descendants' THEN EXISTS(
   SELECT 1 FROM md_reporting_users(t,viewer,'descendants') WHERE user_id=target)
  ELSE false END;
$$;

CREATE OR REPLACE FUNCTION md_validate_reporting_manager()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_id uuid;
BEGIN
 -- Serialise edits within the tenant to avoid mutually concurrent reparenting cycles.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,19041));
 SELECT a.user_id INTO root_id
 FROM md_tenant_developer_accounts a WHERE a.tenant_id=NEW.tenant_id;
 IF root_id IS NOT NULL AND NEW.id=root_id THEN
  IF NEW.reports_to_user_id IS NOT NULL THEN
   RAISE EXCEPTION 'The tenant developer reporting root cannot have a manager';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.reports_to_user_id IS NULL THEN NEW.reports_to_user_id:=root_id; END IF;
 IF NEW.reports_to_user_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.reports_to_user_id=NEW.id THEN RAISE EXCEPTION 'A user cannot report to themselves'; END IF;
 IF NOT EXISTS(SELECT 1 FROM md_users u WHERE u.tenant_id=NEW.tenant_id AND u.id=NEW.reports_to_user_id) THEN
  RAISE EXCEPTION 'Reporting manager must belong to the same tenant';
 END IF;
 IF TG_OP='UPDATE' AND EXISTS(
  SELECT 1 FROM md_reporting_users(NEW.tenant_id,NEW.id,'descendants')
  WHERE user_id=NEW.reports_to_user_id
 ) THEN RAISE EXCEPTION 'Circular reporting hierarchy'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_users_validate_reporting_manager ON md_users;
CREATE TRIGGER md_users_validate_reporting_manager
 BEFORE INSERT OR UPDATE OF reports_to_user_id ON md_users
 FOR EACH ROW EXECUTE FUNCTION md_validate_reporting_manager();

-- Existing users without a manager now report to the tenant developer.
-- Preserve explicitly assigned managers; developer is always the unique root.
UPDATE md_users u SET reports_to_user_id=a.user_id
FROM md_tenant_developer_accounts a
WHERE u.tenant_id=a.tenant_id AND u.id<>a.user_id AND u.reports_to_user_id IS NULL;
UPDATE md_users u SET reports_to_user_id=NULL
FROM md_tenant_developer_accounts a
WHERE u.tenant_id=a.tenant_id AND u.id=a.user_id AND u.reports_to_user_id IS NOT NULL;
-- END ORIGINAL MIGRATION 20261024-user-reporting-hierarchy.sql

-- BEGIN ORIGINAL MIGRATION 20261025-durable-flow-waits.sql
-- Persist Flow Wait state and allow interviews to be distinguished from screens.
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_status_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_status_check
 CHECK(status IN ('pending','waiting','completed','failed','cancelled'));
ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS wait_until timestamptz;
CREATE INDEX IF NOT EXISTS md_flow_runs_waiting
 ON md_flow_runs(tenant_id,wait_until) WHERE status='waiting';
-- END ORIGINAL MIGRATION 20261025-durable-flow-waits.sql

-- BEGIN ORIGINAL MIGRATION 20261025-object-metadata-history.sql
-- Versioned object metadata history in typed relational path/value rows.
-- Existing objects retain current layout data without fabricating historical revisions.
CREATE TABLE IF NOT EXISTS md_object_metadata_history(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL DEFAULT 'Updated',
 actor_user_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,revision),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_object_metadata_history_values(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 revision integer NOT NULL,
 property_path text NOT NULL CHECK(length(property_path) BETWEEN 1 AND 1024),
 value_kind text NOT NULL CHECK(value_kind IN ('string','number','boolean','null','array','object')),
 value_text text,
 PRIMARY KEY(tenant_id,object_api,revision,property_path),
 FOREIGN KEY(tenant_id,object_api,revision)
   REFERENCES md_object_metadata_history(tenant_id,object_api,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_object_metadata_history_recent
 ON md_object_metadata_history(tenant_id,object_api,revision DESC);
-- END ORIGINAL MIGRATION 20261025-object-metadata-history.sql

-- BEGIN ORIGINAL MIGRATION 20261026-metadata-api-name-casefold-uniqueness.sql
-- Migration preflight: never silently rename or delete tenant metadata to resolve conflicts.
DO $migration$
DECLARE
  item record;
  duplicate_exists boolean;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('md_custom_labels', 'tenant_id, language, lower(api_name)'),
    ('md_custom_metadata_types', 'tenant_id, lower(api_name)'),
    ('md_custom_settings', 'tenant_id, lower(api_name)'),
    ('md_custom_metadata_fields', 'tenant_id, type_api, lower(api_name)'),
    ('md_custom_setting_fields', 'tenant_id, setting_api, lower(api_name)'),
    ('md_global_value_sets', 'tenant_id, lower(api_name)'),
    ('md_matching_rules', 'tenant_id, object_api, lower(api_name)'),
    ('md_validation_rules', 'tenant_id, object_api, lower(api_name)'),
    ('md_object_definitions', 'tenant_id, lower(api_name)'),
    ('md_field_definitions', 'tenant_id, object_api, lower(api_name)'),
    ('md_page_definitions', 'tenant_id, lower(api_name)'),
    ('md_component_definitions', 'tenant_id, lower(api_name)'),
    ('md_flow_definitions', 'tenant_id, lower(api_name), version'),
    ('md_global_quick_actions', 'tenant_id, lower(action_id)'),
    ('md_system_definitions', 'tenant_id, kind, lower(api_name)'),
    ('md_tenant_app_metadata', 'tenant_id, lower(api_name)'),
    ('md_named_credentials', 'tenant_id, lower(name)')
  ) AS source(table_name,grouping) LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I GROUP BY %s HAVING count(*) > 1)',
      item.table_name,item.grouping) INTO duplicate_exists;
    IF duplicate_exists THEN
      RAISE EXCEPTION 'Case-insensitive API Name conflicts in %, reconcile metadata before applying unique indexes',item.table_name;
    END IF;
  END LOOP;
END
$migration$;

-- Preserve stable API names while preventing case-only duplicate identities.
-- These tenant-aware indexes are an atomic final guard under concurrent creates.
-- Existing conflicting names must be reconciled explicitly; never silently rename tenant metadata.
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_labels_api_name_ci_uq
 ON md_custom_labels(tenant_id,language,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_metadata_types_api_name_ci_uq
 ON md_custom_metadata_types(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_settings_api_name_ci_uq
 ON md_custom_settings(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_metadata_fields_api_name_ci_uq
 ON md_custom_metadata_fields(tenant_id,type_api,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_custom_setting_fields_api_name_ci_uq
 ON md_custom_setting_fields(tenant_id,setting_api,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_global_value_sets_api_name_ci_uq
 ON md_global_value_sets(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_matching_rules_api_name_ci_uq
 ON md_matching_rules(tenant_id,object_api,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_validation_rules_api_name_ci_uq
 ON md_validation_rules(tenant_id,object_api,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_objects_api_name_ci_uq
 ON md_object_definitions(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_fields_api_name_ci_uq
 ON md_field_definitions(tenant_id,object_api,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_pages_api_name_ci_uq
 ON md_page_definitions(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_components_api_name_ci_uq
 ON md_component_definitions(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_flows_api_version_ci_uq
 ON md_flow_definitions(tenant_id,lower(api_name),version);
CREATE UNIQUE INDEX IF NOT EXISTS md_global_actions_id_ci_uq
 ON md_global_quick_actions(tenant_id,lower(action_id));
CREATE UNIQUE INDEX IF NOT EXISTS md_system_definitions_api_name_ci_uq
 ON md_system_definitions(tenant_id,kind,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_tenant_apps_api_name_ci_uq
 ON md_tenant_app_metadata(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_named_credentials_name_ci_uq
 ON md_named_credentials(tenant_id,lower(name));
-- END ORIGINAL MIGRATION 20261026-metadata-api-name-casefold-uniqueness.sql

-- BEGIN ORIGINAL MIGRATION 20261026-oauth-authorization-code.sql
-- Tenant-scoped OAuth Authorization Code + PKCE grants and encrypted provider tokens.
CREATE TABLE IF NOT EXISTS md_credential_oauth_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 initiated_by uuid NOT NULL,
 state_hash text NOT NULL UNIQUE CHECK(length(state_hash)=64),
 verifier_ciphertext bytea NOT NULL,
 key_id text NOT NULL,
 redirect_uri text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,initiated_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_oauth_grants_tenant_recent ON md_credential_oauth_grants(tenant_id,credential_id,created_at DESC);
CREATE TABLE IF NOT EXISTS md_credential_oauth_tokens(
 tenant_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 key_id text NOT NULL,
 access_ciphertext bytea NOT NULL,
 refresh_ciphertext bytea,
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,credential_id),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261026-oauth-authorization-code.sql

-- BEGIN ORIGINAL MIGRATION 20261027-durable-job-history.sql
-- Append-only tenant-scoped state transitions; no payloads or credentials.
CREATE TABLE IF NOT EXISTS md_durable_job_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 status text NOT NULL,
 attempt integer NOT NULL,
 worker_id text,
 error_code text,
 observed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,job_id) REFERENCES md_durable_jobs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_durable_job_history_tenant_job
 ON md_durable_job_history(tenant_id,job_id,id);
CREATE OR REPLACE FUNCTION md_log_durable_job_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR
    (OLD.status,OLD.attempt,OLD.lease_owner,OLD.error_code)
    IS DISTINCT FROM
    (NEW.status,NEW.attempt,NEW.lease_owner,NEW.error_code) THEN
  INSERT INTO md_durable_job_history(tenant_id,job_id,status,attempt,worker_id,error_code)
  VALUES(NEW.tenant_id,NEW.id,NEW.status,NEW.attempt,NEW.lease_owner,NEW.error_code);
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS md_durable_job_transition_audit ON md_durable_jobs;
CREATE TRIGGER md_durable_job_transition_audit
 AFTER INSERT OR UPDATE ON md_durable_jobs
 FOR EACH ROW EXECUTE FUNCTION md_log_durable_job_transition();

-- Preserve the current state of jobs that predate this additive ledger.
INSERT INTO md_durable_job_history(tenant_id,job_id,status,attempt,worker_id,error_code)
SELECT j.tenant_id,j.id,j.status,j.attempt,j.lease_owner,j.error_code
FROM md_durable_jobs j
WHERE NOT EXISTS(
 SELECT 1 FROM md_durable_job_history h
 WHERE h.tenant_id=j.tenant_id AND h.job_id=j.id
);
-- END ORIGINAL MIGRATION 20261027-durable-job-history.sql

-- BEGIN ORIGINAL MIGRATION 20261027-encrypted-field-audit.sql
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
-- END ORIGINAL MIGRATION 20261027-encrypted-field-audit.sql

-- BEGIN ORIGINAL MIGRATION 20261027-http-callout-receipts.sql
-- Typed provider HTTP acknowledgement only: never persist remote response bodies or secrets.
CREATE TABLE IF NOT EXISTS md_http_callout_receipts (
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0),
 response_status integer NOT NULL CHECK(response_status BETWEEN 100 AND 599),
 received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,job_id,attempt),
 FOREIGN KEY(tenant_id,job_id) REFERENCES md_http_callout_jobs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_http_callout_receipts_job
 ON md_http_callout_receipts(tenant_id,job_id,received_at DESC);
-- END ORIGINAL MIGRATION 20261027-http-callout-receipts.sql

-- BEGIN ORIGINAL MIGRATION 20261028-custom-setting-required.sql
ALTER TABLE md_custom_setting_fields
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false;
-- END ORIGINAL MIGRATION 20261028-custom-setting-required.sql

-- BEGIN ORIGINAL MIGRATION 20261029-mail-admin-sessions.sql
-- One-time admin mailbox tickets and short-lived read-only access.
-- Contains SHA-256 token hashes only. NEVER store mailbox or Dovecot master passwords.
CREATE TABLE IF NOT EXISTS md_mail_admin_sessions(
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL,
 mailbox_email text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ticket','session')),
 created_at timestamptz NOT NULL DEFAULT now(),
 redeemed_at timestamptz,
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,mailbox_email) REFERENCES md_mail_accounts(tenant_id,email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_mail_admin_sessions_expiry_idx ON md_mail_admin_sessions(expires_at);
-- END ORIGINAL MIGRATION 20261029-mail-admin-sessions.sql

-- BEGIN ORIGINAL MIGRATION 20261029-rollup-filter-criteria.sql
ALTER TABLE md_field_definitions
  ADD COLUMN IF NOT EXISTS rollup_filter_logic text NOT NULL DEFAULT 'All'
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
-- END ORIGINAL MIGRATION 20261029-rollup-filter-criteria.sql

-- BEGIN ORIGINAL MIGRATION 20261030-field-type-migrations.sql
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
  before_is_unique boolean NOT NULL,
  before_case_sensitive boolean NOT NULL,
  after_value_text text,
  after_value_number numeric,
  after_value_boolean boolean,
  after_value_date date,
  after_value_datetime timestamptz,
  PRIMARY KEY(tenant_id,migration_id,record_id),
  FOREIGN KEY(tenant_id,migration_id)
    REFERENCES md_field_type_migrations(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,record_id,object_api)
    REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261030-field-type-migrations.sql

-- BEGIN ORIGINAL MIGRATION 20261030-flow-service-user-setting.sql
CREATE TABLE IF NOT EXISTS md_tenant_automation_settings (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id) ON DELETE CASCADE,
 flow_service_user_id uuid,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,flow_service_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,updated_by) REFERENCES md_users(tenant_id,id)
);
-- END ORIGINAL MIGRATION 20261030-flow-service-user-setting.sql

-- BEGIN ORIGINAL MIGRATION 20261031-field-type-migration-projections.sql
ALTER TABLE md_field_type_migration_values
  ADD COLUMN IF NOT EXISTS before_value_exists boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS after_value_exists boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS before_snapshot_encrypted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS before_reference_record_id uuid,
  ADD COLUMN IF NOT EXISTS before_geo_latitude double precision,
  ADD COLUMN IF NOT EXISTS before_geo_longitude double precision,
  ADD COLUMN IF NOT EXISTS before_address_street text,
  ADD COLUMN IF NOT EXISTS before_address_city text,
  ADD COLUMN IF NOT EXISTS before_address_state text,
  ADD COLUMN IF NOT EXISTS before_address_postal_code text,
  ADD COLUMN IF NOT EXISTS before_address_country text,
  ADD COLUMN IF NOT EXISTS after_reference_record_id uuid,
  ADD COLUMN IF NOT EXISTS after_geo_latitude double precision,
  ADD COLUMN IF NOT EXISTS after_geo_longitude double precision,
  ADD COLUMN IF NOT EXISTS after_address_street text,
  ADD COLUMN IF NOT EXISTS after_address_city text,
  ADD COLUMN IF NOT EXISTS after_address_state text,
  ADD COLUMN IF NOT EXISTS after_address_postal_code text,
  ADD COLUMN IF NOT EXISTS after_address_country text;

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
  PRIMARY KEY(tenant_id,migration_id,side),
  FOREIGN KEY(tenant_id,migration_id)
    REFERENCES md_field_type_migrations(tenant_id,id) ON DELETE CASCADE
);

ALTER TABLE md_field_type_migration_config
  ADD COLUMN IF NOT EXISTS auto_number_counter_exists boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_number_next_value bigint;

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
-- END ORIGINAL MIGRATION 20261031-field-type-migration-projections.sql

-- BEGIN ORIGINAL MIGRATION 20261031-flow-trigger-subscriptions.sql
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
INSERT INTO md_flow_trigger_subscriptions
 (tenant_id,flow_id,flow_type,trigger_key,app_api_name,active)
SELECT DISTINCT ON (f.tenant_id,f.id) f.tenant_id,f.id,f.flow_type,
 COALESCE(object_value.value_text,event_value.value_text),app_value.value_text,true
FROM md_flow_definitions f
JOIN md_flow_editor_values start_type
 ON start_type.tenant_id=f.tenant_id AND start_type.flow_id=f.id
 AND start_type.property_path ~ '^/builder/elements/[0-9]+/type$'
 AND start_type.value_text='Start'
LEFT JOIN md_flow_editor_values object_value
 ON object_value.tenant_id=f.tenant_id AND object_value.flow_id=f.id
 AND object_value.property_path=regexp_replace(start_type.property_path,
  '/type$','/config/object')
LEFT JOIN md_flow_editor_values event_value
 ON event_value.tenant_id=f.tenant_id AND event_value.flow_id=f.id
 AND event_value.property_path=regexp_replace(start_type.property_path,
  '/type$','/config/eventName')
LEFT JOIN md_flow_editor_values app_value
 ON app_value.tenant_id=f.tenant_id AND app_value.flow_id=f.id
 AND app_value.property_path='/builder/appApiName'
WHERE f.active=true AND f.archived=false
 AND f.flow_type IN ('Record-Triggered Flow','Schedule-Triggered Flow','Platform Event-Triggered Flow')
 AND COALESCE(object_value.value_text,event_value.value_text) ~ '^[A-Za-z][A-Za-z0-9_]*$'
ORDER BY f.tenant_id,f.id,start_type.property_path
ON CONFLICT(tenant_id,flow_id) DO UPDATE SET flow_type=EXCLUDED.flow_type,
 trigger_key=EXCLUDED.trigger_key,app_api_name=EXCLUDED.app_api_name,
 active=true,updated_at=now();
-- END ORIGINAL MIGRATION 20261031-flow-trigger-subscriptions.sql

-- BEGIN ORIGINAL MIGRATION 20261101-platform-event-delivery.sql
CREATE TABLE IF NOT EXISTS md_platform_event_messages (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 event_api_name text NOT NULL,
 published_by uuid NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','queued','completed','failed')),
 idempotency_key text,
 error_code text,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,published_by) REFERENCES md_users(tenant_id,id)
);
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
-- END ORIGINAL MIGRATION 20261101-platform-event-delivery.sql

-- BEGIN ORIGINAL MIGRATION 20261101-universal-business-context.sql
-- Universal, tenant-owned business context metadata and per-user active record.
CREATE TABLE IF NOT EXISTS md_context_definitions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 200),
 object_api text NOT NULL,
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,api_name)
);
CREATE TABLE IF NOT EXISTS md_user_context_selections(
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 context_api text NOT NULL,
 record_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,record_id) REFERENCES md_records(tenant_id,id) ON DELETE CASCADE,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,context_api),
 FOREIGN KEY(tenant_id,context_api) REFERENCES md_context_definitions(tenant_id,api_name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_user_context_selections_record_idx
 ON md_user_context_selections(tenant_id,record_id);
-- END ORIGINAL MIGRATION 20261101-universal-business-context.sql

-- BEGIN ORIGINAL MIGRATION 20261102-platform-event-fields.sql
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
DO $migration$
BEGIN
 IF EXISTS(
  SELECT 1 FROM md_system_definitions d
  WHERE d.kind='platform-events' AND (
   d.properties-'fields'-'description'<>'{}'::jsonb
   OR COALESCE(jsonb_typeof(d.properties->'fields'),'')<>'array'
   OR jsonb_array_length(CASE WHEN jsonb_typeof(d.properties->'fields')='array'
    THEN d.properties->'fields' ELSE '[]'::jsonb END) NOT BETWEEN 1 AND 100
   OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(d.properties->'fields')='array'
      THEN d.properties->'fields' ELSE '[]'::jsonb END
    ) f(field)
    WHERE COALESCE(jsonb_typeof(f.field),'')<>'object'
     OR COALESCE(f.field->>'apiName','') !~ '^[A-Za-z][A-Za-z0-9_]*$'
     OR COALESCE(length(btrim(f.field->>'label')),0) NOT BETWEEN 1 AND 255
     OR COALESCE(f.field->>'dataType','') NOT IN (
      'Text(255)','Long Text Area','Number','Currency','Percent','Checkbox','Date','DateTime','Picklist')
     OR (f.field ? 'required' AND COALESCE(jsonb_typeof(f.field->'required'),'')<>'boolean')
     OR (f.field ? 'picklistRestricted'
      AND COALESCE(jsonb_typeof(f.field->'picklistRestricted'),'')<>'boolean')
     OR (f.field ? 'picklistValues'
      AND COALESCE(jsonb_typeof(f.field->'picklistValues'),'')<>'array')
     OR jsonb_array_length(CASE WHEN jsonb_typeof(f.field->'picklistValues')='array'
      THEN f.field->'picklistValues' ELSE '[]'::jsonb END)>500
     OR (f.field->>'dataType'<>'Picklist' AND (
      CASE WHEN jsonb_typeof(f.field->'picklistRestricted')='boolean'
       THEN (f.field->>'picklistRestricted')::boolean ELSE false END
      OR jsonb_array_length(CASE WHEN jsonb_typeof(f.field->'picklistValues')='array'
       THEN f.field->'picklistValues' ELSE '[]'::jsonb END)>0
     ))
     OR (f.field->>'dataType'='Picklist'
      AND CASE WHEN jsonb_typeof(f.field->'picklistRestricted')='boolean'
       THEN (f.field->>'picklistRestricted')::boolean ELSE false END
      AND jsonb_array_length(CASE WHEN jsonb_typeof(f.field->'picklistValues')='array'
       THEN f.field->'picklistValues' ELSE '[]'::jsonb END)=0)
     OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(f.field->'picklistValues')='array'
        THEN f.field->'picklistValues' ELSE '[]'::jsonb END
      ) v(value)
      WHERE COALESCE(jsonb_typeof(v.value),'')<>'string'
       OR COALESCE(length(btrim(v.value #>> '{}')),0) NOT BETWEEN 1 AND 255
     )
   )
   OR EXISTS(
    SELECT f.field->>'apiName' FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(d.properties->'fields')='array'
      THEN d.properties->'fields' ELSE '[]'::jsonb END
    ) f(field)
    GROUP BY f.field->>'apiName' HAVING count(*)>1
   )
  )
 ) THEN
  RAISE EXCEPTION 'Platform Event metadata must be repaired before relational migration';
 END IF;
END
$migration$;
INSERT INTO md_platform_event_details(tenant_id,event_api_name,description)
SELECT tenant_id,api_name,COALESCE(properties->>'description','')
FROM md_system_definitions WHERE kind='platform-events'
ON CONFLICT(tenant_id,event_api_name) DO NOTHING;
INSERT INTO md_platform_event_fields
 (tenant_id,event_api_name,field_api,label,data_type,required,picklist_restricted,sort_order)
SELECT DISTINCT ON (d.tenant_id,d.api_name,f.field->>'apiName')
 d.tenant_id,d.api_name,f.field->>'apiName',f.field->>'label',f.field->>'dataType',
 CASE WHEN f.field->>'required' IN ('true','false') THEN (f.field->>'required')::boolean ELSE false END,
 CASE WHEN f.field->>'picklistRestricted' IN ('true','false')
  THEN (f.field->>'picklistRestricted')::boolean ELSE false END,(f.ordinality-1)::integer
FROM md_system_definitions d
CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(d.properties->'fields')='array' THEN d.properties->'fields' ELSE '[]'::jsonb END
) WITH ORDINALITY AS f(field,ordinality)
WHERE d.kind='platform-events'
 AND f.field->>'apiName' ~ '^[A-Za-z][A-Za-z0-9_]*$'
 AND COALESCE(f.field->>'label','')<>''
 AND f.field->>'dataType' IN (
  'Text(255)','Long Text Area','Number','Currency','Percent','Checkbox','Date','DateTime','Picklist')
ORDER BY d.tenant_id,d.api_name,f.field->>'apiName',f.ordinality
ON CONFLICT(tenant_id,event_api_name,field_api) DO UPDATE SET
 label=EXCLUDED.label,data_type=EXCLUDED.data_type,required=EXCLUDED.required,
 picklist_restricted=EXCLUDED.picklist_restricted,sort_order=EXCLUDED.sort_order;
INSERT INTO md_platform_event_picklist_values
 (tenant_id,event_api_name,field_api,value_text,sort_order)
SELECT DISTINCT ON (d.tenant_id,d.api_name,f.field->>'apiName',v.value)
 d.tenant_id,d.api_name,f.field->>'apiName',v.value,(v.ordinality-1)::integer
FROM md_system_definitions d
CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(d.properties->'fields')='array' THEN d.properties->'fields' ELSE '[]'::jsonb END
) WITH ORDINALITY AS f(field,ordinality)
CROSS JOIN LATERAL jsonb_array_elements_text(
 CASE WHEN jsonb_typeof(f.field->'picklistValues')='array' THEN f.field->'picklistValues' ELSE '[]'::jsonb END
) WITH ORDINALITY AS v(value,ordinality)
WHERE d.kind='platform-events'
 AND f.field->>'dataType'='Picklist' AND v.value<>''
 AND EXISTS(SELECT 1 FROM md_platform_event_fields x WHERE x.tenant_id=d.tenant_id
  AND x.event_api_name=d.api_name AND x.field_api=f.field->>'apiName')
ORDER BY d.tenant_id,d.api_name,f.field->>'apiName',v.value,v.ordinality
ON CONFLICT(tenant_id,event_api_name,field_api,value_text) DO UPDATE SET
 sort_order=EXCLUDED.sort_order;
UPDATE md_system_definitions SET properties='{}'::jsonb WHERE kind='platform-events';
-- END ORIGINAL MIGRATION 20261102-platform-event-fields.sql

-- BEGIN ORIGINAL MIGRATION 20261103-flow-email-outbox.sql
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
-- END ORIGINAL MIGRATION 20261103-flow-email-outbox.sql

-- BEGIN ORIGINAL MIGRATION 20261104-email-alert-details.sql
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
DO $migration$
BEGIN
 IF EXISTS(
  SELECT 1 FROM md_system_definitions d
  LEFT JOIN md_named_credentials c ON c.tenant_id=d.tenant_id
   AND c.id::text=d.properties->>'namedCredentialId'
   AND c.protocol='SMTP' AND c.enabled=true
  WHERE d.kind='email-alerts' AND (
   d.properties-'objectApiName'-'namedCredentialId'-'fromEmail'-'recipients'-'subject'-'body'
    <>'{}'::jsonb
   OR COALESCE(jsonb_typeof(d.properties->'objectApiName'),'')<>'string'
   OR COALESCE(jsonb_typeof(d.properties->'namedCredentialId'),'')<>'string'
   OR COALESCE(jsonb_typeof(d.properties->'fromEmail'),'')<>'string'
   OR COALESCE(jsonb_typeof(d.properties->'recipients'),'')<>'string'
   OR COALESCE(jsonb_typeof(d.properties->'subject'),'')<>'string'
   OR COALESCE(jsonb_typeof(d.properties->'body'),'')<>'string'
   OR COALESCE(d.properties->>'objectApiName','') !~ '^[A-Za-z][A-Za-z0-9_]*$'
   OR COALESCE(d.properties->>'namedCredentialId','') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   OR COALESCE(d.properties->>'fromEmail','') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
   OR length(d.properties->>'fromEmail')>254
   OR COALESCE(length(d.properties->>'recipients'),0) NOT BETWEEN 1 AND 4096
   OR COALESCE(length(btrim(d.properties->>'subject')),0) NOT BETWEEN 1 AND 300
   OR COALESCE(d.properties->>'subject','') ~ E'[\\r\\n]'
   OR COALESCE(length(d.properties->>'body'),0)>10000
   OR c.id IS NULL
  )
 ) THEN
  RAISE EXCEPTION 'Email Alert metadata or SMTP credentials must be repaired before relational migration';
 END IF;
END
$migration$;
INSERT INTO md_email_alert_details
 (tenant_id,alert_api_name,object_api,credential_id,from_email,recipients,subject,body)
SELECT tenant_id,api_name,properties->>'objectApiName',
 (properties->>'namedCredentialId')::uuid,properties->>'fromEmail',
 properties->>'recipients',properties->>'subject',properties->>'body'
FROM md_system_definitions WHERE kind='email-alerts'
ON CONFLICT(tenant_id,alert_api_name) DO NOTHING;
UPDATE md_system_definitions SET properties='{}'::jsonb WHERE kind='email-alerts';
-- END ORIGINAL MIGRATION 20261104-email-alert-details.sql

-- BEGIN ORIGINAL MIGRATION 20261105-flow-scheduled-paths.sql
ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS wait_kind text NOT NULL DEFAULT 'wait';
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_wait_kind_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_wait_kind_check
 CHECK(wait_kind IN ('wait','scheduled-path'));
-- END ORIGINAL MIGRATION 20261105-flow-scheduled-paths.sql

-- BEGIN ORIGINAL MIGRATION 20261105-record-recycle-bin.sql
-- Phase 1: recoverable tenant-scoped record deletion (additive, idempotent).
-- This migration preserves existing records and relationships.
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS deletion_group_id uuid;
ALTER TABLE md_records ADD COLUMN IF NOT EXISTS deletion_root_id uuid;

-- Release unique values on soft delete; restore rechecks the existing unique indexes atomically.
ALTER TABLE md_record_values ADD COLUMN IF NOT EXISTS record_is_deleted boolean NOT NULL DEFAULT false;
UPDATE md_record_values v SET record_is_deleted=r.is_deleted
 FROM md_records r WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id
 AND v.record_is_deleted IS DISTINCT FROM r.is_deleted;
DROP INDEX IF EXISTS md_record_values_unique_ci;
DROP INDEX IF EXISTS md_record_values_unique_cs;
CREATE UNIQUE INDEX md_record_values_unique_ci
 ON md_record_values(tenant_id,object_api,field_api,lower(value_text))
 WHERE is_unique AND NOT case_sensitive AND value_text IS NOT NULL AND record_is_deleted=false;
CREATE UNIQUE INDEX md_record_values_unique_cs
 ON md_record_values(tenant_id,object_api,field_api,value_text)
 WHERE is_unique AND case_sensitive AND value_text IS NOT NULL AND record_is_deleted=false;

CREATE INDEX IF NOT EXISTS md_records_active_lookup
 ON md_records(tenant_id,object_api,id) WHERE is_deleted=false;
CREATE INDEX IF NOT EXISTS md_records_recycle_bin
 ON md_records(tenant_id,object_api,deleted_at DESC,id) WHERE is_deleted=true;
CREATE INDEX IF NOT EXISTS md_records_deletion_group
 ON md_records(tenant_id,deletion_group_id) WHERE is_deleted=true;

-- A lookup cleared when its referenced record is deleted may be restored only
-- if the source remains active and the field has not been changed by a user.
CREATE TABLE IF NOT EXISTS md_deleted_lookup_links(
 tenant_id uuid NOT NULL,
 deletion_group_id uuid NOT NULL,
 source_record_id uuid NOT NULL,
 source_object_api text NOT NULL,
 field_api text NOT NULL,
 target_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,deletion_group_id,source_record_id,field_api),
 FOREIGN KEY(tenant_id,source_record_id,source_object_api)
   REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_deleted_lookup_links_target
 ON md_deleted_lookup_links(tenant_id,deletion_group_id,target_record_id);

CREATE TABLE IF NOT EXISTS md_record_lifecycle_audit(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 record_id uuid NOT NULL,
 object_api text NOT NULL,
 deletion_group_id uuid,
 actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('delete','restore','purge')),
 happened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_record_lifecycle_audit_record
 ON md_record_lifecycle_audit(tenant_id,object_api,record_id,happened_at DESC);

-- Apply the same active-record rule on upgraded tenants without replacing RBAC policy semantics.
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
-- END ORIGINAL MIGRATION 20261105-record-recycle-bin.sql

-- BEGIN ORIGINAL MIGRATION 20261105-scheduled-actions.sql
-- ScheduledAction: persistent, tenant-scoped action-sequence continuation.
-- The existing md_durable_jobs worker owns execution; no client timer or login
-- session is needed. Keep terminal rows for audit and reconciliation.
CREATE TABLE IF NOT EXISTS md_scheduled_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 job_id uuid NOT NULL,
 scheduled_by uuid NOT NULL,
 origin_session_id text,
 action_formula text NOT NULL CHECK(length(action_formula) BETWEEN 1 AND 4000),
 next_step integer NOT NULL CHECK(next_step>=0),
 -- JSON snapshot is only a bounded set of already-authorised formula inputs;
 -- never store bearer tokens, Named Credential secrets or browser cookies here.
 input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'Pending'
   CHECK(status IN ('Pending','Running','Completed','Cancelled','Failed','ManuallyCompleted')),
 execute_at timestamptz NOT NULL,
 finished_at timestamptz,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES md_durable_jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,scheduled_by) REFERENCES md_users(tenant_id,id),
 CHECK(octet_length(input_snapshot::text)<=32768),
 CHECK(octet_length(result_snapshot::text)<=32768)
);
CREATE INDEX IF NOT EXISTS md_scheduled_actions_due ON md_scheduled_actions(execute_at,id)
 WHERE status='Pending';
CREATE INDEX IF NOT EXISTS md_scheduled_actions_tenant ON md_scheduled_actions(tenant_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS md_scheduled_action_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 scheduled_action_id uuid NOT NULL,
 step_number integer,
 action_name text,
 event_type text NOT NULL,
 actor_user_id uuid,
 detail_code text,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,scheduled_action_id) REFERENCES md_scheduled_actions(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_scheduled_action_history_order
 ON md_scheduled_action_history(tenant_id,scheduled_action_id,id);
-- END ORIGINAL MIGRATION 20261105-scheduled-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261105-setup-menu-permissions.sql
-- Idempotent permission-set presets for Setup navigation.
-- Preserve all existing non-navigation rules and assignments; reconcile only the requested menu grants.
-- Assign a new preset explicitly through the existing Users & Permissions editor.
-- Record-level read/edit must be granted separately on the relevant object/record.
CREATE OR REPLACE FUNCTION md_seed_setup_menu_permission_sets(target_tenant uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  preset record;
  preset_id uuid;
  created_set boolean;
BEGIN
  FOR preset IN SELECT * FROM (VALUES
    ('Administrator',ARRAY['CompanySettings','SecurityRecovery','ConnectedApps','AuditTrail','ObjectManager','Records','DataLoader','AppExchange','ReportsBuilder','DashboardBuilder','ReportsView','DashboardsView','Users','Roles','Profiles','PermissionSets','PermissionSetGroups']::text[],ARRAY['ObjectDefinition|read','ObjectDefinition|create','ObjectDefinition|manage','Security|read','Security|manage','ConnectedApp|manage','SetupAudit|read','User|read','User|create','User|edit','User|delete','SystemDefinition:reports|read','SystemDefinition:reports|manage','SystemDefinition:dashboards|read','SystemDefinition:dashboards|manage']::text[]),
    ('Developer',ARRAY['CompanySettings','SecurityRecovery','ConnectedApps','AuditTrail','ObjectManager','Records','DataLoader','AppExchange','ReportsBuilder','DashboardBuilder','ReportsView','DashboardsView','Users','Roles','Profiles','PermissionSets','PermissionSetGroups','AppManager','NamedCredentials','WebhookEndpoints','Flows','PausedInterviews','ScheduledFlows','FlowHistory','ProcessAutomation','PublicGroups','SharingSettings','SharingRules']::text[],ARRAY['ObjectDefinition|read','ObjectDefinition|create','ObjectDefinition|manage','Security|read','Security|manage','ConnectedApp|manage','SetupAudit|read','User|read','User|create','User|edit','User|delete','SystemDefinition:reports|read','SystemDefinition:reports|manage','SystemDefinition:dashboards|read','SystemDefinition:dashboards|manage','NamedCredential|read','NamedCredential|manage','WebhookSubscription|read','WebhookSubscription|manage','FlowDefinition|manage','Flow|execute','ApprovalRequest|manage']::text[]),
    ('User',ARRAY['Records','ReportsView','DashboardsView']::text[],ARRAY['SystemDefinition:reports|read','SystemDefinition:dashboards|read']::text[])
  ) AS p(api_name,visible_menus,api_rights)
  LOOP
    INSERT INTO md_permission_sets(tenant_id,api_name,label,description,navigation_default_access)
    VALUES(target_tenant,preset.api_name,preset.api_name,
      'Standard Setup navigation preset; assign explicitly to users, profiles or groups','Deny')
    ON CONFLICT(tenant_id,api_name) DO NOTHING;
    created_set := FOUND;
    SELECT id INTO preset_id FROM md_permission_sets
      WHERE tenant_id=target_tenant AND api_name=preset.api_name;
    -- Add required menu grants to existing presets without changing their API/record rules.
    INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
    SELECT target_tenant,preset_id,'SetupMenu:'||menu,'read','allow'
      FROM unnest(preset.visible_menus) AS menu
    ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING;
    IF created_set THEN
      INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
      SELECT target_tenant,preset_id,split_part(capability,'|',1),split_part(capability,'|',2),'allow'
        FROM unnest(preset.api_rights) AS capability
      ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING;
    END IF;
  END LOOP;
END
$$;

-- Backfill missing presets and the new navigation tokens, without changing existing API rules.
SELECT md_seed_setup_menu_permission_sets(id) FROM md_tenants;

-- Registration makes each capability editable in the existing permission-set UI.
-- The later governance migration's CREATE TABLE IF NOT EXISTS is harmless.
CREATE TABLE IF NOT EXISTS md_system_permission_catalogue(
 permission_key text PRIMARY KEY,label text NOT NULL,description text NOT NULL,resource text NOT NULL,action text NOT NULL
);
INSERT INTO md_system_permission_catalogue(permission_key,label,description,resource,action) VALUES
 ('setup:TenantManagement:view','Setup / Tenant Management','Show the Tenant Management destination in Settings navigation','SetupMenu:TenantManagement','read'),
 ('setup:CompanySettings:view','Setup / Company Settings','Show the Company Settings destination in Settings navigation','SetupMenu:CompanySettings','read'),
 ('setup:SecurityRecovery:view','Setup / Security & Recovery','Show the Security & Recovery destination in Settings navigation','SetupMenu:SecurityRecovery','read'),
 ('setup:ConnectedApps:view','Setup / Connected Apps','Show the Connected Apps destination in Settings navigation','SetupMenu:ConnectedApps','read'),
 ('setup:AuditTrail:view','Setup / Audit Trail','Show the Audit Trail destination in Settings navigation','SetupMenu:AuditTrail','read'),
 ('setup:ObjectManager:view','Setup / Object Manager','Show the Object Manager destination in Settings navigation','SetupMenu:ObjectManager','read'),
 ('setup:Records:view','Setup / Records','Show the Records destination in Settings navigation','SetupMenu:Records','read'),
 ('setup:DataLoader:view','Setup / Data Loader','Show the Data Loader destination in Settings navigation','SetupMenu:DataLoader','read'),
 ('setup:PageBuilder:view','Setup / Page Builder','Show the Page Builder destination in Settings navigation','SetupMenu:PageBuilder','read'),
 ('setup:AppManager:view','Setup / App Manager','Show the App Manager destination in Settings navigation','SetupMenu:AppManager','read'),
 ('setup:AppExchange:view','Setup / AppExchange','Show the AppExchange destination in Settings navigation','SetupMenu:AppExchange','read'),
 ('setup:NamedCredentials:view','Setup / Named Credentials','Show the Named Credentials destination in Settings navigation','SetupMenu:NamedCredentials','read'),
 ('setup:WebhookEndpoints:view','Setup / Webhook Endpoints','Show the Webhook Endpoints destination in Settings navigation','SetupMenu:WebhookEndpoints','read'),
 ('setup:NamedDevices:view','Setup / Named Devices','Show the Named Devices destination in Settings navigation','SetupMenu:NamedDevices','read'),
 ('setup:Flows:view','Setup / Flows','Show the Flows destination in Settings navigation','SetupMenu:Flows','read'),
 ('setup:PausedInterviews:view','Setup / Paused Interviews','Show the Paused Interviews destination in Settings navigation','SetupMenu:PausedInterviews','read'),
 ('setup:ScheduledFlows:view','Setup / Scheduled Flows','Show the Scheduled Flows destination in Settings navigation','SetupMenu:ScheduledFlows','read'),
 ('setup:FlowHistory:view','Setup / Flow History','Show the Flow History destination in Settings navigation','SetupMenu:FlowHistory','read'),
 ('setup:ProcessAutomation:view','Setup / Process Automation','Show the Process Automation destination in Settings navigation','SetupMenu:ProcessAutomation','read'),
 ('setup:ReportsBuilder:view','Setup / Reports Builder','Show the Reports Builder destination in Settings navigation','SetupMenu:ReportsBuilder','read'),
 ('setup:DashboardBuilder:view','Setup / Dashboard Builder','Show the Dashboard Builder destination in Settings navigation','SetupMenu:DashboardBuilder','read'),
 ('setup:ReportsView:view','Setup / Reports View','Show the Reports View destination in Settings navigation','SetupMenu:ReportsView','read'),
 ('setup:DashboardsView:view','Setup / Dashboard View','Show the Dashboard View destination in Settings navigation','SetupMenu:DashboardsView','read'),
 ('setup:Users:view','Setup / Users','Show the Users destination in Settings navigation','SetupMenu:Users','read'),
 ('setup:Roles:view','Setup / Roles','Show the Roles destination in Settings navigation','SetupMenu:Roles','read'),
 ('setup:PublicGroups:view','Setup / Public Groups','Show the Public Groups destination in Settings navigation','SetupMenu:PublicGroups','read'),
 ('setup:Profiles:view','Setup / Profiles','Show the Profiles destination in Settings navigation','SetupMenu:Profiles','read'),
 ('setup:PermissionSets:view','Setup / Permission Sets','Show the Permission Sets destination in Settings navigation','SetupMenu:PermissionSets','read'),
 ('setup:PermissionSetGroups:view','Setup / Permission Set Groups','Show the Permission Set Groups destination in Settings navigation','SetupMenu:PermissionSetGroups','read'),
 ('setup:SharingSettings:view','Setup / Sharing Settings','Show the Sharing Settings destination in Settings navigation','SetupMenu:SharingSettings','read'),
 ('setup:SharingRules:view','Setup / Sharing Rules','Show the Sharing Rules destination in Settings navigation','SetupMenu:SharingRules','read')
ON CONFLICT(permission_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20261105-setup-menu-permissions.sql

-- BEGIN ORIGINAL MIGRATION 20261106-object-quick-actions.sql
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
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,object_api,action_id),
  FOREIGN KEY(tenant_id,object_api)
    REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,object_api,field_api)
    REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
  CHECK(action_id ~ '^[A-Za-z][A-Za-z0-9_-]*$'),
  CHECK(length(label) BETWEEN 1 AND 80),
  CHECK(value_text IS NULL OR length(value_text)<=10000),
  CHECK((action_type='Custom' AND behavior='Set Field Value' AND field_api IS NOT NULL
      AND value_text IS NOT NULL) OR (action_type='Standard' AND behavior IS NULL
      AND field_api IS NULL AND value_text IS NULL))
);
-- END ORIGINAL MIGRATION 20261106-object-quick-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261106-record-retention.sql
-- Opt-in retention policy. A tenant administrator must explicitly enable
-- automatic purging; there is no platform-wide implicit destruction of data.
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
-- END ORIGINAL MIGRATION 20261106-record-retention.sql

-- BEGIN ORIGINAL MIGRATION 20261107-flow-active-version.sql
UPDATE md_flow_definitions SET active=false
WHERE active=true AND archived=true;

WITH ranked_active_versions AS (
 SELECT tenant_id,api_name,id,
  row_number() OVER (PARTITION BY tenant_id,api_name ORDER BY version DESC,id DESC) AS active_position
 FROM md_flow_definitions
 WHERE active=true AND archived=false
)
UPDATE md_flow_definitions f SET active=false
FROM ranked_active_versions r
WHERE f.tenant_id=r.tenant_id AND f.id=r.id AND r.active_position>1;

UPDATE md_flow_trigger_subscriptions s SET active=false,updated_at=now()
FROM md_flow_definitions f
WHERE s.tenant_id=f.tenant_id AND s.flow_id=f.id AND s.active=true
 AND (f.active=false OR f.archived=true);

CREATE UNIQUE INDEX IF NOT EXISTS md_flow_definitions_one_active_version
 ON md_flow_definitions(tenant_id,api_name) WHERE active=true;
-- END ORIGINAL MIGRATION 20261107-flow-active-version.sql

-- BEGIN ORIGINAL MIGRATION 20261107-universal-object-actions.sql
-- Phase 2: extend the existing shared Object Actions registry; preserve all tenant customisations.
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS target_object_api text;
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS relationship_field_api text;
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS flow_api_name text;

DO $$
DECLARE old_name text;
BEGIN
 FOR old_name IN SELECT c.conname FROM pg_constraint c
   WHERE c.conrelid='md_object_actions'::regclass AND c.contype='c'
     AND pg_get_constraintdef(c.oid) LIKE '%Set Field Value%'
 LOOP
   EXECUTE format('ALTER TABLE md_object_actions DROP CONSTRAINT %I',old_name);
 END LOOP;
END $$;

ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_behavior_contract;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_behavior_contract CHECK(
 (action_type='Standard' AND behavior IS NULL AND field_api IS NULL AND value_text IS NULL
  AND target_object_api IS NULL AND relationship_field_api IS NULL AND flow_api_name IS NULL)
 OR (action_type='Custom' AND (
   (behavior='Set Field Value' AND field_api IS NOT NULL AND value_text IS NOT NULL
     AND target_object_api IS NULL AND flow_api_name IS NULL AND relationship_field_api IS NULL)
   OR (behavior='Log Call' AND field_api IS NULL AND target_object_api IS NULL
     AND flow_api_name IS NULL AND relationship_field_api IS NULL)
   OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND field_api IS NULL
     AND target_object_api IS NULL AND relationship_field_api IS NULL)
   OR (behavior='Create Related' AND target_object_api IS NOT NULL
     AND relationship_field_api IS NOT NULL AND field_api IS NULL AND flow_api_name IS NULL)
 ))
);
CREATE INDEX IF NOT EXISTS md_object_actions_enabled_lookup
 ON md_object_actions(tenant_id,object_api,action_id) WHERE enabled=true;
-- END ORIGINAL MIGRATION 20261107-universal-object-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261108-email-quick-actions.sql
-- Phase 2: an email Quick Action is a credential reference plus sender address,
-- never a stored password or provider-specific integration.
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS credential_id uuid;
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS from_email text;
ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_behavior_contract;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_behavior_contract CHECK(
 (action_type='Standard' AND behavior IS NULL AND field_api IS NULL AND value_text IS NULL
  AND target_object_api IS NULL AND relationship_field_api IS NULL AND flow_api_name IS NULL
  AND credential_id IS NULL AND from_email IS NULL)
 OR (action_type='Custom' AND (
   (behavior='Set Field Value' AND field_api IS NOT NULL AND value_text IS NOT NULL
     AND target_object_api IS NULL AND flow_api_name IS NULL AND relationship_field_api IS NULL
     AND credential_id IS NULL AND from_email IS NULL)
   OR (behavior='Log Call' AND field_api IS NULL AND target_object_api IS NULL
     AND flow_api_name IS NULL AND relationship_field_api IS NULL AND credential_id IS NULL AND from_email IS NULL)
   OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND field_api IS NULL
     AND target_object_api IS NULL AND relationship_field_api IS NULL AND credential_id IS NULL AND from_email IS NULL)
   OR (behavior='Create Related' AND target_object_api IS NOT NULL
     AND relationship_field_api IS NOT NULL AND field_api IS NULL AND flow_api_name IS NULL
     AND credential_id IS NULL AND from_email IS NULL)
   OR (behavior='Send Email' AND credential_id IS NOT NULL AND from_email IS NOT NULL
     AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
     AND field_api IS NULL AND flow_api_name IS NULL AND relationship_field_api IS NULL
     AND target_object_api IS NULL AND value_text IS NULL)
  ))
);
-- END ORIGINAL MIGRATION 20261108-email-quick-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261108-flow-execution-context.sql
ALTER TABLE md_flow_definitions ADD COLUMN IF NOT EXISTS system_context_approved_by uuid;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
   WHERE conname='md_flow_definitions_system_context_approved_by_fkey') THEN
  ALTER TABLE md_flow_definitions
   ADD CONSTRAINT md_flow_definitions_system_context_approved_by_fkey
   FOREIGN KEY(tenant_id,system_context_approved_by) REFERENCES md_users(tenant_id,id);
 END IF;
END $$;

ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS initiated_by uuid;
UPDATE md_flow_runs SET initiated_by=started_by WHERE initiated_by IS NULL;
ALTER TABLE md_flow_runs ALTER COLUMN initiated_by SET NOT NULL;
ALTER TABLE md_flow_runs ADD COLUMN IF NOT EXISTS execution_context text NOT NULL DEFAULT 'User';
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_execution_context_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_execution_context_check
 CHECK(execution_context IN ('User','System'));
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='md_flow_runs_initiated_by_fkey') THEN
  ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_initiated_by_fkey
   FOREIGN KEY(tenant_id,initiated_by) REFERENCES md_users(tenant_id,id);
 END IF;
END $$;

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
-- END ORIGINAL MIGRATION 20261108-flow-execution-context.sql

-- BEGIN ORIGINAL MIGRATION 20261109-global-quick-actions.sql
-- Global Quick Actions use one tenant metadata registry and shared execution permissions.
CREATE TABLE IF NOT EXISTS md_global_quick_actions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 action_id text NOT NULL CHECK(action_id ~ '^[A-Za-z][A-Za-z0-9_-]*$' AND length(action_id)<=100),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 behavior text NOT NULL CHECK(behavior IN ('Create Record','Run Flow','Send Email')),
 enabled boolean NOT NULL DEFAULT true,
 target_object_api text,
 flow_api_name text,
 credential_id uuid,
 from_email text,
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,action_id),
 FOREIGN KEY(tenant_id,target_object_api) REFERENCES md_object_definitions(tenant_id,api_name),
 CHECK(
 (behavior='Create Record' AND target_object_api IS NOT NULL AND flow_api_name IS NULL
   AND credential_id IS NULL AND from_email IS NULL)
 OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND target_object_api IS NULL
   AND credential_id IS NULL AND from_email IS NULL)
 OR (behavior='Send Email' AND credential_id IS NOT NULL AND from_email IS NOT NULL
   AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
   AND target_object_api IS NULL AND flow_api_name IS NULL))
);
CREATE INDEX IF NOT EXISTS md_global_quick_actions_active
 ON md_global_quick_actions(tenant_id,sort_order,action_id) WHERE enabled=true;
-- END ORIGINAL MIGRATION 20261109-global-quick-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261110-quick-action-email-queue.sql
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
-- END ORIGINAL MIGRATION 20261110-quick-action-email-queue.sql

-- BEGIN ORIGINAL MIGRATION 20261111-enhanced-related-lists.sql
-- Phase 3: independent, tenant-owned related-list presentation metadata.
-- Existing rows keep the default behavior; no customer layout is overwritten.
ALTER TABLE md_object_page_layout_related_lists
 ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE md_object_page_layout_related_lists
 DROP CONSTRAINT IF EXISTS md_related_list_settings_object;
ALTER TABLE md_object_page_layout_related_lists
 ADD CONSTRAINT md_related_list_settings_object CHECK(jsonb_typeof(settings)='object');
-- END ORIGINAL MIGRATION 20261111-enhanced-related-lists.sql

-- BEGIN ORIGINAL MIGRATION 20261111-universal-component-quick-actions.sql
-- Reusable Open Component Quick Actions. Retains existing tenant metadata and records.
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS component_api_name text;
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS component_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_component_bindings_check;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_component_bindings_check
 CHECK(jsonb_typeof(component_bindings)='array' AND jsonb_array_length(component_bindings)<=20);
ALTER TABLE md_object_actions ADD COLUMN IF NOT EXISTS presentation text NOT NULL DEFAULT 'Modal';
ALTER TABLE md_global_quick_actions ADD COLUMN IF NOT EXISTS component_api_name text;
ALTER TABLE md_global_quick_actions ADD COLUMN IF NOT EXISTS component_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE md_global_quick_actions DROP CONSTRAINT IF EXISTS md_global_quick_actions_component_bindings_check;
ALTER TABLE md_global_quick_actions ADD CONSTRAINT md_global_quick_actions_component_bindings_check
 CHECK(jsonb_typeof(component_bindings)='array' AND jsonb_array_length(component_bindings)<=20);
ALTER TABLE md_global_quick_actions ADD COLUMN IF NOT EXISTS presentation text NOT NULL DEFAULT 'Modal';
ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_presentation_check;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_presentation_check
 CHECK(presentation IN ('Modal','Side Panel'));
ALTER TABLE md_global_quick_actions DROP CONSTRAINT IF EXISTS md_global_quick_actions_presentation_check;
ALTER TABLE md_global_quick_actions ADD CONSTRAINT md_global_quick_actions_presentation_check
 CHECK(presentation IN ('Modal','Side Panel'));
-- The legacy global behavior CHECK was unnamed. Drop only constraints mentioning the action kinds.
DO $$
DECLARE old_name text;
BEGIN
 FOR old_name IN SELECT c.conname FROM pg_constraint c
  WHERE c.conrelid='md_global_quick_actions'::regclass AND c.contype='c'
   AND pg_get_constraintdef(c.oid) LIKE '%Create Record%'
 LOOP
  EXECUTE format('ALTER TABLE md_global_quick_actions DROP CONSTRAINT %I',old_name);
 END LOOP;
END $$;
ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_behavior_contract;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_behavior_contract CHECK(
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
   OR (behavior='Send Email' AND credential_id IS NOT NULL AND from_email IS NOT NULL
     AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
     AND field_api IS NULL AND flow_api_name IS NULL AND relationship_field_api IS NULL
     AND target_object_api IS NULL AND value_text IS NULL AND component_api_name IS NULL)
    OR (behavior='Open Component' AND component_api_name IS NOT NULL AND field_api IS NULL
      AND value_text IS NULL AND target_object_api IS NULL AND relationship_field_api IS NULL
      AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL)
  )));
ALTER TABLE md_global_quick_actions DROP CONSTRAINT IF EXISTS md_global_quick_actions_behavior_contract;
ALTER TABLE md_global_quick_actions ADD CONSTRAINT md_global_quick_actions_behavior_contract CHECK(
 (behavior='Create Record' AND target_object_api IS NOT NULL AND flow_api_name IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND target_object_api IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Send Email' AND credential_id IS NOT NULL AND from_email IS NOT NULL
   AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
   AND target_object_api IS NULL AND flow_api_name IS NULL AND component_api_name IS NULL)
 OR (behavior='Open Component' AND component_api_name IS NOT NULL AND target_object_api IS NULL
   AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL));
-- END ORIGINAL MIGRATION 20261111-universal-component-quick-actions.sql

-- BEGIN ORIGINAL MIGRATION 20261112-conditional-custom-links.sql
-- Optional declarative link visibility; empty conditions preserve existing links.
ALTER TABLE md_object_page_layout_links
 ADD COLUMN IF NOT EXISTS visible_when_field text;
ALTER TABLE md_object_page_layout_links
 ADD COLUMN IF NOT EXISTS visible_when_value text;
ALTER TABLE md_object_page_layout_links
 DROP CONSTRAINT IF EXISTS md_record_link_visibility_pair;
ALTER TABLE md_object_page_layout_links
 ADD CONSTRAINT md_record_link_visibility_pair CHECK (
  (visible_when_field IS NULL AND visible_when_value IS NULL)
  OR (visible_when_field ~ '^[A-Za-z][A-Za-z0-9_]*$'
    AND visible_when_value IS NOT NULL AND length(visible_when_value)<=256)
 );
-- END ORIGINAL MIGRATION 20261112-conditional-custom-links.sql

-- BEGIN ORIGINAL MIGRATION 20261112-flow-capability-registry.sql
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

-- Idempotent Core seed: do not overwrite administrator modifications or published Flow metadata.
INSERT INTO md_flow_capability_flow_types
(flow_type,description,sort_order,create_enabled,validate_enabled,debug_enabled)
VALUES
 ('Screen Flow','Guide a user through screens and actions.',0,true,true,true),
 ('Autolaunched Flow','Run without screens or from another flow.',10,true,true,true),
 ('Record-Triggered Flow','Run when a record changes.',20,false,true,true),
 ('Schedule-Triggered Flow','Run on a durable schedule.',30,false,true,false),
 ('Platform Event-Triggered Flow','Run after a subscribed platform event.',40,false,true,false),
 ('Flow Orchestration','Coordinate staged human approvals.',50,false,false,false)
ON CONFLICT (flow_type) DO NOTHING;

INSERT INTO md_flow_capability_elements
(element_type,display_group,display_icon,sort_order,builder_enabled,before_save_allowed,
 config_schema_key,validator_key,runtime_handler_key,debug_behavior)
VALUES
 ('Start','Logic','▶',0,false,true,'flow:Start','Start','Start','execute'),
 ('End','Logic','■',10,true,true,'flow:End','End','End','execute'),
 ('Screen','Interaction','▣',20,true,false,'flow:Screen','Screen','Screen','execute'),
 ('Wait','Interaction','◷',30,true,false,'flow:Wait','Wait','Wait','unsupported'),
 ('Action','Interaction','⚡',40,true,false,'flow:Action','Action','Action','unsupported'),
 ('Roll Back Records','Data','↶',50,true,false,'flow:Roll Back Records','Roll Back Records','Roll Back Records','unsupported'),
 ('Custom Error','Logic','!',60,true,true,'flow:Custom Error','Custom Error','Custom Error','unsupported'),
 ('Decision','Logic','◇',70,true,true,'flow:Decision','Decision','Decision','execute'),
 ('Assignment','Logic','⇄',80,true,true,'flow:Assignment','Assignment','Assignment','execute'),
 ('Loop','Logic','↻',90,true,false,'flow:Loop','Loop','Loop','unsupported'),
 ('Create Records','Data','+',100,true,false,'flow:Create Records','Create Records','Create Records','simulate'),
 ('HTTP Callout','Interaction','⇧',110,true,false,'flow:HTTP Callout','HTTP Callout','HTTP Callout','simulate'),
 ('Get Records','Data','↓',120,false,false,'flow:Get Records','Get Records','Get Records','unsupported'),
 ('Update Records','Data','✎',130,false,false,'flow:Update Records','Update Records','Update Records','simulate'),
 ('Delete Records','Data','×',140,false,false,'flow:Delete Records','Delete Records','Delete Records','unsupported'),
 ('Subflow','Interaction','↳',150,false,false,'flow:Subflow','Subflow','Subflow','unsupported'),
 ('Collection Filter','Data','⛃',160,false,false,'flow:Collection Filter','Collection Filter','Collection Filter','unsupported'),
 ('Collection Sort','Data','⇵',170,false,false,'flow:Collection Sort','Collection Sort','Collection Sort','unsupported'),
 ('Transform','Data','⇢',180,false,false,'flow:Transform','Transform','Transform','unsupported'),
 ('Publish Platform Event','Interaction','⇧',190,false,false,'flow:Publish Platform Event','Publish Platform Event','Publish Platform Event','unsupported'),
 ('CreateRecord','Data','+',200,false,false,'flow:CreateRecord','CreateRecord','CreateRecord','simulate')
ON CONFLICT (element_type) DO NOTHING;

INSERT INTO md_flow_capability_element_flows (element_type,flow_type,builder_allowed)
SELECT e.element_type,f.flow_type,
 (e.builder_enabled OR e.element_type='Publish Platform Event')
 AND (e.element_type <> 'Wait' OR f.flow_type IN ('Screen Flow','Autolaunched Flow','Record-Triggered Flow'))
 FROM md_flow_capability_elements e CROSS JOIN md_flow_capability_flow_types f
 WHERE f.validate_enabled AND e.enabled
 AND (e.element_type <> 'Screen' OR f.flow_type = 'Screen Flow')
 AND (e.element_type <> 'Custom Error' OR f.flow_type = 'Record-Triggered Flow')
 AND (e.element_type <> 'Publish Platform Event' OR f.flow_type <> 'Platform Event-Triggered Flow')
ON CONFLICT (element_type,flow_type) DO NOTHING;

-- Discoverable property contracts. Existing runtime validators remain authoritative for semantics.
INSERT INTO md_flow_capability_properties (element_type,property_name,value_type,required,sort_order)
VALUES
 ('Get Records','object','text',true,10),
 ('Get Records','conditions','list',false,20),
 ('Get Records','outputVariable','resource',true,30),
 ('Update Records','object','text',true,10),
 ('Update Records','fieldValues','list',false,20),
 ('Delete Records','object','text',true,10),
 ('Subflow','flowApiName','text',true,10),
 ('Subflow','inputValues','text',false,20),
 ('Subflow','outputValues','text',false,30),
 ('HTTP Callout','namedCredentialId','text',true,10),
 ('HTTP Callout','method','text',false,20),
 ('Wait','waitType','text',false,10),
 ('Publish Platform Event','eventApiName','text',true,10)
ON CONFLICT (element_type,property_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261112-flow-capability-registry.sql

-- BEGIN ORIGINAL MIGRATION 20261113-flow-builder-phase1-unlock.sql
-- Phase 1: unlock validated Core Flow elements and supported trigger types.
-- Only migrate the version-one defaults. Future customer/administrator overrides with
-- a higher registry_version are not reset, and published Flow graphs remain untouched.
UPDATE md_flow_capability_flow_types
SET create_enabled=true, registry_version=2
WHERE flow_type IN ('Record-Triggered Flow','Schedule-Triggered Flow',
  'Platform Event-Triggered Flow')
  AND create_enabled=false AND registry_version=1 AND validate_enabled=true;

WITH unlocked AS (
 UPDATE md_flow_capability_elements
 SET builder_enabled=true,registry_version=2
 WHERE element_type IN ('Get Records','Update Records','Delete Records','Subflow',
  'Collection Filter','Collection Sort','Transform','Publish Platform Event')
  AND builder_enabled=false AND registry_version=1
 RETURNING element_type
)
UPDATE md_flow_capability_element_flows AS relation
SET builder_allowed=true
FROM unlocked
WHERE relation.element_type=unlocked.element_type
  AND relation.builder_allowed=false;

-- Elements remain excluded from invalid contexts by existing relational
-- element/flow compatibility rows and before_save_allowed=false.
-- Platform Event-Triggered Flows may not recursively publish events.
-- END ORIGINAL MIGRATION 20261113-flow-builder-phase1-unlock.sql

-- BEGIN ORIGINAL MIGRATION 20261114-flow-interview-record-bounds.sql
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM md_flow_interview_records WHERE sort_order>199
 ) THEN
  RAISE EXCEPTION 'Flow interview record collections contain more than 200 entries; reconcile them before applying this migration';
 END IF;
END $$;

ALTER TABLE md_flow_interview_records
 DROP CONSTRAINT IF EXISTS md_flow_interview_records_sort_order_check;
ALTER TABLE md_flow_interview_records
 ADD CONSTRAINT md_flow_interview_records_sort_order_bound
 CHECK (sort_order BETWEEN 0 AND 199);
-- END ORIGINAL MIGRATION 20261114-flow-interview-record-bounds.sql

-- BEGIN ORIGINAL MIGRATION 20261114-flow-phase3-before-save.sql
-- Phase 3: read-only Get Records, Loop and pure collection transformations for before-save flows.
-- Core registry default upgrade only; tenant overrides with newer versions are preserved.
-- Never enables Create/Update/Delete, HTTP, Wait, Subflow or external actions in before-save.
UPDATE md_flow_capability_elements
 SET before_save_allowed=true,registry_version=3
 WHERE element_type IN ('Get Records','Loop','Collection Filter','Collection Sort','Transform')
   AND registry_version IN (1,2) AND before_save_allowed=false AND app_api_name IS NULL;
-- END ORIGINAL MIGRATION 20261114-flow-phase3-before-save.sql

-- BEGIN ORIGINAL MIGRATION 20261114-tenant-media-assets.sql
-- Shared tenant-owned media: reusable by any app, without KFC-specific Core records.
CREATE TABLE IF NOT EXISTS md_tenant_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/gif','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
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
-- END ORIGINAL MIGRATION 20261114-tenant-media-assets.sql

-- BEGIN ORIGINAL MIGRATION 20261115-flow-execution-idempotency.sql
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
  result_payload jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,actor_id,flow_api,request_id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES md_users(tenant_id,id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES md_flow_runs(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_flow_execution_requests_run
  ON md_flow_execution_requests(tenant_id,run_id) WHERE run_id IS NOT NULL;
-- END ORIGINAL MIGRATION 20261115-flow-execution-idempotency.sql

-- BEGIN ORIGINAL MIGRATION 20261115-flow-provider-outbox.sql
-- Provider-backed durable Flow actions must revalidate current SQL activation and permission on dispatch.
-- Preserve all existing queued and completed jobs. No customer data is removed.
ALTER TABLE md_http_callout_jobs
 ADD COLUMN IF NOT EXISTS connection_api text,
 ADD COLUMN IF NOT EXISTS operation_api text,
 ADD COLUMN IF NOT EXISTS operation_path_ciphertext bytea;
ALTER TABLE md_http_callout_jobs
 DROP CONSTRAINT IF EXISTS md_http_callout_provider_pair;
ALTER TABLE md_http_callout_jobs
 ADD CONSTRAINT md_http_callout_provider_pair CHECK (
  (connection_api IS NULL AND operation_api IS NULL AND operation_path_ciphertext IS NULL)
  OR (connection_api ~ '^[A-Za-z][A-Za-z0-9_]*$'
   AND operation_api ~ '^[A-Za-z][A-Za-z0-9_]*$'
   AND operation_path_ciphertext IS NOT NULL));
-- END ORIGINAL MIGRATION 20261115-flow-provider-outbox.sql

-- BEGIN ORIGINAL MIGRATION 20261115-list-views-record-search.sql
CREATE TABLE IF NOT EXISTS md_list_views (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 object_api text NOT NULL,
 owner_id uuid NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 120),
 visibility text NOT NULL CHECK(visibility IN ('private','all','groups')),
 scope text NOT NULL CHECK(scope IN ('my','all','my_team','queue')),
 filter_logic text NOT NULL DEFAULT '',
 sort_field text,
 sort_direction text NOT NULL DEFAULT 'asc' CHECK(sort_direction IN ('asc','desc')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,sort_field)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE INDEX IF NOT EXISTS md_list_views_object_owner
 ON md_list_views(tenant_id,object_api,owner_id);
CREATE TABLE IF NOT EXISTS md_list_view_columns (
 tenant_id uuid NOT NULL,
 view_id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=0),
 field_api text NOT NULL,
 PRIMARY KEY(tenant_id,view_id,position),
 UNIQUE(tenant_id,view_id,field_api),
 FOREIGN KEY(tenant_id,view_id) REFERENCES md_list_views(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_list_view_filters (
 tenant_id uuid NOT NULL,
 view_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 field_api text NOT NULL,
 operator text NOT NULL CHECK(operator IN ('eq','ne','lt','lte','gt','gte','contains','startsWith','includes','excludes','in')),
 value_text text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,view_id,position),
 FOREIGN KEY(tenant_id,view_id) REFERENCES md_list_views(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_list_view_filter_values (
 tenant_id uuid NOT NULL,
 view_id uuid NOT NULL,
 filter_position integer NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 99),
 value_text text NOT NULL,
 PRIMARY KEY(tenant_id,view_id,filter_position,position),
 FOREIGN KEY(tenant_id,view_id,filter_position)
  REFERENCES md_list_view_filters(tenant_id,view_id,position) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_list_view_groups (
 tenant_id uuid NOT NULL,
 view_id uuid NOT NULL,
 group_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,view_id,group_id),
 FOREIGN KEY(tenant_id,view_id) REFERENCES md_list_views(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,group_id) REFERENCES md_access_groups(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_list_view_pins (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 view_id uuid NOT NULL,
 pinned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,view_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,view_id) REFERENCES md_list_views(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_records_list_page
 ON md_records(tenant_id,object_api,created_at,id);
CREATE INDEX IF NOT EXISTS md_records_queue_owner
 ON md_records(tenant_id,object_api,owner_queue_id,id) WHERE owner_queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_record_values_text_lookup
 ON md_record_values(tenant_id,object_api,field_api,value_text) WHERE value_text IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_record_values_boolean_lookup
 ON md_record_values(tenant_id,object_api,field_api,value_boolean) WHERE value_boolean IS NOT NULL;
CREATE INDEX IF NOT EXISTS md_record_policies_share_target
 ON md_record_policies(tenant_id,object_api,target_type,target_id,rule_type,access_level)
 WHERE kind='share' AND enabled;
CREATE INDEX IF NOT EXISTS md_record_policies_restriction_subject
 ON md_record_policies(tenant_id,object_api,subject_type,subject_id)
 WHERE kind='restriction' AND enabled;
CREATE TABLE IF NOT EXISTS md_search_layout_fields (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 weight char(1) NOT NULL DEFAULT 'B' CHECK(weight IN ('A','B','C','D')),
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_search_layout_columns (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 layout_key text NOT NULL CHECK(layout_key IN ('searchResults','lookupDialog','lookupPhoneDialog')),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 499),
 field_api text NOT NULL,
 PRIMARY KEY(tenant_id,object_api,layout_key,position),
 UNIQUE(tenant_id,object_api,layout_key,field_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_record_search_values (
 tenant_id uuid NOT NULL,
 record_id uuid NOT NULL,
 object_api text NOT NULL,
 field_api text NOT NULL,
 weight char(1) NOT NULL CHECK(weight IN ('A','B','C','D')),
 search_vector tsvector NOT NULL,
 PRIMARY KEY(tenant_id,record_id,field_api),
 FOREIGN KEY(tenant_id,record_id,object_api)
  REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_record_search_values_vector
 ON md_record_search_values USING gin(search_vector);
CREATE INDEX IF NOT EXISTS md_record_search_values_object
 ON md_record_search_values(tenant_id,object_api,field_api,record_id);

INSERT INTO md_search_layout_fields(tenant_id,object_api,field_api,weight)
SELECT tenant_id,object_api,api_name,
 CASE WHEN api_name='Name' THEN 'A' WHEN data_type='email' THEN 'B' ELSE 'C' END
FROM md_field_definitions
WHERE deleted_at IS NULL
 AND data_type IN ('text','email','phone','url','picklist')
ON CONFLICT(tenant_id,object_api,field_api) DO NOTHING;

CREATE OR REPLACE FUNCTION md_searchable_field_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted_at IS NULL AND NEW.data_type IN ('text','email','phone','url','picklist') THEN
  INSERT INTO md_search_layout_fields(tenant_id,object_api,field_api,weight)
  VALUES(NEW.tenant_id,NEW.object_api,NEW.api_name,
   CASE WHEN NEW.api_name='Name' THEN 'A' WHEN NEW.data_type='email' THEN 'B' ELSE 'C' END)
  ON CONFLICT(tenant_id,object_api,field_api) DO NOTHING;
 ELSE
  DELETE FROM md_search_layout_fields
   WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND field_api=NEW.api_name;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER md_searchable_field_default_trigger
AFTER INSERT OR UPDATE OF data_type,deleted_at ON md_field_definitions
FOR EACH ROW EXECUTE FUNCTION md_searchable_field_default();

CREATE OR REPLACE FUNCTION md_refresh_record_search_value(
 t uuid,rid uuid,obj text,field text,raw_value text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE configured_weight char(1);
BEGIN
 SELECT weight INTO configured_weight FROM md_search_layout_fields
 WHERE tenant_id=t AND object_api=obj AND field_api=field;
 IF configured_weight IS NULL OR raw_value IS NULL OR length(raw_value)=0 THEN
  DELETE FROM md_record_search_values
   WHERE tenant_id=t AND record_id=rid AND field_api=field;
  RETURN;
 END IF;
 INSERT INTO md_record_search_values(tenant_id,record_id,object_api,field_api,weight,search_vector)
 VALUES(t,rid,obj,field,configured_weight,to_tsvector('simple',raw_value))
 ON CONFLICT(tenant_id,record_id,field_api) DO UPDATE SET
  weight=EXCLUDED.weight,search_vector=EXCLUDED.search_vector;
END $$;

CREATE OR REPLACE FUNCTION md_record_search_values_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM md_refresh_record_search_value(OLD.tenant_id,OLD.record_id,OLD.object_api,OLD.field_api,NULL);
  RETURN OLD;
 END IF;
 PERFORM md_refresh_record_search_value(NEW.tenant_id,NEW.record_id,NEW.object_api,NEW.field_api,NEW.value_text);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_record_search_values_sync_trigger ON md_record_values;
CREATE TRIGGER md_record_search_values_sync_trigger
AFTER INSERT OR UPDATE OF value_text,field_api,object_api OR DELETE ON md_record_values
FOR EACH ROW EXECUTE FUNCTION md_record_search_values_sync();

CREATE OR REPLACE FUNCTION md_search_layout_fields_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM md_record_search_values
   WHERE tenant_id=OLD.tenant_id AND object_api=OLD.object_api AND field_api=OLD.field_api;
  RETURN OLD;
 END IF;
 FOR item IN
  SELECT v.record_id,v.value_text FROM md_record_values v
  WHERE v.tenant_id=NEW.tenant_id AND v.object_api=NEW.object_api AND v.field_api=NEW.field_api
 LOOP
  PERFORM md_refresh_record_search_value(NEW.tenant_id,item.record_id,NEW.object_api,NEW.field_api,item.value_text);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER md_search_layout_fields_sync_trigger
AFTER INSERT OR UPDATE OF weight OR DELETE ON md_search_layout_fields
FOR EACH ROW EXECUTE FUNCTION md_search_layout_fields_sync();

INSERT INTO md_record_search_values(tenant_id,record_id,object_api,field_api,weight,search_vector)
SELECT v.tenant_id,v.record_id,v.object_api,v.field_api,s.weight,to_tsvector('simple',v.value_text)
FROM md_record_values v JOIN md_search_layout_fields s
 ON s.tenant_id=v.tenant_id AND s.object_api=v.object_api AND s.field_api=v.field_api
WHERE v.value_text IS NOT NULL AND length(v.value_text)>0
ON CONFLICT(tenant_id,record_id,field_api) DO UPDATE SET
 weight=EXCLUDED.weight,search_vector=EXCLUDED.search_vector;
-- END ORIGINAL MIGRATION 20261115-list-views-record-search.sql

-- BEGIN ORIGINAL MIGRATION 20261116-business-calendar-usage.sql
ALTER TABLE md_tenant_settings
 DROP CONSTRAINT IF EXISTS md_tenant_settings_setting_key_check;
ALTER TABLE md_tenant_settings
 ADD CONSTRAINT md_tenant_settings_setting_key_check
 CHECK (setting_key IN ('company-profile','currencies','automation-settings','business-calendar'));

ALTER TABLE md_tenant_usage_targets
 DROP CONSTRAINT IF EXISTS md_tenant_usage_targets_metric_check;
ALTER TABLE md_tenant_usage_targets
 ADD CONSTRAINT md_tenant_usage_targets_metric_check
 CHECK (metric IN ('users','records','objects','flows','storage_bytes','api_requests_daily'));

CREATE TABLE IF NOT EXISTS md_tenant_api_usage_daily (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 usage_date date NOT NULL,
 request_count bigint NOT NULL DEFAULT 0 CHECK(request_count>=0),
 PRIMARY KEY(tenant_id,usage_date)
);
-- END ORIGINAL MIGRATION 20261116-business-calendar-usage.sql

-- BEGIN ORIGINAL MIGRATION 20261116-flow-orchestration.sql
-- Phase 5: durable human approvals, no JSON graph state or separate workflow engine.
-- Upgrade preserves all tenant data and existing published flows.
ALTER TABLE md_flow_runs DROP CONSTRAINT IF EXISTS md_flow_runs_wait_kind_check;
ALTER TABLE md_flow_runs ADD CONSTRAINT md_flow_runs_wait_kind_check
 CHECK(wait_kind IN ('wait','scheduled-path','orchestration'));

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

-- Enable only when the installed baseline registry is still administrator-unmodified.
UPDATE md_flow_capability_flow_types
 SET create_enabled=true,validate_enabled=true,debug_enabled=true,registry_version=3
 WHERE flow_type='Flow Orchestration' AND create_enabled=false
  AND validate_enabled=false AND registry_version=1;

INSERT INTO md_flow_capability_elements
 (element_type,display_group,display_icon,sort_order,builder_enabled,before_save_allowed,
  config_schema_key,validator_key,runtime_handler_key,debug_behavior,registry_version)
 VALUES ('Orchestration Stage','Interaction','◎',210,true,false,
 'flow:Orchestration Stage','Orchestration Stage','Orchestration Stage','simulate',3)
 ON CONFLICT(element_type) DO NOTHING;

INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
 VALUES ('Orchestration Stage','Flow Orchestration',true)
 ON CONFLICT(element_type,flow_type) DO NOTHING;

-- Reuse general-purpose Flow operations only; Screens and record-only Custom Error
-- remain excluded. SQL allows no app-specific Core handlers.
INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
 SELECT element_type,'Flow Orchestration',builder_allowed
 FROM md_flow_capability_element_flows
 WHERE flow_type='Autolaunched Flow'
  AND element_type NOT IN ('Screen','Custom Error','Orchestration Stage')
 ON CONFLICT(element_type,flow_type) DO NOTHING;

INSERT INTO md_flow_capability_properties
 (element_type,property_name,value_type,required,sort_order)
 VALUES ('Orchestration Stage','objectApiName','text',true,10),
 ('Orchestration Stage','recordId','resource',true,20),
 ('Orchestration Stage','approvalMode','text',true,30),
 ('Orchestration Stage','statusVariable','resource',false,40)
 ON CONFLICT(element_type,property_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261116-flow-orchestration.sql

-- BEGIN ORIGINAL MIGRATION 20261116-mobile-list-view-roles.sql
-- Additive phone-list presentation metadata. Applied after 20261115-list-views-record-search.sql.
-- The role does not change SQL row visibility, record permissions or desktop columns.
ALTER TABLE md_list_view_columns
  ADD COLUMN IF NOT EXISTS phone_role text;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='md_list_view_columns_phone_role_chk'
  ) THEN
    ALTER TABLE md_list_view_columns ADD CONSTRAINT md_list_view_columns_phone_role_chk
      CHECK (phone_role IS NULL OR phone_role IN ('title','subtitle','badge','trailing','hidden'));
  END IF;
END $$;
-- END ORIGINAL MIGRATION 20261116-mobile-list-view-roles.sql

-- BEGIN ORIGINAL MIGRATION 20261116-relational-flow-execution-results.sql
-- Upgrade-safe conversion of generic Flow replay snapshots to relational path/value rows.
-- No app-specific payment data or JSON runtime payload remains in SQL after migration.
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

-- Upgrades from 20261115 must preserve completed responses, including nested
-- object and array values. A fresh schema does not have the legacy JSONB column.
DO $upgrade$
BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema=current_schema()
     AND table_name='md_flow_execution_requests' AND column_name='result_payload'
 ) THEN
  EXECUTE $migrate$
   WITH RECURSIVE nodes AS (
     SELECT tenant_id,actor_id,flow_api,request_id,
       '/result'::text AS path,result_payload AS value
     FROM md_flow_execution_requests WHERE result_payload IS NOT NULL
     UNION ALL
     SELECT n.tenant_id,n.actor_id,n.flow_api,n.request_id,
       n.path || '/' || replace(replace(child.label,'~','~0'),'/','~1'),child.value
     FROM nodes n
     CROSS JOIN LATERAL (
       SELECT key AS label,value
       FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object'
                          THEN n.value ELSE '{}'::jsonb END)
       UNION ALL
       SELECT (ordinality-1)::text AS label,value
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array'
                                     THEN n.value ELSE '[]'::jsonb END)
       WITH ORDINALITY
     ) child
   )
   INSERT INTO md_flow_execution_result_values
      (tenant_id,actor_id,flow_api,request_id,property_path,value_kind,value_text)
   SELECT tenant_id,actor_id,flow_api,request_id,path,jsonb_typeof(value),
     CASE WHEN jsonb_typeof(value) IN ('string','number','boolean')
       THEN value #>> '{}' ELSE NULL END
   FROM nodes
   ON CONFLICT(tenant_id,actor_id,flow_api,request_id,property_path) DO NOTHING
  $migrate$;
  -- Dropping the old JSONB source only happens after all rows are migrated
  -- successfully within the same transactional migration.
  ALTER TABLE md_flow_execution_requests DROP COLUMN result_payload;
 END IF;
END $upgrade$;
-- END ORIGINAL MIGRATION 20261116-relational-flow-execution-results.sql

-- BEGIN ORIGINAL MIGRATION 20261117-metadata-packages.sql
CREATE TABLE IF NOT EXISTS md_metadata_package_installations(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 package_api text NOT NULL,
 label text NOT NULL,
 package_type text NOT NULL CHECK(package_type IN ('Managed','Unlocked')),
 version integer NOT NULL CHECK(version>0),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 active boolean NOT NULL DEFAULT true,
 installed_by uuid NOT NULL REFERENCES md_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,package_api)
);
CREATE TABLE IF NOT EXISTS md_metadata_package_versions(
 tenant_id uuid NOT NULL,
 package_api text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 installed_by uuid NOT NULL,
 installed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,package_api,version),
 FOREIGN KEY(tenant_id,package_api)
  REFERENCES md_metadata_package_installations(tenant_id,package_api) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,installed_by) REFERENCES md_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS md_metadata_package_components(
 tenant_id uuid NOT NULL,
 package_api text NOT NULL,
 component_type text NOT NULL CHECK(component_type IN ('object','page','component')),
 component_api text NOT NULL,
 component_state text NOT NULL DEFAULT 'Active'
  CHECK(component_state IN ('Active','Disabled','Retained')),
 component_digest text NOT NULL CHECK(component_digest ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(tenant_id,package_api,component_type,component_api),
 FOREIGN KEY(tenant_id,package_api)
  REFERENCES md_metadata_package_installations(tenant_id,package_api) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261117-metadata-packages.sql

-- BEGIN ORIGINAL MIGRATION 20261117-platform-event-streaming.sql
ALTER TABLE md_platform_event_messages
 ADD COLUMN IF NOT EXISTS replay_id bigserial;

CREATE UNIQUE INDEX IF NOT EXISTS md_platform_event_messages_replay
 ON md_platform_event_messages(tenant_id,replay_id);
-- END ORIGINAL MIGRATION 20261117-platform-event-streaming.sql

-- BEGIN ORIGINAL MIGRATION 20261118-autolaunched-custom-errors.sql
-- Custom Error already executes via the shared Flow engine in autolaunched
-- transactions; expose the node via the SQL capability registry as well.
-- Existing tenant customisations and other node permissions remain unchanged.
INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
SELECT 'Custom Error','Autolaunched Flow',true
WHERE EXISTS(SELECT 1 FROM md_flow_capability_elements WHERE element_type='Custom Error')
  AND EXISTS(SELECT 1 FROM md_flow_capability_flow_types WHERE flow_type='Autolaunched Flow')
ON CONFLICT(element_type,flow_type) DO NOTHING;
-- END ORIGINAL MIGRATION 20261118-autolaunched-custom-errors.sql

-- BEGIN ORIGINAL MIGRATION 20261118-outbound-webhooks.sql
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
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,api_name),
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
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,subscription_id,event_id),
 FOREIGN KEY(tenant_id,subscription_id)
  REFERENCES md_webhook_subscriptions(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id)
  REFERENCES md_platform_event_messages(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS md_webhook_deliveries_queue
 ON md_webhook_deliveries(tenant_id,status,created_at,id) WHERE status='queued';
-- END ORIGINAL MIGRATION 20261118-outbound-webhooks.sql

-- BEGIN ORIGINAL MIGRATION 20261119-openapi-external-services.sql
CREATE TABLE IF NOT EXISTS md_external_services(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 api_name text NOT NULL,
 label text NOT NULL,
 server_origin text NOT NULL,
 server_path text NOT NULL DEFAULT '',
 imported_by uuid NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,api_name),
 FOREIGN KEY(tenant_id,imported_by) REFERENCES md_users(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS md_external_service_operations(
 tenant_id uuid NOT NULL,
 service_api text NOT NULL,
 operation_api text NOT NULL,
 label text NOT NULL,
 http_method text NOT NULL CHECK(http_method IN ('GET','POST','PUT','PATCH','DELETE')),
 path_template text NOT NULL,
 request_body_required boolean NOT NULL DEFAULT false,
 request_body_type text,
 PRIMARY KEY(tenant_id,service_api,operation_api),
 FOREIGN KEY(tenant_id,service_api)
  REFERENCES md_external_services(tenant_id,api_name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS md_external_service_parameters(
 tenant_id uuid NOT NULL,
 service_api text NOT NULL,
 operation_api text NOT NULL,
 parameter_name text NOT NULL,
 parameter_location text NOT NULL CHECK(parameter_location IN ('path','query','body')),
 required boolean NOT NULL,
 value_type text NOT NULL CHECK(value_type IN ('string','number','integer','boolean')),
 PRIMARY KEY(tenant_id,service_api,operation_api,parameter_name,parameter_location),
 FOREIGN KEY(tenant_id,service_api,operation_api)
  REFERENCES md_external_service_operations(tenant_id,service_api,operation_api) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS md_external_service_operation_tenant_api
 ON md_external_service_operations(tenant_id,operation_api);
-- END ORIGINAL MIGRATION 20261119-openapi-external-services.sql

-- BEGIN ORIGINAL MIGRATION 20261120-metadata-package-component-types.sql
ALTER TABLE md_metadata_package_components
 DROP CONSTRAINT IF EXISTS md_metadata_package_components_component_type_check;
ALTER TABLE md_metadata_package_components
 ADD CONSTRAINT md_metadata_package_components_component_type_check
 CHECK(component_type IN ('object','page','component','flow','object-config','permission-set'));
-- END ORIGINAL MIGRATION 20261120-metadata-package-component-types.sql

-- BEGIN ORIGINAL MIGRATION 20261121-login-password-policy.sql
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
-- END ORIGINAL MIGRATION 20261121-login-password-policy.sql

-- BEGIN ORIGINAL MIGRATION 20261121-offline-briefcase.sql
ALTER TABLE md_tenant_settings
 DROP CONSTRAINT IF EXISTS md_tenant_settings_setting_key_check;
ALTER TABLE md_tenant_settings
 ADD CONSTRAINT md_tenant_settings_setting_key_check
 CHECK (setting_key IN ('company-profile','currencies','automation-settings','business-calendar','offline-briefcase'));
-- END ORIGINAL MIGRATION 20261121-offline-briefcase.sql

-- BEGIN ORIGINAL MIGRATION 20261122-identity-session-controls.sql
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
-- Legacy access/refresh pairs cannot be safely reconstructed. Sign them out once.
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
-- END ORIGINAL MIGRATION 20261122-identity-session-controls.sql

-- BEGIN ORIGINAL MIGRATION 20261123-security-governance.sql
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
-- END ORIGINAL MIGRATION 20261123-security-governance.sql

-- BEGIN ORIGINAL MIGRATION 20261124-connected-apps.sql
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
-- END ORIGINAL MIGRATION 20261124-connected-apps.sql

-- BEGIN ORIGINAL MIGRATION 20261125-setup-audit-coverage.sql
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
-- END ORIGINAL MIGRATION 20261125-setup-audit-coverage.sql

-- BEGIN ORIGINAL MIGRATION 20261126-inbound-webhook-endpoints.sql
-- Universal tenant/app scoped inbound webhook registry. Outbound subscriptions remain independent.
CREATE TABLE IF NOT EXISTS md_inbound_webhook_endpoints (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 api_name text NOT NULL CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 app_id uuid NOT NULL REFERENCES md_apps(id),
 flow_api text NOT NULL CHECK(flow_api ~ '^[A-Za-z][A-Za-z0-9_]*$'),
 execution_user_id uuid NOT NULL,
 provider text NOT NULL DEFAULT 'Meta' CHECK(provider IN ('Meta','HmacSha256')),
 verify_token_digest bytea NOT NULL,
 signature_secret_ciphertext bytea NOT NULL,
 encryption_key_id text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,api_name),
 FOREIGN KEY(tenant_id,execution_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_inbound_webhook_endpoints_app
 ON md_inbound_webhook_endpoints(tenant_id,app_id) WHERE enabled=true;
CREATE TABLE IF NOT EXISTS md_inbound_webhook_events (
 tenant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL,
 payload jsonb NOT NULL,
 payload_hash text NOT NULL,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','completed','failed')),
 error_code text,
 received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,endpoint_id,payload_hash),
 FOREIGN KEY(tenant_id,endpoint_id) REFERENCES md_inbound_webhook_endpoints(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_inbound_webhook_events_status
 ON md_inbound_webhook_events(tenant_id,status,received_at);
-- END ORIGINAL MIGRATION 20261126-inbound-webhook-endpoints.sql

-- BEGIN ORIGINAL MIGRATION 20261126-mcp-connection.sql
-- MCP credentials are explicitly bound to one HTTPS resource and retain central RBAC.
ALTER TABLE md_oauth_consents ADD COLUMN IF NOT EXISTS resource text;
ALTER TABLE md_oauth_client_scopes DROP CONSTRAINT IF EXISTS md_oauth_client_scopes_scope_check;
ALTER TABLE md_oauth_client_scopes ADD CONSTRAINT md_oauth_client_scopes_scope_check
 CHECK(scope IN ('records:read','records:write','metadata:read','flows:execute','mcp:access','operations:manage'));
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
-- END ORIGINAL MIGRATION 20261126-mcp-connection.sql

-- BEGIN ORIGINAL MIGRATION 20261126-metadata-loader-hard-delete-permissions.sql
-- Explicit OneEngine privileges for metadata purge. No role receives these automatically.
INSERT INTO md_system_permission_catalogue(permission_key,label,description,resource,action) VALUES
 ('objects:hardDelete','Permanently Delete Objects','Permanent metadata deletion (requires OneEngine grant)','ObjectDefinition','hard-delete'),
 ('fields:hardDelete','Permanently Delete Fields','Permanent metadata deletion (requires OneEngine grant)','FieldDefinition','hard-delete')
ON CONFLICT(permission_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20261126-metadata-loader-hard-delete-permissions.sql

-- BEGIN ORIGINAL MIGRATION 20261127-credential-webhooks.sql
-- Optional inbound webhooks belong to a Named Credential, not to a Flow or app.
-- Older app/Flow webhook endpoints remain valid.
ALTER TABLE md_inbound_webhook_endpoints
  ADD COLUMN IF NOT EXISTS credential_id uuid;
ALTER TABLE md_inbound_webhook_endpoints ALTER COLUMN app_id DROP NOT NULL;
ALTER TABLE md_inbound_webhook_endpoints ALTER COLUMN flow_api DROP NOT NULL;
ALTER TABLE md_inbound_webhook_endpoints ALTER COLUMN execution_user_id DROP NOT NULL;
ALTER TABLE md_inbound_webhook_endpoints
  ADD CONSTRAINT md_inbound_webhook_credential_fk
  FOREIGN KEY (tenant_id,credential_id)
  REFERENCES md_named_credentials(tenant_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS md_inbound_webhook_credential_one
  ON md_inbound_webhook_endpoints(tenant_id,credential_id)
  WHERE credential_id IS NOT NULL;
-- END ORIGINAL MIGRATION 20261127-credential-webhooks.sql

-- BEGIN ORIGINAL MIGRATION 20261127-flow-parse-json.sql
-- Shared, no-code Flow JSON selector for signed webhook and HTTP payloads.
INSERT INTO md_flow_capability_elements
(element_type,display_group,display_icon,sort_order,builder_enabled,before_save_allowed,
 config_schema_key,validator_key,runtime_handler_key,debug_behavior,registry_version)
VALUES('Parse JSON','Data','{}',185,true,false,'flow:Parse JSON',
 'Parse JSON','Parse JSON','simulate',4)
ON CONFLICT(element_type) DO NOTHING;
INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
SELECT 'Parse JSON',flow_type,true FROM md_flow_capability_flow_types
 WHERE flow_type IN ('Autolaunched Flow','Screen Flow','Record-Triggered Flow')
ON CONFLICT(element_type,flow_type) DO NOTHING;
INSERT INTO md_flow_capability_properties(element_type,property_name,value_type,required,sort_order)
VALUES('Parse JSON','source','resource',true,10),
      ('Parse JSON','assignments','list',true,20)
ON CONFLICT(element_type,property_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261127-flow-parse-json.sql

-- BEGIN ORIGINAL MIGRATION 20261127-platform-deployment-owner-bootstrap.sql
-- A one-time, append-only receipt for the provisioned platform deploy owner.
-- Never use bootstrap credentials as runtime authorization. Runtime checks only SQL
-- assignments and revocable OneEngine RBAC grants.
CREATE TABLE IF NOT EXISTS md_platform_deployment_owner_receipts (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);
-- END ORIGINAL MIGRATION 20261127-platform-deployment-owner-bootstrap.sql

-- BEGIN ORIGINAL MIGRATION 20261128-approved-oci-platform-owner.sql
-- One-time OCI platform-owner approval from the authenticated repository owner.
-- Selector is a SHA-256 digest of the explicitly supplied account identifier;
-- no plaintext user identifiers or runtime email bypass are introduced.
-- This does not change OneEngine or grant platform rights to other tenant users.
-- Platform runtime checks continue to require PlatformDeveloper + central RBAC.
-- The existing append-only receipt prevents silently restoring revoked grants.
DO $platform_owner$
DECLARE
 target_tenant uuid;
 target_user uuid;
 policy_id uuid;
 policy_effect text;
BEGIN
 IF EXISTS(SELECT 1 FROM md_platform_deployment_owner_receipts) THEN
  RAISE NOTICE 'Platform deployment owner already bootstrapped; no changes';
  RETURN;
 END IF;
 IF (SELECT count(*) FROM md_tenants) <> 1 THEN
  RAISE NOTICE 'Platform owner approval skipped: not a single-tenant OCI platform';
  RETURN;
 END IF;
 SELECT u.tenant_id,u.id INTO target_tenant,target_user
 FROM md_users u
 JOIN md_tenants t ON t.id=u.tenant_id
 JOIN md_tenant_domains d ON d.tenant_id=t.id
 WHERE d.domain='unesolutions.co.uk'
   AND t.status='ACTIVE' AND u.enabled=true AND u.user_type='internal'
   AND encode(sha256(convert_to(lower(u.email),'UTF8')),'hex')=
     '1aaeebc4119ff93bf2deadf59584c50f517633871c355fa05999429cc1479819'
   AND EXISTS (
    SELECT 1 FROM md_permission_assignments a
    JOIN md_permission_sets p ON p.tenant_id=a.tenant_id AND p.id=a.permission_set_id
    WHERE a.tenant_id=u.tenant_id AND a.user_id=u.id AND p.api_name='OneEngine')
   AND md_rbac_allowed(u.tenant_id,u.id,'Tenant','manage');
 IF target_user IS NULL THEN
  RAISE NOTICE 'Platform owner approval skipped: selected account not uniquely eligible';
  RETURN;
 END IF;
 -- Never overwrite an existing policy, explicit deny or tenant customisation.
 INSERT INTO md_permission_sets(tenant_id,api_name)
 VALUES(target_tenant,'PlatformDeveloper')
 ON CONFLICT(tenant_id,api_name) DO NOTHING;
 SELECT id INTO policy_id FROM md_permission_sets
 WHERE tenant_id=target_tenant AND api_name='PlatformDeveloper';
 INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
 VALUES(target_tenant,policy_id,'PlatformOperations','manage','allow')
 ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING;
 SELECT effect INTO policy_effect FROM md_permission_rules
 WHERE tenant_id=target_tenant AND permission_set_id=policy_id
   AND resource='PlatformOperations' AND action='manage';
 IF policy_effect IS DISTINCT FROM 'allow' THEN
  RAISE NOTICE 'Platform owner approval skipped: existing policy denies operations';
  RETURN;
 END IF;
 INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id)
 VALUES(target_tenant,target_user,policy_id)
 ON CONFLICT(tenant_id,user_id,permission_set_id) DO NOTHING;
 -- SQL is the source of truth. No email-based request bypass or hidden role.
 INSERT INTO md_platform_deployment_owner_receipts(tenant_id,user_id)
 VALUES(target_tenant,target_user);
 INSERT INTO md_security_events(tenant_id,actor_user_id,subject_user_id,action,details)
 VALUES(target_tenant,NULL,target_user,'platform.production-deploy.bootstrap-granted',
  '{"source":"approved-oci-owner-bootstrap","policy":"PlatformDeveloper","resource":"PlatformOperations","action":"manage"}'::jsonb);
 RAISE NOTICE 'Approved OCI platform owner policy granted; runtime RBAC remains authoritative';
END $platform_owner$;
-- END ORIGINAL MIGRATION 20261128-approved-oci-platform-owner.sql

-- BEGIN ORIGINAL MIGRATION 20261128-connector-app-metadata.sql
-- Connector app ownership and non-secret, independently editable tenant configuration fields.
CREATE TABLE IF NOT EXISTS md_connector_app_credentials (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_id uuid NOT NULL REFERENCES md_apps(id),
 credential_id uuid NOT NULL,
 credential_name text NOT NULL,
 provisioned boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,app_id,credential_name),
 FOREIGN KEY (tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_connector_app_credentials_ref
 ON md_connector_app_credentials(tenant_id,credential_id);
CREATE TABLE IF NOT EXISTS md_connector_app_fields (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_id uuid NOT NULL REFERENCES md_apps(id),
 credential_name text NOT NULL,
 field_api text NOT NULL CHECK(field_api ~ '^public_[A-Za-z][A-Za-z0-9_]*$'),
 label text NOT NULL,
 required boolean NOT NULL DEFAULT false,
 default_value text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,app_id,credential_name,field_api),
 FOREIGN KEY(tenant_id,app_id,credential_name)
 REFERENCES md_connector_app_credentials(tenant_id,app_id,credential_name)
);
-- END ORIGINAL MIGRATION 20261128-connector-app-metadata.sql

-- BEGIN ORIGINAL MIGRATION 20261128-universal-context-flows.sql
-- Metadata-only registration: reuse the shared Flow runtime and SQL user contexts.
INSERT INTO md_flow_capability_elements
(element_type,display_group,display_icon,sort_order,builder_enabled,before_save_allowed,
 config_schema_key,validator_key,runtime_handler_key,debug_behavior,registry_version)
VALUES('Get Context','Data','C',166,true,false,'flow:Get Context','Get Context','Get Context','simulate',1),
 ('Set Context','Data','C',167,true,false,'flow:Set Context','Set Context','Set Context','simulate',1),
 ('Clear Context','Data','C',168,true,false,'flow:Clear Context','Clear Context','Clear Context','simulate',1)
ON CONFLICT(element_type) DO NOTHING;
INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
SELECT e.element_type,f.flow_type,true FROM md_flow_capability_elements e
CROSS JOIN md_flow_capability_flow_types f
WHERE e.element_type IN('Get Context','Set Context','Clear Context')
 AND f.flow_type IN('Autolaunched Flow','Screen Flow','In-Screen Flow','Record-Triggered Flow')
ON CONFLICT(element_type,flow_type) DO NOTHING;
INSERT INTO md_flow_capability_properties(element_type,property_name,value_type,required,sort_order)
VALUES('Get Context','contextApiName','text',true,10),
 ('Get Context','outputVariable','resource',true,20),
 ('Set Context','contextApiName','text',true,10),
 ('Set Context','recordId','resource',true,20),
 ('Clear Context','contextApiName','text',true,10)
ON CONFLICT(element_type,property_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261128-universal-context-flows.sql

-- BEGIN ORIGINAL MIGRATION 20261128-webhook-verify-token-vault.sql
-- Preserve separately generated webhook verify tokens for audited, RBAC-restricted retrieval.
-- Older hash-only endpoints remain valid but require resetting the verification token to make it revealable.
ALTER TABLE md_inbound_webhook_endpoints ADD COLUMN IF NOT EXISTS verify_token_ciphertext bytea;
-- END ORIGINAL MIGRATION 20261128-webhook-verify-token-vault.sql

-- BEGIN ORIGINAL MIGRATION 20261129-oneengine-oci-deployment.sql
-- Transfer OCI deployment authority to the existing OneEngine permission set,
-- only in the canonical platform tenant. All other tenants are excluded.
-- Preserve existing explicit deny/customisation; no user assignments, records,
-- legacy permission sets or privileges are removed.
WITH granted AS (
 INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
 SELECT p.tenant_id,p.id,'PlatformOperations','manage','allow'
 FROM md_permission_sets p
 JOIN md_tenant_domains d ON d.tenant_id=p.tenant_id
 JOIN md_tenants t ON t.id=d.tenant_id
 WHERE p.api_name='OneEngine' AND d.domain='unesolutions.co.uk'
  AND t.status='ACTIVE'
 ON CONFLICT(tenant_id,permission_set_id,resource,action) DO NOTHING
 RETURNING tenant_id
)
INSERT INTO md_security_events(tenant_id,actor_user_id,action,details)
SELECT tenant_id,NULL,'platform.oneengine-deploy-grant.migrated',
 '{"policy":"OneEngine","resource":"PlatformOperations","action":"manage"}'::jsonb
FROM granted;
-- END ORIGINAL MIGRATION 20261129-oneengine-oci-deployment.sql

-- BEGIN ORIGINAL MIGRATION 20261129-required-connector-fields.sql
-- Remove obsolete connector-installed optional field declarations for existing tenants.
-- Named Credential configuration ciphertext and secrets are never modified.
DELETE FROM md_connector_app_fields f
USING md_apps a
WHERE f.app_id=a.id
  AND a.tenant_owner_id IS NULL
  AND a.api_name IN ('WhatsAppConnector','SmsGateConnector','BrevoConnector',
                     'UberEatsConnector','DeliverooConnector','JustEatConnector')
  AND NOT (a.api_name='WhatsAppConnector' AND f.field_api='public_phoneNumberId');
-- END ORIGINAL MIGRATION 20261129-required-connector-fields.sql

-- BEGIN ORIGINAL MIGRATION 20261130-connector-app-classification.sql
-- Classify installable packages independently of business-app navigation.
-- Additive and idempotent: installed receipts, tenants, credentials and records are preserved.
ALTER TABLE md_apps
  ADD COLUMN IF NOT EXISTS app_type text NOT NULL DEFAULT 'Application';
ALTER TABLE md_apps
  DROP CONSTRAINT IF EXISTS md_apps_app_type_check;
ALTER TABLE md_apps
  ADD CONSTRAINT md_apps_app_type_check
  CHECK (app_type IN ('Application','ConnectorApp'));
UPDATE md_apps
SET app_type='ConnectorApp'
WHERE tenant_owner_id IS NULL
  AND api_name IN ('WhatsAppConnector','SmsGateConnector','BrevoConnector',
                   'UberEatsConnector','DeliverooConnector','JustEatConnector')
  AND app_type<>'ConnectorApp';
-- END ORIGINAL MIGRATION 20261130-connector-app-classification.sql

-- BEGIN ORIGINAL MIGRATION 20261130-integration-api-logs.sql
-- Tenant-scoped, body-free audit trail for integration HTTP traffic.
-- Payloads, authorization headers, query strings and credentials are deliberately not stored.
CREATE TABLE IF NOT EXISTS md_integration_api_logs (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 direction text NOT NULL CHECK(direction IN ('Inbound','Outbound')),
 transport text NOT NULL DEFAULT 'HTTP' CHECK(transport IN ('HTTP','Webhook')),
 provider text NOT NULL DEFAULT 'Unknown',
 credential_id uuid,
 actor_user_id uuid,
 endpoint text NOT NULL CHECK(length(endpoint)<=2048),
 method text NOT NULL CHECK(method IN ('GET','POST','PUT','PATCH','DELETE','OTHER')),
 status_code integer CHECK(status_code IS NULL OR status_code BETWEEN 100 AND 599),
 outcome text NOT NULL CHECK(outcome IN ('success','http_error','network_error','rejected')),
 duration_ms integer NOT NULL DEFAULT 0 CHECK(duration_ms>=0),
 request_bytes integer NOT NULL DEFAULT 0 CHECK(request_bytes>=0),
 response_bytes integer NOT NULL DEFAULT 0 CHECK(response_bytes>=0),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_integration_api_logs_tenant_time
 ON md_integration_api_logs(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS md_integration_api_logs_tenant_direction_time
 ON md_integration_api_logs(tenant_id,direction,created_at DESC);
CREATE INDEX IF NOT EXISTS md_integration_api_logs_tenant_credential_time
 ON md_integration_api_logs(tenant_id,credential_id,created_at DESC)
 WHERE credential_id IS NOT NULL;
-- END ORIGINAL MIGRATION 20261130-integration-api-logs.sql

-- BEGIN ORIGINAL MIGRATION 20261130-z-communication-delivery-outbox.sql
CREATE TABLE IF NOT EXISTS md_communication_delivery_outbox (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 direction text NOT NULL CHECK(direction IN ('Inbound','Outbound')),
 transport text NOT NULL CHECK(transport IN ('HTTP','Webhook','SMTP')),
 provider text NOT NULL CHECK(length(provider)<=500),
 credential_id uuid,
 actor_user_id uuid,
 endpoint text NOT NULL CHECK(length(endpoint)<=2048),
 method text NOT NULL CHECK(method IN ('GET','POST','PUT','PATCH','DELETE','SMTP','OTHER')),
 status_code integer CHECK(status_code IS NULL OR status_code BETWEEN 100 AND 599),
 outcome text NOT NULL CHECK(outcome IN ('success','http_error','network_error','rejected')),
 duration_ms integer NOT NULL CHECK(duration_ms>=0),
 request_bytes integer NOT NULL CHECK(request_bytes>=0),
 response_bytes integer NOT NULL CHECK(response_bytes>=0),
 error_code text CHECK(error_code IS NULL OR length(error_code)<=100),
 channel text NOT NULL CHECK(channel IN ('Email','SMS','WhatsApp','Phone','WebChat','Push','Other')),
 name text NOT NULL CHECK(length(name)<=500),
 sender text NOT NULL CHECK(length(sender)<=500),
 recipient text NOT NULL CHECK(length(recipient)<=500),
 subject text CHECK(subject IS NULL OR length(subject)<=500),
 body text CHECK(body IS NULL OR length(body)<=10000),
 external_message_id text NOT NULL CHECK(length(external_message_id)<=500),
 related_object text NOT NULL CHECK(length(related_object)<=120),
 related_record_id text,
 conversation_id text CHECK(conversation_id IS NULL OR length(conversation_id)<=500),
 received_at timestamptz,
 sent_at timestamptz,
 occurred_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 last_error text CHECK(last_error IS NULL OR length(last_error)<=100),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_communication_delivery_outbox_pending
 ON md_communication_delivery_outbox(next_attempt_at,created_at,id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS md_communication_delivery_outbox_claimed
 ON md_communication_delivery_outbox(claimed_at) WHERE status='processing';
-- END ORIGINAL MIGRATION 20261130-z-communication-delivery-outbox.sql

-- BEGIN ORIGINAL MIGRATION 20261201-communication-logger-identity.sql
-- A disabled developer@tenant cannot write Communication: md_rbac_decision requires
-- enabled users. Provide an explicitly permissioned, tenant-scoped, non-login
-- system actor for central external communication delivery.
CREATE TABLE IF NOT EXISTS md_communication_logger_accounts (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 UNIQUE (tenant_id,user_id),
 FOREIGN KEY (tenant_id,user_id) REFERENCES md_users(tenant_id,id)
);

CREATE OR REPLACE FUNCTION md_ensure_communication_logger(t uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE actor uuid; policy uuid;
BEGIN
 PERFORM 1 FROM md_tenants WHERE id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found for Communication logger'; END IF;
 SELECT user_id INTO actor FROM md_communication_logger_accounts
 WHERE tenant_id=t FOR UPDATE;
 IF actor IS NULL THEN
  -- Not a login identity: invalid password format and permanent login lock.
  -- A collision must abort installation rather than grant rights to a real user.
  INSERT INTO md_users(tenant_id,email,password_hash,display_name,enabled,locked_until,user_type)
  VALUES(t,'onesys-communication-logger@system.invalid','!no-interactive-login!',
   'Communication Logger',true,'infinity'::timestamptz,'internal')
  RETURNING id INTO actor;
  INSERT INTO md_communication_logger_accounts(tenant_id,user_id)
  VALUES(t,actor);
 ELSE
  UPDATE md_users SET enabled=true,locked_until='infinity'::timestamptz,
   password_hash='!no-interactive-login!'
  WHERE tenant_id=t AND id=actor;
 END IF;
 INSERT INTO md_permission_sets(tenant_id,api_name)
 VALUES(t,'OneSysCommunicationWriter')
 ON CONFLICT(tenant_id,api_name) DO NOTHING;
 SELECT id INTO policy FROM md_permission_sets
 WHERE tenant_id=t AND api_name='OneSysCommunicationWriter';
 INSERT INTO md_permission_assignments(tenant_id,user_id,permission_set_id)
 VALUES(t,actor,policy) ON CONFLICT DO NOTHING;
 INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
 VALUES(t,policy,'Communication','create','allow')
 ON CONFLICT DO NOTHING;
 INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
 SELECT t,policy,'Communication.'||field,'create','allow'
 FROM unnest(ARRAY[
  'OwnerId','Name','Channel','Direction','Status','Sender','Recipient',
  'Subject','Body','ExternalMessageId','ConversationId','Provider',
  'RelatedObject','RelatedRecordId','SentAt','ReceivedAt','ErrorMessage'
 ]) AS field
 ON CONFLICT DO NOTHING;
 RETURN actor;
END;
$$;

-- Upgrade existing tenants without modifying business records or developer identities.
DO $$
DECLARE tenant uuid;
BEGIN
 FOR tenant IN SELECT id FROM md_tenants ORDER BY id LOOP
  PERFORM md_ensure_communication_logger(tenant);
 END LOOP;
END;
$$;
-- END ORIGINAL MIGRATION 20261201-communication-logger-identity.sql

-- BEGIN ORIGINAL MIGRATION 20261201-federation-named-credentials.sql
ALTER TABLE md_identity_providers
 ADD COLUMN IF NOT EXISTS token_credential_id uuid,
 ADD COLUMN IF NOT EXISTS jwks_credential_id uuid;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='md_identity_providers_token_credential_fk') THEN
  ALTER TABLE md_identity_providers ADD CONSTRAINT md_identity_providers_token_credential_fk
   FOREIGN KEY(tenant_id,token_credential_id) REFERENCES md_named_credentials(tenant_id,id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='md_identity_providers_jwks_credential_fk') THEN
  ALTER TABLE md_identity_providers ADD CONSTRAINT md_identity_providers_jwks_credential_fk
   FOREIGN KEY(tenant_id,jwks_credential_id) REFERENCES md_named_credentials(tenant_id,id);
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20261201-federation-named-credentials.sql

-- BEGIN ORIGINAL MIGRATION 20261202-communication-system-append-only.sql
-- Communication is a tenant-scoped system audit object. Only the central
-- transaction writer may append records. User CRUD/Flows cannot mutate them.
-- This applies even when a user has broad OneEngine grants.
CREATE OR REPLACE FUNCTION md_communication_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD.object_api;
 ELSE target:=NEW.object_api; END IF;
 IF target='Communication' THEN
  IF TG_OP='INSERT'
     AND current_setting('metadrive.communication_writer',true)='on' THEN
   RETURN NEW;
  END IF;
  RAISE EXCEPTION 'System Communication records are append-only'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS md_communication_records_append_only ON md_records;
CREATE TRIGGER md_communication_records_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_records
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();
DROP TRIGGER IF EXISTS md_communication_values_append_only ON md_record_values;
CREATE TRIGGER md_communication_values_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();

-- Reading still requires tenant-scoped OneEngine Object/Field read permission.
-- An authorised user can read all system log entries, irrespective of the
-- sending actor or their current account status.
INSERT INTO md_sharing_settings(tenant_id,object_api,default_access,use_hierarchy)
 SELECT tenant_id,api_name,'Public Read Only',false
 FROM md_object_definitions WHERE api_name='Communication'
 ON CONFLICT(tenant_id,object_api)
 DO UPDATE SET default_access='Public Read Only',use_hierarchy=false;

-- Existing attempts were not lost. Safely bring pending rows forward so the
-- already-running worker retries promptly with the new system SQL writer.
-- Processing leases remain intact to prevent concurrent duplicate claims.
UPDATE md_communication_delivery_outbox
 SET next_attempt_at=now()
 WHERE status='pending';
-- END ORIGINAL MIGRATION 20261202-communication-system-append-only.sql

-- BEGIN ORIGINAL MIGRATION 20261203-available-slots-element.sql
-- Reusable no-code slot discovery: constrained to app-installed, authorised Flow execution.
-- This only extends the shared element registry. No existing Flow versions are modified.
INSERT INTO md_flow_capability_elements
 (element_type,display_group,display_icon,sort_order,builder_enabled,before_save_allowed,
  config_schema_key,validator_key,runtime_handler_key,debug_behavior)
VALUES ('Get Available Slots','Data','◷',125,true,false,
 'flow:Get Available Slots','Get Available Slots','Get Available Slots','unsupported')
ON CONFLICT(element_type) DO NOTHING;

INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
SELECT 'Get Available Slots',flow_type,true FROM md_flow_capability_flow_types
WHERE flow_type IN ('Autolaunched Flow','Record-Triggered Flow','Screen Flow')
ON CONFLICT(element_type,flow_type) DO NOTHING;

INSERT INTO md_flow_capability_properties(element_type,property_name,value_type,required,sort_order)
VALUES
 ('Get Available Slots','mode','text',true,10),
 ('Get Available Slots','date','resource',true,20),
 ('Get Available Slots','staffId','resource',true,30),
 ('Get Available Slots','durationMinutes','number',true,40),
 ('Get Available Slots','appointmentObject','text',true,50),
 ('Get Available Slots','scheduleObject','text',true,60),
 ('Get Available Slots','availabilityGuard','object',true,70),
 ('Get Available Slots','overlapGuard','object',true,80),
 ('Get Available Slots','outputVariable','resource',false,90),
 ('Get Available Slots','allowedVariable','resource',false,100),
 ('Get Available Slots','availableVariable','resource',false,110),
 ('Get Available Slots','selectedTime','resource',false,120),
 ('Get Available Slots','allowedSlots','resource',false,130),
 ('Get Available Slots','startVariable','resource',false,140),
 ('Get Available Slots','endVariable','resource',false,150),
 ('Get Available Slots','validVariable','resource',false,160)
ON CONFLICT(element_type,property_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261203-available-slots-element.sql

-- BEGIN ORIGINAL MIGRATION 20261203-communication-activity-body-normalization.sql
-- Central integration transport diagnostics are structured metadata, never
-- human message content. Install additive fields for existing tenants; fresh
-- tenants receive the same fields through the Core Communication seeder.
INSERT INTO md_field_definitions
 (tenant_id,object_api,api_name,label,data_type,max_length,required)
SELECT o.tenant_id,'Communication',f.api_name,f.label,f.data_type,f.max_length,false
FROM md_object_definitions o
CROSS JOIN (VALUES
 ('Transport','Transport','text',20),
 ('Endpoint','Endpoint','text',2048),
 ('RequestMethod','Request Method','text',20),
 ('ResponseStatusCode','HTTP Status Code','number',NULL::integer),
 ('Outcome','Integration Outcome','text',40),
 ('DurationMs','Duration (ms)','number',NULL::integer),
 ('RequestBytes','Request Bytes','number',NULL::integer),
 ('ResponseBytes','Response Bytes','number',NULL::integer),
 ('OccurredAt','Integration Occurred At','datetime',NULL::integer)
) AS f(api_name,label,data_type,max_length)
WHERE o.api_name='Communication'
ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING;

-- Mirror existing subject read grants only. Explicit denies and revocations
-- remain authoritative; no global access or new app entitlement is granted.
INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
SELECT grant_rule.tenant_id,grant_rule.permission_set_id,
 'Communication.'||field.api_name,'read','allow'
FROM md_permission_rules grant_rule
JOIN md_field_definitions field
 ON field.tenant_id=grant_rule.tenant_id AND field.object_api='Communication'
 AND field.api_name IN
 ('Transport','Endpoint','RequestMethod','ResponseStatusCode','Outcome',
  'DurationMs','RequestBytes','ResponseBytes','OccurredAt')
 AND field.deleted_at IS NULL
WHERE grant_rule.resource='Communication.Subject'
 AND grant_rule.action='read' AND grant_rule.effect='allow'
ON CONFLICT DO NOTHING;

-- Back up only machine-generated API execution JSON, not customer messages.
-- The append-only runtime remains protected; this one-time system migration
-- is atomic and auditable, and original content remains recoverable in SQL.
CREATE TABLE IF NOT EXISTS md_communication_legacy_api_body_archive (
 tenant_id uuid NOT NULL,
 record_id uuid NOT NULL,
 original_body text NOT NULL,
 migrated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,record_id),
 FOREIGN KEY(tenant_id,record_id) REFERENCES md_records(tenant_id,id)
);

CREATE FUNCTION md_try_legacy_integration_log(source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE decoded jsonb;
BEGIN
 decoded:=source::jsonb;
 IF jsonb_typeof(decoded)='object'
    AND decoded->>'type'='IntegrationApiCall'
    AND decoded ? 'method' AND decoded ? 'endpoint'
    AND decoded ? 'occurredAt' THEN
  RETURN decoded;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE TEMP TABLE md_communication_legacy_log_targets ON COMMIT DROP AS
SELECT old.tenant_id,old.record_id,old.value_text AS original_body,
 md_try_legacy_integration_log(old.value_text) AS payload
FROM md_record_values old
JOIN md_record_values relation
 ON relation.tenant_id=old.tenant_id AND relation.record_id=old.record_id
 AND relation.object_api='Communication'
 AND relation.field_api='RelatedObject'
 AND relation.value_text='IntegrationApiCall'
WHERE old.object_api='Communication'
 AND old.field_api='Body'
 AND old.value_text LIKE '{"type":"IntegrationApiCall",%';

DROP FUNCTION md_try_legacy_integration_log(text);

DELETE FROM md_communication_legacy_log_targets WHERE payload IS NULL;

INSERT INTO md_communication_legacy_api_body_archive
 (tenant_id,record_id,original_body)
SELECT tenant_id,record_id,original_body FROM md_communication_legacy_log_targets
ON CONFLICT(tenant_id,record_id) DO NOTHING;

-- Backfill the same typed metadata as new requests. Existing customised
-- values win; never replace a tenant's field configuration or record value.
SELECT set_config('metadrive.communication_writer','on',true);
INSERT INTO md_record_values
 (tenant_id,record_id,object_api,field_api,value_text)
SELECT targets.tenant_id,targets.record_id,'Communication',diagnostic.field_api,
 diagnostic.value_text
FROM md_communication_legacy_log_targets targets
CROSS JOIN LATERAL (VALUES
 ('Transport',targets.payload->>'transport'),
 ('Endpoint',targets.payload->>'endpoint'),
 ('RequestMethod',targets.payload->>'method'),
 ('ResponseStatusCode',targets.payload->>'statusCode'),
 ('Outcome',targets.payload->>'outcome'),
 ('DurationMs',targets.payload->>'durationMs'),
 ('RequestBytes',targets.payload->>'requestBytes'),
 ('ResponseBytes',targets.payload->>'responseBytes'),
 ('OccurredAt',targets.payload->>'occurredAt')
) AS diagnostic(field_api,value_text)
JOIN md_field_definitions f
 ON f.tenant_id=targets.tenant_id AND f.object_api='Communication'
 AND f.api_name=diagnostic.field_api AND f.deleted_at IS NULL
WHERE diagnostic.value_text IS NOT NULL
 AND (diagnostic.field_api NOT IN
   ('ResponseStatusCode','DurationMs','RequestBytes','ResponseBytes')
   OR diagnostic.value_text ~ '^[0-9]{1,10}$')
 AND (diagnostic.field_api<>'OccurredAt'
   OR md_try_record_datetime(diagnostic.value_text) IS NOT NULL)
ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING;

-- Authorised one-time UPDATE of known archived machine-generated bodies only.
-- DDL and DML happen inside the migration runner's single SQL transaction;
-- the normal append-only guard is restored before commit.
DROP TRIGGER md_communication_values_append_only ON md_record_values;
UPDATE md_record_values body
 SET value_text=NULL
FROM md_communication_legacy_log_targets target
JOIN md_communication_legacy_api_body_archive archive
 ON archive.tenant_id=target.tenant_id
 AND archive.record_id=target.record_id
 AND archive.original_body=target.original_body
WHERE body.tenant_id=target.tenant_id
 AND body.record_id=target.record_id
 AND body.object_api='Communication' AND body.field_api='Body'
 AND body.value_text=target.original_body;
CREATE TRIGGER md_communication_values_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();

-- Return the transaction-local privileged insert flag to its default.
SELECT set_config('metadrive.communication_writer','off',true);

INSERT INTO md_security_events(tenant_id,action,details)
SELECT tenant_id,'communication.legacy_api_body_normalized',
 jsonb_build_object('archivedRecords',count(*))
FROM md_communication_legacy_log_targets
GROUP BY tenant_id;
-- END ORIGINAL MIGRATION 20261203-communication-activity-body-normalization.sql

-- BEGIN ORIGINAL MIGRATION 20261204-communication-subject-normalization.sql
-- Subject is the business message subject; transport diagnostics already have
-- structured Communication fields from the existing Core seeder. Do not add
-- duplicate metadata fields or modify any customer's configuration.
--
-- Match only the exact historic central integration-writer subject template,
-- including optional user-supplied subject prefixes. Never rewrite arbitrary
-- business subjects. Every original value is archived before the update.
CREATE TABLE IF NOT EXISTS md_communication_legacy_api_subject_archive (
 tenant_id uuid NOT NULL,
 record_id uuid NOT NULL,
 original_subject text NOT NULL,
 recovered_subject text,
 migrated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,record_id),
 FOREIGN KEY(tenant_id,record_id) REFERENCES md_records(tenant_id,id)
);

CREATE TEMP TABLE md_communication_legacy_subject_targets ON COMMIT DROP AS
SELECT subject.tenant_id,subject.record_id,subject.value_text AS original_subject,
 matched.parts
FROM md_record_values subject
JOIN md_record_values relation
 ON relation.tenant_id=subject.tenant_id
 AND relation.record_id=subject.record_id
 AND relation.object_api='Communication'
 AND relation.field_api='RelatedObject'
 AND relation.value_text IS NOT NULL
CROSS JOIN LATERAL (
 SELECT regexp_match(subject.value_text,
  '^(?:(.{1,100}) · )?(GET|POST|PUT|PATCH|DELETE|SMTP|OTHER) (NO_RESPONSE|[1-5][0-9][0-9]) · (success|http_error|network_error|rejected) · ([0-9]+)ms · req ([0-9]+)B/resp ([0-9]+)B · (.+)$'
 ) AS parts
) AS matched
WHERE subject.object_api='Communication'
 AND subject.field_api='Subject'
 AND subject.value_text IS NOT NULL
 AND matched.parts IS NOT NULL
 -- Where this field already exists, verify the generated subject's endpoint.
 AND NOT EXISTS (
  SELECT 1 FROM md_record_values endpoint
  WHERE endpoint.tenant_id=subject.tenant_id
   AND endpoint.record_id=subject.record_id
   AND endpoint.object_api='Communication'
   AND endpoint.field_api='Endpoint'
   AND endpoint.value_text IS DISTINCT FROM matched.parts[8]
 );

INSERT INTO md_communication_legacy_api_subject_archive
 (tenant_id,record_id,original_subject,recovered_subject)
SELECT tenant_id,record_id,original_subject,
 NULLIF(parts[1],'')
FROM md_communication_legacy_subject_targets
ON CONFLICT(tenant_id,record_id) DO NOTHING;

-- Previous API messages and verified webhooks may predate structured activity
-- metadata. Fill gaps in the already-existing fields, without overwriting
-- any recorded values, tenant-specific field metadata, or explicit RBAC denies.
SELECT set_config('metadrive.communication_writer','on',true);
INSERT INTO md_record_values
 (tenant_id,record_id,object_api,field_api,value_text)
SELECT target.tenant_id,target.record_id,'Communication',entry.field_api,entry.value_text
FROM md_communication_legacy_subject_targets target
CROSS JOIN LATERAL (VALUES
 ('RequestMethod',target.parts[2]),
 ('ResponseStatusCode',NULLIF(target.parts[3],'NO_RESPONSE')),
 ('Outcome',target.parts[4]),
 ('DurationMs',target.parts[5]),
 ('RequestBytes',target.parts[6]),
 ('ResponseBytes',target.parts[7]),
 ('Endpoint',target.parts[8])
) AS entry(field_api,value_text)
JOIN md_field_definitions f
 ON f.tenant_id=target.tenant_id
 AND f.object_api='Communication'
 AND f.api_name=entry.field_api
 AND f.deleted_at IS NULL
WHERE entry.value_text IS NOT NULL
 -- Do not guess transport or timestamps from other message fields.
 AND (entry.field_api NOT IN
   ('ResponseStatusCode','DurationMs','RequestBytes','ResponseBytes')
   OR entry.value_text ~ '^[0-9]{1,10}$')
ON CONFLICT(tenant_id,record_id,field_api) DO NOTHING;

-- The existing append-only guard is restored before the migration commits.
-- Only original subjects archived above and still equal to their source value
-- can be changed. The transaction is atomic in the system migration runner.
DROP TRIGGER md_communication_values_append_only ON md_record_values;
UPDATE md_record_values subject SET value_text=archive.recovered_subject
FROM md_communication_legacy_api_subject_archive archive
JOIN md_communication_legacy_subject_targets target
 ON target.tenant_id=archive.tenant_id
 AND target.record_id=archive.record_id
 AND target.original_subject=archive.original_subject
WHERE subject.tenant_id=archive.tenant_id
 AND subject.record_id=archive.record_id
 AND subject.object_api='Communication'
 AND subject.field_api='Subject'
 AND subject.value_text=archive.original_subject;
CREATE TRIGGER md_communication_values_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();
SELECT set_config('metadrive.communication_writer','off',true);

INSERT INTO md_security_events(tenant_id,action,details)
SELECT tenant_id,'communication.legacy_api_subject_normalized',
 jsonb_build_object('archivedSubjects',count(*))
FROM md_communication_legacy_subject_targets
GROUP BY tenant_id;
-- END ORIGINAL MIGRATION 20261204-communication-subject-normalization.sql

-- BEGIN ORIGINAL MIGRATION 20261205-communication-provider-status-projection.sql
-- A provider status callback may advance only the status projection of an
-- existing outbound Communication record. The message content stays immutable.
CREATE OR REPLACE FUNCTION md_communication_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD.object_api;
 ELSE target:=NEW.object_api; END IF;
 IF target='Communication' THEN
  IF TG_OP='INSERT' AND current_setting('metadrive.communication_writer',true)='on'
   THEN RETURN NEW; END IF;
  -- PostgreSQL PL/pgSQL can evaluate a record field even when an earlier
  -- AND predicate is false. Branch first because md_records lacks field_api.
  IF TG_TABLE_NAME='md_record_values' THEN
   IF TG_OP IN ('INSERT','UPDATE')
      AND current_setting('metadrive.communication_status_writer',true)='on' THEN
    IF NEW.field_api IN ('Status','DeliveredAt') THEN
     IF TG_OP='INSERT' THEN RETURN NEW; END IF;
     IF OLD.tenant_id=NEW.tenant_id AND OLD.record_id=NEW.record_id
        AND OLD.object_api=NEW.object_api AND OLD.field_api=NEW.field_api
      THEN RETURN NEW; END IF;
    END IF;
   END IF;
  END IF;
  RAISE EXCEPTION 'System Communication records are append-only'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
-- Existing triggers use CREATE OR REPLACE function and need no recreation.
-- END ORIGINAL MIGRATION 20261205-communication-provider-status-projection.sql

-- BEGIN ORIGINAL MIGRATION 20261205-mail-inbox-ingestion-cursor.sql
-- Shared Core mail ingestion progress. No credentials, mail bodies or tenant
-- app state live here; actual events go through the existing Communication outbox.
CREATE TABLE IF NOT EXISTS md_mail_inbox_scan_offsets(
 tenant_id uuid NOT NULL,
 email text NOT NULL,
 next_offset integer NOT NULL DEFAULT 0 CHECK(next_offset>=0 AND next_offset<=20000),
 scanned_at timestamptz NOT NULL DEFAULT to_timestamp(0),
 PRIMARY KEY(tenant_id,email),
 FOREIGN KEY(tenant_id,email) REFERENCES md_mail_accounts(tenant_id,email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_mail_inbox_scan_due
 ON md_mail_inbox_scan_offsets(scanned_at);
-- END ORIGINAL MIGRATION 20261205-mail-inbox-ingestion-cursor.sql

-- BEGIN ORIGINAL MIGRATION 20261206-communication-whatsapp-identifiers-and-list.sql
-- Future provider message/receipt capture carries scoped IDs through durable SQL outbox.
-- Preserve existing rows and tenant field customisations; no customer data rewrites.
ALTER TABLE md_communication_delivery_outbox
 ADD COLUMN IF NOT EXISTS phone_number_id text CHECK(phone_number_id IS NULL OR length(phone_number_id)<=500),
 ADD COLUMN IF NOT EXISTS waba_id text CHECK(waba_id IS NULL OR length(waba_id)<=500);

INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,max_length,required)
SELECT o.tenant_id,'Communication',x.api_name,x.label,'text',500,false
FROM md_object_definitions o CROSS JOIN (VALUES
 ('PhoneNumberId','WhatsApp Phone Number ID'),
 ('WabaId','WhatsApp Business Account ID')
) AS x(api_name,label)
WHERE o.api_name='Communication'
ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING;

-- Follow existing Communication field read grants without granting new object
-- permissions; explicit OneEngine deny rules continue to override.
INSERT INTO md_permission_rules(tenant_id,permission_set_id,resource,action,effect)
SELECT rule.tenant_id,rule.permission_set_id,'Communication.'||field.api_name,'read','allow'
FROM md_permission_rules rule
JOIN md_field_definitions field ON field.tenant_id=rule.tenant_id
 AND field.object_api='Communication'
 AND field.api_name IN ('PhoneNumberId','WabaId') AND field.deleted_at IS NULL
WHERE rule.resource='Communication.Subject' AND rule.action='read' AND rule.effect='allow'
ON CONFLICT DO NOTHING;

-- Default Communication list columns are metadata; never override an existing
-- tenant-defined search layout or a saved list-view preference.
WITH desired(field_api,position) AS (
 VALUES ('OccurredAt',0),
        ('Direction',1),
        ('Transport',2),
        ('RequestMethod',3),
        ('ResponseStatusCode',4),
        ('Body',5),
        ('Provider',6),
        ('Outcome',7),
        ('ReceivedAt',8),
        ('ErrorMessage',9),
        ('Channel',10),
        ('Contact',11),
        ('ConversationId',12),
        ('Customer',13),
        ('DeliveredAt',14),
        ('DurationMs',15),
        ('Endpoint',16),
        ('ExternalMessageId',17),
        ('Name',18),
        ('Recipient',19),
        ('RelatedObject',20),
        ('RelatedRecordId',21),
        ('RequestBytes',22),
        ('ResponseBytes',23),
        ('Sender',24),
        ('SentAt',25),
        ('Status',26),
        ('Subject',27)
)
INSERT INTO md_search_layout_columns(tenant_id,object_api,layout_key,position,field_api)
SELECT o.tenant_id,'Communication','searchResults',desired.position,desired.field_api
FROM md_object_definitions o CROSS JOIN desired
JOIN md_field_definitions field ON field.tenant_id=o.tenant_id
 AND field.object_api='Communication' AND field.api_name=desired.field_api AND field.deleted_at IS NULL
WHERE o.api_name='Communication'
 AND NOT EXISTS (SELECT 1 FROM md_search_layout_columns configured
  WHERE configured.tenant_id=o.tenant_id AND configured.object_api='Communication'
    AND configured.layout_key='searchResults')
ON CONFLICT DO NOTHING;
-- END ORIGINAL MIGRATION 20261206-communication-whatsapp-identifiers-and-list.sql

-- BEGIN ORIGINAL MIGRATION 20261207-whatsapp-pending-status.sql
-- Status callbacks can arrive before the outbound message has been persisted.
-- Keep one latest receipt per status for tenant-scoped reconciliation.
CREATE TABLE IF NOT EXISTS md_communication_pending_status (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 external_message_id text NOT NULL,
 provider_status text NOT NULL
   CHECK(provider_status IN ('sent','delivered','read','failed')),
 provider_timestamp timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,external_message_id,provider_status)
);
CREATE INDEX IF NOT EXISTS md_communication_pending_status_time
 ON md_communication_pending_status(tenant_id,provider_timestamp);
-- END ORIGINAL MIGRATION 20261207-whatsapp-pending-status.sql

-- BEGIN ORIGINAL MIGRATION 20261215-page-layout-versions.sql
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
-- END ORIGINAL MIGRATION 20261215-page-layout-versions.sql

-- BEGIN ORIGINAL MIGRATION 20261216-object-owned-record-pages.sql
-- Object-owned Record View and Record Edit pages. Reuses the existing Page
-- metadata/versions/activation tables; never changes existing customer pages.
ALTER TABLE md_lightning_page_details
  ADD COLUMN IF NOT EXISTS record_mode text NOT NULL DEFAULT 'View';
ALTER TABLE md_lightning_page_details
  DROP CONSTRAINT IF EXISTS md_lightning_page_details_record_mode_check;
ALTER TABLE md_lightning_page_details
  ADD CONSTRAINT md_lightning_page_details_record_mode_check
  CHECK (record_mode IN ('View','Edit'));
CREATE INDEX IF NOT EXISTS md_record_page_mode_resolution
  ON md_lightning_page_details (tenant_id,target_object,record_mode,status)
  WHERE page_type='Record Page';

-- Stable per-tenant names avoid colliding with customer-created pages.
-- Existing View pages retain their exact metadata, versions and assignments.
CREATE OR REPLACE FUNCTION md_ensure_object_record_pages(p_tenant uuid,p_object text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_mode text;
  v_api text;
  v_label text;
  v_page uuid;
BEGIN
  FOR v_mode IN SELECT mode_name FROM (VALUES ('View'),('Edit')) AS modes(mode_name) LOOP
    IF EXISTS (
      SELECT 1 FROM md_lightning_page_details d
      JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id
      WHERE d.tenant_id=p_tenant AND d.target_object=p_object
        AND d.page_type='Record Page' AND d.record_mode=v_mode
        AND p.enabled=true
    ) THEN CONTINUE; END IF;

    v_api='Record_'||substr(md5(p_tenant::text||':'||p_object),1,20)||'_'||v_mode;
    SELECT label||' Record '||v_mode INTO v_label FROM md_object_definitions
      WHERE tenant_id=p_tenant AND api_name=p_object;
    IF v_label IS NULL THEN RAISE EXCEPTION 'Record Page object not found'; END IF;
    INSERT INTO md_page_definitions(tenant_id,api_name,title,enabled)
      VALUES(p_tenant,v_api,v_label,true) ON CONFLICT DO NOTHING;
    SELECT id INTO v_page FROM md_page_definitions
      WHERE tenant_id=p_tenant AND api_name=v_api AND enabled=true;
    IF v_page IS NULL THEN RAISE EXCEPTION 'Default Record Page name unavailable'; END IF;
    INSERT INTO md_lightning_page_details
      (tenant_id,page_id,page_type,target_object,record_mode,layout_mode,template,
       canvas_width,canvas_height,status,devices,revision)
      VALUES(p_tenant,v_page,'Record Page',p_object,v_mode,'template','header-main-sidebar',
             1440,900,'Active',ARRAY['Desktop','Phone'],1)
      ON CONFLICT DO NOTHING;
    INSERT INTO md_lightning_page_nodes
      (tenant_id,page_id,component_key,component_type,label,region,visible,sort_order)
      VALUES(p_tenant,v_page,'record-detail','Record Detail','Record Details','main',true,0)
      ON CONFLICT DO NOTHING;
    INSERT INTO md_lightning_page_activation
      (tenant_id,page_id,assignment_id,scope,app_api,profile_id,record_type_id,desktop,phone,sort_order)
      VALUES(p_tenant,v_page,'record-default','Org Default',NULL,NULL,NULL,true,true,0)
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION md_object_record_pages_after_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM md_ensure_object_record_pages(NEW.tenant_id,NEW.api_name);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS md_object_record_pages_insert ON md_object_definitions;
CREATE TRIGGER md_object_record_pages_insert
AFTER INSERT ON md_object_definitions FOR EACH ROW
EXECUTE FUNCTION md_object_record_pages_after_insert();

-- Tenant-isolated, idempotent migration for existing Objects. On re-run it
-- does not overwrite a tenant's Record Page or create duplicate pages.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tenant_id,api_name FROM md_object_definitions LOOP
    PERFORM md_ensure_object_record_pages(r.tenant_id,r.api_name);
  END LOOP;
END $$;
-- END ORIGINAL MIGRATION 20261216-object-owned-record-pages.sql

-- BEGIN ORIGINAL MIGRATION 20261216-page-custom-form-factors.sql
ALTER TABLE md_app_home_pages
  DROP CONSTRAINT IF EXISTS md_app_home_pages_form_factor_check;
ALTER TABLE md_app_home_pages
  ADD CONSTRAINT md_app_home_pages_form_factor_check
  CHECK (form_factor IN ('desktop','tablet','phone','custom'));

ALTER TABLE md_app_package_home_page_templates
  DROP CONSTRAINT IF EXISTS md_app_package_home_page_templates_form_factor_check;
ALTER TABLE md_app_package_home_page_templates
  ADD CONSTRAINT md_app_package_home_page_templates_form_factor_check
  CHECK (form_factor IN ('desktop','tablet','phone','custom'));

ALTER TABLE md_lightning_page_details
  DROP CONSTRAINT IF EXISTS md_lightning_page_details_devices_check;
ALTER TABLE md_lightning_page_details
  ADD CONSTRAINT md_lightning_page_details_devices_check
  CHECK (cardinality(devices) BETWEEN 1 AND 4);

ALTER TABLE md_lightning_page_activation
  ADD COLUMN IF NOT EXISTS tablet boolean,
  ADD COLUMN IF NOT EXISTS custom boolean;
UPDATE md_lightning_page_activation SET tablet=desktop WHERE tablet IS NULL;
UPDATE md_lightning_page_activation SET custom=false WHERE custom IS NULL;
ALTER TABLE md_lightning_page_activation
  ALTER COLUMN tablet SET DEFAULT false,
  ALTER COLUMN tablet SET NOT NULL,
  ALTER COLUMN custom SET DEFAULT false,
  ALTER COLUMN custom SET NOT NULL;
ALTER TABLE md_lightning_page_activation
  DROP CONSTRAINT IF EXISTS md_lightning_page_activation_check;
ALTER TABLE md_lightning_page_activation
  DROP CONSTRAINT IF EXISTS md_lightning_page_activation_form_factor_check;
ALTER TABLE md_lightning_page_activation
  ADD CONSTRAINT md_lightning_page_activation_form_factor_check
  CHECK (desktop OR tablet OR phone OR custom);

ALTER TABLE md_page_layout_version_activation
  ADD COLUMN IF NOT EXISTS tablet boolean,
  ADD COLUMN IF NOT EXISTS custom boolean;
UPDATE md_page_layout_version_activation SET tablet=desktop WHERE tablet IS NULL;
UPDATE md_page_layout_version_activation SET custom=false WHERE custom IS NULL;
ALTER TABLE md_page_layout_version_activation
  ALTER COLUMN tablet SET DEFAULT false,
  ALTER COLUMN tablet SET NOT NULL,
  ALTER COLUMN custom SET DEFAULT false,
  ALTER COLUMN custom SET NOT NULL;
ALTER TABLE md_page_layout_version_activation
  DROP CONSTRAINT IF EXISTS md_page_layout_version_activation_check;
ALTER TABLE md_page_layout_version_activation
  DROP CONSTRAINT IF EXISTS md_page_layout_version_activation_form_factor_check;
ALTER TABLE md_page_layout_version_activation
  ADD CONSTRAINT md_page_layout_version_activation_form_factor_check
  CHECK (desktop OR tablet OR phone OR custom);

UPDATE md_lightning_page_details
SET devices=devices||ARRAY(
  SELECT factor FROM unnest(ARRAY['Tablet','Custom']::text[]) WITH ORDINALITY AS factors(factor,position)
  WHERE NOT factor=ANY(md_lightning_page_details.devices)
  ORDER BY position
)
WHERE NOT ('Tablet'=ANY(devices) AND 'Custom'=ANY(devices));
-- END ORIGINAL MIGRATION 20261216-page-custom-form-factors.sql

-- BEGIN ORIGINAL MIGRATION 20261216-page-layout-custom-targets.sql
-- Published Custom layouts support an explicit responsive activation interval.
-- Additive only: older published layouts remain disabled for automatic targeting.
ALTER TABLE md_page_layout_versions
  ADD COLUMN IF NOT EXISTS custom_target_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE md_page_layout_versions
  ADD COLUMN IF NOT EXISTS custom_target_min_width integer NOT NULL DEFAULT 320;
ALTER TABLE md_page_layout_versions
  ADD COLUMN IF NOT EXISTS custom_target_max_width integer NOT NULL DEFAULT 10000;
-- END ORIGINAL MIGRATION 20261216-page-layout-custom-targets.sql

-- BEGIN ORIGINAL MIGRATION 20261217-app-seed-page-versions.sql
CREATE TABLE IF NOT EXISTS md_app_seed_page_versions (
 tenant_id uuid NOT NULL,
 page_id uuid NOT NULL,
 seed_key text NOT NULL CHECK(length(seed_key) BETWEEN 1 AND 128),
 version integer NOT NULL CHECK(version>0),
 applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,seed_key),
 FOREIGN KEY(tenant_id,page_id)
  REFERENCES md_lightning_page_details(tenant_id,page_id) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261217-app-seed-page-versions.sql

-- BEGIN ORIGINAL MIGRATION 20261217-four-page-device-assignments.sql
-- Four independently assignable page form factors. Existing Desktop/Phone
-- assignments remain functional; Tablet/Custom use a safe legacy Desktop
-- fallback until explicitly assigned by a tenant administrator.
ALTER TABLE md_lightning_page_activation
 ADD COLUMN IF NOT EXISTS tablet boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;
ALTER TABLE md_page_layout_version_activation
 ADD COLUMN IF NOT EXISTS tablet boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;

ALTER TABLE md_lightning_page_activation
 DROP CONSTRAINT IF EXISTS md_lightning_page_activation_check;
ALTER TABLE md_lightning_page_activation
 DROP CONSTRAINT IF EXISTS md_lightning_page_activation_form_factors_check;
ALTER TABLE md_lightning_page_activation
 ADD CONSTRAINT md_lightning_page_activation_form_factors_check
 CHECK(desktop OR phone OR tablet OR custom);
ALTER TABLE md_page_layout_version_activation
 DROP CONSTRAINT IF EXISTS md_page_layout_version_activation_check;
ALTER TABLE md_page_layout_version_activation
 DROP CONSTRAINT IF EXISTS md_page_layout_version_activation_form_factors_check;
ALTER TABLE md_page_layout_version_activation
 ADD CONSTRAINT md_page_layout_version_activation_form_factors_check
 CHECK(desktop OR phone OR tablet OR custom);
-- END ORIGINAL MIGRATION 20261217-four-page-device-assignments.sql

-- BEGIN ORIGINAL MIGRATION 20261220-object-manager-layout-controls.sql
-- Persist Object Manager compact highlights and list-view action configuration.
-- Additive, tenant-scoped, and safe for existing records and customisations.
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
 FOREIGN KEY(tenant_id,object_api,layout_id)
   REFERENCES md_object_compact_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,field_api)
   REFERENCES md_field_definitions(tenant_id,object_api,api_name)
);
CREATE TABLE IF NOT EXISTS md_object_compact_layout_assignments (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 profile_id text NOT NULL,
 record_type_id text NOT NULL,
 layout_id text NOT NULL,
 PRIMARY KEY(tenant_id,object_api,profile_id,record_type_id),
 FOREIGN KEY(tenant_id,object_api,layout_id)
   REFERENCES md_object_compact_layouts(tenant_id,object_api,layout_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_list_view_buttons (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 button_name text NOT NULL CHECK(button_name IN ('New','Change Owner','Printable View')),
 enabled boolean NOT NULL,
 sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,object_api,button_name),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261220-object-manager-layout-controls.sql

-- BEGIN ORIGINAL MIGRATION 20261220-password-recovery-otp-channels.sql
-- Tenant-scoped, versionable security recovery Flow configuration.
-- Core verification is not an ordinary anonymous Flow: its issued secrets are server-owned.
CREATE TABLE IF NOT EXISTS md_password_recovery_flow (
 tenant_id uuid PRIMARY KEY REFERENCES md_tenants(id),
 method text NOT NULL DEFAULT 'OTP' CHECK(method IN ('OTP','LINK')),
 otp_length integer NOT NULL DEFAULT 6 CHECK(otp_length IN (4,6)),
 otp_expiry_minutes integer NOT NULL DEFAULT 10 CHECK(otp_expiry_minutes BETWEEN 5 AND 15),
 max_otp_attempts integer NOT NULL DEFAULT 5 CHECK(max_otp_attempts BETWEEN 3 AND 5),
 email_subject text NOT NULL DEFAULT 'MetaDrive password recovery',
 email_template text NOT NULL DEFAULT 'Your verification code is {!Verification.Value}. It expires in {!Verification.ExpiryMinutes} minutes.',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Upgrade prior email-only settings without replacing a tenant's edited templates.
INSERT INTO md_password_recovery_flow(tenant_id,method,email_subject,email_template)
 SELECT tenant_id,
  CASE WHEN policy->>'method'='LINK' THEN 'LINK' ELSE 'OTP' END,
  COALESCE(NULLIF(policy#>>'{templates,email,subject}',''),'MetaDrive password recovery'),
  COALESCE(NULLIF(policy#>>'{templates,email,body}',''),'Your verification code is {!Verification.Value}.')
 FROM md_password_recovery_settings
ON CONFLICT(tenant_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS md_password_recovery_channel_actions (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 channel text NOT NULL CHECK(channel IN ('sms','whatsapp')),
 enabled boolean NOT NULL DEFAULT false,
 flow_service_user_id uuid,
 credential_id uuid,
 callout_path text NOT NULL DEFAULT '',
 callout_body text NOT NULL DEFAULT '',
 message_template text NOT NULL DEFAULT 'Your MetaDrive recovery code is {!Verification.Value}. Expires in {!Verification.ExpiryMinutes} minutes.',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,channel),
 FOREIGN KEY(tenant_id,flow_service_user_id) REFERENCES md_users(tenant_id,id),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES md_named_credentials(tenant_id,id)
);
-- A phone must be verified separately by the account holder before recovery delivery.
-- Never infer a recovery destination from an arbitrary CRM Phone field or user input.
CREATE TABLE IF NOT EXISTS md_user_recovery_phones (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE md_password_reset_challenges
 ADD COLUMN IF NOT EXISTS otp_hash text CHECK(otp_hash IS NULL OR length(otp_hash)=64),
 ADD COLUMN IF NOT EXISTS otp_length integer CHECK(otp_length IS NULL OR otp_length IN(4,6)),
 ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 3 AND 5),
 ADD COLUMN IF NOT EXISTS verified_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivery_channel text NOT NULL DEFAULT 'email'
   CHECK(delivery_channel IN('email','sms','whatsapp'));
CREATE INDEX IF NOT EXISTS md_password_reset_pending_otp
 ON md_password_reset_challenges(tenant_id,user_id,created_at DESC)
 WHERE consumed_at IS NULL;
-- Migration only adds structures; user customisations and existing link challenges remain.
-- END ORIGINAL MIGRATION 20261220-password-recovery-otp-channels.sql

-- BEGIN ORIGINAL MIGRATION 20261221-field-history-selection.sql
-- Field history selection is metadata, not an audit-logging bypass.
ALTER TABLE md_field_definitions
 ADD COLUMN IF NOT EXISTS track_history boolean NOT NULL DEFAULT false;
-- END ORIGINAL MIGRATION 20261221-field-history-selection.sql

-- BEGIN ORIGINAL MIGRATION 20261222-lookup-filter-metadata.sql
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
-- END ORIGINAL MIGRATION 20261222-lookup-filter-metadata.sql

-- BEGIN ORIGINAL MIGRATION 20261223-email-action-flow-routing.sql
-- Preserve existing legacy SMTP definitions for tenant migration while allowing
-- new Send Email Quick Actions to execute configured HTTPS Callout Flows.
ALTER TABLE md_object_actions DROP CONSTRAINT IF EXISTS md_object_actions_behavior_contract;
ALTER TABLE md_object_actions ADD CONSTRAINT md_object_actions_behavior_contract CHECK(
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
         AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')))
   OR (behavior='Open Component' AND component_api_name IS NOT NULL AND field_api IS NULL
     AND value_text IS NULL AND target_object_api IS NULL AND relationship_field_api IS NULL
     AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL)
  ))
);
DO $sql$
DECLARE contract record;
BEGIN
 FOR contract IN SELECT conname FROM pg_constraint
  WHERE conrelid='md_global_quick_actions'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%Create Record%'
    AND pg_get_constraintdef(oid) LIKE '%Send Email%'
 LOOP
  EXECUTE format('ALTER TABLE md_global_quick_actions DROP CONSTRAINT %I',contract.conname);
 END LOOP;
END $sql$;
ALTER TABLE md_global_quick_actions ADD CONSTRAINT md_global_quick_actions_behavior_contract_v2 CHECK(
 (behavior='Create Record' AND target_object_api IS NOT NULL AND flow_api_name IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Run Flow' AND flow_api_name IS NOT NULL AND target_object_api IS NULL
   AND credential_id IS NULL AND from_email IS NULL AND component_api_name IS NULL)
 OR (behavior='Send Email' AND target_object_api IS NULL AND component_api_name IS NULL
   AND ((flow_api_name IS NOT NULL AND credential_id IS NULL AND from_email IS NULL)
     OR (flow_api_name IS NULL AND credential_id IS NOT NULL AND from_email IS NOT NULL
       AND length(from_email)<=254 AND from_email~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')))
 OR (behavior='Open Component' AND component_api_name IS NOT NULL AND target_object_api IS NULL
   AND flow_api_name IS NULL AND credential_id IS NULL AND from_email IS NULL)
);
-- END ORIGINAL MIGRATION 20261223-email-action-flow-routing.sql

-- BEGIN ORIGINAL MIGRATION 20261224-inbound-webhook-api-name-uniqueness.sql
-- Inbound webhook table is installed by the later 20261126 migration.
-- Refuse case-only collisions: never rename or delete tenant endpoints.
DO $migration$
BEGIN
 IF EXISTS (
  SELECT 1 FROM md_inbound_webhook_endpoints
  GROUP BY tenant_id,lower(api_name) HAVING count(*)>1
 ) THEN
  RAISE EXCEPTION 'Inbound Webhook API Name conflicts: reconcile tenant metadata before upgrading';
 END IF;
 IF EXISTS (
  SELECT 1 FROM md_webhook_subscriptions
  GROUP BY tenant_id,lower(api_name) HAVING count(*)>1
 ) THEN
  RAISE EXCEPTION 'Outbound Webhook API Name conflicts: reconcile tenant metadata before upgrading';
 END IF;
END
$migration$;
CREATE UNIQUE INDEX IF NOT EXISTS md_inbound_webhook_endpoints_api_name_ci_uq
 ON md_inbound_webhook_endpoints(tenant_id,lower(api_name));
CREATE UNIQUE INDEX IF NOT EXISTS md_webhook_subscriptions_api_name_ci_uq
 ON md_webhook_subscriptions(tenant_id,lower(api_name));
-- END ORIGINAL MIGRATION 20261224-inbound-webhook-api-name-uniqueness.sql

-- BEGIN ORIGINAL MIGRATION 20261224-object-custom-tabs.sql
-- Object tab settings are tenant-scoped metadata; absence means no custom tab.
CREATE TABLE IF NOT EXISTS md_object_custom_tabs (
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 style text NOT NULL CHECK(style IN ('Blue','Green','Orange','Purple','Red','Teal','Yellow')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20261224-object-custom-tabs.sql

-- BEGIN ORIGINAL MIGRATION 20261225-object-metadata-limits.sql
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
-- END ORIGINAL MIGRATION 20261225-object-metadata-limits.sql

-- BEGIN ORIGINAL MIGRATION 20261226-list-import-button.sql
-- Make Import a configurable list action; imports continue through shared Record Engine RBAC.
ALTER TABLE md_object_list_view_buttons
 DROP CONSTRAINT IF EXISTS md_object_list_view_buttons_button_name_check;
ALTER TABLE md_object_list_view_buttons
 ADD CONSTRAINT md_object_list_view_buttons_button_name_check
 CHECK(button_name IN ('New','Change Owner','Import','Printable View'));
-- END ORIGINAL MIGRATION 20261226-list-import-button.sql

-- BEGIN ORIGINAL MIGRATION 20261231-user-reporting-scopes.sql
-- Optional reporting-based record visibility; independent of role hierarchy.
CREATE TABLE IF NOT EXISTS md_permission_data_scopes (
 tenant_id uuid NOT NULL,
 permission_set_id uuid NOT NULL,
 object_api text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('all','descendants','own')),
 PRIMARY KEY(tenant_id,permission_set_id,object_api),
 FOREIGN KEY(tenant_id,permission_set_id) REFERENCES md_permission_sets(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name)
);
CREATE INDEX IF NOT EXISTS md_permission_data_scopes_object_idx ON md_permission_data_scopes(tenant_id,object_api);

-- Any applicable permission set may grant a reporting scope. 'all' is the
-- broadest, followed by descendants, then own. A missing scope keeps existing
-- legacy record sharing. No role/position relation is used to calculate teams.
CREATE OR REPLACE FUNCTION md_effective_reporting_scope(t uuid, actor uuid, obj text)
RETURNS text LANGUAGE sql STABLE AS $$
 WITH assigned AS (
  SELECT a.permission_set_id,NULL::uuid AS group_id
    FROM md_permission_assignments a WHERE a.tenant_id=t AND a.user_id=actor
  UNION
  SELECT p.permission_set_id,NULL::uuid FROM md_user_profiles up
    JOIN md_profile_permission_sets p ON p.tenant_id=up.tenant_id AND p.profile_id=up.profile_id
    WHERE up.tenant_id=t AND up.user_id=actor
  UNION
  SELECT p.permission_set_id,NULL::uuid FROM md_user_roles ur
    JOIN md_role_permission_sets p ON p.tenant_id=ur.tenant_id AND p.role_id=ur.role_id
    WHERE ur.tenant_id=t AND ur.user_id=actor
  UNION
  SELECT gs.permission_set_id,ug.group_id FROM md_user_permission_groups ug
    JOIN md_permission_group_sets gs ON gs.tenant_id=ug.tenant_id AND gs.group_id=ug.group_id
    WHERE ug.tenant_id=t AND ug.user_id=actor
 ), effective AS (
  SELECT s.scope FROM assigned a JOIN md_permission_data_scopes s
    ON s.tenant_id=t AND s.permission_set_id=a.permission_set_id AND s.object_api=obj
    WHERE a.group_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM md_permission_group_mutes m
      WHERE m.tenant_id=t AND m.group_id=a.group_id
       AND m.resource IN(obj,'*') AND m.action IN('read','*'))
 )
 SELECT CASE WHEN bool_or(scope='all') THEN 'all'
   WHEN bool_or(scope='descendants') THEN 'descendants'
   WHEN bool_or(scope='own') THEN 'own' ELSE NULL END
 FROM effective;
$$;

-- Reuse the latest system governance record-access function. Scope enforcement
-- surrounds every existing sharing grant while preserving denials and restrictions.
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
 AND (usr.user_type='external'
      OR md_effective_reporting_scope(t,u,rec.object_api) IS NULL
      OR md_effective_reporting_scope(t,u,rec.object_api)='all'
      OR (rec.owner_id IS NOT NULL AND md_reporting_scope(t,u,rec.owner_id,
           md_effective_reporting_scope(t,u,rec.object_api))))
 AND (CASE WHEN usr.user_type='external' THEN act='read' AND COALESCE(setting.portal_enabled,false)
   AND usr.external_account_id IS NOT NULL
   AND md_record_field(t,rec.id,setting.portal_account_field)=usr.external_account_id::text
 ELSE
 (md_effective_reporting_scope(t,u,rec.object_api) IS NOT NULL
  AND (md_effective_reporting_scope(t,u,rec.object_api)='all'
    OR (rec.owner_id IS NOT NULL AND md_reporting_scope(t,u,rec.owner_id,
       md_effective_reporting_scope(t,u,rec.object_api)))))
 OR rec.owner_id=u OR (rec.owner_queue_id IS NOT NULL AND md_access_member(t,u,rec.owner_queue_id))
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

-- Existing tenant metadata: additive field backfill without changing layouts.
INSERT INTO md_field_definitions(tenant_id,object_api,api_name,label,data_type,related_object,required)
SELECT o.tenant_id,'User','ReportsToId','Reports To','reference','User',false
FROM md_object_definitions o WHERE o.api_name='User'
ON CONFLICT(tenant_id,object_api,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20261231-user-reporting-scopes.sql

-- BEGIN ORIGINAL MIGRATION 20270102-user-requested-communication-history-clear.sql
-- One-time, owner-requested reset of the currently visible Communication history.
-- Scoped to the tenant owning the independently verified example record and to
-- events existing when the request was made (25-Oct-2026 08:14 UTC).
-- Future messages and every other tenant remain untouched. Data is archived
-- in full; ordinary append-only protections are reinstated in this transaction.
--
-- This is not a reusable delete API or a change to normal Communication CRUD.
CREATE TABLE IF NOT EXISTS md_communication_user_clear_archive (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 record_id uuid NOT NULL,
 source_created_at timestamptz NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL DEFAULT 'owner_requested_2026_10_25',
 record_snapshot jsonb NOT NULL,
 field_snapshots jsonb NOT NULL,
 PRIMARY KEY (tenant_id,record_id)
);

-- Resolve the intended tenant from a real, known Communication UUID rather than
-- a name/email/global tenant sweep. The timestamp excludes all future traffic.
CREATE TEMP TABLE md_communication_clear_batch ON COMMIT DROP AS
SELECT record.tenant_id,record.id
FROM md_records record
WHERE record.object_api='Communication'
 AND record.is_deleted=false
 AND record.created_at < TIMESTAMPTZ '2026-10-25 08:15:00+00'
 AND EXISTS (
  SELECT 1 FROM md_records anchor
  WHERE anchor.tenant_id=record.tenant_id
   AND anchor.object_api='Communication'
   AND anchor.id='7214c626-0f66-4f40-b815-675f10b901b3'::uuid
 );

-- Each record and every typed field value is backed up before it is hidden.
-- The archive intentionally has no FK to md_records, so later recycle-bin
-- retention cannot silently destroy the only recoverable snapshot.
INSERT INTO md_communication_user_clear_archive
 (tenant_id,record_id,source_created_at,record_snapshot,field_snapshots)
SELECT record.tenant_id,record.id,record.created_at,to_jsonb(record),
 COALESCE((
  SELECT jsonb_agg(to_jsonb(value) ORDER BY value.field_api)
  FROM md_record_values value
  WHERE value.tenant_id=record.tenant_id
   AND value.record_id=record.id AND value.object_api='Communication'
 ),'[]'::jsonb)
FROM md_records record
JOIN md_communication_clear_batch batch
 ON batch.tenant_id=record.tenant_id AND batch.id=record.id
ON CONFLICT(tenant_id,record_id) DO NOTHING;

-- No unarchived row can ever be hidden.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM md_communication_clear_batch batch
  LEFT JOIN md_communication_user_clear_archive archive
   ON archive.tenant_id=batch.tenant_id AND archive.record_id=batch.id
  WHERE archive.record_id IS NULL
 ) THEN
  RAISE EXCEPTION 'Communication history backup incomplete; clearing aborted';
 END IF;
END $$;

-- Only the migration runner may perform this audited, atomic maintenance
-- operation; the normal API, Flows and ordinary users remain append-only.
-- The migration transaction holds DDL locks until both triggers are restored.
DROP TRIGGER md_communication_values_append_only ON md_record_values;
DROP TRIGGER md_communication_records_append_only ON md_records;

UPDATE md_record_values value
 SET record_is_deleted=true
FROM md_communication_clear_batch batch
WHERE value.tenant_id=batch.tenant_id AND value.record_id=batch.id
 AND value.object_api='Communication' AND value.record_is_deleted=false;

UPDATE md_records record
 SET is_deleted=true,deleted_at=now(),deleted_by=NULL
FROM md_communication_clear_batch batch
WHERE record.tenant_id=batch.tenant_id AND record.id=batch.id
 AND record.object_api='Communication' AND record.is_deleted=false;

CREATE TRIGGER md_communication_records_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_records
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();
CREATE TRIGGER md_communication_values_append_only
 BEFORE INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_communication_append_only_guard();

-- System event is tenant scoped. It records counts and cutoff, never message
-- content or provider credentials.
INSERT INTO md_security_events(tenant_id,action,details)
SELECT batch.tenant_id,'communication.history_cleared_by_owner',
 jsonb_build_object(
  'hiddenRecords',count(*),
  'cutoffUtc','2026-10-25T08:15:00Z',
  'recoveryTable','md_communication_user_clear_archive',
  'source','owner_request')
FROM md_communication_clear_batch batch
GROUP BY batch.tenant_id;
-- END ORIGINAL MIGRATION 20270102-user-requested-communication-history-clear.sql

-- BEGIN ORIGINAL MIGRATION 20270103-record-view-preferences.sql
-- Tenant/user-scoped reusable record list/detail presentation state.
-- Independent of saved list view visibility and tenant-authored page metadata.
-- This table stores UI-only widths; no customer business records are mutated.
CREATE TABLE IF NOT EXISTS md_record_view_preferences (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  object_api text NOT NULL,
  split_width_px integer NOT NULL DEFAULT 440 CHECK(split_width_px BETWEEN 320 AND 800),
  column_widths jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(column_widths)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,user_id,object_api),
  FOREIGN KEY(tenant_id,user_id) REFERENCES md_users(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name)
    ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20270103-record-view-preferences.sql

-- BEGIN ORIGINAL MIGRATION 20270104-normalized-matching.sql
-- Additive tenant-scoped matching mode; existing rules remain exact.
ALTER TABLE md_matching_rule_fields
 ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'Exact';
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
   WHERE conrelid='md_matching_rule_fields'::regclass
   AND conname='md_matching_rule_fields_match_type_check') THEN
  ALTER TABLE md_matching_rule_fields ADD CONSTRAINT md_matching_rule_fields_match_type_check
   CHECK(match_type IN ('Exact','Normalized'));
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20270104-normalized-matching.sql

-- BEGIN ORIGINAL MIGRATION 20270104-unified-record-page-layouts.sql
-- One-way, tenant-safe migration of untouched Object Page Layout baselines into
-- versioned Object-owned Record View/Edit canvases. Old layout tables are retained
-- as read-only compatibility data for other assignments and earlier revisions.
-- A customer's authored Record Page (or version audit) is NEVER rewritten.
DO $migration$
DECLARE
  obj record;
  pg record;
  section_row record;
  related_row record;
  v_variant text;
  v_layout text;
  v_version integer;
  v_existing integer;
  v_fields text[];
  v_index integer;
  v_relations text[];
BEGIN
  FOR obj IN SELECT tenant_id,api_name FROM md_object_definitions LOOP
    SELECT l.layout_id INTO v_layout FROM md_object_page_layouts l
      WHERE l.tenant_id=obj.tenant_id AND l.object_api=obj.api_name
      ORDER BY CASE WHEN EXISTS(
        SELECT 1 FROM md_object_page_layout_assignments a
        WHERE a.tenant_id=l.tenant_id AND a.object_api=l.object_api
          AND a.layout_id=l.layout_id AND a.profile_id='*' AND a.record_type_id='*'
      ) THEN 0 ELSE 1 END,l.sort_order LIMIT 1;
    IF v_layout IS NULL THEN CONTINUE; END IF;
    -- A single canonical layout can be migrated automatically. Multiple
    -- assigned legacy layouts need individual Record Page activation rules;
    -- keep their existing SQL-backed profile/record-type behavior intact until
    -- an administrator imports each layout and publishes its assignment.
    IF (SELECT COUNT(*) FROM md_object_page_layouts l
        WHERE l.tenant_id=obj.tenant_id AND l.object_api=obj.api_name)>1
      OR EXISTS(SELECT 1 FROM md_object_page_layout_assignments a
        WHERE a.tenant_id=obj.tenant_id AND a.object_api=obj.api_name
          AND a.layout_id<>v_layout)
    THEN CONTINUE; END IF;
    FOR pg IN SELECT d.page_id,d.record_mode,d.status,p.title
      FROM md_lightning_page_details d
      JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id
      WHERE d.tenant_id=obj.tenant_id AND d.target_object=obj.api_name
        AND d.page_type='Record Page' AND p.enabled=true
        AND p.api_name='Record_'||substr(md5(obj.tenant_id::text||':'||obj.api_name),1,20)||'_'||d.record_mode
      LOOP
      -- Keep tenant edits and version history intact. Only the scaffold from
      -- md_ensure_object_record_pages qualifies for automatic conversion.
      IF EXISTS(SELECT 1 FROM md_page_layout_audit a
          WHERE a.tenant_id=obj.tenant_id AND a.page_id=pg.page_id)
        OR EXISTS(SELECT 1 FROM md_lightning_page_nodes n
          WHERE n.tenant_id=obj.tenant_id AND n.page_id=pg.page_id
            AND (n.component_key<>'record-detail' OR n.component_type<>'Record Detail'))
        OR EXISTS(SELECT 1 FROM md_lightning_page_node_properties custom
          WHERE custom.tenant_id=obj.tenant_id AND custom.page_id=pg.page_id)
        OR EXISTS(SELECT 1 FROM md_page_layout_version_nodes migrated
          WHERE migrated.tenant_id=obj.tenant_id AND migrated.page_id=pg.page_id
            AND migrated.component_key LIKE 'layout-section-%')
        OR EXISTS(SELECT 1 FROM md_page_layout_heads h
          WHERE h.tenant_id=obj.tenant_id AND h.page_id=pg.page_id
            AND (coalesce(h.draft_version,0)>1 OR coalesce(h.published_version,0)>1))
      THEN CONTINUE; END IF;
      FOR v_variant IN SELECT name FROM (VALUES ('Mobile'),('Desktop'),('Tablet'),('Custom')) v(name) LOOP
        SELECT h.draft_version INTO v_existing FROM md_page_layout_heads h
          WHERE h.tenant_id=obj.tenant_id AND h.page_id=pg.page_id AND h.variant=v_variant;
        v_version=CASE WHEN v_existing IS NULL THEN 1 ELSE 2 END;
        -- An existing revision 2 means this migration already ran.
        IF EXISTS(SELECT 1 FROM md_page_layout_versions v
          WHERE v.tenant_id=obj.tenant_id AND v.page_id=pg.page_id
            AND v.variant=v_variant AND v.version=v_version) THEN CONTINUE; END IF;
        INSERT INTO md_page_layout_versions
          (tenant_id,page_id,variant,version,page_label,layout_mode,template,canvas_width,canvas_height)
          SELECT d.tenant_id,d.page_id,v_variant,v_version,p.title,d.layout_mode,d.template,
            CASE v_variant WHEN 'Mobile' THEN 390 WHEN 'Tablet' THEN 1024 ELSE d.canvas_width END,
            CASE v_variant WHEN 'Mobile' THEN 844 WHEN 'Tablet' THEN 768 ELSE d.canvas_height END
          FROM md_lightning_page_details d
          JOIN md_page_definitions p ON p.tenant_id=d.tenant_id AND p.id=d.page_id
          WHERE d.tenant_id=obj.tenant_id AND d.page_id=pg.page_id
          ON CONFLICT DO NOTHING;
        FOR section_row IN SELECT section_id,label,columns,sort_order
          FROM md_object_page_layout_sections
          WHERE tenant_id=obj.tenant_id AND object_api=obj.api_name AND layout_id=v_layout
          ORDER BY sort_order LOOP
          SELECT coalesce(array_agg(field_api ORDER BY sort_order),ARRAY[]::text[])
          INTO v_fields FROM md_object_page_layout_fields
          WHERE tenant_id=obj.tenant_id AND object_api=obj.api_name
            AND layout_id=v_layout AND section_id=section_row.section_id;
          INSERT INTO md_page_layout_version_nodes
            (tenant_id,page_id,variant,version,component_key,component_type,label,region,visible,sort_order)
          VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,
            'layout-section-'||substr(md5(section_row.section_id),1,20),
            'Field Section',section_row.label,'main',true,section_row.sort_order)
          ON CONFLICT DO NOTHING;
          INSERT INTO md_page_layout_version_properties
            (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
          VALUES
            (obj.tenant_id,pg.page_id,v_variant,v_version,'layout-section-'||substr(md5(section_row.section_id),1,20),'/props','object',NULL),
            (obj.tenant_id,pg.page_id,v_variant,v_version,'layout-section-'||substr(md5(section_row.section_id),1,20),'/props/columns','number',section_row.columns::text),
            (obj.tenant_id,pg.page_id,v_variant,v_version,'layout-section-'||substr(md5(section_row.section_id),1,20),'/props/fieldApiNames','array',NULL)
          ON CONFLICT DO NOTHING;
          FOR v_index IN 1..coalesce(array_length(v_fields,1),0) LOOP
            INSERT INTO md_page_layout_version_properties
              (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
            VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,
              'layout-section-'||substr(md5(section_row.section_id),1,20),
              '/props/fieldApiNames/'||(v_index-1),'string',v_fields[v_index])
            ON CONFLICT DO NOTHING;
          END LOOP;
        END LOOP;
        SELECT coalesce(array_agg(list_name ORDER BY sort_order),ARRAY[]::text[])
        INTO v_relations FROM md_object_page_layout_related_lists
        WHERE tenant_id=obj.tenant_id AND object_api=obj.api_name AND layout_id=v_layout;
        IF cardinality(v_relations)>0 THEN
          INSERT INTO md_page_layout_version_nodes
            (tenant_id,page_id,variant,version,component_key,component_type,label,region,visible,sort_order)
          VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,'legacy-related-lists',
            'Related List','Related Lists','main',true,10000)
          ON CONFLICT DO NOTHING;
          INSERT INTO md_page_layout_version_properties
            (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
          VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,'legacy-related-lists','/props','object',NULL),
            (obj.tenant_id,pg.page_id,v_variant,v_version,'legacy-related-lists','/props/relatedLists','array',NULL)
          ON CONFLICT DO NOTHING;
          FOR v_index IN 1..cardinality(v_relations) LOOP
            INSERT INTO md_page_layout_version_properties
              (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
            VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,'legacy-related-lists',
              '/props/relatedLists/'||(v_index-1),'string',v_relations[v_index])
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
        INSERT INTO md_page_layout_version_activation
          (tenant_id,page_id,variant,version,assignment_id,scope,app_api,
            profile_id,record_type_id,desktop,phone,tablet,custom,sort_order)
          SELECT a.tenant_id,a.page_id,v_variant,v_version,a.assignment_id,a.scope,a.app_api,
            a.profile_id,a.record_type_id,a.desktop,a.phone,a.tablet,a.custom,a.sort_order
          FROM md_lightning_page_activation a WHERE a.tenant_id=obj.tenant_id AND a.page_id=pg.page_id
          ON CONFLICT DO NOTHING;
        INSERT INTO md_page_layout_heads
          (tenant_id,page_id,variant,draft_version,published_version)
        VALUES(obj.tenant_id,pg.page_id,v_variant,v_version,
          CASE WHEN pg.status='Active' THEN v_version ELSE NULL END)
        ON CONFLICT(tenant_id,page_id,variant) DO UPDATE
          SET draft_version=excluded.draft_version,
              published_version=excluded.published_version,updated_at=now();
      END LOOP;
    END LOOP;
  END LOOP;
END $migration$;
-- END ORIGINAL MIGRATION 20270104-unified-record-page-layouts.sql

-- BEGIN ORIGINAL MIGRATION 20270105-fuzzy-matching.sql
-- Tenant rules retain Exact/Normalized defaults; fuzzy mode is opt-in.
ALTER TABLE md_matching_rule_fields
 ADD COLUMN IF NOT EXISTS max_distance smallint NOT NULL DEFAULT 1;
ALTER TABLE md_matching_rule_fields
 DROP CONSTRAINT IF EXISTS md_matching_rule_fields_match_type_check;
ALTER TABLE md_matching_rule_fields ADD CONSTRAINT md_matching_rule_fields_match_type_check
 CHECK (match_type IN ('Exact','Normalized','Fuzzy'));
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='md_matching_rule_fields'::regclass
  AND conname='md_matching_rule_fields_max_distance_check') THEN
  ALTER TABLE md_matching_rule_fields ADD CONSTRAINT md_matching_rule_fields_max_distance_check
   CHECK (max_distance IN (1,2));
 END IF;
END $$;
-- Bounded edit distance. Never called on more than 64 significant ASCII chars.
-- No extension dependency and no cross-tenant reads; used inside scoped record query.
CREATE OR REPLACE FUNCTION md_fuzzy_ascii_match(actual text, expected text, max_edits integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
 a text:=regexp_replace(lower(actual),'[^a-z0-9]','','g');
 b text:=regexp_replace(lower(expected),'[^a-z0-9]','','g');
 previous integer[]; current_row integer[];
 i integer; j integer; cost integer; row_min integer;
BEGIN
 IF length(a)<4 OR length(b)<4 OR length(a)>64 OR length(b)>64
  OR max_edits NOT IN(1,2) OR abs(length(a)-length(b))>max_edits
  OR left(a,1)<>left(b,1) THEN RETURN false; END IF;
 previous:=ARRAY(SELECT generate_series(0,length(b)));
 FOR i IN 1..length(a) LOOP
  current_row:=ARRAY[i];row_min:=i;
  FOR j IN 1..length(b) LOOP
   cost:=CASE WHEN substr(a,i,1)=substr(b,j,1) THEN 0 ELSE 1 END;
   current_row:=current_row||LEAST(previous[j+1]+1,current_row[j]+1,previous[j]+cost);
   row_min:=LEAST(row_min,current_row[j+1]);
  END LOOP;
  IF row_min>max_edits THEN RETURN false; END IF;
  previous:=current_row;
 END LOOP;
 RETURN previous[length(b)+1]<=max_edits;
END $$;
-- END ORIGINAL MIGRATION 20270105-fuzzy-matching.sql

-- BEGIN ORIGINAL MIGRATION 20270106-object-business-processes.sql
-- Shared, tenant-scoped business process definitions; record-type status values
-- remain the single Record Engine source of truth after an explicit apply.
CREATE TABLE IF NOT EXISTS md_object_business_processes (
 tenant_id uuid NOT NULL,object_api text NOT NULL,api_name text NOT NULL,
 label text NOT NULL,status_field text NOT NULL,revision integer NOT NULL DEFAULT 1,
 active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,api_name),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,object_api,status_field)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE RESTRICT,
 CHECK(api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
 CHECK(length(label) BETWEEN 1 AND 160),
 CHECK(revision>0)
);
CREATE TABLE IF NOT EXISTS md_object_business_process_values (
 tenant_id uuid NOT NULL,object_api text NOT NULL,process_api text NOT NULL,
 value_text text NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,object_api,process_api,value_text),
 FOREIGN KEY(tenant_id,object_api,process_api)
  REFERENCES md_object_business_processes(tenant_id,object_api,api_name) ON DELETE CASCADE,
 CHECK(length(value_text) BETWEEN 1 AND 255)
);
CREATE INDEX IF NOT EXISTS md_object_business_process_values_order
 ON md_object_business_process_values(tenant_id,object_api,process_api,sort_order);
ALTER TABLE md_object_record_types
 ADD COLUMN IF NOT EXISTS business_process_api_name text;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='md_object_record_types'::regclass
  AND conname='md_record_type_business_process_fkey') THEN
  ALTER TABLE md_object_record_types ADD CONSTRAINT md_record_type_business_process_fkey
   FOREIGN KEY(tenant_id,object_api,business_process_api_name)
   REFERENCES md_object_business_processes(tenant_id,object_api,api_name) ON DELETE RESTRICT;
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20270106-object-business-processes.sql

-- BEGIN ORIGINAL MIGRATION 20270107-component-property-contract.sql
-- Additive version-owned relational property/event schemas. Existing definitions and pages remain intact.
CREATE TABLE IF NOT EXISTS md_component_library_contract_properties (
 tenant_id uuid NOT NULL,
 component_api text NOT NULL,
 version integer NOT NULL,
 property_path text NOT NULL,
 value_kind text NOT NULL CHECK (value_kind IN ('object','array','string','number','boolean','null')),
 value_text text,
 PRIMARY KEY (tenant_id,component_api,version,property_path),
 FOREIGN KEY (tenant_id,component_api,version)
  REFERENCES md_component_library_versions(tenant_id,component_api,version)
);
-- END ORIGINAL MIGRATION 20270107-component-property-contract.sql

-- BEGIN ORIGINAL MIGRATION 20270107-protected-custom-settings.sql
-- SQL source-of-truth for protected settings. Existing tenant settings stay public.
ALTER TABLE md_custom_settings
 ADD COLUMN IF NOT EXISTS protection_mode text NOT NULL DEFAULT 'Public';
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conrelid='md_custom_settings'::regclass
    AND conname='md_custom_settings_protection_check'
 ) THEN
  ALTER TABLE md_custom_settings ADD CONSTRAINT md_custom_settings_protection_check
    CHECK (protection_mode IN ('Public','Protected'));
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20270107-protected-custom-settings.sql

-- BEGIN ORIGINAL MIGRATION 20270108-tenant-file-assets.sql
-- Extend the shared tenant media store to safe PDF documents. Images retain
-- their existing limits and validation; existing assets are preserved.
ALTER TABLE md_tenant_media_assets
 DROP CONSTRAINT IF EXISTS md_tenant_media_assets_content_type_check;
ALTER TABLE md_tenant_media_assets
 ADD CONSTRAINT md_tenant_media_assets_content_type_check
 CHECK (content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf'));
-- END ORIGINAL MIGRATION 20270108-tenant-file-assets.sql

-- BEGIN ORIGINAL MIGRATION 20270109-object-label-translations.sql
-- Tenant-specific object and field labels, without changing canonical API names.
-- Empty field_api translates Object.label. '*' translates Object.pluralLabel.
CREATE TABLE IF NOT EXISTS md_object_label_translations (
 tenant_id uuid NOT NULL, object_api text NOT NULL,
 field_api text NOT NULL DEFAULT '',
 language text NOT NULL CHECK(language ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'),
 value_text text NOT NULL CHECK(length(trim(value_text)) BETWEEN 1 AND 255),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,language,field_api),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 CHECK(field_api IN ('','*') OR field_api ~ '^[A-Za-z][A-Za-z0-9_]*$')
);
CREATE INDEX IF NOT EXISTS md_object_label_translations_language
 ON md_object_label_translations(tenant_id,language,object_api);

CREATE TABLE IF NOT EXISTS md_object_label_translation_revisions (
 tenant_id uuid NOT NULL,object_api text NOT NULL,language text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,language),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE
);
-- END ORIGINAL MIGRATION 20270109-object-label-translations.sql

-- BEGIN ORIGINAL MIGRATION 20270110-cross-object-matching.sql
-- Cross-object duplicate rules extend the existing Record Matching engine.
-- Old rules remain same-object; there is no separate workflow or CRUD engine.
ALTER TABLE md_matching_rules
 ADD COLUMN IF NOT EXISTS target_object_api text;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='md_matching_rules'::regclass
  AND conname='md_matching_rules_target_object_fkey') THEN
  ALTER TABLE md_matching_rules ADD CONSTRAINT md_matching_rules_target_object_fkey
    FOREIGN KEY(tenant_id,target_object_api)
    REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE RESTRICT;
 END IF;
END $$;
ALTER TABLE md_matching_rule_fields
 ADD COLUMN IF NOT EXISTS target_field_api text;
CREATE TABLE IF NOT EXISTS md_cross_object_duplicate_sets(
 tenant_id uuid NOT NULL,object_api text NOT NULL,rule_api text NOT NULL,
 record_id uuid NOT NULL,matched_object_api text NOT NULL,matched_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,rule_api,record_id,matched_object_api,matched_record_id),
 FOREIGN KEY(tenant_id,object_api,rule_api)
  REFERENCES md_matching_rules(tenant_id,object_api,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,record_id,object_api)
  REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,matched_record_id,matched_object_api)
  REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE,
 CHECK(object_api<>matched_object_api)
);
CREATE INDEX IF NOT EXISTS md_cross_object_duplicate_sets_source
 ON md_cross_object_duplicate_sets(tenant_id,object_api,record_id,created_at DESC);
-- END ORIGINAL MIGRATION 20270110-cross-object-matching.sql

-- BEGIN ORIGINAL MIGRATION 20270111-business-process-history.sql
-- Immutable relational revision snapshots; customer Record Type values are never
-- rewritten when the named process changes or a historic revision is restored.
CREATE TABLE IF NOT EXISTS md_object_business_process_history (
 tenant_id uuid NOT NULL,object_api text NOT NULL,process_api text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),label text NOT NULL,
 status_field text NOT NULL,active boolean NOT NULL,
 actor_user_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,process_api,revision),
 FOREIGN KEY(tenant_id,object_api,process_api)
  REFERENCES md_object_business_processes(tenant_id,object_api,api_name)
  ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_object_business_process_history_values (
 tenant_id uuid NOT NULL,object_api text NOT NULL,process_api text NOT NULL,
 revision integer NOT NULL,value_text text NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(tenant_id,object_api,process_api,revision,value_text),
 FOREIGN KEY(tenant_id,object_api,process_api,revision)
  REFERENCES md_object_business_process_history(tenant_id,object_api,process_api,revision)
  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_object_business_process_history_order
 ON md_object_business_process_history(tenant_id,object_api,process_api,revision DESC);
-- The first installed revision is preserved for tenants upgraded after processes
-- were created. Running this migration again never overwrites later changes.
INSERT INTO md_object_business_process_history
 (tenant_id,object_api,process_api,revision,label,status_field,active)
SELECT tenant_id,object_api,api_name,revision,label,status_field,active
FROM md_object_business_processes
ON CONFLICT DO NOTHING;
INSERT INTO md_object_business_process_history_values
 (tenant_id,object_api,process_api,revision,value_text,sort_order)
SELECT v.tenant_id,v.object_api,v.process_api,p.revision,v.value_text,v.sort_order
FROM md_object_business_process_values v
JOIN md_object_business_processes p
 ON p.tenant_id=v.tenant_id AND p.object_api=v.object_api AND p.api_name=v.process_api
ON CONFLICT DO NOTHING;
-- END ORIGINAL MIGRATION 20270111-business-process-history.sql

-- BEGIN ORIGINAL MIGRATION 20270112-unicode-matching.sql
-- Unicode-aware matching in existing tenant-isolated duplicate rules.
-- PostgreSQL NFC and Unicode classes, no extensions or runtime app loading.
CREATE OR REPLACE FUNCTION md_fuzzy_unicode_match(actual text, expected text, max_edits integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
 a text:=regexp_replace(lower(normalize(actual,NFC)),'[^[:alnum:]]','','g');
 b text:=regexp_replace(lower(normalize(expected,NFC)),'[^[:alnum:]]','','g');
 previous integer[]; current_row integer[];
 i integer; j integer; cost integer; row_min integer;
BEGIN
 IF length(a)<4 OR length(b)<4 OR length(a)>64 OR length(b)>64
  OR max_edits NOT IN(1,2) OR abs(length(a)-length(b))>max_edits
  OR left(a,1)<>left(b,1) THEN RETURN false; END IF;
 previous:=ARRAY(SELECT generate_series(0,length(b)));
 FOR i IN 1..length(a) LOOP
  current_row:=ARRAY[i];row_min:=i;
  FOR j IN 1..length(b) LOOP
   cost:=CASE WHEN substr(a,i,1)=substr(b,j,1) THEN 0 ELSE 1 END;
   current_row:=current_row||LEAST(previous[j+1]+1,current_row[j]+1,previous[j]+cost);
   row_min:=LEAST(row_min,current_row[j+1]);
  END LOOP;
  IF row_min>max_edits THEN RETURN false; END IF;
  previous:=current_row;
 END LOOP;
 RETURN previous[length(b)+1]<=max_edits;
END $$;
-- Keep the legacy ASCII-only entry point for older callers.
CREATE OR REPLACE FUNCTION md_fuzzy_ascii_match(actual text, expected text, max_edits integer)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT CASE WHEN
  regexp_replace(lower(actual),'[^a-z0-9]','','g') =
   regexp_replace(lower(normalize(actual,NFC)),'[^[:alnum:]]','','g')
  AND regexp_replace(lower(expected),'[^a-z0-9]','','g') =
   regexp_replace(lower(normalize(expected,NFC)),'[^[:alnum:]]','','g')
  THEN md_fuzzy_unicode_match(actual,expected,max_edits) ELSE false END;
$$;
-- END ORIGINAL MIGRATION 20270112-unicode-matching.sql

-- BEGIN ORIGINAL MIGRATION 20270113-field-exact-index-lifecycle.sql
-- Tenant-configured equality indexes use one reusable physical structure instead
-- of DDL per tenant. The indexed data is disposable and rebuildable from records.
CREATE TABLE IF NOT EXISTS md_field_exact_indexes(
 tenant_id uuid NOT NULL,object_api text NOT NULL,field_api text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,field_api),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_field_exact_index_entries(
 tenant_id uuid NOT NULL,object_api text NOT NULL,field_api text NOT NULL,
 record_id uuid NOT NULL,
 value_hash text NOT NULL CHECK(length(value_hash)=32),
 folded_hash text NOT NULL CHECK(length(folded_hash)=32),
 PRIMARY KEY(tenant_id,object_api,field_api,record_id),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_exact_indexes(tenant_id,object_api,field_api) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,record_id,object_api)
  REFERENCES md_records(tenant_id,id,object_api) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS md_field_exact_entries_cs
 ON md_field_exact_index_entries(tenant_id,object_api,field_api,value_hash,record_id);
CREATE INDEX IF NOT EXISTS md_field_exact_entries_ci
 ON md_field_exact_index_entries(tenant_id,object_api,field_api,folded_hash,record_id);

CREATE OR REPLACE FUNCTION md_sync_field_exact_entry(
 t uuid,obj text,f text,rid uuid,raw text,is_deleted boolean
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF raw IS NULL OR is_deleted
   OR NOT EXISTS(SELECT 1 FROM md_field_exact_indexes
     WHERE tenant_id=t AND object_api=obj AND field_api=f AND enabled) THEN
  DELETE FROM md_field_exact_index_entries
   WHERE tenant_id=t AND object_api=obj AND field_api=f AND record_id=rid;
  RETURN;
 END IF;
 INSERT INTO md_field_exact_index_entries
  (tenant_id,object_api,field_api,record_id,value_hash,folded_hash)
 VALUES(t,obj,f,rid,md5(raw),md5(lower(raw)))
 ON CONFLICT(tenant_id,object_api,field_api,record_id) DO UPDATE
 SET value_hash=EXCLUDED.value_hash,folded_hash=EXCLUDED.folded_hash;
END $$;

CREATE OR REPLACE FUNCTION md_sync_field_exact_record_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM md_field_exact_index_entries WHERE tenant_id=OLD.tenant_id
   AND object_api=OLD.object_api AND field_api=OLD.field_api AND record_id=OLD.record_id;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND
  (OLD.object_api,OLD.field_api,OLD.record_id) IS DISTINCT FROM
  (NEW.object_api,NEW.field_api,NEW.record_id) THEN
  DELETE FROM md_field_exact_index_entries WHERE tenant_id=OLD.tenant_id
   AND object_api=OLD.object_api AND field_api=OLD.field_api AND record_id=OLD.record_id;
 END IF;
 PERFORM md_sync_field_exact_entry(
  NEW.tenant_id,NEW.object_api,NEW.field_api,NEW.record_id,
  NEW.value_text,NEW.record_is_deleted);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_sync_field_exact_record ON md_record_values;
CREATE TRIGGER md_sync_field_exact_record
 AFTER INSERT OR UPDATE OR DELETE ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_sync_field_exact_record_trigger();

CREATE OR REPLACE FUNCTION md_rebuild_field_exact_index_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM md_field_exact_index_entries
  WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND field_api=NEW.field_api;
 IF NEW.enabled THEN
  INSERT INTO md_field_exact_index_entries
   (tenant_id,object_api,field_api,record_id,value_hash,folded_hash)
  SELECT v.tenant_id,v.object_api,v.field_api,v.record_id,
   md5(v.value_text),md5(lower(v.value_text))
  FROM md_record_values v
  WHERE v.tenant_id=NEW.tenant_id AND v.object_api=NEW.object_api
   AND v.field_api=NEW.field_api AND v.value_text IS NOT NULL
   AND v.record_is_deleted=false;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_rebuild_field_exact_index ON md_field_exact_indexes;
CREATE TRIGGER md_rebuild_field_exact_index
 AFTER INSERT OR UPDATE OF enabled ON md_field_exact_indexes
 FOR EACH ROW EXECUTE FUNCTION md_rebuild_field_exact_index_trigger();


CREATE TABLE IF NOT EXISTS md_field_exact_index_history(
 tenant_id uuid NOT NULL,object_api text NOT NULL,field_api text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),enabled boolean NOT NULL,
 actor_user_id uuid NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,object_api,field_api,revision),
 FOREIGN KEY(tenant_id,object_api,field_api)
  REFERENCES md_field_definitions(tenant_id,object_api,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);

-- Previously configured objects have no equality-index enrollment.
-- Migration replay preserves all tenant preferences and business records.
-- END ORIGINAL MIGRATION 20270113-field-exact-index-lifecycle.sql

-- BEGIN ORIGINAL MIGRATION 20270114-object-action-placement.sql
-- Additive action placement metadata. Existing tenant actions keep their
-- pre-upgrade record header/highlights behavior; no routes or records removed.
ALTER TABLE md_object_actions
 ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'Default';
ALTER TABLE md_object_actions
 DROP CONSTRAINT IF EXISTS md_object_actions_placement_check;
ALTER TABLE md_object_actions
 ADD CONSTRAINT md_object_actions_placement_check
 CHECK(placement IN ('Default','Header','Highlights','Publisher','Everywhere'));
-- END ORIGINAL MIGRATION 20270114-object-action-placement.sql

-- BEGIN ORIGINAL MIGRATION 20270115-une-only-component-registrations.sql
-- Consolidate the eight legacy system-registered One components into their UNE equivalents.
-- Preserves layout node keys, component props, Flows, page versions and user-created components.
-- Re-runnable: update exact identifiers only; never broad text replacement.
-- Keep shared old renderer source files as internal UNE dependencies.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT t.id,m.new_api,'one-bundled:'||m.new_api,true
FROM md_tenants t CROSS JOIN (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
ON CONFLICT(tenant_id,api_name) DO NOTHING;

UPDATE md_lightning_page_nodes n SET component_type='Custom:'||m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE n.component_type='Custom:'||m.old_api AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=n.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

UPDATE md_page_layout_version_nodes n SET component_type='Custom:'||m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE n.component_type='Custom:'||m.old_api AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=n.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

-- Older app pages use a foreign-key-backed component_api column.
UPDATE md_page_components p SET component_api=m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE p.component_api=m.old_api AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=p.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

-- Flow screen data can appear in flattened component keys and encoded arrays.
UPDATE md_flow_editor_values f SET value_text=m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE f.value_kind='string' AND f.value_text=m.old_api
  AND f.property_path ~ '(^|/)(componentApiName|customComponentApiName|libraryComponentId)$'
  AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=f.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

UPDATE md_flow_node_properties f SET value_text=m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE f.value_text=m.old_api
  AND f.api_name IN ('componentApiName','customComponentApiName','libraryComponentId')
  AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=f.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

UPDATE md_object_actions a SET component_api_name=m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE a.component_api_name=m.old_api AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=a.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

UPDATE md_global_quick_actions a SET component_api_name=m.new_api
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE a.component_api_name=m.old_api AND EXISTS (SELECT 1 FROM md_component_definitions legacy
  WHERE legacy.tenant_id=a.tenant_id AND legacy.api_name=m.old_api
    AND legacy.renderer_key='one-bundled:'||m.old_api);

-- Recursive, key-aware JSON transformation: never rewrite ordinary text,
-- formula contents, titles, or tenant values which merely resemble API names.
CREATE FUNCTION md_une_component_reference_upgrade(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $func$
DECLARE k text; entry jsonb; result jsonb; target text;
BEGIN
 IF jsonb_typeof(payload)='object' THEN
  result:='{}'::jsonb;
  FOR k,entry IN SELECT e.key,e.value FROM jsonb_each(payload) AS e LOOP
   IF jsonb_typeof(entry)='string' AND
      k IN ('componentApiName','customComponentApiName','libraryComponentId','type') THEN
    target:=CASE entry #>> '{}'
 WHEN 'OneText' THEN 'une_text'
 WHEN 'Custom:OneText' THEN 'Custom:une_text'
 WHEN 'OneBadge' THEN 'une_badge'
 WHEN 'Custom:OneBadge' THEN 'Custom:une_badge'
 WHEN 'OneButton' THEN 'une_button'
 WHEN 'Custom:OneButton' THEN 'Custom:une_button'
 WHEN 'OneSearch' THEN 'une_search'
 WHEN 'Custom:OneSearch' THEN 'Custom:une_search'
 WHEN 'OneCalendar' THEN 'une_calendar'
 WHEN 'Custom:OneCalendar' THEN 'Custom:une_calendar'
 WHEN 'OneItemGrid' THEN 'une_item_grid'
 WHEN 'Custom:OneItemGrid' THEN 'Custom:une_item_grid'
 WHEN 'OneConversation' THEN 'une_conversation'
 WHEN 'Custom:OneConversation' THEN 'Custom:une_conversation'
 WHEN 'OneShoppingCart' THEN 'une_cart'
 WHEN 'Custom:OneShoppingCart' THEN 'Custom:une_cart'
     ELSE NULL END;
    IF k='type' AND (entry #>> '{}') NOT LIKE 'Custom:%' THEN target:=NULL; END IF;
    IF target IS NOT NULL THEN entry:=to_jsonb(target); END IF;
   ELSE entry:=md_une_component_reference_upgrade(entry);
   END IF;
   result:=result||jsonb_build_object(k,entry);
  END LOOP;
  RETURN result;
 ELSIF jsonb_typeof(payload)='array' THEN
  SELECT COALESCE(jsonb_agg(md_une_component_reference_upgrade(item.value)
    ORDER BY item.ordinality),'[]'::jsonb)
   INTO result FROM jsonb_array_elements(payload) WITH ORDINALITY AS item(value,ordinality);
  RETURN result;
 END IF;
 RETURN payload;
END
$func$;

-- Dashboard definitions and Flow editor structured state retain all authored data.
UPDATE md_system_definitions d
SET properties=md_une_component_reference_upgrade(d.properties)
WHERE d.kind='dashboards'
  AND d.properties::text LIKE '%One%'
  AND EXISTS(SELECT 1 FROM md_component_definitions r
    WHERE r.tenant_id=d.tenant_id AND r.renderer_key='one-bundled:'||r.api_name
    AND r.api_name=ANY(ARRAY['OneText','OneBadge','OneButton','OneSearch','OneCalendar','OneItemGrid','OneConversation','OneShoppingCart']::text[]));

UPDATE md_flow_editor_values f
SET value_text=md_une_component_reference_upgrade(f.value_text::jsonb)::text
WHERE f.value_kind IN ('object','array') AND f.value_text IS NOT NULL
 AND f.value_text LIKE '%One%'
 AND EXISTS(SELECT 1 FROM md_component_definitions r
    WHERE r.tenant_id=f.tenant_id AND r.renderer_key='one-bundled:'||r.api_name
    AND r.api_name=ANY(ARRAY['OneText','OneBadge','OneButton','OneSearch','OneCalendar','OneItemGrid','OneConversation','OneShoppingCart']::text[]));

DROP FUNCTION md_une_component_reference_upgrade(jsonb);

-- Disable only exact system-owned legacy registrations, retaining rows for
-- published page history, foreign keys, and reversible deployment recovery.
UPDATE md_component_definitions d SET enabled=false
FROM (VALUES
 ('OneText','une_text'),
 ('OneBadge','une_badge'),
 ('OneButton','une_button'),
 ('OneSearch','une_search'),
 ('OneCalendar','une_calendar'),
 ('OneItemGrid','une_item_grid'),
 ('OneConversation','une_conversation'),
 ('OneShoppingCart','une_cart')
) AS m(old_api,new_api)
WHERE d.api_name=m.old_api AND d.renderer_key='one-bundled:'||m.old_api
  AND d.enabled=true AND NOT EXISTS (
    SELECT 1 FROM md_component_library_heads h
    WHERE h.tenant_id=d.tenant_id AND h.component_api=d.api_name
  );
-- END ORIGINAL MIGRATION 20270115-une-only-component-registrations.sql

-- BEGIN ORIGINAL MIGRATION 20270116-source-object-property-labels.sql
-- Label-only migration. Preserve component property keys, authored values, historical versions and tenant custom labels.
-- Update active contracts only where a label still equals the original system label.
WITH labels(component_api,old_label,new_label) AS (
 VALUES
  ('une_conversation', 'Account object', 'Source Object — Account'),
  ('une_conversation', 'Contact object', 'Source Object — Contact'),
  ('une_conversation', 'Contact source Object API from Flow', 'Source Object — Contact (Flow)'),
  ('une_conversation', 'Conversation object', 'Source Object — Conversation'),
  ('une_conversation', 'Message object', 'Source Object — Message'),
  ('une_repeater', 'Flow record source Object API', 'Source Object — Flow Records'),
  ('une_cart', 'State object', 'Source Object — State')
)
UPDATE md_component_library_contract_properties p
SET value_text = labels.new_label
FROM labels
JOIN md_component_library_heads h ON h.component_api=labels.component_api
WHERE p.tenant_id=h.tenant_id
 AND p.component_api=h.component_api
 AND p.version=h.current_version
 AND p.component_api=labels.component_api
 AND p.property_path LIKE '/propertyDefinitions/%/label'
 AND p.value_kind='string'
 AND p.value_text=labels.old_label;
-- END ORIGINAL MIGRATION 20270116-source-object-property-labels.sql

-- BEGIN ORIGINAL MIGRATION 20270117-unify-text-input-components.sql
-- Consolidate the platform's retired UNE Text into UNE Input without rewriting
-- tenant-owned components. Preserve instance IDs, styling, values and Flow bindings.
-- Existing text boxes remain display-only; newly inserted Input boxes allow typing.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT t.id,'une_input','one-bundled:une_input',true FROM md_tenants t
ON CONFLICT(tenant_id,api_name) DO NOTHING;
UPDATE md_component_definitions SET enabled=true
WHERE api_name='une_input' AND renderer_key='one-bundled:une_input';

-- Current Page Builder nodes: explicitly prevent any migrated label from typing.
INSERT INTO md_lightning_page_node_properties
 (tenant_id,page_id,component_key,property_path,value_kind,value_text)
SELECT n.tenant_id,n.page_id,n.component_key,'/props/allowTyping','boolean','false'
FROM md_lightning_page_nodes n
WHERE n.component_type='Custom:une_text'
ON CONFLICT DO NOTHING;
UPDATE md_lightning_page_node_properties p SET property_path='/props/value'
WHERE p.property_path='/props/text' AND EXISTS (
 SELECT 1 FROM md_lightning_page_nodes n
 WHERE n.tenant_id=p.tenant_id AND n.page_id=p.page_id
   AND n.component_key=p.component_key AND n.component_type='Custom:une_text'
) AND NOT EXISTS (
 SELECT 1 FROM md_lightning_page_node_properties v
 WHERE v.tenant_id=p.tenant_id AND v.page_id=p.page_id AND v.component_key=p.component_key
   AND v.property_path='/props/value'
);
UPDATE md_lightning_page_node_properties p SET property_path='/props/stateBindings/value'
WHERE p.property_path='/props/stateBindings/text' AND EXISTS (
 SELECT 1 FROM md_lightning_page_nodes n WHERE n.tenant_id=p.tenant_id
 AND n.page_id=p.page_id AND n.component_key=p.component_key AND n.component_type='Custom:une_text'
) AND NOT EXISTS (
 SELECT 1 FROM md_lightning_page_node_properties v WHERE v.tenant_id=p.tenant_id
 AND v.page_id=p.page_id AND v.component_key=p.component_key AND v.property_path='/props/stateBindings/value'
);
UPDATE md_lightning_page_nodes SET component_type='Custom:une_input'
WHERE component_type='Custom:une_text';

-- Published and draft layout variants share the same safe transformation.
INSERT INTO md_page_layout_version_properties
 (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
SELECT n.tenant_id,n.page_id,n.variant,n.version,n.component_key,
 '/props/allowTyping','boolean','false'
FROM md_page_layout_version_nodes n WHERE n.component_type='Custom:une_text'
ON CONFLICT DO NOTHING;
UPDATE md_page_layout_version_properties p SET property_path='/props/value'
WHERE p.property_path='/props/text' AND EXISTS (
 SELECT 1 FROM md_page_layout_version_nodes n WHERE n.tenant_id=p.tenant_id
  AND n.page_id=p.page_id AND n.variant=p.variant AND n.version=p.version
  AND n.component_key=p.component_key AND n.component_type='Custom:une_text'
) AND NOT EXISTS (
 SELECT 1 FROM md_page_layout_version_properties v WHERE v.tenant_id=p.tenant_id
  AND v.page_id=p.page_id AND v.variant=p.variant AND v.version=p.version
  AND v.component_key=p.component_key AND v.property_path='/props/value'
);
UPDATE md_page_layout_version_properties p SET property_path='/props/stateBindings/value'
WHERE p.property_path='/props/stateBindings/text' AND EXISTS (
 SELECT 1 FROM md_page_layout_version_nodes n WHERE n.tenant_id=p.tenant_id
  AND n.page_id=p.page_id AND n.variant=p.variant AND n.version=p.version
  AND n.component_key=p.component_key AND n.component_type='Custom:une_text'
) AND NOT EXISTS (
 SELECT 1 FROM md_page_layout_version_properties v WHERE v.tenant_id=p.tenant_id
  AND v.page_id=p.page_id AND v.variant=p.variant AND v.version=p.version
  AND v.component_key=p.component_key AND v.property_path='/props/stateBindings/value'
);
UPDATE md_page_layout_version_nodes SET component_type='Custom:une_input'
WHERE component_type='Custom:une_text';

-- Package templates must also install the new unified component. A historic
-- component/text pair stays display-only without changing its content.
INSERT INTO md_app_package_page_property_templates
 (app_id,version,page_api,component_api,slot,sort_order,property_path,data_type,value_text)
SELECT c.app_id,c.version,c.page_api,'une_input',c.slot,c.sort_order,
 'allowTyping','boolean','false'
FROM md_app_package_page_component_templates c WHERE c.component_api='une_text'
ON CONFLICT DO NOTHING;
UPDATE md_app_package_page_component_templates SET component_api='une_input'
WHERE component_api='une_text';
UPDATE md_app_package_page_property_templates SET component_api='une_input',
 property_path=CASE WHEN property_path='text' THEN 'value' ELSE property_path END
WHERE component_api='une_text';
INSERT INTO md_app_package_resources(app_id,version,resource_type,api_name,parent_api)
SELECT r.app_id,r.version,r.resource_type,'une_input',r.parent_api
FROM md_app_package_resources r
WHERE r.resource_type='Component' AND r.api_name='une_text'
ON CONFLICT DO NOTHING;
DELETE FROM md_app_package_resources
WHERE resource_type='Component' AND api_name='une_text';

-- Foreign-key-backed legacy app placements.
UPDATE md_page_components SET component_api='une_input'
WHERE component_api='une_text';

-- Update exact structured component references, never arbitrary free text.
CREATE FUNCTION md_input_textbox_upgrade(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE k text; v jsonb; result jsonb; is_text boolean; props jsonb;
BEGIN
 IF jsonb_typeof(payload)='array' THEN
   SELECT coalesce(jsonb_agg(md_input_textbox_upgrade(a.value) ORDER BY a.ordinality),'[]'::jsonb)
   INTO result FROM jsonb_array_elements(payload) WITH ORDINALITY a(value,ordinality);
   RETURN result;
 ELSIF jsonb_typeof(payload)='object' THEN
   is_text=(payload->>'type' IN ('Custom:une_text','une_text')
     OR payload->>'componentApiName'='une_text'
     OR payload->>'customComponentApiName'='une_text'
     OR payload->>'libraryComponentId'='une_text');
   result='{}'::jsonb;
   FOR k,v IN SELECT e.key,e.value FROM jsonb_each(payload) e LOOP
     IF k IN ('type','componentApiName','customComponentApiName','libraryComponentId')
       AND v='"une_text"'::jsonb THEN
       v='"une_input"'::jsonb;
     ELSIF k='type' AND v='"Custom:une_text"'::jsonb THEN
       v='"Custom:une_input"'::jsonb;
     ELSE v=md_input_textbox_upgrade(v);
     END IF;
     result=result||jsonb_build_object(k,v);
   END LOOP;
   IF is_text AND jsonb_typeof(result->'props')='object' THEN
     props=result->'props';
     IF props ? 'text' AND NOT props ? 'value' THEN
       props=(props-'text')||jsonb_build_object('value',props->'text');
     END IF;
     IF jsonb_typeof(props->'stateBindings')='object'
       AND (props->'stateBindings') ? 'text'
       AND NOT (props->'stateBindings') ? 'value' THEN
       props=jsonb_set(props,'{stateBindings}',
         ((props->'stateBindings')-'text')||
          jsonb_build_object('value',props->'stateBindings'->'text'));
     END IF;
     IF NOT props ? 'allowTyping' THEN props=props||'{"allowTyping":false}'::jsonb; END IF;
     result=jsonb_set(result,'{props}',props);
   END IF;
   RETURN result;
 END IF;
 RETURN payload;
END
$function$;
UPDATE md_system_definitions SET properties=md_input_textbox_upgrade(properties)
WHERE kind='dashboards' AND properties::text LIKE '%une_text%';
UPDATE md_flow_editor_values
SET value_text=md_input_textbox_upgrade(value_text::jsonb)::text
WHERE value_kind IN ('object','array') AND value_text LIKE '%une_text%';
UPDATE md_flow_editor_values SET value_text='une_input'
WHERE value_kind='string' AND value_text='une_text'
 AND property_path ~ '(^|/)(componentApiName|customComponentApiName|libraryComponentId)$';
UPDATE md_flow_node_properties SET value_text='une_input'
WHERE value_text='une_text'
 AND api_name IN ('componentApiName','customComponentApiName','libraryComponentId');
UPDATE md_object_actions SET component_api_name='une_input'
WHERE component_api_name='une_text';
UPDATE md_global_quick_actions SET component_api_name='une_input'
WHERE component_api_name='une_text';
DROP FUNCTION md_input_textbox_upgrade(jsonb);

-- Retain historic registration rows for foreign keys and safe rollback, but
-- remove the retired platform component from all active component libraries.
UPDATE md_component_definitions d SET enabled=false
WHERE d.api_name='une_text' AND d.renderer_key='one-bundled:une_text'
 AND NOT EXISTS(SELECT 1 FROM md_component_library_heads h
  WHERE h.tenant_id=d.tenant_id AND h.component_api=d.api_name);
-- END ORIGINAL MIGRATION 20270117-unify-text-input-components.sql

-- BEGIN ORIGINAL MIGRATION 20270118-object-schema-lifecycle.sql
-- 2A: reversible object definition lifecycle; keep all existing schema and records.
-- Retaining the row reserves its API name and keeps dependent FK identities stable.
ALTER TABLE md_object_definitions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS md_object_definitions_deleted
 ON md_object_definitions(tenant_id,deleted_at DESC)
 WHERE deleted_at IS NOT NULL;

-- Preserve enabled/disabled choices of generated View/Edit Record pages over restore.
CREATE TABLE IF NOT EXISTS md_object_lifecycle_page_states(
 tenant_id uuid NOT NULL,
 object_api text NOT NULL,
 page_id uuid NOT NULL,
 enabled boolean NOT NULL,
 PRIMARY KEY(tenant_id,object_api,page_id),
 FOREIGN KEY(tenant_id,object_api) REFERENCES md_object_definitions(tenant_id,api_name) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,page_id) REFERENCES md_page_definitions(tenant_id,id) ON DELETE CASCADE
);

-- A stale record editor or direct API cannot insert into a deleted definition.
-- The row lock serializes with ObjectSchemaLifecycle.delete's FOR UPDATE lock.
CREATE OR REPLACE FUNCTION md_require_live_object_for_record_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM md_object_definitions
  WHERE tenant_id=NEW.tenant_id AND api_name=NEW.object_api
    AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Object is unavailable for record creation: %', NEW.object_api
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS md_guard_deleted_object_insert ON md_records;
CREATE TRIGGER md_guard_deleted_object_insert
 BEFORE INSERT ON md_records
 FOR EACH ROW EXECUTE FUNCTION md_require_live_object_for_record_insert();
-- END ORIGINAL MIGRATION 20270118-object-schema-lifecycle.sql

-- BEGIN ORIGINAL MIGRATION 20270118-retire-une-badge.sql
-- Retire the system UNE Badge everywhere without deleting customer-authored
-- components that happen to share an API name with a different renderer.
-- Acetill's two badge headers are removed. Other saved system Badge instances
-- become display-only UNE Input so their content, layouts and bindings survive.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'une_input','one-bundled:une_input',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;

-- Remove the two Acetill badges from live and versioned Page Builder pages.
DELETE FROM md_lightning_page_nodes n USING md_page_definitions p,
 md_component_definitions d
WHERE n.tenant_id=p.tenant_id AND n.page_id=p.id
 AND p.api_name IN ('AcetillRegister','AcetillReceipt')
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge')
 AND d.tenant_id=n.tenant_id AND d.api_name='une_badge'
 AND d.renderer_key='one-bundled:une_badge';
DELETE FROM md_page_layout_version_nodes n USING md_page_definitions p,
 md_component_definitions d
WHERE n.tenant_id=p.tenant_id AND n.page_id=p.id
 AND p.api_name IN ('AcetillRegister','AcetillReceipt')
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge')
 AND d.tenant_id=n.tenant_id AND d.api_name='une_badge'
 AND d.renderer_key='one-bundled:une_badge';

-- Acetill legacy package pages use md_page_components. Drop dependent seed
-- bookkeeping first; md_page_component_properties cascade with each instance.
DELETE FROM md_app_seed_pages sp USING md_page_components c,md_page_definitions p,
 md_component_definitions d
WHERE sp.tenant_id=c.tenant_id AND sp.component_id=c.id
 AND p.tenant_id=c.tenant_id AND p.id=c.page_id
 AND p.api_name IN ('AcetillRegister','AcetillReceipt')
 AND c.component_api IN ('une_badge','OneBadge')
 AND d.tenant_id=c.tenant_id AND d.api_name=c.component_api
 AND d.renderer_key='one-bundled:'||c.component_api;
DELETE FROM md_page_components c USING md_page_definitions p,md_component_definitions d
WHERE p.tenant_id=c.tenant_id AND p.id=c.page_id
 AND p.api_name IN ('AcetillRegister','AcetillReceipt')
 AND c.component_api IN ('une_badge','OneBadge')
 AND d.tenant_id=c.tenant_id AND d.api_name=c.component_api
 AND d.renderer_key='one-bundled:'||c.component_api;

-- Other page instances preserve their identifiers, geometry, labels and bindings.
INSERT INTO md_lightning_page_node_properties
 (tenant_id,page_id,component_key,property_path,value_kind,value_text)
SELECT n.tenant_id,n.page_id,n.component_key,'/props/allowTyping','boolean','false'
FROM md_lightning_page_nodes n
JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
 AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
WHERE n.component_type IN ('Custom:une_badge','Custom:OneBadge')
ON CONFLICT DO NOTHING;
UPDATE md_lightning_page_node_properties p SET property_path='/props/value'
WHERE p.property_path='/props/text'
 AND EXISTS (SELECT 1 FROM md_lightning_page_nodes n
 JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
  AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
 WHERE n.tenant_id=p.tenant_id AND n.page_id=p.page_id
 AND n.component_key=p.component_key
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge'))
 AND NOT EXISTS (SELECT 1 FROM md_lightning_page_node_properties v
 WHERE v.tenant_id=p.tenant_id AND v.page_id=p.page_id
 AND v.component_key=p.component_key AND v.property_path='/props/value');
UPDATE md_lightning_page_node_properties p SET property_path='/props/stateBindings/value'
WHERE p.property_path='/props/stateBindings/text'
 AND EXISTS (SELECT 1 FROM md_lightning_page_nodes n
 JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
  AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
 WHERE n.tenant_id=p.tenant_id AND n.page_id=p.page_id
 AND n.component_key=p.component_key
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge'))
 AND NOT EXISTS (SELECT 1 FROM md_lightning_page_node_properties v
 WHERE v.tenant_id=p.tenant_id AND v.page_id=p.page_id
 AND v.component_key=p.component_key AND v.property_path='/props/stateBindings/value');
UPDATE md_lightning_page_nodes n SET component_type='Custom:une_input'
FROM md_component_definitions d
WHERE d.tenant_id=n.tenant_id AND d.api_name='une_badge'
 AND d.renderer_key='one-bundled:une_badge'
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge');

INSERT INTO md_page_layout_version_properties
 (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
SELECT n.tenant_id,n.page_id,n.variant,n.version,n.component_key,
 '/props/allowTyping','boolean','false'
FROM md_page_layout_version_nodes n
JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
 AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
WHERE n.component_type IN ('Custom:une_badge','Custom:OneBadge')
ON CONFLICT DO NOTHING;
UPDATE md_page_layout_version_properties p SET property_path='/props/value'
WHERE p.property_path='/props/text'
 AND EXISTS (SELECT 1 FROM md_page_layout_version_nodes n
 JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
  AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
 WHERE n.tenant_id=p.tenant_id AND n.page_id=p.page_id
 AND n.variant=p.variant AND n.version=p.version AND n.component_key=p.component_key
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge'))
 AND NOT EXISTS (SELECT 1 FROM md_page_layout_version_properties v
 WHERE v.tenant_id=p.tenant_id AND v.page_id=p.page_id
 AND v.variant=p.variant AND v.version=p.version
 AND v.component_key=p.component_key AND v.property_path='/props/value');
UPDATE md_page_layout_version_properties p SET property_path='/props/stateBindings/value'
WHERE p.property_path='/props/stateBindings/text'
 AND EXISTS (SELECT 1 FROM md_page_layout_version_nodes n
 JOIN md_component_definitions d ON d.tenant_id=n.tenant_id
  AND d.api_name='une_badge' AND d.renderer_key='one-bundled:une_badge'
 WHERE n.tenant_id=p.tenant_id AND n.page_id=p.page_id
 AND n.variant=p.variant AND n.version=p.version AND n.component_key=p.component_key
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge'))
 AND NOT EXISTS (SELECT 1 FROM md_page_layout_version_properties v
 WHERE v.tenant_id=p.tenant_id AND v.page_id=p.page_id
 AND v.variant=p.variant AND v.version=p.version
 AND v.component_key=p.component_key AND v.property_path='/props/stateBindings/value');
UPDATE md_page_layout_version_nodes n SET component_type='Custom:une_input'
FROM md_component_definitions d
WHERE d.tenant_id=n.tenant_id AND d.api_name='une_badge'
 AND d.renderer_key='one-bundled:une_badge'
 AND n.component_type IN ('Custom:une_badge','Custom:OneBadge');

-- Older package component properties have the same text/value contract.
INSERT INTO md_page_component_properties(tenant_id,component_id,property_path,value_text,data_type)
SELECT c.tenant_id,c.id,'allowTyping','false','boolean'
FROM md_page_components c
JOIN md_component_definitions d ON d.tenant_id=c.tenant_id
 AND d.api_name=c.component_api AND d.renderer_key='one-bundled:'||c.component_api
WHERE c.component_api IN ('une_badge','OneBadge')
ON CONFLICT DO NOTHING;
UPDATE md_page_component_properties p SET property_path='value'
WHERE p.property_path='text'
 AND EXISTS (SELECT 1 FROM md_page_components c
 JOIN md_component_definitions d ON d.tenant_id=c.tenant_id
  AND d.api_name=c.component_api AND d.renderer_key='one-bundled:'||c.component_api
 WHERE c.tenant_id=p.tenant_id AND c.id=p.component_id
 AND c.component_api IN ('une_badge','OneBadge'))
 AND NOT EXISTS (SELECT 1 FROM md_page_component_properties v
 WHERE v.tenant_id=p.tenant_id AND v.component_id=p.component_id
 AND v.property_path='value');
UPDATE md_page_components c SET component_api='une_input'
FROM md_component_definitions d
WHERE d.tenant_id=c.tenant_id AND d.api_name=c.component_api
 AND d.renderer_key='one-bundled:'||c.component_api
 AND c.component_api IN ('une_badge','OneBadge');

-- Remove Badge from every published Acetill package version and installation
-- template. Keep unrelated tenant-specific custom component registrations.
DELETE FROM md_app_package_page_property_templates
WHERE component_api='une_badge';
DELETE FROM md_app_package_page_component_templates
WHERE component_api='une_badge';
DELETE FROM md_app_package_resources
WHERE resource_type='Component' AND api_name='une_badge';
DELETE FROM md_app_package_component_templates
WHERE api_name='une_badge' AND renderer_key='one-bundled:une_badge';

-- Exact metadata references in Flow and quick actions remain operational as
-- display-only Input instead of pointing to a deleted renderer.
UPDATE md_flow_editor_values SET value_text='une_input'
WHERE value_kind='string' AND value_text='une_badge'
 AND property_path ~ '(^|/)(componentApiName|customComponentApiName|libraryComponentId)$';
UPDATE md_flow_node_properties SET value_text='une_input'
WHERE value_text='une_badge'
 AND api_name IN ('componentApiName','customComponentApiName','libraryComponentId');
UPDATE md_object_actions SET component_api_name='une_input'
WHERE component_api_name='une_badge';
UPDATE md_global_quick_actions SET component_api_name='une_input'
WHERE component_api_name='une_badge';

-- Explicitly retire platform-owned registrations; never delete a customer's
-- independently authored renderer or its component versions.
UPDATE md_component_definitions SET enabled=false
WHERE api_name='une_badge' AND renderer_key='one-bundled:une_badge';
-- END ORIGINAL MIGRATION 20270118-retire-une-badge.sql

-- BEGIN ORIGINAL MIGRATION 20270119-field-external-id-lookups.sql
-- Phase 2B: External IDs may repeat unless explicitly marked Unique.
-- Both exact and case-insensitive upsert paths retain bounded, tenant-scoped index probes.
CREATE INDEX IF NOT EXISTS md_record_values_lookup_ci
 ON md_record_values(tenant_id,object_api,field_api,lower(value_text))
 WHERE value_text IS NOT NULL AND record_is_deleted=false;
CREATE INDEX IF NOT EXISTS md_record_values_lookup_cs
 ON md_record_values(tenant_id,object_api,field_api,value_text)
 WHERE value_text IS NOT NULL AND record_is_deleted=false;
-- END ORIGINAL MIGRATION 20270119-field-external-id-lookups.sql

-- BEGIN ORIGINAL MIGRATION 20270119-retire-card-grid-properties.sql
-- Retire 16 Card Grid property definitions from active SQL contracts only.
-- Older version snapshots and authored page instance values remain untouched.
-- Preserve tenant-authored non-bundled component definitions.
DO $migration$
DECLARE
 active_row record;
 old_idx integer;
 next_idx integer;
 retired_keys text[] := ARRAY[
  'accentColor','tone','descriptionExpression','emptyText','showDescription',
  'valueTextAlign','missingImageBehavior','showAddIcon','showHeading',
  'badgeExpression','cartTargetKey','currencyCode','headingExpression',
  'separateAddButton','valueColor','valueLineLimit'
 ];
BEGIN
 IF to_regclass('md_component_library_contract_properties') IS NULL
    OR to_regclass('md_component_library_heads') IS NULL THEN RETURN; END IF;
 FOR active_row IN
  SELECT DISTINCT h.tenant_id,h.component_api,ver.version
  FROM md_component_library_heads h
  JOIN md_component_definitions d ON d.tenant_id=h.tenant_id
    AND d.api_name=h.component_api
    AND d.renderer_key='one-bundled:une_item_grid'
  CROSS JOIN LATERAL (VALUES (h.current_version),(h.published_version)) AS ver(version)
  WHERE h.component_api='une_item_grid' AND ver.version IS NOT NULL
 LOOP
  -- Delete whole entries, not just their /propertyKey field.
  DELETE FROM md_component_library_contract_properties p
  USING (
    SELECT DISTINCT substring(property_path FROM '^/propertyDefinitions/([0-9]+)/propertyKey$')::integer AS idx
    FROM md_component_library_contract_properties
    WHERE tenant_id=active_row.tenant_id
      AND component_api=active_row.component_api
      AND version=active_row.version
      AND property_path ~ '^/propertyDefinitions/[0-9]+/propertyKey$'
      AND value_kind='string' AND value_text=ANY(retired_keys)
  ) removed
  WHERE p.tenant_id=active_row.tenant_id
    AND p.component_api=active_row.component_api
    AND p.version=active_row.version
    AND (p.property_path='/propertyDefinitions/'||removed.idx
      OR p.property_path LIKE ('/propertyDefinitions/'||removed.idx||'/%'));
  -- Encode arrays with sequential zero-based indices. Move through a distinct
  -- namespace before renumbering so the relational primary key cannot collide.
  next_idx := 0;
  FOR old_idx IN
    SELECT DISTINCT substring(property_path FROM '^/propertyDefinitions/([0-9]+)')::integer
    FROM md_component_library_contract_properties
    WHERE tenant_id=active_row.tenant_id
      AND component_api=active_row.component_api
      AND version=active_row.version
      AND property_path ~ '^/propertyDefinitions/[0-9]+(/|$)'
    ORDER BY 1
  LOOP
    UPDATE md_component_library_contract_properties p
    SET property_path='/__card_grid_reindex__/'||next_idx||
      substring(p.property_path FROM '^/propertyDefinitions/[0-9]+(.*)$')
    WHERE p.tenant_id=active_row.tenant_id
      AND p.component_api=active_row.component_api
      AND p.version=active_row.version
      AND (p.property_path='/propertyDefinitions/'||old_idx
        OR p.property_path LIKE ('/propertyDefinitions/'||old_idx||'/%'));
    next_idx := next_idx+1;
  END LOOP;
  UPDATE md_component_library_contract_properties p
  SET property_path=replace(p.property_path,'/__card_grid_reindex__/','/propertyDefinitions/')
  WHERE p.tenant_id=active_row.tenant_id
    AND p.component_api=active_row.component_api
    AND p.version=active_row.version
    AND p.property_path LIKE '/__card_grid_reindex__/%';
 END LOOP;
END $migration$;
-- END ORIGINAL MIGRATION 20270119-retire-card-grid-properties.sql

-- BEGIN ORIGINAL MIGRATION 20270120-relationship-target-integrity.sql
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
-- END ORIGINAL MIGRATION 20270120-relationship-target-integrity.sql

-- BEGIN ORIGINAL MIGRATION 20270120-remove-une-sql-property-inventory.sql
-- UNE components are app-owned renderers. Their SQL registry identities remain
-- available so saved pages and flows continue to resolve the same component.
-- Only the metadata property inventory is retired. Do not delete pages,
-- component registrations, authored instance values, tenant objects or flows.
DELETE FROM md_component_library_contract_properties
 WHERE left(component_api,4)='une_';
-- END ORIGINAL MIGRATION 20270120-remove-une-sql-property-inventory.sql

-- BEGIN ORIGINAL MIGRATION 20270121-enable-new-une-builder-components.sql
-- Source-owned UNE builder components: enable trusted renderers, not property inventory.
INSERT INTO md_component_definitions (tenant_id,api_name,renderer_key,enabled)
SELECT t.id,v.api_name,'one-bundled:'||v.api_name,true
FROM md_tenants t CROSS JOIN (VALUES
 ('une_button'),('une_toggle'),('une_lookup'),('une_tabs'),('une_input'),
 ('une_item_grid'),('une_image')
) AS v(api_name)
ON CONFLICT (tenant_id,api_name) DO UPDATE SET enabled=true
WHERE md_component_definitions.renderer_key=EXCLUDED.renderer_key;
-- Idempotently clear old SQL property contracts; retain all published pages, flows and instance values.
DELETE FROM md_component_library_contract_properties WHERE left(component_api,4)='une_';
-- END ORIGINAL MIGRATION 20270121-enable-new-une-builder-components.sql

-- BEGIN ORIGINAL MIGRATION 20270122-global-shared-builder-ribbon.sql
-- ONE global shared Page Builder ribbon property inventory.
-- Property definitions are NOT per-component, NOT versioned component contracts,
-- and NOT saved component instance values. Rule rows only control applicability.
-- Add a future property once here; it is disabled for every component without a rule.
-- Add a future component once to md_builder_ribbon_components; it sees all slots disabled
-- until the required rules are explicitly enabled.
CREATE TABLE IF NOT EXISTS md_builder_ribbon_components(
 component_api text PRIMARY KEY CHECK(component_api ~ '^[A-Za-z][A-Za-z0-9_]*$')
);
CREATE TABLE IF NOT EXISTS md_builder_shared_properties(
 property_key text PRIMARY KEY CHECK(property_key ~ '^[a-z][A-Za-z0-9_]*$'),
 label text NOT NULL,
 tab text NOT NULL CHECK(tab IN ('Home','Data','Design','Layout')),
 section_group text NOT NULL,
 control_kind text NOT NULL CHECK(control_kind IN
   ('color','shadow','expression','align','number','position','boolean','choice','object','weekdays','command','readonly')),
 sort_order integer NOT NULL UNIQUE,
 default_value jsonb,
 min_value integer,
 max_value integer,
 field_select boolean NOT NULL DEFAULT false,
 choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(choices)='array'),
 scope text NOT NULL DEFAULT 'component' CHECK(scope IN ('component','page'))
);
CREATE TABLE IF NOT EXISTS md_builder_ribbon_component_rules(
 component_api text NOT NULL REFERENCES md_builder_ribbon_components(component_api) ON DELETE CASCADE,
 property_key text NOT NULL REFERENCES md_builder_shared_properties(property_key) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 control_kind_override text CHECK(control_kind_override IN
   ('color','shadow','expression','align','number','position','boolean','choice','object','weekdays')),
 value_key text,
 default_value_override jsonb,
 choices_override jsonb CHECK(choices_override IS NULL OR jsonb_typeof(choices_override)='array'),
 PRIMARY KEY(component_api,property_key)
);
INSERT INTO md_builder_ribbon_components(component_api) VALUES
 ('une_button'),
 ('une_toggle'),
 ('une_lookup'),
 ('une_tabs'),
 ('une_input'),
 ('une_item_grid'),
 ('une_image'),
 ('une_calendar'),
 ('une_navigation'),
 ('une_container')
ON CONFLICT(component_api) DO NOTHING;
INSERT INTO md_builder_shared_properties(
 property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
VALUES
 ('backgroundColor','Body Color','Design','Body','color',1,NULL,'[]'::jsonb,'component'),
 ('borderColor','Border color','Design','Body','color',2,NULL,'[]'::jsonb,'component'),
 ('shadow','Shadow','Design','Body','shadow',3,NULL,'[]'::jsonb,'component'),
 ('label','Label','Design','Typography','expression',4,NULL,'[]'::jsonb,'component'),
 ('labelAlignment','Label Alignment','Design','Typography','align',5,NULL,'[]'::jsonb,'component'),
 ('labelColor','Label Color','Design','Body','color',6,NULL,'[]'::jsonb,'component'),
 ('defaultValueColor','Default Value Color','Design','Typography','color',7,NULL,'[]'::jsonb,'component'),
 ('radius','Corner Radius','Design','Body','number',8,'12'::jsonb,'[]'::jsonb,'component'),
 ('textSize','Text Size','Design','Typography','number',9,'16'::jsonb,'[]'::jsonb,'component'),
 ('placeholderSize','Placeholder Size','Design','Typography','number',10,'14'::jsonb,'[]'::jsonb,'component'),
 ('width','Width','Layout','Size','position',11,NULL,'[]'::jsonb,'component'),
 ('height','Height','Layout','Size','position',12,NULL,'[]'::jsonb,'component'),
 ('x','X Position','Layout','Position','position',13,NULL,'[]'::jsonb,'component'),
 ('y','Y Position','Layout','Position','position',14,NULL,'[]'::jsonb,'component'),
 ('defaultValue','Default Value','Design','Default','expression',15,NULL,'[]'::jsonb,'component'),
 ('tabHeight','Tab Height','Design','Tabs','number',16,'44'::jsonb,'[]'::jsonb,'component'),
 ('tabWidth','Tab Width','Design','Tabs','number',17,'120'::jsonb,'[]'::jsonb,'component'),
 ('tabCount','No of tabs','Design','Tabs','number',18,'3'::jsonb,'[]'::jsonb,'component'),
 ('selectedTabColor','Selected Tab color','Design','Tabs','color',19,NULL,'[]'::jsonb,'component'),
 ('tabColor','Tab Color','Design','Tabs','color',20,NULL,'[]'::jsonb,'component'),
 ('cardsPerRow','No of Cards in row','Layout','Cards','number',21,'3'::jsonb,'[]'::jsonb,'component'),
 ('cardsPerColumn','No of card in column','Layout','Cards','number',22,'1'::jsonb,'[]'::jsonb,'component'),
 ('imageHeight','Image Height','Design','Image','number',23,'220'::jsonb,'[]'::jsonb,'component'),
 ('headerBoxHeight','Header Box Height','Design','Header','number',24,'44'::jsonb,'[]'::jsonb,'component'),
 ('wrapText','Wrap Text','Design','Header','boolean',25,'true'::jsonb,'[]'::jsonb,'component'),
 ('imagePlacement','Image Placement','Design','Cards','choice',26,NULL,'["top","left","right","bottom"]'::jsonb,'component'),
 ('imageBorderColor','Image Border','Design','Image','color',27,NULL,'[]'::jsonb,'component'),
 ('headerBorderColor','Header Border','Design','Header','color',28,NULL,'[]'::jsonb,'component'),
 ('headerAlignment','Header Alignment','Design','Header','align',29,NULL,'[]'::jsonb,'component'),
 ('headerBold','Bold','Layout','Header','boolean',30,'true'::jsonb,'[]'::jsonb,'component'),
 ('objectApiName','Object','Data','Source','object',31,NULL,'[]'::jsonb,'component'),
 ('imageSource','Image Source','Data','Source','expression',32,NULL,'[]'::jsonb,'component'),
 ('textSource','Text Source','Data','Source','expression',33,NULL,'[]'::jsonb,'component'),
 ('badgeText','Badge Text','Data','Source','expression',34,NULL,'[]'::jsonb,'component'),
 ('badgeAlignment','Badge Alignment','Design','Badge','choice',35,NULL,'["image-top-left","image-top-center","image-top-right","image-center","image-bottom-left","image-bottom-center","image-bottom-right","text-left","text-center","text-right","text-bottom"]'::jsonb,'component'),
 ('badgeTextSize','Badge Text Size','Design','Badge','number',36,'12'::jsonb,'[]'::jsonb,'component'),
 ('badgeBold','Badge Bold','Design','Badge','boolean',37,'true'::jsonb,'[]'::jsonb,'component'),
 ('badgeTextColor','Badge Text Color','Design','Badge','color',38,NULL,'[]'::jsonb,'component'),
 ('badgeVisible','Badge visible','Design','Badge','boolean',39,'false'::jsonb,'[]'::jsonb,'component'),
 ('showDays','Show Days','Layout','Calendar','weekdays',40,'["sun","mon","tue","wed","thu","fri","sat"]'::jsonb,'[]'::jsonb,'component'),
 ('firstDay','First Day','Layout','Calendar','choice',41,'"mon"'::jsonb,'["sun","mon","tue","wed","thu","fri","sat"]'::jsonb,'component'),
 ('navigationDirection','Horizontal/vertical','Layout','Navigation','choice',42,'"horizontal"'::jsonb,'["horizontal","vertical"]'::jsonb,'component'),
 ('imageFill','Image Fill','Design','Image','choice',43,'"fill"'::jsonb,'["fill","fit","stretch"]'::jsonb,'component'),
 ('backIcon','Back Icon','Home','Back','command',44,NULL,'[]'::jsonb,'page'),
 ('pageName','Page Name','Home','Page','readonly',45,NULL,'[]'::jsonb,'page'),
 ('deviceLayout','Layout','Home','Device','choice',46,NULL,'[]'::jsonb,'page'),
 ('canvasMode','Mode','Home','Canvas','choice',47,NULL,'[]'::jsonb,'page'),
 ('canvasWidth','Width','Home','Canvas','number',48,NULL,'[]'::jsonb,'page'),
 ('canvasHeight','Height','Home','Canvas','number',49,NULL,'[]'::jsonb,'page'),
 ('selectVersion','Select Version','Home','Version','choice',50,NULL,'[]'::jsonb,'page'),
 ('resetIcon','Reset Icon','Home','Reset Component','command',51,NULL,'[]'::jsonb,'page'),
 ('cut','Cut','Home','Quick Access','command',52,NULL,'[]'::jsonb,'page'),
 ('copy','Copy','Home','Quick Access','command',53,NULL,'[]'::jsonb,'page'),
 ('paste','Paste','Home','Quick Access','command',54,NULL,'[]'::jsonb,'page'),
 ('undo','Undo','Home','Quick Access','command',55,NULL,'[]'::jsonb,'page'),
 ('redo','Redo','Home','Quick Access','command',56,NULL,'[]'::jsonb,'page'),
 ('save','Save','Home','Quick Access','command',57,NULL,'[]'::jsonb,'page'),
 ('activate','Activate','Home','Quick Access','command',58,NULL,'[]'::jsonb,'page')
ON CONFLICT(property_key) DO NOTHING;
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='textSize';
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='tabHeight';
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='tabWidth';
UPDATE md_builder_shared_properties SET min_value=1,max_value=30 WHERE property_key='tabCount';
UPDATE md_builder_shared_properties SET min_value=1,max_value=12 WHERE property_key='cardsPerRow';
UPDATE md_builder_shared_properties SET min_value=1,max_value=12 WHERE property_key='cardsPerColumn';
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='imageHeight';
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='headerBoxHeight';
UPDATE md_builder_shared_properties SET field_select=true WHERE property_key='imageSource';
UPDATE md_builder_shared_properties SET field_select=true WHERE property_key='textSource';
UPDATE md_builder_shared_properties SET field_select=true WHERE property_key='badgeText';
UPDATE md_builder_shared_properties SET min_value=0 WHERE property_key='badgeTextSize';
-- Rules do not duplicate property definitions; they link an existing component
-- to one global property and may override its control presentation where Excel requires.
INSERT INTO md_builder_ribbon_component_rules(
 component_api,property_key,enabled,control_kind_override,value_key,
 default_value_override,choices_override)
VALUES
 ('une_button','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_toggle','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_lookup','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_tabs','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_input','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_calendar','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_navigation','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_container','backgroundColor',true,NULL,NULL,NULL,NULL),
 ('une_button','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_toggle','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_lookup','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_tabs','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_input','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_image','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_calendar','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_navigation','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_container','borderColor',true,NULL,NULL,NULL,NULL),
 ('une_button','shadow',true,NULL,NULL,NULL,NULL),
 ('une_toggle','shadow',true,NULL,NULL,NULL,NULL),
 ('une_lookup','shadow',true,NULL,NULL,NULL,NULL),
 ('une_tabs','shadow',true,NULL,NULL,NULL,NULL),
 ('une_input','shadow',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','shadow',true,NULL,NULL,NULL,NULL),
 ('une_image','shadow',true,NULL,NULL,NULL,NULL),
 ('une_calendar','shadow',true,'color','calendarShadowColor',NULL,NULL),
 ('une_navigation','shadow',true,NULL,NULL,NULL,NULL),
 ('une_container','shadow',true,NULL,NULL,NULL,NULL),
 ('une_button','label',true,NULL,NULL,NULL,NULL),
 ('une_toggle','label',true,NULL,NULL,NULL,NULL),
 ('une_lookup','label',true,NULL,NULL,NULL,NULL),
 ('une_tabs','label',true,NULL,NULL,NULL,NULL),
 ('une_input','label',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','label',true,NULL,NULL,NULL,NULL),
 ('une_calendar','label',true,NULL,NULL,NULL,NULL),
 ('une_container','label',true,NULL,NULL,NULL,NULL),
 ('une_button','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_toggle','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_lookup','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_tabs','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_input','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_calendar','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_container','labelAlignment',true,NULL,NULL,NULL,NULL),
 ('une_button','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_toggle','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_lookup','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_tabs','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_input','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_calendar','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_navigation','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_container','labelColor',true,NULL,NULL,NULL,NULL),
 ('une_lookup','defaultValueColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','defaultValueColor',true,NULL,NULL,NULL,NULL),
 ('une_calendar','defaultValueColor',true,NULL,NULL,NULL,NULL),
 ('une_button','radius',true,NULL,NULL,NULL,NULL),
 ('une_toggle','radius',true,NULL,NULL,NULL,NULL),
 ('une_lookup','radius',true,NULL,NULL,NULL,NULL),
 ('une_tabs','radius',true,NULL,NULL,NULL,NULL),
 ('une_input','radius',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','radius',true,NULL,NULL,NULL,NULL),
 ('une_image','radius',true,NULL,NULL,NULL,NULL),
 ('une_calendar','radius',true,NULL,NULL,NULL,NULL),
 ('une_navigation','radius',true,NULL,NULL,NULL,NULL),
 ('une_container','radius',true,NULL,NULL,NULL,NULL),
 ('une_button','textSize',true,NULL,NULL,NULL,NULL),
 ('une_toggle','textSize',true,NULL,NULL,NULL,NULL),
 ('une_lookup','textSize',true,NULL,NULL,NULL,NULL),
 ('une_tabs','textSize',true,NULL,NULL,NULL,NULL),
 ('une_input','textSize',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','textSize',true,NULL,NULL,NULL,NULL),
 ('une_calendar','textSize',true,NULL,NULL,NULL,NULL),
 ('une_navigation','textSize',true,NULL,NULL,NULL,NULL),
 ('une_container','textSize',true,NULL,NULL,NULL,NULL),
 ('une_lookup','placeholderSize',true,NULL,NULL,NULL,NULL),
 ('une_button','width',true,NULL,NULL,NULL,NULL),
 ('une_toggle','width',true,NULL,NULL,NULL,NULL),
 ('une_lookup','width',true,NULL,NULL,NULL,NULL),
 ('une_tabs','width',true,NULL,NULL,NULL,NULL),
 ('une_input','width',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','width',true,NULL,NULL,NULL,NULL),
 ('une_image','width',true,NULL,NULL,NULL,NULL),
 ('une_calendar','width',true,NULL,NULL,NULL,NULL),
 ('une_navigation','width',true,NULL,NULL,NULL,NULL),
 ('une_container','width',true,NULL,NULL,NULL,NULL),
 ('une_button','height',true,NULL,NULL,NULL,NULL),
 ('une_toggle','height',true,NULL,NULL,NULL,NULL),
 ('une_lookup','height',true,NULL,NULL,NULL,NULL),
 ('une_tabs','height',true,NULL,NULL,NULL,NULL),
 ('une_input','height',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','height',true,NULL,NULL,NULL,NULL),
 ('une_image','height',true,NULL,NULL,NULL,NULL),
 ('une_calendar','height',true,NULL,NULL,NULL,NULL),
 ('une_navigation','height',true,NULL,NULL,NULL,NULL),
 ('une_container','height',true,NULL,NULL,NULL,NULL),
 ('une_button','x',true,NULL,NULL,NULL,NULL),
 ('une_toggle','x',true,NULL,NULL,NULL,NULL),
 ('une_lookup','x',true,NULL,NULL,NULL,NULL),
 ('une_tabs','x',true,NULL,NULL,NULL,NULL),
 ('une_input','x',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','x',true,NULL,NULL,NULL,NULL),
 ('une_image','x',true,NULL,NULL,NULL,NULL),
 ('une_calendar','x',true,NULL,NULL,NULL,NULL),
 ('une_navigation','x',true,NULL,NULL,NULL,NULL),
 ('une_container','x',true,NULL,NULL,NULL,NULL),
 ('une_button','y',true,NULL,NULL,NULL,NULL),
 ('une_toggle','y',true,NULL,NULL,NULL,NULL),
 ('une_lookup','y',true,NULL,NULL,NULL,NULL),
 ('une_tabs','y',true,NULL,NULL,NULL,NULL),
 ('une_input','y',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','y',true,NULL,NULL,NULL,NULL),
 ('une_image','y',true,NULL,NULL,NULL,NULL),
 ('une_calendar','y',true,NULL,NULL,NULL,NULL),
 ('une_navigation','y',true,NULL,NULL,NULL,NULL),
 ('une_container','y',true,NULL,NULL,NULL,NULL),
 ('une_toggle','defaultValue',true,NULL,NULL,NULL,NULL),
 ('une_lookup','defaultValue',true,NULL,NULL,NULL,NULL),
 ('une_calendar','defaultValue',true,'choice',NULL,'"today"'::jsonb,'["today"]'::jsonb),
 ('une_tabs','tabHeight',true,NULL,NULL,NULL,NULL),
 ('une_tabs','tabWidth',true,NULL,NULL,NULL,NULL),
 ('une_tabs','tabCount',true,NULL,NULL,NULL,NULL),
 ('une_tabs','selectedTabColor',true,NULL,NULL,NULL,NULL),
 ('une_tabs','tabColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','cardsPerRow',true,NULL,NULL,NULL,NULL),
 ('une_image','cardsPerRow',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','cardsPerColumn',true,NULL,NULL,NULL,NULL),
 ('une_image','cardsPerColumn',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','imageHeight',true,NULL,NULL,NULL,NULL),
 ('une_image','imageHeight',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','headerBoxHeight',true,NULL,NULL,NULL,NULL),
 ('une_image','headerBoxHeight',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','wrapText',true,NULL,NULL,NULL,NULL),
 ('une_image','wrapText',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','imagePlacement',true,NULL,NULL,NULL,NULL),
 ('une_image','imagePlacement',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','imageBorderColor',true,NULL,NULL,NULL,NULL),
 ('une_image','imageBorderColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','headerBorderColor',true,NULL,NULL,NULL,NULL),
 ('une_image','headerBorderColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','headerAlignment',true,NULL,NULL,NULL,NULL),
 ('une_image','headerAlignment',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','headerBold',true,NULL,NULL,NULL,NULL),
 ('une_image','headerBold',true,NULL,NULL,NULL,NULL),
 ('une_toggle','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_lookup','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_tabs','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_input','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_image','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_navigation','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_container','objectApiName',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','imageSource',true,NULL,NULL,NULL,NULL),
 ('une_image','imageSource',true,NULL,NULL,NULL,NULL),
 ('une_container','imageSource',true,NULL,NULL,NULL,NULL),
 ('une_lookup','textSource',true,NULL,NULL,NULL,NULL),
 ('une_tabs','textSource',true,NULL,NULL,NULL,NULL),
 ('une_input','textSource',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','textSource',true,NULL,NULL,NULL,NULL),
 ('une_image','textSource',true,NULL,NULL,NULL,NULL),
 ('une_navigation','textSource',true,NULL,NULL,NULL,NULL),
 ('une_container','textSource',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeText',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeText',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeText',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeAlignment',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeAlignment',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeAlignment',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeTextSize',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeTextSize',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeTextSize',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeBold',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeBold',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeBold',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeTextColor',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeTextColor',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeTextColor',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','badgeVisible',true,NULL,NULL,NULL,NULL),
 ('une_image','badgeVisible',true,NULL,NULL,NULL,NULL),
 ('une_container','badgeVisible',true,NULL,NULL,NULL,NULL),
 ('une_calendar','showDays',true,NULL,NULL,NULL,NULL),
 ('une_calendar','firstDay',true,NULL,NULL,NULL,NULL),
 ('une_navigation','navigationDirection',true,NULL,NULL,NULL,NULL),
 ('une_item_grid','imageFill',true,NULL,NULL,NULL,NULL),
 ('une_image','imageFill',true,NULL,NULL,NULL,NULL),
 ('une_navigation','imageFill',true,NULL,NULL,NULL,NULL)
ON CONFLICT(component_api,property_key) DO NOTHING;
-- Retired UNE per-component contract rows are not the global library.
-- Page instance properties and published layouts are deliberately untouched.
DELETE FROM md_component_library_contract_properties WHERE left(component_api,4)='une_';
-- END ORIGINAL MIGRATION 20270122-global-shared-builder-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270123-retire-shared-une-ribbon.sql
-- Retire shared UNE ribbon rules without changing the shared Home property list.
-- App-owned and legacy page instances retain their authorised runtime assets.
DELETE FROM md_builder_ribbon_components WHERE component_api ~ '^une_';
DELETE FROM md_component_library_contract_properties
 WHERE component_api ~ '^une_';
-- END ORIGINAL MIGRATION 20270123-retire-shared-une-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270123-ribbon-home-reset-acetill-cart.sql
-- Reset the builder to its existing Home-only shared property inventory.
-- Saved component values, authored page versions and app business data are untouched.
DELETE FROM md_builder_shared_properties WHERE tab <> 'Home';
-- Legacy UNE contract rows are not the retained app-owned runtime values.
DELETE FROM md_component_library_contract_properties WHERE left(component_api,4)='une_';

-- Acetill installs and owns the Cart identity, preserving the old shared renderer
-- for other already-saved pages. Never change the component instance ID or props.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT i.tenant_id,'acetill_cart','one-bundled:acetill_cart',true
FROM md_app_installations i
JOIN md_apps a ON a.id=i.app_id AND a.api_name='Acetill'
ON CONFLICT(tenant_id,api_name) DO NOTHING;

-- Migrate only Acetill's two Cart placements, not other tenant pages.
UPDATE md_page_components c SET component_api='acetill_cart'
FROM md_page_definitions p, md_app_installations i, md_apps a
WHERE c.tenant_id=p.tenant_id AND c.page_id=p.id
  AND i.tenant_id=p.tenant_id AND i.app_id=a.id AND a.api_name='Acetill'
  AND p.api_name IN ('AcetillSale','AcetillCheckout') AND c.component_api='une_cart'
  AND EXISTS(SELECT 1 FROM md_component_definitions d WHERE d.tenant_id=c.tenant_id
    AND d.api_name='acetill_cart' AND d.renderer_key='one-bundled:acetill_cart');

UPDATE md_lightning_page_nodes n SET component_type='Custom:acetill_cart'
FROM md_page_definitions p, md_app_installations i, md_apps a
WHERE n.tenant_id=p.tenant_id AND n.page_id=p.id
  AND i.tenant_id=p.tenant_id AND i.app_id=a.id AND a.api_name='Acetill'
  AND p.api_name IN ('AcetillSale','AcetillCheckout') AND n.component_type='Custom:une_cart'
  AND EXISTS(SELECT 1 FROM md_component_definitions d WHERE d.tenant_id=n.tenant_id
    AND d.api_name='acetill_cart' AND d.renderer_key='one-bundled:acetill_cart');

UPDATE md_page_layout_version_nodes n SET component_type='Custom:acetill_cart'
FROM md_page_definitions p, md_app_installations i, md_apps a
WHERE n.tenant_id=p.tenant_id AND n.page_id=p.id
  AND i.tenant_id=p.tenant_id AND i.app_id=a.id AND a.api_name='Acetill'
  AND p.api_name IN ('AcetillSale','AcetillCheckout') AND n.component_type='Custom:une_cart'
  AND EXISTS(SELECT 1 FROM md_component_definitions d WHERE d.tenant_id=n.tenant_id
    AND d.api_name='acetill_cart' AND d.renderer_key='one-bundled:acetill_cart');
-- END ORIGINAL MIGRATION 20270123-ribbon-home-reset-acetill-cart.sql

-- BEGIN ORIGINAL MIGRATION 20270124-retire-legacy-une-app-tenants.sql
-- Follow-up to PR #131. Exact app-owned references only; no broad string substitutions.
-- The original published layout snapshots and app package versions remain immutable.
-- PostgreSQL migration runner executes each file once with checksum tracking.
CREATE TABLE IF NOT EXISTS md_legacy_une_component_replacements (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 page_id uuid NOT NULL,
 surface text NOT NULL CHECK(surface IN ('page-component','lightning-node')),
 component_key text NOT NULL,
 old_api text NOT NULL,
 new_api text NOT NULL,
 replaced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,page_id,surface,component_key,old_api)
);
-- Register private components for existing INSTALLED and currently ENTITLED apps.
-- Never seize a tenant-owned API identity: ON CONFLICT DO NOTHING, and subsequent
-- changes require the exact matching built-in renderer key.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT DISTINCT i.tenant_id,m.new_api,'one-bundled:'||m.new_api,true
FROM md_app_installations i
JOIN md_apps a ON a.id=i.app_id AND a.tenant_owner_id IS NULL
JOIN md_app_entitlements e ON e.tenant_id=i.tenant_id AND e.app_id=i.app_id
 AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
JOIN (VALUES ('Acetill','une_input','acetill_input'),('Acetill','une_search','acetill_search'),
('Acetill','une_item_grid','acetill_item_grid'),('Acetill','une_button','acetill_button'),
('Acetill','une_cart','acetill_cart'),
('AceAssist','une_input','aceassist_input'),('AceAssist','une_calendar','aceassist_calendar'),
('OneChatter','une_input','onechatter_input'),('OneChatter','une_conversation','onechatter_conversation'),
('UNEAceChatter','une_input','uneacechatter_input'),
('UNEAceChatter','une_conversation','uneacechatter_conversation'),
('UNEAceChatter','une_modal','uneacechatter_modal'),
('UNEAceChatter','une_tabs','uneacechatter_tabs'),
('UNEAceChatter','une_stack','uneacechatter_stack'),
('UNEAceChatter','une_lookup','uneacechatter_lookup'),
('UNEAceChatter','une_button','uneacechatter_button'),
('UNEAceChatter','une_search','uneacechatter_search')) AS m(app_api,old_api,new_api) ON m.app_api=a.api_name
ON CONFLICT(tenant_id,api_name) DO NOTHING;

-- Convert legacy package-based component instances of *owned, seeded* app pages.
-- Keep component IDs, slots, sort order, authored property rows, Flows and receipts.
WITH app_pages(app_api,page_api) AS (VALUES ('Acetill','AcetillRegister'),('Acetill','AcetillSale'),('Acetill','AcetillCheckout'),('Acetill','AcetillReceipt'),
('AceAssist','AceAssist_Calendar'),('OneChatter','OneChatterInbox'),
('UNEAceChatter','UNEAceChatterDesktop'),('UNEAceChatter','UNEAceChatterTablet'),
('UNEAceChatter','UNEAceChatterMobile'),('UNEAceChatter','UNEAceChatterCustom')),
component_map(app_api,old_api,new_api) AS (VALUES ('Acetill','une_input','acetill_input'),('Acetill','une_search','acetill_search'),
('Acetill','une_item_grid','acetill_item_grid'),('Acetill','une_button','acetill_button'),
('Acetill','une_cart','acetill_cart'),
('AceAssist','une_input','aceassist_input'),('AceAssist','une_calendar','aceassist_calendar'),
('OneChatter','une_input','onechatter_input'),('OneChatter','une_conversation','onechatter_conversation'),
('UNEAceChatter','une_input','uneacechatter_input'),
('UNEAceChatter','une_conversation','uneacechatter_conversation'),
('UNEAceChatter','une_modal','uneacechatter_modal'),
('UNEAceChatter','une_tabs','uneacechatter_tabs'),
('UNEAceChatter','une_stack','uneacechatter_stack'),
('UNEAceChatter','une_lookup','uneacechatter_lookup'),
('UNEAceChatter','une_button','uneacechatter_button'),
('UNEAceChatter','une_search','uneacechatter_search')),
eligible AS (
 SELECT p.tenant_id,p.id AS page_id,a.id AS app_id,m.old_api,m.new_api
 FROM md_page_definitions p
 JOIN app_pages ap ON ap.page_api=p.api_name
 JOIN md_apps a ON a.api_name=ap.app_api AND a.tenant_owner_id IS NULL
 JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=p.tenant_id
 JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=p.tenant_id
    AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
 JOIN component_map m ON m.app_api=ap.app_api
 JOIN md_component_definitions target ON target.tenant_id=p.tenant_id
    AND target.api_name=m.new_api AND target.renderer_key='one-bundled:'||m.new_api
    AND target.enabled=true
 JOIN md_component_definitions legacy ON legacy.tenant_id=p.tenant_id
    AND legacy.api_name=m.old_api AND legacy.renderer_key='one-bundled:'||m.old_api
 WHERE p.enabled=true
),
updated AS (
 UPDATE md_page_components c SET component_api=e.new_api
 FROM eligible e
 WHERE c.tenant_id=e.tenant_id AND c.page_id=e.page_id AND c.component_api=e.old_api
   AND EXISTS (
    SELECT 1 FROM md_app_package_seed_receipts r
    WHERE r.tenant_id=e.tenant_id AND r.app_id=e.app_id
      AND r.resource_type='App Page' AND r.parent_api=''
      AND r.api_name=(SELECT p.api_name FROM md_page_definitions p
        WHERE p.tenant_id=e.tenant_id AND p.id=e.page_id)
   )
 RETURNING c.tenant_id,c.page_id,c.id::text AS component_key,e.old_api,e.new_api
)
INSERT INTO md_legacy_une_component_replacements
  (tenant_id,page_id,surface,component_key,old_api,new_api)
SELECT tenant_id,page_id,'page-component',component_key,old_api,new_api FROM updated
ON CONFLICT DO NOTHING;

-- Convert only untouched, first-revision seeded Lightning app pages.
-- Any independently drafted/published layout version or revision >1 is skipped
-- rather than modifying immutable snapshots or overriding tenant customisation.
WITH app_pages(app_api,page_api) AS (VALUES ('Acetill','AcetillRegister'),('Acetill','AcetillSale'),('Acetill','AcetillCheckout'),('Acetill','AcetillReceipt'),
('AceAssist','AceAssist_Calendar'),('OneChatter','OneChatterInbox'),
('UNEAceChatter','UNEAceChatterDesktop'),('UNEAceChatter','UNEAceChatterTablet'),
('UNEAceChatter','UNEAceChatterMobile'),('UNEAceChatter','UNEAceChatterCustom')),
component_map(app_api,old_api,new_api) AS (VALUES ('Acetill','une_input','acetill_input'),('Acetill','une_search','acetill_search'),
('Acetill','une_item_grid','acetill_item_grid'),('Acetill','une_button','acetill_button'),
('Acetill','une_cart','acetill_cart'),
('AceAssist','une_input','aceassist_input'),('AceAssist','une_calendar','aceassist_calendar'),
('OneChatter','une_input','onechatter_input'),('OneChatter','une_conversation','onechatter_conversation'),
('UNEAceChatter','une_input','uneacechatter_input'),
('UNEAceChatter','une_conversation','uneacechatter_conversation'),
('UNEAceChatter','une_modal','uneacechatter_modal'),
('UNEAceChatter','une_tabs','uneacechatter_tabs'),
('UNEAceChatter','une_stack','uneacechatter_stack'),
('UNEAceChatter','une_lookup','uneacechatter_lookup'),
('UNEAceChatter','une_button','uneacechatter_button'),
('UNEAceChatter','une_search','uneacechatter_search')),
eligible AS (
 SELECT p.tenant_id,p.id AS page_id,a.id AS app_id,m.old_api,m.new_api
 FROM md_page_definitions p
 JOIN app_pages ap ON ap.page_api=p.api_name
 JOIN md_apps a ON a.api_name=ap.app_api AND a.tenant_owner_id IS NULL
 JOIN md_app_installations i ON i.app_id=a.id AND i.tenant_id=p.tenant_id
 JOIN md_app_entitlements e ON e.app_id=a.id AND e.tenant_id=p.tenant_id
    AND e.active=true AND (e.expires_at IS NULL OR e.expires_at>now())
 JOIN component_map m ON m.app_api=ap.app_api
 JOIN md_component_definitions target ON target.tenant_id=p.tenant_id
    AND target.api_name=m.new_api AND target.renderer_key='one-bundled:'||m.new_api
    AND target.enabled=true
 JOIN md_component_definitions legacy ON legacy.tenant_id=p.tenant_id
    AND legacy.api_name=m.old_api AND legacy.renderer_key='one-bundled:'||m.old_api
 WHERE p.enabled=true
),
updated AS (
 UPDATE md_lightning_page_nodes n SET component_type='Custom:'||e.new_api
 FROM eligible e,md_lightning_page_details d
 WHERE n.tenant_id=e.tenant_id AND n.page_id=e.page_id
   AND n.component_type='Custom:'||e.old_api
   AND d.tenant_id=n.tenant_id AND d.page_id=n.page_id
   AND d.page_type='App Page' AND d.revision=1
   AND NOT EXISTS (SELECT 1 FROM md_page_layout_versions v
       WHERE v.tenant_id=n.tenant_id AND v.page_id=n.page_id)
   AND NOT EXISTS (SELECT 1 FROM md_page_layout_audit audit
       WHERE audit.tenant_id=n.tenant_id AND audit.page_id=n.page_id)
   AND EXISTS (SELECT 1 FROM md_lightning_page_activation act
       JOIN md_apps owner_app ON owner_app.id=e.app_id
       WHERE act.tenant_id=n.tenant_id AND act.page_id=n.page_id
         AND act.scope='App Default' AND act.app_api=owner_app.api_name)
 RETURNING n.tenant_id,n.page_id,n.component_key,e.old_api,e.new_api
)
INSERT INTO md_legacy_une_component_replacements
  (tenant_id,page_id,surface,component_key,old_api,new_api)
SELECT tenant_id,page_id,'lightning-node',component_key,old_api,new_api FROM updated
ON CONFLICT DO NOTHING;

-- Legacy registrations remain in SQL for rollback and FK/history safety.
-- Disable only exact system-owned renderers with NO tenant runtime/version,
-- Flow/action, tenant-authored library, or installed old-package dependencies.
-- We cannot safely delete these definitions or their renderer assets while a
-- tenant's immutable published snapshot may still refer to them.
UPDATE md_component_definitions d SET enabled=false
WHERE d.enabled=true AND d.api_name LIKE 'une\_%' ESCAPE '\'
 AND d.renderer_key='one-bundled:'||d.api_name
 AND NOT EXISTS (SELECT 1 FROM md_page_components c
    WHERE c.tenant_id=d.tenant_id AND c.component_api=d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_lightning_page_nodes n
    WHERE n.tenant_id=d.tenant_id AND n.component_type='Custom:'||d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_page_layout_version_nodes n
    WHERE n.tenant_id=d.tenant_id AND n.component_type='Custom:'||d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_component_library_versions v
    WHERE v.tenant_id=d.tenant_id AND v.component_api=d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_component_properties cp
    WHERE cp.tenant_id=d.tenant_id AND cp.component_id=d.id)
 AND NOT EXISTS (SELECT 1 FROM md_metadata_package_components pkg
    WHERE pkg.tenant_id=d.tenant_id AND pkg.component_type='component'
      AND pkg.component_api=d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_dashboard_snapshots snap
    WHERE snap.tenant_id=d.tenant_id
      AND position(d.api_name in snap.content::text)>0)
 -- Conservative on purpose: flattened and structured Flow metadata may both
 -- hold old component IDs; avoid disabling a renderer for either representation.
 AND NOT EXISTS (SELECT 1 FROM md_flow_node_properties f
    WHERE f.tenant_id=d.tenant_id AND position(d.api_name in COALESCE(f.value_text,''))>0)
 AND NOT EXISTS (SELECT 1 FROM md_flow_editor_values f
    WHERE f.tenant_id=d.tenant_id AND position(d.api_name in COALESCE(f.value_text,''))>0)
 AND NOT EXISTS (SELECT 1 FROM md_object_actions a
    WHERE a.tenant_id=d.tenant_id AND a.component_api_name=d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_global_quick_actions a
    WHERE a.tenant_id=d.tenant_id AND a.component_api_name=d.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_system_definitions s
    WHERE s.tenant_id=d.tenant_id AND position(d.api_name in s.properties::text)>0)
 AND NOT EXISTS (
   SELECT 1 FROM md_tenant_app_installed_versions installed
   JOIN md_app_package_component_templates template
     ON template.app_id=installed.app_id AND template.version=installed.version
   WHERE installed.tenant_id=d.tenant_id AND template.api_name=d.api_name
 )
 AND NOT EXISTS (SELECT 1 FROM md_tenant_app_installed_versions installed
   JOIN md_app_package_page_component_templates t
     ON t.app_id=installed.app_id AND t.version=installed.version
   WHERE installed.tenant_id=d.tenant_id AND t.component_api=d.api_name
 );

-- Saved page props, versioned layout nodes and business data have not been deleted.
-- See docs/app-owned-component-retirement-20261029.md for pre/post audit SQL.
-- END ORIGINAL MIGRATION 20270124-retire-legacy-une-app-tenants.sql

-- BEGIN ORIGINAL MIGRATION 20270124-smart-component-library.sql
-- Smart component library: a fresh SQL property matrix, isolated from legacy UNE identities.
-- Home ribbon rows and saved tenant pages are deliberately untouched.
-- This migration is idempotent and upgrade-safe; Rules determine applicability.
INSERT INTO md_builder_shared_properties
(property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
VALUES
('backgroundColor','Body Color','Design','Body','color',1,NULL,'[]'::jsonb,'component'),
('borderColor','Border color','Design','Body','color',2,NULL,'[]'::jsonb,'component'),
('shadow','Shadow','Design','Body','shadow',3,NULL,'[]'::jsonb,'component'),
('label','Label','Design','Typography','expression',4,NULL,'[]'::jsonb,'component'),
('labelAlignment','Label Alignment','Design','Typography','align',5,NULL,'[]'::jsonb,'component'),
('labelColor','Label Color','Design','Body','color',6,NULL,'[]'::jsonb,'component'),
('defaultValueColor','Default Value Color','Design','Typography','color',7,NULL,'[]'::jsonb,'component'),
('radius','Corner Radius','Design','Body','number',8,'12'::jsonb,'[]'::jsonb,'component'),
('textSize','Text Size','Design','Typography','number',9,'16'::jsonb,'[]'::jsonb,'component'),
('placeholderSize','Placeholder Size','Design','Typography','number',10,'14'::jsonb,'[]'::jsonb,'component'),
('width','Width','Layout','Size','position',11,NULL,'[]'::jsonb,'component'),
('height','Height','Layout','Size','position',12,NULL,'[]'::jsonb,'component'),
('x','X Position','Layout','Position','position',13,NULL,'[]'::jsonb,'component'),
('y','Y Position','Layout','Position','position',14,NULL,'[]'::jsonb,'component'),
('defaultValue','Default Value','Design','Default','expression',15,NULL,'[]'::jsonb,'component'),
('tabHeight','Tab Height','Design','Tabs','number',16,'44'::jsonb,'[]'::jsonb,'component'),
('tabWidth','Tab Width','Design','Tabs','number',17,'120'::jsonb,'[]'::jsonb,'component'),
('tabCount','No of tabs','Design','Tabs','number',18,'3'::jsonb,'[]'::jsonb,'component'),
('selectedTabColor','Selected Tab color','Design','Tabs','color',19,NULL,'[]'::jsonb,'component'),
('tabColor','Tab Color','Design','Tabs','color',20,NULL,'[]'::jsonb,'component'),
('cardsPerRow','No of Cards in row','Layout','Cards','number',21,'3'::jsonb,'[]'::jsonb,'component'),
('cardsPerColumn','No of card in column','Layout','Cards','number',22,'1'::jsonb,'[]'::jsonb,'component'),
('imageHeight','Image Height','Design','Image','number',23,'220'::jsonb,'[]'::jsonb,'component'),
('headerBoxHeight','Header Box Height','Design','Header','number',24,'44'::jsonb,'[]'::jsonb,'component'),
('wrapText','Wrap Text','Design','Header','boolean',25,'true'::jsonb,'[]'::jsonb,'component'),
('imagePlacement','Image Placement','Design','Cards','choice',26,NULL,'["top","left","right","bottom"]'::jsonb,'component'),
('imageBorderColor','Image Border','Design','Image','color',27,NULL,'[]'::jsonb,'component'),
('headerBorderColor','Header Border','Design','Header','color',28,NULL,'[]'::jsonb,'component'),
('headerAlignment','Header Alignment','Design','Header','align',29,NULL,'[]'::jsonb,'component'),
('headerBold','Bold','Design','Header','boolean',30,'true'::jsonb,'[]'::jsonb,'component'),
('objectApiName','Object','Data','Source','object',31,NULL,'[]'::jsonb,'component'),
('imageSource','Image Source','Data','Source','expression',32,NULL,'[]'::jsonb,'component'),
('textSource','Text Source','Data','Source','expression',33,NULL,'[]'::jsonb,'component'),
('badgeText','Badge Text','Data','Source','expression',34,NULL,'[]'::jsonb,'component'),
('badgeAlignment','Badge Alignment','Design','Badge','choice',35,NULL,'["image-top-left","image-top-center","image-top-right","image-center","image-bottom-left","image-bottom-center","image-bottom-right","text-left","text-center","text-right","text-bottom"]'::jsonb,'component'),
('badgeTextSize','Badge Text Size','Design','Badge','number',36,'12'::jsonb,'[]'::jsonb,'component'),
('badgeBold','Badge Bold','Design','Badge','boolean',37,'true'::jsonb,'[]'::jsonb,'component'),
('badgeTextColor','Badge Text Color','Design','Badge','color',38,NULL,'[]'::jsonb,'component'),
('badgeVisible','Badge visible','Design','Badge','boolean',39,'false'::jsonb,'[]'::jsonb,'component'),
('showDays','Show Days','Layout','Calendar','weekdays',40,'["sun","mon","tue","wed","thu","fri","sat"]'::jsonb,'[]'::jsonb,'component'),
('firstDay','First Day','Layout','Calendar','choice',41,'"mon"'::jsonb,'["sun","mon","tue","wed","thu","fri","sat"]'::jsonb,'component'),
('navigationDirection','Horizontal/vertical','Layout','Navigation','choice',42,'"horizontal"'::jsonb,'["horizontal","vertical"]'::jsonb,'component'),
('imageFill','Image Fill','Design','Image','choice',43,'"fill"'::jsonb,'["fill","fit","stretch"]'::jsonb,'component')
ON CONFLICT(property_key) DO UPDATE SET
 label=EXCLUDED.label,tab=EXCLUDED.tab,section_group=EXCLUDED.section_group,
 control_kind=EXCLUDED.control_kind,choices=EXCLUDED.choices
 WHERE md_builder_shared_properties.tab <> 'Home';
-- Existing removed UNE builder *rules* must never surface in the new matrix.
DELETE FROM md_builder_ribbon_component_rules WHERE component_api LIKE 'une\_%' ESCAPE '\';
DELETE FROM md_builder_ribbon_components WHERE component_api LIKE 'une\_%' ESCAPE '\';
INSERT INTO md_builder_ribbon_components(component_api) VALUES
 ('smart_button'),
 ('smart_toggle'),
 ('smart_lookup'),
 ('smart_tabs'),
 ('smart_text'),
 ('smart_card_grid'),
 ('smart_image'),
 ('smart_calendar'),
 ('smart_navigation'),
 ('smart_container')
ON CONFLICT DO NOTHING;
INSERT INTO md_builder_ribbon_component_rules
(component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
VALUES
('smart_button','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_toggle','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_lookup','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_tabs','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_text','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_calendar','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_navigation','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_container','backgroundColor',true,NULL,NULL,NULL,NULL),
('smart_button','borderColor',true,NULL,NULL,NULL,NULL),
('smart_toggle','borderColor',true,NULL,NULL,NULL,NULL),
('smart_lookup','borderColor',true,NULL,NULL,NULL,NULL),
('smart_tabs','borderColor',true,NULL,NULL,NULL,NULL),
('smart_text','borderColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','borderColor',true,NULL,NULL,NULL,NULL),
('smart_image','borderColor',true,NULL,NULL,NULL,NULL),
('smart_calendar','borderColor',true,NULL,NULL,NULL,NULL),
('smart_navigation','borderColor',true,NULL,NULL,NULL,NULL),
('smart_container','borderColor',true,NULL,NULL,NULL,NULL),
('smart_button','shadow',true,NULL,NULL,NULL,NULL),
('smart_toggle','shadow',true,NULL,NULL,NULL,NULL),
('smart_lookup','shadow',true,NULL,NULL,NULL,NULL),
('smart_tabs','shadow',true,NULL,NULL,NULL,NULL),
('smart_text','shadow',true,NULL,NULL,NULL,NULL),
('smart_card_grid','shadow',true,NULL,NULL,NULL,NULL),
('smart_image','shadow',true,NULL,NULL,NULL,NULL),
('smart_calendar','shadow',true,'color','calendarShadowColor',NULL,NULL),
('smart_navigation','shadow',true,NULL,NULL,NULL,NULL),
('smart_container','shadow',true,NULL,NULL,NULL,NULL),
('smart_button','label',true,NULL,NULL,NULL,NULL),
('smart_toggle','label',true,NULL,NULL,NULL,NULL),
('smart_lookup','label',true,NULL,NULL,NULL,NULL),
('smart_tabs','label',true,NULL,NULL,NULL,NULL),
('smart_text','label',true,NULL,NULL,NULL,NULL),
('smart_card_grid','label',true,NULL,NULL,NULL,NULL),
('smart_calendar','label',true,NULL,NULL,NULL,NULL),
('smart_container','label',true,NULL,NULL,NULL,NULL),
('smart_button','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_toggle','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_lookup','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_tabs','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_text','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_card_grid','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_calendar','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_container','labelAlignment',true,NULL,NULL,NULL,NULL),
('smart_button','labelColor',true,NULL,NULL,NULL,NULL),
('smart_toggle','labelColor',true,NULL,NULL,NULL,NULL),
('smart_lookup','labelColor',true,NULL,NULL,NULL,NULL),
('smart_tabs','labelColor',true,NULL,NULL,NULL,NULL),
('smart_text','labelColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','labelColor',true,NULL,NULL,NULL,NULL),
('smart_calendar','labelColor',true,NULL,NULL,NULL,NULL),
('smart_navigation','labelColor',true,NULL,NULL,NULL,NULL),
('smart_container','labelColor',true,NULL,NULL,NULL,NULL),
('smart_lookup','defaultValueColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','defaultValueColor',true,NULL,NULL,NULL,NULL),
('smart_calendar','defaultValueColor',true,NULL,NULL,NULL,NULL),
('smart_button','radius',true,NULL,NULL,NULL,NULL),
('smart_toggle','radius',true,NULL,NULL,NULL,NULL),
('smart_lookup','radius',true,NULL,NULL,NULL,NULL),
('smart_tabs','radius',true,NULL,NULL,NULL,NULL),
('smart_text','radius',true,NULL,NULL,NULL,NULL),
('smart_card_grid','radius',true,NULL,NULL,NULL,NULL),
('smart_image','radius',true,NULL,NULL,NULL,NULL),
('smart_calendar','radius',true,NULL,NULL,NULL,NULL),
('smart_navigation','radius',true,NULL,NULL,NULL,NULL),
('smart_container','radius',true,NULL,NULL,NULL,NULL),
('smart_button','textSize',true,NULL,NULL,NULL,NULL),
('smart_toggle','textSize',true,NULL,NULL,NULL,NULL),
('smart_lookup','textSize',true,NULL,NULL,NULL,NULL),
('smart_tabs','textSize',true,NULL,NULL,NULL,NULL),
('smart_text','textSize',true,NULL,NULL,NULL,NULL),
('smart_card_grid','textSize',true,NULL,NULL,NULL,NULL),
('smart_calendar','textSize',true,NULL,NULL,NULL,NULL),
('smart_navigation','textSize',true,NULL,NULL,NULL,NULL),
('smart_container','textSize',true,NULL,NULL,NULL,NULL),
('smart_lookup','placeholderSize',true,NULL,NULL,NULL,NULL),
('smart_button','width',true,NULL,NULL,NULL,NULL),
('smart_toggle','width',true,NULL,NULL,NULL,NULL),
('smart_lookup','width',true,NULL,NULL,NULL,NULL),
('smart_tabs','width',true,NULL,NULL,NULL,NULL),
('smart_text','width',true,NULL,NULL,NULL,NULL),
('smart_card_grid','width',true,NULL,NULL,NULL,NULL),
('smart_image','width',true,NULL,NULL,NULL,NULL),
('smart_calendar','width',true,NULL,NULL,NULL,NULL),
('smart_navigation','width',true,NULL,NULL,NULL,NULL),
('smart_container','width',true,NULL,NULL,NULL,NULL),
('smart_button','height',true,NULL,NULL,NULL,NULL),
('smart_toggle','height',true,NULL,NULL,NULL,NULL),
('smart_lookup','height',true,NULL,NULL,NULL,NULL),
('smart_tabs','height',true,NULL,NULL,NULL,NULL),
('smart_text','height',true,NULL,NULL,NULL,NULL),
('smart_card_grid','height',true,NULL,NULL,NULL,NULL),
('smart_image','height',true,NULL,NULL,NULL,NULL),
('smart_calendar','height',true,NULL,NULL,NULL,NULL),
('smart_navigation','height',true,NULL,NULL,NULL,NULL),
('smart_container','height',true,NULL,NULL,NULL,NULL),
('smart_button','x',true,NULL,NULL,NULL,NULL),
('smart_toggle','x',true,NULL,NULL,NULL,NULL),
('smart_lookup','x',true,NULL,NULL,NULL,NULL),
('smart_tabs','x',true,NULL,NULL,NULL,NULL),
('smart_text','x',true,NULL,NULL,NULL,NULL),
('smart_card_grid','x',true,NULL,NULL,NULL,NULL),
('smart_image','x',true,NULL,NULL,NULL,NULL),
('smart_calendar','x',true,NULL,NULL,NULL,NULL),
('smart_navigation','x',true,NULL,NULL,NULL,NULL),
('smart_container','x',true,NULL,NULL,NULL,NULL),
('smart_button','y',true,NULL,NULL,NULL,NULL),
('smart_toggle','y',true,NULL,NULL,NULL,NULL),
('smart_lookup','y',true,NULL,NULL,NULL,NULL),
('smart_tabs','y',true,NULL,NULL,NULL,NULL),
('smart_text','y',true,NULL,NULL,NULL,NULL),
('smart_card_grid','y',true,NULL,NULL,NULL,NULL),
('smart_image','y',true,NULL,NULL,NULL,NULL),
('smart_calendar','y',true,NULL,NULL,NULL,NULL),
('smart_navigation','y',true,NULL,NULL,NULL,NULL),
('smart_container','y',true,NULL,NULL,NULL,NULL),
('smart_toggle','defaultValue',true,NULL,NULL,NULL,NULL),
('smart_lookup','defaultValue',true,NULL,NULL,NULL,NULL),
('smart_calendar','defaultValue',true,'choice',NULL,'"today"'::jsonb,'["today"]'::jsonb),
('smart_tabs','tabHeight',true,NULL,NULL,NULL,NULL),
('smart_tabs','tabWidth',true,NULL,NULL,NULL,NULL),
('smart_tabs','tabCount',true,NULL,NULL,NULL,NULL),
('smart_tabs','selectedTabColor',true,NULL,NULL,NULL,NULL),
('smart_tabs','tabColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','cardsPerRow',true,NULL,NULL,NULL,NULL),
('smart_card_grid','cardsPerColumn',true,NULL,NULL,NULL,NULL),
('smart_card_grid','imageHeight',true,NULL,NULL,NULL,NULL),
('smart_image','imageHeight',true,NULL,NULL,NULL,NULL),
('smart_card_grid','headerBoxHeight',true,NULL,NULL,NULL,NULL),
('smart_image','headerBoxHeight',true,NULL,NULL,NULL,NULL),
('smart_card_grid','wrapText',true,NULL,NULL,NULL,NULL),
('smart_image','wrapText',true,NULL,NULL,NULL,NULL),
('smart_card_grid','imagePlacement',true,NULL,NULL,NULL,NULL),
('smart_image','imagePlacement',true,NULL,NULL,NULL,NULL),
('smart_card_grid','imageBorderColor',true,NULL,NULL,NULL,NULL),
('smart_image','imageBorderColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','headerBorderColor',true,NULL,NULL,NULL,NULL),
('smart_image','headerBorderColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','headerAlignment',true,NULL,NULL,NULL,NULL),
('smart_image','headerAlignment',true,NULL,NULL,NULL,NULL),
('smart_card_grid','headerBold',true,NULL,NULL,NULL,NULL),
('smart_image','headerBold',true,NULL,NULL,NULL,NULL),
('smart_toggle','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_lookup','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_tabs','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_text','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_card_grid','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_image','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_navigation','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_container','objectApiName',true,NULL,NULL,NULL,NULL),
('smart_card_grid','imageSource',true,NULL,NULL,NULL,NULL),
('smart_image','imageSource',true,NULL,NULL,NULL,NULL),
('smart_container','imageSource',true,NULL,NULL,NULL,NULL),
('smart_lookup','textSource',true,NULL,NULL,NULL,NULL),
('smart_tabs','textSource',true,NULL,NULL,NULL,NULL),
('smart_text','textSource',true,NULL,NULL,NULL,NULL),
('smart_card_grid','textSource',true,NULL,NULL,NULL,NULL),
('smart_image','textSource',true,NULL,NULL,NULL,NULL),
('smart_navigation','textSource',true,NULL,NULL,NULL,NULL),
('smart_container','textSource',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeText',true,NULL,NULL,NULL,NULL),
('smart_image','badgeText',true,NULL,NULL,NULL,NULL),
('smart_container','badgeText',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeAlignment',true,NULL,NULL,NULL,NULL),
('smart_image','badgeAlignment',true,NULL,NULL,NULL,NULL),
('smart_container','badgeAlignment',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeTextSize',true,NULL,NULL,NULL,NULL),
('smart_image','badgeTextSize',true,NULL,NULL,NULL,NULL),
('smart_container','badgeTextSize',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeBold',true,NULL,NULL,NULL,NULL),
('smart_image','badgeBold',true,NULL,NULL,NULL,NULL),
('smart_container','badgeBold',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeTextColor',true,NULL,NULL,NULL,NULL),
('smart_image','badgeTextColor',true,NULL,NULL,NULL,NULL),
('smart_container','badgeTextColor',true,NULL,NULL,NULL,NULL),
('smart_card_grid','badgeVisible',true,NULL,NULL,NULL,NULL),
('smart_image','badgeVisible',true,NULL,NULL,NULL,NULL),
('smart_container','badgeVisible',true,NULL,NULL,NULL,NULL),
('smart_calendar','showDays',true,NULL,NULL,NULL,NULL),
('smart_calendar','firstDay',true,NULL,NULL,NULL,NULL),
('smart_navigation','navigationDirection',true,NULL,NULL,NULL,NULL),
('smart_card_grid','imageFill',true,NULL,NULL,NULL,NULL),
('smart_image','imageFill',true,NULL,NULL,NULL,NULL),
('smart_navigation','imageFill',true,NULL,NULL,NULL,NULL)
ON CONFLICT(component_api,property_key) DO UPDATE SET
 enabled=EXCLUDED.enabled,control_kind_override=EXCLUDED.control_kind_override,
 value_key=EXCLUDED.value_key,default_value_override=EXCLUDED.default_value_override,
 choices_override=EXCLUDED.choices_override;
-- Correct the two approved typos/meaning fixes from the spreadsheet review.
DELETE FROM md_builder_ribbon_component_rules
 WHERE component_api='smart_image' AND property_key IN ('cardsPerRow','cardsPerColumn');
UPDATE md_builder_ribbon_component_rules SET value_key='placeholder'
 WHERE component_api='smart_lookup' AND property_key='label';
UPDATE md_builder_shared_properties SET tab='Design',section_group='Header'
 WHERE property_key='headerBold' AND tab<>'Home';
UPDATE md_builder_shared_properties SET field_select=true
 WHERE property_key IN ('imageSource','textSource','badgeText');
UPDATE md_builder_shared_properties SET min_value=0
 WHERE property_key IN ('textSize','placeholderSize','imageHeight','headerBoxHeight','badgeTextSize');
-- New tenants receive component registrations via the independent Smart seeder.
-- Existing tenants also receive them at startup; no app data is changed.
-- END ORIGINAL MIGRATION 20270124-smart-component-library.sql

-- BEGIN ORIGINAL MIGRATION 20270125-retire-uninstalled-app-package-versions.sql
-- Remove superseded system-owned app package versions that NO tenant has installed.
-- This is package catalogue metadata only: never delete tenant installations,
-- business records, page versions, authored component libraries or permissions.
-- Each removed package version and its direct child metadata is archived first.
-- Requires a separate verified SQL backup before production deployment.
CREATE TABLE IF NOT EXISTS md_retired_app_package_version_archive (
  app_id uuid NOT NULL REFERENCES md_apps(id),
  version integer NOT NULL CHECK(version>0),
  archived_at timestamptz NOT NULL DEFAULT now(),
  package_snapshot jsonb NOT NULL,
  child_snapshots jsonb NOT NULL,
  PRIMARY KEY(app_id,version)
);

DO $cleanup$
DECLARE
  candidate record;
  child record;
  child_rows jsonb;
  children jsonb;
  package_data jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('metadrive:system:retire-app-package-versions'));
  FOR candidate IN
    SELECT p.app_id,p.version
    FROM md_app_package_versions p
    JOIN md_apps a ON a.id=p.app_id AND a.tenant_owner_id IS NULL
    WHERE p.version < (
      SELECT MAX(current_version.version)
      FROM md_app_package_versions current_version
      WHERE current_version.app_id=p.app_id AND current_version.published=true
    )
    AND NOT EXISTS (
      SELECT 1 FROM md_tenant_app_installed_versions installed
      WHERE installed.app_id=p.app_id AND installed.version=p.version
    )
    -- Legacy installations lacking a version receipt retain their full
    -- published package history until version backfill explicitly resolves it.
    AND NOT EXISTS (
      SELECT 1 FROM md_app_installations installation
      WHERE installation.app_id=p.app_id
        AND NOT EXISTS (
          SELECT 1 FROM md_tenant_app_installed_versions receipt
          WHERE receipt.tenant_id=installation.tenant_id
            AND receipt.app_id=installation.app_id
        )
    )
    ORDER BY p.app_id,p.version
    FOR UPDATE OF p
  LOOP
    -- Archive exact metadata for rollback (including historical published versions).
    SELECT to_jsonb(p) INTO package_data FROM md_app_package_versions p
    WHERE p.app_id=candidate.app_id AND p.version=candidate.version;
    children:='{}'::jsonb;
    -- Archive every versioned package-template table, including nested FK
    -- children such as home-page templates. Exclude tenant-owned rows.
    FOR child IN
      SELECT n.nspname AS schema_name,c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname=current_schema()
        AND c.relname LIKE 'md_app_package_%'
        AND c.relname NOT IN ('md_app_package_versions')
        AND EXISTS (SELECT 1 FROM pg_attribute att
          WHERE att.attrelid=c.oid AND att.attname='app_id' AND NOT att.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute att
          WHERE att.attrelid=c.oid AND att.attname='version' AND NOT att.attisdropped)
    LOOP
      EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM %I.%I t WHERE t.app_id=$1 AND t.version=$2',
        child.schema_name,child.table_name)
        INTO child_rows USING candidate.app_id,candidate.version;
      children:=children||jsonb_build_object(child.schema_name||'.'||child.table_name,child_rows);
    END LOOP;
    INSERT INTO md_retired_app_package_version_archive(app_id,version,package_snapshot,child_snapshots)
    VALUES(candidate.app_id,candidate.version,package_data,children)
    ON CONFLICT(app_id,version) DO NOTHING;
    -- Fail rather than erase metadata whose backup could not be written.
    IF NOT EXISTS (
      SELECT 1 FROM md_retired_app_package_version_archive archived
      WHERE archived.app_id=candidate.app_id AND archived.version=candidate.version
    ) THEN RAISE EXCEPTION 'Package version archive missing for % version %',candidate.app_id,candidate.version;
    END IF;
    -- Repeat the installed-version guard, now inside the transaction.
    DELETE FROM md_app_package_versions p
    WHERE p.app_id=candidate.app_id AND p.version=candidate.version
      AND EXISTS (SELECT 1 FROM md_retired_app_package_version_archive archive
        WHERE archive.app_id=p.app_id AND archive.version=p.version)
      AND NOT EXISTS (SELECT 1 FROM md_tenant_app_installed_versions i
        WHERE i.app_id=p.app_id AND i.version=p.version);
  END LOOP;
END $cleanup$;
-- END ORIGINAL MIGRATION 20270125-retire-uninstalled-app-package-versions.sql

-- BEGIN ORIGINAL MIGRATION 20270125-smart-ribbon-property-corrections.sql
-- Versioned Smart-only property corrections. Do not mutate applied migration history.
-- Preserve Home and app-owned components and all tenant page records.
DELETE FROM md_builder_ribbon_component_rules
WHERE (component_api='smart_toggle' AND property_key IN
  ('label','labelAlignment','textSize','labelColor','defaultValue'))
 OR (component_api='smart_lookup' AND property_key IN ('defaultValue','defaultValueColor'))
 OR property_key='placeholderSize';
DELETE FROM md_builder_shared_properties WHERE property_key='placeholderSize' AND tab<>'Home';
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
 VALUES ('defaultCheck','Default Check','Design','Behaviour','choice',
 (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),'false'::jsonb,
 '["false","true"]'::jsonb,'component')
 ON CONFLICT(property_key) DO NOTHING;
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
 VALUES ('smart_toggle','defaultCheck',true,'choice',NULL,'false'::jsonb,'["false","true"]'::jsonb)
 ON CONFLICT(component_api,property_key) DO UPDATE
 SET enabled=true, control_kind_override='choice';
-- Lookup Label is the editable placeholder text, not its selected value.
UPDATE md_builder_ribbon_component_rules SET value_key='placeholder'
 WHERE component_api='smart_lookup' AND property_key='label';
-- END ORIGINAL MIGRATION 20270125-smart-ribbon-property-corrections.sql

-- BEGIN ORIGINAL MIGRATION 20270126-legacy-ui-component-cutover.sql
-- Exact-key runtime cutover after ui_* renderer assets are deployed.
-- Preserve historical immutable layouts, tenant-authored libraries and
-- historical published package definitions. They resolve via read-only
-- compatibility aliases until their own version lifecycle retires them.
-- Every mutation is tenant-scoped and gated by the system-owned renderer key.
CREATE TABLE IF NOT EXISTS md_component_key_cutover_audit (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 surface text NOT NULL,
 reference_key text NOT NULL,
 old_api text NOT NULL,
 new_api text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,surface,reference_key,old_api)
);

-- A tenant-written definition with the ui_* name is never commandeered.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT legacy.tenant_id,
 'ui_'||substring(legacy.api_name from 5),
 'one-bundled:ui_'||substring(legacy.api_name from 5),true
FROM md_component_definitions legacy
WHERE legacy.api_name LIKE 'une\_%' ESCAPE '\'
  AND legacy.renderer_key='one-bundled:'||legacy.api_name
ON CONFLICT(tenant_id,api_name) DO NOTHING;

WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
), replaced AS (
 UPDATE md_page_components p SET component_api=e.new_api
 FROM eligible e
 WHERE p.tenant_id=e.tenant_id AND p.component_api=e.old_api
 RETURNING p.tenant_id,p.id::text AS reference_key,e.old_api,e.new_api
)
INSERT INTO md_component_key_cutover_audit(tenant_id,surface,reference_key,old_api,new_api)
SELECT tenant_id,'page-component',reference_key,old_api,new_api FROM replaced
ON CONFLICT DO NOTHING;

WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
), replaced AS (
 UPDATE md_lightning_page_nodes n SET component_type='Custom:'||e.new_api
 FROM eligible e
 WHERE n.tenant_id=e.tenant_id AND n.component_type='Custom:'||e.old_api
 RETURNING n.tenant_id,n.page_id::text||':'||n.component_key AS reference_key,e.old_api,e.new_api
)
INSERT INTO md_component_key_cutover_audit(tenant_id,surface,reference_key,old_api,new_api)
SELECT tenant_id,'lightning-node',reference_key,old_api,new_api FROM replaced
ON CONFLICT DO NOTHING;

-- Supported typed Flow/action references only; no substring rewrites of
-- arbitrary tenant text, JSON metadata, authored expressions or business rows.
WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
)
UPDATE md_flow_node_properties p SET value_text=e.new_api
FROM eligible e
WHERE p.tenant_id=e.tenant_id
  AND p.api_name IN ('componentApiName','customComponentApiName','libraryComponentId')
  AND p.value_text=e.old_api;

WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
)
UPDATE md_flow_editor_values v SET value_text=e.new_api
FROM eligible e
WHERE v.tenant_id=e.tenant_id AND v.value_text=e.old_api
  AND v.property_path ~ '(^|\.)(componentApiName|customComponentApiName|libraryComponentId)$';

WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
)
UPDATE md_object_actions a SET component_api_name=e.new_api FROM eligible e
WHERE a.tenant_id=e.tenant_id AND a.component_api_name=e.old_api;

WITH eligible AS (
 SELECT old.tenant_id,old.api_name AS old_api,modern.api_name AS new_api
 FROM md_component_definitions old
 JOIN md_component_definitions modern ON modern.tenant_id=old.tenant_id
   AND modern.api_name='ui_'||substring(old.api_name from 5)
   AND modern.renderer_key='one-bundled:'||modern.api_name
   AND modern.enabled=true
 WHERE old.api_name LIKE 'une\_%' ESCAPE '\'
   AND old.renderer_key='one-bundled:'||old.api_name
)
UPDATE md_global_quick_actions a SET component_api_name=e.new_api FROM eligible e
WHERE a.tenant_id=e.tenant_id AND a.component_api_name=e.old_api;

-- Never delete old SQL identities if any immutable version, user library,
-- old installed package, dashboard, Flow or other reference still needs them.
UPDATE md_component_definitions old SET enabled=false
WHERE old.enabled=true AND old.api_name LIKE 'une\_%' ESCAPE '\'
 AND old.renderer_key='one-bundled:'||old.api_name
 AND NOT EXISTS (SELECT 1 FROM md_page_components p
   WHERE p.tenant_id=old.tenant_id AND p.component_api=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_lightning_page_nodes n
   WHERE n.tenant_id=old.tenant_id AND n.component_type='Custom:'||old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_page_layout_version_nodes n
   WHERE n.tenant_id=old.tenant_id AND n.component_type='Custom:'||old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_component_library_versions v
   WHERE v.tenant_id=old.tenant_id AND v.component_api=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_component_library_heads h
   WHERE h.tenant_id=old.tenant_id AND h.component_api=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_flow_node_properties p
   WHERE p.tenant_id=old.tenant_id AND p.value_text=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_flow_editor_values p
   WHERE p.tenant_id=old.tenant_id AND p.value_text=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_object_actions a
   WHERE a.tenant_id=old.tenant_id AND a.component_api_name=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_global_quick_actions a
   WHERE a.tenant_id=old.tenant_id AND a.component_api_name=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_tenant_app_installed_versions i
   JOIN md_app_package_component_templates t ON t.app_id=i.app_id AND t.version=i.version
   WHERE i.tenant_id=old.tenant_id AND t.api_name=old.api_name)
 AND NOT EXISTS (SELECT 1 FROM md_tenant_app_installed_versions i
   JOIN md_app_package_page_component_templates t ON t.app_id=i.app_id AND t.version=i.version
   WHERE i.tenant_id=old.tenant_id AND t.component_api=old.api_name);
-- END ORIGINAL MIGRATION 20270126-legacy-ui-component-cutover.sql

-- BEGIN ORIGINAL MIGRATION 20270126-une-ribbon-requirements.sql
-- Complete the SQL-backed UNE Page Builder ribbon requirements.
-- This migration only edits the global inventory and applicability, not saved page values.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
VALUES ('badgeBodyColor','Badge Body Color','Design','Badge','color',
  (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
  NULL,'[]'::jsonb,'component')
ON CONFLICT(property_key) DO UPDATE SET
 label=EXCLUDED.label,tab=EXCLUDED.tab,section_group=EXCLUDED.section_group,
 control_kind=EXCLUDED.control_kind;

-- Smart components are the current ribbon catalog; older UNE component rows may
-- still exist in upgraded environments. Only reference registered components.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT c.component_api, 'badgeBodyColor', true, NULL, NULL, NULL, NULL
FROM md_builder_ribbon_components c
WHERE c.component_api IN ('smart_card_grid','smart_image','une_item_grid','une_image')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

UPDATE md_builder_ribbon_component_rules SET enabled=false
WHERE (component_api='une_item_grid' AND property_key IN
 ('label','labelAlignment','defaultValueColor','textSize'))
 OR (component_api='une_container' AND property_key IN
 ('objectApiName','imageSource','badgeText','badgeAlignment','badgeTextSize',
  'badgeBold','badgeTextColor','badgeVisible','badgeBodyColor',
  'labelAlignment','textSize','label','textSource','labelColor','imageFill'))
 OR (component_api='une_calendar' AND property_key IN ('label','labelAlignment'));

UPDATE md_builder_shared_properties SET
 tab=CASE
  WHEN property_key IN ('label','defaultValue') THEN 'Data'
  WHEN property_key IN ('tabHeight','tabWidth','headerBoxHeight','imageHeight') THEN 'Layout'
  WHEN property_key='imagePlacement' THEN 'Design'
  ELSE tab END,
 section_group=CASE
  WHEN property_key IN ('label','defaultValue') THEN 'Values'
  WHEN property_key IN ('tabHeight','tabWidth') THEN 'Tabs'
  WHEN property_key='headerBoxHeight' THEN 'Header'
  WHEN property_key IN ('imageHeight','imagePlacement') THEN 'Image'
  ELSE section_group END
WHERE property_key IN
 ('label','defaultValue','tabHeight','tabWidth','headerBoxHeight','imageHeight','imagePlacement');

UPDATE md_builder_ribbon_component_rules SET control_kind_override='shadow'
WHERE component_api='une_calendar' AND property_key='shadow';
-- END ORIGINAL MIGRATION 20270126-une-ribbon-requirements.sql

-- BEGIN ORIGINAL MIGRATION 20270127-master-detail-sharing.sql
-- Phase 2C: Master-Detail records inherit the intersection of their masters'
-- record access, while retaining their own object permission, explicit record denies,
-- record-type guards and restriction policies. All checks remain tenant-scoped.
-- A child with two masters requires access to both; missing links fail closed.
-- Lookup references never grant inherited record access.
CREATE OR REPLACE FUNCTION md_record_access(t uuid,u uuid,rid uuid,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
 SELECT
 -- Object/record denies and restrictions also narrow ownership and broad grants.
 (NOT rec.is_deleted OR act='delete')
 AND EXISTS(SELECT 1 FROM md_object_definitions obj
   WHERE obj.tenant_id=t AND obj.api_name=rec.object_api AND obj.deleted_at IS NULL)
 AND NOT (SELECT deny_granted FROM md_rbac_decision(t,u,'Record:'||rec.id::text,act))
 AND md_rbac_allowed(t,u,rec.object_api,act)
 AND (rec.record_type_id IS NULL OR md_rbac_allowed(t,u,'RecordType:'||rec.object_api||'.'||rec.record_type_id,'read'))
 AND NOT EXISTS(SELECT 1 FROM md_record_policies rp WHERE rp.tenant_id=t AND rp.object_api=rec.object_api
  AND rp.kind='restriction' AND rp.enabled
  AND (rp.subject_type='all' OR (rp.subject_type='external' AND usr.user_type='external')
   OR (rp.subject_type='user' AND rp.subject_id=u) OR (rp.subject_type='role' AND EXISTS(
    SELECT 1 FROM md_user_roles ur WHERE ur.tenant_id=t AND ur.user_id=u AND ur.role_id=rp.subject_id)))
  AND NOT md_policy_matches(t,rp.id,rec.id))
 AND (EXISTS(SELECT 1 FROM md_field_definitions master
        WHERE master.tenant_id=t AND master.object_api=rec.object_api
          AND master.relationship_type='Master-Detail' AND master.deleted_at IS NULL)
      OR usr.user_type='external'
      OR md_effective_reporting_scope(t,u,rec.object_api) IS NULL
      OR md_effective_reporting_scope(t,u,rec.object_api)='all'
      OR (rec.owner_id IS NOT NULL AND md_reporting_scope(t,u,rec.owner_id,
           md_effective_reporting_scope(t,u,rec.object_api))))
 AND (CASE WHEN EXISTS(SELECT 1 FROM md_field_definitions master
         WHERE master.tenant_id=t AND master.object_api=rec.object_api
           AND master.relationship_type='Master-Detail' AND master.deleted_at IS NULL)
   THEN NOT EXISTS(
     SELECT 1 FROM md_field_definitions master
     LEFT JOIN md_record_values child_link ON child_link.tenant_id=t
       AND child_link.record_id=rec.id AND child_link.object_api=rec.object_api
       AND child_link.field_api=master.api_name
     WHERE master.tenant_id=t AND master.object_api=rec.object_api
       AND master.relationship_type='Master-Detail' AND master.deleted_at IS NULL
       AND (child_link.reference_record_id IS NULL
         OR NOT md_record_access(t,u,child_link.reference_record_id,act)))
   ELSE (CASE WHEN usr.user_type='external' THEN act='read' AND COALESCE(setting.portal_enabled,false)
   AND usr.external_account_id IS NOT NULL
   AND md_record_field(t,rec.id,setting.portal_account_field)=usr.external_account_id::text
 ELSE
 (md_effective_reporting_scope(t,u,rec.object_api) IS NOT NULL
  AND (md_effective_reporting_scope(t,u,rec.object_api)='all'
    OR (rec.owner_id IS NOT NULL AND md_reporting_scope(t,u,rec.owner_id,
       md_effective_reporting_scope(t,u,rec.object_api)))))
 OR rec.owner_id=u OR (rec.owner_queue_id IS NOT NULL AND md_access_member(t,u,rec.owner_queue_id))
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
 END) END)
 FROM md_records rec JOIN md_users usr ON usr.tenant_id=t AND usr.id=u AND usr.enabled
 LEFT JOIN md_sharing_settings setting ON setting.tenant_id=t AND setting.object_api=rec.object_api
 WHERE rec.tenant_id=t AND rec.id=rid
 ),false)
$$;
-- END ORIGINAL MIGRATION 20270127-master-detail-sharing.sql

-- BEGIN ORIGINAL MIGRATION 20270127-smart-ribbon-compact-property-placement.sql
-- Smart Page Builder ribbon finishing changes.
-- Metadata-only: leave saved page/component property values and tenant rules intact.
-- The shared property catalog owns both tab/section placement and displayed labels.
UPDATE md_builder_shared_properties
SET tab='Data', section_group='Values'
WHERE property_key='defaultCheck';

-- The Header caption already provides the context: don't repeat "Header" in its controls.
UPDATE md_builder_shared_properties
SET label=CASE property_key
  WHEN 'headerBorderColor' THEN 'Border'
  WHEN 'headerAlignment' THEN 'Alignment'
  ELSE label
END
WHERE property_key IN ('headerBorderColor','headerAlignment')
  AND tab='Design' AND section_group='Header';
-- END ORIGINAL MIGRATION 20270127-smart-ribbon-compact-property-placement.sql

-- BEGIN ORIGINAL MIGRATION 20270128-relationship-inverse-name-integrity.sql
-- Phase 2C: inverse names are unique per target object, case-insensitively.
-- Enforce on NEW writes without rewriting any historical names that may already
-- be used by published reports, formulas, pages and external clients.
CREATE OR REPLACE FUNCTION md_validate_inverse_relationship_name()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data_type='reference' AND NEW.related_object IS NOT NULL
   AND NEW.deleted_at IS NULL AND NEW.child_relationship_name IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,21103));
  IF EXISTS(
   SELECT 1 FROM md_field_definitions f
   WHERE f.tenant_id=NEW.tenant_id AND f.related_object=NEW.related_object
     AND f.data_type='reference' AND f.deleted_at IS NULL
     AND lower(f.child_relationship_name)=lower(NEW.child_relationship_name)
     AND f.id<>NEW.id
  ) THEN
   RAISE EXCEPTION 'Duplicate child relationship name: %',NEW.child_relationship_name
     USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_inverse_relationship_name_integrity ON md_field_definitions;
CREATE TRIGGER md_inverse_relationship_name_integrity
 BEFORE INSERT OR UPDATE OF data_type,related_object,child_relationship_name,deleted_at
 ON md_field_definitions FOR EACH ROW EXECUTE FUNCTION md_validate_inverse_relationship_name();
-- END ORIGINAL MIGRATION 20270128-relationship-inverse-name-integrity.sql

-- BEGIN ORIGINAL MIGRATION 20270128-smart-renderer-property-alignment.sql
-- Align enabled Smart ribbon controls with their actual metadata-driven renderer contracts.
-- Keep the global property inventory visible; unsupported controls are disabled.
-- Additive upgrade: preserve authored page values, published pages, tenant data and Home.
UPDATE md_builder_ribbon_component_rules
SET enabled=false
WHERE (component_api='smart_toggle' AND property_key='radius')
   OR (component_api='smart_card_grid' AND property_key IN
  ('label','labelAlignment','defaultValueColor','textSize'))
   OR (component_api='smart_calendar' AND property_key IN
  ('label','labelAlignment'))
   OR (component_api='smart_container' AND property_key IN
  ('label','labelAlignment','labelColor','textSize','objectApiName',
   'imageSource','textSource','badgeText','badgeAlignment','badgeTextSize',
   'badgeBold','badgeTextColor','badgeVisible','badgeBodyColor','imageFill'));
-- END ORIGINAL MIGRATION 20270128-smart-renderer-property-alignment.sql

-- BEGIN ORIGINAL MIGRATION 20270129-master-detail-owner-inheritance.sql
-- Track the first explicitly-created master relationship for ownership.
-- Existing junction metadata chooses a deterministic legacy primary; all new
-- definitions use creation order rather than alphabetical API ordering.
ALTER TABLE md_field_definitions ADD COLUMN IF NOT EXISTS is_primary_master boolean NOT NULL DEFAULT false;
UPDATE md_field_definitions f SET is_primary_master=true
FROM (
 SELECT tenant_id,object_api,api_name,
   row_number() OVER(PARTITION BY tenant_id,object_api ORDER BY api_name) AS position
 FROM md_field_definitions
 WHERE data_type='reference' AND relationship_type='Master-Detail' AND deleted_at IS NULL
) ranked
WHERE f.tenant_id=ranked.tenant_id AND f.object_api=ranked.object_api
 AND f.api_name=ranked.api_name AND ranked.position=1
 AND f.is_primary_master=false
 AND NOT EXISTS(SELECT 1 FROM md_field_definitions designated
  WHERE designated.tenant_id=f.tenant_id AND designated.object_api=f.object_api
   AND designated.is_primary_master=true);
CREATE UNIQUE INDEX IF NOT EXISTS md_master_detail_one_primary
 ON md_field_definitions(tenant_id,object_api)
 WHERE is_primary_master=true;

CREATE OR REPLACE FUNCTION md_assign_primary_master()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data_type='reference' AND NEW.relationship_type='Master-Detail'
   AND NEW.deleted_at IS NULL THEN
  IF TG_OP='INSERT' THEN
   NEW.is_primary_master:=NOT EXISTS(
    SELECT 1 FROM md_field_definitions f WHERE f.tenant_id=NEW.tenant_id
      AND f.object_api=NEW.object_api AND f.is_primary_master=true
      AND f.deleted_at IS NULL);
  ELSIF NEW.is_primary_master IS NOT TRUE THEN
   NEW.is_primary_master:=NOT EXISTS(
    SELECT 1 FROM md_field_definitions f WHERE f.tenant_id=NEW.tenant_id
      AND f.object_api=NEW.object_api AND f.api_name<>NEW.api_name
      AND f.is_primary_master=true AND f.deleted_at IS NULL);
  END IF;
 ELSE NEW.is_primary_master:=false;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_assign_primary_master_before ON md_field_definitions;
CREATE TRIGGER md_assign_primary_master_before
 BEFORE INSERT OR UPDATE OF data_type,relationship_type,deleted_at
 ON md_field_definitions FOR EACH ROW EXECUTE FUNCTION md_assign_primary_master();

CREATE OR REPLACE FUNCTION md_reassign_primary_master()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.is_primary_master IS NOT TRUE THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN
  UPDATE md_field_definitions f SET is_primary_master=true
  WHERE f.id=(
   SELECT candidate.id FROM md_field_definitions candidate
   WHERE candidate.tenant_id=OLD.tenant_id AND candidate.object_api=OLD.object_api
     AND candidate.data_type='reference'
     AND candidate.relationship_type='Master-Detail'
     AND candidate.deleted_at IS NULL AND candidate.is_primary_master=false
   ORDER BY candidate.api_name LIMIT 1
  );
  RETURN NULL;
 END IF;
 IF NEW.is_primary_master IS FALSE THEN
  UPDATE md_field_definitions f SET is_primary_master=true
  WHERE f.id=(
   SELECT candidate.id FROM md_field_definitions candidate
   WHERE candidate.tenant_id=OLD.tenant_id AND candidate.object_api=OLD.object_api
     AND candidate.data_type='reference'
     AND candidate.relationship_type='Master-Detail'
     AND candidate.deleted_at IS NULL AND candidate.is_primary_master=false
   ORDER BY candidate.api_name LIMIT 1
  );
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS md_reassign_primary_master_after ON md_field_definitions;
CREATE TRIGGER md_reassign_primary_master_after
 AFTER UPDATE OF data_type,relationship_type,deleted_at OR DELETE
 ON md_field_definitions FOR EACH ROW EXECUTE FUNCTION md_reassign_primary_master();

-- Phase 2C: A detail's owner follows its primary master. This is separate
-- from sharing grants: no detail can become independently visible by changing
-- its owner. Deterministic primary master = lowest active field API name.
CREATE OR REPLACE FUNCTION md_sync_master_detail_owner_from_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inherited_owner uuid; inherited_queue uuid;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM md_field_definitions f
  WHERE f.tenant_id=NEW.tenant_id AND f.object_api=NEW.object_api
   AND f.api_name=NEW.field_api AND f.relationship_type='Master-Detail'
   AND f.data_type='reference' AND f.deleted_at IS NULL
 ) THEN RETURN NEW; END IF;
 SELECT parent.owner_id,parent.owner_queue_id INTO inherited_owner,inherited_queue
 FROM md_record_values v
 JOIN md_field_definitions f ON f.tenant_id=v.tenant_id
   AND f.object_api=v.object_api AND f.api_name=v.field_api
   AND f.data_type='reference' AND f.relationship_type='Master-Detail'
   AND f.deleted_at IS NULL
 JOIN md_records parent ON parent.tenant_id=v.tenant_id
   AND parent.id=v.reference_record_id AND parent.object_api=f.related_object
 WHERE v.tenant_id=NEW.tenant_id AND v.record_id=NEW.record_id
   AND v.object_api=NEW.object_api
 ORDER BY f.is_primary_master DESC,f.api_name LIMIT 1;
 IF FOUND THEN
  UPDATE md_records child
    SET owner_id=inherited_owner,owner_queue_id=inherited_queue
  WHERE child.tenant_id=NEW.tenant_id AND child.id=NEW.record_id
   AND child.object_api=NEW.object_api
   AND (child.owner_id IS DISTINCT FROM inherited_owner
     OR child.owner_queue_id IS DISTINCT FROM inherited_queue);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_sync_master_detail_owner_reference ON md_record_values;
CREATE TRIGGER md_sync_master_detail_owner_reference
 AFTER INSERT OR UPDATE OF reference_record_id ON md_record_values
 FOR EACH ROW EXECUTE FUNCTION md_sync_master_detail_owner_from_reference();

-- Transfer of a master owner cascades down the active Master-Detail graph.
-- Explicit lookup links are not affected; they remain independently owned.
CREATE OR REPLACE FUNCTION md_sync_master_detail_owner_from_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id AND
    NEW.owner_queue_id IS NOT DISTINCT FROM OLD.owner_queue_id THEN RETURN NEW; END IF;
 UPDATE md_records child SET owner_id=NEW.owner_id,owner_queue_id=NEW.owner_queue_id
 FROM md_record_values v
 JOIN md_field_definitions f ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api
   AND f.api_name=v.field_api AND f.relationship_type='Master-Detail'
   AND f.data_type='reference' AND f.deleted_at IS NULL
 WHERE v.tenant_id=NEW.tenant_id AND v.reference_record_id=NEW.id
   AND f.related_object=NEW.object_api
   AND child.tenant_id=v.tenant_id AND child.id=v.record_id
   AND child.object_api=v.object_api
   AND f.is_primary_master=true
   AND (child.owner_id IS DISTINCT FROM NEW.owner_id
     OR child.owner_queue_id IS DISTINCT FROM NEW.owner_queue_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS md_sync_master_detail_owner_parent ON md_records;
CREATE TRIGGER md_sync_master_detail_owner_parent
 AFTER UPDATE OF owner_id,owner_queue_id ON md_records
 FOR EACH ROW EXECUTE FUNCTION md_sync_master_detail_owner_from_parent();

-- Backfill prior details after installing both triggers; parent transfers
-- propagate transitively and preserve soft-deleted record rows for restoration.
DO $backfill$
DECLARE affected integer;
BEGIN
 FOR pass IN 1..16 LOOP
  UPDATE md_records child SET owner_id=parent.owner_id,owner_queue_id=parent.owner_queue_id
  FROM md_record_values v
  JOIN md_field_definitions f ON f.tenant_id=v.tenant_id AND f.object_api=v.object_api
    AND f.api_name=v.field_api AND f.data_type='reference'
    AND f.relationship_type='Master-Detail' AND f.deleted_at IS NULL
  JOIN md_records parent ON parent.tenant_id=v.tenant_id
    AND parent.id=v.reference_record_id AND parent.object_api=f.related_object
  WHERE child.tenant_id=v.tenant_id AND child.id=v.record_id AND child.object_api=v.object_api
    AND f.is_primary_master=true
    AND (child.owner_id IS DISTINCT FROM parent.owner_id
      OR child.owner_queue_id IS DISTINCT FROM parent.owner_queue_id);
  GET DIAGNOSTICS affected=ROW_COUNT;
  EXIT WHEN affected=0;
 END LOOP;
END $backfill$;
-- END ORIGINAL MIGRATION 20270129-master-detail-owner-inheritance.sql

-- BEGIN ORIGINAL MIGRATION 20270129-smart-ribbon-short-section-labels.sql
-- Forward-only Smart Ribbon label polish for the approved Badge and Image layouts.
-- The section caption already supplies context; change metadata labels only,
-- not keys, values, component applicability, Home, or tenant customisations.
UPDATE md_builder_shared_properties
SET label=CASE property_key
  WHEN 'badgeAlignment' THEN 'Alignment'
  WHEN 'badgeVisible' THEN 'Visible'
  WHEN 'badgeTextSize' THEN 'Text Size'
  WHEN 'imagePlacement' THEN 'Placement'
  WHEN 'imageBorderColor' THEN 'Border'
  WHEN 'imageFill' THEN 'Fill'
  ELSE label
END
WHERE tab='Design' AND scope='component'
  AND (
    (section_group='Badge' AND property_key IN
      ('badgeAlignment','badgeVisible','badgeTextSize'))
    OR
    (section_group='Image' AND property_key IN
      ('imagePlacement','imageBorderColor','imageFill'))
  );
-- END ORIGINAL MIGRATION 20270129-smart-ribbon-short-section-labels.sql

-- BEGIN ORIGINAL MIGRATION 20270130-smart-cart-ribbon.sql
-- New Smart Cart is a reusable visual component, not an AceTill modification.
-- Forward-only migration: no changes to published pages or tenant business records.
INSERT INTO md_builder_ribbon_components(component_api) VALUES ('smart_cart') ON CONFLICT DO NOTHING;
WITH specs(n,property_key,label,tab,section_group,control_kind,default_value) AS (
 VALUES
 (1,'headerTextColor','Header Text Color','Design','Header','color',NULL::jsonb),
 (2,'supportingBoxHeight','Box Height','Layout','Header Supporting','number','36'::jsonb),
 (3,'supportingBorderColor','Border','Design','Header Supporting','color',NULL::jsonb),
 (4,'supportingAlignment','Alignment','Design','Header Supporting','align',NULL::jsonb),
 (5,'supportingBold','Bold','Design','Header Supporting','boolean','false'::jsonb),
 (6,'supportingTextColor','Text Color','Design','Header Supporting','color',NULL::jsonb),
 (7,'tableBackgroundColor','Body Color','Design','Table','color',NULL::jsonb),
 (8,'tableBorderColor','Border color','Design','Table','color',NULL::jsonb),
 (9,'tableShadow','Shadow','Design','Table','shadow',NULL::jsonb),
 (10,'tableRadius','Corner Radius','Design','Table','number','8'::jsonb),
 (11,'rowBorderColor','Border color','Design','Row','color',NULL::jsonb),
 (12,'rowLabelColor','Label Color','Design','Row','color',NULL::jsonb),
 (13,'rowRadius','Corner Radius','Design','Row','number','4'::jsonb),
 (14,'rowHeight','Height','Design','Row','number','64'::jsonb),
 (15,'summaryBackgroundColor','Body Color','Design','Summary','color',NULL::jsonb),
 (16,'summaryBorderColor','Border color','Design','Summary','color',NULL::jsonb),
 (17,'summaryShadow','Shadow','Design','Summary','shadow',NULL::jsonb),
 (18,'summaryRadius','Corner Radius','Design','Summary','number','8'::jsonb),
 (19,'summaryHeight','Height','Design','Summary','number','148'::jsonb),
 (20,'summaryWidth','Width','Design','Summary','number',NULL::jsonb),
 (21,'summaryTextSize','Summary text Size','Design','Summary','number','14'::jsonb),
 (22,'summaryTextWeight','Summary text Weight','Design','Summary','boolean','false'::jsonb),
 (23,'summaryTextColor','Summary text Color','Design','Summary','color',NULL::jsonb),
 (24,'summary2TextSize','Summary 2 text Size','Design','Summary','number','18'::jsonb),
 (25,'summary2TextWeight','Summary 2 text Weight','Design','Summary','boolean','true'::jsonb),
 (26,'summary2TextColor','Summary 2 text Color','Design','Summary','color',NULL::jsonb)
), missing AS (
 SELECT specs.*,row_number() OVER (ORDER BY n) AS pos FROM specs
 WHERE NOT EXISTS (SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
), last_order AS (SELECT COALESCE(MAX(sort_order),0) AS last_sort FROM md_builder_shared_properties)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT property_key,label,tab,section_group,control_kind,last_sort+pos,default_value,'[]'::jsonb,'component'
FROM missing CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

-- Explicit applicability. Properties marked No remain disabled for Smart Cart.
-- DISTINCT is intentional: duplicate source keys with ON CONFLICT DO UPDATE
-- trigger PostgreSQL SQLSTATE 21000 and abort API startup. Keep the key list
-- unique as well; the DISTINCT is a defensive safeguard for future additions.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT DISTINCT 'smart_cart', keys.property_key,true,NULL,NULL,
 CASE keys.property_key WHEN 'imageHeight' THEN '44'::jsonb
  WHEN 'headerBoxHeight' THEN '52'::jsonb
  WHEN 'imagePlacement' THEN '"left"'::jsonb ELSE NULL END,
 CASE WHEN keys.property_key='imagePlacement' THEN '["left","right"]'::jsonb ELSE NULL END
FROM (VALUES
 ('objectApiName'),
 ('imageSource'),
 ('textSource'),
 ('backgroundColor'),
 ('borderColor'),
 ('shadow'),
 ('radius'),
 ('imagePlacement'),
 ('imageHeight'),
 ('imageBorderColor'),
 ('imageFill'),
 ('headerBoxHeight'),
 ('headerBorderColor'),
 ('headerAlignment'),
 ('headerBold'),
 ('headerTextColor'),
 ('width'),
 ('height'),
 ('x'),
 ('y'),
 ('supportingBoxHeight'),
 ('supportingBorderColor'),
 ('supportingAlignment'),
 ('supportingBold'),
 ('supportingTextColor'),
 ('tableBackgroundColor'),
 ('tableBorderColor'),
 ('tableShadow'),
 ('tableRadius'),
 ('rowBorderColor'),
 ('rowLabelColor'),
 ('rowRadius'),
 ('rowHeight'),
 ('summaryBackgroundColor'),
 ('summaryBorderColor'),
 ('summaryShadow'),
 ('summaryRadius'),
 ('summaryHeight'),
 ('summaryWidth'),
 ('summaryTextSize'),
 ('summaryTextWeight'),
 ('summaryTextColor'),
 ('summary2TextSize'),
 ('summary2TextWeight'),
 ('summary2TextColor')
) AS keys(property_key)
JOIN md_builder_shared_properties p ON p.property_key=keys.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET
 enabled=EXCLUDED.enabled,default_value_override=EXCLUDED.default_value_override,
 choices_override=EXCLUDED.choices_override;

-- Register renderer for existing tenants without overwriting custom tenant components.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'smart_cart','one-bundled:smart_cart',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20270130-smart-cart-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270130-smart-icon-library.sql
-- Smart Icon: the existing SQL ribbon remains the source of truth.
-- Only the nine approved properties are enabled; every other shared slot stays visible but disabled.
-- Icon selection is handled by the contextual Icons tab and saved as component.properties.iconId.
INSERT INTO md_builder_ribbon_components(component_api) VALUES ('smart_icon')
ON CONFLICT DO NOTHING;

INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
VALUES ('iconFillColor','Icon Fill Color','Design','Icon','color',
 (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
 '"#000000"'::jsonb,'[]'::jsonb,'component')
ON CONFLICT(property_key) DO UPDATE SET
 label=EXCLUDED.label,tab=EXCLUDED.tab,section_group=EXCLUDED.section_group,
 control_kind=EXCLUDED.control_kind,default_value=EXCLUDED.default_value;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_icon',p.property_key,true,NULL,NULL,NULL,NULL
FROM md_builder_shared_properties p
WHERE p.property_key IN
 ('backgroundColor','borderColor','shadow','radius','width','height','x','y','iconFillColor')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270130-smart-icon-library.sql

-- BEGIN ORIGINAL MIGRATION 20270131-smart-calendar-shadow-control.sql
-- Restore shared Shadow preset semantics for Calendar without deleting prior user data.
-- Old versions mapped this UI property to the obsolete calendarShadowColor value.
-- Reset the override so all Smart components read/write the shared 'shadow' key.
UPDATE md_builder_ribbon_component_rules
SET control_kind_override='shadow', value_key=NULL
WHERE component_api='smart_calendar' AND property_key='shadow'
  AND (control_kind_override IS DISTINCT FROM 'shadow'
       OR value_key IS NOT NULL);
-- END ORIGINAL MIGRATION 20270131-smart-calendar-shadow-control.sql

-- BEGIN ORIGINAL MIGRATION 20270201-smart-cart-summary2-ribbon.sql
-- Smart Cart Summary 2 has its own ribbon group.  The keys and stored page
-- values are unchanged; only metadata placement and redundant display labels
-- change.  This is forward-only and safe to rerun.
UPDATE md_builder_shared_properties
SET section_group='Summary 2'
WHERE tab='Design' AND property_key IN
 ('summary2TextSize','summary2TextWeight','summary2TextColor');

UPDATE md_builder_shared_properties
SET label=CASE property_key
 WHEN 'summaryTextSize' THEN 'Text Size'
 WHEN 'summaryTextWeight' THEN 'Bold'
 WHEN 'summaryTextColor' THEN 'Text Color'
 WHEN 'summary2TextSize' THEN 'Text Size'
 WHEN 'summary2TextWeight' THEN 'Bold'
 WHEN 'summary2TextColor' THEN 'Text Color'
 ELSE label END
WHERE tab='Design' AND property_key IN
 ('summaryTextSize','summaryTextWeight','summaryTextColor',
  'summary2TextSize','summary2TextWeight','summary2TextColor');
-- END ORIGINAL MIGRATION 20270201-smart-cart-summary2-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270202-canvas-fill-color.sql
-- Canvas fill is page metadata, independent of nested components and containers.
ALTER TABLE md_lightning_page_details
 ADD COLUMN IF NOT EXISTS canvas_fill_color text NOT NULL DEFAULT '#ffffff';
ALTER TABLE md_page_layout_versions
 ADD COLUMN IF NOT EXISTS canvas_fill_color text NOT NULL DEFAULT '#ffffff';
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT 'canvasFillColor','Canvas Fill Color','Home','Canvas','color',
       COALESCE((SELECT MAX(sort_order)+1 FROM md_builder_shared_properties),1),
       '"#ffffff"'::jsonb,'[]'::jsonb,'page'
WHERE NOT EXISTS (SELECT 1 FROM md_builder_shared_properties WHERE property_key='canvasFillColor')
ON CONFLICT (property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270202-canvas-fill-color.sql

-- BEGIN ORIGINAL MIGRATION 20270202-smart-toggle-boolean-binding.sql
-- Enable the existing Text Source Boolean field picker for the reusable Smart Toggle.
-- Published pages and tenant records are preserved. The shared Record API enforces RBAC.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
 VALUES ('smart_toggle','textSource',true,NULL,NULL,NULL,NULL)
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270202-smart-toggle-boolean-binding.sql

-- BEGIN ORIGINAL MIGRATION 20270203-page-layout-ribbon-consolidation.sql
-- Compact Layout ribbon: group the existing page-level Layout and Version controls
-- under Page. SQL metadata remains the source of truth for group placement.
-- Idempotent, no page component values, versions or tenant customisations changed.
UPDATE md_builder_shared_properties
SET section_group='Page'
WHERE tab='Home' AND scope='page'
  AND property_key IN ('deviceLayout','selectVersion')
  AND section_group IN ('Device','Version');
-- END ORIGINAL MIGRATION 20270203-page-layout-ribbon-consolidation.sql

-- BEGIN ORIGINAL MIGRATION 20270204-two-row-design-ribbon-geometry.sql
-- Approved Design two-row control geometry. SQL-owned, global, idempotent.
-- Dimensions include the icon INSIDE the shared 70px numbered border.
-- Multi-button align/shadow controls use 3 x 28px = 84px; no label added.
-- No changes to saved layouts, tenant data, component applicability or RBAC.
ALTER TABLE md_builder_shared_properties
 ADD COLUMN IF NOT EXISTS design_row smallint,
 ADD COLUMN IF NOT EXISTS design_width smallint,
 ADD COLUMN IF NOT EXISTS design_height smallint,
 ADD COLUMN IF NOT EXISTS design_order smallint,
 ADD COLUMN IF NOT EXISTS design_caption text,
 ADD COLUMN IF NOT EXISTS design_caption_width smallint;

WITH approved(property_key,row_no,width_px,order_no) AS (
 VALUES
 ('backgroundColor',1,40,1),
 ('borderColor',1,40,2),
 ('labelColor',1,40,3),
 ('shadow',2,84,1),
 ('radius',2,70,2),
 ('labelAlignment',1,84,1),
 ('defaultValueColor',2,40,1),
 ('textSize',2,70,2),
 ('tabCount',1,58,1),
 ('selectedTabColor',2,40,1),
 ('tabColor',2,40,2),
 ('wrapText',1,28,1),
 ('headerBorderColor',1,40,2),
 ('headerTextColor',1,40,3),
 ('headerAlignment',2,84,1),
 ('headerBold',2,28,2),
 ('imagePlacement',1,99,1),
 ('imageBorderColor',2,40,1),
 ('imageFill',2,70,2),
 ('badgeAlignment',1,90,1),
 ('badgeBold',1,28,2),
 ('badgeTextSize',2,70,1),
 ('badgeTextColor',2,40,2),
 ('badgeBodyColor',2,40,3),
 ('badgeVisible',2,40,4),
 ('supportingBorderColor',1,40,1),
 ('supportingTextColor',1,40,2),
 ('supportingBold',1,28,3),
 ('supportingAlignment',2,84,1),
 ('tableBackgroundColor',1,40,1),
 ('tableBorderColor',1,40,2),
 ('tableRadius',1,70,3),
 ('tableShadow',2,84,1),
 ('rowBorderColor',1,40,1),
 ('rowRadius',1,70,2),
 ('rowLabelColor',2,40,1),
 ('rowHeight',2,70,2),
 ('summaryBackgroundColor',1,40,1),
 ('summaryBorderColor',1,40,2),
 ('summaryTextColor',1,40,3),
 ('summaryRadius',1,70,4),
 ('summaryHeight',1,70,5),
 ('summaryShadow',2,84,1),
 ('summaryWidth',2,70,2),
 ('summaryTextSize',2,70,3),
 ('summaryTextWeight',2,28,4),
 ('summary2TextSize',1,70,1),
 ('summary2TextWeight',2,28,1),
 ('summary2TextColor',2,40,2),
 ('iconFillColor',1,40,1)
)
UPDATE md_builder_shared_properties AS p SET
 design_row=approved.row_no,
 design_width=approved.width_px,
 design_height=26,
 design_order=approved.order_no
FROM approved
WHERE p.property_key=approved.property_key AND p.tab='Design'
 AND (p.design_row IS DISTINCT FROM approved.row_no OR
      p.design_width IS DISTINCT FROM approved.width_px OR
      p.design_height IS DISTINCT FROM 26 OR
      p.design_order IS DISTINCT FROM approved.order_no);
-- Unmapped future Design controls remain visible in row 2 with safe fallback sizing.
-- Explicit caption width is zero for every property without a caption.

-- Small inline captions belong to their reusable property definitions.
-- Their widths count in ADDITION to design_width (the actual editor width).
WITH captions(property_key,caption,caption_width) AS (
 VALUES ('badgeAlignment','Position',60),
        ('imagePlacement','Place',35),
        ('imageFill','Fit',35),
        ('tabCount','Tabs',35)
)
UPDATE md_builder_shared_properties AS p SET
 design_caption=captions.caption,
 design_caption_width=captions.caption_width
FROM captions
WHERE p.property_key=captions.property_key AND p.tab='Design'
 AND (p.design_caption IS DISTINCT FROM captions.caption OR
      p.design_caption_width IS DISTINCT FROM captions.caption_width);
-- END ORIGINAL MIGRATION 20270204-two-row-design-ribbon-geometry.sql

-- BEGIN ORIGINAL MIGRATION 20270205-three-row-design-shapes.sql
-- Page Builder three-row Design layout with a separate Shapes tab.
-- Shared SQL metadata only; preserve tenant data, saved component values and RBAC.
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='md_builder_shared_properties'::regclass
    AND conname='md_builder_shared_properties_tab_check'
    AND pg_get_constraintdef(oid) LIKE '%Shapes%'
 ) THEN
  ALTER TABLE md_builder_shared_properties
   DROP CONSTRAINT IF EXISTS md_builder_shared_properties_tab_check;
  ALTER TABLE md_builder_shared_properties
   ADD CONSTRAINT md_builder_shared_properties_tab_check
   CHECK(tab IN ('Home','Data','Design','Shapes','Layout'));
 END IF;
END $$;

-- Presentation variants are shared-control metadata, never component-specific logic.
ALTER TABLE md_builder_shared_properties
 ADD COLUMN IF NOT EXISTS design_display text NOT NULL DEFAULT 'buttons'
 CHECK(design_display IN ('buttons','dropdown'));

-- Move entire Image and Icon sections without duplicating properties or rules.
UPDATE md_builder_shared_properties
 SET tab='Shapes'
 WHERE tab='Design' AND section_group IN ('Image','Icon');

WITH approved(property_key,row_no,width_px,order_no) AS (
 VALUES
 ('badgeAlignment',1,85,1),
 ('badgeTextSize',2,70,1),
 ('badgeBold',2,28,2),
 ('badgeTextColor',3,40,1),
 ('badgeBodyColor',3,40,2),
 ('badgeVisible',3,40,3),
 ('backgroundColor',1,40,1),
 ('borderColor',1,40,2),
 ('labelColor',2,40,1),
 ('shadow',2,28,2),
 ('radius',3,70,1),
 ('wrapText',1,28,1),
 ('headerBorderColor',1,40,2),
 ('headerTextColor',2,40,1),
 ('headerAlignment',3,28,1),
 ('headerBold',2,28,2),
 ('supportingBorderColor',1,40,1),
 ('supportingTextColor',1,40,2),
 ('supportingBold',2,28,1),
 ('supportingAlignment',2,28,2),
 ('iconFillColor',1,40,1),
 ('imagePlacement',1,70,1),
 ('imageFill',2,70,1),
 ('imageBorderColor',3,40,1),
 ('rowBorderColor',1,40,1),
 ('rowLabelColor',1,40,2),
 ('rowRadius',2,70,1),
 ('rowHeight',3,70,1),
 ('summaryBackgroundColor',1,40,1),
 ('summaryBorderColor',1,40,2),
 ('summaryRadius',1,70,3),
 ('summaryTextColor',2,40,1),
 ('summaryHeight',2,70,2),
 ('summaryWidth',2,70,3),
 ('summaryShadow',3,84,1),
 ('summaryTextSize',3,70,2),
 ('summaryTextWeight',3,28,3),
 ('summary2TextSize',1,70,1),
 ('summary2TextWeight',2,28,1),
 ('summary2TextColor',3,40,1),
 ('tableBackgroundColor',1,40,1),
 ('tableBorderColor',1,40,2),
 ('tableRadius',2,70,1),
 ('tableShadow',3,84,1),
 ('tabCount',1,58,1),
 ('selectedTabColor',2,40,1),
 ('tabColor',2,40,2),
 ('labelAlignment',1,28,1),
 ('defaultValueColor',2,40,1),
 ('textSize',2,70,2)
)
UPDATE md_builder_shared_properties AS p
 SET design_row=a.row_no,design_width=a.width_px,
     design_height=26,design_order=a.order_no
 FROM approved a
 WHERE p.property_key=a.property_key AND p.tab IN ('Design','Shapes')
   AND (p.design_row,p.design_width,p.design_height,p.design_order)
       IS DISTINCT FROM (a.row_no,a.width_px,26,a.order_no);

-- One 28px icon dropdown for alignment and the Body shadow selector.
UPDATE md_builder_shared_properties SET design_display='dropdown'
 WHERE property_key IN ('labelAlignment','headerAlignment','supportingAlignment','shadow')
 AND tab='Design' AND design_display IS DISTINCT FROM 'dropdown';

-- Caption widths are in addition to editor widths, in the same property.
WITH captions(property_key,caption,width_px) AS (
 VALUES ('badgeAlignment','Position',48),
        ('imagePlacement','Place',35),
        ('imageFill','Fit',35),
        ('tabCount','Tabs',35)
)
UPDATE md_builder_shared_properties AS p
 SET design_caption=c.caption,design_caption_width=c.width_px
 FROM captions c
 WHERE p.property_key=c.property_key AND p.tab IN ('Design','Shapes')
   AND (p.design_caption,p.design_caption_width) IS DISTINCT FROM (c.caption,c.width_px);
-- END ORIGINAL MIGRATION 20270205-three-row-design-shapes.sql

-- BEGIN ORIGINAL MIGRATION 20270206-three-row-ribbon-spacing.sql
-- Follow-up to the approved SQL-backed three-row Design ribbon.
-- Widen only the currently default-sized icon dropdowns, preserving tenant
-- customisations and all published component property values.
UPDATE md_builder_shared_properties
SET design_width = 35
WHERE tab = 'Design'
  AND design_display = 'dropdown'
  AND property_key IN ('shadow', 'labelAlignment', 'headerAlignment', 'supportingAlignment')
  AND design_width = 28;
-- END ORIGINAL MIGRATION 20270206-three-row-ribbon-spacing.sql

-- BEGIN ORIGINAL MIGRATION 20270207-page-builder-ribbon-sources-layout.sql
-- Page Builder ribbon consolidation: SQL-owned layout, idempotent, no saved page data changed.
UPDATE md_builder_shared_properties SET section_group='Values'
 WHERE tab='Data' AND property_key IN ('imageSource','textSource','badgeText');
UPDATE md_builder_shared_properties SET section_group='Others',
 label=CASE WHEN property_key='navigationDirection' THEN 'Navigation Placement' ELSE label END
 WHERE tab='Layout' AND property_key IN ('imageHeight','headerBoxHeight','navigationDirection');
UPDATE md_builder_shared_properties SET section_group='Component'
 WHERE tab='Layout' AND property_key IN ('width','height') AND section_group='Size';
UPDATE md_builder_shared_properties SET label='Object 1'
 WHERE property_key='objectApiName' AND tab='Data' AND label='Object';
INSERT INTO md_builder_shared_properties(property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT v.key,v.label,p.tab,'Source',p.control_kind,
 (SELECT COALESCE(MAX(sort_order),0) FROM md_builder_shared_properties)+v.seq,
 NULL,'[]'::jsonb,p.scope
FROM md_builder_shared_properties p
CROSS JOIN (VALUES('objectApiName2','Object 2',1),('objectApiName3','Object 3',2)) v(key,label,seq)
WHERE p.property_key='objectApiName'
ON CONFLICT(property_key) DO NOTHING;
INSERT INTO md_builder_ribbon_component_rules(
 component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT rule.component_api,v.key,rule.enabled,NULL,NULL,NULL,NULL
FROM md_builder_ribbon_component_rules rule
CROSS JOIN (VALUES('objectApiName2'),('objectApiName3')) v(key)
WHERE rule.property_key='objectApiName'
ON CONFLICT(component_api,property_key) DO NOTHING;
WITH arrangement(key,tab,grp,row_no,width_px,order_no,caption,caption_width) AS (
 VALUES
 ('objectApiName','Data','Source',1,145,1,'Object 1',52),
 ('objectApiName2','Data','Source',2,145,1,'Object 2',52),
 ('objectApiName3','Data','Source',3,145,1,'Object 3',52),
 ('label','Data','Values',1,225,1,'Label',42),
 ('defaultValue','Data','Values',1,225,2,'Default Value',87),
 ('imageSource','Data','Values',2,225,1,'Image Source',86),
 ('textSource','Data','Values',2,225,2,'Text Source',78),
 ('badgeText','Data','Values',3,225,1,'Badge Text',76),
 ('defaultCheck','Data','Values',3,55,2,'Default Check',88),
 ('imageHeight','Layout','Others',1,70,1,'Image Height',85),
 ('headerBoxHeight','Layout','Others',2,70,1,'Header Box Height',112),
 ('navigationDirection','Layout','Others',3,125,1,'Navigation Placement',131),
 ('width','Layout','Component',1,70,1,NULL,0),
 ('height','Layout','Component',2,70,1,NULL,0),
 ('tabWidth','Layout','Tabs',1,70,1,NULL,0),
 ('tabHeight','Layout','Tabs',2,70,1,NULL,0)
)
UPDATE md_builder_shared_properties p SET
 design_row=a.row_no,design_width=a.width_px,design_height=26,
 design_order=a.order_no,design_caption=a.caption,design_caption_width=a.caption_width
FROM arrangement a
WHERE p.property_key=a.key AND p.tab=a.tab AND p.section_group=a.grp;
-- END ORIGINAL MIGRATION 20270207-page-builder-ribbon-sources-layout.sql

-- BEGIN ORIGINAL MIGRATION 20270207-smart-cart-column-bindings.sql
-- Smart Cart-specific Data > Cart ribbon settings; global property registry reused.
-- Forward-only and idempotent. No page business records, published values or other apps changed.
WITH specs(n,property_key,label,control_kind,default_value,choices,field_select) AS (
 VALUES
 (1,'column2Source','Column 2 Source','expression',NULL::jsonb,'[]'::jsonb,true),
 (2,'column3Source','Column 3 Source','expression',NULL::jsonb,'[]'::jsonb,true),
 (3,'column4Source','Column 4 Source','expression',NULL::jsonb,'[]'::jsonb,true),
 (4,'column5Source','Column 5 Source','expression',NULL::jsonb,'[]'::jsonb,true),
 (5,'columnVisibility','Column Visibility','choice',
  '["Column 1","Column 2","Column 3","Column 4","Column 5"]'::jsonb,
  '["Column 1","Column 2","Column 3","Column 4","Column 5"]'::jsonb,false)
), missing AS (
 SELECT specs.*,row_number() OVER (ORDER BY n) AS pos FROM specs
 WHERE NOT EXISTS (SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
), last_order AS (SELECT COALESCE(MAX(sort_order),0) AS last_sort FROM md_builder_shared_properties)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,field_select,scope)
SELECT property_key,label,'Data','Cart',control_kind,last_sort+pos,default_value,choices,field_select,'component'
FROM missing CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

-- Add applicability only for Cart: every other app's property remains disabled.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_cart',p.property_key,true,NULL,NULL,NULL,NULL
FROM md_builder_shared_properties p
WHERE p.property_key IN ('column2Source','column3Source','column4Source','column5Source','columnVisibility')
ON CONFLICT(component_api,property_key) DO NOTHING;

-- Reuse the existing Cards per row setting as visible Cart lines before scrolling.
-- Do not change any saved page/component value or rules of other components.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_cart','cardsPerRow',true,NULL,NULL,'5'::jsonb,NULL
WHERE EXISTS(SELECT 1 FROM md_builder_shared_properties WHERE property_key='cardsPerRow')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true,
 default_value_override=COALESCE(md_builder_ribbon_component_rules.default_value_override,EXCLUDED.default_value_override);

-- Three-row SQL geometry consumed by the same shared property renderer.
WITH placements(key,slot,width_px,caption_px) AS (
 VALUES
 ('column2Source',1,178,104),
 ('column3Source',2,178,104),
 ('column4Source',1,178,104),
 ('column5Source',2,178,104),
 ('columnVisibility',3,145,104)
)
UPDATE md_builder_shared_properties p SET
 design_row=pl.slot,design_width=pl.width_px,design_height=26,
 design_order=CASE WHEN p.property_key IN ('column4Source','column5Source') THEN 2 ELSE 1 END,
 design_caption=p.label,design_caption_width=pl.caption_px
FROM placements pl
WHERE p.property_key=pl.key AND p.tab='Data' AND p.section_group='Cart'
 AND (p.design_row,p.design_width,p.design_height,p.design_order,p.design_caption,p.design_caption_width)
 IS DISTINCT FROM (pl.slot,pl.width_px,26,
  CASE WHEN p.property_key IN ('column4Source','column5Source') THEN 2 ELSE 1 END,
  p.label,pl.caption_px);
-- END ORIGINAL MIGRATION 20270207-smart-cart-column-bindings.sql

-- BEGIN ORIGINAL MIGRATION 20270208-page-builder-layout-ribbon-density.sql
-- Compact SQL-backed Page Builder Layout ribbon geometry.
-- Global presentation metadata only: preserves tenant pages, saved properties,
-- component applicability, version history and business records.
-- Safe to rerun: every target receives the same row/order/width.
WITH compact_layout(property_key, section_group, row_no, width_px) AS (
 VALUES
  ('x',               'Position',          1, 70),
  ('y',               'Position',          2, 70),
  ('cardsPerRow',     'Cards',             1, 70),
  ('cardsPerColumn',  'Cards',             2, 70),
  ('showDays',        'Calendar',          1, 60),
  ('firstDay',        'Calendar',          2, 84),
  ('supportingBoxHeight', 'Header Supporting', 1, 70)
)
UPDATE md_builder_shared_properties AS properties
SET design_row=compact_layout.row_no,
    design_order=1,
    design_width=compact_layout.width_px,
    design_height=26
FROM compact_layout
WHERE properties.tab='Layout'
  AND properties.section_group=compact_layout.section_group
  AND properties.property_key=compact_layout.property_key;
-- END ORIGINAL MIGRATION 20270208-page-builder-layout-ribbon-density.sql

-- BEGIN ORIGINAL MIGRATION 20270209-page-layout-version-archive.sql
-- Reversible version "delete": preserve immutable snapshots and all recovery paths.
-- App-seeded pages remain protected by the PageLayoutVersionRuntime owner guard.
ALTER TABLE md_page_layout_versions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE TABLE IF NOT EXISTS md_page_layout_version_archive_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL,
  variant text NOT NULL CHECK (variant IN ('Mobile','Desktop','Tablet','Custom')),
  version integer NOT NULL CHECK (version > 0),
  actor_user_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('Archive','Unarchive')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,page_id) REFERENCES md_lightning_page_details(tenant_id,page_id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES md_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS md_page_layout_version_archive_audit_lookup
  ON md_page_layout_version_archive_audit(tenant_id,page_id,variant,occurred_at DESC);
-- END ORIGINAL MIGRATION 20270209-page-layout-version-archive.sql

-- BEGIN ORIGINAL MIGRATION 20270209-relationship-target-row-lock.sql
-- Forward-only follow-up to 20270120-relationship-target-integrity.sql.
-- Never modify the original migration after production has recorded its checksum.
-- Refresh only the existing trigger function to lock the referenced record against
-- concurrent delete while validating a relationship target; retain trigger/indexes.
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
-- END ORIGINAL MIGRATION 20270209-relationship-target-row-lock.sql

-- BEGIN ORIGINAL MIGRATION 20270210-smart-cart-summary-bindings.sql
-- Additive, tenant-independent metadata: a Smart Cart shows real monetary amounts
-- only when a published Page State/Flow supplies them. No invented POS totals.
-- No tenant page, business record or customer-authored value is overwritten.
WITH specs(n,property_key,label) AS (
 VALUES
 (1,'subtotalValue','Subtotal Amount'),
 (2,'discountValue','Discount Amount'),
 (3,'taxValue','Tax Amount'),
 (4,'totalValue','Total Amount')
), missing AS (
 SELECT specs.*,row_number() OVER (ORDER BY n) AS pos FROM specs
 WHERE NOT EXISTS (SELECT 1 FROM md_builder_shared_properties p
                   WHERE p.property_key=specs.property_key)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS last_sort FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT property_key,label,'Data','Cart','expression',last_sort+pos,NULL,'[]'::jsonb,'component'
FROM missing CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_cart',p.property_key,true,NULL,NULL,NULL,NULL
FROM md_builder_shared_properties p
WHERE p.property_key IN ('subtotalValue','discountValue','taxValue','totalValue')
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270210-smart-cart-summary-bindings.sql

-- BEGIN ORIGINAL MIGRATION 20270210-tenant-api-casefold.sql
-- SQL-backed, opt-in normalization for a tenant's existing API metadata.
-- This migration installs the reusable operation. An operator invokes the function
-- explicitly for a test tenant after choosing that tenant; system startup never
-- silently renames any customer's metadata.
CREATE TABLE IF NOT EXISTS md_api_casefold_changes (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 old_name text NOT NULL,
 new_name text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,old_name),
 CHECK (new_name=lower(new_name))
);

CREATE OR REPLACE FUNCTION md_casefold_tenant_api_names(p_tenant uuid)
RETURNS integer LANGUAGE plpgsql AS $casefold$
DECLARE
 item record;
 fk record;
 mapping record;
 definitions text[] := ARRAY[
  'md_object_definitions','md_field_definitions','md_page_definitions',
  'md_component_definitions','md_flow_definitions','md_tenant_app_metadata',
  'md_global_value_sets','md_custom_labels','md_custom_metadata_types',
  'md_custom_metadata_fields','md_custom_settings','md_custom_setting_fields',
  'md_system_definitions','md_matching_rules','md_validation_rules',
  'md_field_default_formulas',
  'md_inbound_webhook_endpoints','md_webhook_subscriptions'
 ];
 structural text[] := ARRAY[
  'object_api','related_object','target_object','source_object_api','target_object_api',
  'parent_object_api','child_object_api','object_api_name',
  'field_api','controller_field_api','related_field_api','source_field_api',
  'target_field_api','rollup_field_api','filter_field_api','field_api_name',
  'page_api','page_api_name','target_page_api',
  'flow_api','flow_api_name','target_flow_api','trigger_flow_api',
  'component_api','component_api_name',
  'app_api','app_api_name','landing_app_api',
  'type_api','setting_api','source_api','target_api',
  'object_name','flow_name','page_name'
 ];
 touched integer := 0;
 count_rows integer;
 duplicate_exists boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM md_tenants WHERE id=p_tenant) THEN
  RAISE EXCEPTION 'Unknown tenant for API-name migration';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('metadrive:api-casefold'),hashtext(p_tenant::text));

 -- Fail rather than silently merge case-only conflicts. Installed casefold
 -- unique indexes normally protect these identities already.
 FOR item IN
  SELECT c.table_name FROM information_schema.columns c
  WHERE c.table_schema=current_schema()
   AND c.column_name='api_name' AND c.table_name=ANY(definitions)
  ORDER BY c.table_name
 LOOP
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE tenant_id=$1
     GROUP BY lower(api_name), %s HAVING count(*)>1)',
     item.table_name,
     CASE WHEN item.table_name='md_field_definitions' THEN 'object_api'
          WHEN item.table_name='md_custom_metadata_fields' THEN 'type_api'
          WHEN item.table_name='md_custom_setting_fields' THEN 'setting_api'
          WHEN item.table_name='md_custom_labels' THEN 'language'
          WHEN item.table_name='md_system_definitions' THEN 'kind'
          WHEN item.table_name IN ('md_matching_rules','md_validation_rules','md_field_default_formulas') THEN 'object_api'
          WHEN item.table_name='md_flow_definitions' THEN 'version'
          ELSE 'tenant_id' END)
   INTO STRICT duplicate_exists USING p_tenant;
  IF duplicate_exists THEN
   RAISE EXCEPTION 'Case-only API identity collision in %',item.table_name;
  END IF;
 END LOOP;

 -- Save a stable audit map before changing any definition identity. The
 -- record is not a backup and deliberately contains no business values.
 FOR item IN SELECT c.table_name FROM information_schema.columns c
  WHERE c.table_schema=current_schema()
   AND c.column_name='api_name' AND c.table_name=ANY(definitions)
  ORDER BY c.table_name
 LOOP
  EXECUTE format('INSERT INTO md_api_casefold_changes(tenant_id,old_name,new_name)
     SELECT DISTINCT tenant_id,api_name,lower(api_name) FROM %I
     WHERE tenant_id=$1 AND api_name<>lower(api_name)
     ON CONFLICT (tenant_id,old_name) DO NOTHING',item.table_name)
    USING p_tenant;
 END LOOP;
 FOR item IN SELECT c.table_name,c.column_name FROM information_schema.columns c
   WHERE c.table_schema=current_schema()
    AND (c.table_name='md_global_quick_actions' AND c.column_name='action_id')
     OR (c.table_name='md_named_credentials' AND c.column_name='name')
 LOOP
  EXECUTE format('INSERT INTO md_api_casefold_changes(tenant_id,old_name,new_name)
     SELECT DISTINCT tenant_id,%I,lower(%I) FROM %I
     WHERE tenant_id=$1 AND %I<>lower(%I)
     ON CONFLICT (tenant_id,old_name) DO NOTHING',
    item.column_name,item.column_name,item.table_name,item.column_name,item.column_name)
   USING p_tenant;
 END LOOP;

 -- Most existing FKs are NOT DEFERRABLE. Temporarily make them deferrable
 -- inside the *same* caller transaction, so changing referenced and referencing
 -- API strings does not trigger an intermediate invalid-FK state.
 CREATE TEMP TABLE IF NOT EXISTS md_casefold_fks(
  table_name text, constraint_name text, PRIMARY KEY(table_name,constraint_name)
 ) ON COMMIT DROP;
 TRUNCATE md_casefold_fks;
 INSERT INTO md_casefold_fks(table_name,constraint_name)
  SELECT c.conrelid::regclass::text,c.conname
  FROM pg_constraint c
  WHERE c.contype='f' AND NOT c.condeferrable
    AND c.connamespace='public'::regnamespace
    AND (c.conrelid::regclass::text LIKE 'md\_%' ESCAPE '\'
      OR c.confrelid::regclass::text LIKE 'md\_%' ESCAPE '\');
 FOR fk IN SELECT * FROM md_casefold_fks ORDER BY table_name,constraint_name LOOP
  EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',
    fk.table_name,fk.constraint_name);
 END LOOP;
 SET CONSTRAINTS ALL DEFERRED;

 -- Only columns whose SQL meaning is an API identifier are changed, and
 -- only when that value appears in an inventoried tenant identifier map.
 -- Core reserved permission names, platform app identities, component
 -- property keys and ordinary record values are NOT indiscriminately lowered.
 FOR item IN
  SELECT c.table_name,c.column_name FROM information_schema.columns c
  WHERE c.table_schema=current_schema()
    AND c.table_name LIKE 'md\_%' ESCAPE '\'
    AND c.data_type IN ('text','character varying')
    AND EXISTS(SELECT 1 FROM information_schema.columns t
       WHERE t.table_schema=c.table_schema AND t.table_name=c.table_name
         AND t.column_name='tenant_id')
    AND (
      c.column_name=ANY(structural)
      OR (c.column_name='api_name' AND c.table_name=ANY(definitions))
      OR (c.table_name='md_tenant_app_navigation' AND c.column_name='api_name')
      OR (c.table_name='md_flow_nodes' AND c.column_name='api_name')
      OR (c.table_name='md_global_quick_actions' AND c.column_name='action_id')
      OR (c.table_name='md_named_credentials' AND c.column_name='name')
    )
    AND NOT(c.table_name='md_app_route_aliases' AND c.column_name='app_api')
  ORDER BY c.table_name,c.column_name
 LOOP
  EXECUTE format('UPDATE %I t SET %I=m.new_name
    FROM md_api_casefold_changes m WHERE t.tenant_id=$1 AND m.tenant_id=$1
      AND t.%I=m.old_name AND m.old_name<>m.new_name',
    item.table_name,item.column_name,item.column_name) USING p_tenant;
  GET DIAGNOSTICS count_rows=ROW_COUNT;
  touched:=touched+count_rows;
 END LOOP;

 -- Some embedded references are stored as typed SQL metadata values, not
 -- FK columns. Rewrite token boundaries only in binding/formula-like values
 -- and exact-value identifiers; keep normal captions and record data intact.
 FOR mapping IN
  SELECT old_name,new_name FROM md_api_casefold_changes
  WHERE tenant_id=p_tenant AND old_name<>new_name
  ORDER BY length(old_name) DESC,old_name
 LOOP
  FOR item IN SELECT c.table_name,c.column_name FROM information_schema.columns c
    WHERE c.table_schema=current_schema()
     AND c.column_name='value_text'
     AND c.table_name=ANY(ARRAY[
       'md_lightning_page_node_properties','md_page_layout_version_properties',
       'md_page_component_properties','md_component_properties','md_page_properties',
       'md_flow_editor_values','md_flow_node_properties',
       'md_component_library_version_properties','md_object_layout_version_properties'
     ])
     AND EXISTS(SELECT 1 FROM information_schema.columns t
       WHERE t.table_schema=c.table_schema AND t.table_name=c.table_name
         AND t.column_name='tenant_id')
  LOOP
   -- Do not rewrite unrelated user-visible text. Property-path filtering is
   -- conservative; references in unknown keys are left for the audit check.
   count_rows:=0;
   IF EXISTS(SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=current_schema()
       AND c.table_name=item.table_name AND c.column_name='property_path') THEN
    EXECUTE format('UPDATE %I SET value_text=regexp_replace(value_text,
      $2,$3,''g'') WHERE tenant_id=$1 AND value_text IS NOT NULL
      AND (value_text=$4 OR property_path ~* $5) AND value_text ~ $2',
      item.table_name)
     USING p_tenant, '\m'||mapping.old_name||'\M',mapping.new_name,
       mapping.old_name,'(formula|bind|flow|action|object|field|page|app|source|target|reference|filter|query|expression|navigation)';
    GET DIAGNOSTICS count_rows=ROW_COUNT;
   ELSIF EXISTS(SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=current_schema()
       AND c.table_name=item.table_name AND c.column_name='api_name') THEN
    EXECUTE format('UPDATE %I SET value_text=regexp_replace(value_text,
      $2,$3,''g'') WHERE tenant_id=$1 AND value_text IS NOT NULL
      AND (value_text=$4 OR api_name ~* $5) AND value_text ~ $2',
      item.table_name)
     USING p_tenant, '\m'||mapping.old_name||'\M',mapping.new_name,
       mapping.old_name,'(formula|bind|flow|action|object|field|page|app|source|target|reference|filter|query|expression|navigation)';
    GET DIAGNOSTICS count_rows=ROW_COUNT;
   END IF;
   touched:=touched+count_rows;
  END LOOP;
 END LOOP;

 -- Tenant-owned global app rows are changed only when they belong to this
 -- tenant. Their route-alias foreign keys must change in the same transaction.
 -- Shared installed app definitions remain stable for other tenants.
 IF EXISTS(SELECT 1 FROM information_schema.columns c WHERE
   c.table_schema=current_schema() AND c.table_name='md_apps'
   AND c.column_name='tenant_owner_id') THEN
  UPDATE md_app_route_aliases r SET app_api=lower(r.app_api)
    FROM md_apps a WHERE a.api_name=r.app_api AND a.tenant_owner_id=p_tenant
      AND r.tenant_id=p_tenant AND r.app_api<>lower(r.app_api);
  UPDATE md_apps SET api_name=lower(api_name)
   WHERE tenant_owner_id=p_tenant AND api_name<>lower(api_name);
 END IF;

 -- Referential integrity is rechecked before committing, and original FK
 -- deferrability restored. Any failure aborts this entire invocation.
 SET CONSTRAINTS ALL IMMEDIATE;
 FOR fk IN SELECT * FROM md_casefold_fks ORDER BY table_name,constraint_name LOOP
  EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I NOT DEFERRABLE INITIALLY IMMEDIATE',
    fk.table_name,fk.constraint_name);
 END LOOP;
 RETURN touched;
END
$casefold$;
-- END ORIGINAL MIGRATION 20270210-tenant-api-casefold.sql

-- BEGIN ORIGINAL MIGRATION 20270211-eight-tab-ribbon-geometry.sql
-- Eight-tab Page Builder ribbon specification (31 Oct 2026).
-- Presentation metadata only: no saved component values, tenant records, rules or flows change.
-- All keys below were checked against the existing shared-property inventory and migrations.
-- Preserve existing icon components and colour controls in React.
UPDATE md_builder_shared_properties
 SET tab='Layout',
     section_group=CASE
       WHEN property_key='iconFillColor' THEN 'Icon'
       ELSE 'Image' END
 WHERE property_key IN ('imagePlacement','imageFill','imageBorderColor','iconFillColor')
   AND tab IN ('Design','Shapes','Layout');

UPDATE md_builder_shared_properties SET tab='Layout',section_group='Tabs'
 WHERE property_key='tabCount' AND tab IN ('Design','Layout');
UPDATE md_builder_shared_properties SET tab='Layout',section_group='Cards'
 WHERE property_key IN ('imageHeight','headerBoxHeight','supportingBoxHeight')
   AND tab='Layout';
UPDATE md_builder_shared_properties SET tab='Layout',section_group='Size & Position'
 WHERE property_key IN ('width','height','x','y') AND tab='Layout';

-- Existing Data formula values remain expressions. A formula box now contains its own label;
-- remove additional external caption tracks and keep two equal columns in Values.
WITH placements(property_key,group_name,row_no,order_no,width_px,caption,caption_px) AS (
 VALUES
 ('objectApiName','Source',1,1,145,'Object 1',52),
 ('objectApiName2','Source',2,1,145,'Object 2',52),
 ('objectApiName3','Source',3,1,145,'Object 3',52),
 ('label','Values',1,1,252,'Label',0),
 ('imageSource','Values',1,2,252,'Image source',0),
 ('defaultValue','Values',2,1,252,'Default value',0),
 ('textSource','Values',2,2,252,'Text source',0),
 ('badgeText','Values',3,1,252,'Badge text',0),
 ('defaultCheck','Values',3,2,42,'Default check',100),
 ('column2Source','Cart columns',1,1,252,'Column 2',0),
 ('column3Source','Cart columns',1,2,252,'Column 3',0),
 ('column4Source','Cart columns',2,1,252,'Column 4',0),
 ('column5Source','Cart columns',2,2,252,'Column 5',0),
 ('columnVisibility','Cart columns',3,1,145,'Column Visibility',0)
)
UPDATE md_builder_shared_properties AS p
 SET section_group=v.group_name,design_row=v.row_no,design_order=v.order_no,
 design_width=v.width_px,design_height=26,design_caption=v.caption,
 design_caption_width=v.caption_px
FROM placements v WHERE p.tab='Data' AND p.property_key=v.property_key;

-- Cart monetary bindings were added later than the mockup; keep them reachable
-- as an additional, disabled-for-other-components group, not silently deleted.
UPDATE md_builder_shared_properties SET section_group='Cart totals'
 WHERE tab='Data' AND property_key IN ('subtotalValue','discountValue','taxValue','totalValue');
WITH totals(property_key,row_no,order_no) AS (
 VALUES ('subtotalValue',1,1),('discountValue',1,2),('taxValue',2,1),('totalValue',2,2)
)
UPDATE md_builder_shared_properties AS p SET design_row=v.row_no,
 design_order=v.order_no,design_width=252,design_height=26,design_caption_width=0
FROM totals v WHERE p.tab='Data' AND p.property_key=v.property_key;

-- Ten fixed Design groups. Rows/track widths reflect the real 26px controls.
-- Existing components' icons/values are untouched; unsupported fields stay listed.
WITH geometry(property_key,section_group,row_no,order_no,width_px) AS (
 VALUES
 ('backgroundColor','Body',1,1,40),('borderColor','Body',1,2,40),
 ('labelColor','Body',2,1,40),('radius','Body',2,2,64),('shadow','Body',3,1,35),
 ('labelAlignment','Typography',1,1,35),('textSize','Typography',1,2,64),
 ('defaultValueColor','Typography',2,1,40),
 ('selectedTabColor','Tabs',1,1,40),('tabColor','Tabs',1,2,40),
 ('wrapText','Header',1,1,28),('headerBorderColor','Header',1,2,40),
 ('headerTextColor','Header',2,1,40),('headerBold','Header',2,2,28),
 ('headerAlignment','Header',3,1,35),
 ('badgeAlignment','Badge',1,1,84),('badgeVisible','Badge',1,2,28),
 ('badgeTextSize','Badge',2,1,64),('badgeBold','Badge',2,2,28),
 ('badgeBodyColor','Badge',3,1,40),('badgeTextColor','Badge',3,2,40),
 ('supportingBorderColor','Header Supporting',1,1,40),
 ('supportingTextColor','Header Supporting',1,2,40),
 ('supportingBold','Header Supporting',2,1,28),
 ('supportingAlignment','Header Supporting',2,2,35),
 ('tableBackgroundColor','Table',1,1,40),('tableBorderColor','Table',1,2,40),
 ('tableRadius','Table',2,1,64),('tableShadow','Table',2,2,35),
 ('rowBorderColor','Row',1,1,40),('rowLabelColor','Row',1,2,40),
 ('rowRadius','Row',2,1,64),('rowHeight','Row',2,2,64),
 ('summaryBackgroundColor','Summary',1,1,40),('summaryBorderColor','Summary',1,2,40),
 ('summaryRadius','Summary',1,3,64),('summaryTextColor','Summary',2,1,40),
 ('summaryHeight','Summary',2,2,64),('summaryWidth','Summary',2,3,64),
 ('summaryTextSize','Summary',3,1,64),('summaryTextWeight','Summary',3,2,28),
 ('summaryShadow','Summary',3,3,35),
 ('summary2TextSize','Summary 2',1,1,64),('summary2TextWeight','Summary 2',1,2,28),
 ('summary2TextColor','Summary 2',2,1,40)
)
UPDATE md_builder_shared_properties AS p SET section_group=v.section_group,
 design_row=v.row_no,design_order=v.order_no,design_width=v.width_px,design_height=26,
 design_caption_width=0
FROM geometry v WHERE p.tab='Design' AND p.property_key=v.property_key;

-- Retain the existing Position dropdown but remove its external width-reserving caption.
UPDATE md_builder_shared_properties
 SET design_width=84,design_caption='Position',design_caption_width=0
 WHERE tab='Design' AND property_key='badgeAlignment';

-- Layout: Size & Position, Tabs, Cards, Navigation, Calendar, Image and Icon.
-- Page and Canvas remain the existing metadata-backed controls rendered by the parent.
WITH geometry(property_key,group_name,row_no,order_no,width_px,caption,caption_px) AS (
 VALUES
 ('width','Size & Position',1,1,64,NULL,0),
 ('x','Size & Position',1,2,64,NULL,0),
 ('height','Size & Position',2,1,64,NULL,0),
 ('y','Size & Position',2,2,64,NULL,0),
 ('tabWidth','Tabs',1,1,64,NULL,0),
 ('tabHeight','Tabs',1,2,64,NULL,0),
 ('tabCount','Tabs',2,1,64,NULL,0),
 ('cardsPerRow','Cards',1,1,82,'Columns',0),
 ('cardsPerColumn','Cards',1,2,82,'Rows',0),
 ('imageHeight','Cards',2,1,64,NULL,0),
 ('headerBoxHeight','Cards',2,2,64,NULL,0),
 ('supportingBoxHeight','Cards',3,1,64,NULL,0),
 ('navigationDirection','Navigation',1,1,125,'Direction',0),
 ('showDays','Calendar',1,1,60,'Days',0),
 ('firstDay','Calendar',1,2,84,'First day',0),
 ('imagePlacement','Image',1,1,99,'Place',0),
 ('imageFill','Image',2,1,84,'Fit',0),
 ('imageBorderColor','Image',3,1,40,'Border',0),
 ('iconFillColor','Icon',1,1,40,'Icon colour',0)
)
UPDATE md_builder_shared_properties AS p SET section_group=v.group_name,
 design_row=v.row_no,design_order=v.order_no,design_width=v.width_px,
 design_height=26,design_caption=v.caption,design_caption_width=v.caption_px
FROM geometry v WHERE p.tab='Layout' AND p.property_key=v.property_key;
-- END ORIGINAL MIGRATION 20270211-eight-tab-ribbon-geometry.sql

-- BEGIN ORIGINAL MIGRATION 20270211-mcp-page-metadata-consent.sql
-- Authorise Page Builder authoring independently from business-record CRUD.
-- No existing OAuth client receives the new scope automatically; the owner must
-- explicitly grant the capability and renew consent. Existing grants are preserved.
ALTER TABLE md_oauth_client_scopes
 DROP CONSTRAINT IF EXISTS md_oauth_client_scopes_scope_check;
ALTER TABLE md_oauth_client_scopes
 ADD CONSTRAINT md_oauth_client_scopes_scope_check
 CHECK (scope IN ('records:read','records:write','metadata:read','metadata:write',
                 'flows:execute','mcp:access','operations:manage'));
-- END ORIGINAL MIGRATION 20270211-mcp-page-metadata-consent.sql

-- BEGIN ORIGINAL MIGRATION 20270211-page-device-inheritance.sql
-- Desktop is the shared parent. Device layout revisions may store only
-- visual/component deltas; historical full snapshots remain immutable.
ALTER TABLE md_page_layout_versions
 ADD COLUMN IF NOT EXISTS inherits_desktop boolean NOT NULL DEFAULT false;
ALTER TABLE md_page_layout_versions
 ADD COLUMN IF NOT EXISTS canvas_fill_override boolean NOT NULL DEFAULT false;
ALTER TABLE md_page_layout_versions
 ADD COLUMN IF NOT EXISTS desktop_base_version integer;
-- END ORIGINAL MIGRATION 20270211-page-device-inheritance.sql

-- BEGIN ORIGINAL MIGRATION 20270212-grouped-oauth-scope-catalogue.sql
-- Global, versioned OAuth scope catalogue for every Connected App.
-- Only entries with an existing route/tool contract are selectable.
-- Never assign any additional scope to existing clients or OAuth consents.
CREATE TABLE IF NOT EXISTS md_oauth_scope_catalogue(
 scope text PRIMARY KEY,
 group_key text NOT NULL,
 group_label text NOT NULL,
 label text NOT NULL,
 description text NOT NULL,
 risk text NOT NULL CHECK(risk IN ('standard','elevated','critical')),
 group_order integer NOT NULL,
 sort_order integer NOT NULL,
 assignable boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS md_oauth_scope_routes(
 scope text NOT NULL REFERENCES md_oauth_scope_catalogue(scope),
 verb text NOT NULL CHECK(verb IN ('GET','POST','PUT','PATCH','DELETE')),
 path_regex text NOT NULL CHECK(left(path_regex,6)='^/api/'),
 PRIMARY KEY(scope,verb,path_regex)
);
INSERT INTO md_oauth_scope_catalogue(scope,group_key,group_label,label,description,risk,group_order,sort_order,assignable) VALUES
 ('mcp:access','Connection','Connection & legacy','Use MCP transport','Access only the MetaDrive MCP endpoint; does not grant any tool itself.','standard',1,1,true),
 ('metadata:read','Connection','Connection & legacy','Legacy broad metadata read','Compatibility for existing clients; prefer specific scopes.','elevated',1,2,true),
 ('metadata:write','Connection','Connection & legacy','Legacy MCP metadata authoring','Compatibility for existing clients; prefer specific Builder manage scopes.','elevated',1,3,true),
 ('records:read','Records','Records, files & recovery','Read business records','Read ordinary tenant records using record/field RBAC.','standard',2,4,true),
 ('records:write','Records','Records, files & recovery','Write business records','Write tenant records using record/field RBAC.','elevated',2,5,true),
 ('records:import','Records','Records, files & recovery','Import records','Run generic Object data imports with validation.','elevated',2,6,true),
 ('records:export','Records','Records, files & recovery','Export data','Use approved record export endpoints when available.','elevated',2,7,false),
 ('recyclebin:read','Records','Records, files & recovery','Read recycle bin','Inspect soft-deleted records.','standard',2,8,true),
 ('recyclebin:manage','Records','Records, files & recovery','Restore or purge records','Restore/purge records under retention policies.','critical',2,9,true),
 ('files:read','Records','Records, files & recovery','Read files and media','Read existing file and media content with RBAC.','standard',2,10,true),
 ('files:manage','Records','Records, files & recovery','Manage files and media','Upload and remove attached files/media.','elevated',2,11,true),
 ('objects:read','Metadata','Objects & metadata','Inspect Objects','Read Object definitions, fields and schema metadata.','standard',3,12,true),
 ('objects:manage','Metadata','Objects & metadata','Create or update Objects','Create/change/deactivate Object definitions.','elevated',3,13,true),
 ('fields:read','Metadata','Objects & metadata','Inspect Fields','Read Field definitions and formula metadata.','standard',3,14,true),
 ('fields:manage','Metadata','Objects & metadata','Manage Fields','Create/update/delete/restore Fields and field metadata.','elevated',3,15,true),
 ('relationships:read','Metadata','Objects & metadata','Read relationships','Read Object relationship metadata.','standard',3,16,true),
 ('relationships:manage','Metadata','Objects & metadata','Manage relationships','Configure relationships through supported Object Field metadata.','elevated',3,17,false),
 ('custommetadata:read','Metadata','Objects & metadata','Read shared custom metadata','Custom Labels, Value Sets, Custom Settings and Custom Metadata Types.','standard',3,18,true),
 ('custommetadata:manage','Metadata','Objects & metadata','Manage shared custom metadata','Create/update scoped shared metadata.','elevated',3,19,true),
 ('pages:read','Builders','Builders & Actions','Read Page Builder pages','Read draft/published Page layout metadata.','standard',4,20,true),
 ('pages:manage','Builders','Builders & Actions','Manage and publish Pages','Create/edit/version/publish/activate Page Builder pages.','elevated',4,21,true),
 ('components:read','Builders','Builders & Actions','Read Smart Components','Inspect reusable component definitions and properties.','standard',4,22,true),
 ('components:manage','Builders','Builders & Actions','Manage Smart Components','Create/edit/publish/rollback reusable component metadata.','elevated',4,23,true),
 ('flows:read','Builders','Builders & Actions','Read Flow definitions','Read Flows, graph versions and history.','standard',4,24,true),
 ('flows:manage','Builders','Builders & Actions','Create/edit/activate Flows','Manage published and Screen Flow metadata.','elevated',4,25,true),
 ('actions:read','Builders','Builders & Actions','Read Actions','Read global Action metadata.','standard',4,26,true),
 ('actions:manage','Builders','Builders & Actions','Manage Actions','Create/update global action definitions.','elevated',4,27,true),
 ('dashboards:read','Builders','Builders & Actions','Read Dashboards','Read SQL dashboard metadata and subscriptions.','standard',4,28,true),
 ('dashboards:manage','Builders','Builders & Actions','Manage Dashboards','Manage dashboard definitions, snapshots and subscriptions.','elevated',4,29,true),
 ('reports:read','Builders','Builders & Actions','Read Reports','Read Reports, folders and run results.','standard',4,30,true),
 ('reports:manage','Builders','Builders & Actions','Manage Reports','Create/edit Report definitions and folders.','elevated',4,31,true),
 ('apps:read','Applications','Applications & licences','Read App Manager','Inspect application metadata, routes and navigation.','standard',5,32,true),
 ('apps:manage','Applications','Applications & licences','Manage applications','Change app metadata and route aliases.','elevated',5,33,true),
 ('appexchange:read','Applications','Applications & licences','Browse AppExchange','Discover available connector apps.','standard',5,34,true),
 ('appexchange:manage','Applications','Applications & licences','Install and manage apps','Install/activate/uninstall apps through lifecycle controller.','critical',5,35,true),
 ('licensing:read','Applications','Applications & licences','Read licences','Read tenant and platform licence assignments.','standard',5,36,true),
 ('licensing:manage','Applications','Applications & licences','Manage licences','Grant/revoke licences and entitlements.','critical',5,37,true),
 ('flows:execute','Automation','Automation & execution','Execute published Flows','Run permitted published Flows via runtime.','elevated',6,38,true),
 ('automation:read','Automation','Automation & execution','Inspect automation','Inspect execution history and interviews.','standard',6,39,true),
 ('automation:manage','Automation','Automation & execution','Manage automation executions','Schedule, debug and cancel Flow interviews.','elevated',6,40,true),
 ('approvals:read','Automation','Automation & execution','Read approvals','Inspect assigned approval inbox.','standard',6,41,true),
 ('approvals:manage','Automation','Automation & execution','Process approvals','Process approval decisions under RBAC.','elevated',6,42,true),
 ('events:publish','Automation','Automation & execution','Publish platform events','Publish events via durable shared outbox.','elevated',6,43,true),
 ('events:subscribe','Automation','Automation & execution','Manage event subscriptions','Manage versioned platform event subscriptions.','elevated',6,44,false),
 ('printing:execute','Automation','Automation & execution','Execute printing','Print through authorised Action/Flow runtime.','elevated',6,45,false),
 ('credentials:read','Integrations','Integrations & messaging','Read named credentials','Inspect credential configurations without secrets.','elevated',7,46,true),
 ('credentials:manage','Integrations','Integrations & messaging','Manage named credentials','Create/rotate/manage integration credentials.','critical',7,47,true),
 ('integrations:read','Integrations','Integrations & messaging','Read integrations','Inspect integration connector capabilities.','standard',7,48,true),
 ('integrations:manage','Integrations','Integrations & messaging','Manage integrations','Configure external connectors through standard metadata.','elevated',7,49,false),
 ('callouts:execute','Integrations','Integrations & messaging','Run HTTP callouts','Execute configured HTTP callouts via Flows.','elevated',7,50,false),
 ('webhooks:read','Integrations','Integrations & messaging','Read webhook configurations','Read subscribed webhooks (where exposed).','standard',7,51,false),
 ('webhooks:manage','Integrations','Integrations & messaging','Manage webhooks','Create/update incoming and outgoing webhooks.','elevated',7,52,false),
 ('communications:read','Integrations','Integrations & messaging','Read communications','Read communication records through OneEngine.','elevated',7,53,false),
 ('communications:send','Integrations','Integrations & messaging','Send communications','Email, WhatsApp, SMS via configured Flow connectors.','critical',7,54,false),
 ('notifications:read','Integrations','Integrations & messaging','Read notifications','Read permitted user notifications.','standard',7,55,true),
 ('notifications:send','Integrations','Integrations & messaging','Send notifications','Send notifications using shared communication runtime.','elevated',7,56,false),
 ('users:read','Security','Security, users & audit','Read Users','View user directory and reporting relationships.','elevated',8,57,true),
 ('users:manage','Security','Security, users & audit','Manage Users','Create/update/deactivate tenant users.','critical',8,58,true),
 ('security:read','Security','Security, users & audit','Inspect RBAC/security','Read permission sets and access policy metadata.','elevated',8,59,true),
 ('security:manage','Security','Security, users & audit','Manage RBAC/security','Update tenant permissions and authentication policies.','critical',8,60,true),
 ('audit:read','Security','Security, users & audit','Read audit trail','Read setup audit records.','elevated',8,61,true),
 ('audit:export','Security','Security, users & audit','Export audit trail','Download audited setup history.','critical',8,62,true),
 ('monitoring:read','Security','Security, users & audit','Read monitoring','Inspect transaction monitoring events.','elevated',8,63,true),
 ('monitoring:manage','Security','Security, users & audit','Manage monitoring','Change transaction security and monitoring policies.','critical',8,64,true),
 ('sessions:read','Security','Security, users & audit','Read sessions','Inspect own session state.','elevated',8,65,true),
 ('sessions:manage','Security','Security, users & audit','Manage sessions','Revoke permitted sessions.','critical',8,66,true),
 ('connectedapps:read','Security','Security, users & audit','Read Connected Apps','Read connected OAuth client configuration.','elevated',8,67,true),
 ('connectedapps:manage','Security','Security, users & audit','Manage Connected Apps','Create/change OAuth clients and consent grants.','critical',8,68,true),
 ('settings:read','Tenant','Tenant & settings','Read tenant settings','Company/calendar/currency/automation settings.','standard',9,69,true),
 ('settings:manage','Tenant','Tenant & settings','Manage tenant settings','Update company/calendar/currency and process settings.','elevated',9,70,true),
 ('tenants:read','Tenant','Tenant & settings','Read tenant administration','Inspect platform tenant administration.','critical',9,71,true),
 ('tenants:manage','Tenant','Tenant & settings','Manage tenant administration','Create/update tenant state and retention.','critical',9,72,true),
 ('support:read','Tenant','Tenant & settings','Read support cases','Inspect authorised platform recovery cases.','critical',9,73,true),
 ('support:manage','Tenant','Tenant & settings','Manage support access','Operate audited recovery/support flows.','critical',9,74,true),
 ('operations:read','Operations','OCI operations & recovery','Inspect OCI service status','Read API and worker status via audited MCP operations.','elevated',10,75,true),
 ('operations:manage','Operations','OCI operations & recovery','Manage OCI services','Restart API/worker and activate an immutable built release.','critical',10,76,true),
 ('deployments:read','Operations','OCI operations & recovery','Read deployments','Inspect deployment and CI status through existing GitHub integration.','elevated',10,77,false),
 ('deployments:manage','Operations','OCI operations & recovery','Manage deployments','Activate and roll back existing approved builds.','critical',10,78,false),
 ('sql:diagnostics','Operations','OCI operations & recovery','Read SQL diagnostics','Read approved database schema and migration health (no arbitrary SQL).','elevated',10,79,false),
 ('migrations:manage','Operations','OCI operations & recovery','Manage SQL migrations','Execute approved versioned migrations; never arbitrary statements.','critical',10,80,false),
 ('backups:read','Operations','OCI operations & recovery','Inspect backups','Inspect protected SQL backups and restore readiness.','critical',10,81,false),
 ('backups:manage','Operations','OCI operations & recovery','Manage backup recovery','Initiate approved restore after separate authorisation.','critical',10,82,false) ON CONFLICT(scope) DO NOTHING;
INSERT INTO md_oauth_scope_routes(scope,verb,path_regex) VALUES
 ('mcp:access','POST','^/api/mcp$'),
 ('metadata:read','GET','^/api/metadata/(objects|apps|pages|flows)(/|$)'),
 ('records:read','GET','^/api/records(/|$)'),
 ('records:write','POST','^/api/records/'),
 ('records:write','PUT','^/api/records/'),
 ('records:write','PATCH','^/api/records/'),
 ('records:write','DELETE','^/api/records/'),
 ('records:import','POST','^/api/records/[A-Za-z][A-Za-z0-9_]*/import$'),
 ('recyclebin:read','GET','^/api/recycle-bin(/|$)'),
 ('recyclebin:manage','POST','^/api/recycle-bin(/|$)'),
 ('recyclebin:manage','DELETE','^/api/recycle-bin(/|$)'),
 ('files:read','GET','^/api/(files|media-assets)(/|$)'),
 ('files:manage','POST','^/api/(files|media-assets)(/|$)'),
 ('files:manage','PUT','^/api/(files|media-assets)(/|$)'),
 ('files:manage','PATCH','^/api/(files|media-assets)(/|$)'),
 ('files:manage','DELETE','^/api/(files|media-assets)(/|$)'),
 ('objects:read','GET','^/api/metadata/(objects|relationships)(/|$)'),
 ('objects:manage','POST','^/api/metadata/objects$'),
 ('objects:manage','PUT','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*$'),
 ('objects:manage','DELETE','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*$'),
 ('fields:read','GET','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*/fields(/|$)'),
 ('fields:manage','POST','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*/fields(/|$)'),
 ('fields:manage','PUT','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*/fields(/|$)'),
 ('fields:manage','PATCH','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*/fields(/|$)'),
 ('fields:manage','DELETE','^/api/metadata/objects/[A-Za-z][A-Za-z0-9_]*/fields(/|$)'),
 ('relationships:read','GET','^/api/metadata/relationships(/|$)'),
 ('custommetadata:read','GET','^/api/metadata/(global-value-sets|custom-labels|custom-metadata-types|custom-settings)(/|$)'),
 ('custommetadata:manage','POST','^/api/metadata/(global-value-sets|custom-labels|custom-metadata-types|custom-settings)(/|$)'),
 ('custommetadata:manage','PUT','^/api/metadata/(global-value-sets|custom-labels|custom-metadata-types|custom-settings)(/|$)'),
 ('custommetadata:manage','PATCH','^/api/metadata/(global-value-sets|custom-labels|custom-metadata-types|custom-settings)(/|$)'),
 ('custommetadata:manage','DELETE','^/api/metadata/(global-value-sets|custom-labels|custom-metadata-types|custom-settings)(/|$)'),
 ('pages:read','GET','^/api/metadata/pages(/|$)'),
 ('pages:manage','POST','^/api/metadata/pages(/|$)'),
 ('pages:manage','PUT','^/api/metadata/pages(/|$)'),
 ('pages:manage','PATCH','^/api/metadata/pages(/|$)'),
 ('pages:manage','DELETE','^/api/metadata/pages(/|$)'),
 ('components:read','GET','^/api/(component-library|metadata/components)(/|$)'),
 ('components:manage','POST','^/api/component-library(/|$)'),
 ('components:manage','PUT','^/api/component-library(/|$)'),
 ('components:manage','PATCH','^/api/component-library(/|$)'),
 ('components:manage','DELETE','^/api/component-library(/|$)'),
 ('flows:read','GET','^/api/metadata/flows(/|$)'),
 ('flows:manage','POST','^/api/metadata/flows(/|$)'),
 ('flows:manage','PUT','^/api/metadata/flows(/|$)'),
 ('flows:manage','PATCH','^/api/metadata/flows(/|$)'),
 ('flows:manage','DELETE','^/api/metadata/flows(/|$)'),
 ('actions:read','GET','^/api/metadata/(global-actions|action-permission-options)(/|$)'),
 ('actions:manage','PUT','^/api/metadata/global-actions$'),
 ('dashboards:read','GET','^/api/metadata/dashboards(/|$)'),
 ('dashboards:manage','POST','^/api/metadata/dashboards(/|$)'),
 ('dashboards:manage','PUT','^/api/metadata/dashboards(/|$)'),
 ('dashboards:manage','PATCH','^/api/metadata/dashboards(/|$)'),
 ('dashboards:manage','DELETE','^/api/metadata/dashboards(/|$)'),
 ('reports:read','GET','^/api/metadata/(reports|report-folders)(/|$)'),
 ('reports:read','POST','^/api/reports/[A-Za-z][A-Za-z0-9_]*/run$'),
 ('reports:manage','POST','^/api/metadata/(reports|report-folders)(/|$)'),
 ('reports:manage','PUT','^/api/metadata/(reports|report-folders)(/|$)'),
 ('reports:manage','PATCH','^/api/metadata/(reports|report-folders)(/|$)'),
 ('reports:manage','DELETE','^/api/metadata/(reports|report-folders)(/|$)'),
 ('apps:read','GET','^/api/metadata/(apps|route-aliases)(/|$)'),
 ('apps:manage','POST','^/api/metadata/(apps|route-aliases)(/|$)'),
 ('apps:manage','PUT','^/api/metadata/(apps|route-aliases)(/|$)'),
 ('apps:manage','PATCH','^/api/metadata/(apps|route-aliases)(/|$)'),
 ('apps:manage','DELETE','^/api/metadata/(apps|route-aliases)(/|$)'),
 ('appexchange:read','GET','^/api/connector-apps/(catalog|capabilities)$'),
 ('appexchange:manage','POST','^/api/apps/[A-Za-z][A-Za-z0-9_]*/install$'),
 ('licensing:read','GET','^/api/security/licenses(/|$)'),
 ('licensing:manage','POST','^/api/security/licenses(/|$)'),
 ('licensing:manage','PUT','^/api/security/licenses(/|$)'),
 ('licensing:manage','PATCH','^/api/security/licenses(/|$)'),
 ('licensing:manage','DELETE','^/api/security/licenses(/|$)'),
 ('licensing:manage','POST','^/api/connector-apps/[A-Za-z][A-Za-z0-9_]*/licence$'),
 ('flows:execute','POST','^/api/flows/[A-Za-z][A-Za-z0-9_]*/(run|execute)$'),
 ('automation:read','GET','^/api/metadata/(flow-history|flow-logs|flow-interviews)(/|$)'),
 ('automation:manage','POST','^/api/flows/[A-Za-z][A-Za-z0-9_]*/(schedule|debug|debug-record)$'),
 ('automation:manage','POST','^/api/metadata/flow-interviews(/|$)'),
 ('approvals:read','GET','^/api/approvals/inbox$'),
 ('approvals:manage','POST','^/api/approvals/[A-Za-z0-9-]+/decision$'),
 ('events:publish','POST','^/api/platform-events/[A-Za-z][A-Za-z0-9_]*/publish$'),
 ('credentials:read','GET','^/api/named-credentials(/|$)'),
 ('credentials:manage','POST','^/api/named-credentials(/|$)'),
 ('credentials:manage','PUT','^/api/named-credentials(/|$)'),
 ('credentials:manage','PATCH','^/api/named-credentials(/|$)'),
 ('credentials:manage','DELETE','^/api/named-credentials(/|$)'),
 ('integrations:read','GET','^/api/connector-apps/(catalog|capabilities)$'),
 ('notifications:read','GET','^/api/notifications(/|$)'),
 ('users:read','GET','^/api/records/User(/|$)'),
 ('users:manage','POST','^/api/records/User(/|$)'),
 ('users:manage','PUT','^/api/records/User(/|$)'),
 ('users:manage','PATCH','^/api/records/User(/|$)'),
 ('users:manage','DELETE','^/api/records/User(/|$)'),
 ('security:read','GET','^/api/(security/permissions|metadata/permissions)(/|$)'),
 ('security:read','GET','^/api/auth/(security-events|user-locks|password-policy|mfa/policy)$'),
 ('security:manage','POST','^/api/(security/permissions|metadata/permissions)(/|$)'),
 ('security:manage','PUT','^/api/(security/permissions|metadata/permissions)(/|$)'),
 ('security:manage','PATCH','^/api/(security/permissions|metadata/permissions)(/|$)'),
 ('security:manage','DELETE','^/api/(security/permissions|metadata/permissions)(/|$)'),
 ('security:manage','PUT','^/api/auth/(password-policy|mfa/policy)$'),
 ('security:manage','POST','^/api/auth/users/[A-Za-z0-9-]+/(lock|unlock)$'),
 ('audit:read','GET','^/api/security/audit(/|$)'),
 ('audit:export','GET','^/api/security/audit/export$'),
 ('monitoring:read','GET','^/api/security/monitoring(/|$)'),
 ('monitoring:manage','PUT','^/api/security/monitoring(/|$)'),
 ('monitoring:manage','POST','^/api/security/monitoring(/|$)'),
 ('sessions:read','GET','^/api/auth/sessions$'),
 ('sessions:manage','POST','^/api/auth/sessions/revoke-all$'),
 ('connectedapps:read','GET','^/api/security/connected-apps$'),
 ('connectedapps:manage','PUT','^/api/security/connected-apps(/|$)'),
 ('connectedapps:manage','POST','^/api/security/connected-apps(/|$)'),
 ('settings:read','GET','^/api/tenant/(company-profile|business-calendar|offline-briefcase)$'),
 ('settings:read','GET','^/api/metadata/(currencies|automation-settings)$'),
 ('settings:manage','PUT','^/api/tenant/(company-profile|business-calendar|offline-briefcase)$'),
 ('settings:manage','PUT','^/api/metadata/(currencies|automation-settings)$'),
 ('tenants:read','GET','^/api/platform/tenants(/|$)'),
 ('tenants:manage','POST','^/api/platform/tenants(/|$)'),
 ('tenants:manage','PATCH','^/api/platform/tenants(/|$)'),
 ('support:read','GET','^/api/platform/recovery/cases(/|$)'),
 ('support:manage','POST','^/api/platform/recovery/cases(/|$)') ON CONFLICT DO NOTHING;
-- Replace the fixed seven-scope constraint with a platform-owned FK.
ALTER TABLE md_oauth_client_scopes DROP CONSTRAINT IF EXISTS md_oauth_client_scopes_scope_check;
ALTER TABLE md_oauth_client_scopes DROP CONSTRAINT IF EXISTS md_oauth_client_scopes_scope_fkey;
ALTER TABLE md_oauth_client_scopes ADD CONSTRAINT md_oauth_client_scopes_scope_fkey
 FOREIGN KEY(scope) REFERENCES md_oauth_scope_catalogue(scope);

-- Existing checks stay intact; new route scopes use the same consent/RBAC chain.
CREATE OR REPLACE FUNCTION md_oauth_token_allowed(t uuid,u uuid,h text,path text,verb text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM md_oauth_tokens WHERE token_hash=h)
 OR EXISTS(SELECT 1 FROM md_oauth_tokens b
  JOIN md_oauth_consents c ON c.tenant_id=b.tenant_id AND c.id=b.consent_id AND c.revoked_at IS NULL
  JOIN md_oauth_clients p ON p.tenant_id=c.tenant_id AND p.id=c.client_id AND p.enabled
  JOIN md_oauth_client_users a ON a.tenant_id=c.tenant_id AND a.client_id=c.client_id AND a.user_id=c.user_id
  JOIN md_oauth_consent_scopes s ON s.tenant_id=c.tenant_id AND s.consent_id=c.id
  JOIN md_oauth_client_scopes allowed ON allowed.tenant_id=c.tenant_id AND allowed.client_id=c.client_id AND allowed.scope=s.scope
  JOIN md_oauth_scope_catalogue cat ON cat.scope=s.scope AND cat.assignable=true
  WHERE b.token_hash=h AND b.kind='access' AND b.tenant_id=t AND c.user_id=u AND md_rbac_allowed(t,u,'API','execute')
  AND (
    (s.scope='mcp:access' AND path='/api/mcp' AND $5 IN ('POST','GET','DELETE'))
    OR EXISTS(SELECT 1 FROM md_oauth_scope_routes r
      WHERE r.scope=s.scope AND r.verb=$5 AND path ~ r.path_regex)
    -- Retain the pre-existing Salesforce-compatible data API permissions.
    OR (s.scope='records:read' AND $5='GET'
       AND path ~ '^/services/data/v[0-9.]+/(query|queryAll|search|sobjects)(/|$)')
    OR (s.scope='records:write' AND $5 IN ('POST','PUT','PATCH','DELETE')
       AND path ~ '^/services/data/v[0-9.]+/sobjects/')
  ))
$$;
-- END ORIGINAL MIGRATION 20270212-grouped-oauth-scope-catalogue.sql

-- BEGIN ORIGINAL MIGRATION 20270212-image-container-background-fill.sql
-- Add independent image/container background fill without changing existing body colours.
-- The shared fill palette offers No fill (transparent), theme colours and custom HEX.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  design_row,design_order,design_width,design_height,design_caption_width)
VALUES
 ('imageBackgroundColor','Background','Layout','Image','color',
  (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
  NULL::jsonb,'[]'::jsonb,'component',3,2,40,26,0)
ON CONFLICT(property_key) DO UPDATE SET
 label='Background',tab='Layout',section_group='Image',control_kind='color',
 design_row=3,design_order=2,design_width=40,design_height=26,design_caption_width=0;
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT c.component_api,'imageBackgroundColor',true,NULL,NULL,NULL,NULL
FROM (VALUES ('smart_image'),('smart_container')) AS c(component_api)
JOIN md_builder_ribbon_components rc ON rc.component_api=c.component_api
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270212-image-container-background-fill.sql

-- BEGIN ORIGINAL MIGRATION 20270213-compact-page-builder-ribbon-placements.sql
-- Place the existing Smart ribbon commands into the approved compact rows.
-- Geometry only: no component defaults, rendered colours, tenant values or Flows change.
-- The three-row editor remains SQL-driven and this update is safe to reapply.
WITH placement(tab_name,property_key,section_group,row_no,order_no) AS (
 VALUES
 -- Design: align, text colour and type size each have their own row.
 ('Design','labelAlignment','Typography',1,1),
 ('Design','defaultValueColor','Typography',2,1),
 ('Design','textSize','Typography',3,1),
 -- The two tab palettes are stacked rather than reserving a wide single row.
 ('Design','selectedTabColor','Tabs',1,1),
 ('Design','tabColor','Tabs',2,1),
 -- Table: colour palettes, radius, and shadow are three distinct rows.
 ('Design','tableBackgroundColor','Table',1,1),
 ('Design','tableBorderColor','Table',1,2),
 ('Design','tableRadius','Table',2,1),
 ('Design','tableShadow','Table',3,1),
 -- Row: colours first, radius second, height third.
 ('Design','rowBorderColor','Row',1,1),
 ('Design','rowLabelColor','Row',1,2),
 ('Design','rowRadius','Row',2,1),
 ('Design','rowHeight','Row',3,1),
 -- Layout: keep each tab dimension on its own row.
 ('Layout','tabWidth','Tabs',1,1),
 ('Layout','tabCount','Tabs',2,1),
 ('Layout','tabHeight','Tabs',3,1),
 -- Calendar: weekdays selector above first-day selector.
 ('Layout','showDays','Calendar',1,1),
 ('Layout','firstDay','Calendar',2,1)
)
UPDATE md_builder_shared_properties AS p
SET design_row=placement.row_no,design_order=placement.order_no
FROM placement
WHERE p.tab=placement.tab_name
 AND p.property_key=placement.property_key
 AND p.section_group=placement.section_group
 AND (p.design_row,p.design_order) IS DISTINCT FROM
     (placement.row_no,placement.order_no);
-- END ORIGINAL MIGRATION 20270213-compact-page-builder-ribbon-placements.sql

-- BEGIN ORIGINAL MIGRATION 20270213-global-smart-shapes.sql
-- One SQL-owned Layout Shape property, disabled unless a component opts in.
-- The same existing Shape/Icons gallery is reused. Only Button offers icons.
-- Historical smart_icon registrations and saved page instances remain readable.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  design_row,design_order,design_width,design_height,design_caption,design_caption_width)
VALUES
 ('shapeId','Shape','Layout','Shape','choice',
  (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
  '"shape:rectangle"'::jsonb,'["shapes"]'::jsonb,'component',
  1,1,102,26,'Shape',0)
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT c.component_api,'shapeId',true,NULL,NULL,
 CASE WHEN c.component_api='smart_toggle' THEN '"shape:oval"'::jsonb ELSE NULL END,
 CASE WHEN c.component_api='smart_button' THEN '["shapes","icons"]'::jsonb
 ELSE '["shapes"]'::jsonb END
FROM (VALUES ('smart_button'),('smart_container'),('smart_text'),('smart_toggle'),('smart_lookup'))
  AS c(component_api)
JOIN md_builder_ribbon_components r ON r.component_api=c.component_api
ON CONFLICT(component_api,property_key)
DO UPDATE SET enabled=true, choices_override=EXCLUDED.choices_override,
 default_value_override=EXCLUDED.default_value_override;

-- The existing icon glyph colour is now also available on Button.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_button','iconFillColor',true,NULL,NULL,NULL,NULL
WHERE EXISTS (SELECT 1 FROM md_builder_ribbon_components WHERE component_api='smart_button')
  AND EXISTS (SELECT 1 FROM md_builder_shared_properties WHERE property_key='iconFillColor')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270213-global-smart-shapes.sql

-- BEGIN ORIGINAL MIGRATION 20270214-automatic-active-record-scope.sql
-- Shared, optional active-record scoping for any Object-bound component.
-- Smart Cart defaults to active scoping in the shared runtime, without a
-- customer-authored filter; other components opt in using the Data ribbon.
-- No existing page data, metadata versions or tenant customisations are changed.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT 'autoRecordScope','Automatically use active record','Data','Records','boolean',
 COALESCE((SELECT MAX(sort_order) FROM md_builder_shared_properties),0)+1,
 'false'::jsonb,'[]'::jsonb,'component'
WHERE NOT EXISTS (
 SELECT 1 FROM md_builder_shared_properties WHERE property_key='autoRecordScope'
);

-- Reuse existing component Object source applicability as the authoritative list.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT component_api,'autoRecordScope',true,NULL,NULL,
 CASE WHEN component_api='smart_cart' THEN 'true'::jsonb ELSE NULL END,NULL
FROM md_builder_ribbon_component_rules
WHERE property_key='objectApiName' AND enabled=true
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270214-automatic-active-record-scope.sql

-- BEGIN ORIGINAL MIGRATION 20270214-smart-cart-data-ribbon-summary-labels.sql
-- Combine the existing cart column and summary expression slots in one
-- three-row Data group. Geometry/labels only: existing formulas and tenant
-- component properties are untouched.
WITH placement(property_key,row_no,order_no,width_px,new_label) AS (
 VALUES
 ('column2Source',1,1,252,NULL),
 ('column3Source',1,2,252,NULL),
 ('subtotalValue',1,3,227,'Summary 1'),
 ('column4Source',2,1,252,NULL),
 ('column5Source',2,2,252,NULL),
 ('totalValue',2,3,227,'Summary 2'),
 ('columnVisibility',3,1,145,NULL),
 ('taxValue',3,2,227,'Summary 3'),
 ('discountValue',3,3,227,'Summary 4')
)
UPDATE md_builder_shared_properties AS p
SET section_group='Cart',
    design_row=v.row_no,
    design_order=v.order_no,
    design_width=v.width_px,
    design_height=26,
    design_caption_width=0,
    label=COALESCE(v.new_label,p.label),
    design_caption=COALESCE(v.new_label,p.design_caption)
FROM placement v
WHERE p.tab='Data' AND p.property_key=v.property_key;

-- The four visible summary labels are stored in the cart component properties
-- (subtotalLabel/totalLabel/taxLabel/discountLabel) by the inline ribbon editor.
-- They are intentionally not extra ribbon slots; published pages retain their
-- previous labels until an author explicitly changes one.
-- END ORIGINAL MIGRATION 20270214-smart-cart-data-ribbon-summary-labels.sql

-- BEGIN ORIGINAL MIGRATION 20270215-design-shape-fill-ribbon.sql
-- Shared Shape ribbon layout and surface-fill control.
-- Shape geometry is the existing shared component property; Shape Fill is a
-- second editor for the existing effective surface colour, not new runtime data.
-- Metadata only: saved pages, tenant customisations and records are untouched.

-- Move the previously registered Shape gallery from Layout to Design, with
-- the approved full 94px editor track, not the generic choice shrink.
UPDATE md_builder_shared_properties
SET tab='Design', section_group='Shape',
    design_row=1, design_order=1, design_width=94, design_height=26,
    design_caption='Shape', design_caption_width=0
WHERE property_key='shapeId'
  AND (tab,section_group,design_row,design_order,design_width,design_height,
       design_caption,design_caption_width)
      IS DISTINCT FROM ('Design','Shape',1,1,94,26,'Shape',0);

-- Reuse the same shared Fill colour-picker UI as Body Color. An alias rule
-- writes the existing runtime colour field: backgroundColor for native shapes,
-- imageBackgroundColor for Container (its effective surface fill).
INSERT INTO md_builder_shared_properties
  (property_key,label,tab,section_group,control_kind,sort_order,default_value,
   choices,scope,design_row,design_order,design_width,design_height,
   design_caption,design_caption_width)
VALUES
  ('shapeFill','Shape Fill','Design','Shape','color',
   (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
   NULL::jsonb,'[]'::jsonb,'component',2,1,40,26,'Shape Fill',0)
ON CONFLICT(property_key) DO NOTHING;

-- Only the five shape-capable components enable this slot. Disabled inventory
-- remains visible for all other components, like the other shared ribbon slots.
INSERT INTO md_builder_ribbon_component_rules
  (component_api,property_key,enabled,control_kind_override,value_key,
   default_value_override,choices_override)
SELECT c.component_api,'shapeFill',true,NULL,
       CASE WHEN c.component_api='smart_container'
            THEN 'imageBackgroundColor' ELSE 'backgroundColor' END,
       NULL,NULL
FROM (VALUES
  ('smart_button'),('smart_toggle'),('smart_lookup'),
  ('smart_text'),('smart_container')
) AS c(component_api)
JOIN md_builder_ribbon_components registered
  ON registered.component_api=c.component_api
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270215-design-shape-fill-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270215-smart-ribbon-data-design-geometry.sql
-- Shared Page Builder ribbon corrections (1 Nov 2026).
-- Presentation metadata only: no tenant records, expressions, Flows, published
-- pages, permissions or component values are modified. Re-running is safe.
-- Column Visibility is intentionally untouched; its visual alignment is CSS.
WITH geometry(property_key,group_name,row_no,col_no,width_px,caption) AS (
 VALUES
 ('objectApiName','Source',1,1,150,NULL),
 ('objectApiName2','Source',2,1,150,NULL),
 ('objectApiName3','Source',3,1,150,NULL),
 ('label','Values',1,1,225,'Label'),
 ('imageSource','Values',1,2,225,'Image'),
 ('defaultValue','Values',2,1,225,'Default value'),
 ('textSource','Values',2,2,225,'Text'),
 ('badgeText','Values',3,1,225,'Badge text'),
 ('defaultCheck','Values',3,2,225,'Default check'),
 ('column2Source','Cart',1,1,225,NULL),
 ('column3Source','Cart',1,2,225,NULL),
 ('subtotalValue','Cart',1,3,225,'Summary 1'),
 ('column4Source','Cart',2,1,225,NULL),
 ('column5Source','Cart',2,2,225,NULL),
 ('totalValue','Cart',2,3,225,'Summary 2'),
 ('taxValue','Cart',3,2,225,'Summary 3'),
 ('discountValue','Cart',3,3,225,'Summary 4')
)
UPDATE md_builder_shared_properties AS p
SET section_group=g.group_name,
    design_row=g.row_no,
    design_order=g.col_no,
    design_width=g.width_px,
    design_height=26,
    design_caption_width=CASE WHEN p.property_key IN
      ('objectApiName','objectApiName2','objectApiName3') THEN 52 ELSE 0 END,
    design_caption=COALESCE(g.caption,p.design_caption)
FROM geometry g
WHERE p.tab='Data' AND p.property_key=g.property_key;

-- Exact Design tab row/column positions and rendered control widths from the
-- approved property table. Disabled/unsupported controls keep their slots.
WITH geometry(property_key,group_name,row_no,col_no,width_px) AS (
 VALUES
 ('badgeAlignment','Badge',1,1,125),
 ('badgeTextSize','Badge',2,1,58),
 ('badgeBold','Badge',2,2,28),
 ('badgeBodyColor','Badge',3,1,40),
 ('badgeTextColor','Badge',3,2,40),
 ('badgeVisible','Badge',3,3,28),
 ('backgroundColor','Body',1,1,40),
 ('borderColor','Body',1,2,40),
 ('labelColor','Body',2,1,40),
 ('radius','Body',2,2,58),
 ('shadow','Body',3,1,105),
 ('wrapText','Header',1,1,28),
 ('headerBorderColor','Header',1,2,40),
 ('headerTextColor','Header',2,1,40),
 ('headerBold','Header',2,2,28),
 ('headerAlignment','Header',3,1,35),
 ('supportingBorderColor','Header Supporting',1,1,40),
 ('supportingTextColor','Header Supporting',1,2,40),
 ('supportingBold','Header Supporting',2,1,28),
 ('supportingAlignment','Header Supporting',2,2,35),
 ('rowBorderColor','Row',1,1,40),
 ('rowLabelColor','Row',1,2,40),
 ('rowRadius','Row',2,1,58),
 ('rowHeight','Row',3,1,58),
 ('summaryBackgroundColor','Summary',1,1,40),
 ('summaryBorderColor','Summary',1,2,40),
 ('summaryRadius','Summary',1,3,58),
 ('summaryTextColor','Summary',2,1,40),
 ('summaryHeight','Summary',2,2,58),
 ('summaryWidth','Summary',2,3,58),
 ('summaryTextSize','Summary',3,1,58),
 ('summaryTextWeight','Summary',3,2,28),
 ('summaryShadow','Summary',3,3,105),
 ('summary2TextSize','Summary 2',1,1,58),
 ('summary2TextWeight','Summary 2',1,2,28),
 ('summary2TextColor','Summary 2',2,1,40),
 ('tableBackgroundColor','Table',1,1,40),
 ('tableBorderColor','Table',1,2,40),
 ('tableRadius','Table',2,1,58),
 ('tableShadow','Table',3,1,35),
 ('selectedTabColor','Tabs',1,1,40),
 ('tabColor','Tabs',2,1,40),
 ('labelAlignment','Typography',1,1,35),
 ('defaultValueColor','Typography',2,1,40),
 ('textSize','Typography',3,1,58)
)
UPDATE md_builder_shared_properties AS p
SET section_group=g.group_name,
    design_row=g.row_no,
    design_order=g.col_no,
    design_width=g.width_px,
    design_height=26,
    design_caption_width=0
FROM geometry g
WHERE p.tab='Design' AND p.property_key=g.property_key;

-- Badge Alignment displays "Alignment | Value" within its 125px box.
UPDATE md_builder_shared_properties
SET design_caption='Alignment',design_caption_width=0
WHERE tab='Design' AND property_key='badgeAlignment';

-- Body and Summary shadow use three inline choices across 105px.
-- Keep Table Shadow's existing 35px dropdown unchanged.
UPDATE md_builder_shared_properties
SET design_display='buttons'
WHERE tab='Design' AND property_key IN ('shadow','summaryShadow');

UPDATE md_builder_shared_properties
SET design_display='dropdown'
WHERE tab='Design' AND property_key='tableShadow';
-- END ORIGINAL MIGRATION 20270215-smart-ribbon-data-design-geometry.sql

-- BEGIN ORIGINAL MIGRATION 20270216-data-selected-field-formula-ribbon.sql
-- Data tab field-chip geometry for the selected-field shared Formula bar.
-- Additive and idempotent: SQL remains the source of truth for layout;
-- no edits to records, Flows, data bindings, licenses or user-custom values.
-- The Source group remains three rows; all other groups use two rows.
WITH slots(property_key,group_name,row_no,col_no,width_px,caption) AS (
 VALUES
 -- Values row 1: image, text, label. Row 2: badge, default, checkbox.
 ('imageSource','Values',1,1,144,'Image'),
 ('textSource','Values',1,2,144,'Text'),
 ('label','Values',1,3,144,'Label'),
 ('badgeText','Values',2,1,144,'Badge text'),
 ('defaultValue','Values',2,2,144,'Default value'),
 ('defaultCheck','Values',2,3,150,'Default check'),
 -- Column 1 is the cart's existing Text binding; do not invent a parallel key.
 ('column2Source','Cart',1,1,144,'Column 2'),
 ('column3Source','Cart',1,2,144,'Column 3'),
 ('subtotalValue','Cart',1,3,144,'Summary 1'),
 ('taxValue','Cart',1,4,144,'Summary 3'),
 ('column4Source','Cart',2,1,144,'Column 4'),
 ('column5Source','Cart',2,2,144,'Column 5'),
 ('totalValue','Cart',2,3,144,'Summary 2'),
 ('discountValue','Cart',2,4,144,'Summary 4'),
 ('columnVisibility','Cart',2,5,150,'Visibility')
)
UPDATE md_builder_shared_properties p
SET section_group=slots.group_name,
    design_row=slots.row_no,
    design_order=slots.col_no,
    design_width=slots.width_px,
    design_height=26,
    design_caption=slots.caption,
    design_caption_width=0
FROM slots
WHERE p.tab='Data' AND p.property_key=slots.property_key;
-- END ORIGINAL MIGRATION 20270216-data-selected-field-formula-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270217-data-ribbon-compact-widths.sql
-- Presentation-only widths; persisted formulas and tenant business records are unchanged.
-- Existing 144px Data chips become 100px, the 150px non-formula boxes 105px.
-- Native ribbon horizontal overflow stays enabled and disappears when content fits.
UPDATE md_builder_shared_properties
SET design_width=CASE WHEN property_key IN ('defaultCheck','columnVisibility') THEN 105 ELSE 100 END,
    design_height=26,
    design_caption_width=0
WHERE tab='Data' AND section_group IN ('Values','Cart','Cart columns','Cart totals')
AND property_key IN (
'imageSource','textSource','label','badgeText','defaultValue','defaultCheck',
'column2Source','column3Source','column4Source','column5Source',
'subtotalValue','totalValue','taxValue','discountValue','columnVisibility'
);
-- END ORIGINAL MIGRATION 20270217-data-ribbon-compact-widths.sql

-- BEGIN ORIGINAL MIGRATION 20270218-data-ribbon-cart-geometry.sql
-- Additive Data-tab geometry correction. Metadata placement is SQL-owned.
-- 100px expression chips => 110px; 105px Default Check => 116px.
-- Column Visibility previously occupied a 105px SQL slot while its actual
-- multiselect control rendered at 155px. Give it a 171px matching track.
-- Do not mutate customer pages, saved formulas, selection or record data.
UPDATE md_builder_shared_properties
SET design_width=CASE
  WHEN property_key='columnVisibility' THEN 171
  WHEN property_key='defaultCheck' THEN 116
  ELSE 110
END
WHERE tab='Data'
  AND section_group IN ('Values','Cart','Cart columns','Cart totals')
  AND property_key IN (
    'imageSource','textSource','label','badgeText','defaultValue','defaultCheck',
    'column2Source','column3Source','column4Source','column5Source',
    'subtotalValue','totalValue','taxValue','discountValue','columnVisibility'
  );
-- END ORIGINAL MIGRATION 20270218-data-ribbon-cart-geometry.sql

-- BEGIN ORIGINAL MIGRATION 20270301-universal-page-context-source.sql
-- Universal Data ribbon Context selector for every registered data-bound component.
-- Definitions remain a single shared SQL property; only Object-binding components are eligible.
WITH position AS (SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM md_builder_shared_properties)
INSERT INTO md_builder_shared_properties
(property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT 'contextApiName','Context','Data','Source','choice',position.next,NULL,'[]'::jsonb,'component'
FROM position
ON CONFLICT(property_key) DO NOTHING;
INSERT INTO md_builder_ribbon_component_rules
(component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT r.component_api,'contextApiName',true,NULL,NULL,NULL,NULL
FROM md_builder_ribbon_component_rules r
JOIN md_builder_ribbon_components c ON c.component_api=r.component_api
WHERE r.property_key='objectApiName' AND r.enabled=true
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270301-universal-page-context-source.sql

-- BEGIN ORIGINAL MIGRATION 20270302-smart-tabs-optional-first-tab.sql
-- Optional first tab for Smart Tabs, using the global SQL-owned property inventory.
-- Does not create an Object record or alter existing category tabs, tenant values, or other apps.
WITH specs(property_key,label,control_kind,default_value,design_row,design_order,design_width,design_caption_width) AS (
 VALUES
 ('firstTabCustom','Custom First Tab','boolean','false'::jsonb,1,2,28,98),
 ('firstTabCaption','First Tab Caption','expression',NULL::jsonb,2,2,180,105)
), missing AS (
 SELECT specs.*,row_number() OVER (ORDER BY design_row) AS pos
 FROM specs WHERE NOT EXISTS (
   SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS last_sort FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  design_row,design_order,design_width,design_height,design_caption,design_caption_width)
SELECT property_key,label,'Design','Tabs',control_kind,last_sort+pos,default_value,'[]'::jsonb,'component',
 design_row,design_order,design_width,26,label,design_caption_width
FROM missing CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_tabs',p.property_key,true,NULL,NULL,NULL,NULL
FROM md_builder_shared_properties p
WHERE p.property_key IN ('firstTabCustom','firstTabCaption')
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270302-smart-tabs-optional-first-tab.sql

-- BEGIN ORIGINAL MIGRATION 20270303-universal-named-collection-formula.sql
-- One universal named COLLECTION source. Formula output is a typed collection,
-- not a new business record. Existing SQL Object filters remain the source of truth.
WITH spec AS (
 SELECT COALESCE(MAX(sort_order),0)+1 AS sort FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  field_select)
SELECT 'collectionFormula','Collection','Data','Source','expression',spec.sort,
 NULL,'[]'::jsonb,'component',true
FROM spec ON CONFLICT(property_key) DO NOTHING;

-- Only record-collection consumers get a source editor; the Formula Engine itself
-- is not tied to these components and supports Flow and other binding contexts.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT component_api,'collectionFormula',true,NULL,NULL,NULL,NULL
FROM md_builder_ribbon_components
WHERE component_api IN ('smart_tabs','smart_card_grid','smart_navigation','smart_lookup',
 'smart_cart','ui_item_grid','ui_repeater','ui_record_list')
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270303-universal-named-collection-formula.sql

-- BEGIN ORIGINAL MIGRATION 20270304-smart-tabs-custom-selected-value.sql
-- Universal selected-value property for custom leading tabs.
-- Existing custom tabs continue using "*" unless an explicit ID or expression is supplied.
WITH spec AS (
 SELECT COALESCE(MAX(sort_order),0)+1 AS sort FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  design_row,design_order,design_width,design_height,design_caption,design_caption_width)
SELECT 'firstTabValue','First Tab ID','Design','Tabs','expression',spec.sort,'"*"'::jsonb,
 '[]'::jsonb,'component',3,2,160,26,'ID',42 FROM spec
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT 'smart_tabs','firstTabValue',true,NULL,NULL,NULL,NULL
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270304-smart-tabs-custom-selected-value.sql

-- BEGIN ORIGINAL MIGRATION 20270305-retire-smart-tabs-custom-first-tab.sql
-- Smart Tabs now obtain every tab (including index zero) from the same
-- authored Collection/Object source. Retire the three redundant synthetic-tab
-- controls. Preserve existing SQL metadata and customer-authored page values;
-- do not mutate published pages, objects, records or tenant customisations.
-- This also executes on fresh installs AFTER the original additive migrations.
UPDATE md_builder_ribbon_component_rules
SET enabled=false
WHERE component_api='smart_tabs'
  AND property_key IN ('firstTabCustom','firstTabCaption','firstTabValue');
-- END ORIGINAL MIGRATION 20270305-retire-smart-tabs-custom-first-tab.sql

-- BEGIN ORIGINAL MIGRATION 20270306-smart-card-button-tabs-orientation.sql
-- Shared Smart component extensions only. Re-runnable, additive and tenant-safe.
-- Existing pages, Flows, field rules, metadata values and component permissions stay untouched.
WITH base AS (SELECT COALESCE(MAX(sort_order),0) AS last_order FROM md_builder_shared_properties),
spec(property_key,label,tab,section_group,control_kind,ordinal,default_json,choice_json,row_no,col_no,width_px) AS (
 VALUES
 ('cardDescription','Description','Data','Card Grid','expression',1,NULL::text,'[]',1,1,144),
 ('cardValue','Value / Price','Data','Card Grid','expression',2,NULL::text,'[]',1,2,144),
 ('cardButtonText','Button Text','Data','Card Grid','expression',3,NULL::text,'[]',2,1,144),
 ('cardButtonFill','Button Fill','Design','Button','color',4,NULL::text,'[]',1,1,40),
 ('cardButtonBorderColor','Button Border','Design','Button','color',5,NULL::text,'[]',1,2,40),
 ('cardButtonShape','Button Shape','Design','Button','choice',6,'"shape:round-rectangle"','["shape:rectangle","shape:round-rectangle","shape:oval"]',2,1,94),
 ('cardButtonTextSize','Button Text Size','Design','Button','number',7,'14','[]',2,2,58),
 ('cardButtonTextColor','Button Font Color','Design','Button','color',8,NULL::text,'[]',3,1,40),
 ('tabOrientation','Orientation','Layout','Tabs','choice',9,'"horizontal"','["horizontal","vertical"]',2,2,116)
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope,
  field_select,design_row,design_order,design_width,design_height,design_caption_width)
SELECT s.property_key,s.label,s.tab,s.section_group,s.control_kind,
 base.last_order+s.ordinal,s.default_json::jsonb,s.choice_json::jsonb,'component',
 s.control_kind='expression',s.row_no,s.col_no,s.width_px,26,0
FROM spec s CROSS JOIN base
ON CONFLICT(property_key) DO NOTHING;

-- SQL owns the global ribbon inventory and per-component applicability.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,default_value_override,choices_override)
SELECT v.component_api,v.property_key,true,NULL,NULL,NULL,NULL
FROM (VALUES
 ('smart_card_grid','cardDescription'),
 ('smart_card_grid','cardValue'),
 ('smart_card_grid','cardButtonText'),
 ('smart_card_grid','cardButtonFill'),
 ('smart_card_grid','cardButtonBorderColor'),
 ('smart_card_grid','cardButtonShape'),
 ('smart_card_grid','cardButtonTextSize'),
 ('smart_card_grid','cardButtonTextColor'),
 ('smart_card_grid','imageBackgroundColor'),
 ('smart_tabs','tabOrientation')
) AS v(component_api,property_key)
JOIN md_builder_ribbon_components c ON c.component_api=v.component_api
JOIN md_builder_shared_properties p ON p.property_key=v.property_key
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270306-smart-card-button-tabs-orientation.sql

-- BEGIN ORIGINAL MIGRATION 20270306-smart-cart-header-body-color.sql
-- Add the Smart Cart Header Body Color control without changing shared Header
-- slots for Card Grid/Image or existing published Cart component values.
-- Unset values preserve the legacy blue (#255d9d) in the Cart renderer.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,
  default_value,choices,scope,design_row,design_order,design_width,
  design_height,design_caption_width)
SELECT 'headerBodyColor','Header Body Color','Design','Header','color',
       (SELECT COALESCE(MAX(sort_order),0)+1 FROM md_builder_shared_properties),
       NULL,'[]'::jsonb,'component',3,2,35,26,0
WHERE NOT EXISTS (
 SELECT 1 FROM md_builder_shared_properties WHERE property_key='headerBodyColor'
)
ON CONFLICT(property_key) DO NOTHING;

-- The property is editable only on smart_cart; other components retain their
-- global inventory and disabled/unsupported states.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT 'smart_cart','headerBodyColor',true
FROM md_builder_shared_properties
WHERE property_key='headerBodyColor'
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270306-smart-cart-header-body-color.sql

-- BEGIN ORIGINAL MIGRATION 20270307-smart-cart-selected-row-image-caption.sql
-- Extend Smart Cart selection and the existing Smart Image caption typography.
-- This is forward-only builder metadata: no tenant page, record, or Flow edits.
-- Unset selected-row values retain the existing renderer colours.
WITH specs(property_key,label,row_no,col_no) AS (
 VALUES
 ('selectedRowColor','Selected Row Color',2,2),
 ('selectedRowBorderColor','Selected Row Border',3,2)
), missing AS (
 SELECT s.*,row_number() OVER (ORDER BY row_no) AS position
 FROM specs s
 WHERE NOT EXISTS (
  SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key
 )
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS final_order FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,design_row,design_order,design_width,design_height,design_caption_width)
SELECT property_key,label,'Design','Row','color',last_order.final_order+missing.position,
       NULL,'[]'::jsonb,'component',row_no,col_no,40,26,0
FROM missing CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

-- Smart Image already renders a caption from textSource; enable the existing
-- global label controls instead of introducing duplicate Image-only properties.
-- Controls keep their original placement: Body R2/C1; Typography R1/C1, R3/C1.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT supported.component_api,supported.property_key,true
FROM (VALUES
 ('smart_cart','selectedRowColor'),
 ('smart_cart','selectedRowBorderColor'),
 ('smart_image','labelColor'),
 ('smart_image','labelAlignment'),
 ('smart_image','textSize')
) AS supported(component_api,property_key)
JOIN md_builder_ribbon_components c ON c.component_api=supported.component_api
JOIN md_builder_shared_properties p ON p.property_key=supported.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20270307-smart-cart-selected-row-image-caption.sql

-- BEGIN ORIGINAL MIGRATION 20270308-smart-table-shared-ribbon.sql
-- Smart Table: enable only existing shared Builder properties, without
-- duplicating the Cart ribbon or changing customer-authored component values.
-- Source: @Object or TABLE(@Object,@Field,...) in existing textSource Formula Bar.
INSERT INTO md_builder_ribbon_components(component_api)
VALUES ('smart_table') ON CONFLICT(component_api) DO NOTHING;

WITH permitted(property_key) AS (
 VALUES
 -- Source objects, formula bindings and reusable column overrides
 ('objectApiName'),('objectApiName2'),('objectApiName3'),('textSource'),
 ('column2Source'),('column3Source'),('column4Source'),('column5Source'),
 -- Body
 ('backgroundColor'),('shadow'),('borderColor'),('radius'),
 -- Header
 ('wrapText'),('headerTextColor'),('headerAlignment'),('headerBodyColor'),
 ('headerBorderColor'),('headerBold'),
 -- Row, selection and summary
 ('rowBorderColor'),('rowRadius'),('rowHeight'),('rowLabelColor'),
 ('selectedRowColor'),('selectedRowBorderColor'),
 ('summaryBackgroundColor'),('summaryTextColor'),('summaryTextSize'),
 ('summaryBorderColor'),('summaryHeight'),('summaryTextWeight'),
 ('summaryRadius'),('summaryWidth'),('summaryShadow'),
 -- Table
 ('tableBackgroundColor'),('tableRadius'),('tableShadow'),('tableBorderColor'),
 -- Typography
 ('labelAlignment'),('defaultValueColor'),('textSize'),
 -- Shared canvas layout
 ('width'),('height'),('x'),('y')
)
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT 'smart_table',p.property_key,true
FROM permitted
JOIN md_builder_shared_properties p USING(property_key)
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Register an installed, platform-owned renderer for existing tenants.
-- Preserve tenant-owned component overrides and page instances.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'smart_table','one-bundled:smart_table',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20270308-smart-table-shared-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270309-design2-contextual-ribbon.sql
-- Design 2: SQL-backed contextual slots; the original Design inventory is untouched.
-- Reuses existing editor/icon components and existing property value keys.
-- One property can appear in multiple area/slot rows without duplicating its definition.
-- Idempotent: existing tenant-edited placements are not overwritten.
-- Dependent slot rows cascade on shared-property cleanup; a complete metadata
-- migration replay then re-seeds the slot inventory without blocking recovery.
ALTER TABLE md_builder_shared_properties
 DROP CONSTRAINT IF EXISTS md_builder_shared_properties_tab_check;
ALTER TABLE md_builder_shared_properties
 ADD CONSTRAINT md_builder_shared_properties_tab_check
 CHECK(tab IN ('Home','Data','Design','Design2','Shapes','Layout'));

-- New controls only where the existing component renderer has a genuine missing
-- style hook. They live on Design2, never appear in the legacy Design tab.
WITH specs(property_key,label,kind,default_value) AS (
 VALUES
 ('headerTextSize','Header Text Size','number',NULL::jsonb),
 ('supportingBackgroundColor','Supporting Body Color','color',NULL::jsonb),
 ('supportingTextSize','Supporting Text Size','number',NULL::jsonb),
 ('rowAlignment','Row Alignment','align',NULL::jsonb),
 ('rowTextSize','Row Text Size','number',NULL::jsonb),
 ('rowBold','Row Bold','boolean',NULL::jsonb),
 ('summaryAlignment','Summary Alignment','align',NULL::jsonb),
 ('summary2Alignment','Summary 2 Alignment','align',NULL::jsonb)
), missing AS (
 SELECT s.*, row_number() OVER(ORDER BY s.property_key) AS pos
 FROM specs s
 WHERE NOT EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,design_row,design_order,design_width,design_height,design_caption_width,design_display)
SELECT m.property_key,m.label,'Design2','Contextual',m.kind,
 l.n+m.pos,m.default_value,'[]'::jsonb,'component',
 3,1,CASE WHEN m.kind='number' THEN 58 WHEN m.kind='boolean' THEN 28 ELSE 40 END,
 26,0,CASE WHEN m.kind='align' THEN 'dropdown' ELSE 'buttons' END
FROM missing m CROSS JOIN last_order l
ON CONFLICT(property_key) DO NOTHING;

-- Applicability remains separate from area placement. Missing controls for
-- unrelated components remain disabled, never silently write unused keys.
WITH supported(component_api,property_key) AS (
 VALUES
 ('smart_cart','headerTextSize'),('smart_cart','supportingBackgroundColor'),
 ('smart_cart','supportingTextSize'),('smart_cart','rowAlignment'),
 ('smart_cart','rowTextSize'),('smart_cart','rowBold'),
 ('smart_cart','summaryAlignment'),('smart_cart','summary2Alignment'),
 ('smart_table','headerTextSize'),('smart_table','rowAlignment'),
 ('smart_table','rowTextSize'),('smart_table','rowBold'),
 ('smart_table','summaryAlignment')
)
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT s.component_api,s.property_key,true
FROM supported s
JOIN md_builder_ribbon_components c ON c.component_api=s.component_api
JOIN md_builder_shared_properties p ON p.property_key=s.property_key
ON CONFLICT(component_api,property_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS md_builder_design2_slots (
 area text NOT NULL,
 area_order smallint NOT NULL CHECK(area_order>0),
 slot_key text NOT NULL,
 row_no smallint NOT NULL CHECK(row_no IN (2,3)),
 order_no smallint NOT NULL CHECK(order_no>0),
 width_px smallint NOT NULL CHECK(width_px BETWEEN 20 AND 300),
 height_px smallint NOT NULL CHECK(height_px=26),
 property_key text REFERENCES md_builder_shared_properties(property_key) ON DELETE CASCADE,
 fallback_key text NOT NULL REFERENCES md_builder_shared_properties(property_key) ON DELETE CASCADE,
 PRIMARY KEY(area,slot_key),
 UNIQUE(area,row_no,order_no)
);
-- Rows 2 and 3 are the familiar shared property boxes; row 1 hosts the
-- area selector, visibility switch and the existing Shape / Shape Fill controls.
-- Null property_key intentionally draws a disabled control using the fallback icon.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
VALUES
 ('Body',1,'fill',2,1,40,26,'backgroundColor','backgroundColor'),
 ('Body',1,'border',2,2,40,26,'borderColor','borderColor'),
 ('Body',1,'radius',2,3,58,26,'radius','radius'),
 ('Body',1,'height',2,4,58,26,NULL,'rowHeight'),
 ('Body',1,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Body',1,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Body',1,'shadow',2,7,35,26,'shadow','shadow'),
 ('Body',1,'text',3,1,40,26,'labelColor','labelColor'),
 ('Body',1,'alignment',3,2,35,26,'labelAlignment','labelAlignment'),
 ('Body',1,'size',3,3,58,26,'textSize','textSize'),
 ('Body',1,'bold',3,4,28,26,NULL,'headerBold'),
 ('Body',1,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Header',2,'fill',2,1,40,26,'headerBodyColor','backgroundColor'),
 ('Header',2,'border',2,2,40,26,'headerBorderColor','borderColor'),
 ('Header',2,'radius',2,3,58,26,NULL,'radius'),
 ('Header',2,'height',2,4,58,26,'headerBoxHeight','rowHeight'),
 ('Header',2,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Header',2,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Header',2,'shadow',2,7,35,26,NULL,'shadow'),
 ('Header',2,'text',3,1,40,26,'headerTextColor','labelColor'),
 ('Header',2,'alignment',3,2,35,26,'headerAlignment','labelAlignment'),
 ('Header',2,'size',3,3,58,26,'headerTextSize','textSize'),
 ('Header',2,'bold',3,4,28,26,'headerBold','headerBold'),
 ('Header',2,'wrap',3,5,28,26,'wrapText','wrapText'),
 ('Header Supporting',3,'fill',2,1,40,26,'supportingBackgroundColor','backgroundColor'),
 ('Header Supporting',3,'border',2,2,40,26,'supportingBorderColor','borderColor'),
 ('Header Supporting',3,'radius',2,3,58,26,NULL,'radius'),
 ('Header Supporting',3,'height',2,4,58,26,'supportingBoxHeight','rowHeight'),
 ('Header Supporting',3,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Header Supporting',3,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Header Supporting',3,'shadow',2,7,35,26,NULL,'shadow'),
 ('Header Supporting',3,'text',3,1,40,26,'supportingTextColor','labelColor'),
 ('Header Supporting',3,'alignment',3,2,35,26,'supportingAlignment','labelAlignment'),
 ('Header Supporting',3,'size',3,3,58,26,'supportingTextSize','textSize'),
 ('Header Supporting',3,'bold',3,4,28,26,'supportingBold','headerBold'),
 ('Header Supporting',3,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Table',4,'fill',2,1,40,26,'tableBackgroundColor','backgroundColor'),
 ('Table',4,'border',2,2,40,26,'tableBorderColor','borderColor'),
 ('Table',4,'radius',2,3,58,26,'tableRadius','radius'),
 ('Table',4,'height',2,4,58,26,NULL,'rowHeight'),
 ('Table',4,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Table',4,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Table',4,'shadow',2,7,35,26,'tableShadow','shadow'),
 ('Table',4,'text',3,1,40,26,NULL,'labelColor'),
 ('Table',4,'alignment',3,2,35,26,NULL,'labelAlignment'),
 ('Table',4,'size',3,3,58,26,NULL,'textSize'),
 ('Table',4,'bold',3,4,28,26,NULL,'headerBold'),
 ('Table',4,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Row',5,'fill',2,1,40,26,NULL,'backgroundColor'),
 ('Row',5,'border',2,2,40,26,'rowBorderColor','borderColor'),
 ('Row',5,'radius',2,3,58,26,'rowRadius','radius'),
 ('Row',5,'height',2,4,58,26,'rowHeight','rowHeight'),
 ('Row',5,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Row',5,'focused',2,6,40,26,'selectedRowColor','selectedRowColor'),
 ('Row',5,'shadow',2,7,35,26,NULL,'shadow'),
 ('Row',5,'text',3,1,40,26,'rowLabelColor','labelColor'),
 ('Row',5,'alignment',3,2,35,26,'rowAlignment','labelAlignment'),
 ('Row',5,'size',3,3,58,26,'rowTextSize','textSize'),
 ('Row',5,'bold',3,4,28,26,'rowBold','headerBold'),
 ('Row',5,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Summary',6,'fill',2,1,40,26,'summaryBackgroundColor','backgroundColor'),
 ('Summary',6,'border',2,2,40,26,'summaryBorderColor','borderColor'),
 ('Summary',6,'radius',2,3,58,26,'summaryRadius','radius'),
 ('Summary',6,'height',2,4,58,26,'summaryHeight','rowHeight'),
 ('Summary',6,'width',2,5,58,26,'summaryWidth','summaryWidth'),
 ('Summary',6,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Summary',6,'shadow',2,7,35,26,'summaryShadow','shadow'),
 ('Summary',6,'text',3,1,40,26,'summaryTextColor','labelColor'),
 ('Summary',6,'alignment',3,2,35,26,'summaryAlignment','labelAlignment'),
 ('Summary',6,'size',3,3,58,26,'summaryTextSize','textSize'),
 ('Summary',6,'bold',3,4,28,26,'summaryTextWeight','headerBold'),
 ('Summary',6,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Summary 2',7,'fill',2,1,40,26,NULL,'backgroundColor'),
 ('Summary 2',7,'border',2,2,40,26,NULL,'borderColor'),
 ('Summary 2',7,'radius',2,3,58,26,NULL,'radius'),
 ('Summary 2',7,'height',2,4,58,26,NULL,'rowHeight'),
 ('Summary 2',7,'width',2,5,58,26,NULL,'summaryWidth'),
 ('Summary 2',7,'focused',2,6,40,26,NULL,'selectedRowColor'),
 ('Summary 2',7,'shadow',2,7,35,26,NULL,'shadow'),
 ('Summary 2',7,'text',3,1,40,26,'summary2TextColor','labelColor'),
 ('Summary 2',7,'alignment',3,2,35,26,'summary2Alignment','labelAlignment'),
 ('Summary 2',7,'size',3,3,58,26,'summary2TextSize','textSize'),
 ('Summary 2',7,'bold',3,4,28,26,'summary2TextWeight','headerBold'),
 ('Summary 2',7,'wrap',3,5,28,26,NULL,'wrapText'),
 ('Tabs',8,'fill',2,1,40,26,'tabColor','backgroundColor'),
 ('Tabs',8,'border',2,2,40,26,'borderColor','borderColor'),
 ('Tabs',8,'radius',2,3,58,26,'radius','radius'),
 ('Tabs',8,'height',2,4,58,26,'tabHeight','rowHeight'),
 ('Tabs',8,'width',2,5,58,26,'tabWidth','summaryWidth'),
 ('Tabs',8,'focused',2,6,40,26,'selectedTabColor','selectedRowColor'),
 ('Tabs',8,'shadow',2,7,35,26,'shadow','shadow'),
 ('Tabs',8,'text',3,1,40,26,'labelColor','labelColor'),
 ('Tabs',8,'alignment',3,2,35,26,'labelAlignment','labelAlignment'),
 ('Tabs',8,'size',3,3,58,26,'textSize','textSize'),
 ('Tabs',8,'bold',3,4,28,26,NULL,'headerBold'),
 ('Tabs',8,'wrap',3,5,28,26,NULL,'wrapText')
ON CONFLICT(area,slot_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270309-design2-contextual-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270309-page-device-layout-page-properties.sql
-- Page layout selection is navigation between independently versioned device drafts,
-- not a component or Layout ribbon setting. Keep the single SQL definition and
-- preserve all tenant metadata and authored layouts; only reclassify its editor.
UPDATE md_builder_shared_properties
SET section_group='Page Properties'
WHERE property_key='deviceLayout' AND tab='Home' AND scope='page'
  AND section_group IN ('Device','Page');
-- END ORIGINAL MIGRATION 20270309-page-device-layout-page-properties.sql

-- BEGIN ORIGINAL MIGRATION 20270309-smart-textbox-shared-ribbon.sql
-- Smart Textbox uses the ONE global property inventory and the existing
-- shared component renderer. Only the "Yes" controls from the approved
-- Smart Textbox table are enabled; Arrange, View and Advanced are generic
-- Page Builder commands, not duplicate SQL component properties.
-- Remarks:
-- label = caption (left); textSource = textbox value (right);
-- backgroundColor/labelColor/labelAlignment = left;
-- shadow/borderColor/radius/textSize = overall;
-- wrapText/headerTextColor/headerAlignment/headerBodyColor/headerBold = right;
-- supportingBorderColor/supportingBold/supportingTextColor/supportingAlignment
-- = right textbox's inner supporting/value presentation.
INSERT INTO md_builder_ribbon_components(component_api)
VALUES ('smart_textbox') ON CONFLICT(component_api) DO NOTHING;

WITH allowed(property_key) AS (
 VALUES
 ('label'),('textSource'),
 ('backgroundColor'),('labelColor'),('shadow'),('borderColor'),('radius'),
 ('wrapText'),('headerTextColor'),('headerAlignment'),('headerBodyColor'),('headerBold'),
 ('supportingBorderColor'),('supportingBold'),('supportingTextColor'),('supportingAlignment'),
 ('labelAlignment'),('textSize'),
 ('width'),('height'),('x'),('y')
)
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT 'smart_textbox',p.property_key,true
FROM allowed JOIN md_builder_shared_properties p USING(property_key)
ON CONFLICT(component_api,property_key) DO NOTHING;

-- Fresh tenants use the shared component seeder. Pre-existing tenants gain the
-- same enabled bundle without overwriting custom component metadata or pages.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'smart_textbox','one-bundled:smart_textbox',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20270309-smart-textbox-shared-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20270310-page-creation-layout.sql
-- Record the original design mode once; layout edits must never change it.
-- Existing pages stay NULL because historical creation mode cannot be recovered
-- with certainty from mutable draft revision timestamps.
ALTER TABLE md_lightning_page_details
 ADD COLUMN IF NOT EXISTS creation_layout_variant text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='md_page_creation_layout_variant_valid') THEN
  ALTER TABLE md_lightning_page_details
   ADD CONSTRAINT md_page_creation_layout_variant_valid
   CHECK (creation_layout_variant IS NULL OR creation_layout_variant IN ('Desktop','Mobile','Tablet','Custom'));
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20270310-page-creation-layout.sql

-- BEGIN ORIGINAL MIGRATION 20270310-smart-tabs-default-index.sql
-- One shared, SQL-owned zero-based initial Tab Index for Smart Tabs.
-- Preserve all existing page component values, tenant customisations,
-- published layouts, Flows and the already-approved horizontal/vertical orientation.
-- Width/Height retain their requested row-one slots, Orientation remains R2C2,
-- Index occupies the previously conflicting free R2C1, and Count moves to R3C1.
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  min_value,max_value,choices,scope,design_row,design_order,design_width,
  design_height,design_caption,design_caption_width)
SELECT 'tabIndex','Tab Index','Layout','Tabs','number',
 COALESCE(MAX(sort_order),0)+1,'0'::jsonb,0,20,'[]'::jsonb,'component',
 2,1,30,26,'Tab Index',45
FROM md_builder_shared_properties
ON CONFLICT(property_key) DO NOTHING;

-- Global property inventory, enabled only for Smart Tabs; keep tenant rule edits.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,
  default_value_override,choices_override)
SELECT 'smart_tabs','tabIndex',true,NULL,NULL,NULL,NULL
WHERE EXISTS(SELECT 1 FROM md_builder_ribbon_components WHERE component_api='smart_tabs')
ON CONFLICT(component_api,property_key) DO NOTHING;

-- Correct the conflicting layout positions without altering saved values.
-- Existing Orientation remains Layout / Tabs / R2C2.
WITH approved(property_key,row_no,col_no,width_px) AS (
 VALUES ('tabWidth',1,1,58),('tabHeight',1,2,58),
        ('tabCount',3,1,58),('tabIndex',2,1,30)
)
UPDATE md_builder_shared_properties AS p
SET tab='Layout',section_group='Tabs',
 design_row=approved.row_no,design_order=approved.col_no,
 design_width=approved.width_px,design_height=26,
 design_caption=CASE WHEN p.property_key='tabIndex' THEN 'Tab Index' ELSE p.design_caption END,
 design_caption_width=CASE WHEN p.property_key='tabIndex' THEN 45 ELSE 0 END
FROM approved
WHERE p.property_key=approved.property_key
 AND (p.tab,p.section_group,p.design_row,p.design_order,p.design_width,
       p.design_height,p.design_caption_width)
  IS DISTINCT FROM
     ('Layout','Tabs',approved.row_no,approved.col_no,approved.width_px,
       26,CASE WHEN p.property_key='tabIndex' THEN 45 ELSE 0 END);
-- END ORIGINAL MIGRATION 20270310-smart-tabs-default-index.sql

-- BEGIN ORIGINAL MIGRATION 20270311-smart-card-grid-selection-image-width.sql
-- Shared Smart Card Grid appearance: one SQL-backed property catalog, no app logic.
-- Existing saved components, tenant overrides and Card Grid layouts are preserved.
ALTER TABLE md_builder_shared_properties
 ADD COLUMN IF NOT EXISTS enabled_when jsonb;

WITH base AS (
 SELECT COALESCE(MAX(sort_order),0) AS last_order FROM md_builder_shared_properties
), specs(property_key,label,kind,ordinal,min_value,max_value,enabled_when,design_row,design_order,design_width) AS (
 VALUES
 ('selectedCardColor','Selected Card Color','color',1,NULL::integer,NULL::integer,
   NULL::jsonb,2,1,40),
 ('imageWidth','Image Width','number',2,0,1200,
   '{"property":"imagePlacement","in":["left","right"]}'::jsonb,2,2,58)
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,min_value,max_value,enabled_when,
  design_row,design_order,design_width,design_height,design_caption_width)
SELECT s.property_key,s.label,'Design','Card Grid',s.kind,
 b.last_order+s.ordinal,NULL,'[]'::jsonb,'component',s.min_value,s.max_value,
 s.enabled_when,s.design_row,s.design_order,s.design_width,26,0
FROM specs s CROSS JOIN base b
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT 'smart_card_grid',p.property_key,true
FROM md_builder_shared_properties p
JOIN md_builder_ribbon_components c ON c.component_api='smart_card_grid'
WHERE p.property_key IN ('selectedCardColor','imageWidth')
ON CONFLICT(component_api,property_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270311-smart-card-grid-selection-image-width.sql

-- BEGIN ORIGINAL MIGRATION 20270312-smart-text-display-card-focused-design2.sql
-- Shared Smart component metadata only: no page, tenant records or app-specific behaviour.
-- Design2 reuses existing textSize, headerBold, wrapText, selectedCardColor and gap IDs.
-- Null focused values preserve the current unselected/selected card appearance.
WITH base AS (
  SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties
), specs(property_key,label,kind,default_value,choices,min_value,max_value,ordinal) AS (
  VALUES
  ('displayMode','Text Mode','choice','"input"'::jsonb,'["input","display"]'::jsonb,NULL::integer,NULL::integer,1),
  ('gap','Card Gap','number','12'::jsonb,'[]'::jsonb,0,160,2),
  ('cardPadding','Card Padding','number',NULL::jsonb,'[]'::jsonb,0,160,3),
  ('focusedCardWidth','Focused Width','number',NULL::jsonb,'[]'::jsonb,1,1200,4),
  ('focusedCardHeight','Focused Height','number',NULL::jsonb,'[]'::jsonb,1,1200,5),
  ('focusedTextColor','Focused Text Color','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,6),
  ('focusedTextBold','Focused Bold','boolean',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer,7),
  ('focusedTextSize','Focused Text Size','number',NULL::jsonb,'[]'::jsonb,8,96,8)
), missing AS (
 SELECT specs.*,row_number() OVER(ORDER BY ordinal) AS position
 FROM specs WHERE NOT EXISTS (
  SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=specs.property_key
 )
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,min_value,max_value,design_row,design_order,design_width,design_height,design_caption_width)
SELECT m.property_key,m.label,'Design2','Contextual',m.kind,
 b.n+m.position,m.default_value,m.choices,'component',m.min_value,m.max_value,
 3,1,CASE WHEN m.kind='number' THEN 58 WHEN m.kind='boolean' THEN 28
           WHEN m.kind='choice' THEN 94 ELSE 40 END,26,0
FROM missing m CROSS JOIN base b
ON CONFLICT(property_key) DO NOTHING;

-- The original Smart Input remains the default. Show display-only mode and
-- existing bold/wrap controls for Smart Text without duplicating the property engine.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT rules.component_api,p.property_key,true
FROM (VALUES
 ('smart_text','displayMode'),('smart_text','headerBold'),('smart_text','wrapText'),
 ('smart_card_grid','textSize'),('smart_card_grid','gap'),('smart_card_grid','cardPadding'),
 ('smart_card_grid','focusedCardWidth'),('smart_card_grid','focusedCardHeight'),
 ('smart_card_grid','focusedTextColor'),('smart_card_grid','focusedTextBold'),
 ('smart_card_grid','focusedTextSize')
) AS rules(component_api,property_key)
JOIN md_builder_ribbon_components c ON c.component_api=rules.component_api
JOIN md_builder_shared_properties p ON p.property_key=rules.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Smart Text display headings default to normal weight; explicit bold is opt-in.
UPDATE md_builder_ribbon_component_rules
SET default_value_override='false'::jsonb
WHERE component_api='smart_text' AND property_key='headerBold'
  AND default_value_override IS NULL;

-- Reuse previously disabled Body icon slots; no additional toolbar engine.
UPDATE md_builder_design2_slots
SET property_key='headerBold'
WHERE area='Body' AND slot_key='bold' AND property_key IS NULL;
UPDATE md_builder_design2_slots
SET property_key='wrapText'
WHERE area='Body' AND slot_key='wrap' AND property_key IS NULL;

-- New contextual areas share the existing three-row SQL slot renderer.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
VALUES
 ('Body',1,'textMode',3,6,94,26,'displayMode','displayMode'),
 ('Card Grid',9,'gap',2,1,58,26,'gap','gap'),
 ('Card Grid',9,'padding',2,2,58,26,'cardPadding','cardPadding'),
 ('Card Grid',9,'size',3,1,58,26,'textSize','textSize'),
 ('Focused',10,'fill',2,1,40,26,'selectedCardColor','selectedCardColor'),
 ('Focused',10,'height',2,2,58,26,'focusedCardHeight','focusedCardHeight'),
 ('Focused',10,'width',2,3,58,26,'focusedCardWidth','focusedCardWidth'),
 ('Focused',10,'text',3,1,40,26,'focusedTextColor','focusedTextColor'),
 ('Focused',10,'bold',3,2,28,26,'focusedTextBold','focusedTextBold'),
 ('Focused',10,'size',3,3,58,26,'focusedTextSize','focusedTextSize')
ON CONFLICT(area,slot_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20270312-smart-text-display-card-focused-design2.sql

-- BEGIN ORIGINAL MIGRATION 20271101-in-screen-page-constraint.sql
-- In-screen page definitions share the existing SQL Page engine.
ALTER TABLE md_lightning_page_details DROP CONSTRAINT IF EXISTS md_lightning_page_details_page_type_check;
ALTER TABLE md_lightning_page_details ADD CONSTRAINT md_lightning_page_details_page_type_check
 CHECK(page_type IN ('Record Page','App Page','Home Page','In-Screen Page'));
-- END ORIGINAL MIGRATION 20271101-in-screen-page-constraint.sql

-- BEGIN ORIGINAL MIGRATION 20271102-in-screen-flow-capability.sql
-- In-screen Flow is a distinct metadata type sharing the existing Screen Flow interview runtime.
INSERT INTO md_flow_capability_flow_types
(flow_type,description,sort_order,create_enabled,validate_enabled,debug_enabled)
VALUES('In-Screen Flow','Run a Screen Flow inside an in-screen window.',5,true,true,true)
ON CONFLICT(flow_type) DO NOTHING;
INSERT INTO md_flow_capability_element_flows(element_type,flow_type,builder_allowed)
SELECT element_type,'In-Screen Flow',builder_allowed FROM md_flow_capability_element_flows
WHERE flow_type='Screen Flow'
ON CONFLICT(element_type,flow_type) DO NOTHING;
-- END ORIGINAL MIGRATION 20271102-in-screen-flow-capability.sql

-- BEGIN ORIGINAL MIGRATION 20271103-kiosk-custom-portrait-layout.sql
-- Configure the ten tenant-authored kiosk pages for a Custom 1080x1920 portrait canvas.
-- Preserve all Desktop/Tablet/Mobile layouts, components, coordinates, data bindings,
-- Flow actions, immutable history, and independently edited draft/published snapshots.
-- Deliberately refuse ambiguous cross-tenant matches and application-managed pages.
-- On systems where the ten pages are not installed, this is a safe no-op.
DO $kiosk_portrait$
DECLARE
  page_apis text[] := ARRAY[
  'smart_kiosk_welcome',
  'smart_kiosk_order_type',
  'smart_kiosk_menu',
  'smart_kiosk_product',
  'smart_kiosk_customise',
  'smart_kiosk_basket',
  'smart_kiosk_upsell',
  'smart_kiosk_review',
  'smart_kiosk_payment',
  'smart_kiosk_confirmation'
  ];
  candidate_tenants integer;
  target_tenant uuid;
  target_page record;
  source_revision record;
  next_revision integer;
  updated_pages integer := 0;
BEGIN
  SELECT count(*)::integer,(array_agg(found.tenant_id))[1]
    INTO candidate_tenants,target_tenant
  FROM (
    SELECT p.tenant_id
    FROM md_page_definitions p
    JOIN md_lightning_page_details d
      ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.enabled=true
      AND p.api_name=ANY(page_apis)
      AND d.page_type IN ('App Page','Home Page','In-Screen Page')
      AND NOT EXISTS (
        SELECT 1 FROM md_app_seed_pages managed
        WHERE managed.tenant_id=p.tenant_id AND managed.page_id=p.id
      )
    GROUP BY p.tenant_id
    HAVING count(DISTINCT p.api_name)=cardinality(page_apis)
  ) found;
  IF candidate_tenants <> 1 THEN
    RAISE NOTICE 'Kiosk portrait: expected exactly one tenant with all ten editable pages, found %. No pages changed.', candidate_tenants;
    RETURN;
  END IF;

  FOR target_page IN
    SELECT p.tenant_id,p.id AS page_id,p.api_name,p.title,
           d.layout_mode,d.template,d.canvas_width,d.canvas_height,
           d.canvas_fill_color,d.status
    FROM md_page_definitions p
    JOIN md_lightning_page_details d
      ON d.tenant_id=p.tenant_id AND d.page_id=p.id
    WHERE p.tenant_id=target_tenant AND p.enabled=true
      AND p.api_name=ANY(page_apis)
    ORDER BY p.api_name
  LOOP
    -- New Page Builder pages may not yet have saved a Custom layout.
    -- Seed only the missing Custom baseline from existing legacy metadata.
    IF NOT EXISTS (
      SELECT 1 FROM md_page_layout_heads h
      WHERE h.tenant_id=target_page.tenant_id
        AND h.page_id=target_page.page_id AND h.variant='Custom'
    ) THEN
      INSERT INTO md_page_layout_versions
        (tenant_id,page_id,variant,version,page_label,layout_mode,template,
         canvas_width,canvas_height,canvas_fill_color)
      VALUES
        (target_page.tenant_id,target_page.page_id,'Custom',1,target_page.title,
         target_page.layout_mode,target_page.template,
         target_page.canvas_width,target_page.canvas_height,
         COALESCE(target_page.canvas_fill_color,'#ffffff'))
      ON CONFLICT DO NOTHING;

      INSERT INTO md_page_layout_version_nodes
        (tenant_id,page_id,variant,version,component_key,component_type,
         label,region,visible,sort_order)
      SELECT n.tenant_id,n.page_id,'Custom',1,n.component_key,n.component_type,
             n.label,n.region,n.visible,n.sort_order
      FROM md_lightning_page_nodes n
      WHERE n.tenant_id=target_page.tenant_id AND n.page_id=target_page.page_id
      ON CONFLICT DO NOTHING;

      INSERT INTO md_page_layout_version_properties
        (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
      SELECT x.tenant_id,x.page_id,'Custom',1,x.component_key,x.property_path,x.value_kind,x.value_text
      FROM md_lightning_page_node_properties x
      WHERE x.tenant_id=target_page.tenant_id AND x.page_id=target_page.page_id
      ON CONFLICT DO NOTHING;

      INSERT INTO md_page_layout_version_activation
        (tenant_id,page_id,variant,version,assignment_id,scope,app_api,
         profile_id,record_type_id,desktop,phone,tablet,custom,sort_order)
      SELECT a.tenant_id,a.page_id,'Custom',1,a.assignment_id,a.scope,a.app_api,
             a.profile_id,a.record_type_id,a.desktop,a.phone,a.tablet,a.custom,a.sort_order
      FROM md_lightning_page_activation a
      WHERE a.tenant_id=target_page.tenant_id AND a.page_id=target_page.page_id
      ON CONFLICT DO NOTHING;

      INSERT INTO md_page_layout_heads
        (tenant_id,page_id,variant,draft_version,published_version)
      VALUES
        (target_page.tenant_id,target_page.page_id,'Custom',1,
         CASE WHEN target_page.status='Active' THEN 1 ELSE NULL END)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Clone each independent head (draft and published) as necessary.
    -- Never publish unrelated unsaved draft changes by collapsing both heads.
    FOR source_revision IN
      SELECT DISTINCT versions.version,versions.canvas_width,versions.canvas_height
      FROM md_page_layout_heads heads
      JOIN md_page_layout_versions versions
        ON versions.tenant_id=heads.tenant_id
        AND versions.page_id=heads.page_id
        AND versions.variant=heads.variant
        AND versions.version IN (heads.draft_version,heads.published_version)
      WHERE heads.tenant_id=target_page.tenant_id AND heads.page_id=target_page.page_id
        AND heads.variant='Custom'
      ORDER BY versions.version
    LOOP
      IF source_revision.canvas_width=1080 AND source_revision.canvas_height=1920 THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(max(version),0)+1 INTO next_revision
      FROM md_page_layout_versions
      WHERE tenant_id=target_page.tenant_id
        AND page_id=target_page.page_id AND variant='Custom';

      INSERT INTO md_page_layout_versions
        (tenant_id,page_id,variant,version,page_label,layout_mode,template,
         canvas_width,canvas_height,canvas_fill_color,
         custom_target_enabled,custom_target_min_width,custom_target_max_width,
         inherits_desktop,canvas_fill_override,desktop_base_version)
      SELECT tenant_id,page_id,variant,next_revision,page_label,layout_mode,template,
             1080,1920,canvas_fill_color,
             custom_target_enabled,custom_target_min_width,custom_target_max_width,
             inherits_desktop,canvas_fill_override,desktop_base_version
      FROM md_page_layout_versions
      WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
        AND variant='Custom' AND version=source_revision.version;

      INSERT INTO md_page_layout_version_nodes
        (tenant_id,page_id,variant,version,component_key,component_type,
         label,region,visible,sort_order)
      SELECT tenant_id,page_id,variant,next_revision,component_key,component_type,
             label,region,visible,sort_order
      FROM md_page_layout_version_nodes
      WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
        AND variant='Custom' AND version=source_revision.version;

      INSERT INTO md_page_layout_version_properties
        (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
      SELECT tenant_id,page_id,variant,next_revision,component_key,property_path,value_kind,value_text
      FROM md_page_layout_version_properties
      WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
        AND variant='Custom' AND version=source_revision.version;

      INSERT INTO md_page_layout_version_activation
        (tenant_id,page_id,variant,version,assignment_id,scope,app_api,
         profile_id,record_type_id,desktop,phone,tablet,custom,sort_order)
      SELECT tenant_id,page_id,variant,next_revision,assignment_id,scope,app_api,
             profile_id,record_type_id,desktop,phone,tablet,custom,sort_order
      FROM md_page_layout_version_activation
      WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
        AND variant='Custom' AND version=source_revision.version;

      UPDATE md_page_layout_heads
      SET draft_version=CASE WHEN draft_version=source_revision.version THEN next_revision
                             ELSE draft_version END,
          published_version=CASE WHEN published_version=source_revision.version THEN next_revision
                                 ELSE published_version END,
          updated_at=now()
      WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
        AND variant='Custom';
    END LOOP;

    -- Make Custom selectable without dropping any existing device assignments.
    UPDATE md_lightning_page_details
    SET devices=array_append(devices,'Custom'),revision=revision+1,updated_at=now()
    WHERE tenant_id=target_page.tenant_id AND page_id=target_page.page_id
      AND NOT ('Custom'=ANY(devices));

    IF EXISTS (
      SELECT 1 FROM md_page_layout_heads h
      JOIN md_page_layout_versions v
        ON v.tenant_id=h.tenant_id AND v.page_id=h.page_id
        AND v.variant=h.variant AND v.version=h.draft_version
      WHERE h.tenant_id=target_page.tenant_id AND h.page_id=target_page.page_id
        AND h.variant='Custom'
        AND (v.canvas_width<>1080 OR v.canvas_height<>1920)
    ) OR EXISTS (
      SELECT 1 FROM md_page_layout_heads h
      JOIN md_page_layout_versions v
        ON v.tenant_id=h.tenant_id AND v.page_id=h.page_id
        AND v.variant=h.variant AND v.version=h.published_version
      WHERE h.tenant_id=target_page.tenant_id AND h.page_id=target_page.page_id
        AND h.variant='Custom'
        AND (v.canvas_width<>1080 OR v.canvas_height<>1920)
    ) THEN
      RAISE EXCEPTION 'Kiosk portrait layout verification failed for %',target_page.api_name;
    END IF;
    updated_pages := updated_pages+1;
  END LOOP;
  IF updated_pages<>cardinality(page_apis) THEN
    RAISE EXCEPTION 'Kiosk portrait update expected % pages but processed %',
      cardinality(page_apis),updated_pages;
  END IF;
  RAISE NOTICE 'Kiosk portrait: all % Custom canvases set to 1080x1920 for tenant %.',
    updated_pages,target_tenant;
END
$kiosk_portrait$;
-- END ORIGINAL MIGRATION 20271103-kiosk-custom-portrait-layout.sql

-- BEGIN ORIGINAL MIGRATION 20271104-kiosk-smart-global-ribbon.sql
-- Shared, additive kiosk capabilities for every tenant: no page-specific values.
-- The existing metadata catalog, Actions eye toggles and Design 2 control icons
-- own the configuration. No new ribbon framework or component is introduced.
WITH specs(property_key,label,tab,section_group,control_kind,choices,min_value,max_value,ordinal) AS (
 VALUES
 ('selectionMode','Selection Mode','Design2','Focused','choice','["single","multiple"]'::jsonb,NULL::integer,NULL::integer,1),
 ('focusedCardBorderColor','Focused Border','Design2','Focused','color','[]'::jsonb,NULL::integer,NULL::integer,2),
 ('focusedCardShadow','Focused Shadow','Design2','Focused','shadow','["none","medium","large"]'::jsonb,NULL::integer,NULL::integer,3),
 ('rowSupportingSource','Row Supporting','Data','Cart','expression','[]'::jsonb,NULL::integer,NULL::integer,4),
 ('rowSupportingBackgroundColor','Body Color','Design2','Row Supporting','color','[]'::jsonb,NULL::integer,NULL::integer,5),
 ('rowSupportingBorderColor','Border','Design2','Row Supporting','color','[]'::jsonb,NULL::integer,NULL::integer,6),
 ('rowSupportingRadius','Radius','Design2','Row Supporting','number','[]'::jsonb,0::integer,128::integer,7),
 ('rowSupportingHeight','Height','Design2','Row Supporting','number','[]'::jsonb,0::integer,600::integer,8),
 ('rowSupportingShadow','Shadow','Design2','Row Supporting','shadow','[]'::jsonb,NULL::integer,NULL::integer,9),
 ('rowSupportingTextColor','Text Color','Design2','Row Supporting','color','[]'::jsonb,NULL::integer,NULL::integer,10),
 ('rowSupportingAlignment','Alignment','Design2','Row Supporting','align','[]'::jsonb,NULL::integer,NULL::integer,11),
 ('rowSupportingTextSize','Text Size','Design2','Row Supporting','number','[]'::jsonb,8::integer,96::integer,12),
 ('rowSupportingBold','Bold','Design2','Row Supporting','boolean','[]'::jsonb,NULL::integer,NULL::integer,13),
 ('rowSupportingWrapText','Wrap','Design2','Row Supporting','boolean','[]'::jsonb,NULL::integer,NULL::integer,14),
 ('customButton1Label','Custom Button 1 Text','Data','Values','expression','[]'::jsonb,NULL::integer,NULL::integer,15),
 ('customButton1Fill','Fill','Design2','Custom Button 1','color','[]'::jsonb,NULL::integer,NULL::integer,16),
 ('customButton1BorderColor','Border','Design2','Custom Button 1','color','[]'::jsonb,NULL::integer,NULL::integer,17),
 ('customButton1Shape','Shape','Design2','Custom Button 1','choice','["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL::integer,NULL::integer,18),
 ('customButton1Width','Width','Design2','Custom Button 1','number','[]'::jsonb,0::integer,1200::integer,19),
 ('customButton1Height','Height','Design2','Custom Button 1','number','[]'::jsonb,24::integer,1200::integer,20),
 ('customButton1TextColor','Text Color','Design2','Custom Button 1','color','[]'::jsonb,NULL::integer,NULL::integer,21),
 ('customButton1Alignment','Alignment','Design2','Custom Button 1','align','[]'::jsonb,NULL::integer,NULL::integer,22),
 ('customButton1TextSize','Text Size','Design2','Custom Button 1','number','[]'::jsonb,8::integer,96::integer,23),
 ('customButton2Label','Custom Button 2 Text','Data','Values','expression','[]'::jsonb,NULL::integer,NULL::integer,24),
 ('customButton2Fill','Fill','Design2','Custom Button 2','color','[]'::jsonb,NULL::integer,NULL::integer,25),
 ('customButton2BorderColor','Border','Design2','Custom Button 2','color','[]'::jsonb,NULL::integer,NULL::integer,26),
 ('customButton2Shape','Shape','Design2','Custom Button 2','choice','["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL::integer,NULL::integer,27),
 ('customButton2Width','Width','Design2','Custom Button 2','number','[]'::jsonb,0::integer,1200::integer,28),
 ('customButton2Height','Height','Design2','Custom Button 2','number','[]'::jsonb,24::integer,1200::integer,29),
 ('customButton2TextColor','Text Color','Design2','Custom Button 2','color','[]'::jsonb,NULL::integer,NULL::integer,30),
 ('customButton2Alignment','Alignment','Design2','Custom Button 2','align','[]'::jsonb,NULL::integer,NULL::integer,31),
 ('customButton2TextSize','Text Size','Design2','Custom Button 2','number','[]'::jsonb,8::integer,96::integer,32)
), missing AS (
 SELECT s.*,ROW_NUMBER() OVER(ORDER BY s.ordinal) AS pos FROM specs s
 WHERE NOT EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,min_value,max_value,field_select,design_row,design_order,
  design_width,design_height,design_caption_width,design_display)
SELECT m.property_key,m.label,m.tab,m.section_group,m.control_kind,
 l.n+m.pos,NULL::jsonb,m.choices,'component',m.min_value,m.max_value,
 m.control_kind='expression',2,1,
 CASE WHEN m.control_kind='choice' THEN 116 WHEN m.control_kind='number' THEN 58
      WHEN m.control_kind='boolean' THEN 28 WHEN m.control_kind='shadow' THEN 35 ELSE 40 END,
 26,0,CASE WHEN m.control_kind IN ('align','shadow') THEN 'dropdown' ELSE 'buttons' END
FROM missing m CROSS JOIN last_order l
ON CONFLICT(property_key) DO NOTHING;

-- Both components share the exact property definitions and action slot names.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT rules.component_api,rules.property_key,true FROM (VALUES
 ('smart_card_grid','selectionMode'),
 ('smart_card_grid','focusedCardBorderColor'),
 ('smart_card_grid','focusedCardShadow'),
 ('smart_cart','rowSupportingSource'),
 ('smart_cart','rowSupportingBackgroundColor'),
 ('smart_cart','rowSupportingBorderColor'),
 ('smart_cart','rowSupportingRadius'),
 ('smart_cart','rowSupportingHeight'),
 ('smart_cart','rowSupportingShadow'),
 ('smart_cart','rowSupportingTextColor'),
 ('smart_cart','rowSupportingAlignment'),
 ('smart_cart','rowSupportingTextSize'),
 ('smart_cart','rowSupportingBold'),
 ('smart_cart','rowSupportingWrapText'),
 ('smart_cart','customButton1Label'),
 ('smart_card_grid','customButton1Label'),
 ('smart_cart','customButton1Fill'),
 ('smart_card_grid','customButton1Fill'),
 ('smart_cart','customButton1BorderColor'),
 ('smart_card_grid','customButton1BorderColor'),
 ('smart_cart','customButton1Shape'),
 ('smart_card_grid','customButton1Shape'),
 ('smart_cart','customButton1Width'),
 ('smart_card_grid','customButton1Width'),
 ('smart_cart','customButton1Height'),
 ('smart_card_grid','customButton1Height'),
 ('smart_cart','customButton1TextColor'),
 ('smart_card_grid','customButton1TextColor'),
 ('smart_cart','customButton1Alignment'),
 ('smart_card_grid','customButton1Alignment'),
 ('smart_cart','customButton1TextSize'),
 ('smart_card_grid','customButton1TextSize'),
 ('smart_cart','customButton2Label'),
 ('smart_card_grid','customButton2Label'),
 ('smart_cart','customButton2Fill'),
 ('smart_card_grid','customButton2Fill'),
 ('smart_cart','customButton2BorderColor'),
 ('smart_card_grid','customButton2BorderColor'),
 ('smart_cart','customButton2Shape'),
 ('smart_card_grid','customButton2Shape'),
 ('smart_cart','customButton2Width'),
 ('smart_card_grid','customButton2Width'),
 ('smart_cart','customButton2Height'),
 ('smart_card_grid','customButton2Height'),
 ('smart_cart','customButton2TextColor'),
 ('smart_card_grid','customButton2TextColor'),
 ('smart_cart','customButton2Alignment'),
 ('smart_card_grid','customButton2Alignment'),
 ('smart_cart','customButton2TextSize'),
 ('smart_card_grid','customButton2TextSize')
) AS rules(component_api,property_key)
JOIN md_builder_ribbon_components c ON c.component_api=rules.component_api
JOIN md_builder_shared_properties p ON p.property_key=rules.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Design 2 is a SQL-backed area dropdown; every slot reuses an existing editor.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
VALUES
 ('Focused',10,'selection',2,4,116,26,'selectionMode','selectionMode'),
 ('Focused',10,'border',2,5,40,26,'focusedCardBorderColor','focusedCardBorderColor'),
 ('Focused',10,'shadow',2,6,45,26,'focusedCardShadow','focusedCardShadow'),
 ('Row Supporting',11,'fill',2,1,40,26,'rowSupportingBackgroundColor','rowSupportingBackgroundColor'),
 ('Row Supporting',11,'border',2,2,40,26,'rowSupportingBorderColor','rowSupportingBorderColor'),
 ('Row Supporting',11,'radius',2,3,58,26,'rowSupportingRadius','rowSupportingRadius'),
 ('Row Supporting',11,'height',2,4,58,26,'rowSupportingHeight','rowSupportingHeight'),
 ('Row Supporting',11,'shadow',2,5,35,26,'rowSupportingShadow','rowSupportingShadow'),
 ('Row Supporting',11,'text',3,1,40,26,'rowSupportingTextColor','rowSupportingTextColor'),
 ('Row Supporting',11,'alignment',3,2,35,26,'rowSupportingAlignment','rowSupportingAlignment'),
 ('Row Supporting',11,'size',3,3,58,26,'rowSupportingTextSize','rowSupportingTextSize'),
 ('Row Supporting',11,'bold',3,4,28,26,'rowSupportingBold','rowSupportingBold'),
 ('Row Supporting',11,'wrap',3,5,28,26,'rowSupportingWrapText','rowSupportingWrapText'),
 ('Custom Button 1',12,'fill',2,1,40,26,'customButton1Fill','customButton1Fill'),
 ('Custom Button 1',12,'border',2,2,40,26,'customButton1BorderColor','customButton1BorderColor'),
 ('Custom Button 1',12,'shape',2,3,94,26,'customButton1Shape','customButton1Shape'),
 ('Custom Button 1',12,'width',2,4,58,26,'customButton1Width','customButton1Width'),
 ('Custom Button 1',12,'height',2,5,58,26,'customButton1Height','customButton1Height'),
 ('Custom Button 1',12,'text',3,1,40,26,'customButton1TextColor','customButton1TextColor'),
 ('Custom Button 1',12,'alignment',3,2,35,26,'customButton1Alignment','customButton1Alignment'),
 ('Custom Button 1',12,'size',3,3,58,26,'customButton1TextSize','customButton1TextSize'),
 ('Custom Button 2',13,'fill',2,1,40,26,'customButton2Fill','customButton2Fill'),
 ('Custom Button 2',13,'border',2,2,40,26,'customButton2BorderColor','customButton2BorderColor'),
 ('Custom Button 2',13,'shape',2,3,94,26,'customButton2Shape','customButton2Shape'),
 ('Custom Button 2',13,'width',2,4,58,26,'customButton2Width','customButton2Width'),
 ('Custom Button 2',13,'height',2,5,58,26,'customButton2Height','customButton2Height'),
 ('Custom Button 2',13,'text',3,1,40,26,'customButton2TextColor','customButton2TextColor'),
 ('Custom Button 2',13,'alignment',3,2,35,26,'customButton2Alignment','customButton2Alignment'),
 ('Custom Button 2',13,'size',3,3,58,26,'customButton2TextSize','customButton2TextSize')
ON CONFLICT(area,slot_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20271104-kiosk-smart-global-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20271104-zz-design2-exact-approved-matrix.sql
-- Exact user-authored Design 2 control matrix, 319 source rows (deduplicated).
-- Never infer display order from component support. R/C and control sizes are fixed
-- for every component; only the editability/property key differs by component.
-- Applies to shared catalog only: no tenant page/instance data is modified.
ALTER TABLE md_builder_design2_slots
 DROP CONSTRAINT IF EXISTS md_builder_design2_slots_row_no_check;
ALTER TABLE md_builder_design2_slots
 ADD CONSTRAINT md_builder_design2_slots_row_no_check CHECK(row_no IN (1,2,3));

CREATE TABLE IF NOT EXISTS md_builder_design2_slot_rules(
 component_api text NOT NULL REFERENCES md_builder_ribbon_components(component_api) ON DELETE CASCADE,
 area text NOT NULL,
 slot_key text NOT NULL,
 property_key text NOT NULL,
 PRIMARY KEY(component_api,area,slot_key)
);

-- Replace previous invented flexible positions in approved areas. Keep every
-- optional legacy area (Focused, Card Grid, Row Supporting, etc) unchanged.
DELETE FROM md_builder_design2_slots
WHERE area IN ('Body','Header','Badge','Header Supporting','Table','Row','Summary','Footer','Button','Button 2','Button 3','Button 4','Image');

INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
VALUES
 ('Body',1,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Body',1,'border',1,2,40,26,'borderColor','borderColor'),
 ('Body',1,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Body',1,'shapeFill',1,4,40,26,'shapeFill','shapeFill'),
 ('Body',1,'radius',1,5,80,26,'radius','radius'),
 ('Body',1,'orientation',1,6,40,26,'navigationDirection','navigationDirection'),
 ('Body',1,'focused',2,1,40,26,'selectedRowColor','selectedRowColor'),
 ('Body',1,'shadow',2,2,40,26,'shadow','shadow'),
 ('Body',1,'height',2,3,80,26,'height','height'),
 ('Body',1,'width',2,4,80,26,'width','width'),
 ('Body',1,'text',3,1,40,26,'labelColor','labelColor'),
 ('Body',1,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Body',1,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Body',1,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Body',1,'size',3,5,80,26,'textSize','textSize'),
 ('Header',2,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Header',2,'border',1,2,40,26,'borderColor','borderColor'),
 ('Header',2,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Header',2,'shapeFill',1,4,40,26,'shapeFill','shapeFill'),
 ('Header',2,'radius',1,5,80,26,'radius','radius'),
 ('Header',2,'shadow',2,2,40,26,'shadow','shadow'),
 ('Header',2,'height',2,3,80,26,'height','height'),
 ('Header',2,'width',2,4,80,26,'width','width'),
 ('Header',2,'text',3,1,40,26,'labelColor','labelColor'),
 ('Header',2,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Header',2,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Header',2,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Header',2,'size',3,5,80,26,'textSize','textSize'),
 ('Badge',3,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Badge',3,'border',1,2,40,26,'borderColor','borderColor'),
 ('Badge',3,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Badge',3,'radius',1,5,80,26,'radius','radius'),
 ('Badge',3,'height',2,3,80,26,'height','height'),
 ('Badge',3,'width',2,4,80,26,'width','width'),
 ('Badge',3,'text',3,1,40,26,'labelColor','labelColor'),
 ('Badge',3,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Badge',3,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Badge',3,'size',3,5,80,26,'textSize','textSize'),
 ('Header Supporting',4,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Header Supporting',4,'border',1,2,40,26,'borderColor','borderColor'),
 ('Header Supporting',4,'radius',1,5,80,26,'radius','radius'),
 ('Header Supporting',4,'height',2,3,80,26,'height','height'),
 ('Header Supporting',4,'width',2,4,80,26,'width','width'),
 ('Header Supporting',4,'text',3,1,40,26,'labelColor','labelColor'),
 ('Header Supporting',4,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Header Supporting',4,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Header Supporting',4,'size',3,5,80,26,'textSize','textSize'),
 ('Table',5,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Table',5,'border',1,2,40,26,'borderColor','borderColor'),
 ('Table',5,'radius',1,5,80,26,'radius','radius'),
 ('Table',5,'focused',2,1,40,26,'selectedRowColor','selectedRowColor'),
 ('Table',5,'height',2,3,80,26,'height','height'),
 ('Table',5,'width',2,4,80,26,'width','width'),
 ('Row',6,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Row',6,'border',1,2,40,26,'borderColor','borderColor'),
 ('Row',6,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Row',6,'shapeFill',1,4,40,26,'shapeFill','shapeFill'),
 ('Row',6,'height',2,3,80,26,'height','height'),
 ('Row',6,'width',2,4,80,26,'width','width'),
 ('Row',6,'text',3,1,40,26,'labelColor','labelColor'),
 ('Row',6,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Row',6,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Row',6,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Row',6,'size',3,5,80,26,'textSize','textSize'),
 ('Summary',7,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Summary',7,'border',1,2,40,26,'borderColor','borderColor'),
 ('Summary',7,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Summary',7,'shapeFill',1,4,40,26,'shapeFill','shapeFill'),
 ('Summary',7,'height',2,3,80,26,'height','height'),
 ('Summary',7,'width',2,4,80,26,'width','width'),
 ('Summary',7,'text',3,1,40,26,'labelColor','labelColor'),
 ('Summary',7,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Summary',7,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Summary',7,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Summary',7,'size',3,5,80,26,'textSize','textSize'),
 ('Footer',8,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Footer',8,'border',1,2,40,26,'borderColor','borderColor'),
 ('Footer',8,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Footer',8,'shapeFill',1,4,40,26,'shapeFill','shapeFill'),
 ('Footer',8,'height',2,3,80,26,'height','height'),
 ('Footer',8,'width',2,4,80,26,'width','width'),
 ('Footer',8,'text',3,1,40,26,'labelColor','labelColor'),
 ('Footer',8,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Footer',8,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Footer',8,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Footer',8,'size',3,5,80,26,'textSize','textSize'),
 ('Button',9,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Button',9,'border',1,2,40,26,'borderColor','borderColor'),
 ('Button',9,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Button',9,'radius',1,5,80,26,'radius','radius'),
 ('Button',9,'height',2,3,80,26,'height','height'),
 ('Button',9,'width',2,4,80,26,'width','width'),
 ('Button',9,'text',3,1,40,26,'labelColor','labelColor'),
 ('Button',9,'alignment',3,2,40,26,'labelAlignment','labelAlignment'),
 ('Button',9,'bold',3,3,40,26,'headerBold','headerBold'),
 ('Button',9,'wrap',3,4,40,26,'wrapText','wrapText'),
 ('Button',9,'size',3,5,80,26,'textSize','textSize'),
 ('Button 2',10,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Button 2',10,'border',1,2,40,26,'borderColor','borderColor'),
 ('Button 2',10,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Button 2',10,'radius',1,5,80,26,'radius','radius'),
 ('Button 2',10,'height',2,3,80,26,'height','height'),
 ('Button 2',10,'width',2,4,80,26,'width','width'),
 ('Button 3',11,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Button 3',11,'border',1,2,40,26,'borderColor','borderColor'),
 ('Button 3',11,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Button 3',11,'radius',1,5,80,26,'radius','radius'),
 ('Button 3',11,'height',2,3,80,26,'height','height'),
 ('Button 3',11,'width',2,4,80,26,'width','width'),
 ('Button 4',12,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Button 4',12,'border',1,2,40,26,'borderColor','borderColor'),
 ('Button 4',12,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Button 4',12,'radius',1,5,80,26,'radius','radius'),
 ('Button 4',12,'height',2,3,80,26,'height','height'),
 ('Button 4',12,'width',2,4,80,26,'width','width'),
 ('Image',13,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Image',13,'placement',2,6,40,26,'imagePlacement','imagePlacement'),
 ('Image',13,'imageFill',3,6,40,26,'imageFill','imageFill')
ON CONFLICT(area,slot_key) DO UPDATE SET
 area_order=EXCLUDED.area_order,row_no=EXCLUDED.row_no,
 order_no=EXCLUDED.order_no,width_px=EXCLUDED.width_px,height_px=EXCLUDED.height_px,
 property_key=EXCLUDED.property_key,fallback_key=EXCLUDED.fallback_key;

-- The Yes values in the original table. A missing pair means disabled, NOT
-- removed from the ribbon grid. No guessed positions or inferred support.
DELETE FROM md_builder_design2_slot_rules;
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
VALUES
 ('smart_button','Body','fill','backgroundColor'),
 ('smart_button','Body','text','labelColor'),
 ('smart_button','Body','shadow','shadow'),
 ('smart_button','Body','border','borderColor'),
 ('smart_button','Body','radius','radius'),
 ('smart_button','Body','alignment','labelAlignment'),
 ('smart_button','Body','size','textSize'),
 ('smart_button','Body','height','height'),
 ('smart_button','Body','width','width'),
 ('smart_button','Body','shape','shapeId'),
 ('smart_toggle','Body','fill','backgroundColor'),
 ('smart_toggle','Body','shadow','shadow'),
 ('smart_toggle','Body','border','borderColor'),
 ('smart_toggle','Body','radius','radius'),
 ('smart_toggle','Body','focused','accentColor'),
 ('smart_lookup','Body','fill','backgroundColor'),
 ('smart_lookup','Body','text','labelColor'),
 ('smart_lookup','Body','shadow','shadow'),
 ('smart_lookup','Body','border','borderColor'),
 ('smart_lookup','Body','radius','radius'),
 ('smart_lookup','Body','alignment','labelAlignment'),
 ('smart_lookup','Body','size','textSize'),
 ('smart_lookup','Body','height','height'),
 ('smart_lookup','Body','width','width'),
 ('smart_lookup','Body','shape','shapeId'),
 ('smart_lookup','Body','focused','selectedRowColor'),
 ('smart_lookup','Body','bold','headerBold'),
 ('smart_tabs','Body','fill','tabColor'),
 ('smart_tabs','Body','text','labelColor'),
 ('smart_tabs','Body','shadow','shadow'),
 ('smart_tabs','Body','border','borderColor'),
 ('smart_tabs','Body','radius','radius'),
 ('smart_tabs','Body','alignment','labelAlignment'),
 ('smart_tabs','Body','size','textSize'),
 ('smart_tabs','Body','height','height'),
 ('smart_tabs','Body','width','width'),
 ('smart_tabs','Body','bold','headerBold'),
 ('smart_text','Body','fill','backgroundColor'),
 ('smart_text','Body','text','labelColor'),
 ('smart_text','Body','shadow','shadow'),
 ('smart_text','Body','border','borderColor'),
 ('smart_text','Body','radius','radius'),
 ('smart_text','Body','alignment','labelAlignment'),
 ('smart_text','Body','size','textSize'),
 ('smart_text','Body','height','height'),
 ('smart_text','Body','width','width'),
 ('smart_text','Body','shape','shapeId'),
 ('smart_text','Body','shapeFill','shapeFill'),
 ('smart_text','Body','bold','headerBold'),
 ('smart_text','Body','wrap','wrapText'),
 ('smart_textbox','Body','fill','backgroundColor'),
 ('smart_textbox','Body','text','labelColor'),
 ('smart_textbox','Body','shadow','shadow'),
 ('smart_textbox','Body','border','borderColor'),
 ('smart_textbox','Body','radius','radius'),
 ('smart_textbox','Body','alignment','labelAlignment'),
 ('smart_textbox','Body','size','textSize'),
 ('smart_textbox','Body','height','height'),
 ('smart_textbox','Body','width','width'),
 ('smart_textbox','Body','shape','shapeId'),
 ('smart_textbox','Body','shapeFill','shapeFill'),
 ('smart_textbox','Body','bold','headerBold'),
 ('smart_textbox','Header','fill','headerBodyColor'),
 ('smart_textbox','Header','text','headerTextColor'),
 ('smart_textbox','Header','shadow','shadow'),
 ('smart_textbox','Header','border','headerBorderColor'),
 ('smart_textbox','Header','radius','radius'),
 ('smart_textbox','Header','alignment','headerAlignment'),
 ('smart_textbox','Header','size','headerTextSize'),
 ('smart_textbox','Header','height','headerBoxHeight'),
 ('smart_textbox','Header','width','width'),
 ('smart_textbox','Header','shape','shapeId'),
 ('smart_textbox','Header','shapeFill','shapeFill'),
 ('smart_textbox','Header','bold','headerBold'),
 ('smart_navigation','Body','fill','backgroundColor'),
 ('smart_navigation','Body','text','labelColor'),
 ('smart_navigation','Body','shadow','shadow'),
 ('smart_navigation','Body','border','borderColor'),
 ('smart_navigation','Body','radius','radius'),
 ('smart_navigation','Body','alignment','labelAlignment'),
 ('smart_navigation','Body','size','textSize'),
 ('smart_navigation','Body','height','height'),
 ('smart_navigation','Body','width','width'),
 ('smart_navigation','Body','shape','shapeId'),
 ('smart_navigation','Body','shapeFill','shapeFill'),
 ('smart_navigation','Body','focused','selectedTabColor'),
 ('smart_navigation','Body','bold','headerBold'),
 ('smart_container','Body','fill','backgroundColor'),
 ('smart_container','Body','shadow','shadow'),
 ('smart_container','Body','border','borderColor'),
 ('smart_container','Body','radius','radius'),
 ('smart_container','Body','height','height'),
 ('smart_container','Body','width','width'),
 ('smart_container','Body','shape','shapeId'),
 ('smart_card_grid','Body','fill','backgroundColor'),
 ('smart_card_grid','Body','text','labelColor'),
 ('smart_card_grid','Body','shadow','shadow'),
 ('smart_card_grid','Body','border','borderColor'),
 ('smart_card_grid','Body','radius','radius'),
 ('smart_card_grid','Body','alignment','labelAlignment'),
 ('smart_card_grid','Body','size','textSize'),
 ('smart_card_grid','Body','height','height'),
 ('smart_card_grid','Body','width','width'),
 ('smart_card_grid','Body','focused','selectedCardColor'),
 ('smart_card_grid','Body','bold','headerBold'),
 ('smart_card_grid','Header','fill','headerBodyColor'),
 ('smart_card_grid','Header','text','headerTextColor'),
 ('smart_card_grid','Header','shadow','shadow'),
 ('smart_card_grid','Header','border','headerBorderColor'),
 ('smart_card_grid','Header','radius','radius'),
 ('smart_card_grid','Header','alignment','headerAlignment'),
 ('smart_card_grid','Header','size','headerTextSize'),
 ('smart_card_grid','Header','height','headerBoxHeight'),
 ('smart_card_grid','Header','width','width'),
 ('smart_card_grid','Header','bold','headerBold'),
 ('smart_card_grid','Badge','fill','badgeBodyColor'),
 ('smart_card_grid','Badge','text','badgeTextColor'),
 ('smart_card_grid','Badge','border','badgeBorderColor'),
 ('smart_card_grid','Badge','radius','badgeRadius'),
 ('smart_card_grid','Badge','alignment','badgeAlignment'),
 ('smart_card_grid','Badge','size','badgeTextSize'),
 ('smart_card_grid','Badge','height','badgeHeight'),
 ('smart_card_grid','Badge','width','badgeWidth'),
 ('smart_card_grid','Badge','shape','shapeId'),
 ('smart_card_grid','Badge','bold','badgeBold'),
 ('smart_image','Body','fill','backgroundColor'),
 ('smart_image','Body','text','labelColor'),
 ('smart_image','Body','shadow','shadow'),
 ('smart_image','Body','border','borderColor'),
 ('smart_image','Body','radius','radius'),
 ('smart_image','Body','alignment','labelAlignment'),
 ('smart_image','Body','size','textSize'),
 ('smart_image','Body','height','height'),
 ('smart_image','Body','width','width'),
 ('smart_image','Body','focused','selectedCardColor'),
 ('smart_image','Body','bold','headerBold'),
 ('smart_image','Body','wrap','wrapText'),
 ('smart_image','Badge','fill','badgeBodyColor'),
 ('smart_image','Badge','text','badgeTextColor'),
 ('smart_image','Badge','border','badgeBorderColor'),
 ('smart_image','Badge','radius','badgeRadius'),
 ('smart_image','Badge','alignment','badgeAlignment'),
 ('smart_image','Badge','size','badgeTextSize'),
 ('smart_image','Badge','height','badgeHeight'),
 ('smart_image','Badge','width','badgeWidth'),
 ('smart_image','Badge','shape','shapeId'),
 ('smart_image','Badge','bold','badgeBold'),
 ('smart_calendar','Body','fill','backgroundColor'),
 ('smart_calendar','Body','text','labelColor'),
 ('smart_calendar','Body','shadow','shadow'),
 ('smart_calendar','Body','border','borderColor'),
 ('smart_calendar','Body','radius','radius'),
 ('smart_calendar','Body','size','textSize'),
 ('smart_calendar','Body','height','height'),
 ('smart_calendar','Body','width','width'),
 ('smart_calendar','Body','focused','selectedDateColor'),
 ('smart_calendar','Body','bold','headerBold'),
 ('smart_cart','Body','fill','backgroundColor'),
 ('smart_cart','Body','shadow','shadow'),
 ('smart_cart','Body','border','borderColor'),
 ('smart_cart','Body','radius','radius'),
 ('smart_cart','Body','height','height'),
 ('smart_cart','Body','width','width'),
 ('smart_cart','Body','shape','shapeId'),
 ('smart_cart','Body','shapeFill','shapeFill'),
 ('smart_cart','Header','fill','headerBodyColor'),
 ('smart_cart','Header','text','headerTextColor'),
 ('smart_cart','Header','border','headerBorderColor'),
 ('smart_cart','Header','radius','radius'),
 ('smart_cart','Header','alignment','headerAlignment'),
 ('smart_cart','Header','size','headerTextSize'),
 ('smart_cart','Header','height','headerBoxHeight'),
 ('smart_cart','Header','width','width'),
 ('smart_cart','Header','bold','headerBold'),
 ('smart_cart','Header','wrap','wrapText'),
 ('smart_cart','Header Supporting','fill','supportingBackgroundColor'),
 ('smart_cart','Header Supporting','text','supportingTextColor'),
 ('smart_cart','Header Supporting','border','supportingBorderColor'),
 ('smart_cart','Header Supporting','radius','radius'),
 ('smart_cart','Header Supporting','alignment','supportingAlignment'),
 ('smart_cart','Header Supporting','size','supportingTextSize'),
 ('smart_cart','Header Supporting','height','supportingBoxHeight'),
 ('smart_cart','Header Supporting','width','width'),
 ('smart_cart','Header Supporting','bold','supportingBold'),
 ('smart_cart','Table','fill','tableBackgroundColor'),
 ('smart_cart','Table','border','tableBorderColor'),
 ('smart_cart','Table','radius','tableRadius'),
 ('smart_cart','Table','height','tableHeight'),
 ('smart_cart','Table','width','tableWidth'),
 ('smart_cart','Table','focused','selectedRowColor'),
 ('smart_cart','Row','fill','rowBackgroundColor'),
 ('smart_cart','Row','text','rowLabelColor'),
 ('smart_cart','Row','border','rowBorderColor'),
 ('smart_cart','Row','alignment','rowAlignment'),
 ('smart_cart','Row','size','rowTextSize'),
 ('smart_cart','Row','height','rowHeight'),
 ('smart_cart','Row','width','rowWidth'),
 ('smart_cart','Row','shape','shapeId'),
 ('smart_cart','Row','shapeFill','shapeFill'),
 ('smart_cart','Row','bold','rowBold'),
 ('smart_cart','Row','wrap','rowWrapText'),
 ('smart_cart','Summary','fill','summaryBackgroundColor'),
 ('smart_cart','Summary','text','summaryTextColor'),
 ('smart_cart','Summary','border','summaryBorderColor'),
 ('smart_cart','Summary','alignment','summaryAlignment'),
 ('smart_cart','Summary','size','summaryTextSize'),
 ('smart_cart','Summary','height','summaryHeight'),
 ('smart_cart','Summary','width','summaryWidth'),
 ('smart_cart','Summary','shape','shapeId'),
 ('smart_cart','Summary','shapeFill','shapeFill'),
 ('smart_cart','Summary','bold','summaryTextWeight'),
 ('smart_cart','Summary','wrap','summaryWrapText'),
 ('smart_cart','Footer','fill','footerBackgroundColor'),
 ('smart_cart','Footer','text','footerTextColor'),
 ('smart_cart','Footer','border','footerBorderColor'),
 ('smart_cart','Footer','alignment','footerAlignment'),
 ('smart_cart','Footer','size','footerTextSize'),
 ('smart_cart','Footer','height','footerHeight'),
 ('smart_cart','Footer','width','footerWidth'),
 ('smart_cart','Footer','shape','shapeId'),
 ('smart_cart','Footer','shapeFill','shapeFill'),
 ('smart_cart','Footer','bold','footerBold'),
 ('smart_cart','Footer','wrap','footerWrapText'),
 ('smart_table','Body','fill','backgroundColor'),
 ('smart_table','Body','shadow','shadow'),
 ('smart_table','Body','border','borderColor'),
 ('smart_table','Body','radius','radius'),
 ('smart_table','Body','height','height'),
 ('smart_table','Body','width','width'),
 ('smart_table','Body','shape','shapeId'),
 ('smart_table','Body','shapeFill','shapeFill'),
 ('smart_table','Header','fill','headerBodyColor'),
 ('smart_table','Header','text','headerTextColor'),
 ('smart_table','Header','border','headerBorderColor'),
 ('smart_table','Header','radius','radius'),
 ('smart_table','Header','alignment','headerAlignment'),
 ('smart_table','Header','size','headerTextSize'),
 ('smart_table','Header','height','headerBoxHeight'),
 ('smart_table','Header','width','width'),
 ('smart_table','Header','bold','headerBold'),
 ('smart_table','Header','wrap','wrapText'),
 ('smart_table','Row','fill','rowBackgroundColor'),
 ('smart_table','Row','text','rowLabelColor'),
 ('smart_table','Row','border','rowBorderColor'),
 ('smart_table','Row','alignment','rowAlignment'),
 ('smart_table','Row','size','rowTextSize'),
 ('smart_table','Row','height','rowHeight'),
 ('smart_table','Row','width','rowWidth'),
 ('smart_table','Row','shape','shapeId'),
 ('smart_table','Row','shapeFill','shapeFill'),
 ('smart_table','Row','bold','rowBold'),
 ('smart_table','Row','wrap','rowWrapText'),
 ('smart_table','Footer','fill','footerBackgroundColor'),
 ('smart_table','Footer','text','footerTextColor'),
 ('smart_table','Footer','border','footerBorderColor'),
 ('smart_table','Footer','alignment','footerAlignment'),
 ('smart_table','Footer','size','footerTextSize'),
 ('smart_table','Footer','height','footerHeight'),
 ('smart_table','Footer','width','footerWidth'),
 ('smart_table','Footer','shape','shapeId'),
 ('smart_table','Footer','shapeFill','shapeFill'),
 ('smart_table','Footer','bold','footerBold'),
 ('smart_table','Footer','wrap','footerWrapText'),
 ('smart_card_grid','Button','fill','cardButtonFill'),
 ('smart_card_grid','Button','text','cardButtonTextColor'),
 ('smart_card_grid','Button','border','cardButtonBorderColor'),
 ('smart_card_grid','Button','radius','cardButtonRadius'),
 ('smart_card_grid','Button','alignment','cardButtonAlignment'),
 ('smart_card_grid','Button','size','cardButtonTextSize'),
 ('smart_card_grid','Button','height','cardButtonHeight'),
 ('smart_card_grid','Button','width','cardButtonWidth'),
 ('smart_card_grid','Button','shape','cardButtonShape'),
 ('smart_card_grid','Button','bold','cardButtonBold'),
 ('smart_card_grid','Button','wrap','cardButtonWrapText'),
 ('smart_cart','Button','fill','customButton1Fill'),
 ('smart_cart','Button','text','customButton1TextColor'),
 ('smart_cart','Button','border','customButton1BorderColor'),
 ('smart_cart','Button','radius','customButton1Radius'),
 ('smart_cart','Button','alignment','customButton1Alignment'),
 ('smart_cart','Button','size','customButton1TextSize'),
 ('smart_cart','Button','height','customButton1Height'),
 ('smart_cart','Button','width','customButton1Width'),
 ('smart_cart','Button','shape','customButton1Shape'),
 ('smart_cart','Button','bold','customButton1Bold'),
 ('smart_cart','Button','wrap','customButton1WrapText'),
 ('smart_cart','Button 2','fill','customButton2Fill'),
 ('smart_cart','Button 2','border','customButton2BorderColor'),
 ('smart_cart','Button 2','radius','customButton2Radius'),
 ('smart_cart','Button 2','height','customButton2Height'),
 ('smart_cart','Button 2','width','customButton2Width'),
 ('smart_cart','Button 2','shape','customButton2Shape'),
 ('smart_cart','Button 3','fill','customButton3Fill'),
 ('smart_cart','Button 3','border','customButton3BorderColor'),
 ('smart_cart','Button 3','radius','customButton3Radius'),
 ('smart_cart','Button 3','height','customButton3Height'),
 ('smart_cart','Button 3','width','customButton3Width'),
 ('smart_cart','Button 3','shape','customButton3Shape'),
 ('smart_cart','Button 4','fill','customButton4Fill'),
 ('smart_cart','Button 4','border','customButton4BorderColor'),
 ('smart_cart','Button 4','radius','customButton4Radius'),
 ('smart_cart','Button 4','height','customButton4Height'),
 ('smart_cart','Button 4','width','customButton4Width'),
 ('smart_cart','Button 4','shape','customButton4Shape'),
 ('smart_image','Image','fill','imageBackgroundColor'),
 ('smart_image','Image','placement','imagePlacement'),
 ('smart_image','Image','imageFill','imageFill'),
 ('smart_cart','Image','placement','imagePlacement'),
 ('smart_cart','Image','imageFill','imageFill'),
 ('smart_card_grid','Image','fill','imageBackgroundColor'),
 ('smart_card_grid','Image','placement','imagePlacement'),
 ('smart_card_grid','Image','imageFill','imageFill'),
 ('smart_tabs','Body','orientation','tabOrientation'),
 ('smart_navigation','Body','orientation','navigationDirection')
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- Make shared metadata available for exactly the explicitly approved Yes cells.
-- If a renderer property has not yet been implemented, the client renders its
-- fixed slot disabled instead of writing an unimplemented property.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT DISTINCT s.component_api,s.property_key,true
FROM md_builder_design2_slot_rules s
JOIN md_builder_shared_properties p ON p.property_key=s.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271104-zz-design2-exact-approved-matrix.sql

-- BEGIN ORIGINAL MIGRATION 20271104-zzz-design2-row-zero-button-matrix-corrections.sql
-- Correct the remaining six approved Smart Cart Button 5 cells and bind
-- Button / Button 2 / Button 3 / Button 4 / Button 5 to the EXACT
-- elements named in the 2026-11-04 specification:
-- Bin, selected-row +, selected-row -, Custom Button 1, Custom Button 2.
-- Never reuse a different button's styling just to make a slot enabled.
-- Unimplemented property definitions remain visible but disabled.
UPDATE md_builder_design2_slots
SET area_order=14 WHERE area='Image' AND area_order=13;

INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
VALUES
 ('Button 5',13,'fill',1,1,40,26,'backgroundColor','backgroundColor'),
 ('Button 5',13,'border',1,2,40,26,'borderColor','borderColor'),
 ('Button 5',13,'shape',1,3,40,26,'shapeId','shapeId'),
 ('Button 5',13,'radius',1,5,80,26,'radius','radius'),
 ('Button 5',13,'height',2,3,80,26,'height','height'),
 ('Button 5',13,'width',2,4,80,26,'width','width')
ON CONFLICT(area,slot_key) DO UPDATE SET
 area_order=EXCLUDED.area_order,row_no=EXCLUDED.row_no,order_no=EXCLUDED.order_no,
 width_px=EXCLUDED.width_px,height_px=EXCLUDED.height_px;

WITH corrected(area,slot_key,property_key) AS (
 VALUES
 ('Button','fill','removeButtonFill'),
 ('Button','border','removeButtonBorderColor'),
 ('Button','radius','removeButtonRadius'),
 ('Button','height','removeButtonHeight'),
 ('Button','width','removeButtonWidth'),
 ('Button','shape','removeButtonShape'),
 ('Button','text','removeButtonTextColor'),
 ('Button','alignment','removeButtonAlignment'),
 ('Button','size','removeButtonTextSize'),
 ('Button','bold','removeButtonBold'),
 ('Button','wrap','removeButtonWrapText'),
 ('Button 2','fill','qtyIncreaseFill'),
 ('Button 2','border','qtyIncreaseBorderColor'),
 ('Button 2','radius','qtyIncreaseRadius'),
 ('Button 2','height','qtyIncreaseHeight'),
 ('Button 2','width','qtyIncreaseWidth'),
 ('Button 2','shape','qtyIncreaseShape'),
 ('Button 3','fill','qtyDecreaseFill'),
 ('Button 3','border','qtyDecreaseBorderColor'),
 ('Button 3','radius','qtyDecreaseRadius'),
 ('Button 3','height','qtyDecreaseHeight'),
 ('Button 3','width','qtyDecreaseWidth'),
 ('Button 3','shape','qtyDecreaseShape'),
 ('Button 4','fill','customButton1Fill'),
 ('Button 4','border','customButton1BorderColor'),
 ('Button 4','radius','customButton1Radius'),
 ('Button 4','height','customButton1Height'),
 ('Button 4','width','customButton1Width'),
 ('Button 4','shape','customButton1Shape'),
 ('Button 5','fill','customButton2Fill'),
 ('Button 5','border','customButton2BorderColor'),
 ('Button 5','radius','customButton2Radius'),
 ('Button 5','height','customButton2Height'),
 ('Button 5','width','customButton2Width'),
 ('Button 5','shape','customButton2Shape')
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_cart',area,slot_key,property_key FROM corrected
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET
 property_key=EXCLUDED.property_key;

-- These are the supported CUSTOM buttons already implemented by the renderer.
-- Do not falsely enable Bin/+/- styling until their renderers use those keys.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT DISTINCT 'smart_cart',r.property_key,true
FROM md_builder_design2_slot_rules r
JOIN md_builder_shared_properties p ON p.property_key=r.property_key
WHERE r.component_api='smart_cart' AND r.area IN ('Button 4','Button 5')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271104-zzz-design2-row-zero-button-matrix-corrections.sql

-- BEGIN ORIGINAL MIGRATION 20271105-data-loader-ribbon-overrides.sql
-- Tenant-scoped ribbon visibility: preserve global property definitions, rendering and saved component properties.
CREATE TABLE IF NOT EXISTS md_data_loader_ribbon_visibility (
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 component_api text NOT NULL,
 property_key text NOT NULL,
 enabled boolean NOT NULL,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,component_api,property_key),
 FOREIGN KEY (component_api,property_key)
   REFERENCES md_builder_ribbon_component_rules(component_api,property_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS md_data_loader_ribbon_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES md_tenants(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL,
 component_api text NOT NULL,
 property_key text NOT NULL,
 previous_enabled boolean NOT NULL,
 enabled boolean NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_data_loader_ribbon_audit_tenant_date
 ON md_data_loader_ribbon_audit (tenant_id,changed_at DESC);
-- END ORIGINAL MIGRATION 20271105-data-loader-ribbon-overrides.sql

-- BEGIN ORIGINAL MIGRATION 20271106-design2-functional-control-parity.sql
-- Restore the semantic Design 2 mapping without moving approved R/C slots.
-- Shared catalog only. Saved pages and tenant-specific metadata remain untouched.
--
-- A slot existing in the grid is not the same as a working control: enable a
-- property only when its matching shared definition and renderer exist.
UPDATE md_builder_design2_slot_rules
SET property_key='backgroundColor'
WHERE component_api='smart_tabs' AND area='Body' AND slot_key='fill';

INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
VALUES
  ('smart_textbox','Body','wrap','wrapText'),
  -- Caption alignment remains Body R3C2; value alignment is independently
  -- editable in the existing Header Supporting R3C2 slot.
  ('smart_textbox','Header Supporting','alignment','supportingAlignment'),
  ('smart_textbox','Header Supporting','text','supportingTextColor'),
  ('smart_textbox','Header Supporting','border','supportingBorderColor'),
  ('smart_textbox','Header Supporting','bold','supportingBold'),
  ('smart_icon','Body','fill','backgroundColor'),
  ('smart_icon','Body','border','borderColor'),
  ('smart_icon','Body','shadow','shadow'),
  ('smart_icon','Body','radius','radius'),
  ('smart_icon','Body','width','width'),
  ('smart_icon','Body','height','height'),
  ('smart_toggle','Body','width','width'),
  ('smart_toggle','Body','height','height')
ON CONFLICT(component_api,area,slot_key)
DO UPDATE SET property_key=EXCLUDED.property_key;

-- Definitions below were referenced by approved Design 2 rules but had no
-- shared metadata definition. Without one, SmartRibbon draws a disabled glyph.
-- Define only keys with a renderer below; leave Bin/+/- keys disabled.
WITH spec(property_key,label,section_group,control_kind,default_json) AS (
 VALUES
 ('badgeHeight','Badge Height','Badge','number',NULL),
 ('badgeWidth','Badge Width','Badge','number',NULL),
 ('badgeBorderColor','Badge Border','Badge','color',NULL),
 ('badgeRadius','Badge Radius','Badge','number',NULL),
 ('tableHeight','Table Height','Table','number',NULL),
 ('tableWidth','Table Width','Table','number',NULL),
 ('rowWidth','Row Width','Row','number',NULL),
 ('footerHeight','Footer Height','Footer','number',NULL),
 ('footerWidth','Footer Width','Footer','number',NULL),
 ('footerBackgroundColor','Footer Fill','Footer','color',NULL),
 ('footerTextColor','Footer Text Color','Footer','color',NULL),
 ('footerBorderColor','Footer Border','Footer','color',NULL),
 ('footerAlignment','Footer Alignment','Footer','align',NULL),
 ('footerTextSize','Footer Text Size','Footer','number',NULL),
 ('footerBold','Footer Bold','Footer','boolean','false'),
 ('footerWrapText','Footer Wrap','Footer','boolean','true'),
 ('cardButtonHeight','Button Height','Button','number',NULL),
 ('cardButtonWidth','Button Width','Button','number',NULL),
 ('cardButtonRadius','Button Radius','Button','number',NULL),
 ('cardButtonAlignment','Button Alignment','Button','align',NULL),
 ('cardButtonBold','Button Bold','Button','boolean',NULL),
 ('cardButtonWrapText','Button Wrap','Button','boolean',NULL)
), base AS (SELECT COALESCE(MAX(sort_order),0) last_order FROM md_builder_shared_properties),
 numbered AS (
 SELECT s.*,ROW_NUMBER() OVER(ORDER BY s.property_key) ordinal FROM spec s
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,choices,scope)
SELECT s.property_key,s.label,'Design2',s.section_group,s.control_kind,
 base.last_order+s.ordinal,s.default_json::jsonb,'[]'::jsonb,'component'
FROM numbered s CROSS JOIN base
ON CONFLICT(property_key) DO NOTHING;

-- Make only the genuinely implemented approved controls editable. Retain
-- tenant-specific ribbon visibility overrides independently of these defaults.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT DISTINCT rules.component_api,rules.property_key,true
FROM md_builder_design2_slot_rules rules
JOIN md_builder_shared_properties property ON property.property_key=rules.property_key
WHERE
 (rules.component_api='smart_tabs' AND rules.area='Body')
 OR (rules.component_api='smart_textbox' AND
      (rules.area='Body' AND rules.slot_key='wrap'
       OR rules.area='Header Supporting'))
 OR (rules.component_api IN ('smart_icon','smart_toggle') AND
      rules.area='Body' AND rules.slot_key IN ('fill','border','shadow','radius','height','width'))
 OR rules.property_key IN
   ('badgeHeight','badgeWidth','badgeBorderColor','badgeRadius',
    'tableHeight','tableWidth','rowWidth',
    'footerHeight','footerWidth','footerBackgroundColor',
    'footerTextColor','footerBorderColor','footerAlignment','footerTextSize',
    'footerBold','footerWrapText',
    'cardButtonHeight','cardButtonWidth','cardButtonRadius',
    'cardButtonAlignment','cardButtonBold','cardButtonWrapText')
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271106-design2-functional-control-parity.sql

-- BEGIN ORIGINAL MIGRATION 20271106-design2-row0-xy-position.sql
-- Design 2 R0 C3/C4: reuse the global x/y canvas POSITION keys.
-- The same properties remain in Layout. Do not create duplicate values,
-- change R1-R3 SQL slots, or alter tenant page/instance data.
-- smart_input is listed in the approved table but is not in the current
-- bundled Smart component registry; its rule is conditional on registration.
WITH requested(component_api) AS (
 VALUES
 ('smart_button'),
 ('smart_calendar'),
 ('smart_card_grid'),
 ('smart_cart'),
 ('smart_container'),
 ('smart_icon'),
 ('smart_image'),
 ('smart_lookup'),
 ('smart_navigation'),
 ('smart_table'),
 ('smart_tabs'),
 ('smart_text'),
 ('smart_textbox'),
 ('smart_toggle'),
 ('smart_input')
)
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT c.component_api,p.property_key,true
FROM requested r
JOIN md_builder_ribbon_components c ON c.component_api=r.component_api
JOIN md_builder_shared_properties p ON p.property_key IN ('x','y')
  AND p.control_kind='position'
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271106-design2-row0-xy-position.sql

-- BEGIN ORIGINAL MIGRATION 20271107-design2-alignment-icon-bindings.sql
-- Complete the actual Design 2 R3C2 alignment controls, reusing the
-- renderer's existing footer keys rather than creating inactive aliases.
-- This changes only shared metadata; it does not mutate tenant pages.
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
VALUES
 ('smart_cart','Footer','alignment','summary2Alignment'),
 ('smart_table','Footer','alignment','summaryAlignment')
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET
 property_key=EXCLUDED.property_key;

-- Smart Card Grid's button text needs its own alignment property (the
-- existing Body/Header alignment keys style different parts of the card).
WITH next_order AS (SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM md_builder_shared_properties)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,design_row,design_order,design_width,design_height,
  design_caption_width,design_display)
SELECT 'cardButtonAlignment','Button Alignment','Design2','Button','align',
 n,NULL::jsonb,'[]'::jsonb,'component',3,2,40,26,0,'dropdown'
FROM next_order
ON CONFLICT(property_key) DO NOTHING;

INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT c.component_api,p.property_key,true
FROM md_builder_ribbon_components c
JOIN md_builder_shared_properties p ON p.property_key='cardButtonAlignment'
WHERE c.component_api='smart_card_grid'
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271107-design2-alignment-icon-bindings.sql

-- BEGIN ORIGINAL MIGRATION 20271108-design2-four-control-parity.sql
-- Reuse the four approved Design 2 control slots for their existing
-- component properties. No slot position, visual control or tenant page changes.
-- Body Focus uses the existing Focus Color palette icon (R2 C1); Image Fit
-- uses the existing image Fill/Fit/Stretch icon dropdown (R3 C6).
--
-- All four target properties already have native renderer hooks and original
-- Design/Layout ribbon definitions. Never introduce dead alias properties.
INSERT INTO md_builder_design2_slot_rules
 (component_api,area,slot_key,property_key)
VALUES
 ('smart_calendar','Body','focused','defaultValueColor'),
 ('smart_card_grid','Body','wrap','wrapText'),
 ('smart_navigation','Image','imageFill','imageFill'),
 ('smart_toggle','Body','shape','shapeId')
ON CONFLICT(component_api,area,slot_key)
DO UPDATE SET property_key=EXCLUDED.property_key;

-- Respect the global shared-property catalogue and existing per-component
-- overrides. Re-enable only these exact approved component/property pairs.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT approved.component_api,approved.property_key,true
FROM (VALUES
 ('smart_calendar','defaultValueColor'),
 ('smart_card_grid','wrapText'),
 ('smart_navigation','imageFill'),
 ('smart_toggle','shapeId')
) AS approved(component_api,property_key)
JOIN md_builder_ribbon_components component
  ON component.component_api=approved.component_api
JOIN md_builder_shared_properties property
  ON property.property_key=approved.property_key
ON CONFLICT(component_api,property_key)
DO UPDATE SET enabled=true;
-- END ORIGINAL MIGRATION 20271108-design2-four-control-parity.sql

-- BEGIN ORIGINAL MIGRATION 20271109-badge-visibility-layout.sql
-- Badge Visible is a layout option, not a colour/design option.
-- Shared property inventory is the single source of truth; both Smart Card
-- Grid and Smart Image already use this property and its existing enabled rules.
-- Keep the Badge visibility button in the Design 2 context row unchanged.
UPDATE md_builder_shared_properties
SET tab='Layout',section_group='Badge'
WHERE property_key='badgeVisible' AND tab<>'Home';
-- END ORIGINAL MIGRATION 20271109-badge-visibility-layout.sql

-- BEGIN ORIGINAL MIGRATION 20271110-data-ribbon-formula-row-equal-widths.sql
-- Data tab geometry: formula occupies the entire first row in the browser.
-- The Source, Values and Cart sections render below it on metadata-driven rows.
-- Keep existing property mappings, component applicability and user data intact.
-- Equal text/formula chip widths prevent neighboring controls from overlapping.
UPDATE md_builder_shared_properties
SET design_width=210, design_height=26
WHERE tab='Data' AND section_group='Source'
  AND property_key IN ('objectApiName','objectApiName2','objectApiName3');

UPDATE md_builder_shared_properties
SET design_width=160, design_height=26, design_caption_width=0
WHERE tab='Data' AND section_group='Values'
  AND property_key IN (
    'imageSource','textSource','label','badgeText','defaultValue','defaultCheck'
  );

UPDATE md_builder_shared_properties
SET design_width=CASE WHEN property_key='columnVisibility' THEN 171 ELSE 160 END,
    design_height=26, design_caption_width=0
WHERE tab='Data' AND section_group='Cart'
  AND property_key IN (
    'column2Source','column3Source','column4Source','column5Source',
    'subtotalValue','totalValue','taxValue','discountValue','columnVisibility'
  );
-- END ORIGINAL MIGRATION 20271110-data-ribbon-formula-row-equal-widths.sql

-- BEGIN ORIGINAL MIGRATION 20271111-data-ribbon-approved-compact-three-rows.sql
-- Approved Data-tab compact placement from the user-edited ribbon screenshot.
-- Geometry only: do not create component properties, alter per-component rules,
-- page values, formulas, filters, actions or tenant records. Safe to rerun.
-- The shared formula bar is rendered independently above these three rows.
-- Source width includes its existing 47px label + 3px gap + 115px selector.
WITH placement(property_key,group_name,row_no,col_no,width_px) AS (
 VALUES
 ('objectApiName','Source',1,1,165),
 ('objectApiName2','Source',2,1,165),
 ('objectApiName3','Source',3,1,165),
 -- Values: three controls, three controls, two controls.
 ('imageSource','Values',1,1,120),
 ('textSource','Values',1,2,120),
 ('label','Values',1,3,120),
 ('badgeText','Values',2,1,120),
 ('customButton1Label','Values',2,2,120),
 ('customButton2Label','Values',2,3,120),
 ('defaultValue','Values',3,1,120),
 ('defaultCheck','Values',3,2,120),
 -- Cart: the third row begins with the EXISTING inline Cart summary label.
 -- Its input is a presentation-only editor, not an invented metadata property.
 ('column2Source','Cart',1,1,120),
 ('column3Source','Cart',1,2,120),
 ('subtotalValue','Cart',1,3,120),
 ('taxValue','Cart',1,4,120),
 ('column4Source','Cart',2,1,120),
 ('rowSupportingSource','Cart',2,2,120),
 ('column5Source','Cart',2,3,120),
 ('totalValue','Cart',2,4,120),
 ('discountValue','Cart',3,2,120),
 ('columnVisibility','Cart',3,3,120),
 -- Card Grid: one control per row, not two side-by-side.
 ('cardDescription','Card Grid',1,1,120),
 ('cardButtonText','Card Grid',2,1,120),
 ('cardValue','Card Grid',3,1,120)
)
UPDATE md_builder_shared_properties AS p
SET section_group=v.group_name,
    design_row=v.row_no,
    design_order=v.col_no,
    design_width=v.width_px,
    design_height=26,
    design_caption_width=0
FROM placement AS v
WHERE p.tab='Data' AND p.property_key=v.property_key;
-- END ORIGINAL MIGRATION 20271111-data-ribbon-approved-compact-three-rows.sql

-- BEGIN ORIGINAL MIGRATION 20271111-design2-design-tab-parity.sql
-- Design 2 parity before the legacy Design tab is retired.
-- Every property below is already defined, already enabled for the component
-- and already read by its renderer, but had no Design 2 cell. Each is placed
-- in an EXISTING fixed R/C slot of the matching dropdown; no slot moves, no new
-- property definitions, no tenant page or instance data changes.
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT approved.component_api,approved.area,approved.slot_key,approved.property_key
FROM (VALUES
 -- Smart Table: Table dropdown
 ('smart_table','Table','fill','tableBackgroundColor'),
 ('smart_table','Table','border','tableBorderColor'),
 ('smart_table','Table','radius','tableRadius'),
 ('smart_table','Table','shadow','tableShadow'),
 ('smart_table','Table','focused','selectedRowColor'),
 -- Smart Table: Row and Footer (summary) corner radius / shadow
 ('smart_table','Row','radius','rowRadius'),
 ('smart_table','Footer','radius','summaryRadius'),
 ('smart_table','Footer','shadow','summaryShadow'),
 -- Smart Cart
 ('smart_cart','Row','radius','rowRadius'),
 ('smart_cart','Summary','radius','summaryRadius'),
 ('smart_cart','Summary','shadow','summaryShadow'),
 ('smart_cart','Table','shadow','tableShadow'),
 -- Smart Image: Header dropdown
 ('smart_image','Header','alignment','headerAlignment'),
 ('smart_image','Header','border','headerBorderColor')
) AS approved(component_api,area,slot_key,property_key)
JOIN md_builder_ribbon_components component
  ON component.component_api=approved.component_api
JOIN md_builder_shared_properties property
  ON property.property_key=approved.property_key
-- Never replace a cell that the approved matrix already assigned.
ON CONFLICT(component_api,area,slot_key) DO NOTHING;

-- Selected Row Border is retired for Smart Cart and Smart Table: the renderers
-- no longer read it (a selected row keeps its normal row border). The shared
-- definition and any saved values are kept; only applicability is switched off.
UPDATE md_builder_ribbon_component_rules
SET enabled=false
WHERE property_key='selectedRowBorderColor'
  AND component_api IN ('smart_cart','smart_table');

-- Per-component edit condition, alongside the global enabled_when.
ALTER TABLE md_builder_ribbon_component_rules
 ADD COLUMN IF NOT EXISTS enabled_when_override jsonb;

-- Smart Card Grid image size lives in the Image dropdown: Width R2C4 only for
-- left/right images, Height R2C3 only for top/bottom (unset = top).
-- Smart Image and Smart Cart keep using Image Height without a condition.
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_card_grid','Image',approved.slot_key,approved.property_key
FROM (VALUES ('width','imageWidth'),('height','imageHeight'))
  AS approved(slot_key,property_key)
JOIN md_builder_ribbon_components component ON component.component_api='smart_card_grid'
JOIN md_builder_shared_properties property ON property.property_key=approved.property_key
ON CONFLICT(component_api,area,slot_key) DO NOTHING;

UPDATE md_builder_ribbon_component_rules
SET enabled_when_override='{"property":"imagePlacement","in":["","top","bottom"]}'::jsonb
WHERE component_api='smart_card_grid' AND property_key='imageHeight';

-- Default Value Color is retired for Smart Table: it only backed up the header
-- text colour, which Header R3C1 (headerTextColor) already controls.
-- Smart Calendar keeps using it (Body Focus R2C1).
UPDATE md_builder_ribbon_component_rules
SET enabled=false
WHERE property_key='defaultValueColor' AND component_api='smart_table';
-- END ORIGINAL MIGRATION 20271111-design2-design-tab-parity.sql

-- BEGIN ORIGINAL MIGRATION 20271112-design2-image-placement-gap.sql
-- Close the empty R2C5 gap between Width (R2C4) and Image Placement.
-- This changes only the shared SQL-backed Design 2 presentation slot;
-- no property values, tenant page records, permissions or ribbon heights change.
-- Safe to replay; leave any subsequently customised placement untouched.
UPDATE md_builder_design2_slots
SET order_no = 5
WHERE area = 'Image'
  AND slot_key = 'placement'
  AND row_no = 2
  AND order_no = 6;
-- END ORIGINAL MIGRATION 20271112-design2-image-placement-gap.sql

-- BEGIN ORIGINAL MIGRATION 20271112-restore-compact-data-ribbon.sql
-- Forward-only correction: undo the Data ribbon three-row geometry from
-- 20271110 and 20271111. Restore the 114px shared ribbon and two display rows.
-- Reuse the same 24 global SQL property keys; retain all new kiosk capabilities,
-- component rule applicability and published tenant values.
-- Safe and idempotent: visual SQL metadata only, no tenant data edits.
WITH placement(property_key,group_name,row_no,col_no,width_px,caption_px) AS (
 VALUES
 ('objectApiName','Source',1,1,150,52),
 ('objectApiName2','Source',2,1,150,52),
 ('objectApiName3','Source',3,1,150,52),
 ('imageSource','Values',1,1,144,0),
 ('textSource','Values',1,2,144,0),
 ('label','Values',1,3,144,0),
 ('badgeText','Values',2,1,144,0),
 ('defaultValue','Values',2,2,144,0),
 ('defaultCheck','Values',2,3,150,0),
 ('customButton1Label','Values',2,4,144,0),
 ('customButton2Label','Values',2,5,144,0),
 ('column2Source','Cart',1,1,144,0),
 ('column3Source','Cart',1,2,144,0),
 ('subtotalValue','Cart',1,3,144,0),
 ('taxValue','Cart',1,4,144,0),
 ('column4Source','Cart',2,1,144,0),
 ('column5Source','Cart',2,2,144,0),
 ('totalValue','Cart',2,3,144,0),
 ('discountValue','Cart',2,4,144,0),
 ('columnVisibility','Cart',2,5,150,0),
 ('rowSupportingSource','Cart',2,6,144,0),
 ('cardDescription','Card Grid',1,1,144,0),
 ('cardValue','Card Grid',1,2,144,0),
 ('cardButtonText','Card Grid',2,1,144,0)
)
UPDATE md_builder_shared_properties AS p
SET section_group=v.group_name,
    design_row=v.row_no,
    design_order=v.col_no,
    design_width=v.width_px,
    design_height=26,
    design_caption_width=v.caption_px
FROM placement AS v
WHERE p.tab='Data' AND p.property_key=v.property_key;
-- END ORIGINAL MIGRATION 20271112-restore-compact-data-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20271112-smart-label-component.sql
-- Smart Label: a read-only Smart Input Box. It reuses the ONE shared property
-- inventory, the Smart Input Box renderer path and its data binding
-- (label/textSource/object sources). Only the Text Mode switch is omitted,
-- because a Smart Label is always display-only. Shared catalog only: no
-- tenant page, component instance or business record is modified.
INSERT INTO md_builder_ribbon_components(component_api)
VALUES ('smart_label') ON CONFLICT(component_api) DO NOTHING;

-- Same enabled ribbon properties and overrides as smart_text (e.g. Bold
-- defaults to false), except displayMode.
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled,control_kind_override,value_key,
  default_value_override,choices_override)
SELECT 'smart_label',r.property_key,r.enabled,r.control_kind_override,r.value_key,
 r.default_value_override,r.choices_override
FROM md_builder_ribbon_component_rules r
WHERE r.component_api='smart_text' AND r.property_key<>'displayMode'
ON CONFLICT(component_api,property_key) DO NOTHING;

-- Same Design 2 slot support (fixed positions are shared by every component).
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_label',s.area,s.slot_key,s.property_key
FROM md_builder_design2_slot_rules s
WHERE s.component_api='smart_text' AND s.property_key<>'displayMode'
ON CONFLICT(component_api,area,slot_key) DO NOTHING;

-- Fresh tenants use the shared Smart component seeder. Existing tenants gain
-- the same registration without overwriting custom component metadata.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'smart_label','one-bundled:smart_label',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20271112-smart-label-component.sql

-- BEGIN ORIGINAL MIGRATION 20271113-canvas-formula-binding-icons.sql
-- One shared Data editor. New expression targets reuse SQL ribbon rules, the
-- existing Formula Engine and existing component properties; no tenant pages
-- or business records are rewritten. Forward-only/idempotent.
WITH spec(property_key,label,component_api,ordinal) AS (
 VALUES
 ('cartSupportingSource','Cart supporting text','smart_cart',1),
 ('cartColumn1Header','Product heading','smart_cart',2),
 ('cartColumn2Header','Unit price heading','smart_cart',3),
 ('cartColumn3Header','Quantity heading','smart_cart',4),
 ('cartColumn4Header','Total heading','smart_cart',5),
 ('cartColumn5Header','Discount heading','smart_cart',6),
 ('subtotalLabel','Subtotal heading','smart_cart',7),
 ('discountLabel','Discount heading','smart_cart',8),
 ('taxLabel','Tax heading','smart_cart',9),
 ('totalLabel','Total heading','smart_cart',10),
 ('lookupValueFormula','Search value','smart_lookup',11),
 ('selectedDate','Selected date','smart_calendar',12),
 ('tabCaptionFormula','Tab caption','smart_tabs',13)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties(
 property_key,label,tab,section_group,control_kind,sort_order,
 default_value,choices,scope,field_select)
SELECT spec.property_key,spec.label,'Data','Values','expression',
 last_order.n+spec.ordinal,NULL,'[]'::jsonb,'component',true
FROM spec CROSS JOIN last_order
ON CONFLICT(property_key) DO NOTHING;

WITH spec(property_key,component_api,value_key) AS (
 VALUES
 ('cartSupportingSource','smart_cart',NULL::text),
 ('cartColumn1Header','smart_cart',NULL),
 ('cartColumn2Header','smart_cart',NULL),
 ('cartColumn3Header','smart_cart',NULL),
 ('cartColumn4Header','smart_cart',NULL),
 ('cartColumn5Header','smart_cart',NULL),
 ('subtotalLabel','smart_cart',NULL),
 ('discountLabel','smart_cart',NULL),
 ('taxLabel','smart_cart',NULL),
 ('totalLabel','smart_cart',NULL),
 ('label','smart_cart',NULL),
 ('lookupValueFormula','smart_lookup',NULL),
 ('selectedDate','smart_calendar',NULL),
 ('tabCaptionFormula','smart_tabs','tabs'),
 ('objectApiName','smart_calendar',NULL),
 ('objectApiName2','smart_calendar',NULL),
 ('objectApiName3','smart_calendar',NULL)
)
INSERT INTO md_builder_ribbon_component_rules(
 component_api,property_key,enabled,control_kind_override,value_key,
 default_value_override,choices_override)
SELECT spec.component_api,spec.property_key,true,NULL,spec.value_key,NULL,NULL
FROM spec
JOIN md_builder_ribbon_components c ON c.component_api=spec.component_api
JOIN md_builder_shared_properties p ON p.property_key=spec.property_key
ON CONFLICT(component_api,property_key) DO UPDATE
 SET enabled=true,value_key=COALESCE(EXCLUDED.value_key,md_builder_ribbon_component_rules.value_key);

-- These are choices, not binding expressions. Keep them editable in Layout,
-- where existing settings controls continue to use their original SQL keys.
UPDATE md_builder_shared_properties
SET tab='Layout',section_group='Behaviour'
WHERE property_key='defaultCheck' AND tab='Data';
UPDATE md_builder_shared_properties
SET tab='Layout',section_group='Cart'
WHERE property_key='columnVisibility' AND tab='Data';
-- END ORIGINAL MIGRATION 20271113-canvas-formula-binding-icons.sql

-- BEGIN ORIGINAL MIGRATION 20271113-kiosk-text-button-ribbon-extensions.sql
-- Shared Smart ribbon extensions for kiosk pages. Catalog only: no tenant page,
-- component instance or business record is modified. Fixed Design 2 positions
-- are reused; only the Button 2-5 dropdowns gain the R3C1 Text cell that the
-- Button dropdown already has.

-- 1. Missing shared definitions: Smart Cart quantity -/+ buttons and the
--    custom-button radius cells already placed in Design 2 Button 4/5.
WITH specs(property_key,label,section_group,control_kind,choices,min_value,max_value,ordinal) AS (
 VALUES
 ('qtyIncreaseFill','Fill','Qty Increase','color','[]'::jsonb,NULL::integer,NULL::integer,1),
 ('qtyIncreaseBorderColor','Border','Qty Increase','color','[]'::jsonb,NULL,NULL,2),
 ('qtyIncreaseShape','Shape','Qty Increase','choice','["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL,NULL,3),
 ('qtyIncreaseRadius','Radius','Qty Increase','number','[]'::jsonb,0,600,4),
 ('qtyIncreaseWidth','Width','Qty Increase','number','[]'::jsonb,0,1200,5),
 ('qtyIncreaseHeight','Height','Qty Increase','number','[]'::jsonb,24,1200,6),
 ('qtyIncreaseTextColor','Text Color','Qty Increase','color','[]'::jsonb,NULL,NULL,7),
 ('qtyDecreaseFill','Fill','Qty Decrease','color','[]'::jsonb,NULL,NULL,8),
 ('qtyDecreaseBorderColor','Border','Qty Decrease','color','[]'::jsonb,NULL,NULL,9),
 ('qtyDecreaseShape','Shape','Qty Decrease','choice','["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL,NULL,10),
 ('qtyDecreaseRadius','Radius','Qty Decrease','number','[]'::jsonb,0,600,11),
 ('qtyDecreaseWidth','Width','Qty Decrease','number','[]'::jsonb,0,1200,12),
 ('qtyDecreaseHeight','Height','Qty Decrease','number','[]'::jsonb,24,1200,13),
 ('qtyDecreaseTextColor','Text Color','Qty Decrease','color','[]'::jsonb,NULL,NULL,14),
 ('customButton1Radius','Radius','Custom Button 1','number','[]'::jsonb,0,600,15),
 ('customButton2Radius','Radius','Custom Button 2','number','[]'::jsonb,0,600,16)
), missing AS (
 SELECT s.*,ROW_NUMBER() OVER(ORDER BY s.ordinal) AS pos FROM specs s
 WHERE NOT EXISTS(SELECT 1 FROM md_builder_shared_properties p WHERE p.property_key=s.property_key)
), last_order AS (
 SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties
)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,min_value,max_value,field_select,design_row,design_order,
  design_width,design_height,design_caption_width,design_display)
SELECT m.property_key,m.label,'Design2',m.section_group,m.control_kind,
 l.n+m.pos,NULL::jsonb,m.choices,'component',m.min_value,m.max_value,false,2,1,
 CASE WHEN m.control_kind='choice' THEN 116 WHEN m.control_kind='number' THEN 58 ELSE 40 END,
 26,0,'buttons'
FROM missing m CROSS JOIN last_order l
ON CONFLICT(property_key) DO NOTHING;

-- 2. Applicability. Card Grid description = Header Supporting text; price
--    (card value) = Footer text. Button gains Bold. Cart gains its qty buttons.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT rules.component_api,rules.property_key,true FROM (VALUES
 ('smart_card_grid','supportingTextColor'),('smart_card_grid','supportingBold'),
 ('smart_card_grid','supportingAlignment'),('smart_card_grid','supportingTextSize'),
 ('smart_card_grid','footerTextColor'),('smart_card_grid','footerBold'),
 ('smart_card_grid','footerTextSize'),
 ('smart_button','headerBold'),
 ('smart_cart','qtyIncreaseFill'),('smart_cart','qtyIncreaseBorderColor'),
 ('smart_cart','qtyIncreaseShape'),('smart_cart','qtyIncreaseRadius'),
 ('smart_cart','qtyIncreaseWidth'),('smart_cart','qtyIncreaseHeight'),
 ('smart_cart','qtyIncreaseTextColor'),
 ('smart_cart','qtyDecreaseFill'),('smart_cart','qtyDecreaseBorderColor'),
 ('smart_cart','qtyDecreaseShape'),('smart_cart','qtyDecreaseRadius'),
 ('smart_cart','qtyDecreaseWidth'),('smart_cart','qtyDecreaseHeight'),
 ('smart_cart','qtyDecreaseTextColor'),
 ('smart_cart','customButton1Radius'),('smart_cart','customButton2Radius'),
 ('smart_card_grid','customButton1Radius'),('smart_card_grid','customButton2Radius')
) AS rules(component_api,property_key)
JOIN md_builder_ribbon_components c ON c.component_api=rules.component_api
JOIN md_builder_shared_properties p ON p.property_key=rules.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Defaults shown in the ribbon match what renders when nothing is saved:
-- Button text is normal weight; a Card Grid price is bold.
UPDATE md_builder_ribbon_component_rules SET default_value_override='false'::jsonb
WHERE component_api='smart_button' AND property_key='headerBold' AND default_value_override IS NULL;
UPDATE md_builder_ribbon_component_rules SET default_value_override='true'::jsonb
WHERE component_api='smart_card_grid' AND property_key='footerBold' AND default_value_override IS NULL;

-- 3. Button 2-5 dropdowns get the same R3C1 Text cell as Button.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT s.area,s.area_order,'text',3,1,40,26,'labelColor','labelColor'
FROM (SELECT DISTINCT area,area_order FROM md_builder_design2_slots
      WHERE area IN ('Button 2','Button 3','Button 4','Button 5')) s
ON CONFLICT(area,slot_key) DO NOTHING;

-- 4. Design 2 cells (fixed positions, per-component property).
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT approved.component_api,approved.area,approved.slot_key,approved.property_key
FROM (VALUES
 ('smart_card_grid','Header Supporting','text','supportingTextColor'),
 ('smart_card_grid','Header Supporting','alignment','supportingAlignment'),
 ('smart_card_grid','Header Supporting','bold','supportingBold'),
 ('smart_card_grid','Header Supporting','size','supportingTextSize'),
 ('smart_card_grid','Footer','text','footerTextColor'),
 ('smart_card_grid','Footer','bold','footerBold'),
 ('smart_card_grid','Footer','size','footerTextSize'),
 ('smart_button','Body','bold','headerBold'),
 ('smart_cart','Button 2','text','qtyIncreaseTextColor'),
 ('smart_cart','Button 3','text','qtyDecreaseTextColor'),
 ('smart_cart','Button 4','text','customButton1TextColor'),
 ('smart_cart','Button 5','text','customButton2TextColor')
) AS approved(component_api,area,slot_key,property_key)
JOIN md_builder_ribbon_components component ON component.component_api=approved.component_api
JOIN md_builder_shared_properties property ON property.property_key=approved.property_key
JOIN md_builder_design2_slots slot ON slot.area=approved.area AND slot.slot_key=approved.slot_key
ON CONFLICT(component_api,area,slot_key) DO NOTHING;
-- END ORIGINAL MIGRATION 20271113-kiosk-text-button-ribbon-extensions.sql

-- BEGIN ORIGINAL MIGRATION 20271114-items-source-display-label.sql
-- Collection is a record-list SOURCE, not a visible field caption.
-- Preserve tenant/user overrides by changing only the original default label.
-- Idempotent and does not touch component instances, published pages or data.
UPDATE md_builder_shared_properties
SET label='Items source'
WHERE property_key='collectionFormula' AND label='Collection';
-- END ORIGINAL MIGRATION 20271114-items-source-display-label.sql

-- BEGIN ORIGINAL MIGRATION 20271114-page-builder-retire-layout-ribbon.sql
-- Retire Layout only when every known component Layout property has a Design 2
-- editor or an explicitly requested removal. Preserve keys, rules and saved values.
-- Fail safely if future/unreviewed Layout properties exist.
DO $$
DECLARE unexpected text;
BEGIN
 SELECT string_agg(property_key, ', ' ORDER BY property_key) INTO unexpected
 FROM md_builder_shared_properties
 WHERE tab='Layout' AND scope='component'
   AND property_key NOT IN (
     'width','height','x','y',
     'tabWidth','tabHeight','tabCount','tabIndex','tabOrientation',
     'cardsPerRow','cardsPerColumn',
     'imageHeight','headerBoxHeight','supportingBoxHeight',
     'navigationDirection','showDays','firstDay',
     'imageFill','imagePlacement','imageBorderColor','imageBackgroundColor',
     'iconFillColor','badgeVisible',
     'defaultCheck','columnVisibility'
   );
 IF unexpected IS NOT NULL THEN
   RAISE EXCEPTION 'Layout cannot retire: unmapped component properties: %', unexpected;
 END IF;
END $$;

-- Explicitly retire the two unwanted controls from ALL component ribbon
-- applicability rules. Keep definitions and saved values for runtime compatibility.
UPDATE md_builder_ribbon_component_rules
SET enabled=false
WHERE property_key IN ('defaultCheck','columnVisibility');

-- Move remaining component metadata without deleting or renaming properties.
-- Design 2 owns canonical shared keys, component enablement, and current values.
UPDATE md_builder_shared_properties
SET tab='Design2'
WHERE tab='Layout' AND scope='component';

-- Verify Layout is empty before the retired navigation is allowed to ship.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM md_builder_shared_properties
           WHERE tab='Layout' AND scope='component') THEN
   RAISE EXCEPTION 'Layout retirement failed: component metadata remains';
 END IF;
END $$;
-- END ORIGINAL MIGRATION 20271114-page-builder-retire-layout-ribbon.sql

-- BEGIN ORIGINAL MIGRATION 20271115-smart-image-placement-axis-dimensions.sql
-- Image area size is orientation-specific for the shared Smart Image and
-- Smart Card Grid renderers. Only metadata/ribbon rules change; existing
-- tenant-authored values, installed apps and records are never rewritten.
-- The shared imageWidth definition already exists (20270311).
INSERT INTO md_builder_ribbon_component_rules
 (component_api,property_key,enabled)
SELECT 'smart_image',p.property_key,true
FROM md_builder_shared_properties p
JOIN md_builder_ribbon_components c ON c.component_api='smart_image'
WHERE p.property_key='imageWidth'
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Bind both dimensions to the Image dropdown instead of component frame size.
-- Preserve any other component's existing Image slots.
INSERT INTO md_builder_design2_slot_rules
 (component_api,area,slot_key,property_key)
SELECT c.component_api,'Image',v.slot_key,v.property_key
FROM (VALUES ('smart_image'),('smart_card_grid')) AS c(component_api)
JOIN (VALUES ('height','imageHeight'),('width','imageWidth')) AS v(slot_key,property_key)
  ON true
JOIN md_builder_ribbon_components component
  ON component.component_api=c.component_api
JOIN md_builder_shared_properties property
  ON property.property_key=v.property_key
ON CONFLICT(component_api,area,slot_key)
 DO UPDATE SET property_key=EXCLUDED.property_key;

-- Width edits are meaningful only for left/right image placement; height
-- edits only for top/bottom (including the historical default/empty value).
UPDATE md_builder_ribbon_component_rules
SET enabled_when_override='{"property":"imagePlacement","in":["left","right"]}'::jsonb
WHERE component_api IN ('smart_image','smart_card_grid')
  AND property_key='imageWidth';

UPDATE md_builder_ribbon_component_rules
SET enabled_when_override='{"property":"imagePlacement","in":["","top","bottom"]}'::jsonb
WHERE component_api IN ('smart_image','smart_card_grid')
  AND property_key='imageHeight';
-- END ORIGINAL MIGRATION 20271115-smart-image-placement-axis-dimensions.sql

-- BEGIN ORIGINAL MIGRATION 20271116-page-builder-inspector-consolidation.sql
-- Design 2 inspector consolidation. Shared SQL catalog only; do NOT rewrite
-- tenant pages, instances, published layouts, actionFlows or business records.
-- Retain every existing property key and the original 17-cell icon geometry.

-- Presentation order (the dock adds blank-line gaps between logical groups).
WITH wanted(area,sort_order) AS (VALUES
 ('Body',1),('Badge',2),('Image',3),
 ('Header',4),('Header Supporting',5),
 ('Table',6),('Row',7),('Row Supporting',8),
 ('Summary',9),('Summary 2',10),('Footer',11),
 ('Button',12),('Button 2',13),('Button 3',14),
 ('Button 4',15),('Button 5',16)
)
UPDATE md_builder_design2_slots s SET area_order=w.sort_order
FROM wanted w WHERE s.area=w.area AND s.area_order<>w.sort_order;

-- Tabs has one Body, but three DIFFERENT colours: overall container fill,
-- inactive tab fill and selected tab fill. Never alias these saved properties.
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_tabs','Body',v.slot_key,v.property_key
FROM (VALUES
 ('fill','backgroundColor'),('shapeFill','tabColor'),('focused','selectedTabColor'),
 ('width','tabWidth'),('height','tabHeight'),('orientation','tabOrientation')
) v(slot_key,property_key)
JOIN md_builder_shared_properties p ON p.property_key=v.property_key
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- No new component buttons: retain existing keys and action/Flow references.
-- Cart Button/2/3/4/5 -> Custom 1 / Custom 2 / Bin / Plus / Minus.
-- Card Grid Button/2/3 -> Custom 1 / Custom 2 / Native card action.
DELETE FROM md_builder_design2_slot_rules
WHERE component_api IN ('smart_cart','smart_card_grid')
 AND area IN ('Button','Button 2','Button 3','Button 4','Button 5');

WITH buttons(component_api,area,prefix) AS (VALUES
 ('smart_cart','Button','customButton1'),
 ('smart_cart','Button 2','customButton2'),
 ('smart_cart','Button 3','removeButton'),
 ('smart_cart','Button 4','qtyIncrease'),
 ('smart_cart','Button 5','qtyDecrease'),
 ('smart_card_grid','Button','customButton1'),
 ('smart_card_grid','Button 2','customButton2'),
 ('smart_card_grid','Button 3','cardButton')
), suffixes(slot_key,suffix) AS (VALUES
 ('fill','Fill'),('border','BorderColor'),('shape','Shape'),
 ('radius','Radius'),('width','Width'),('height','Height'),
 ('text','TextColor'),('alignment','Alignment'),('size','TextSize'),
 ('bold','Bold'),('wrap','WrapText')
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT b.component_api,b.area,s.slot_key,b.prefix||s.suffix
FROM buttons b CROSS JOIN suffixes s
JOIN md_builder_shared_properties p ON p.property_key=b.prefix||s.suffix
JOIN md_builder_design2_slots slot ON slot.area=b.area AND slot.slot_key=s.slot_key
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- Extra controls formerly under Card Grid / Focused, plus tab default index
-- and calendar display settings, are embedded in Body below its unchanged
-- 17 shared icons. Only registered property definitions can appear.
-- Order_no >=20 avoids the fixed R1-R3 unique(row_no,order_no) cells.
WITH extras(component_api,slot_key,property_key,pos) AS (VALUES
 ('smart_card_grid','extra_cardGap','gap',20),
 ('smart_card_grid','extra_cardPadding','cardPadding',21),
 ('smart_card_grid','extra_selectionMode','selectionMode',22),
 ('smart_card_grid','extra_focusedCardWidth','focusedCardWidth',23),
 ('smart_card_grid','extra_focusedCardHeight','focusedCardHeight',24),
 ('smart_card_grid','extra_focusedCardBorderColor','focusedCardBorderColor',25),
 ('smart_card_grid','extra_focusedCardShadow','focusedCardShadow',26),
 ('smart_card_grid','extra_focusedTextColor','focusedTextColor',27),
 ('smart_card_grid','extra_focusedTextBold','focusedTextBold',28),
 ('smart_card_grid','extra_focusedTextSize','focusedTextSize',29),
 ('smart_tabs','extra_tabIndex','tabIndex',30),
 ('smart_calendar','extra_showDays','showDays',31),
 ('smart_calendar','extra_firstDay','firstDay',32)
)
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT 'Body',1,e.slot_key,1,e.pos,
 CASE WHEN p.control_kind='choice' THEN 94
      WHEN p.control_kind='number' THEN 58
      WHEN p.control_kind='boolean' THEN 28 ELSE 40 END,
 26,p.property_key,p.property_key
FROM extras e JOIN md_builder_shared_properties p ON p.property_key=e.property_key
ON CONFLICT(area,slot_key) DO NOTHING;

WITH extras(component_api,slot_key,property_key) AS (VALUES
 ('smart_card_grid','extra_cardGap','gap'),
 ('smart_card_grid','extra_cardPadding','cardPadding'),
 ('smart_card_grid','extra_selectionMode','selectionMode'),
 ('smart_card_grid','extra_focusedCardWidth','focusedCardWidth'),
 ('smart_card_grid','extra_focusedCardHeight','focusedCardHeight'),
 ('smart_card_grid','extra_focusedCardBorderColor','focusedCardBorderColor'),
 ('smart_card_grid','extra_focusedCardShadow','focusedCardShadow'),
 ('smart_card_grid','extra_focusedTextColor','focusedTextColor'),
 ('smart_card_grid','extra_focusedTextBold','focusedTextBold'),
 ('smart_card_grid','extra_focusedTextSize','focusedTextSize'),
 ('smart_tabs','extra_tabIndex','tabIndex'),
 ('smart_calendar','extra_showDays','showDays'),
 ('smart_calendar','extra_firstDay','firstDay')
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT e.component_api,'Body',e.slot_key,e.property_key
FROM extras e
JOIN md_builder_design2_slots s ON s.area='Body' AND s.slot_key=e.slot_key
JOIN md_builder_ribbon_components c ON c.component_api=e.component_api
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- These renderer-owned properties are already implemented. Restore their
-- applicability if older shared catalogs lack the enablement record.
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT v.component_api,p.property_key,true
FROM (VALUES ('smart_tabs','tabIndex'),('smart_calendar','showDays'),
 ('smart_calendar','firstDay'),('smart_tabs','tabColor'),
 ('smart_tabs','selectedTabColor')) v(component_api,property_key)
JOIN md_builder_shared_properties p ON p.property_key=v.property_key
JOIN md_builder_ribbon_components c ON c.component_api=v.component_api
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Remove only obsolete SHARED presentation slots, never saved values.
DELETE FROM md_builder_design2_slot_rules
WHERE area IN ('Tabs','Card Grid','Focused','Custom Button 1','Custom Button 2','Calendar');
DELETE FROM md_builder_design2_slots
WHERE area IN ('Tabs','Card Grid','Focused','Custom Button 1','Custom Button 2','Calendar');

-- One property -> one primary editing area for each component. Old duplicate
-- aliases in Body/Header/Row/Footer become disabled icons, preserving exact
-- position and the canonical existing value. No schema or page data changes.
WITH duplicates AS (
 SELECT r.component_api,r.area,r.slot_key,
  ROW_NUMBER() OVER(PARTITION BY r.component_api,r.property_key
    ORDER BY CASE WHEN r.property_key LIKE 'header%' AND r.area='Header'
             THEN 0 ELSE s.area_order END,
      s.row_no,s.order_no,r.slot_key) AS occurrence
 FROM md_builder_design2_slot_rules r
 JOIN md_builder_design2_slots s ON s.area=r.area AND s.slot_key=r.slot_key
)
DELETE FROM md_builder_design2_slot_rules r USING duplicates d
WHERE r.component_api=d.component_api AND r.area=d.area
 AND r.slot_key=d.slot_key AND d.occurrence>1;
-- END ORIGINAL MIGRATION 20271116-page-builder-inspector-consolidation.sql

-- BEGIN ORIGINAL MIGRATION 20271117-page-builder-focused-extras-padding.sql
-- Reorganise EXISTING Page Builder Design 2 properties without changing tenant
-- page JSON, published layouts, property values, runtime keys or selection logic.
-- The existing 17 icons remain in their fixed R1-R3 positions. Unsupported
-- property cells are deliberately disabled rather than conditionally removed.

-- Focused sits immediately after Row; Extras follows it.
WITH wanted(area,sort_order) AS (VALUES
 ('Body',1),('Badge',2),('Image',3),('Header',4),('Header Supporting',5),
 ('Table',6),('Row',7),('Focused',8),('Extras',9),('Row Supporting',10),
 ('Summary',11),('Summary 2',12),('Footer',13),
 ('Button',14),('Button 2',15),('Button 3',16),('Button 4',17),('Button 5',18)
)
UPDATE md_builder_design2_slots s SET area_order=w.sort_order
FROM wanted w WHERE s.area=w.area AND s.area_order<>w.sort_order;

-- The new Focused section reuses the SAME icon geometry as Body. No new
-- styling keys are defined and no component gains runtime focused styling.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT 'Focused',8,s.slot_key,s.row_no,s.order_no,s.width_px,s.height_px,
       s.property_key,s.fallback_key
FROM md_builder_design2_slots s
WHERE s.area='Body' AND s.row_no BETWEEN 1 AND 3
 AND s.slot_key NOT LIKE 'extra_%'
ON CONFLICT(area,slot_key) DO UPDATE SET
 area_order=EXCLUDED.area_order,row_no=EXCLUDED.row_no,order_no=EXCLUDED.order_no,
 width_px=EXCLUDED.width_px,height_px=EXCLUDED.height_px,
 property_key=EXCLUDED.property_key,fallback_key=EXCLUDED.fallback_key;

-- Move every EXISTING focused-colour binding out of legacy Body/Table/Row.
-- This includes selected card, selected row and selected tab colours when
-- already supported. Do not invent fill/shape/radius/padding overrides.
WITH focused_existing AS (
 SELECT DISTINCT ON(r.component_api) r.component_api,r.property_key
 FROM md_builder_design2_slot_rules r
 WHERE r.slot_key='focused' AND r.area<>'Focused'
 ORDER BY r.component_api,CASE WHEN r.area='Body' THEN 0 ELSE 1 END,r.area
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT component_api,'Focused','fill',property_key FROM focused_existing
ON CONFLICT(component_api,area,slot_key)
 DO UPDATE SET property_key=EXCLUDED.property_key;

DELETE FROM md_builder_design2_slot_rules
WHERE slot_key='focused' AND area<>'Focused'
 AND EXISTS (
  SELECT 1 FROM md_builder_design2_slot_rules moved
  WHERE moved.component_api=md_builder_design2_slot_rules.component_api
    AND moved.area='Focused' AND moved.slot_key='fill'
    AND moved.property_key=md_builder_design2_slot_rules.property_key
 );

-- Reassign only the SEVEN already implemented Card Grid focused style keys.
-- Their existing values are still read unchanged by SmartRuntime.
WITH existing(slot_key,property_key) AS (VALUES
 ('width','focusedCardWidth'),('height','focusedCardHeight'),
 ('border','focusedCardBorderColor'),('shadow','focusedCardShadow'),
 ('text','focusedTextColor'),('bold','focusedTextBold'),
 ('size','focusedTextSize')
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_card_grid','Focused',e.slot_key,e.property_key
FROM existing e
JOIN md_builder_shared_properties p ON p.property_key=e.property_key
JOIN md_builder_ribbon_component_rules c ON c.component_api='smart_card_grid'
 AND c.property_key=e.property_key AND c.enabled=true
ON CONFLICT(component_api,area,slot_key)
 DO UPDATE SET property_key=EXCLUDED.property_key;

-- Card Gap and Selection Mode move into their own compact Extras section.
-- The two existing SQL slots/rules change AREA only; the property keys,
-- choice list and renderer behaviour do not change.
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT component_api,'Extras',slot_key,property_key
FROM md_builder_design2_slot_rules
WHERE area='Body' AND component_api='smart_card_grid'
 AND slot_key IN ('extra_cardGap','extra_selectionMode')
ON CONFLICT(component_api,area,slot_key)
 DO UPDATE SET property_key=EXCLUDED.property_key;
DELETE FROM md_builder_design2_slot_rules
WHERE area='Body' AND component_api='smart_card_grid'
 AND slot_key IN ('extra_cardGap','extra_selectionMode');

-- A previously migrated Extras slot may already exist when the older
-- consolidation script is replayed. UPSERT instead of updating a primary key.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT 'Extras',9,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key
FROM md_builder_design2_slots
WHERE area='Body' AND slot_key IN ('extra_cardGap','extra_selectionMode')
ON CONFLICT(area,slot_key) DO UPDATE SET
 area_order=EXCLUDED.area_order,row_no=EXCLUDED.row_no,order_no=EXCLUDED.order_no,
 width_px=EXCLUDED.width_px,height_px=EXCLUDED.height_px,
 property_key=EXCLUDED.property_key,fallback_key=EXCLUDED.fallback_key;
DELETE FROM md_builder_design2_slots
WHERE area='Body' AND slot_key IN ('extra_cardGap','extra_selectionMode');

-- Image border now uses Image > Appearance > Border (R1C2), not a second
-- dynamic picker. This colour still applies to the image, NOT its parent card.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT 'Image',3,'border',s.row_no,s.order_no,s.width_px,s.height_px,
       'imageBorderColor',s.fallback_key
FROM md_builder_design2_slots s
WHERE s.area='Body' AND s.slot_key='border'
ON CONFLICT(area,slot_key) DO UPDATE SET
 area_order=EXCLUDED.area_order,row_no=EXCLUDED.row_no,order_no=EXCLUDED.order_no,
 width_px=EXCLUDED.width_px,height_px=EXCLUDED.height_px,
 property_key=EXCLUDED.property_key;

INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_card_grid','Image','border',p.property_key
FROM md_builder_shared_properties p
JOIN md_builder_ribbon_component_rules c ON c.component_api='smart_card_grid'
 AND c.property_key=p.property_key AND c.enabled=true
WHERE p.property_key='imageBorderColor'
ON CONFLICT(component_api,area,slot_key)
 DO UPDATE SET property_key=EXCLUDED.property_key;

-- The shared numeric Position/Padding control edits existing cardPadding;
-- the Appearance selector edits existing tabIndex/showDays/firstDay. Remove
-- their old duplicate extra slots, and the seven moved focused editors.
DELETE FROM md_builder_design2_slot_rules
WHERE area='Body' AND slot_key IN (
 'extra_cardPadding','extra_tabIndex','extra_showDays','extra_firstDay',
 'extra_focusedCardWidth','extra_focusedCardHeight',
 'extra_focusedCardBorderColor','extra_focusedCardShadow',
 'extra_focusedTextColor','extra_focusedTextBold','extra_focusedTextSize'
);
DELETE FROM md_builder_design2_slots
WHERE area='Body' AND slot_key IN (
 'extra_cardPadding','extra_tabIndex','extra_showDays','extra_firstDay',
 'extra_focusedCardWidth','extra_focusedCardHeight',
 'extra_focusedCardBorderColor','extra_focusedCardShadow',
 'extra_focusedTextColor','extra_focusedTextBold','extra_focusedTextSize'
);
-- END ORIGINAL MIGRATION 20271117-page-builder-focused-extras-padding.sql

-- BEGIN ORIGINAL MIGRATION 20271118-smart-numpad.sql
-- Smart Numpad uses the shared SQL ribbon, shared Formula/Flow actions and
-- existing fixed Design areas. No tenant pages, records or authored values are rewritten.
INSERT INTO md_builder_ribbon_components(component_api)
VALUES ('smart_numpad') ON CONFLICT(component_api) DO NOTHING;

-- New keys only where a keypad, input or third button genuinely needs independent
-- settings. Existing Body, Header, Object Source, Text Source and buttons 1/2
-- reuse their established global definitions.
WITH specs(property_key,label,section_group,control_kind,default_json,choices,min_value,max_value) AS (
 VALUES
 ('numpadPadding','Padding','Body','number','10'::jsonb,'[]'::jsonb,0,80),
 ('numpadGap','Key gap','Body','number','8'::jsonb,'[]'::jsonb,0,48),
 ('numpadHeaderRadius','Input radius','Header','number','8'::jsonb,'[]'::jsonb,0,128),
 ('numpadHeaderShadow','Input shadow','Header','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadHeaderWidth','Input width (%)','Header','number','100'::jsonb,'[]'::jsonb,50,100),
 ('numpadInputMode','Input type','Header','choice','"integer"'::jsonb,'["integer","decimal","pin"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadDecimalPlaces','Decimal places','Header','number','2'::jsonb,'[]'::jsonb,0,12),
 ('numpadMaxDigits','Maximum digits','Header','number','12'::jsonb,'[]'::jsonb,1,64),
 ('numpadMask','Mask value','Header','boolean','false'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadPlaceholder','Placeholder','Header','expression','"Enter number"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadPrefix','Input prefix','Header','expression','""'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadSuffix','Input suffix','Header','expression','""'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyFill','Key background','Button','color','"#f1f5f9"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyBorderColor','Key border','Button','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyRadius','Key radius','Button','number','9'::jsonb,'[]'::jsonb,0,128),
 ('numpadKeyShadow','Key shadow','Button','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyWidth','Key width (px)','Button','number','100'::jsonb,'[]'::jsonb,20,400),
 ('numpadKeyHeight','Key height','Button','number','52'::jsonb,'[]'::jsonb,28,200),
 ('numpadKeyTextColor','Key text','Button','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyTextSize','Key text size','Button','number','20'::jsonb,'[]'::jsonb,10,96),
 ('numpadKeyBold','Key bold','Button','boolean','false'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyAlignment','Key alignment','Button','align','"center"'::jsonb,'["left","center","right"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadKeyShape','Key shape','Button','choice','"shape:rectangle"'::jsonb,'["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadFocusedFill','Focused background','Focused','color','"#dbeafe"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadFocusedBorderColor','Focused border','Focused','color','"#2563eb"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadFocusedTextColor','Focused text','Focused','color','"#1d4ed8"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('numpadFocusedRadius','Focused radius','Focused','number','9'::jsonb,'[]'::jsonb,0,128),
 ('numpadFocusedShadow','Focused shadow','Focused','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer),
 ('numpadFocusedTextSize','Focused text size','Focused','number','20'::jsonb,'[]'::jsonb,10,96),
 ('numpadFocusedBold','Focused bold','Focused','boolean','false'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Label','Custom Button 3 label','Values','expression','"Submit"'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Fill','Custom 3 background','Button 4','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3BorderColor','Custom 3 border','Button 4','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Radius','Custom 3 radius','Button 4','number','9'::jsonb,'[]'::jsonb,0,128),
 ('customButton3Width','Custom 3 width (px)','Button 4','number','100'::jsonb,'[]'::jsonb,20,400),
 ('customButton3Height','Custom 3 height','Button 4','number','52'::jsonb,'[]'::jsonb,28,200),
 ('customButton3TextColor','Custom 3 text','Button 4','color',NULL::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3TextSize','Custom 3 text size','Button 4','number','16'::jsonb,'[]'::jsonb,10,96),
 ('customButton3Alignment','Custom 3 alignment','Button 4','align','"center"'::jsonb,'["left","center","right"]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Bold','Custom 3 bold','Button 4','boolean','false'::jsonb,'[]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Shape','Custom 3 shape','Button 4','choice','"shape:rectangle"'::jsonb,'["shape:rectangle","shape:round-rectangle","shape:oval"]'::jsonb,NULL::integer,NULL::integer),
 ('customButton3Shadow','Custom 3 shadow','Button 4','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer),
 ('customButton1Shadow','Custom 1 shadow','Button 2','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer),
 ('customButton2Shadow','Custom 2 shadow','Button 3','shadow','"none"'::jsonb,'["none","medium","large"]'::jsonb,NULL::integer,NULL::integer)
), existing AS (SELECT COALESCE(MAX(sort_order),0) AS n FROM md_builder_shared_properties)
INSERT INTO md_builder_shared_properties
 (property_key,label,tab,section_group,control_kind,sort_order,default_value,
  choices,scope,min_value,max_value,field_select,design_row,design_order,
  design_width,design_height,design_caption_width,design_display)
SELECT s.property_key,s.label,
 CASE WHEN s.property_key='customButton3Label' THEN 'Data' ELSE 'Design2' END,
 s.section_group,s.control_kind,e.n+ROW_NUMBER() OVER(ORDER BY s.property_key),
 s.default_json,s.choices,'component',s.min_value,s.max_value,
 s.control_kind='expression',2,1,
 CASE WHEN s.control_kind='number' THEN 58 WHEN s.control_kind='choice' THEN 110
      WHEN s.control_kind='expression' THEN 150 WHEN s.control_kind='boolean' THEN 28 ELSE 40 END,
 26,0,CASE WHEN s.control_kind IN ('align','shadow') THEN 'dropdown' ELSE 'buttons' END
FROM specs s CROSS JOIN existing e
ON CONFLICT(property_key) DO NOTHING;

-- Existing global keys are referenced, never redefined or altered.
WITH keys(property_key) AS (VALUES
 ('backgroundColor'),('borderColor'),('radius'),('shadow'),('width'),('height'),('x'),('y'),
 ('textSource'),('objectApiName'),('objectApiName2'),
 ('headerBodyColor'),('headerBorderColor'),('headerTextColor'),('headerTextSize'),
 ('headerBoxHeight'),('headerAlignment'),('headerBold'),
 ('customButton1Label'),('customButton2Label'),
 ('customButton1Fill'),('customButton1BorderColor'),('customButton1Radius'),
 ('customButton1Width'),('customButton1Height'),('customButton1Shape'),
 ('customButton1TextColor'),('customButton1TextSize'),('customButton1Bold'),
 ('customButton1Alignment'),
 ('customButton2Fill'),('customButton2BorderColor'),('customButton2Radius'),
 ('customButton2Width'),('customButton2Height'),('customButton2Shape'),
 ('customButton2TextColor'),('customButton2TextSize'),('customButton2Bold'),
 ('customButton2Alignment')
), numpad_keys AS (
 SELECT property_key FROM keys
 UNION SELECT property_key FROM md_builder_shared_properties
 WHERE property_key LIKE 'numpad%' OR property_key LIKE 'customButton3%'
 OR property_key IN ('customButton1Shadow','customButton2Shadow')
)
INSERT INTO md_builder_ribbon_component_rules(component_api,property_key,enabled)
SELECT 'smart_numpad',k.property_key,true FROM numpad_keys k
JOIN md_builder_shared_properties p ON p.property_key=k.property_key
ON CONFLICT(component_api,property_key) DO UPDATE SET enabled=true;

-- Button 2–4 historically exposed only selected slots. Fill in missing
-- positions using the exact Body scaffold, preserving all existing controls.
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT areas.area,areas.area_order,base.slot_key,base.row_no,base.order_no,
 base.width_px,base.height_px,base.property_key,base.fallback_key
FROM (SELECT area,MIN(area_order) AS area_order FROM md_builder_design2_slots
      WHERE area IN ('Button 2','Button 3','Button 4') GROUP BY area) areas
CROSS JOIN md_builder_design2_slots base
WHERE base.area='Body' AND base.slot_key IN
 ('fill','border','shape','radius','shadow','height','width',
  'text','alignment','size','bold')
ON CONFLICT DO NOTHING;

-- Fixed Design cell mappings. Button means the twelve standard keys.
-- Button 2/3/4 mean the three independent custom buttons.
WITH design(area,slot_key,property_key) AS (VALUES
 ('Body','fill','backgroundColor'),('Body','border','borderColor'),
 ('Body','radius','radius'),('Body','shadow','shadow'),
 ('Body','width','width'),('Body','height','height'),
 ('Header','fill','headerBodyColor'),('Header','border','headerBorderColor'),
 ('Header','radius','numpadHeaderRadius'),('Header','shadow','numpadHeaderShadow'),
 ('Header','width','numpadHeaderWidth'),('Header','height','headerBoxHeight'),
 ('Header','text','headerTextColor'),('Header','alignment','headerAlignment'),
 ('Header','size','headerTextSize'),('Header','bold','headerBold'),
 ('Focused','fill','numpadFocusedFill'),('Focused','border','numpadFocusedBorderColor'),
 ('Focused','radius','numpadFocusedRadius'),('Focused','shadow','numpadFocusedShadow'),
 ('Focused','text','numpadFocusedTextColor'),('Focused','size','numpadFocusedTextSize'),
 ('Focused','bold','numpadFocusedBold'),
 ('Button','fill','numpadKeyFill'),('Button','border','numpadKeyBorderColor'),
 ('Button','radius','numpadKeyRadius'),('Button','shadow','numpadKeyShadow'),
 ('Button','width','numpadKeyWidth'),('Button','height','numpadKeyHeight'),
 ('Button','text','numpadKeyTextColor'),('Button','size','numpadKeyTextSize'),
 ('Button','bold','numpadKeyBold'),('Button','alignment','numpadKeyAlignment'),
 ('Button','shape','numpadKeyShape'),
 ('Button 2','fill','customButton1Fill'),('Button 2','border','customButton1BorderColor'),
 ('Button 2','radius','customButton1Radius'),('Button 2','shadow','customButton1Shadow'),
 ('Button 2','width','customButton1Width'),('Button 2','height','customButton1Height'),
 ('Button 2','text','customButton1TextColor'),('Button 2','size','customButton1TextSize'),
 ('Button 2','bold','customButton1Bold'),('Button 2','alignment','customButton1Alignment'),
 ('Button 2','shape','customButton1Shape'),
 ('Button 3','fill','customButton2Fill'),('Button 3','border','customButton2BorderColor'),
 ('Button 3','radius','customButton2Radius'),('Button 3','shadow','customButton2Shadow'),
 ('Button 3','width','customButton2Width'),('Button 3','height','customButton2Height'),
 ('Button 3','text','customButton2TextColor'),('Button 3','size','customButton2TextSize'),
 ('Button 3','bold','customButton2Bold'),('Button 3','alignment','customButton2Alignment'),
 ('Button 3','shape','customButton2Shape'),
 ('Button 4','fill','customButton3Fill'),('Button 4','border','customButton3BorderColor'),
 ('Button 4','radius','customButton3Radius'),('Button 4','shadow','customButton3Shadow'),
 ('Button 4','width','customButton3Width'),('Button 4','height','customButton3Height'),
 ('Button 4','text','customButton3TextColor'),('Button 4','size','customButton3TextSize'),
 ('Button 4','bold','customButton3Bold'),('Button 4','alignment','customButton3Alignment'),
 ('Button 4','shape','customButton3Shape')
)
INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_numpad',d.area,d.slot_key,d.property_key FROM design d
JOIN md_builder_design2_slots s ON s.area=d.area AND s.slot_key=d.slot_key
JOIN md_builder_shared_properties p ON p.property_key=d.property_key
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- SQL-owned supplemental controls appear inside their section, not in another
-- properties tab. No new design engine, no hardcoded per-key renderer control.
WITH settings(area,property_key,ordinal) AS (VALUES
 ('Body','numpadPadding',1),('Body','numpadGap',2),
 ('Header','numpadInputMode',1),('Header','numpadDecimalPlaces',2),
 ('Header','numpadMaxDigits',3),('Header','numpadMask',4),
 ('Header','numpadPlaceholder',5),('Header','numpadPrefix',6),
 ('Header','numpadSuffix',7)
)
INSERT INTO md_builder_design2_slots
 (area,area_order,slot_key,row_no,order_no,width_px,height_px,property_key,fallback_key)
SELECT a.area,MIN(s.area_order),'extra_'||a.property_key,1,30+a.ordinal,
 CASE WHEN p.control_kind='choice' THEN 110
      WHEN p.control_kind='expression' THEN 150
      WHEN p.control_kind='number' THEN 58 ELSE 40 END,
 26,a.property_key,a.property_key
FROM settings a
JOIN md_builder_design2_slots s ON s.area=a.area
JOIN md_builder_shared_properties p ON p.property_key=a.property_key
GROUP BY a.area,a.property_key,a.ordinal,p.control_kind
ON CONFLICT(area,slot_key) DO NOTHING;

INSERT INTO md_builder_design2_slot_rules(component_api,area,slot_key,property_key)
SELECT 'smart_numpad',s.area,s.slot_key,s.property_key
FROM md_builder_design2_slots s
WHERE s.slot_key LIKE 'extra_numpad%'
ON CONFLICT(component_api,area,slot_key) DO UPDATE SET property_key=EXCLUDED.property_key;

-- Upgrade existing tenants, while fresh tenant metadata comes from the
-- independently versioned Smart component seeder.
INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled)
SELECT id,'smart_numpad','one-bundled:smart_numpad',true FROM md_tenants
ON CONFLICT(tenant_id,api_name) DO NOTHING;
-- END ORIGINAL MIGRATION 20271118-smart-numpad.sql

-- BEGIN ORIGINAL MIGRATION 20271119-smart-formula-display-runtime.sql
-- Formula-bound Smart Text renders by its runtime content source, not by a
-- user-configurable Design 2/Text Mode property. Existing instance properties
-- are preserved for legacy display pages; no tenant data is rewritten.
-- Forward-only and repeatable: remove the obsolete property from the shared
-- metadata catalog, the ribbon applicability matrix, and Design 2 slots.
DELETE FROM md_builder_design2_slot_rules
WHERE property_key='displayMode';

DELETE FROM md_builder_design2_slots
WHERE area='Body' AND slot_key='textMode' AND property_key='displayMode';

DELETE FROM md_builder_ribbon_component_rules
WHERE property_key='displayMode';

DELETE FROM md_builder_shared_properties
WHERE property_key='displayMode';
-- END ORIGINAL MIGRATION 20271119-smart-formula-display-runtime.sql

-- BEGIN ORIGINAL MIGRATION 20271201-print-template-page-type.sql
-- In-screen page definitions share the existing SQL Page engine.
ALTER TABLE md_lightning_page_details DROP CONSTRAINT IF EXISTS md_lightning_page_details_page_type_check;
ALTER TABLE md_lightning_page_details ADD CONSTRAINT md_lightning_page_details_page_type_check
 CHECK(page_type IN ('Record Page','App Page','Home Page','In-Screen Page','Print Template'));
-- END ORIGINAL MIGRATION 20271201-print-template-page-type.sql


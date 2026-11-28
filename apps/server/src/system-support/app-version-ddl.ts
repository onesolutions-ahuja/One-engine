/** App versions (see app-version-service.ts). Upgrade-safe DDL (idempotent): run from
 * system-migrations.ts; the same SQL is in schema.sql. Plain rows, no JSON columns. */
export const APP_VERSION_DDL=`
CREATE TABLE IF NOT EXISTS md_app_versions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_api text NOT NULL, version integer NOT NULL,
 published boolean NOT NULL DEFAULT false,
 error_count integer NOT NULL DEFAULT 0,
 error_text text NOT NULL DEFAULT '',
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 modified_by uuid, modified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,app_api,version));
CREATE TABLE IF NOT EXISTS md_app_version_pages(
 tenant_id uuid NOT NULL, app_api text NOT NULL, version integer NOT NULL,
 page_api text NOT NULL, layout_variant text NOT NULL, page_version integer NOT NULL,
 PRIMARY KEY(tenant_id,app_api,version,page_api,layout_variant),
 FOREIGN KEY(tenant_id,app_api,version) REFERENCES md_app_versions(tenant_id,app_api,version) ON DELETE CASCADE);
`;

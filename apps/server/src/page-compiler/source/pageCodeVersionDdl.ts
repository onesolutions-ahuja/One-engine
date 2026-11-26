/** Upgrade-safe DDL (idempotent): the last 10 generated code versions of each published page layout.
 * Files are plain text rows (no JSON columns). Run from system-migrations.ts; same SQL goes in schema.sql. */
export const PAGE_CODE_VERSION_DDL=`
CREATE TABLE IF NOT EXISTS md_page_code_versions(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 page_api text NOT NULL, layout_variant text NOT NULL, version integer NOT NULL,
 page_revision integer, app_api text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 issue_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,page_api,layout_variant,version));
CREATE TABLE IF NOT EXISTS md_page_code_version_files(
 tenant_id uuid NOT NULL, page_api text NOT NULL, layout_variant text NOT NULL, version integer NOT NULL,
 path text NOT NULL, content text NOT NULL,
 PRIMARY KEY(tenant_id,page_api,layout_variant,version,path),
 FOREIGN KEY(tenant_id,page_api,layout_variant,version)
  REFERENCES md_page_code_versions(tenant_id,page_api,layout_variant,version) ON DELETE CASCADE);
`;

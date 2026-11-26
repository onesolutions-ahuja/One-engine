/**
 * Upgrade-safe DDL (idempotent): the per-tenant "run app from published code" switch and
 * the one-file app packages built from it. Run from system-migrations.ts; the same SQL goes
 * in schema.sql. The switch is per TENANT + app (never global): a tenant publishes its own
 * design and turns it on for its own devices only.
 */
export const APP_PACKAGE_DDL=`
ALTER TABLE md_tenant_app_metadata ADD COLUMN IF NOT EXISTS run_published_code boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS md_app_packages(
 tenant_id uuid NOT NULL REFERENCES md_tenants(id),
 app_api text NOT NULL, layout_variant text NOT NULL, hash text NOT NULL,
 code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,app_api,layout_variant,hash));
CREATE INDEX IF NOT EXISTS md_app_packages_recent
 ON md_app_packages(tenant_id,app_api,layout_variant,created_at DESC);
`;

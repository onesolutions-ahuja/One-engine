import type {PoolClient} from 'pg';
import {SMART_COMPONENTS} from './smart-components.js';

/** Retired built-ins no longer have runtime assets. Deactivate only the
 * exact system-owned renderer registration; never delete the definition,
 * tenant-authored library versions, page references or any business data.
 * Tenant components with their own renderer keys remain untouched. */
export async function deactivateUnavailableBundledComponents(
  client: Pick<PoolClient,'query'>, tenantId: string
): Promise<void> {
  const reviewed: string[] = [...SMART_COMPONENTS];
  await client.query(`
    UPDATE md_component_definitions AS d SET enabled=false
    WHERE d.tenant_id=$1 AND d.enabled=true
      AND d.renderer_key='smart-bundled:'||d.api_name
      AND NOT (d.api_name=ANY($2::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM md_component_library_heads AS h
        WHERE h.tenant_id=d.tenant_id AND h.component_api=d.api_name
      )
      -- App-owned bundled components remain installed only with their app, not
      -- through Core's Smart allowlist. Never deactivate an installed app renderer.
      AND NOT EXISTS (
        SELECT 1 FROM md_app_package_component_templates t
        JOIN md_app_installations i ON i.app_id=t.app_id AND i.tenant_id=d.tenant_id
        WHERE t.api_name=d.api_name AND t.renderer_key=d.renderer_key
      )
      -- Preserve already-published page instances even before a package upgrade
      -- is published; they must not be invalidated by generic Core maintenance.
      AND NOT EXISTS (
        SELECT 1 FROM md_page_components p
        WHERE p.tenant_id=d.tenant_id AND p.component_api=d.api_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM md_lightning_page_nodes n
        WHERE n.tenant_id=d.tenant_id AND n.component_type='Custom:'||d.api_name
      )`,[tenantId,reviewed]);
}

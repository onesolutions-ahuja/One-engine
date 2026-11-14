import type {PoolClient} from 'pg';
/** Independent, upgrade-safe Smart component registrations; no app data is altered. */
export const SMART_COMPONENTS=["smart_numpad","smart_button","smart_toggle","smart_lookup","smart_selector","smart_tabs","smart_text","smart_textbox","smart_label","smart_card_grid","smart_image","smart_calendar","smart_navigation","smart_container","smart_cart","smart_icon","smart_table","smart_keyboard","smart_dock","smart_chart"] as const;
export async function seedFreshSmartComponents(client:Pick<PoolClient,'query'>,tenantId:string){
 for(const api of SMART_COMPONENTS)await client.query(
  'INSERT INTO md_component_definitions(tenant_id,api_name,renderer_key,enabled) VALUES($1,$2,$3,true) ON CONFLICT(tenant_id,api_name) DO NOTHING',
  [tenantId,api,'smart-bundled:'+api]);
}

/** Upgrade existing Smart registrations without changing tenant-owned renderers.
 * Called once on server startup after the authoritative SQL schema is ready. */
export async function migrateSmartRendererKeys(db:Pick<PoolClient,'query'>){
 const {rowCount}=await db.query(`
  UPDATE md_component_definitions SET renderer_key='smart-bundled:'||api_name
  WHERE api_name=ANY($1::text[]) AND renderer_key='one-bundled:'||api_name
 `,[[...SMART_COMPONENTS]]);
 return rowCount??0;
}

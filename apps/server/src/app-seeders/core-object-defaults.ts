import type {SqlPersistence} from '../system-files/sql-persistence.js';

/**
 * Reconcile defaults AFTER Core object seeding, including restored tenants.
 * Existing layouts, record types and customer configuration are never overwritten.
 */
export async function reconcileCoreObjectDefaults(db:SqlPersistence):Promise<void> {
 await db.transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['metadrive:system:migrations']);
  await client.query(`
   INSERT INTO md_object_page_layouts(tenant_id,object_api,layout_id,label,sort_order)
   SELECT o.tenant_id,o.api_name,'default',o.label||' Layout',0
   FROM md_object_definitions o
   WHERE NOT EXISTS (SELECT 1 FROM md_object_page_layouts l
     WHERE l.tenant_id=o.tenant_id AND l.object_api=o.api_name)
   ON CONFLICT DO NOTHING`);
  await client.query(`
   INSERT INTO md_object_page_layout_sections(tenant_id,object_api,layout_id,section_id,label,columns,sort_order)
   SELECT l.tenant_id,l.object_api,l.layout_id,'details','Record Information',2,0
   FROM md_object_page_layouts l WHERE l.layout_id='default'
   AND NOT EXISTS (SELECT 1 FROM md_object_page_layout_sections s
     WHERE s.tenant_id=l.tenant_id AND s.object_api=l.object_api AND s.layout_id=l.layout_id)
   ON CONFLICT DO NOTHING`);
  await client.query(`
   INSERT INTO md_object_page_layout_fields(tenant_id,object_api,layout_id,section_id,field_api,sort_order)
   SELECT s.tenant_id,s.object_api,s.layout_id,s.section_id,f.api_name,
     (row_number() OVER (PARTITION BY s.tenant_id,s.object_api,s.layout_id,s.section_id ORDER BY f.api_name)-1)::integer
   FROM md_object_page_layout_sections s
   JOIN md_field_definitions f ON f.tenant_id=s.tenant_id AND f.object_api=s.object_api
   WHERE s.layout_id='default' AND s.section_id='details'
   AND NOT EXISTS (SELECT 1 FROM md_object_page_layout_fields pf
     WHERE pf.tenant_id=s.tenant_id AND pf.object_api=s.object_api AND pf.layout_id=s.layout_id)
   ON CONFLICT DO NOTHING`);
  await client.query(`
   INSERT INTO md_object_page_layout_actions(tenant_id,object_api,layout_id,action_name,sort_order)
   SELECT l.tenant_id,l.object_api,l.layout_id,a.action_name,a.sort_order
   FROM md_object_page_layouts l
   CROSS JOIN (VALUES ('New',0),('Edit',1),('Delete',2)) AS a(action_name,sort_order)
   WHERE l.layout_id='default'
   AND NOT EXISTS (SELECT 1 FROM md_object_page_layout_actions x
     WHERE x.tenant_id=l.tenant_id AND x.object_api=l.object_api AND x.layout_id=l.layout_id)
   ON CONFLICT DO NOTHING`);
  await client.query(`
   INSERT INTO md_object_record_types(tenant_id,object_api,record_type_id,developer_name,label,active,is_default,sort_order)
   SELECT o.tenant_id,o.api_name,'master','Master','Master',true,true,0
   FROM md_object_definitions o
   WHERE NOT EXISTS (SELECT 1 FROM md_object_record_types r
     WHERE r.tenant_id=o.tenant_id AND r.object_api=o.api_name)
   ON CONFLICT DO NOTHING`);
 });
}

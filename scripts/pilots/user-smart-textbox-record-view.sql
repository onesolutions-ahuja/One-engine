-- Manual, opt-in pilot for ONE tenant's ONE untouched User Record View page.
-- Run only after explicitly selecting the pilot tenant:
--   BEGIN; SET LOCAL metadrive.pilot_tenant_id = '<verified-tenant-uuid>';
--   \i scripts/pilots/user-smart-textbox-record-view.sql
--   COMMIT;
-- Not part of automatic migrations. Do not silently publish to all tenants.
-- Existing authored layouts, drafts, assignments and User Edit pages are protected.
DO $trial$
DECLARE p record; f record; variant text; next_version integer; n integer;
        w integer; h integer; key text;
BEGIN
 IF NULLIF(current_setting('metadrive.pilot_tenant_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'Set metadrive.pilot_tenant_id to the verified pilot tenant before executing';
 END IF;
 FOR p IN
  SELECT d.tenant_id,d.page_id,pd.title
  FROM md_lightning_page_details d
  JOIN md_page_definitions pd ON pd.tenant_id=d.tenant_id AND pd.id=d.page_id
  JOIN md_object_definitions o ON o.tenant_id=d.tenant_id AND o.api_name='User'
  WHERE d.target_object='User' AND d.page_type='Record Page' AND d.record_mode='View'
    AND d.tenant_id::text=current_setting('metadrive.pilot_tenant_id',true)
    AND d.status='Active' AND pd.enabled=true
    AND pd.api_name='Record_'||substr(md5(d.tenant_id::text||':User'),1,20)||'_View'
    AND NOT EXISTS (SELECT 1 FROM md_app_seed_pages owned
      WHERE owned.tenant_id=d.tenant_id AND owned.page_id=d.page_id)
    AND NOT EXISTS (SELECT 1 FROM md_page_layout_audit audited
      WHERE audited.tenant_id=d.tenant_id AND audited.page_id=d.page_id)
    AND NOT EXISTS (SELECT 1 FROM md_lightning_page_node_properties authored
      WHERE authored.tenant_id=d.tenant_id AND authored.page_id=d.page_id)
    AND NOT EXISTS (SELECT 1 FROM md_lightning_page_nodes authored
      WHERE authored.tenant_id=d.tenant_id AND authored.page_id=d.page_id
        AND (authored.component_key<>'record-detail' OR authored.component_type<>'Record Detail'))
    AND NOT EXISTS (SELECT 1 FROM md_page_layout_heads h
      WHERE h.tenant_id=d.tenant_id AND h.page_id=d.page_id
        AND (COALESCE(h.draft_version,0)>2 OR COALESCE(h.published_version,0)>2))
    AND NOT EXISTS (SELECT 1 FROM md_page_layout_version_nodes authored
      WHERE authored.tenant_id=d.tenant_id AND authored.page_id=d.page_id
        AND authored.component_type NOT IN ('Record Detail','Field Section','Related List'))
  ORDER BY d.page_id LIMIT 1
 LOOP
  IF NOT EXISTS(SELECT 1 FROM md_field_definitions f
    WHERE f.tenant_id=p.tenant_id AND f.object_api='User' AND f.deleted_at IS NULL)
  THEN CONTINUE; END IF;
  FOR variant IN SELECT name FROM
    (VALUES ('Desktop'),('Tablet'),('Mobile'),('Custom')) v(name)
  LOOP
   SELECT COALESCE(MAX(v.version),0)+1 INTO next_version
   FROM md_page_layout_versions v WHERE v.tenant_id=p.tenant_id
     AND v.page_id=p.page_id AND v.variant=variant;
   w=CASE variant WHEN 'Mobile' THEN 390 WHEN 'Tablet' THEN 1024 ELSE 1440 END;
   h=CASE variant WHEN 'Mobile' THEN 844 WHEN 'Tablet' THEN 768 ELSE 900 END;
   INSERT INTO md_page_layout_versions
    (tenant_id,page_id,variant,version,page_label,layout_mode,template,canvas_width,canvas_height,canvas_fill_color)
   VALUES(p.tenant_id,p.page_id,variant,next_version,p.title,'template','one-region',w,h,'#ffffff');
   n=0;
   FOR f IN
    SELECT api_name,label FROM md_field_definitions
    WHERE tenant_id=p.tenant_id AND object_api='User' AND deleted_at IS NULL
      AND api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'
    ORDER BY CASE api_name WHEN 'Email' THEN 0 WHEN 'Enabled' THEN 1 ELSE 2 END,api_name
    LIMIT 40
   LOOP
    key='user-smart-'||substr(md5(f.api_name),1,16);
    INSERT INTO md_page_layout_version_nodes
      (tenant_id,page_id,variant,version,component_key,component_type,label,region,visible,sort_order)
    VALUES(p.tenant_id,p.page_id,variant,next_version,key,'Custom:smart_textbox',
     f.label,'main',true,n);
    INSERT INTO md_page_layout_version_properties
      (tenant_id,page_id,variant,version,component_key,property_path,value_kind,value_text)
    VALUES
      (p.tenant_id,p.page_id,variant,next_version,key,'/props','object',NULL),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/label','string',f.label),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/textSource','string','@'||f.api_name),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/readonly','boolean','true'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/backgroundColor','string','#F3F6FA'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/labelColor','string','#334155'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/headerBodyColor','string','#FFFFFF'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/headerTextColor','string','#0F172A'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/borderColor','string','#DAE2ED'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/textSize','number','14'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/radius','number','5'),
      (p.tenant_id,p.page_id,variant,next_version,key,'/props/wrapText','boolean','true');
    n=n+1;
   END LOOP;
   INSERT INTO md_page_layout_version_activation
    (tenant_id,page_id,variant,version,assignment_id,scope,app_api,profile_id,record_type_id,desktop,phone,tablet,custom,sort_order)
   SELECT a.tenant_id,a.page_id,variant,next_version,a.assignment_id,a.scope,a.app_api,
     a.profile_id,a.record_type_id,a.desktop,a.phone,a.tablet,a.custom,a.sort_order
   FROM md_lightning_page_activation a WHERE a.tenant_id=p.tenant_id AND a.page_id=p.page_id;
   INSERT INTO md_page_layout_heads(tenant_id,page_id,variant,draft_version,published_version)
   VALUES(p.tenant_id,p.page_id,variant,next_version,next_version)
   ON CONFLICT(tenant_id,page_id,variant) DO UPDATE SET
      draft_version=excluded.draft_version,published_version=excluded.published_version,
      updated_at=now();
  END LOOP;
  UPDATE md_lightning_page_details SET
    devices=ARRAY['Desktop','Phone','Tablet','Custom'],updated_at=now(),revision=revision+1
  WHERE tenant_id=p.tenant_id AND page_id=p.page_id;
 END LOOP;
END $trial$;

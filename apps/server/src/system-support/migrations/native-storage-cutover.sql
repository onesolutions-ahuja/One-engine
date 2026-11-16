-- Task H cutover: run only after every live Object has a native table.
-- SQL references to the retired table live in migration history, not runtime code.

-- Record policies and portal account matching must continue reading authoritative values.
CREATE OR REPLACE FUNCTION md_record_field(t uuid,r uuid,f text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE rec record; tab text; col text; expression text; result text;
BEGIN
 SELECT object_api,id,owner_id,owner_queue_id,record_type_id INTO rec
 FROM md_records WHERE tenant_id=t AND id=r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF f='Id' THEN RETURN rec.id::text; END IF;
 IF f='OwnerId' THEN RETURN COALESCE(rec.owner_id,rec.owner_queue_id)::text; END IF;
 IF f='RecordTypeId' THEN RETURN rec.record_type_id; END IF;
 SELECT n.table_name,m.column_name INTO tab,col FROM md_native_objects n
 JOIN md_native_fields m ON m.tenant_id=n.tenant_id AND m.object_api=n.object_api
 WHERE n.tenant_id=t AND n.object_api=rec.object_api AND m.field_api=f;
 IF tab IS NULL THEN RETURN NULL; END IF;
 IF tab !~ '^md_object_[a-f0-9]{32}$'
   OR (col IS NOT NULL AND col !~ '^f_[a-f0-9]{32}$') THEN
  RAISE EXCEPTION 'Invalid native field mapping';
 END IF;
 expression:=CASE WHEN col IS NULL THEN 'extras->>$3'
   ELSE format('%I::text',col) END;
 EXECUTE format('SELECT CASE WHEN $3=ANY(present_fields) THEN %s ELSE NULL END
   FROM %I WHERE tenant_id=$1 AND id=$2',expression,tab)
   INTO result USING t,r,f;
 RETURN result;
END $$;

-- Search-layout weight changes rebuild from native fields, not the retired table.
CREATE OR REPLACE FUNCTION md_search_layout_fields_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tab text; col text; expr text; item record;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM md_record_search_values
   WHERE tenant_id=OLD.tenant_id AND object_api=OLD.object_api AND field_api=OLD.field_api;
  RETURN OLD;
 END IF;
 SELECT n.table_name,f.column_name INTO tab,col
 FROM md_native_objects n JOIN md_native_fields f ON f.tenant_id=n.tenant_id
   AND f.object_api=n.object_api
 WHERE n.tenant_id=NEW.tenant_id AND n.object_api=NEW.object_api
   AND f.field_api=NEW.field_api;
 IF tab IS NULL THEN RETURN NEW; END IF;
 expr:=CASE WHEN col IS NULL THEN 'nr.extras->>$2'
   ELSE format('nr.%I::text',col) END;
 FOR item IN EXECUTE format(
   'SELECT nr.id,%s AS value FROM %I nr WHERE nr.tenant_id=$1
     AND NOT nr.is_deleted AND $2=ANY(nr.present_fields)',expr,tab)
   USING NEW.tenant_id,NEW.field_api
 LOOP
  PERFORM md_refresh_record_search_value(
   NEW.tenant_id,item.id,NEW.object_api,NEW.field_api,item.value);
 END LOOP;
 RETURN NEW;
END $$;

-- Exact-index enable/rebuild remains functional after dropping the old table.
CREATE OR REPLACE FUNCTION md_rebuild_field_exact_index_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tab text; col text; expr text;
BEGIN
 DELETE FROM md_field_exact_index_entries
  WHERE tenant_id=NEW.tenant_id AND object_api=NEW.object_api AND field_api=NEW.field_api;
 IF NOT NEW.enabled THEN RETURN NEW; END IF;
 SELECT n.table_name,f.column_name INTO tab,col
 FROM md_native_objects n JOIN md_native_fields f ON f.tenant_id=n.tenant_id
   AND f.object_api=n.object_api
 WHERE n.tenant_id=NEW.tenant_id AND n.object_api=NEW.object_api
   AND f.field_api=NEW.field_api;
 IF tab IS NULL THEN RETURN NEW; END IF;
 expr:=CASE WHEN col IS NULL THEN 'nr.extras->>$3'
   ELSE format('nr.%I::text',col) END;
 EXECUTE format('INSERT INTO md_field_exact_index_entries
   (tenant_id,object_api,field_api,record_id,value_hash,folded_hash)
   SELECT $1,$2,$3,nr.id,md5((%s)::text),md5(lower((%s)::text))
   FROM %I nr
   WHERE nr.tenant_id=$1 AND NOT nr.is_deleted AND $3=ANY(nr.present_fields)
     AND (%s) IS NOT NULL
   ON CONFLICT(tenant_id,object_api,field_api,record_id) DO UPDATE
   SET value_hash=EXCLUDED.value_hash,folded_hash=EXCLUDED.folded_hash',
   expr,expr,tab,expr)
 USING NEW.tenant_id,NEW.object_api,NEW.field_api;
 RETURN NEW;
END $$;

-- Parent transfers must continue cascading through native Master-Detail references.
CREATE OR REPLACE FUNCTION md_sync_master_detail_owner_from_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE relation record; expr text;
BEGIN
 IF NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
   AND NEW.owner_queue_id IS NOT DISTINCT FROM OLD.owner_queue_id THEN RETURN NEW; END IF;
 FOR relation IN
  SELECT d.object_api,d.api_name,n.table_name,f.column_name
  FROM md_field_definitions d JOIN md_native_objects n
   ON n.tenant_id=d.tenant_id AND n.object_api=d.object_api
  JOIN md_native_fields f ON f.tenant_id=d.tenant_id
    AND f.object_api=d.object_api AND f.field_api=d.api_name
  WHERE d.tenant_id=NEW.tenant_id AND d.related_object=NEW.object_api
   AND d.relationship_type='Master-Detail' AND d.data_type='reference'
   AND d.deleted_at IS NULL AND d.is_primary_master=true
 LOOP
  expr:=CASE WHEN relation.column_name IS NULL THEN 'nr.extras->> $2'
    ELSE format('nr.%I::text',relation.column_name) END;
  EXECUTE format('UPDATE md_records child SET owner_id=$3,owner_queue_id=$4
   FROM %I nr WHERE nr.tenant_id=$1 AND child.tenant_id=nr.tenant_id
   AND child.id=nr.id AND child.object_api=$5
   AND (%s)=$2::text
   AND (child.owner_id IS DISTINCT FROM $3 OR child.owner_queue_id IS DISTINCT FROM $4)',
   relation.table_name,expr)
  USING NEW.tenant_id,NEW.id,NEW.owner_id,NEW.owner_queue_id,relation.object_api;
 END LOOP;
 RETURN NEW;
END $$;

-- The append-only Communication restriction is a record-level policy now.
CREATE OR REPLACE FUNCTION md_communication_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obj text;
BEGIN
 obj:=CASE WHEN TG_OP='DELETE' THEN OLD.object_api ELSE NEW.object_api END;
 IF obj='Communication'
   AND NOT (TG_OP='INSERT'
     AND current_setting('metadrive.communication_writer',true)='on') THEN
  RAISE EXCEPTION 'System Communication records are append-only'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

-- Rebuild the setup-audit installer without reference to the retired table.
CREATE OR REPLACE FUNCTION md_install_setup_audit() RETURNS void LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
 FOR n IN SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND starts_with(tablename,'md_')
  AND tablename NOT IN('md_records','md_record_multi_values','md_deleted_lookup_links','md_record_files','md_record_activities','md_record_chatter_posts','md_record_chatter_comments','md_record_history','md_record_lifecycle_audit','md_record_retention_audit','md_auto_number_counters','md_sessions','md_refresh_sessions','md_security_events','md_setup_audit_events','md_setup_audit_tables','md_monitor_events','md_security_rule_windows','md_rbac_revisions','md_password_history','md_password_reset_challenges','md_mfa_login_challenges','md_mfa_enrollment_tokens','md_mfa_backup_codes','md_webauthn_challenges','md_federation_requests','md_federation_tickets','md_saml_request_ids','md_oauth_codes','md_oauth_tokens','md_oauth_consents','md_oauth_consent_scopes','md_notifications','md_approval_requests','md_dashboard_snapshots','md_flow_runs','md_flow_run_inputs','md_flow_interview_state','md_flow_interview_values','md_flow_interview_records','md_flow_interview_record_fields','md_flow_interview_loop_state','md_flow_execution_audit','md_flow_execution_requests','md_flow_execution_result_values','md_flow_email_jobs','md_http_callout_jobs','md_http_callout_job_values','md_platform_event_deliveries','md_platform_event_messages','md_platform_event_values','md_webhook_deliveries','md_durable_jobs','md_durable_job_events','md_durable_job_values','md_encrypted_field_access_audit','md_tenant_recovery_cases','md_tenant_recovery_case_proofs','md_tenant_recovery_approvals','md_tenant_lifecycle_audit','md_global_value_set_audit','md_tenant_provisioning_requests','md_bootstrap_password_repairs','md_initial_password_rotations','md_system_migrations','md_schema_migrations','md_migrations','md_tenant_api_usage_daily','md_api_usage_daily','md_api_request_counts','md_offline_sync_receipts','md_data_import_jobs','md_data_import_rows','md_data_export_jobs') LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS md_capture_setup_mutation ON %I',n);
  EXECUTE format('CREATE TRIGGER md_capture_setup_mutation AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION md_capture_setup_mutation()',n);
  INSERT INTO md_setup_audit_tables VALUES(n) ON CONFLICT DO NOTHING;
 END LOOP;
END
$$;

-- Remove functions and value-table triggers that no longer have a caller.
DO $native_drop$
BEGIN
 IF to_regclass('md_record_values') IS NOT NULL THEN
  DROP TRIGGER IF EXISTS md_native_value_changed ON md_record_values;
  DROP FUNCTION IF EXISTS md_native_write_value(md_record_values,boolean) CASCADE;
 END IF;
END $native_drop$;
DROP FUNCTION IF EXISTS md_native_value_changed() CASCADE;
DROP FUNCTION IF EXISTS md_record_value_typed_projection() CASCADE;
DROP FUNCTION IF EXISTS md_record_search_values_sync() CASCADE;
DROP FUNCTION IF EXISTS md_sync_field_exact_record_trigger() CASCADE;
DROP FUNCTION IF EXISTS md_sync_master_detail_owner_from_reference() CASCADE;
DROP FUNCTION IF EXISTS md_validate_relationship_record_target() CASCADE;

DROP TABLE IF EXISTS md_record_values CASCADE;

-- An EAV-dependent function is an error, not an allowed dangling definition.
DO $native_audit$
DECLARE stale text;
BEGIN
 SELECT string_agg(p.proname,', ' ORDER BY p.proname) INTO stale
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.prosrc ILIKE '%md_record_values%';
 IF stale IS NOT NULL THEN
  RAISE EXCEPTION 'Native cutover left EAV-dependent functions: %',stale;
 END IF;
END $native_audit$;

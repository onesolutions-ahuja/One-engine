-- Read-only, tenant-aware legacy-record integrity audit.
-- Do not guess owners, rewrite business records, or validate the NOT VALID foreign key.
WITH inspected AS (
 SELECT r.tenant_id,r.object_api,
   r.owner_id IS NULL AS missing_owner,
   r.record_type_id IS NULL AS missing_record_type,
   r.record_type_id IS NOT NULL AND t.record_type_id IS NULL AS invalid_record_type
 FROM md_records r
 LEFT JOIN md_object_record_types t
   ON t.tenant_id=r.tenant_id AND t.object_api=r.object_api
   AND t.record_type_id=r.record_type_id
)
SELECT tenant_id,object_api,
 count(*) FILTER (WHERE missing_owner) AS missing_owner_count,
 count(*) FILTER (WHERE missing_record_type) AS missing_record_type_count,
 count(*) FILTER (WHERE invalid_record_type) AS invalid_record_type_count
FROM inspected
GROUP BY tenant_id,object_api
HAVING count(*) FILTER (WHERE missing_owner OR missing_record_type OR invalid_record_type)>0
ORDER BY tenant_id,object_api;

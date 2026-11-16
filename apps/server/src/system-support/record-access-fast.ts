/**
 * Lists read thousands of records; md_record_access() costs ~2 ms per record because it
 * re-derives the user's object grants, reporting scope, sharing setting and policies for
 * EVERY row. md_object_access_fast() decides once per query whether those per-row parts
 * are constant for this user and Object. When it returns true, md_record_access(t,u,id,act)
 * equals, for every record of the Object:
 *   (NOT is_deleted OR act='delete') AND (record_type_id IS NULL OR RecordType read grant)
 * because all of the following hold (each mirrors a clause of md_record_access):
 *  - the user is enabled and internal, and the Object exists (not deleted);
 *  - the user has the Object permission for act (so no '*' deny for act either);
 *  - the tenant has no 'Record:<id>' permission rules (no per-record deny or allow);
 *  - the Object has no enabled restriction policies and no Master-Detail fields;
 *  - the user's reporting scope for the Object is unset or 'all';
 *  - a broad grant applies: scope 'all', modifyAll (Object or Record), viewAll (read),
 *    or a public sharing default for act.
 * Otherwise it returns false and callers use md_record_access() row by row, unchanged.
 */
export const RECORD_ACCESS_FAST_DDL=String.raw`
CREATE OR REPLACE FUNCTION md_object_access_fast(t uuid,u uuid,obj text,act text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
  SELECT EXISTS(SELECT 1 FROM md_object_definitions o WHERE o.tenant_id=t AND o.api_name=obj AND o.deleted_at IS NULL)
   AND md_rbac_allowed(t,u,obj,act)
   AND NOT EXISTS(SELECT 1 FROM md_permission_rules pr WHERE pr.tenant_id=t AND pr.resource LIKE 'Record:%')
   AND NOT EXISTS(SELECT 1 FROM md_record_policies rp WHERE rp.tenant_id=t AND rp.object_api=obj
    AND rp.kind='restriction' AND rp.enabled)
   AND NOT EXISTS(SELECT 1 FROM md_field_definitions master WHERE master.tenant_id=t AND master.object_api=obj
    AND master.relationship_type='Master-Detail' AND master.deleted_at IS NULL)
   AND (scope.value IS NULL OR scope.value='all')
   AND (scope.value='all'
    OR md_rbac_allowed(t,u,obj,'modifyAll') OR md_rbac_allowed(t,u,'Record','modifyAll')
    OR (act='read' AND (md_rbac_allowed(t,u,obj,'viewAll') OR md_rbac_allowed(t,u,'Record','viewAll')))
    OR (act='read' AND setting.default_access IN ('Public Read Only','Public Read/Write'))
    OR (act='edit' AND setting.default_access='Public Read/Write'))
  FROM md_users usr
  CROSS JOIN LATERAL (SELECT md_effective_reporting_scope(t,u,obj) AS value) scope
  LEFT JOIN md_sharing_settings setting ON setting.tenant_id=t AND setting.object_api=obj
  WHERE usr.tenant_id=t AND usr.id=u AND usr.enabled AND usr.user_type='internal'
 ),false)
$$;
`;
/** Row predicate for alias r when the query's CTE "access_fast" holds md_object_access_fast(). */
export function fastRecordAccess(tenant:string,user:string,act:'read'|'edit'|'delete',alias='r'){
 if(!/^\$\d+$/.test(tenant)||!/^\$\d+$/.test(user)||!/^[a-z]+$/.test(alias))throw Error('Invalid access parameters');
 return `(CASE WHEN (SELECT fast FROM access_fast) THEN (${act==='delete'?'true':`NOT ${alias}.is_deleted`}
  AND (${alias}.record_type_id IS NULL OR md_rbac_allowed(${tenant},${user},'RecordType:'||${alias}.object_api||'.'||${alias}.record_type_id,'read')))
  ELSE md_record_access(${tenant},${user},${alias}.id,'${act}') END)`;
}

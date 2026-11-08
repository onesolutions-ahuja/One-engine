#!/usr/bin/env bash
# Explicit OCI GitHub Actions operation; no network or database credentials supplied by GitHub.
# Uses local PostgreSQL and the protected production deployment lock.
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 && $# -eq 3 ]] || { echo "Expected protected OCI runner invocation" >&2; exit 64; }
[[ "$GITHUB_REPOSITORY" == "unedev00/uneengine" && "$GITHUB_REF" == "refs/heads/main" ]] || exit 64
[[ "$(uname -m)" == "aarch64" ]] || exit 64
mode="$1"
requested_tenant="$2"
confirmation="$3"
[[ "$mode" == "preview" || "$mode" == "apply" ]] || { echo "Invalid action mode" >&2; exit 64; }
[[ -z "$requested_tenant" || "$requested_tenant" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || {
  echo "Invalid tenant UUID" >&2
  exit 64
}
if [[ "$mode" == "apply" && "$confirmation" != "NORMALIZE TEST TENANT" ]]; then
  echo "Apply requires exact GitHub workflow confirmation" >&2
  exit 64
fi
DB="$(printenv METADRIVE_SQL_PRODUCTION_DB || printf 'metadrive_sql_20261022_production')"
[[ "$DB" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]] || exit 64
command -v runuser >/dev/null
command -v psql >/dev/null
test -r /etc/metadrive/production.env
systemctl is-active --quiet metadrive-api.service
systemctl is-active --quiet metadrive-worker.service

# Serialise with full-stack deployments (including operations broker deployments).
exec 8>/run/lock/metadrive-full-stack.lock
flock -w 20 8 || { echo "OCI deployment active; retry later" >&2; exit 75; }
sha="$(git -C "$GITHUB_WORKSPACE" rev-parse HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$sha" == "$GITHUB_SHA" ]] || exit 1
active="$(systemctl show metadrive-api.service -p WorkingDirectory --value)"
[[ "$active" == "/opt/metadrive/releases/gh-$sha" ]] || {
  echo "OCI API does not run this main commit; deploy full stack first" >&2
  exit 1
}
test -r "$active/apps/server/dist-system/system-support/migrations/20261107-core-baseline.sql"
sql() { runuser -u postgres -- psql -X -Atq -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
[[ "$(sql -c "SELECT to_regprocedure('md_casefold_tenant_api_names(uuid)') IS NOT NULL")" == t ]] || {
  echo "Casefold migration is not installed" >&2; exit 1;
}

# Zero or multiple tenants require explicit selection, never an inferred target.
tenant_count="$(sql -c "SELECT count(*) FROM md_tenants")"
[[ "$tenant_count" =~ ^[0-9]+$ ]] || exit 1
if [[ -z "$requested_tenant" ]]; then
  [[ "$tenant_count" == 1 ]] || {
    echo "Specify tenant UUID in workflow; database does not contain exactly one tenant" >&2; exit 64;
  }
  tenant="$(sql -c "SELECT id FROM md_tenants LIMIT 1")"
else
  tenant="$(sql -c "SELECT id FROM md_tenants WHERE id='$requested_tenant'::uuid")"
  [[ -n "$tenant" ]] || { echo "Tenant UUID not found" >&2; exit 64; }
fi
[[ "$tenant" =~ ^[0-9a-f-]{36}$ ]] || exit 1

summary_query="SELECT
 (SELECT count(*) FROM md_object_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name)) ||
 ',' || (SELECT count(*) FROM md_field_definitions WHERE tenant_id='$tenant' AND (api_name<>lower(api_name) OR object_api<>lower(object_api))) ||
 ',' || (SELECT count(*) FROM md_page_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name)) ||
 ',' || (SELECT count(*) FROM md_flow_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name)) ||
 ',' || (SELECT count(*) FROM md_component_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name)) ||
 ',' || (SELECT count(*) FROM md_tenant_app_metadata WHERE tenant_id='$tenant' AND api_name<>lower(api_name))"
before="$(sql -c "$summary_query")"
[[ "$before" =~ ^[0-9]+(,[0-9]+){5}$ ]] || exit 1
echo "Mode: $mode; tenant count: $tenant_count"
echo "Uppercase counts (objects, fields, pages, flows, components, apps): $before"
if [[ "$mode" == "preview" ]]; then
  echo "Preview complete; SQL unchanged"
  exit 0
fi

stopped=0
recover_services() {
  local result=$?
  trap - EXIT
  if [[ "$stopped" == 1 ]]; then
    systemctl start metadrive-api.service || result=1
    # API startup owns system migrations; verify readiness before worker jobs resume.
    local healthy=0
    for attempt in $(seq 1 90); do
      if curl -fsS --max-time 4 https://api.unesolutions.co.uk/api/health 2>/dev/null |
         grep -q '"status":"ok"'; then
        healthy=1
        break
      fi
      sleep 2
    done
    [[ "$healthy" == 1 ]] || result=1
    systemctl start metadrive-worker.service || result=1
    systemctl is-active --quiet metadrive-api.service || result=1
    systemctl is-active --quiet metadrive-worker.service || result=1
  fi
  exit "$result"
}
trap recover_services EXIT

# Pause service and worker metadata writes and their in-memory caches.
stopped=1
systemctl stop metadrive-worker.service
systemctl stop metadrive-api.service

# Any identity/FK verification failure rolls back the same SQL transaction.
sql -f - <<SQL
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '20min';
SELECT md_casefold_tenant_api_names('$tenant'::uuid);
DO \$verify\$
BEGIN
 IF EXISTS (SELECT 1 FROM md_object_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name))
 OR EXISTS (SELECT 1 FROM md_field_definitions WHERE tenant_id='$tenant' AND (api_name<>lower(api_name) OR object_api<>lower(object_api)))
 OR EXISTS (SELECT 1 FROM md_page_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name))
 OR EXISTS (SELECT 1 FROM md_flow_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name))
 OR EXISTS (SELECT 1 FROM md_component_definitions WHERE tenant_id='$tenant' AND api_name<>lower(api_name))
 OR EXISTS (SELECT 1 FROM md_tenant_app_metadata WHERE tenant_id='$tenant' AND api_name<>lower(api_name))
 THEN
  RAISE EXCEPTION 'Casefold verification failed: primary metadata still mixed case';
 END IF;
END
\$verify\$;
COMMIT;
SQL

after="$(sql -c "$summary_query")"
[[ "$after" == "0,0,0,0,0,0" ]] || {
  echo "Post-transaction metadata verification failed" >&2
  exit 1
}
echo "Tenant SQL conversion committed. Remaining uppercase counts: $after"
# EXIT trap restores the existing API and worker release.

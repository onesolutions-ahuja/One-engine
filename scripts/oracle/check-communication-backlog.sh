#!/usr/bin/env bash
# Read-only post-release evidence on the Oracle host. Never prints tenant data.
set -Eeuo pipefail
DB="${METADRIVE_SQL_PRODUCTION_DB:-metadrive_sql_20261022_production}"
[[ "$DB" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]] || { echo "Invalid SQL database name" >&2; exit 1; }

query_count() {
  runuser -u postgres -- psql -X -Atq -v ON_ERROR_STOP=1 -d "$DB" -c "$1"
}
# A new worker may need time to deliver the previously backlogged records.
count=''
for attempt in $(seq 1 30); do
  count="$(query_count 'SELECT count(*) FROM md_communication_delivery_outbox')"
  [[ "$count" =~ ^[0-9]+$ ]] || { echo "Unexpected SQL result" >&2; exit 1; }
  if [[ "$count" == 0 ]]; then break; fi
  if [[ "$attempt" -lt 30 ]]; then sleep 4; fi
done
records="$(query_count "SELECT count(*) FROM md_records WHERE object_api='Communication' AND is_deleted=false")"
[[ "$records" =~ ^[0-9]+$ ]] || { echo "Unexpected SQL count" >&2; exit 1; }
echo "Oracle Communication: records=$records outbox_pending=$count"
output="${1:-${GITHUB_OUTPUT:-}}"
if [[ -n "$output" ]]; then
  echo "pending_count=$count" >> "$output"
  echo "record_count=$records" >> "$output"
fi
# Do not declare a verified deployment if queued external transactions remain.
[[ "$count" == 0 ]] || { echo "Communication outbox has undelivered transactions" >&2; exit 1; }

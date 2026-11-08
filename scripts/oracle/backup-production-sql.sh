#!/usr/bin/env bash
# Production pre-release PostgreSQL backup. Never prints credentials or tenant records.
set -Eeuo pipefail
umask 077
DB="${METADRIVE_SQL_PRODUCTION_DB:-metadrive_sql_20261022_production}"
[[ "$DB" =~ ^[A-Za-z][A-Za-z0-9_]{0,127}$ ]] || { echo "Invalid database name" >&2; exit 1; }
[[ "${EUID}" == 0 ]] || { echo "Must run via authorised sudo" >&2; exit 1; }
command -v pg_dump >/dev/null && command -v pg_restore >/dev/null
runuser -u postgres -- psql -X -Atq -v ON_ERROR_STOP=1 -d "$DB" -c 'SELECT 1' | grep -qx 1
backup_root=/var/backups/metadrive/postgresql
mkdir -p "$backup_root"
chmod 700 "$backup_root"
backup="$backup_root/pre-release-${GITHUB_SHA:-manual}-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$backup"
runuser -u postgres -- pg_dump --format=custom --no-owner "$DB" > "$backup"
test -s "$backup"
pg_restore --list "$backup" >/dev/null
chmod 600 "$backup"
echo "Verified SQL backup saved in restricted /var/backups/metadrive/postgresql (contents not logged)."

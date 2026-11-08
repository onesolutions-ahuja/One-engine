#!/usr/bin/env bash
# Orchestrate the existing Oracle API and frontend deployers as one recovery unit.
set -Eeuo pipefail
[[ "${EUID}" == 0 ]] || { echo "Root deployment helper required" >&2; exit 1; }
# Coordinate deployments initiated by the existing Actions runner and the
# authenticated OCI operations broker. The API helper retains its own lock.
exec 8>/run/lock/metadrive-full-stack.lock
flock -n 8 || { echo "Another full-stack deployment is in progress" >&2; exit 75; }
SOURCE="${1:?absolute repository checkout required}"
SHA="${2:?commit SHA required}"
[[ "$SOURCE" = /* && "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
API=metadrive-api.service
WORKER=metadrive-worker.service
FRONT=/var/www/metadrive-frontend/current
API_OVERRIDE=/etc/systemd/system/metadrive-api.service.d/90-oracle-actions.conf
WORKER_OVERRIDE=/etc/systemd/system/metadrive-worker.service.d/90-oracle-actions.conf
OLD_API_RELEASE="$(systemctl show "$API" -p WorkingDirectory --value)"
OLD_WORKER_RELEASE="$(systemctl show "$WORKER" -p WorkingDirectory --value)"
[[ -d "$OLD_API_RELEASE" && -d "$OLD_WORKER_RELEASE" ]] || exit 1
backup_dir="$(mktemp -d /var/tmp/metadrive-rollback.XXXXXXXX)"
chmod 700 "$backup_dir"
if [[ -f "$API_OVERRIDE" ]]; then cp -p "$API_OVERRIDE" "$backup_dir/api"; fi
if [[ -f "$WORKER_OVERRIDE" ]]; then cp -p "$WORKER_OVERRIDE" "$backup_dir/worker"; fi
if [[ -L "$FRONT" ]]; then readlink "$FRONT" > "$backup_dir/frontend-target"; fi
API_ACTIVATED=0
FRONT_STARTED=0
# The direct OCI deployer may request safe milestones. This fixed root-owned
# trail never includes database contents, credentials or arbitrary shell output.
report_oci_progress() {
  [[ "${METADRIVE_OCI_DEPLOY_MONITOR:-}" == 1 ]] || return 0
  local trail=/var/lib/metadrive/oci-deployment/trail
  [[ -f "$trail" && $(stat -c %u "$trail") == 0 ]] || return 0
  printf '%s deploying — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$trail"
}
rollback() {
  local rc=$?
  trap - ERR
  report_oci_progress 'Deployment failed; restoring previous API and frontend release' || true
  echo "Combined Oracle deployment failed; restoring previous service release and frontend pointer." >&2
  if [[ "$API_ACTIVATED" == 1 ]]; then
    if [[ -f "$backup_dir/api" ]]; then cp -p "$backup_dir/api" "$API_OVERRIDE"; else rm -f "$API_OVERRIDE"; fi
    if [[ -f "$backup_dir/worker" ]]; then cp -p "$backup_dir/worker" "$WORKER_OVERRIDE"; else rm -f "$WORKER_OVERRIDE"; fi
    systemctl daemon-reload
    systemctl restart "$API" || true
    systemctl restart "$WORKER" || true
  fi
  if [[ "$FRONT_STARTED" == 1 && -f "$backup_dir/frontend-target" ]]; then
    ln -sfn "$(cat "$backup_dir/frontend-target")" /var/www/metadrive-frontend/.next
    mv -Tf /var/www/metadrive-frontend/.next "$FRONT"
    nginx -t && systemctl reload nginx || true
  fi
  exit "$rc"
}
trap rollback ERR
# Back up first, before API migrations or frontend changes. The DB is never
# automatically restored: only an authorised recovery plan may restore SQL.
report_oci_progress 'Backing up production SQL'
bash "$SOURCE/scripts/oracle/backup-production-sql.sh"
report_oci_progress 'SQL backup complete; deploying API and worker'
bash "$SOURCE/scripts/oracle/deploy-api.sh" "$SOURCE" "$SHA"
API_ACTIVATED=1
report_oci_progress 'API and worker activated; applying data changes'
# Execute tenant migrations from the immutable release, not the runner checkout:
# the unprivileged metadrive user cannot reliably read /home/ubuntu.
api_release="$(systemctl show "$API" -p WorkingDirectory --value)"
worker_release="$(systemctl show "$WORKER" -p WorkingDirectory --value)"
[[ "$api_release" == "/opt/metadrive/releases/gh-$SHA" && "$worker_release" == "$api_release" ]] ||
  { echo "Active services do not match the requested release" >&2; exit 1; }
# Cart fields are seeded by the new API; finish one-time data and metadata retirement.
bash "$SOURCE/scripts/oracle/apply-cart-session-retirement.sh" "$api_release"
report_oci_progress 'Database updates complete; verifying release alignment'
# Never publish the SQL-backed Page Builder frontend unless the API and
# worker have been activated from this exact immutable release. A protected
# endpoint returning HTTP 401 cannot prove that it exists, so do not mistake
# unauthenticated HTTP responses for API readiness.
api_release="$(systemctl show "$API" -p WorkingDirectory --value)"
worker_release="$(systemctl show "$WORKER" -p WorkingDirectory --value)"
[[ "$api_release" == "/opt/metadrive/releases/gh-$SHA" ]] ||
  { echo "API release mismatch; frontend publication blocked" >&2; exit 1; }
[[ "$worker_release" == "/opt/metadrive/releases/gh-$SHA" ]] ||
  { echo "Worker release mismatch; frontend publication blocked" >&2; exit 1; }
grep -q "api/metadata/builder-ribbon"   "$api_release/apps/server/dist-system/system-support/server.js" ||
  { echo "SQL-backed builder ribbon API missing from active server release" >&2; exit 1; }
FRONT_STARTED=1
report_oci_progress 'Deploying frontend'
bash "$SOURCE/scripts/oracle/deploy-frontend.sh" "$SOURCE/apps/web/dist" "$SHA"
report_oci_progress 'Frontend published; checking API, worker and nginx'
systemctl is-active --quiet "$API"
systemctl is-active --quiet "$WORKER"
systemctl is-active --quiet nginx.service
nginx -t
trap - ERR
report_oci_progress 'Full stack deployed; local health checks passed'
echo "Full stack deployed and local health checks passed at $SHA"
# Keep backup_dir and previous releases for audited recovery.

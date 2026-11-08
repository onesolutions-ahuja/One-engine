#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/run/lock/metadrive-api-deploy.lock
flock -n 9 || { echo "Another API deployment is active"; exit 75; }
SOURCE="${1:?source checkout required}"
SHA="${2:?commit SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid commit SHA"; exit 1; }
[[ "$SOURCE" == /* ]] || { echo "Expected absolute source path"; exit 1; }

API_SERVICE=metadrive-api.service
WORKER_SERVICE=metadrive-worker.service
API_OVERRIDE=/etc/systemd/system/metadrive-api.service.d/90-oracle-actions.conf
WORKER_OVERRIDE=/etc/systemd/system/metadrive-worker.service.d/90-oracle-actions.conf
API_BACKUP="$(mktemp)"
WORKER_BACKUP="$(mktemp)"
HAD_API_OVERRIDE=0
HAD_WORKER_OVERRIDE=0
SWITCHED=0
RELEASE="/opt/metadrive/releases/gh-${SHA}"

[[ ! -f "$API_OVERRIDE" ]] || { cp "$API_OVERRIDE" "$API_BACKUP"; HAD_API_OVERRIDE=1; }
[[ ! -f "$WORKER_OVERRIDE" ]] || { cp "$WORKER_OVERRIDE" "$WORKER_BACKUP"; HAD_WORKER_OVERRIDE=1; }
restore_override() {
  local backup="$1" override="$2" existed="$3"
  if [[ "$existed" == 1 ]]; then
    cp "$backup" "$override"
  else
    rm -f "$override"
  fi
}
rollback() {
  trap - ERR
  if [[ "$SWITCHED" == 1 ]]; then
    echo "Oracle API/worker verification failed: capturing API startup diagnostics before rollback"
    python3 -I "$SOURCE/scripts/oracle/diagnose-api-startup.py" || true
    echo "Restoring both previous releases"
    restore_override "$API_BACKUP" "$API_OVERRIDE" "$HAD_API_OVERRIDE"
    restore_override "$WORKER_BACKUP" "$WORKER_OVERRIDE" "$HAD_WORKER_OVERRIDE"
    systemctl daemon-reload
    systemctl restart "$API_SERVICE" || true
    systemctl restart "$WORKER_SERVICE" || true
  fi
  rm -f "$API_BACKUP" "$WORKER_BACKUP"
}
trap rollback ERR

test -f /etc/metadrive/production.env
systemctl is-active --quiet "$API_SERVICE"
systemctl is-active --quiet "$WORKER_SERVICE"
test -f "$SOURCE/apps/server/dist-system/system-support/entrypoint.js"
test -f "$SOURCE/apps/server/dist-system/system-support/job-worker-entrypoint.js"

# The previous API and worker remain untouched until the new release passes
# startup and reverse-proxy health checks. Inactive historical code snapshots
# may be removed before staging to recover bounded Oracle disk space.
RELEASE_ROOT=/opt/metadrive/releases
OLD_API_RELEASE="$(systemctl show "$API_SERVICE" -p WorkingDirectory --value)"
OLD_WORKER_RELEASE="$(systemctl show "$WORKER_SERVICE" -p WorkingDirectory --value)"
bash "$SOURCE/scripts/oracle/prune-inactive-api-releases.sh" "$RELEASE_ROOT" \
  "$OLD_API_RELEASE" "$OLD_WORKER_RELEASE" "$RELEASE"

# Retry an interrupted copy safely; an incomplete immutable release must not
# be treated as deployed just because its directory was previously created.
if [[ -d "$RELEASE" && ( ! -f "$RELEASE/apps/server/dist-system/system-support/entrypoint.js" \
   || ! -f "$RELEASE/apps/server/dist-system/system-support/job-worker-entrypoint.js" ) ]]; then
  rm -rf --one-file-system -- "$RELEASE"
fi
if [[ ! -d "$RELEASE" ]]; then
  mkdir -m 0700 "$RELEASE"
  cp -a "$SOURCE/apps" "$SOURCE/node_modules" "$SOURCE/package.json" "$SOURCE/package-lock.json" "$RELEASE/"
  # Migration entrypoints must be readable by the metadrive service account.
  # The self-hosted runner checkout under /home/ubuntu is not a runtime path.
  mkdir -p "$RELEASE/scripts"
  cp -a "$SOURCE/scripts/cart" "$SOURCE/scripts/codextill" "$RELEASE/scripts/"
  chown -R metadrive:metadrive "$RELEASE"
fi
test -f "$RELEASE/apps/server/dist-system/system-support/entrypoint.js"
test -f "$RELEASE/apps/server/dist-system/system-support/job-worker-entrypoint.js"
# Connector packages were not included when the repository was moved to a new
# GitHub account. Preserve existing, independently installed connector
# manifests from the currently active known-good release instead of starting
# an API that will crash while seeding the connector app catalogue. New
# manifests supplied in the checkout always take precedence.
connector_bundle="$RELEASE/apps/server/dist-system/connector-scripts"
prior_connector_bundle="$OLD_API_RELEASE/apps/server/dist-system/connector-scripts"
for connector in whatsapp sms-gate brevo uber-eats deliveroo just-eat; do
  if [[ ! -f "$connector_bundle/$connector/scripts/install.mjs" ]]; then
    if [[ ! -f "$prior_connector_bundle/$connector/scripts/install.mjs" ]]; then
      echo "Missing required connector manifest in both releases: $connector" >&2
      exit 1
    fi
    mkdir -p "$connector_bundle/$connector"
    cp -a "$prior_connector_bundle/$connector/." "$connector_bundle/$connector/"
  fi
  test -s "$connector_bundle/$connector/scripts/install.mjs"
done
chown -R metadrive:metadrive "$connector_bundle"
# Fail before switching services if a migration dependency is absent or unreadable.
runuser -u metadrive -- test -r "$RELEASE/scripts/cart/migrate-cart-session-to-cart.mjs"
runuser -u metadrive -- test -r "$RELEASE/scripts/codextill/ensure-smart-till-cart-flows.mjs"

# Stamp the code we are about to activate, not the latest main branch.
# On rollback the previous systemd overrides (and their stamps) are restored.
RELEASE_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$(dirname "$API_OVERRIDE")" "$(dirname "$WORKER_OVERRIDE")"
cat > "$API_OVERRIDE" <<EOF
[Service]
WorkingDirectory=$RELEASE
Environment=METADRIVE_RELEASE_SHA=$SHA
Environment=METADRIVE_RELEASE_AT=$RELEASE_AT
ExecStart=
ExecStart=$(command -v node) $RELEASE/apps/server/dist-system/system-support/entrypoint.js
EOF
cat > "$WORKER_OVERRIDE" <<EOF
[Service]
WorkingDirectory=$RELEASE
Environment=METADRIVE_RELEASE_SHA=$SHA
Environment=METADRIVE_RELEASE_AT=$RELEASE_AT
ExecStart=
ExecStart=$(command -v node) $RELEASE/apps/server/dist-system/system-support/job-worker-entrypoint.js
EOF
SWITCHED=1
systemctl daemon-reload

# API owns SQL migrations and metadata seeding. Health must pass before
# activating the worker against the upgraded schema.
systemctl restart "$API_SERVICE"
# Check the actual systemd backend as well as the reverse proxy. A public
# HTTP 502 alone cannot distinguish a failed SQL startup from proxy misrouting.
# Read only the numeric PORT setting, never source or print production secrets.
API_PORT="$(sed -nE 's/^[[:space:]]*PORT="?([0-9]{1,5})"?[[:space:]]*$/\1/p' /etc/metadrive/production.env | head -n 1)"
API_PORT="${API_PORT:-10000}"
[[ "$API_PORT" =~ ^[0-9]{1,5}$ ]] && ((API_PORT >= 1 && API_PORT <= 65535))
LOCAL_OK=0
PUBLIC_OK=0
# Migrations and tenant metadata seeding on Oracle ARM can exceed the old
# 40-second health window. Allow a bounded three-minute startup grace period.
for attempt in $(seq 1 90); do
  if curl --silent --fail --max-time 3 "http://127.0.0.1:${API_PORT}/api/health" |
       grep -q '"status":"ok"'; then
    LOCAL_OK=1
  fi
  if curl --silent --fail --max-time 4 https://api.unesolutions.co.uk/api/health |
       grep -q '"status":"ok"'; then
    PUBLIC_OK=1
  fi
  if [[ "$LOCAL_OK" == 1 && "$PUBLIC_OK" == 1 ]]; then break; fi
  sleep 2
done
echo "Oracle API health: local=${LOCAL_OK} reverse_proxy=${PUBLIC_OK}"
[[ "$LOCAL_OK" == 1 && "$PUBLIC_OK" == 1 ]]
systemctl is-active --quiet "$API_SERVICE"
systemctl show -p ExecStart --value "$API_SERVICE" | grep -F -q "$RELEASE"

systemctl restart "$WORKER_SERVICE"
# Watch for immediate runtime failures, not just a successful systemctl restart.
for attempt in $(seq 1 5); do
  sleep 1
  systemctl is-active --quiet "$WORKER_SERVICE"
done
systemctl show -p ExecStart --value "$WORKER_SERVICE" | grep -F -q "$RELEASE"

SWITCHED=0
trap - ERR
rm -f "$API_BACKUP" "$WORKER_BACKUP"
echo "Oracle API and worker deployment verified: $SHA"
# Keep the prior immutable release for coordinated frontend/backend rollback.
# Cleanup is a separate, audited operation after production verification.
echo "Previous release retained for recovery."

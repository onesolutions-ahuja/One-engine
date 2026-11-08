#!/usr/bin/env bash
# Install only the existing OCI operations broker binaries and the fixed
# production deploy helper. No new sockets, services or credentials.
set -Eeuo pipefail
[[ $EUID == 0 ]] || exit 1
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $(systemctl show metadrive-api.service -p User --value) == metadrive ]] || exit 1
[[ $(systemctl show metadrive-api.service -p NoNewPrivileges --value) == yes ]] || exit 1
systemctl is-active --quiet metadrive-mcp-broker.socket
if ! id metadrive-build >/dev/null 2>&1; then
  /usr/sbin/useradd --system --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin metadrive-build
fi
install -d -o root -g root -m 0700 /var/lib/metadrive/oci-deployment
install -d -o root -g root -m 0755 /usr/local/libexec
# Atomic updates: socket activation starts new broker instances from this path.
install -o root -g root -m 0755 "$source_dir/metadrive-mcp-operations" /usr/local/sbin/.metadrive-mcp-operations.new
mv -f /usr/local/sbin/.metadrive-mcp-operations.new /usr/local/sbin/metadrive-mcp-operations
install -o root -g root -m 0755 "$source_dir/metadrive-mcp-broker.py" /usr/local/libexec/.metadrive-mcp-broker.py.new
mv -f /usr/local/libexec/.metadrive-mcp-broker.py.new /usr/local/libexec/metadrive-mcp-broker.py
install -o root -g root -m 0755 "$source_dir/metadrive-oci-deploy-latest" /usr/local/libexec/.metadrive-oci-deploy-latest.new
mv -f /usr/local/libexec/.metadrive-oci-deploy-latest.new /usr/local/libexec/metadrive-oci-deploy-latest
# The original temporary bootstrap email/domain variables are intentionally
# absent from production. Declare only this fixed, OCI-owner-controlled root
# platform domain; the SQL seeder must still find exactly one active original
# TenantDeveloper role holder with OneEngine before it can grant anything.
install -d -o root -g root -m 0755 /etc/systemd/system/metadrive-api.service.d
cat >/etc/systemd/system/metadrive-api.service.d/96-platform-deploy-owner.conf <<'UNIT'
[Service]
Environment=METADRIVE_PLATFORM_CANONICAL_DOMAIN=unesolutions.co.uk
UNIT
chmod 0644 /etc/systemd/system/metadrive-api.service.d/96-platform-deploy-owner.conf
systemctl daemon-reload
# Verify that the API service account can actually reach the root-owned
# deployment broker. A running API alone does not prove deploy_status works.
# This probe is read-only: it does not schedule or activate any release.
/usr/sbin/runuser -u metadrive -- /usr/bin/python3 - <<'PY'
import json
import socket

with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
    conn.settimeout(12)
    conn.connect("/run/metadrive-mcp-broker.sock")
    conn.sendall(b'{"action":"deploy_status","service":"api"}\n')
    line = bytearray()
    while b"\n" not in line and len(line) < 262144:
        chunk = conn.recv(8192)
        if not chunk:
            break
        line.extend(chunk)
    payload = json.loads(bytes(line).split(b"\n", 1)[0])
    status = payload.get("output", "")
    if not isinstance(status, str) or not any(
        status.startswith("state=" + state + "\n")
        for state in ("idle", "running", "succeeded", "failed")
    ) or "log_collector=v2\n" not in status or "build_log_state=" not in status:
        raise SystemExit("OCI operations broker live log collector probe failed")
print("OCI deployment status and live log collector verified.")
PY
echo 'OCI deployment control installed with existing restricted broker.'

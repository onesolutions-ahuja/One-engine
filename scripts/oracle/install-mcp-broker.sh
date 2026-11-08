#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root' >&2; exit 1; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $(systemctl show metadrive-api.service -p User --value) == metadrive ]] || exit 1
# Preserve the current API sandbox; never turn off NoNewPrivileges.
[[ $(systemctl show metadrive-api.service -p NoNewPrivileges --value) == yes ]] || {
  echo 'Unexpected API sandbox configuration; aborting' >&2; exit 1;
}
id metadrive >/dev/null
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$src/metadrive-mcp-operations" /usr/local/sbin/metadrive-mcp-operations
install -o root -g root -m 0755 "$src/metadrive-mcp-activate" /usr/local/libexec/metadrive-mcp-activate
# Fresh installs include the already versioned OCI deployment control.
if ! id metadrive-build >/dev/null 2>&1; then
  /usr/sbin/useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin metadrive-build
fi
install -o root -g root -m 0755 "$src/metadrive-oci-deploy-latest" /usr/local/libexec/metadrive-oci-deploy-latest
install -d -o root -g root -m 0700 /var/lib/metadrive/oci-deployment
install -o root -g root -m 0755 "$src/metadrive-mcp-broker.py" /usr/local/libexec/metadrive-mcp-broker.py
python3 -m py_compile "$src/maildir-communication-reader.py"
install -o root -g root -m 0755 "$src/maildir-communication-reader.py" /usr/local/libexec/metadrive-maildir-reader.py
install -o root -g root -m 0755 "$src/check-mail-inbox-communication.py" /usr/local/libexec/metadrive-mail-inbox-check.py
cat >/etc/systemd/system/metadrive-mcp-broker.socket <<'UNIT'
[Unit]
Description=MetaDrive restricted operations socket
[Socket]
ListenStream=/run/metadrive-mcp-broker.sock
SocketUser=root
SocketGroup=metadrive
SocketMode=0660
Accept=yes
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
UNIT
cat >/etc/systemd/system/metadrive-mcp-broker@.service <<'UNIT'
[Unit]
Description=MetaDrive restricted operations request
# Socket Accept=yes creates one instance per connection. Retain failures in
# journald, not as indefinitely loaded failed systemd units.
CollectMode=inactive-or-failed
[Service]
Type=exec
User=root
Group=root
EnvironmentFile=-/etc/metadrive/mail-sender.env
ExecStart=/usr/bin/python3 /usr/local/libexec/metadrive-mcp-broker.py
StandardInput=socket
StandardOutput=socket
StandardError=journal
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes
ProtectSystem=strict
RuntimeMaxSec=75
UNIT
install -d -m 0755 /etc/systemd/system/metadrive-api.service.d
cat >/etc/systemd/system/metadrive-api.service.d/95-mcp.conf <<'UNIT'
[Service]
Environment=METADRIVE_MCP_ORIGIN=https://api.unesolutions.co.uk
Environment=METADRIVE_MCP_OPERATIONS=enabled
Environment=METADRIVE_MCP_BROKER_SOCKET=/run/metadrive-mcp-broker.sock
UNIT
rm -f /etc/sudoers.d/metadrive-mcp
systemctl daemon-reload
systemctl enable --now metadrive-mcp-broker.socket
echo 'Broker socket enabled. Deploy compatible API build before restarting metadrive-api.service.'

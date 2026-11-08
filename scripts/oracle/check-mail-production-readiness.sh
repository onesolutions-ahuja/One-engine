#!/usr/bin/env bash
# Read-only Oracle preflight for the deployed MetaDrive mail integration.
# No credentials, message contents, Docker restarts, or file writes.
set -euo pipefail
echo '== Docker Mailserver =='
sudo docker inspect -f '{{.Name}} {{.State.Status}}' metadrive-docker-mailserver
echo '== MetaDrive API release =='
systemctl show metadrive-api.service -p ActiveState -p ExecStart --no-pager
echo '== Mail administration broker socket =='
if systemctl is-active --quiet metadrive-mcp-broker.socket && test -S /run/metadrive-mcp-broker.sock; then
 echo 'broker socket active'
else
 echo 'broker socket unavailable' >&2
 exit 1
fi
echo '== Mail protocol worker in deployed release =='
api_path="$(systemctl show metadrive-api.service -p ExecStart --value)"
release_js="$(printf '%s\n' "$api_path" | grep -oE '/opt/metadrive/releases/[^ ;]+/apps/server/dist-system/system-support/entrypoint.js' | head -n 1 || true)"
if [[ -z "$release_js" ]]; then echo 'Unexpected API entrypoint' >&2; exit 1; fi
worker_path="${release_js%system-support/entrypoint.js}scripts/mail-protocol.py"
test -r "$worker_path"
python3 -c 'import sys; compile(open(sys.argv[1], encoding="utf8").read(), sys.argv[1], "exec")' "$worker_path"
echo 'mail worker available'
echo '== CORS and unauthenticated route response =='
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'Origin: https://unesolutions.co.uk' -H 'Content-Type: application/json' --data '{"action":"login"}' https://api.unesolutions.co.uk/api/mail-client/)"
echo "Unauthenticated mail endpoint HTTP $status"
[[ "$status" == 401 ]]
echo '== Mail services =='
systemctl is-active metadrive-api.service metadrive-worker.service
echo 'Read-only preflight passed. Authenticated mailbox and admin tests still required.'
